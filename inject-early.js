/**
 * Early Injector - Runs at document_start
 * Injects fetch and websocket interceptors into page context before WorkVivo loads
 */

(function() {
    'use strict';

    // Inject the WebSocket interceptor first (needs to be earliest)
    const wsScript = document.createElement('script');
    wsScript.src = chrome.runtime.getURL('inject-websocket-interceptor.js');
    wsScript.onload = function() {
        this.remove();
    };
    (document.head || document.documentElement).appendChild(wsScript);

    // Inject the fetch interceptor script into the page context
    const fetchScript = document.createElement('script');
    fetchScript.src = chrome.runtime.getURL('inject-fetch-interceptor.js');
    fetchScript.onload = function() {
        this.remove();
    };
    (document.head || document.documentElement).appendChild(fetchScript);

    // Inject the XHR interceptor script
    const xhrScript = document.createElement('script');
    xhrScript.src = chrome.runtime.getURL('inject-xhr-interceptor.js');
    xhrScript.onload = function() {
        this.remove();
    };
    (document.head || document.documentElement).appendChild(xhrScript);
})();
