/**
 * WebpackNavigator - Tier 1 Navigation (Fastest, 0 downloads)
 *
 * This module discovers navigation functions by searching webpack modules
 * that are already loaded in memory. No network requests needed!
 *
 * Performance:
 * - Initialization: < 5 seconds
 * - Memory usage: ~5 MB
 * - Network: 0 bytes
 *
 * @version 1.0.0
 */

var WVFavs = WVFavs || {};

WVFavs.WebpackNavigator = class WebpackNavigator {
    constructor(app) {
        this.app = app;
        this.logger = app?.logger || { debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, analytics: () => {} };

        // State
        this.initialized = false;
        this.discoveredFunctions = new Set();
        this.primaryFunction = null;
        this.chatContext = null;
        this.lastInitAttempt = null;
        this.consecutiveFailures = 0;
        this.retryAttempts = 0;
        this.maxRetries = 5; // Try for ~15 seconds total

        // Configuration
        this.config = {
            maxConsecutiveFailures: 3,
            retryDelay: 60000, // Retry after 1 minute
            // Keywords to search for in webpack modules
            keywords: [
                'setHighlightedMessage',
                'navigateToMessage',
                'selectMessage',
                'setCurrentChannelId',
                'setCurrentThreadParentMessageId',
                'toggleThreadPanel',
                'openThread',
                'jumpToMessage'
            ],
            // Priority order for function selection
            functionPriority: [
                'setHighlightedMessage',  // Best: One-step navigation
                'navigateToMessage',       // Good: Purpose-built
                'selectMessage',           // Good: Similar to above
                'jumpToMessage',           // Good: Alternative naming
                'openThread',              // OK: Thread-specific
                'setCurrentChannelId'      // Fallback: Multi-step required
            ],
            // Alternative webpack global names to try
            webpackGlobals: [
                'webpackChunkspark',       // Workvivo's webpack global
                'webpackChunk',            // Standard webpack
                'webpackJsonp',            // Webpack 3/4
                '__webpack_modules__'      // Direct module access
            ]
        };

        this.logger.info('⚡ WebpackNavigator initialized');
    }

    /**
     * Initialize the navigator
     */
    async init() {
        try {
            console.log('⚡ === WEBPACKNAVIGATOR INIT STARTED ===');
            this.logger.info('⚡ Starting WebpackNavigator initialization...');
            const startTime = Date.now();

            // Check if we should skip due to recent failures
            if (this.shouldSkipInit()) {
                console.log('⚠️  WEBPACKNAVIGATOR: Skipping init due to recent failures');
                this.logger.warn('⚠️  Skipping WebpackNavigator init due to recent failures');
                return false;
            }

            this.lastInitAttempt = Date.now();

            // Step 1 & 2: Search modules for navigation functions in PAGE CONTEXT
            // Note: We can't check window.webpackChunkspark from extension context
            // So we send a request to page-script.js which runs in page context
            console.log('🔍 WEBPACKNAVIGATOR: Requesting webpack module search from page context...');
            this.logger.debug('🔍 Requesting webpack module search from page context...');
            this.discoveredFunctions = await this.searchWebpackModules();
            console.log('🔍 WEBPACKNAVIGATOR: Search completed, found', this.discoveredFunctions.size, 'functions');

            if (this.discoveredFunctions.size === 0) {
                this.retryAttempts++;

                if (this.retryAttempts < this.maxRetries) {
                    console.log(`⚠️  WEBPACKNAVIGATOR: Webpack not ready yet, retry ${this.retryAttempts}/${this.maxRetries} in 3s...`);
                    this.logger.info(`⚠️  Webpack not ready, retry ${this.retryAttempts}/${this.maxRetries}`);

                    // Schedule retry after 3 seconds (webpack should be loaded by then)
                    setTimeout(() => {
                        console.log(`🔄 WEBPACKNAVIGATOR: Retry attempt ${this.retryAttempts}/${this.maxRetries}...`);
                        this.init();
                    }, 3000);
                } else {
                    console.log('❌ WEBPACKNAVIGATOR: Max retries reached, giving up');
                    this.logger.warn('❌ WebpackNavigator failed after max retries');
                    this.consecutiveFailures++;
                }

                return false;
            }

            console.log(`✅ WEBPACKNAVIGATOR: Discovered ${this.discoveredFunctions.size} functions:`, Array.from(this.discoveredFunctions));
            this.logger.info(`✅ Discovered ${this.discoveredFunctions.size} functions:`, Array.from(this.discoveredFunctions));

            // Step 3: Extract ChatContext from React Fiber
            // Note: This will be done in page context via page-script.js
            // We mark as initialized here and will extract context on-demand

            // Step 4: Determine primary function
            this.primaryFunction = this.determinePrimaryFunction();
            if (!this.primaryFunction) {
                this.consecutiveFailures++;
                this.logger.warn('❌ No suitable primary function found');
                return false;
            }

            this.logger.info(`✅ Selected primary function: ${this.primaryFunction}`);

            const elapsed = Date.now() - startTime;
            console.log(`✅ WEBPACKNAVIGATOR: Initialized successfully in ${elapsed}ms`);
            console.log(`✅ WEBPACKNAVIGATOR: Primary function = ${this.primaryFunction}`);
            this.logger.info(`✅ WebpackNavigator initialized in ${elapsed}ms`);

            this.initialized = true;
            this.consecutiveFailures = 0;
            this.retryAttempts = 0; // Reset retry counter on success

            // Analytics disabled per user request
            // Webpack navigator initialization tracking removed

            console.log('✅ === WEBPACKNAVIGATOR INIT COMPLETED SUCCESSFULLY ===');
            return true;

        } catch (error) {
            this.consecutiveFailures++;
            console.log('❌ WEBPACKNAVIGATOR: Initialization failed:', error.message);
            console.error('❌ WEBPACKNAVIGATOR: Error stack:', error.stack);
            this.logger.error('❌ WebpackNavigator initialization failed', { error: error.message, stack: error.stack });
            this.initialized = false;
            return false;
        }
    }

    /**
     * Check if we should skip initialization due to recent failures
     */
    shouldSkipInit() {
        if (this.consecutiveFailures < this.config.maxConsecutiveFailures) {
            return false;
        }

        // Check if enough time has passed since last attempt
        if (!this.lastInitAttempt) {
            return false;
        }

        const timeSinceLastAttempt = Date.now() - this.lastInitAttempt;
        return timeSinceLastAttempt < this.config.retryDelay;
    }

    // Note: findWebpackChunks() removed - this check must happen in page context
    // The searchWebpackModules() method below sends a request to page-script.js

    /**
     * Search webpack modules for navigation function keywords
     * This runs in EXTENSION CONTEXT and sends request to PAGE CONTEXT
     */
    async searchWebpackModules() {
        this.logger.debug('🔍 Searching webpack modules for navigation functions...');

        try {
            // Send request to page context to search modules
            const requestId = `webpack-search-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

            const result = await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    cleanup();
                    reject(new Error('Webpack module search timeout (10s)'));
                }, 10000);

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
                        action: 'searchWebpackModules',
                        data: {
                            keywords: this.config.keywords
                        }
                    }
                }));
            });

            return new Set(result.functions || []);

        } catch (error) {
            this.logger.error('❌ Webpack module search failed:', error);
            return new Set();
        }
    }

    /**
     * Determine which function to use as primary navigation method
     */
    determinePrimaryFunction() {
        // Go through priority list and return first available
        for (const func of this.config.functionPriority) {
            if (this.discoveredFunctions.has(func)) {
                this.logger.debug(`✅ Selected ${func} as primary function`);
                return func;
            }
        }

        // If none from priority list, use any discovered function
        const anyFunction = Array.from(this.discoveredFunctions)[0];
        if (anyFunction) {
            this.logger.warn(`⚠️  No priority function found, using: ${anyFunction}`);
            return anyFunction;
        }

        return null;
    }

    /**
     * Navigate to a message using webpack-discovered functions
     * This runs in EXTENSION CONTEXT and delegates to PAGE CONTEXT
     *
     * @param {Object} message - Message object with message_id, channel_url, parent_message_id
     * @returns {Promise<{success: boolean, method: string, error?: string}>}
     */
    async navigateToMessage(message) {
        try {
            console.log('🧭 === WEBPACKNAVIGATOR: navigateToMessage CALLED ===');
            console.log('   Message ID:', message.message_id);
            console.log('   Channel URL:', message.channel_url);
            console.log('   Initialized:', this.initialized);

            if (!this.initialized) {
                console.log('⚠️  WEBPACKNAVIGATOR: Not initialized, returning error');
                this.logger.warn('⚠️  WebpackNavigator not initialized');
                return {
                    success: false,
                    method: 'webpack',
                    error: 'Not initialized',
                    shouldFallback: true
                };
            }

            console.log('🧭 WEBPACKNAVIGATOR: Sending navigation request to page context...');
            this.logger.debug('🧭 [WebpackNavigator] Navigating to message:', message.message_id);

            // Send request to page context to perform navigation
            const requestId = `webpack-nav-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

            const response = await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    cleanup();
                    reject(new Error('Navigation timeout (10s)'));
                }, 10000);

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
                        action: 'navigateViaWebpack',
                        data: {
                            message,
                            primaryFunction: this.primaryFunction,
                            discoveredFunctions: Array.from(this.discoveredFunctions)
                        }
                    }
                }));
            });

            // Success!
            this.consecutiveFailures = 0;
            this.logger.info('✅ [WebpackNavigator] Navigation successful:', response);

            // Track success
            if (this.logger.analytics) {
                this.logger.analytics('message_navigation', {
                    method: 'webpack',
                    primary_function: this.primaryFunction,
                    success: true
                });
            }

            return {
                success: true,
                method: 'webpack',
                primaryFunction: this.primaryFunction,
                ...response
            };

        } catch (error) {
            this.consecutiveFailures++;
            this.logger.error('❌ [WebpackNavigator] Navigation failed:', error);

            // Track failure
            if (this.logger.analytics) {
                this.logger.analytics('message_navigation_failed', {
                    method: 'webpack',
                    error: error.message,
                    consecutive_failures: this.consecutiveFailures
                });
            }

            return {
                success: false,
                method: 'webpack',
                error: error.message,
                shouldFallback: true
            };
        }
    }

    /**
     * Get diagnostic information
     */
    getDiagnostics() {
        return {
            tier: 1,
            name: 'WebpackNavigator',
            initialized: this.initialized,
            webpackFound: this.discoveredFunctions.size > 0, // Detected via page context
            webpackGlobal: 'Detected in page context',
            functionsDiscovered: this.discoveredFunctions.size,
            discoveredFunctions: Array.from(this.discoveredFunctions),
            primaryFunction: this.primaryFunction,
            consecutiveFailures: this.consecutiveFailures,
            lastInitAttempt: this.lastInitAttempt,
            shouldRetry: !this.shouldSkipInit(),
            performance: {
                initialization: '< 5 seconds',
                navigation: '< 1 second',
                network: '0 bytes'
            }
        };
    }

    /**
     * Reset failure counter
     */
    reset() {
        this.consecutiveFailures = 0;
        this.lastInitAttempt = null;
        this.logger.debug('🔄 WebpackNavigator reset');
    }

    /**
     * Cleanup
     */
    destroy() {
        this.initialized = false;
        this.discoveredFunctions.clear();
        this.primaryFunction = null;
        this.chatContext = null;
        this.logger.info('🧹 WebpackNavigator destroyed');
    }
};

// Expose for debugging
if (typeof window !== 'undefined') {
    window.wvWebpackNav = null; // Will be set when initialized
}
