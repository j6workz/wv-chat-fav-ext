/**
 * ContextManager - Handles Chrome Extension Context Validation and Recovery
 * Prevents and handles extension context invalidation issues
 */

var WVFavs = WVFavs || {};

WVFavs.ContextManager = new (class ContextManager {
    constructor() {
        this.isValid = true;
        this.validationInterval = null;
        this.validationCallbacks = new Set();
        this.invalidationCallbacks = new Set();
        this.lastValidCheck = Date.now();
        this.debugEnabled = false; // Debug logging flag

        // Start monitoring immediately
        this.startContextMonitoring();

        // Listen for extension events
        this.setupEventListeners();
    }

    /**
     * Check if extension context is currently valid
     */
    isContextValid() {
        try {
            // Primary check - runtime ID exists
            if (!chrome.runtime?.id) {
                return false;
            }

            // Secondary check - can access extension APIs
            if (!chrome.storage) {
                return false;
            }

            return true;
        } catch (error) {
            if (this.debugEnabled) {
                console.warn('Context validation failed:', error.message);
            }
            return false;
        }
    }

    /**
     * Comprehensive context validation with storage test
     */
    async validateContextFull() {
        if (!this.isContextValid()) {
            return false;
        }

        try {
            // Test storage access
            await chrome.storage.local.get('contextTest');
            return true;
        } catch (error) {
            if (this.debugEnabled) {
                console.warn('Storage validation failed:', error.message);
            }
            return false;
        }
    }

    /**
     * Start continuous context monitoring
     */
    startContextMonitoring() {
        // Check every 5 seconds
        this.validationInterval = setInterval(() => {
            this.performContextCheck();
        }, 5000);

        // Initial check
        this.performContextCheck();
    }

    /**
     * Stop context monitoring
     */
    stopContextMonitoring() {
        if (this.validationInterval) {
            clearInterval(this.validationInterval);
            this.validationInterval = null;
        }
    }

    /**
     * Perform context validation and trigger callbacks
     */
    async performContextCheck() {
        const wasValid = this.isValid;
        const currentlyValid = await this.validateContextFull();

        this.lastValidCheck = Date.now();

        if (wasValid && !currentlyValid) {
            // Context became invalid

            // Track context invalidation error
            if (window.WVFavs?.logger) {
                window.WVFavs.logger.error('Extension context invalidated', {
                    url: window.location.href,
                    timestamp: Date.now(),
                    lastValidCheck: this.lastValidCheck
                });
            }

            this.isValid = false;
            this.triggerInvalidationCallbacks();
        } else if (!wasValid && currentlyValid) {
            // Context restored (unlikely but possible)
            if (this.debugEnabled) {
                console.log('🟢 Extension context restored!');
            }
            this.isValid = true;
            this.triggerValidationCallbacks();
        }

        this.isValid = currentlyValid;
    }

    /**
     * Setup extension event listeners
     */
    setupEventListeners() {
        // Listen for runtime disconnect
        if (chrome.runtime) {
            chrome.runtime.onConnect?.addListener((port) => {
                port.onDisconnect.addListener(() => {
                    if (chrome.runtime.lastError) {
                        if (this.debugEnabled) {
                            console.warn('Runtime disconnected:', chrome.runtime.lastError.message);
                        }
                        this.performContextCheck();
                    }
                });
            });
        }

        // Listen for page visibility changes
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                // Check context when page becomes visible
                this.performContextCheck();
            }
        });
    }

    /**
     * Add callback for when context becomes valid
     */
    onContextValid(callback) {
        this.validationCallbacks.add(callback);

        // If context is currently valid, call immediately
        if (this.isValid) {
            try {
                callback();
            } catch (error) {
                if (this.debugEnabled) {
                    console.error('Context validation callback error:', error);
                }
            }
        }
    }

    /**
     * Add callback for when context becomes invalid
     */
    onContextInvalid(callback) {
        this.invalidationCallbacks.add(callback);
    }

    /**
     * Remove callback
     */
    removeCallback(callback) {
        this.validationCallbacks.delete(callback);
        this.invalidationCallbacks.delete(callback);
    }

    /**
     * Trigger validation callbacks
     */
    triggerValidationCallbacks() {
        this.validationCallbacks.forEach(callback => {
            try {
                callback();
            } catch (error) {
                if (this.debugEnabled) {
                    console.error('Context validation callback error:', error);
                }
            }
        });
    }

    /**
     * Trigger invalidation callbacks
     */
    triggerInvalidationCallbacks() {
        this.invalidationCallbacks.forEach(callback => {
            try {
                callback();
            } catch (error) {
                if (this.debugEnabled) {
                    console.error('Context invalidation callback error:', error);
                }
            }
        });
    }

    /**
     * Safe wrapper for Chrome API calls
     */
    async safeApiCall(apiCall, fallbackValue = null) {
        if (!this.isValid) {
            if (this.debugEnabled) {
                console.warn('Skipping API call - context invalid');
            }
            return fallbackValue;
        }

        try {
            return await apiCall();
        } catch (error) {
            if (error.message?.includes('Extension context invalidated') ||
                error.message?.includes('runtime.lastError')) {
                if (this.debugEnabled) {
                    console.warn('API call failed - context invalidated:', error.message);
                }
                this.isValid = false;
                this.triggerInvalidationCallbacks();
            } else {
                if (this.debugEnabled) {
                    console.error('API call failed:', error);
                }
            }
            return fallbackValue;
        }
    }

    /**
     * Safe storage operations
     */
    async safeStorageGet(keys, defaultValue = {}) {
        return this.safeApiCall(async () => {
            return await chrome.storage.local.get(keys);
        }, defaultValue);
    }

    async safeStorageSet(data) {
        return this.safeApiCall(async () => {
            return await chrome.storage.local.set(data);
        }, false);
    }

    async safeSyncStorageGet(keys, defaultValue = {}) {
        return this.safeApiCall(async () => {
            return await chrome.storage.sync.get(keys);
        }, defaultValue);
    }

    async safeSyncStorageSet(data) {
        return this.safeApiCall(async () => {
            return await chrome.storage.sync.set(data);
        }, false);
    }

    /**
     * Get context status information
     */
    getStatus() {
        return {
            isValid: this.isValid,
            lastValidCheck: this.lastValidCheck,
            timeSinceLastCheck: Date.now() - this.lastValidCheck,
            hasRuntimeId: !!chrome.runtime?.id,
            hasStorage: !!chrome.storage,
            callbackCount: {
                validation: this.validationCallbacks.size,
                invalidation: this.invalidationCallbacks.size
            }
        };
    }

    /**
     * Force context revalidation
     */
    async revalidate() {
        await this.performContextCheck();
        return this.isValid;
    }

    /**
     * Cleanup - call before extension shutdown
     */
    destroy() {
        this.stopContextMonitoring();
        this.validationCallbacks.clear();
        this.invalidationCallbacks.clear();
    }
})();

// Add console debugging
window.wvContextManager = WVFavs.ContextManager;