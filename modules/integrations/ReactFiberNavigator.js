/**
 * ReactFiberNavigator - Primary navigation method using React Fiber internals
 *
 * This module provides programmatic channel navigation by accessing React's
 * internal Fiber tree and using useState dispatch functions.
 *
 * Reliability Features:
 * - Dynamic depth search (handles varying Fiber tree structures)
 * - Multiple fallback patterns for hook detection
 * - Health check system to detect Fiber structure changes
 * - Graceful degradation to secondary method
 *
 * @version 1.0.0
 */

var WVFavs = WVFavs || {};

WVFavs.ReactFiberNavigator = class ReactFiberNavigator {
    constructor(app) {
        this.app = app;
        this.logger = app?.logger || { debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, analytics: () => {} };

        // State management
        this.cachedHooks = null; // Session cache for hooks
        this.cachedSdk = null; // Session cache for SendBird SDK
        this.lastHealthCheck = null;
        this.healthStatus = 'unknown'; // 'healthy', 'degraded', 'failed'
        this.consecutiveFailures = 0;
        this.fallbackReason = null;

        // Configuration
        this.config = {
            maxDepth: 30, // Maximum depth to search in Fiber tree
            maxConsecutiveFailures: 3, // Trigger permanent fallback after this many failures
            healthCheckInterval: 5 * 60 * 1000, // 5 minutes
            hookSearchRange: [8, 12], // Hooks to check for dispatch functions
            sdkSearchRange: [14, 18] // Depths to check for SendBird SDK
        };

        this.logger.info('🧭 ReactFiberNavigator initialized');
    }

    /**
     * Initialize the navigator
     */
    async init() {
        try {
            this.logger.info('🧭 Starting ReactFiberNavigator initialization...');

            // Delay initial health check to allow React to attach Fiber keys to DOM
            // React attaches Fiber keys during hydration/render, which happens after DOM ready
            // Using progressive retry strategy for reliability
            setTimeout(async () => {
                const success = await this.healthCheckWithRetry(3, 2000);
                this.logger.debug('🏥 Delayed health check completed:', {
                    status: this.healthStatus,
                    success: success
                });
            }, 3000); // Wait 3 seconds for React to finish rendering (increased from 2s)

            // Setup periodic health checks
            this.setupHealthMonitoring();

            this.logger.info('✅ ReactFiberNavigator initialized successfully');

            // Analytics disabled per user request
            // React Fiber navigator initialization tracking removed
        } catch (error) {
            this.logger.error('❌ ReactFiberNavigator initialization failed', { error: error.message, stack: error.stack });
            this.healthStatus = 'failed';
        }
    }

    /**
     * Health check with retry logic
     * @param {number} maxRetries - Maximum number of retries
     * @param {number} retryDelay - Delay between retries in ms
     */
    async healthCheckWithRetry(maxRetries = 3, retryDelay = 2000) {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            this.logger.debug(`🏥 Health check attempt ${attempt}/${maxRetries}...`);

            const success = await this.healthCheck();

            if (success) {
                this.logger.info(`✅ Health check succeeded on attempt ${attempt}`);
                return true;
            }

            if (attempt < maxRetries) {
                this.logger.debug(`⏳ Health check failed, retrying in ${retryDelay}ms...`);
                await new Promise(resolve => setTimeout(resolve, retryDelay));
            }
        }

        this.logger.warn(`⚠️  Health check failed after ${maxRetries} attempts`);
        return false;
    }

    /**
     * Setup periodic health monitoring
     */
    setupHealthMonitoring() {
        setInterval(async () => {
            await this.healthCheck();
        }, this.config.healthCheckInterval);

        this.logger.debug('🏥 Health monitoring setup complete');
    }

    /**
     * Perform health check on React Fiber accessibility
     */
    async healthCheck() {
        try {
            this.logger.debug('🏥 Running health check...');

            // Try to find an active button to access Fiber tree
            const activeBtn = this.findActiveButton();
            if (!activeBtn) {
                this.healthStatus = 'degraded';
                this.logger.debug('⚠️ Health check: No active button found');
                return false;
            }

            // Try to find React Fiber key
            const fiberKey = this.findReactFiberKey(activeBtn);
            if (!fiberKey) {
                this.healthStatus = 'failed';
                this.logger.warn('❌ Health check: React Fiber key not found');
                return false;
            }

            // Try to traverse tree and find hooks
            const fiber = activeBtn[fiberKey];
            const { sdk, dispatchChannelUrl, dispatchChannel } = await this.findReactHooks(fiber);

            if (sdk && dispatchChannelUrl && dispatchChannel) {
                this.healthStatus = 'healthy';
                this.consecutiveFailures = 0;
                this.lastHealthCheck = Date.now();
                this.logger.debug('✅ Health check: React Fiber navigation is healthy');
                return true;
            } else {
                this.healthStatus = 'degraded';
                this.logger.warn('⚠️ Health check: Some React hooks not found', {
                    hasSdk: !!sdk,
                    hasDispatchUrl: !!dispatchChannelUrl,
                    hasDispatchChannel: !!dispatchChannel
                });
                return false;
            }
        } catch (error) {
            this.healthStatus = 'failed';
            this.logger.error('❌ Health check failed:', error);
            return false;
        }
    }

    /**
     * Find an active button to access React Fiber tree
     * IMPORTANT: Only returns buttons that have React Fiber keys attached
     */
    findActiveButton() {
        // Helper function to check if button has React Fiber key
        const hasReactFiber = (btn) => {
            const keys = Object.keys(btn);
            return keys.some(k => k.startsWith('__reactFiber'));
        };

        const allButtons = Array.from(document.querySelectorAll('button'));
        const totalButtons = allButtons.length;

        // Strategy 1: Find button with tw-bg-primary class (active channel) that has Fiber
        const activeButtons = allButtons.filter(btn =>
            btn.className.includes('tw-bg-primary') && hasReactFiber(btn)
        );

        if (activeButtons.length > 0) {
            this.logger.debug('🔍 Found active button with tw-bg-primary and React Fiber');
            return activeButtons[0];
        }

        // Strategy 2: Find any button in sidebar that has Fiber
        const sidebarButtons = Array.from(document.querySelectorAll('[data-testid="sidebar"] button, [class*="sidebar"] button'))
            .filter(btn => hasReactFiber(btn));

        if (sidebarButtons.length > 0) {
            this.logger.debug('🔍 Found sidebar button with React Fiber');
            return sidebarButtons[0];
        }

        // Strategy 3: Find ANY button on page that has Fiber (last resort)
        const buttonWithFiber = allButtons.find(btn => hasReactFiber(btn));

        if (buttonWithFiber) {
            this.logger.debug('🔍 Found any button with React Fiber');
            return buttonWithFiber;
        }

        // No buttons with Fiber found - provide detailed diagnostics
        const buttonsWithFiberCount = allButtons.filter(btn => hasReactFiber(btn)).length;
        this.logger.warn(`⚠️  No buttons with React Fiber found! Total buttons: ${totalButtons}, Buttons with Fiber: ${buttonsWithFiberCount}`);

        // Log first few button keys for debugging
        if (totalButtons > 0 && totalButtons < 50) {
            const sampleKeys = Object.keys(allButtons[0]);
            this.logger.debug('Sample button keys:', sampleKeys.slice(0, 10));
        }

        return null;
    }

    /**
     * Find React Fiber key dynamically (handles __reactFiber$[random])
     */
    findReactFiberKey(element) {
        // Validate element first
        if (!element) {
            this.logger.warn('⚠️ findReactFiberKey called with null/undefined element');
            return null;
        }

        // Try to get keys - use for...in loop as fallback since Object.keys might not work on all elements
        let keys = [];
        try {
            keys = Object.keys(element);
        } catch (e) {
            this.logger.warn('⚠️ Object.keys() failed on element, trying for...in loop:', e.message);
            for (let key in element) {
                if (element.hasOwnProperty(key)) {
                    keys.push(key);
                }
            }
        }

        // DEBUG: Log element info and keys
        this.logger.debug('🔍 Element info:', {
            isElement: element instanceof Element,
            tagName: element.tagName,
            nodeType: element.nodeType,
            keysCount: keys.length,
            firstKeys: keys.slice(0, 10)
        });

        // Try multiple patterns (React 18, React 19, etc.)
        const patterns = [
            '__reactFiber$',
            '__reactFiber',
            '_reactFiber',
            '__react',
            '_react'
        ];

        for (const pattern of patterns) {
            const fiberKey = keys.find(k => k.startsWith(pattern));
            if (fiberKey) {
                this.logger.debug(`✅ Found React Fiber key with pattern "${pattern}": ${fiberKey}`);
                return fiberKey;
            }
        }

        // Not found - log all React-related keys for debugging
        const reactKeys = keys.filter(k => k.toLowerCase().includes('react'));
        if (reactKeys.length > 0) {
            this.logger.warn('⚠️ No standard Fiber key found, but found React-related keys:', reactKeys);
        } else {
            this.logger.warn('⚠️ No React keys found at all on element. All keys:', keys);
        }

        return null;
    }

    /**
     * Find React Fiber props key dynamically
     */
    findReactPropsKey(element) {
        const keys = Object.keys(element);
        const propsKey = keys.find(k => k.startsWith('__reactProps$'));
        return propsKey;
    }

    /**
     * Traverse React Fiber tree to find hooks and SDK
     * Uses dynamic depth search to handle varying tree structures
     */
    async findReactHooks(startFiber) {
        let dispatchChannelUrl = null;
        let dispatchChannel = null;
        let sdk = null;

        let fiber = startFiber;
        let depth = 0;

        // Traverse up the Fiber tree
        while (fiber && depth < this.config.maxDepth) {
            // Search for SendBird SDK (typically at depth 14-18)
            if (depth >= this.config.sdkSearchRange[0] && depth <= this.config.sdkSearchRange[1]) {
                if (fiber.memoizedProps?.value?.sb) {
                    sdk = fiber.memoizedProps.value.sb;
                    this.logger.debug(`🔍 Found SendBird SDK at depth ${depth}`);
                }
            }

            // Search for React hooks (typically at depth 15-16)
            if (fiber.memoizedState) {
                let hook = fiber.memoizedState;
                let hookIndex = 0;

                while (hook && hookIndex < 20) {
                    if (hook.queue?.dispatch) {
                        const state = hook.memoizedState;

                        // Hook for channel URL (string)
                        if (typeof state === 'string' && state.includes('sendbird_group_channel')) {
                            dispatchChannelUrl = hook.queue.dispatch;
                            this.logger.debug(`🔍 Found dispatchChannelUrl at depth ${depth}, hook ${hookIndex}`);
                        }

                        // Hook for channel object
                        if (state && typeof state === 'object' && state._url) {
                            dispatchChannel = hook.queue.dispatch;
                            this.logger.debug(`🔍 Found dispatchChannel at depth ${depth}, hook ${hookIndex}`);
                        }
                    }

                    hook = hook.next;
                    hookIndex++;
                }
            }

            // Early exit if we found everything
            if (sdk && dispatchChannelUrl && dispatchChannel) {
                this.logger.debug(`✅ Found all required hooks at depth ${depth}`);
                break;
            }

            fiber = fiber.return;
            depth++;
        }

        return { sdk, dispatchChannelUrl, dispatchChannel, depth };
    }

    /**
     * PRIMARY METHOD: Open channel by URL using React hooks dispatch
     *
     * IMPORTANT: This method now uses page context communication because React Fiber keys
     * are NOT accessible from extension content script context due to Chrome's isolation.
     * The actual React Fiber navigation happens in page-script.js which runs in page context.
     *
     * @param {string} channelUrl - SendBird channel URL (e.g., sendbird_group_channel_...)
     * @returns {Promise<{success: boolean, method: string, error?: string}>}
     */
    async openChannelByUrl(channelUrl) {
        try {
            this.logger.debug('🧭 [EXTENSION CONTEXT] Attempting React Fiber navigation via page context:', channelUrl);

            // Check if we should skip due to consecutive failures
            if (this.consecutiveFailures >= this.config.maxConsecutiveFailures) {
                this.fallbackReason = 'max_consecutive_failures';
                this.logger.warn(`⚠️ Skipping React Fiber (${this.consecutiveFailures} consecutive failures)`);
                return {
                    success: false,
                    method: 'react_fiber',
                    error: 'Consecutive failures threshold reached',
                    shouldFallback: true
                };
            }

            // Send request to page context to perform React Fiber navigation
            const requestId = `react-fiber-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

            this.logger.debug('🧭 [EXTENSION CONTEXT] Sending request to page context...', { requestId, channelUrl });

            // Create promise that waits for response from page context
            const response = await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    cleanup();
                    reject(new Error('React Fiber navigation timeout (5s)'));
                }, 5000);

                const handleResponse = (event) => {
                    if (event.detail.requestId === requestId) {
                        cleanup();
                        if (event.detail.success) {
                            resolve(event.detail.data);
                        } else {
                            reject(new Error(event.detail.error || 'Unknown error'));
                        }
                    }
                };

                const cleanup = () => {
                    clearTimeout(timeout);
                    document.removeEventListener('wv-fav-api-response', handleResponse);
                };

                document.addEventListener('wv-fav-api-response', handleResponse);

                // Send request to page context
                document.dispatchEvent(new CustomEvent('wv-fav-api-request', {
                    detail: {
                        requestId,
                        action: 'openChannelViaReactFiber',
                        data: {
                            channelUrl
                        }
                    }
                }));
            });

            // Success!
            this.consecutiveFailures = 0;
            this.fallbackReason = null;
            this.logger.info('✅ [EXTENSION CONTEXT] React Fiber navigation successful via page context:', response);

            // Track success
            if (this.logger.analytics) {
                this.logger.analytics('channel_opened', {
                    method: 'react_fiber',
                    depth: response.depth,
                    success: true,
                    via_page_context: true
                });
            }

            return {
                success: true,
                method: 'react_fiber',
                channelName: response.channelName,
                channelUrl: response.channelUrl,
                depth: response.depth
            };

        } catch (error) {
            this.fallbackReason = 'page_context_error';
            this.consecutiveFailures++;
            this.logger.error('❌ [EXTENSION CONTEXT] React Fiber navigation failed via page context:', error);

            // Track failure
            if (this.logger.analytics) {
                this.logger.analytics('channel_open_failed', {
                    method: 'react_fiber',
                    error: error.message,
                    consecutive_failures: this.consecutiveFailures,
                    via_page_context: true
                });
            }

            return {
                success: false,
                method: 'react_fiber',
                error: error.message,
                shouldFallback: true
            };
        }
    }

    /**
     * Get message data from React Fiber tree
     *
     * @param {string} channelUrl - SendBird channel URL
     * @param {string} messageId - Message ID to find
     * @returns {Promise<{success: boolean, message?: object, error?: string}>}
     */
    async getMessageData(channelUrl, messageId) {
        try {
            this.logger.debug('📬 [EXTENSION CONTEXT] Getting message data via page context:', { channelUrl, messageId });

            const requestId = `get-message-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

            // Create promise that waits for response from page context
            const response = await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    cleanup();
                    reject(new Error('Get message data timeout (5s)'));
                }, 5000);

                const handleResponse = (event) => {
                    if (event.detail.requestId === requestId) {
                        cleanup();
                        if (event.detail.success) {
                            resolve(event.detail.data);
                        } else {
                            reject(new Error(event.detail.error || 'Unknown error'));
                        }
                    }
                };

                const cleanup = () => {
                    clearTimeout(timeout);
                    document.removeEventListener('wv-fav-api-response', handleResponse);
                };

                document.addEventListener('wv-fav-api-response', handleResponse);

                // Send request to page context
                document.dispatchEvent(new CustomEvent('wv-fav-api-request', {
                    detail: {
                        requestId,
                        action: 'getMessageFromReactTree',
                        data: {
                            channelUrl,
                            messageId
                        }
                    }
                }));
            });

            this.logger.info('✅ [EXTENSION CONTEXT] Message data retrieved successfully:', response);

            return {
                success: true,
                message: response.message
            };

        } catch (error) {
            this.logger.error('❌ [EXTENSION CONTEXT] Failed to get message data:', error);

            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Get current thread state from React hooks
     *
     * @returns {Promise<{success: boolean, channelId?: string, threadId?: number|null, isThread?: boolean, error?: string}>}
     */
    async getCurrentThreadId() {
        try {
            this.logger.debug('🧵 [EXTENSION CONTEXT] Getting current thread state via page context...');

            const requestId = `get-thread-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

            // Create promise that waits for response from page context
            const response = await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    cleanup();
                    reject(new Error('Get thread state timeout (5s)'));
                }, 5000);

                const handleResponse = (event) => {
                    if (event.detail.requestId === requestId) {
                        cleanup();
                        if (event.detail.success) {
                            resolve(event.detail.data);
                        } else {
                            reject(new Error(event.detail.error || 'Unknown error'));
                        }
                    }
                };

                const cleanup = () => {
                    clearTimeout(timeout);
                    document.removeEventListener('wv-fav-api-response', handleResponse);
                };

                document.addEventListener('wv-fav-api-response', handleResponse);

                // Send request to page context
                document.dispatchEvent(new CustomEvent('wv-fav-api-request', {
                    detail: {
                        requestId,
                        action: 'getCurrentThreadState'
                    }
                }));
            });

            this.logger.info('✅ [EXTENSION CONTEXT] Thread state retrieved successfully:', response);

            return {
                success: true,
                channelId: response.channelId,
                threadId: response.threadId,
                isThread: response.isThread
            };

        } catch (error) {
            this.logger.error('❌ [EXTENSION CONTEXT] Failed to get thread state:', error);

            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Get current health status for debugging
     */
    getHealthStatus() {
        return {
            status: this.healthStatus,
            lastCheck: this.lastHealthCheck,
            consecutiveFailures: this.consecutiveFailures,
            fallbackReason: this.fallbackReason,
            isHealthy: this.healthStatus === 'healthy',
            shouldUseFallback: this.consecutiveFailures >= this.config.maxConsecutiveFailures
        };
    }

    /**
     * Reset failure counter (call after successful fallback)
     */
    resetFailureCounter() {
        this.consecutiveFailures = 0;
        this.fallbackReason = null;
        this.logger.debug('🔄 Failure counter reset');
    }

    /**
     * Get fallback reason for user notification
     */
    getFallbackReason() {
        const reasons = {
            'max_consecutive_failures': 'Multiple navigation attempts failed',
            'no_active_button': 'Could not access navigation system',
            'fiber_key_not_found': 'React system not detected',
            'hooks_not_found': 'Navigation hooks not found',
            'channel_fetch_failed': 'Failed to fetch channel data',
            'unexpected_error': 'Unexpected navigation error'
        };

        return reasons[this.fallbackReason] || 'Unknown reason';
    }

    /**
     * Cleanup
     */
    destroy() {
        this.cachedHooks = null;
        this.cachedSdk = null;
        this.logger.info('🧹 ReactFiberNavigator destroyed');
    }
};

// Expose for debugging
if (typeof window !== 'undefined') {
    window.wvReactFiberNav = null; // Will be set when initialized
}
