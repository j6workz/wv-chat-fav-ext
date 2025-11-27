/**
 * XHR Interceptor - Log all XMLHttpRequest calls to WorkVivo APIs
 */

(function() {
    'use strict';

    // Debug logging flag - controlled by extension settings
    let WV_FAV_DEBUG = false;

    // Helper for debug logging
    const debugLog = (...args) => {
        if (WV_FAV_DEBUG) {
            console.log(...args);
        }
    };

    // Listen for debug settings updates from content script
    document.addEventListener('wv-fav-debug-settings', (event) => {
        WV_FAV_DEBUG = event.detail.debugLogging || false;
    });

    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
        this._url = url;
        this._method = method;

        // Log WorkVivo API calls
        if (url && (url.includes('allstars.workvivo.com') || url.includes('workvivo.com/api'))) {
            debugLog('🔍 === WORKVIVO XHR CALL ===');
            debugLog('🔍 Method:', method);
            debugLog('🔍 URL:', url);
        }

        return originalOpen.apply(this, [method, url, ...rest]);
    };

    XMLHttpRequest.prototype.send = function(body) {
        const url = this._url;
        const method = this._method;

        // Intercept WorkVivo API responses
        if (url && (url.includes('allstars.workvivo.com') || url.includes('workvivo.com/api'))) {
            this.addEventListener('load', function() {
                try {
                    const response = JSON.parse(this.responseText);
                    debugLog('🔍 === WORKVIVO XHR RESPONSE ===');
                    debugLog('🔍 URL:', url);
                    debugLog('🔍 Status:', this.status);
                    debugLog('🔍 Response keys:', Object.keys(response));
                    debugLog('🔍 Response data:', response);

                    // Log result count
                    if (response.results) {
                        debugLog('🔍 Results count:', response.results.length);
                    }
                    if (response.data && Array.isArray(response.data)) {
                        debugLog('🔍 Data array length:', response.data.length);
                    }
                } catch (err) {
                    debugLog('🔍 XHR Response is not JSON');
                }
            });
        }

        return originalSend.apply(this, arguments);
    };

    debugLog('🔍 XHR interceptor loaded - monitoring WorkVivo API calls');
})();
