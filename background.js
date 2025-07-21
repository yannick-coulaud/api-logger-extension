// background.js - Service Worker pour capturer les requêtes
class APILogger {
  constructor() {
    this.logs = [];
    this.isLogging = false;
    this.filters = {
      urls: [], // URLs à capturer (vide = toutes)
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']
    };
    
    this.initListeners();
  }

  initListeners() {
    // Écouter les requêtes sortantes
    chrome.webRequest.onBeforeRequest.addListener(
      (details) => this.onRequest(details),
      { urls: ["<all_urls>"] },
      ["requestBody"]
    );

    // Écouter les réponses
    chrome.webRequest.onCompleted.addListener(
      (details) => this.onResponse(details),
      { urls: ["<all_urls>"] },
      ["responseHeaders"]
    );

    // Écouter les erreurs
    chrome.webRequest.onErrorOccurred.addListener(
      (details) => this.onError(details),
      { urls: ["<all_urls>"] }
    );

    // Messages depuis popup/content
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      this.handleMessage(request, sender, sendResponse);
      return true; // Garde la connexion ouverte pour réponse async
    });
  }

  onRequest(details) {
    if (!this.isLogging || !this.shouldLog(details)) return;

    const logEntry = {
      id: details.requestId,
      timestamp: new Date().toISOString(),
      type: 'REQUEST',
      method: details.method,
      url: details.url,
      tabId: details.tabId,
      requestBody: this.parseRequestBody(details.requestBody),
      initiator: details.initiator
    };

    // Stocker temporairement pour associer avec la réponse
    this.tempRequests = this.tempRequests || new Map();
    this.tempRequests.set(details.requestId, logEntry);
  }

  onResponse(details) {
    if (!this.isLogging || !this.shouldLog(details)) return;
    
    const requestEntry = this.tempRequests?.get(details.requestId);
    if (!requestEntry) return;

    const completeEntry = {
      ...requestEntry,
      responseTimestamp: new Date().toISOString(),
      statusCode: details.statusCode,
      responseHeaders: details.responseHeaders,
      duration: Date.now() - new Date(requestEntry.timestamp).getTime()
    };

    this.logs.push(completeEntry);
    this.tempRequests.delete(details.requestId);
    
    // Sauvegarder périodiquement
    this.saveToStorage();
  }

  onError(details) {
    if (!this.isLogging || !this.shouldLog(details)) return;
    
    const requestEntry = this.tempRequests?.get(details.requestId);
    if (!requestEntry) return;

    const errorEntry = {
      ...requestEntry,
      responseTimestamp: new Date().toISOString(),
      error: details.error,
      duration: Date.now() - new Date(requestEntry.timestamp).getTime()
    };

    this.logs.push(errorEntry);
    this.tempRequests.delete(details.requestId);
  }

  shouldLog(details) {
    // Filtrer par méthode
    if (!this.filters.methods.includes(details.method)) return false;
    
    // Filtrer par URL si des filtres sont définis
    if (this.filters.urls.length > 0) {
      return this.filters.urls.some(filter => details.url.includes(filter));
    }
    
    // Exclure les requêtes internes du navigateur
    if (details.url.startsWith('chrome-extension://') || 
        details.url.startsWith('moz-extension://') ||
        details.url.includes('favicon.ico')) {
      return false;
    }
    
    return true;
  }

  parseRequestBody(requestBody) {
    if (!requestBody) return null;
    
    if (requestBody.formData) {
      return { type: 'formData', data: requestBody.formData };
    }
    
    if (requestBody.raw) {
      try {
        const decoder = new TextDecoder();
        const bodyText = decoder.decode(requestBody.raw[0].bytes);
        return { type: 'json', data: JSON.parse(bodyText) };
      } catch (e) {
        return { type: 'raw', data: 'Could not parse request body' };
      }
    }
    
    return null;
  }

  async handleMessage(request, sender, sendResponse) {
    switch (request.action) {
      case 'startLogging':
        this.isLogging = true;
        this.filters = request.filters || this.filters;
        sendResponse({ success: true, message: 'Logging started' });
        break;
        
      case 'stopLogging':
        this.isLogging = false;
        sendResponse({ success: true, message: 'Logging stopped' });
        break;
        
      case 'getLogs':
        sendResponse({ logs: this.logs, count: this.logs.length });
        break;
        
      case 'clearLogs':
        this.logs = [];
        await chrome.storage.local.clear();
        sendResponse({ success: true, message: 'Logs cleared' });
        break;
        
      case 'exportLogs':
        this.exportLogs();
        sendResponse({ success: true, message: 'Export started' });
        break;
        
      case 'setFilters':
        this.filters = request.filters;
        sendResponse({ success: true, message: 'Filters updated' });
        break;
        
      default:
        sendResponse({ error: 'Unknown action' });
    }
  }

  async saveToStorage() {
    // Sauvegarder seulement les 1000 derniers logs pour éviter de surcharger
    const logsToSave = this.logs.slice(-1000);
    await chrome.storage.local.set({ apiLogs: logsToSave });
  }

  async loadFromStorage() {
    const result = await chrome.storage.local.get(['apiLogs']);
    if (result.apiLogs) {
      this.logs = result.apiLogs;
    }
  }

  exportLogs() {
    const exportData = {
      exportDate: new Date().toISOString(),
      totalRequests: this.logs.length,
      filters: this.filters,
      logs: this.logs
    };

    const dataStr = JSON.stringify(exportData, null, 2);
    const filename = `api-logs-${new Date().toISOString().split('T')[0]}.json`;
    
    // Dans un service worker, on doit utiliser une méthode différente
    // Créer une data URL directement
    const dataUrl = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);
    
    // Méthode principale avec chrome.downloads
    if (chrome.downloads && chrome.downloads.download) {
      chrome.downloads.download({
        url: dataUrl,
        filename: filename,
        saveAs: true
      }).then(() => {
        console.log('Export réussi via chrome.downloads');
      }).catch((error) => {
        console.error('Erreur chrome.downloads:', error);
        // Fallback vers méthode alternative
        this.exportLogsAlternative(dataStr, filename);
      });
    } else {
      // Fallback si chrome.downloads n'est pas disponible
      this.exportLogsAlternative(dataStr, filename);
    }
  }

  exportLogsAlternative(dataStr, filename) {
    // Méthode alternative : ouvrir dans un nouvel onglet pour copier/télécharger
    const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Export API Logs</title>
        <meta charset="UTF-8">
        <style>
            body { font-family: Arial, sans-serif; margin: 20px; }
            textarea { width: 100%; height: 400px; font-family: monospace; }
            button { padding: 10px 20px; margin: 10px; background: #007bff; color: white; border: none; border-radius: 5px; cursor: pointer; }
            button:hover { background: #0056b3; }
            .download-link { display: inline-block; padding: 10px 20px; background: #28a745; color: white; text-decoration: none; border-radius: 5px; }
        </style>
    </head>
    <body>
        <h2>Export des logs API</h2>
        <p>Fichier: <strong>${filename}</strong></p>
        <p>Total des requêtes capturées: <strong>${this.logs.length}</strong></p>
        
        <h3>Option 1: Téléchargement direct</h3>
        <a href="data:application/json;charset=utf-8,${encodeURIComponent(dataStr)}" 
           download="${filename}" class="download-link">Télécharger le fichier JSON</a>
        
        <h3>Option 2: Copier le contenu</h3>
        <textarea id="jsonContent" readonly>${dataStr}</textarea>
        <br>
        <button onclick="copyToClipboard()">Copier dans le presse-papiers</button>
        
        <script>
            function copyToClipboard() {
                const textarea = document.getElementById('jsonContent');
                textarea.select();
                textarea.setSelectionRange(0, 99999);
                navigator.clipboard.writeText(textarea.value).then(() => {
                    alert('Contenu copié dans le presse-papiers!\\n\\nVous pouvez maintenant le coller dans un fichier .json');
                }).catch(err => {
                    console.error('Erreur copie:', err);
                    alert('Erreur lors de la copie. Utilisez Ctrl+C pour copier manuellement.');
                });
            }
            
            // Auto-sélection du contenu au chargement
            window.onload = function() {
                document.getElementById('jsonContent').focus();
            };
        </script>
    </body>
    </html>`;
    
    // Encoder le HTML et ouvrir dans un nouvel onglet
    const htmlUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(htmlContent);
    chrome.tabs.create({ url: htmlUrl });
  }
}

// Initialiser le logger
const apiLogger = new APILogger();
apiLogger.loadFromStorage();