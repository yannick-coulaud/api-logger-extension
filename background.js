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
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const filename = `api-logs-${new Date().toISOString().split('T')[0]}.json`;
    
    chrome.downloads.download({
      url: url,
      filename: filename,
      saveAs: true
    });
  }
}

// Initialiser le logger
const apiLogger = new APILogger();
apiLogger.loadFromStorage();