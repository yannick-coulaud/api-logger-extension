// popup.js - Interface utilisateur de l'extension
class PopupController {
  constructor() {
    this.isLogging = false;
    this.logs = [];
    this.initElements();
    this.initEventListeners();
    this.updateUI();
    this.refreshStats();
  }

  initElements() {
    this.elements = {
      status: document.getElementById('status'),
      logCount: document.getElementById('logCount'),
      startBtn: document.getElementById('startBtn'),
      stopBtn: document.getElementById('stopBtn'),
      exportBtn: document.getElementById('exportBtn'),
      clearBtn: document.getElementById('clearBtn'),
      urlFilter: document.getElementById('urlFilter'),
      totalRequests: document.getElementById('totalRequests'),
      getRequests: document.getElementById('getRequests'),
      postRequests: document.getElementById('postRequests'),
      errorRequests: document.getElementById('errorRequests'),
      preview: document.getElementById('preview'),
      previewContent: document.getElementById('previewContent'),
      togglePreview: document.getElementById('togglePreview')
    };
  }

  initEventListeners() {
    this.elements.startBtn.addEventListener('click', () => this.startLogging());
    this.elements.stopBtn.addEventListener('click', () => this.stopLogging());
    this.elements.exportBtn.addEventListener('click', () => this.exportLogs());
    this.elements.clearBtn.addEventListener('click', () => this.clearLogs());
    this.elements.togglePreview.addEventListener('click', () => this.togglePreview());
    
    // Sauvegarder les filtres quand ils changent
    this.elements.urlFilter.addEventListener('input', () => this.updateFilters());
    
    // Checkbox pour les méthodes HTTP
    ['GET', 'POST', 'PUT', 'DELETE'].forEach(method => {
      const checkbox = document.getElementById(`method${method}`);
      if (checkbox) {
        checkbox.addEventListener('change', () => this.updateFilters());
      }
    });

    // Rafraîchir les stats périodiquement
    setInterval(() => this.refreshStats(), 2000);
  }

  async startLogging() {
    const filters = this.getFilters();
    
    const response = await this.sendMessage({
      action: 'startLogging',
      filters: filters
    });
    
    if (response.success) {
      this.isLogging = true;
      this.updateUI();
      this.showNotification('Logging demarre !', 'success');
    }
  }

  async stopLogging() {
    const response = await this.sendMessage({ action: 'stopLogging' });
    
    if (response.success) {
      this.isLogging = false;
      this.updateUI();
      this.showNotification('Logging arrete !', 'info');
    }
  }

  async exportLogs() {
    const response = await this.sendMessage({ action: 'exportLogs' });
    
    if (response.success) {
      this.showNotification('Export en cours...', 'success');
    }
  }

  async clearLogs() {
    if (confirm('Etes-vous sur de vouloir supprimer tous les logs ?')) {
      const response = await this.sendMessage({ action: 'clearLogs' });
      
      if (response.success) {
        this.logs = [];
        this.updateUI();
        this.refreshStats();
        this.showNotification('Logs supprimes !', 'info');
      }
    }
  }

  getFilters() {
    const urlFilterText = this.elements.urlFilter.value.trim();
    const urls = urlFilterText ? urlFilterText.split('\n').filter(url => url.trim()) : [];
    
    const methods = [];
    ['GET', 'POST', 'PUT', 'DELETE'].forEach(method => {
      const checkbox = document.getElementById(`method${method}`);
      if (checkbox && checkbox.checked) {
        methods.push(method);
      }
    });

    return { urls, methods };
  }

  async updateFilters() {
    const filters = this.getFilters();
    await this.sendMessage({
      action: 'setFilters',
      filters: filters
    });
  }

  updateUI() {
    // Mettre à jour le statut
    if (this.isLogging) {
      this.elements.status.className = 'status logging';
      this.elements.status.innerHTML = '<span>Logging actif</span><span id="logCount">' + this.logs.length + ' requetes</span>';
    } else {
      this.elements.status.className = 'status stopped';
      this.elements.status.innerHTML = '<span>Logging arrete</span><span id="logCount">' + this.logs.length + ' requetes</span>';
    }

    // Activer/désactiver les boutons
    this.elements.startBtn.disabled = this.isLogging;
    this.elements.stopBtn.disabled = !this.isLogging;
  }

  async refreshStats() {
    const response = await this.sendMessage({ action: 'getLogs' });
    
    if (response.logs) {
      this.logs = response.logs;
      
      // Calculer les statistiques
      const stats = {
        total: this.logs.length,
        get: this.logs.filter(log => log.method === 'GET').length,
        post: this.logs.filter(log => log.method === 'POST').length,
        errors: this.logs.filter(log => log.error || (log.statusCode && log.statusCode >= 400)).length
      };

      // Mettre à jour l'affichage
      this.elements.totalRequests.textContent = stats.total;
      this.elements.getRequests.textContent = stats.get;
      this.elements.postRequests.textContent = stats.post;
      this.elements.errorRequests.textContent = stats.errors;
      
      // Mettre à jour le compteur dans le status
      const logCountElement = document.getElementById('logCount');
      if (logCountElement) {
        logCountElement.textContent = stats.total + ' requetes';
      }

      // Mettre à jour l'aperçu si visible
      if (!this.elements.preview.style.display || this.elements.preview.style.display !== 'none') {
        this.updatePreview();
      }
    }
  }

  updatePreview() {
    const recentLogs = this.logs.slice(-10); // 10 derniers logs
    
    this.elements.previewContent.innerHTML = recentLogs
      .map(log => {
        const isError = log.error || (log.statusCode && log.statusCode >= 400);
        const statusText = log.statusCode ? `(${log.statusCode})` : (log.error ? '(Error)' : '');
        
        return `
          <div class="log-entry ${isError ? 'error' : ''}">
            <strong>${log.method}</strong> ${this.truncateUrl(log.url)} ${statusText}
            <br><small>${new Date(log.timestamp).toLocaleTimeString()}</small>
          </div>
        `;
      })
      .join('');
  }

  truncateUrl(url, maxLength = 50) {
    if (url.length <= maxLength) return url;
    return url.substring(0, maxLength - 3) + '...';
  }

  togglePreview() {
    const isVisible = this.elements.preview.style.display !== 'none';
    
    if (isVisible) {
      this.elements.preview.style.display = 'none';
      this.elements.togglePreview.textContent = 'Voir apercu';
    } else {
      this.elements.preview.style.display = 'block';
      this.elements.togglePreview.textContent = 'Masquer apercu';
      this.updatePreview();
    }
  }

  showNotification(message, type = 'info') {
    // Simple notification dans la console pour l'instant
    // Vous pouvez améliorer ceci avec une vraie notification
    console.log(`[${type.toUpperCase()}] ${message}`);
  }

  async sendMessage(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, resolve);
    });
  }
}

// Initialiser le contrôleur quand la page est chargée
document.addEventListener('DOMContentLoaded', () => {
  new PopupController();
});