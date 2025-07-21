// content.js - Script de contenu (optionnel pour fonctionnalités avancées)

// Ce fichier peut être utilisé pour des fonctionnalités avancées comme :
// - Intercepter les appels XMLHttpRequest/fetch directement dans la page
// - Ajouter des marqueurs visuels sur la page
// - Communiquer avec le background script

(function() {
  'use strict';
  
  // Intercepter XMLHttpRequest si nécessaire
  const originalXHR = window.XMLHttpRequest;
  const originalFetch = window.fetch;
  
  // Fonction pour envoyer des données au background script
  function sendToBackground(data) {
    chrome.runtime.sendMessage({
      action: 'logFromContent',
      data: data
    });
  }
  
  // Override XMLHttpRequest (AngularJS utilise souvent XHR)
  window.XMLHttpRequest = function() {
    const xhr = new originalXHR();
    
    // Intercepter la méthode open
    const originalOpen = xhr.open;
    xhr.open = function(method, url, async, user, password) {
      xhr._method = method;
      xhr._url = url;
      xhr._startTime = Date.now();
      return originalOpen.apply(this, arguments);
    };
    
    // Intercepter la méthode send
    const originalSend = xhr.send;
    xhr.send = function(data) {
      xhr._requestData = data;
      
      // Écouter les changements d'état
      xhr.addEventListener('loadend', function() {
        const logData = {
          method: xhr._method,
          url: xhr._url,
          status: xhr.status,
          responseText: xhr.responseText,
          requestData: xhr._requestData,
          duration: Date.now() - xhr._startTime,
          timestamp: new Date().toISOString(),
          source: 'XMLHttpRequest'
        };
        
        sendToBackground(logData);
      });
      
      return originalSend.apply(this, arguments);
    };
    
    return xhr;
  };
  
  // Override fetch (pour les applications plus modernes)
  window.fetch = function(input, init) {
    const startTime = Date.now();
    const url = typeof input === 'string' ? input : input.url;
    const method = (init && init.method) || 'GET';
    const body = (init && init.body) || null;
    
    return originalFetch.apply(this, arguments).then(response => {
      // Cloner la réponse pour pouvoir la lire
      const clonedResponse = response.clone();
      
      clonedResponse.text().then(responseText => {
        const logData = {
          method: method,
          url: url,
          status: response.status,
          responseText: responseText,
          requestData: body,
          duration: Date.now() - startTime,
          timestamp: new Date().toISOString(),
          source: 'fetch'
        };
        
        sendToBackground(logData);
      }).catch(err => {
        console.warn('Could not read response text:', err);
      });
      
      return response;
    });
  };
  
  console.log('API Logger content script loaded');
})();