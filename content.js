// content.js - Script de contenu pour intercepter les réponses JSON
(function() {
  'use strict';
  
  console.log('API Logger: Content script chargé');
  
  // Fonction pour envoyer des données au background script
  function sendToBackground(data) {
    try {
      chrome.runtime.sendMessage({
        action: 'logFromContent',
        data: data
      });
    } catch (e) {
      console.error('Erreur envoi vers background:', e);
    }
  }
  
  // Sauvegarder les fonctions originales
  const originalXHR = window.XMLHttpRequest;
  const originalFetch = window.fetch;
  
  // Override XMLHttpRequest (AngularJS utilise XHR)
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
      
      // Intercepter la réponse
      const originalOnReadyStateChange = xhr.onreadystatechange;
      xhr.onreadystatechange = function() {
        // Appeler le handler original s'il existe
        if (originalOnReadyStateChange) {
          originalOnReadyStateChange.apply(this, arguments);
        }
        
        // Capturer quand la réponse est complète
        if (xhr.readyState === 4) {
          const logData = {
            method: xhr._method,
            url: xhr._url,
            status: xhr.status,
            statusText: xhr.statusText,
            requestData: xhr._requestData,
            responseText: xhr.responseText,
            responseHeaders: xhr.getAllResponseHeaders(),
            duration: Date.now() - xhr._startTime,
            timestamp: new Date().toISOString(),
            source: 'XMLHttpRequest'
          };
          
          // Parser le JSON si possible
          try {
            if (xhr.responseText && xhr.responseText.trim().startsWith('{') || xhr.responseText.trim().startsWith('[')) {
              logData.responseJSON = JSON.parse(xhr.responseText);
            }
          } catch (e) {
            // Pas du JSON valide, on garde le texte brut
          }
          
          // Parser la requête JSON si possible
          try {
            if (xhr._requestData && typeof xhr._requestData === 'string') {
              if (xhr._requestData.trim().startsWith('{') || xhr._requestData.trim().startsWith('[')) {
                logData.requestJSON = JSON.parse(xhr._requestData);
              }
            }
          } catch (e) {
            // Pas du JSON valide
          }
          
          sendToBackground(logData);
        }
      };
      
      // Intercepter addEventListener pour 'load'
      const originalAddEventListener = xhr.addEventListener;
      xhr.addEventListener = function(event, handler, options) {
        if (event === 'load' || event === 'loadend') {
          const wrappedHandler = function(e) {
            // Capturer la réponse
            const logData = {
              method: xhr._method,
              url: xhr._url,
              status: xhr.status,
              statusText: xhr.statusText,
              requestData: xhr._requestData,
              responseText: xhr.responseText,
              responseHeaders: xhr.getAllResponseHeaders(),
              duration: Date.now() - xhr._startTime,
              timestamp: new Date().toISOString(),
              source: 'XMLHttpRequest-event'
            };
            
            // Parser le JSON si possible
            try {
              if (xhr.responseText && (xhr.responseText.trim().startsWith('{') || xhr.responseText.trim().startsWith('['))) {
                logData.responseJSON = JSON.parse(xhr.responseText);
              }
            } catch (err) {
              // Pas du JSON valide
            }
            
            // Parser la requête JSON si possible
            try {
              if (xhr._requestData && typeof xhr._requestData === 'string') {
                if (xhr._requestData.trim().startsWith('{') || xhr._requestData.trim().startsWith('[')) {
                  logData.requestJSON = JSON.parse(xhr._requestData);
                }
              }
            } catch (err) {
              // Pas du JSON valide
            }
            
            sendToBackground(logData);
            
            // Appeler le handler original
            if (handler) {
              handler.apply(this, arguments);
            }
          };
          
          return originalAddEventListener.call(this, event, wrappedHandler, options);
        } else {
          return originalAddEventListener.call(this, event, handler, options);
        }
      };
      
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
      
      // Lire le contenu de la réponse
      clonedResponse.text().then(responseText => {
        const logData = {
          method: method,
          url: url,
          status: response.status,
          statusText: response.statusText,
          requestData: body,
          responseText: responseText,
          responseHeaders: Array.from(response.headers.entries()).reduce((acc, [key, value]) => {
            acc[key] = value;
            return acc;
          }, {}),
          duration: Date.now() - startTime,
          timestamp: new Date().toISOString(),
          source: 'fetch'
        };
        
        // Parser le JSON si possible
        try {
          if (responseText && (responseText.trim().startsWith('{') || responseText.trim().startsWith('['))) {
            logData.responseJSON = JSON.parse(responseText);
          }
        } catch (e) {
          // Pas du JSON valide
        }
        
        // Parser la requête JSON si possible
        try {
          if (body && typeof body === 'string') {
            if (body.trim().startsWith('{') || body.trim().startsWith('[')) {
              logData.requestJSON = JSON.parse(body);
            }
          }
        } catch (e) {
          // Pas du JSON valide
        }
        
        sendToBackground(logData);
      }).catch(err => {
        console.warn('Impossible de lire le contenu de la réponse:', err);
        
        // Logger quand même sans le contenu
        const logData = {
          method: method,
          url: url,
          status: response.status,
          statusText: response.statusText,
          requestData: body,
          responseText: 'Erreur lecture contenu',
          duration: Date.now() - startTime,
          timestamp: new Date().toISOString(),
          source: 'fetch-error'
        };
        
        sendToBackground(logData);
      });
      
      return response;
    }).catch(error => {
      // Logger les erreurs
      const logData = {
        method: method,
        url: url,
        status: 0,
        statusText: 'Network Error',
        requestData: body,
        responseText: error.message,
        error: error.toString(),
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString(),
        source: 'fetch-error'
      };
      
      sendToBackground(logData);
      
      throw error; // Re-throw pour ne pas casser l'application
    });
  };
  
  console.log('API Logger: XMLHttpRequest et fetch interceptés');
})();