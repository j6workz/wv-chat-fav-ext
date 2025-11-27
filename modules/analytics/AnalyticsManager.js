/**
 * Analytics Manager for WorkVivo Favorites Extension
 * Implements Google Analytics 4 Measurement Protocol with privacy-first approach
 */

class AnalyticsManager {
    constructor() {
        this.GA4_MEASUREMENT_ID = 'G-DPXPRJM747'; // From .env file
        this.GA4_API_SECRET = 'yeHKo5OBT0W0ZPS2QR38xw'; // From .env file
        this.GA4_ENDPOINT = `https://www.google-analytics.com/mp/collect?measurement_id=${this.GA4_MEASUREMENT_ID}&api_secret=${this.GA4_API_SECRET}`;

        this.clientId = null;
        this.sessionId = null;
        this.eventQueue = [];
        this.isInitialized = false;
        this.analyticsEnabled = false;
        this.errorReporting = true; // Aggressive error tracking by default

        // Event batching and rate limiting
        this.eventBatch = [];
        this.requestQueue = [];
        this.isProcessingQueue = false;
        this.maxEventsPerMinute = 60;
        this.requestTimestamps = [];

        // Batching configuration
        this.maxBatchSize = 20; // GA4 supports up to 25 events per request
        this.batchTimeoutMs = 2000; // Send batch after 2 seconds
        this.batchTimer = null;

        // Privacy settings
        this.shareUsageData = false;
        this.debugLogging = false;

        this.init();
    }

    /**
     * Initialize Analytics Manager
     */
    async init() {
        try {
            // Prevent multiple initializations
            if (this.isInitialized) {
                return;
            }

            await this.loadSettings();
            await this.generateClientId();
            await this.generateSessionId();
            this.isInitialized = true;

            if (this.debugLogging) {
                console.log('🔍 AnalyticsManager initialized', {
                    analyticsEnabled: this.analyticsEnabled,
                    errorReporting: this.errorReporting,
                    clientId: this.clientId?.substring(0, 8) + '...'
                });
            }

            // Initialization event removed - extension version available in all events

            // Listen for settings changes
            this.setupStorageListener();
        } catch (error) {
            // AnalyticsManager initialization failed - handled silently to avoid extension errors
        }
    }

    /**
     * Set up listener for settings changes
     */
    setupStorageListener() {
        chrome.storage.onChanged.addListener((changes, areaName) => {
            if (areaName === 'sync' && changes.workvivoSettings) {
                const newSettings = changes.workvivoSettings.newValue || {};

                // Update analytics settings in real-time
                if (newSettings.analyticsEnabled !== undefined) {
                    this.analyticsEnabled = newSettings.analyticsEnabled;
                    if (this.debugLogging) {
                        console.log('🔍 Analytics setting changed:', this.analyticsEnabled);
                    }
                }

                if (newSettings.shareUsageData !== undefined) {
                    this.shareUsageData = newSettings.shareUsageData;
                }

                if (newSettings.errorReporting !== undefined) {
                    this.errorReporting = newSettings.errorReporting;
                }

                if (newSettings.debugLogging !== undefined) {
                    this.debugLogging = newSettings.debugLogging;
                }
            }
        });
    }

    /**
     * Load settings from chrome.storage
     */
    async loadSettings() {
        return new Promise((resolve) => {
            chrome.storage.sync.get(['workvivoSettings'], (result) => {
                const settings = result.workvivoSettings || {};
                this.analyticsEnabled = settings.analyticsEnabled || false; // Opt-in by default
                this.shareUsageData = settings.shareUsageData || false; // Opt-in by default
                this.errorReporting = settings.errorReporting !== false; // Aggressive error tracking
                this.debugLogging = settings.debugLogging || false;
                resolve();
            });
        });
    }

    /**
     * Generate persistent client ID
     */
    async generateClientId() {
        return new Promise((resolve) => {
            chrome.storage.local.get(['analytics_client_id'], (result) => {
                if (result.analytics_client_id) {
                    this.clientId = result.analytics_client_id;
                } else {
                    this.clientId = this.generateUUID();
                    chrome.storage.local.set({ analytics_client_id: this.clientId });
                }
                resolve();
            });
        });
    }

    /**
     * Generate session ID (renewed on each init)
     */
    async generateSessionId() {
        this.sessionId = Date.now().toString();
        return this.sessionId;
    }

    /**
     * Generate UUID for client ID
     */
    generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    /**
     * Get extension version from manifest
     */
    getExtensionVersion() {
        return chrome.runtime.getManifest()?.version || 'unknown';
    }

    /**
     * Track event with privacy controls
     */
    async trackEvent(eventName, parameters = {}, forceImmediate = false) {
        if (!this.isInitialized) {
            if (this.debugLogging) {
                console.log('🔍 Analytics not initialized, queueing event:', eventName);
            }
            this.eventQueue.push({ eventName, parameters, forceImmediate });
            return;
        }

        // Check if we should send this event based on privacy settings
        if (!this.shouldSendEvent(eventName)) {
            if (this.debugLogging) {
                console.log('🔍 Event blocked by privacy settings:', eventName);
            }
            return;
        }

        try {
            // Enhance parameters with context
            const enhancedParameters = await this.enhanceEventParameters(eventName, parameters);

            // Create base GA4 event payload
            // Device/geo data will be added centrally by background script
            const eventPayload = {
                client_id: this.clientId,
                events: [{
                    name: eventName,
                    params: {
                        session_id: this.sessionId,
                        engagement_time_msec: 100,
                        ...enhancedParameters
                    }
                }]
            };

            if (this.debugLogging) {
                console.log('🔍 Tracking event:', eventName, {
                    params: enhancedParameters
                });
            }

            // Send immediately for errors or if forced, otherwise add to batch
            if (forceImmediate || this.isErrorEvent(eventName)) {
                await this.sendEventImmediate(eventPayload);
            } else {
                // Add event to batch (background script will add device/geo)
                this.addToBatch(eventPayload.events[0]);
            }

        } catch (error) {
            // Error tracking event - handled silently
        }
    }

    /**
     * Determine if event should be sent based on privacy settings
     */
    shouldSendEvent(eventName) {
        // Always send error events for debugging (aggressive error tracking)
        if (this.errorReporting && this.isErrorEvent(eventName)) {
            return true;
        }

        // Send other events only if analytics enabled
        return this.analyticsEnabled;
    }

    /**
     * Check if event is an error event
     */
    isErrorEvent(eventName) {
        const errorEvents = [
            'chrome_api_error',
            'indexeddb_error',
            'network_request_failed',
            'context_invalidation_error',
            'settings_save_failed',
            'search_widget_failed_to_open',
            'pin_operation_failed',
            'database_corruption_detected',
            'javascript_error',
            'unhandled_promise_rejection'
        ];
        return errorEvents.includes(eventName);
    }

    /**
     * Scrub PII from parameters before sending to analytics
     */
    scrubPII(parameters) {
        if (!parameters || typeof parameters !== 'object') {
            return parameters;
        }

        const scrubbed = {};
        const piiKeys = ['name', 'username', 'user_name', 'email', 'chat_name', 'chatname'];

        for (const [key, value] of Object.entries(parameters)) {
            const lowerKey = key.toLowerCase();

            // Skip PII keys entirely
            if (piiKeys.some(piiKey => lowerKey.includes(piiKey))) {
                continue; // Don't include this key at all
            }

            // Redact channel URLs (they might contain user IDs)
            if (lowerKey.includes('channel') && typeof value === 'string' && value.startsWith('sendbird_')) {
                scrubbed[key] = 'redacted';
                continue;
            }

            // Redact user IDs
            if (lowerKey.includes('userid') || lowerKey === 'id') {
                scrubbed[key] = 'redacted';
                continue;
            }

            // Special handling for error_context (JSON string)
            if (key === 'error_context' && typeof value === 'string') {
                try {
                    const parsed = JSON.parse(value);
                    const scrubbedContext = this.scrubPII(parsed);
                    scrubbed[key] = JSON.stringify(scrubbedContext);
                } catch {
                    scrubbed[key] = value; // If parsing fails, keep original
                }
                continue;
            }

            // Recursively scrub nested objects
            if (value && typeof value === 'object' && !Array.isArray(value)) {
                scrubbed[key] = this.scrubPII(value);
            } else {
                scrubbed[key] = value;
            }
        }

        return scrubbed;
    }


    /**
     * Enhance event parameters with context information
     */
    async enhanceEventParameters(eventName, parameters) {
        // First scrub PII from incoming parameters
        const scrubbed = this.scrubPII(parameters);
        const enhanced = { ...scrubbed };

        // Add extension context
        enhanced.extension_version = this.getExtensionVersion();
        enhanced.event_timestamp = Date.now();

        // Add current domain for usage tracking
        try {
            enhanced.current_domain = window.location.hostname;
        } catch (error) {
            // Ignore errors getting domain
        }

        return enhanced;
    }

    /**
     * Add event to batch for efficient sending
     * Device/geo will be added centrally by background script
     */
    addToBatch(event) {
        // Move timestamp inside params object for proper GA4 structure
        const eventWithTimestamp = {
            ...event,
            params: {
                ...event.params,
                timestamp: Date.now()
            }
        };
        this.eventBatch.push(eventWithTimestamp);

        // If batch is full, send immediately
        if (this.eventBatch.length >= this.maxBatchSize) {
            this.sendBatch();
            return;
        }

        // Reset timer for new batch
        if (this.batchTimer) {
            clearTimeout(this.batchTimer);
        }

        // Set timer to send batch after timeout
        this.batchTimer = setTimeout(() => {
            if (this.eventBatch.length > 0) {
                this.sendBatch();
            }
        }, this.batchTimeoutMs);
    }

    /**
     * Send current batch of events to GA4
     * Device/geo will be added centrally by background script
     */
    async sendBatch() {
        if (this.eventBatch.length === 0) {
            return;
        }

        // Clear the batch timer
        if (this.batchTimer) {
            clearTimeout(this.batchTimer);
            this.batchTimer = null;
        }

        // Create batch payload with all events
        // Background script will add device/geo data
        const batchPayload = {
            client_id: this.clientId,
            events: [...this.eventBatch] // Copy all events in batch
        };

        // Clear the batch
        const batchSize = this.eventBatch.length;
        this.eventBatch = [];

        if (this.debugLogging) {
            console.log(`📦 Sending batch of ${batchSize} events:`, batchPayload.events.map(e => e.name));
        }

        try {
            await this.sendEventImmediate(batchPayload);
        } catch (error) {
            if (this.debugLogging) {
                console.error('❌ Failed to send event batch:', error);
            }
            // Don't re-queue failed batch to avoid infinite loops
        }
    }

    /**
     * Queue event for individual processing (fallback)
     */
    queueEvent(eventPayload) {
        this.requestQueue.push({
            payload: eventPayload,
            timestamp: Date.now()
        });

        // Process queue if not already processing
        if (!this.isProcessingQueue) {
            this.processQueue();
        }
    }

    /**
     * Process event queue with rate limiting
     */
    async processQueue() {
        if (this.isProcessingQueue || this.requestQueue.length === 0) {
            return;
        }

        this.isProcessingQueue = true;

        try {
            while (this.requestQueue.length > 0) {
                // Check rate limiting
                if (!this.canSendRequest()) {
                    // Wait before trying again
                    await this.sleep(1000);
                    continue;
                }

                const request = this.requestQueue.shift();
                await this.sendEventImmediate(request.payload);

                // Small delay between requests
                await this.sleep(100);
            }
        } catch (error) {
            console.error('❌ Error processing event queue:', error);
        } finally {
            this.isProcessingQueue = false;
        }
    }

    /**
     * Check if we can send request (rate limiting)
     */
    canSendRequest() {
        const now = Date.now();
        const oneMinuteAgo = now - 60000;

        // Remove timestamps older than 1 minute
        this.requestTimestamps = this.requestTimestamps.filter(timestamp => timestamp > oneMinuteAgo);

        // Check if we're under the rate limit
        return this.requestTimestamps.length < this.maxEventsPerMinute;
    }

    /**
     * Send event immediately to GA4 via background script
     */
    async sendEventImmediate(eventPayload) {
        try {
            if (this.debugLogging) {
                console.log('📤 Sending to background script:', {
                    eventName: eventPayload.events[0].name,
                    payload: eventPayload
                });
            }

            // Send to background script to avoid CORS issues
            const response = await chrome.runtime.sendMessage({
                action: 'sendGA4Event',
                eventData: eventPayload
            });

            if (response && response.success) {
                if (this.debugLogging) {
                    console.log('✅ Event sent via background script:', eventPayload.events[0].name);
                }
                // Record request timestamp for local rate limiting
                this.requestTimestamps.push(Date.now());
            } else {
                const errorMsg = response?.error || 'Unknown error from background script';
                // Background script GA4 error - handled silently
                throw new Error(errorMsg);
            }

        } catch (error) {
            // Check if this is the "message channel closed" error (service worker inactive)
            const isChannelClosedError = error.message?.includes('message channel closed') ||
                                        error.message?.includes('Receiving end does not exist');

            if (isChannelClosedError) {
                // Service worker became inactive - this is expected, fail silently
                if (this.debugLogging) {
                    console.log('⚠️ Background script inactive, event skipped:', eventPayload.events[0].name);
                }
                return; // Don't re-throw
            }

            // For other errors, re-throw
            throw error;
        }
    }

    /**
     * Track error with immediate sending
     */
    trackError(errorType, errorMessage, errorContext = {}) {
        this.trackEvent('system_error', {
            error_type: errorType,
            error_message: errorMessage,
            error_context: JSON.stringify(errorContext),
            stack_trace: errorContext.stack || 'unknown'
        }, true); // Force immediate sending
    }

    /**
     * Track setting change with actual value
     */
    trackSettingChange(settingName, oldValue, newValue) {
        this.trackEvent('setting_changed', {
            setting_name: settingName,
            old_value: String(oldValue),
            new_value: String(newValue),
            value_type: typeof newValue
        });
    }

    /**
     * Update analytics preferences
     */
    async updatePreferences(newSettings) {
        const oldSettings = {
            analyticsEnabled: this.analyticsEnabled,
            shareUsageData: this.shareUsageData,
            errorReporting: this.errorReporting
        };

        // Update internal settings
        this.analyticsEnabled = newSettings.analyticsEnabled !== undefined ? newSettings.analyticsEnabled : this.analyticsEnabled;
        this.shareUsageData = newSettings.shareUsageData !== undefined ? newSettings.shareUsageData : this.shareUsageData;
        this.errorReporting = newSettings.errorReporting !== undefined ? newSettings.errorReporting : this.errorReporting;

        // Track preference changes
        for (const [key, newValue] of Object.entries(newSettings)) {
            if (oldSettings[key] !== newValue) {
                this.trackSettingChange(`analytics_${key}`, oldSettings[key], newValue);
            }
        }

        if (this.debugLogging) {
            console.log('🔍 Analytics preferences updated:', {
                analyticsEnabled: this.analyticsEnabled,
                shareUsageData: this.shareUsageData,
                errorReporting: this.errorReporting
            });
        }
    }

    /**
     * Get analytics statistics
     */
    getStats() {
        return {
            isInitialized: this.isInitialized,
            analyticsEnabled: this.analyticsEnabled,
            errorReporting: this.errorReporting,
            shareUsageData: this.shareUsageData,
            queueLength: this.requestQueue.length,
            batchSize: this.eventBatch.length,
            maxBatchSize: this.maxBatchSize,
            batchTimeoutMs: this.batchTimeoutMs,
            hasPendingBatch: this.batchTimer !== null,
            requestsLastMinute: this.requestTimestamps.filter(t => t > Date.now() - 60000).length,
            clientId: this.clientId?.substring(0, 8) + '...',
            sessionId: this.sessionId
        };
    }

    /**
     * Utility sleep function
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Process any queued events from before initialization
     */
    async processQueuedEvents() {
        while (this.eventQueue.length > 0) {
            const { eventName, parameters, forceImmediate } = this.eventQueue.shift();
            await this.trackEvent(eventName, parameters, forceImmediate);
        }
    }

    /**
     * Cleanup method for when AnalyticsManager is destroyed
     */
    cleanup() {
        // Send any pending batch before cleanup
        if (this.eventBatch.length > 0) {
            this.sendBatch();
        }

        // Clear batch timer
        if (this.batchTimer) {
            clearTimeout(this.batchTimer);
            this.batchTimer = null;
        }

        // Clear arrays
        this.eventBatch = [];
        this.requestQueue = [];
        this.eventQueue = [];

        if (this.debugLogging) {
            console.log('🧹 AnalyticsManager cleanup completed');
        }
    }
}

// Make AnalyticsManager available globally
if (typeof window !== 'undefined') {
    window.WVFavs = window.WVFavs || {};
    window.WVFavs.AnalyticsManager = AnalyticsManager;
}

// Export for Node.js environments (testing)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AnalyticsManager;
}