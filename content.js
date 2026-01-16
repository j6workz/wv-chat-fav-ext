// WorkVivo Chat Favorites - Content Script

class WorkVivoFavorites {
    constructor() {
        try {
            // Pinned chats now managed via IndexedDB
            this.initialized = false;
            this.headerPinSetup = false;
            this.mobileDrawerInitialized = false;
            this.drawerOpen = false;
            this.quickSearchOpen = false;
            this.selectedSearchIndex = 0;
            this.searchDebounceTimer = null;
            this.chatSwitcherOpen = false;
            this.cmdSlashPressed = false;
            this.cmdSlashPressTime = null;
            this.switcherIndex = 0;
            this.switcherChats = [];
            this.backslashAlreadyHandled = false;
            this.apiRequests = new Map();
            this.lastClickedSidebarChat = null;
            this.allSearchResults = [];
            this.lastChatPageUrl = null; // Track last chat page URL for auto-redirect
            this.pendingAction = null; // Track pending action after redirect

            this.settings = WVFavs.Settings;

            // Initialize analytics system (will be initialized later in initAnalytics)
            this.deviceLocationDetector = null;
            this.analyticsManager = null;
            this.privacyManager = null;
            this.logger = null;

            // SmartUserDatabase will use its internal logger wrapper
            this.smartUserDB = new WVFavs.SmartUserDatabase(WVFavs.Constants.USER_DB_TTL);

            this.storageManager = WVFavs.StorageManager;
            this.pinnedChats = new Map(); // Initialize as empty Map

            // Initialize Statistics Manager (will be initialized later with logger)

            // Analytics debugging methods will be exposed after initialization

            // Initialize SearchEngine with app instance
            WVFavs.SearchEngine.init(this);
            WVFavs.APIManager.init(this);

            // Expose debugging methods
            window.wvSmartDB = this.smartUserDB;
            window.wvCleanupDuplicates = () => this.smartUserDB.cleanupDuplicateRecords();

            this.chatHistory = {
                recents: [],
                current: null,
                async updateHistory(newChatInfo, extensionInstance, addToRecents = true) {
                if (!newChatInfo || (this.current && this.current.id === newChatInfo.id)) {
                    return;
                }

                // SIMPLIFIED: Use IndexedDB only - no more dual storage!
                const chatWithTimestamp = { ...newChatInfo, lastVisited: Date.now() };

                if (extensionInstance) {
                    // Record interaction in IndexedDB (this handles everything now)
                    await extensionInstance.smartUserDB.recordChatInteraction(chatWithTimestamp);

                    // Update in-memory cache from IndexedDB for immediate UI updates
                    this.current = chatWithTimestamp;
                    this.recents = await extensionInstance.smartUserDB.getRecentChats();

                    if (extensionInstance.logger) {
                        extensionInstance.logger.log('📊 Chat history updated via IndexedDB:', {
                            current: this.current?.name,
                            recentsCount: this.recents.length,
                            recents: this.recents.map(c => c.name),
                            addToRecents: addToRecents
                        });
                    }
                }
            },
                canToggle() { return this.recents.length > 0; },
                getToggleTarget() { return this.recents[0]; },
                getAllRecents() { return this.recents.slice(); }
            };

            // Check Chrome runtime availability before initializing
            if (chrome?.runtime?.id) {
                console.log('🚀 [STATUS] Chrome runtime available, calling init()...');
                this.init().catch(error => {
                    // Bypass ConsoleOverride to ensure error is visible
                    if (window.originalConsole) {
                        window.originalConsole.error('❌ [CRITICAL] Extension init failed:', error);
                    } else {
                        alert('[CRITICAL ERROR] Extension init failed: ' + error.message + '\n\nStack: ' + error.stack);
                    }
                    console.error('❌ [STATUS] Extension init failed:', error);
                    console.error('❌ Extension init failed:', error);
                });
            } else {
                // Retry initialization after a short delay
                console.warn('⏳ [STATUS] Chrome runtime not available, retrying in 1 second...');
                setTimeout(() => {
                    if (chrome?.runtime?.id) {
                        console.log('🚀 [STATUS] Chrome runtime available (delayed), calling init()...');
                        this.init().catch(error => {
                            console.error('❌ [STATUS] Extension delayed init failed:', error);
                            console.error('❌ Extension delayed init failed:', error);
                        });
                    }
                }, 1000);
            }
        } catch (error) {
            console.error('❌ Error in WorkVivoFavorites constructor:', error);
            console.error('Constructor error details:', { message: error.message, stack: error.stack });
            throw error; // Re-throw to be caught by outer try-catch
        }
    }

    async ensureSmartUserDBReady() {
        // Wait for SmartUserDB to be ready (it initializes asynchronously in constructor)
        let retries = 0;
        const maxRetries = 50; // 5 seconds max wait

        while (!this.smartUserDB.isReady && retries < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, 100));
            retries++;
        }

        if (!this.smartUserDB.isReady) {
            if (this.logger) {
                this.logger.warn('SmartUserDatabase failed to initialize within timeout');
            }
        } else if (this.logger) {
            this.logger.debug('SmartUserDatabase ready');
        }
    }

    /**
     * Initialize consent system
     */
    async initConsentSystem() {
        try {
            // Wait for consent classes to be available
            let retries = 0;
            while ((!window.WVFavs?.ConsentManager || !window.WVFavs?.ConsentPrompt) && retries < 10) {
                await new Promise(resolve => setTimeout(resolve, 100));
                retries++;
            }

            if (!window.WVFavs?.ConsentManager || !window.WVFavs?.ConsentPrompt) {
                this.logger && this.logger.warn('ConsentManager or ConsentPrompt not available');
                return;
            }

            // Initialize and show consent prompt if needed
            const consentPrompt = new window.WVFavs.ConsentPrompt();
            await consentPrompt.init();

            this.logger && this.logger.log('✅ Consent system initialized');
        } catch (error) {
            this.logger && this.logger.error('Failed to initialize consent system:', error);
        }
    }

    /**
     * Initialize analytics system
     */
    async initAnalytics() {
        try {
            // Wait for analytics classes to be available (including jurisdiction classes)
            let retries = 0;
            while ((!window.WVFavs?.AnalyticsManager || !window.WVFavs?.PrivacyManager || !window.WVFavs?.DeviceLocationDetector || !window.WVFavs?.JurisdictionDetector || !window.WVFavs?.PrivacyRulesEngine || !window.WVFavs?.logger) && retries < 10) {
                await new Promise(resolve => setTimeout(resolve, 100));
                retries++;
            }

            if (!window.WVFavs?.AnalyticsManager) {
                throw new Error('AnalyticsManager not available');
            }

            // Initialize analytics system components
            this.deviceLocationDetector = new window.WVFavs.DeviceLocationDetector();
            this.analyticsManager = new window.WVFavs.AnalyticsManager();
            this.privacyManager = new window.WVFavs.PrivacyManager();
            this.logger = window.WVFavs.logger; // Use global logger instance

            // Initialize the managers
            await this.analyticsManager.init();
            await this.privacyManager.init();

            // Connect them to the global logger
            this.logger.analyticsManager = this.analyticsManager;
            this.privacyManager.logger = this.logger;
            this.privacyManager.analyticsManager = this.analyticsManager;

            // Expose analytics debugging methods
            window.wvAnalytics = this.analyticsManager;
            window.wvPrivacy = this.privacyManager;

            // Track extension installation/update events
            const manifest = chrome.runtime.getManifest();
            const currentVersion = manifest.version;

            const lastVersion = await new Promise(resolve => {
                chrome.storage.local.get(['extension_version'], result => {
                    resolve(result.extension_version);
                });
            });

            if (!lastVersion) {
                // First installation
                this.logger.analytics('extension_installed', {
                    version: currentVersion,
                    installation_timestamp: Date.now()
                });

                chrome.storage.local.set({ extension_version: currentVersion });
            } else if (lastVersion !== currentVersion) {
                // Version update
                this.logger.analytics('extension_updated', {
                    from_version: lastVersion,
                    to_version: currentVersion,
                    update_timestamp: Date.now()
                });

                chrome.storage.local.set({ extension_version: currentVersion });

                // PHASE 6: Trigger full database verification on version update
                chrome.storage.local.set({
                    needsFullVerification: true,
                    verificationTriggerVersion: currentVersion,
                    verificationTriggerTime: Date.now()
                });

                this.logger.info(`🔄 [MIGRATION] Scheduled full DB verification for version ${currentVersion}`);
            }

            this.logger.debug('✅ Analytics system initialized');

        } catch (error) {
            if (this.logger) {
                this.logger.error('Failed to initialize analytics system', {
                    error: error.message,
                    stack: error.stack
                });
            }
        }
    }

    // Initialize user engagement tracking (Phase 4 analytics)
    initUserEngagementTracking() {
        // Track session start
        this.sessionStartTime = Date.now();
        this.featureDiscoveryPath = [];
        this.engagementScore = 0;
        this.lastActivityTime = Date.now();

        // Session tracking removed - using GA4 automatic session tracking

        // Track page visibility changes for session analysis
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') {
                this.trackSessionPause();
            } else if (document.visibilityState === 'visible') {
                this.trackSessionResume();
            }
        });

        // Track user activity for engagement scoring
        this.trackUserActivity();

        // Track session end on page unload
        window.addEventListener('beforeunload', () => {
            this.trackSessionEnd();
        });

        // Periodic engagement score calculation
        setInterval(() => {
            this.calculateEngagementScore();
        }, 30000); // Every 30 seconds
    }

    trackUserActivity() {
        const events = ['click', 'keydown', 'scroll', 'mousemove'];
        events.forEach(eventType => {
            document.addEventListener(eventType, () => {
                this.lastActivityTime = Date.now();
            }, { passive: true });
        });
    }

    trackFeatureDiscovery(featureName, method) {
        this.featureDiscoveryPath.push({
            feature: featureName,
            method: method,
            timestamp: Date.now()
        });

        if (this.logger) {
            this.logger.analytics('feature_discovered', {
                feature_name: featureName,
                action_method: method,
                discovery_order: this.featureDiscoveryPath.length
            });
        }
    }

    trackSessionPause() {
        // Session pause tracking removed - using GA4 automatic session tracking
    }

    trackSessionResume() {
        // Session resume tracking removed - using GA4 automatic session tracking
    }

    trackSessionEnd() {
        // Session end tracking removed - using GA4 automatic session tracking
    }

    calculateEngagementScore() {
        const currentTime = Date.now();
        const sessionDuration = currentTime - this.sessionStartTime;
        const timeSinceActivity = currentTime - this.lastActivityTime;

        // Base score from session duration (max 40 points)
        let score = Math.min(40, sessionDuration / 1000 / 60); // 1 point per minute, max 40

        // Bonus for recent activity (max 20 points)
        if (timeSinceActivity < 60000) { // Active in last minute
            score += 20;
        } else if (timeSinceActivity < 300000) { // Active in last 5 minutes
            score += 10;
        }

        // Bonus for feature discovery (max 30 points)
        score += Math.min(30, this.featureDiscoveryPath.length * 5);

        // Penalty for inactivity
        if (timeSinceActivity > 300000) { // Inactive for 5+ minutes
            score = Math.max(0, score - 20);
        }

        this.engagementScore = Math.round(score);
        return this.engagementScore;
    }

    isOnChatPage() {
        return location.href.includes('/chat');
    }

    saveLastChatPageUrl() {
        if (this.isOnChatPage()) {
            this.lastChatPageUrl = location.href;
            // Save to storage for persistence across reloads
            chrome.storage.local.set({ lastChatPageUrl: this.lastChatPageUrl });
            this.logger?.log('💾 Saved last chat page URL:', this.lastChatPageUrl);
        }
    }

    async loadLastChatPageUrl() {
        const result = await chrome.storage.local.get('lastChatPageUrl');
        if (result.lastChatPageUrl) {
            this.lastChatPageUrl = result.lastChatPageUrl;
            this.logger?.log('📂 Loaded last chat page URL:', this.lastChatPageUrl);
        }
    }

    handleNonChatPageAction(actionName, actionCallback) {
        if (this.isOnChatPage()) {
            // We're on chat page, execute the action
            actionCallback();
            return;
        }

        // Not on chat page
        const autoRedirectEnabled = this.settings.get('autoRedirectToChat');

        if (autoRedirectEnabled) {
            // Auto-redirect enabled
            let chatPageUrl = this.lastChatPageUrl;

            // If no saved URL, try to generate one from current URL
            if (!chatPageUrl && location.href.includes('.workvivo.com')) {
                chatPageUrl = this.generateChatPageUrl();
                this.logger?.log('📝 Generated chat page URL:', chatPageUrl);
            }

            if (chatPageUrl) {
                this.logger?.log('🔄 Redirecting to chat page with pending action:', actionName);

                // Store pending action
                this.pendingAction = { name: actionName, callback: actionCallback };
                chrome.storage.local.set({
                    pendingAction: actionName,
                    pendingActionTimestamp: Date.now()
                });

                // Redirect to chat page
                window.location.href = chatPageUrl;
                return;
            }
        }

        // Show snackbar asking user to go to chat page
        const message = '💬 Please navigate to the Chat page to use this feature';
        WVFavs.DomManager.showSnackbar(message, 'info', 4000);
        this.logger?.log('⚠️ User attempted to use extension outside chat page:', actionName);
    }

    /**
     * Generate chat page URL from current URL
     * e.g., https://allstars.workvivo.com/feed -> https://allstars.workvivo.com/chat
     */
    generateChatPageUrl() {
        try {
            const url = new URL(location.href);
            // Replace path with /chat, keep origin intact
            return `${url.origin}/chat`;
        } catch (error) {
            this.logger?.log('❌ Failed to generate chat page URL:', error);
            return null;
        }
    }

    async checkAndExecutePendingAction() {
        // Check if extension context is still valid
        if (!chrome?.runtime?.id) {
            console.log('⚠️ Extension context invalidated - please reload the page');
            return;
        }

        try {
            // Check if we have a pending action after redirect
            const result = await chrome.storage.local.get(['pendingAction', 'pendingActionTimestamp']);

            if (result.pendingAction && result.pendingActionTimestamp) {
            const timeSinceAction = Date.now() - result.pendingActionTimestamp;

            // Only execute if within 10 seconds (prevents stale actions)
            if (timeSinceAction < 10000) {
                this.logger?.log('✅ Executing pending action:', result.pendingAction);

                // Execute the pending action
                switch (result.pendingAction) {
                    case 'openQuickSearch':
                        if (WVFavs.EventHandler.openQuickSearch) {
                            WVFavs.EventHandler.openQuickSearch();
                        }
                        break;
                    case 'openFloatingWidget':
                        if (this.floatingWidget?.show) {
                            this.floatingWidget.show();
                        }
                        break;
                    case 'toggleChatSwitcher':
                        if (WVFavs.EventHandler.toggleChatSwitcher) {
                            WVFavs.EventHandler.toggleChatSwitcher();
                        }
                        break;
                }

                    // Clear pending action
                    chrome.storage.local.remove(['pendingAction', 'pendingActionTimestamp']);
                }
            }
        } catch (error) {
            if (error.message?.includes('Extension context invalidated')) {
                console.log('⚠️ Extension was reloaded - please reload this page');
            } else {
                this.logger?.error('❌ Error checking pending action:', error);
            }
        }
    }

    /**
     * Check if a feature is enabled (combining local settings and remote stability control)
     * @param {string} featureName - The feature name to check
     * @param {string} settingKey - The local setting key to check (optional)
     * @returns {boolean} - Whether the feature is enabled
     */
    isFeatureEnabled(featureName, settingKey = null) {
        // Check local setting first (if provided)
        if (settingKey && this.settings.get(settingKey) === false) {
            return false;
        }

        // Check remote stability control
        if (this.featureStability && !this.featureStability.isFeatureEnabled(featureName)) {
            const msg = this.featureStability.getFeatureMessage(featureName);
            if (this.logger) {
                this.logger.warn(`🛡️ Feature '${featureName}' disabled by stability control: ${msg || 'No reason provided'}`);
            }
            return false;
        }

        return true;
    }

    setupURLChangeDetection() {
        // Detect URL changes for SPA navigation (WorkVivo uses client-side routing)
        let lastUrl = location.href;

        const checkUrlChange = () => {
            const currentUrl = location.href;
            if (currentUrl !== lastUrl) {
                this.logger?.log('🔄 URL changed detected:', { from: lastUrl, to: currentUrl });

                // Check if we navigated to a chat page
                const wasChatPage = lastUrl.includes('/chat');
                const isChatPage = currentUrl.includes('/chat');

                if (!wasChatPage && isChatPage) {
                    // User navigated from non-chat page to chat page
                    this.logger?.log('✅ Navigated to chat page, re-initializing extension...');

                    // Re-initialize the extension
                    if (!this.initialized) {
                        this.setupExtension();
                    } else {
                        // Refresh UI elements (force=true to bypass cooldown)
                        WVFavs.DomManager.findAndSetupSidebar(true);
                        this.setupChatHeaderPinButton();
                    }

                    // Check for pending actions after redirect
                    this.checkAndExecutePendingAction();
                }

                // Save chat page URL whenever we're on chat
                if (isChatPage) {
                    this.saveLastChatPageUrl();
                }

                lastUrl = currentUrl;
            }
        };

        // Monitor URL changes via multiple methods (covers all SPA navigation cases)

        // 1. Listen for popstate (browser back/forward)
        window.addEventListener('popstate', checkUrlChange);

        // 2. Listen for pushState/replaceState (programmatic navigation)
        const originalPushState = history.pushState;
        const originalReplaceState = history.replaceState;

        history.pushState = function() {
            originalPushState.apply(this, arguments);
            checkUrlChange();
        };

        history.replaceState = function() {
            originalReplaceState.apply(this, arguments);
            checkUrlChange();
        };

        // 3. Periodic check as fallback (every 1 second)
        setInterval(checkUrlChange, 1000);

        this.logger?.log('✅ URL change detection setup complete');
    }

    async init() {
        console.log('🚀 [STATUS] init() method called - STARTING INITIALIZATION');

        // CRITICAL: Load settings from storage FIRST before any feature checks
        console.log('⚙️ [STATUS] Loading settings from storage...');
        try {
            await WVFavs.Settings.load();
            console.log('✅ [STATUS] Settings loaded successfully:', this.settings.getAll());
        } catch (error) {
            console.error('❌ [STATUS] Failed to load settings:', error);
        }

        // Initialize Feature Stability Manager (remote feature control)
        console.log('🛡️ [STATUS] Initializing FeatureStabilityManager...');
        try {
            if (WVFavs.FeatureStabilityManager) {
                this.featureStability = new WVFavs.FeatureStabilityManager(this);
                await this.featureStability.init();
                window.wvFeatureStability = this.featureStability; // Expose for debugging
                console.log('✅ [STATUS] FeatureStabilityManager initialized');
            } else {
                console.warn('⚠️ [STATUS] FeatureStabilityManager class not found');
            }
        } catch (error) {
            console.error('❌ [STATUS] Failed to initialize FeatureStabilityManager:', error);
            // Continue without feature stability - fail-safe
        }

        // Send debug settings to page-script.js
        try {
            document.dispatchEvent(new CustomEvent('wv-fav-debug-settings', {
                detail: {
                    debugLogging: this.settings.get('debugLogging') || false
                }
            }));
        } catch (error) {
            console.error('❌ [STATUS] Settings dispatch failed:', error);
        }

        console.log('⚙️ [STATUS] About to call initConsentSystem()');
        // Initialize consent system and check if prompt is needed
        await this.initConsentSystem();
        console.log('✅ [STATUS] initConsentSystem() completed');

        console.log('⚙️ [STATUS] About to call initAnalytics()');
        // Initialize analytics system first
        await this.initAnalytics();
        console.log('✅ [STATUS] initAnalytics() completed');

        console.log('⚙️ [STATUS] About to call ensureSmartUserDBReady()');
        // Wait for SmartUserDatabase to be ready before initializing StatisticsManager
        await this.ensureSmartUserDBReady();
        console.log('✅ [STATUS] ensureSmartUserDBReady() completed');

        try {
            this.logger.debug('⚙️ [WV STATUS] Creating StatisticsManager...');
            // Initialize Statistics Manager with logger
            this.statsManager = new WVFavs.StatisticsManager();
            this.statsManager.init(this.smartUserDB, this.logger);
            this.logger.debug('✅ [WV STATUS] StatisticsManager created');
        } catch (error) {
            // Bypass ConsoleOverride to ensure error is visible
            alert('[CRITICAL ERROR] StatisticsManager creation failed: ' + error.message);
            console.error('❌ [STATUS] StatisticsManager creation failed:', error);
            throw error;
        }

        try {
            this.logger.debug('⚙️ [WV STATUS] Calling initUserEngagementTracking()...');
            // Initialize user engagement tracking (Phase 4)
            this.initUserEngagementTracking();
            this.logger.debug('✅ [WV STATUS] initUserEngagementTracking() completed');
        } catch (error) {
            alert('[CRITICAL] initUserEngagementTracking() failed: ' + error.message);
        }

        try {
            this.logger.debug('⚙️ [WV STATUS] Calling setupURLChangeDetection()...');
            // Setup URL change detection for SPA navigation
            this.setupURLChangeDetection();
            this.logger.debug('✅ [WV STATUS] setupURLChangeDetection() completed');
        } catch (error) {
            alert('[CRITICAL] setupURLChangeDetection() failed: ' + error.message);
        }

        try {
            this.logger.debug('⚙️ [WV STATUS] Logging extension startup...');
            // Log extension startup
            this.logger.logExtensionStart();
            this.logger.debug('✅ [WV STATUS] Extension startup logged');
        } catch (error) {
            alert('[CRITICAL] logExtensionStart() failed: ' + error.message);
        }

        this.logger.debug('⚙️ [WV STATUS] About to initialize chat history...');
        this.logger.debug('📌 Pinned chats now managed via IndexedDB...');
        this.logger.debug('📊 Loading chat history from IndexedDB...');

        // Initialize chat history from IndexedDB (no more chrome.storage dependency)
        this.chatHistory.recents = [];
        this.chatHistory.current = null;

        this.logger.debug('⚙️ [WV STATUS] Initializing modules (EventHandler, DomDataExtractor, APIManager)...');
        this.logger.info('🔧 WV Initializing modules...');
        // NOTE: DomManager.init() is called later, after StatusDialog is initialized
        WVFavs.EventHandler.init(this);
        WVFavs.DomDataExtractor.init(this);

        // Initialize Floating Search Widget (if enabled and available)
        this.logger.log('🔍 Initializing FloatingSearchWidget...');
        if (!this.isFeatureEnabled('floatingWidget', 'floatingWidgetEnabled')) {
            this.logger.log('⏸️ FloatingSearchWidget disabled');
        } else if (WVFavs.FloatingSearchWidget) {
            this.floatingWidget = new WVFavs.FloatingSearchWidget(this);
            this.logger.log('✅ FloatingSearchWidget initialized');
        } else {
            this.logger.warn('⚠️ FloatingSearchWidget class not found in WVFavs namespace');
        }
        WVFavs.APIManager.init(this);
        this.apiManager = WVFavs.APIManager; // Make APIManager accessible as this.apiManager

        // IMPORTANT: Inject page script EARLY so it's available for profile fetch during StatusDialog init
        console.log('💉 [WV STATUS] Injecting page script early for API access...');
        try {
            await WVFavs.APIManager.injectPageScript();
            console.log('✅ [WV STATUS] Page script fully loaded and ready');
        } catch (error) {
            console.error('❌ [WV STATUS] Failed to inject page script:', error);
            this.logger.error('❌ Page script injection failed:', error);
        }

        WVFavs.SearchEngine.init(this);

        // Initialize Thread Manager
        this.logger.log('🧵 Initializing ThreadManager...');
        if (!this.isFeatureEnabled('threadManager', 'enableThreadsPanel')) {
            this.logger.log('⏸️ ThreadManager disabled');
        } else if (WVFavs.ThreadManager) {
            try {
                this.threadManager = new WVFavs.ThreadManager(this);
                await this.threadManager.init();
                window.wvThreadManager = this.threadManager; // Expose for debugging
                this.logger.log('✅ ThreadManager initialized');
            } catch (error) {
                this.logger.error('❌ Failed to initialize ThreadManager:', error);
                console.error('ThreadManager initialization error:', error);
            }
        } else {
            this.logger.warn('⚠️ ThreadManager class not found in WVFavs namespace');
        }

        // Initialize Webpack Navigator (TIER 1 - Fastest navigation method)
        // DON'T AWAIT - Initialize in background so it doesn't block UI
        this.logger.log('⚡ Initializing WebpackNavigator (Tier 1) in background...');
        if (!this.isFeatureEnabled('webpackNavigator')) {
            this.logger.log('⏸️ WebpackNavigator disabled');
        } else if (WVFavs.WebpackNavigator) {
            this.webpackNav = new WVFavs.WebpackNavigator(this);
            window.wvWebpackNav = this.webpackNav; // Expose for debugging

            // Initialize asynchronously in background (don't block UI)
            this.webpackNav.init().then(success => {
                if (success) {
                    this.logger.log('✅ WebpackNavigator initialized (Tier 1)');
                } else {
                    this.logger.warn('⚠️ WebpackNavigator failed to initialize, will retry');
                }
            }).catch(error => {
                this.logger.error('❌ Failed to initialize WebpackNavigator:', error);
            });
        } else {
            this.logger.warn('⚠️ WebpackNavigator class not found in WVFavs namespace');
        }

        // Initialize React Fiber Navigator (TIER 3 - Fallback navigation method)
        this.logger.log('🧭 Initializing ReactFiberNavigator (Tier 3)...');
        if (!this.isFeatureEnabled('reactFiberNavigator')) {
            this.logger.log('⏸️ ReactFiberNavigator disabled');
        } else if (WVFavs.ReactFiberNavigator) {
            try {
                this.reactFiberNav = new WVFavs.ReactFiberNavigator(this);
                await this.reactFiberNav.init();
                window.wvReactFiberNav = this.reactFiberNav; // Expose for debugging
                this.logger.log('✅ ReactFiberNavigator initialized (Tier 3)');
            } catch (error) {
                this.logger.error('❌ Failed to initialize ReactFiberNavigator:', error);
                console.error('ReactFiberNavigator initialization error:', error);
            }
        } else {
            this.logger.warn('⚠️ ReactFiberNavigator class not found in WVFavs namespace');
        }

        // Initialize Draft Manager (auto-save/restore drafts)
        this.logger.log('📝 Initializing DraftManager...');
        if (!this.isFeatureEnabled('draftManager', 'enableDrafts')) {
            this.logger.log('⏸️ DraftManager disabled');
        } else if (WVFavs.DraftManager) {
            try {
                this.draftManager = new WVFavs.DraftManager(this);
                await this.draftManager.init();
                window.wvDraftManager = this.draftManager; // Expose for debugging
                this.logger.log('✅ DraftManager initialized');
            } catch (error) {
                this.logger.error('❌ Failed to initialize DraftManager:', error);
            }
        } else {
            this.logger.warn('⚠️ DraftManager class not found in WVFavs namespace');
        }

        // Initialize User Identity Manager
        this.logger.debug('⚙️ [WV STATUS] Initializing UserIdentityManager...');
        this.logger.log('🔐 Initializing UserIdentityManager...');
        if (WVFavs.UserIdentityManager) {
            try {
                this.logger.debug('⚙️ [WV STATUS] Creating UserIdentityManager instance...');
                this.userIdentity = new WVFavs.UserIdentityManager(this);
                this.logger.debug('⚙️ [WV STATUS] Calling UserIdentityManager.init()...');
                await this.userIdentity.init();
                this.logger.debug('✅ [WV STATUS] UserIdentityManager.init() completed');
                window.wvUserIdentity = this.userIdentity; // Expose for debugging
                this.logger.log('✅ UserIdentityManager initialized');
            } catch (error) {
                alert('[CRITICAL] UserIdentityManager failed: ' + error.message);
                this.logger.error('❌ Failed to initialize UserIdentityManager:', error);
                console.error('UserIdentityManager initialization error:', error);
            }
        } else {
            this.logger.warn('⚠️ UserIdentityManager class not found in WVFavs namespace');
        }

        // Initialize Mentions Manager (requires UserIdentityManager)
        this.logger.debug('⚙️ [WV STATUS] About to initialize MentionsManager...');
        this.logger.log('📧 Initializing MentionsManager...');
        const mentionsEnabled = this.isFeatureEnabled('mentionsManager', 'enableMentionsPanel');
        this.logger.debug(`⚙️ [WV STATUS] MentionsPanel enabled: ${mentionsEnabled}`);
        if (!mentionsEnabled) {
            this.logger.log('⏸️ MentionsManager disabled');
        } else if (WVFavs.MentionsManager && this.userIdentity) {
            try {
                this.logger.debug('⚙️ [WV STATUS] Creating MentionsManager...');
                this.mentionsManager = new WVFavs.MentionsManager(this);
                this.logger.debug('⚙️ [WV STATUS] Calling MentionsManager.init()...');
                await this.mentionsManager.init();
                this.logger.debug('✅ [WV STATUS] MentionsManager.init() completed');
                window.wvMentionsManager = this.mentionsManager; // Expose for debugging
                this.logger.log('✅ MentionsManager initialized');
            } catch (error) {
                alert('[CRITICAL] MentionsManager failed: ' + error.message);
                this.logger.error('❌ Failed to initialize MentionsManager:', error);
                console.error('MentionsManager initialization error:', error);
            }
        } else {
            if (!WVFavs.MentionsManager) {
                this.logger.warn('⚠️ MentionsManager class not found in WVFavs namespace');
            }
            if (!this.userIdentity) {
                this.logger.warn('⚠️ MentionsManager requires UserIdentityManager to be initialized first');
            }
        }

        this.logger.debug('✅ [WV STATUS] After MentionsManager - continuing init...');

        // Initialize Mentions Panel (requires MentionsManager)
        this.logger.debug('⚙️ [WV STATUS] Initializing MentionsPanel...');
        this.logger.log('📧 Initializing MentionsPanel...');
        if (!mentionsEnabled) {
            this.logger.log('⏸️ MentionsPanel disabled by user settings');
        } else if (WVFavs.MentionsPanel && this.mentionsManager) {
            try {
                this.mentionsPanel = new WVFavs.MentionsPanel(this);
                window.wvMentionsPanel = this.mentionsPanel; // Expose for debugging
                this.logger.log('✅ MentionsPanel initialized');
            } catch (error) {
                this.logger.error('❌ Failed to initialize MentionsPanel:', error);
                console.error('MentionsPanel initialization error:', error);
            }
        } else {
            if (!WVFavs.MentionsPanel) {
                this.logger.warn('⚠️ MentionsPanel class not found in WVFavs namespace');
            }
            if (!this.mentionsManager) {
                this.logger.warn('⚠️ MentionsPanel requires MentionsManager to be initialized first');
            }
        }

        // Initialize Search Manager (for channel message search)
        this.logger.log('🔍 Initializing SearchManager...');
        if (!this.isFeatureEnabled('searchManager')) {
            this.logger.log('⏸️ SearchManager disabled');
        } else if (WVFavs.SearchManager) {
            try {
                this.searchManager = new WVFavs.SearchManager(this);
                window.wvSearchManager = this.searchManager; // Expose for debugging
                this.logger.log('✅ SearchManager initialized');
            } catch (error) {
                this.logger.error('❌ Failed to initialize SearchManager:', error);
                console.error('SearchManager initialization error:', error);
            }
        } else {
            this.logger.warn('⚠️ SearchManager class not found in WVFavs namespace');
        }

        // Initialize Search Panel (requires SearchManager)
        this.logger.log('🔍 Initializing SearchPanel...');
        if (WVFavs.SearchPanel && this.searchManager) {
            try {
                this.searchPanel = new WVFavs.SearchPanel(this);
                window.wvSearchPanel = this.searchPanel; // Expose for debugging
                this.logger.log('✅ SearchPanel initialized');
            } catch (error) {
                this.logger.error('❌ Failed to initialize SearchPanel:', error);
                console.error('SearchPanel initialization error:', error);
            }
        } else {
            if (!WVFavs.SearchPanel) {
                this.logger.warn('⚠️ SearchPanel class not found in WVFavs namespace');
            }
            if (!this.searchManager) {
                this.logger.warn('⚠️ SearchPanel requires SearchManager to be initialized first');
            }
        }

        // Initialize Drafts Panel (requires DraftManager)
        this.logger.log('📝 Initializing DraftsPanel...');
        if (!this.draftManager) {
            this.logger.log('⏸️ DraftsPanel disabled (DraftManager not initialized)');
        } else if (WVFavs.DraftsPanel) {
            try {
                this.draftsPanel = new WVFavs.DraftsPanel(this);
                window.wvDraftsPanel = this.draftsPanel; // Expose for debugging
                this.logger.log('✅ DraftsPanel initialized');
            } catch (error) {
                this.logger.error('❌ Failed to initialize DraftsPanel:', error);
                console.error('DraftsPanel initialization error:', error);
            }
        } else {
            if (!WVFavs.DraftsPanel) {
                this.logger.warn('⚠️ DraftsPanel class not found in WVFavs namespace');
            }
            if (!this.draftManager) {
                this.logger.warn('⚠️ DraftsPanel requires DraftManager to be initialized first');
            }
        }

        // Initialize Status Dialog (requires UserIdentityManager)
        this.logger.debug('📝 [WV STATUS] About to initialize StatusDialog...');
        this.logger.log('📝 Initializing StatusDialog...');
        const statusUpdatesEnabled = this.isFeatureEnabled('statusManager', 'enableStatusUpdates');
        this.logger.debug(`⚙️ [WV STATUS] Status Updates enabled: ${statusUpdatesEnabled}`);
        if (!statusUpdatesEnabled) {
            this.logger.log('⏸️ StatusDialog disabled');
        } else if (WVFavs.StatusDialog && this.userIdentity) {
            try {
                this.logger.debug('✅ [STATUS] StatusDialog class found, creating instance...');
                this.statusDialog = new WVFavs.StatusDialog(this);
                window.wvStatusDialog = this.statusDialog; // Expose for debugging
                this.logger.debug('✅ [STATUS] StatusDialog instance created');
                this.logger.log('✅ StatusDialog initialized');

                // Check for expired status on initialization
                this.logger.debug('⏰ [STATUS] Checking for expired status...');
                await this.userIdentity.checkAndClearExpiredStatus();
                this.logger.debug('✅ [STATUS] Expired status check complete');
            } catch (error) {
                console.error('❌ [STATUS] StatusDialog initialization error:', error);
                this.logger.error('❌ Failed to initialize StatusDialog:', error);
            }
        } else {
            if (!WVFavs.StatusDialog) {
                this.logger.warn('⚠️ StatusDialog class not found in WVFavs namespace');
            }
            if (!this.userIdentity) {
                this.logger.warn('⚠️ StatusDialog requires UserIdentityManager to be initialized first');
            }
        }
        this.logger.debug('📝 [STATUS] StatusDialog section complete, moving to StatusManager...');

        // Initialize StatusManager (requires UserIdentityManager and APIManager)
        this.logger.debug('👥 [SM-1] About to initialize StatusManager...');
        this.logger.debug('👥 [SM-2] statusUpdatesEnabled:', statusUpdatesEnabled);
        this.logger.debug('👥 [SM-3] WVFavs.StatusManager exists:', !!WVFavs.StatusManager);
        this.logger.debug('👥 [SM-4] this.userIdentity exists:', !!this.userIdentity);
        this.logger.debug('👥 [SM-5] this.apiManager exists:', !!this.apiManager);

        if (statusUpdatesEnabled && WVFavs.StatusManager && this.userIdentity && this.apiManager) {
            this.logger.debug('✅ [SM-6] IF BLOCK - Condition TRUE, creating StatusManager...');
            try {
                this.statusManager = new WVFavs.StatusManager(this);
                this.logger.debug('✅ [SM-7] StatusManager instance created, calling init...');
                await this.statusManager.init();
                this.logger.debug('✅ [SM-8] StatusManager init() completed');
                window.wvStatusManager = this.statusManager;
                this.logger.debug('✅ [SM-9] StatusManager fully initialized');
            } catch (error) {
                this.logger.error('❌ [SM-ERROR] StatusManager initialization failed:', error);
            }
        } else {
            this.logger.debug('⚠️ [SM-10] ELSE BLOCK - Condition FALSE, StatusManager SKIPPED');
        }
        this.logger.debug('👥 [SM-11] StatusManager section complete');

        // Initialize DomManager with app instance
        // IMPORTANT: This must be called AFTER StatusDialog and StatusManager are initialized
        // because DomManager's makeAvatarAndNameClickable() needs this.app.statusDialog
        // and displayRecipientStatusInHeader() is called by StatusManager
        this.logger.debug('🎨 [STATUS] Initializing DomManager...');
        this.logger.log('🎨 Initializing DomManager...');
        if (WVFavs.DomManager) {
            this.logger.debug('✅ [STATUS] DomManager found, calling init...');
            this.logger.debug('✅ [STATUS] StatusDialog available:', !!this.statusDialog);
            WVFavs.DomManager.init(this);
            this.logger.debug('✅ [STATUS] DomManager.init completed');
            this.logger.log('✅ DomManager initialized');
        } else {
            this.logger.warn('⚠️ DomManager not found in WVFavs namespace');
        }

        // Initialize Google Meet Manager (if enabled)
        this.logger.log('📹 Initializing GoogleMeetManager...');
        if (!this.isFeatureEnabled('googleMeetManager', 'enableGoogleMeet')) {
            this.logger.log('⏸️ GoogleMeetManager disabled');
        } else if (WVFavs.GoogleMeetManager) {
            try {
                this.googleMeetManager = new WVFavs.GoogleMeetManager(this);
                await this.googleMeetManager.init();
                window.wvGoogleMeet = this.googleMeetManager; // Expose for debugging
                this.logger.log('✅ GoogleMeetManager initialized');

                // Setup Google Meet toolbar button
                if (WVFavs.DomManager.setupGoogleMeetToolbarButton) {
                    WVFavs.DomManager.setupGoogleMeetToolbarButton();
                    this.logger.log('✅ Google Meet toolbar button setup initiated');
                }
            } catch (error) {
                this.logger.error('❌ Failed to initialize GoogleMeetManager:', error);
                console.error('GoogleMeetManager initialization error:', error);
            }
        } else {
            this.logger.warn('⚠️ GoogleMeetManager class not found in WVFavs namespace');
        }

        this.logger.log('🔄 Running migration...');
        await this.migratePinnedChats();

        this.logger.log('💾 Initializing storage...');
        await this.initializePersistentStorage();

        this.logger.log('📊 Initializing IndexedDB-only chat history...');
        // Load initial state from IndexedDB
        this.chatHistory.recents = await this.smartUserDB.getRecentChats();
        this.chatHistory.current = await this.smartUserDB.getCurrentChat();

        // NEW: Smart cleanup with enrichment for incomplete records
        this.logger.log('🧹 Cleaning up incomplete records with smart enrichment...');
        const incompleteCleanupResult = await this.smartUserDB.cleanupIncompleteRecords();
        if (incompleteCleanupResult.total > 0) {
            this.logger.log(
                `✅ Incomplete record cleanup: ` +
                `${incompleteCleanupResult.enriched} enriched, ` +
                `${incompleteCleanupResult.removed} removed, ` +
                `${incompleteCleanupResult.kept} kept (from ${incompleteCleanupResult.total} total)`
            );
        }

        this.logger.log('🧹 Cleaning up duplicate records...');
        await this.smartUserDB.cleanupDuplicateRecords();

        this.logger.log('🔧 Fixing corrupted channel_url records...');
        const cleanupResult = await this.smartUserDB.fixCorruptedChannelUrls();
        if (cleanupResult.fixed > 0 || cleanupResult.deleted > 0) {
            this.logger.log(`✅ Cleanup complete: Fixed ${cleanupResult.fixed}, deleted ${cleanupResult.deleted}`);
        }

        // Check Google Meet token validity (triggers refresh if needed)
        this.logger.log('🔐 Checking Google Meet authentication status...');
        await this.checkGoogleMeetToken();

        this.logger.log('📄 Checking document ready state:', document.readyState);

        // Setup hotkeys globally (works on all pages)
        this.logger.log('⌨️ Setting up global hotkeys...');
        WVFavs.EventHandler.setupHotkeys();

        // Only setup extension UI if we're on a chat page
        const isChatPage = location.href.includes('/chat');
        this.logger.log('📍 Current page type:', isChatPage ? 'Chat page' : 'Non-chat page');

        if (isChatPage) {
            // Save this chat page URL
            this.saveLastChatPageUrl();

            if (document.readyState === 'loading') {
                this.logger.log('⏳ Document still loading, waiting for DOMContentLoaded...');
                document.addEventListener('DOMContentLoaded', () => {
                    this.logger.log('✅ DOMContentLoaded fired, setting up extension');
                    this.setupExtension();
                    // Check for pending actions after setup
                    setTimeout(() => this.checkAndExecutePendingAction(), 1000);
                });
            } else {
                this.logger.log('✅ Document ready, setting up extension immediately');
                this.setupExtension();
                // Check for pending actions after setup
                setTimeout(() => this.checkAndExecutePendingAction(), 1000);
            }
        } else {
            this.logger.log('⏭️ Not on chat page, waiting for navigation...');
        }

        this.logger.debug('🎉 [WV STATUS] ===== INIT() METHOD COMPLETED =====');
        this.logger.debug('🎉 [WV STATUS] StatusDialog exists:', !!this.statusDialog);
        this.logger.debug('🎉 [WV STATUS] DomManager exists:', !!WVFavs.DomManager);
        this.logger.log('✅ Extension initialization complete');
    }

    setupExtension() {
        this.logger?.debug('🚀 [STATUS] setupExtension() called');
        this.logger?.log('🚀 Starting extension setup...');
        setTimeout(() => {
            try {
                this.logger?.debug('🔧 Extension setup timeout reached, checking context...');

                // Check if extension context is still valid
                if (!chrome?.runtime?.id) {
                    this.logger?.warn('Extension context invalidated, skipping setup');
                    return;
                }
                this.logger?.debug('✅ Chrome extension context is valid');

                // Initialize DomManager with app instance BEFORE setting up sidebar
                this.logger?.debug('🎨 [STATUS] Initializing DomManager from setupExtension...');
                if (WVFavs.DomManager) {
                    WVFavs.DomManager.init(this);
                    this.logger?.debug('✅ [STATUS] DomManager initialized from setupExtension');
                } else {
                    this.logger?.warn('⚠️ [STATUS] DomManager NOT found!');
                }

                this.logger?.debug('💉 Injecting page script...');
                // Inject page script for API access
                WVFavs.APIManager.injectPageScript();

                this.logger?.debug('🔧 [WV STATUS] About to call findAndSetupSidebar from setupExtension...');
                this.logger?.debug('🔧 Setting up DOM manager...');
                WVFavs.DomManager.findAndSetupSidebar();
                this.logger?.debug('✅ [WV STATUS] findAndSetupSidebar call completed');

                this.logger?.debug('📚 Loading pinned chats from storage...');
                this.loadPinnedChatsFromStorage();

                this.logger?.debug('👀 Setting up lightweight observer...');
                WVFavs.EventHandler.setupLightweightObserver();

                // Periodic health check for pinned container (catches React re-renders)
                this.logger?.debug('🏥 Setting up pinned container health check...');
                setInterval(() => {
                    if (WVFavs.DomManager && this.isOnChatPage()) {
                        WVFavs.DomManager.verifyPinnedContainerHealth();
                    }
                }, 5000); // Check every 5 seconds

                this.logger?.debug('📌 Setting up chat header pin button...');
                this.setupChatHeaderPinButton();

                this.logger?.debug('🖱️ Setting up click detection...');
                WVFavs.EventHandler.setupClickDetection();

                this.initialized = true;

                this.logger?.log('✅ Extension setup completed successfully');
            } catch (error) {
                this.logger?.error('Error during extension setup', { error: error.message, stack: error.stack });
                this.logger?.log('❌ Extension setup failed:', error.message);
            }
        }, 2000);
    }

    /**
     * Check Google Meet token validity on page load
     * Triggers automatic token refresh if needed
     * Runs silently in the background
     */
    async checkGoogleMeetToken() {
        try {
            const response = await chrome.runtime.sendMessage({
                action: 'CHECK_GOOGLE_MEET_TOKEN'
            });

            if (response && response.success && response.isSignedIn) {
                this.logger.log('✅ Google Meet auth valid:', response.userProfile?.email || 'User signed in');
            } else if (response && response.success && !response.isSignedIn) {
                this.logger.log('📭 Not signed in to Google Meet');
            } else {
                this.logger.warn('⚠️ Token check failed:', response?.error);
            }
        } catch (error) {
            // Silently fail - user can still manually sign in from popup
            this.logger.debug('Token check error (non-critical):', error.message);
        }
    }

    async migratePinnedChats() {
        if (this.logger) {
            this.logger.debug('Starting migration check...');
        }
        const migrationVersion = '1.0';

        const lastMigration = await chrome.storage.local.get('wvMigrationVersion');
        if (this.logger) {
            this.logger.debug('Last migration version', { version: lastMigration.wvMigrationVersion });
        }

        if (lastMigration.wvMigrationVersion === migrationVersion) {
            if (this.logger) {
                this.logger.debug('Migration already completed, skipping');
            }
            return;
        }

        // Migration no longer needed with IndexedDB architecture
        if (this.logger) {
            this.logger.debug('Migration skipped - using IndexedDB architecture');
        }
        await chrome.storage.local.set({ wvMigrationVersion: migrationVersion });
    }

    async initializePersistentStorage() {
        // Migration no longer needed - using SmartUserDatabase with flags approach
        this.logger.log('✅ Persistent storage initialized');
    }

    async setupChatHeaderPinButton() {
        const messageSection = document.querySelector('[data-testid="message-section"]');

        if (messageSection) {
            const chatHeader = messageSection.querySelector('.tw-p-4.tw-border-b.tw-border-slate-200.tw-rounded-t-lg.tw-absolute.tw-top-0');

            if (chatHeader) {
                await this.waitForReactUpdate();
                await this.setupPinButtonWithStateVerification(chatHeader);
            } else {
                setTimeout(() => this.setupChatHeaderPinButton(), 3000);
            }
        } else {
            setTimeout(() => this.setupChatHeaderPinButton(), 3000);
        }
    }

    async waitForReactUpdate() {
        await new Promise(resolve => setTimeout(resolve, 300));
        await new Promise(resolve => requestAnimationFrame(resolve));
        await new Promise(resolve => requestAnimationFrame(resolve));
    }

    async setupPinButtonWithStateVerification(chatHeader) {
        let retryCount = 0;
        const maxRetries = 8;
        let lastStateVerification = null;

        while (retryCount < maxRetries) {
            const stateVerification = await this.verifyChatState(chatHeader);

            this.logger.log(`🔍 State Check #${retryCount + 1}:`, {
                consistent: stateVerification.isConsistent,
                header: stateVerification.headerName,
                sidebar: stateVerification.sidebarName,
                headerLen: stateVerification.details.headerNameLength,
                sidebarLen: stateVerification.details.sidebarNameLength
            });

            if (stateVerification.isConsistent && stateVerification.details.bothHaveNames) {
                this.logger.log('✅ State consistent, setting up pin button');
                await WVFavs.DomManager.addAvatarHoverPinToChatHeader(chatHeader);

                // Also add mentions button
                if (WVFavs.DomManager.addMentionsButtonToChatHeader) {
                    await WVFavs.DomManager.addMentionsButtonToChatHeader(chatHeader);
                }

                return;
            }

            lastStateVerification = stateVerification;

            const waitTime = Math.min(100 + (retryCount * 100), 800);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            retryCount++;
        }

        if (this.logger) {
            this.logger.warn('State verification failed after retries', { lastState: lastStateVerification });
        }

        const actualChatInfo = await this.detectActualChatFromUserAction();
        if (actualChatInfo) {
            this.logger.log('🎯 Using click-detected chat info:', actualChatInfo);
            await WVFavs.DomManager.addAvatarHoverPinToChatHeaderWithInfo(chatHeader, actualChatInfo);
        } else {
            await WVFavs.DomManager.addAvatarHoverPinToChatHeader(chatHeader);
        }

        // Also add mentions button
        if (WVFavs.DomManager.addMentionsButtonToChatHeader) {
            await WVFavs.DomManager.addMentionsButtonToChatHeader(chatHeader);
        }
    }

    async verifyChatState(chatHeader) {
        const headerChatName = WVFavs.DomDataExtractor.extractChatNameFromHeader(chatHeader);
        const sidebarInfo = WVFavs.DomDataExtractor.extractActiveSidebarChatInfo();
        const isConsistent = this.chatNamesMatch(headerChatName, sidebarInfo.name);

        return {
            isConsistent,
            headerName: headerChatName,
            sidebarName: sidebarInfo.name,
            sidebarId: sidebarInfo.id,
            details: {
                headerNameLength: headerChatName ? headerChatName.length : 0,
                sidebarNameLength: sidebarInfo.name ? sidebarInfo.name.length : 0,
                bothHaveNames: !!(headerChatName && sidebarInfo.name)
            }
        };
    }

    chatNamesMatch(headerName, sidebarName) {
        if (!headerName || !sidebarName) return false;
        const cleanHeader = WVFavs.Helpers.cleanChatName(headerName).toLowerCase().trim();
        const cleanSidebar = WVFavs.Helpers.cleanChatName(sidebarName).toLowerCase().trim();
        if (cleanHeader === cleanSidebar) return true;
        if (cleanHeader.length > 3 && cleanSidebar.length > 3) {
            return cleanHeader.includes(cleanSidebar) || cleanSidebar.includes(cleanHeader);
        }
        return false;
    }

    async detectActualChatFromUserAction() {
        if (this.lastClickedSidebarChat && this.lastClickedSidebarChat.timestamp > Date.now() - 2000) {
            this.logger.log('🖱️ Using recently clicked sidebar chat:', this.lastClickedSidebarChat);
            return this.lastClickedSidebarChat.chatInfo;
        }
        return null;
    }

    // Use comprehensive 4-endpoint search strategy
    async searchChannelsAndUsers(query) {
        return await WVFavs.APIManager.comprehensiveSearch(query);
    }

    async pinChatFromInfo(chatInfo) {
        try {
            if (this.logger) {
                this.logger.debug('Pinning chat', { name: chatInfo.name, id: chatInfo.id });
            }

            // Find the most current record for this chat by name
            const currentRecord = await this.findCurrentRecordByName(chatInfo.name);

            if (!currentRecord) {
                if (this.logger) {
                    this.logger.warn(`No current record found for ${chatInfo.name}, using provided chatInfo`);
                }
                // Fallback to using the provided chatInfo if no current record found
                await this.smartUserDB.recordChatInteraction({
                    ...chatInfo,
                    isPinned: true,
                    pinnedAt: new Date().toISOString()
                });
                if (this.logger) {
                    this.logger.debug('Pinned chat in database (new record)', { name: chatInfo.name });
                }

                // Track chat pinned with new analytics system (new record case)
                if (this.logger) {
                    this.logger.analytics('chat_pinned', {
                        chat_type: 'new_record',
                        chat_id_type: chatInfo.id ? 'provided' : 'generated'
                    });
                }

                // Legacy tracking for backwards compatibility
                if (this.statsManager) {
                    this.statsManager.recordChatPinned();
                }

                WVFavs.DomManager.showSnackbar(`📍 Pinned "${chatInfo.name}"`, 'success');
                return;
            }

            if (this.logger) { this.logger.debug(`🎯 Using current record for pinning: ${currentRecord.id}`); }

            // Try to pin using the current record's ID
            const success = await this.smartUserDB.pinChat(currentRecord.id);

            if (success) {
                if (this.logger) { this.logger.debug('✅ Pinned chat in database:', chatInfo.name); }

                // Track chat pinned with new analytics system
                if (this.logger) {
                    this.logger.analytics('chat_pinned', {
                        chat_type: 'existing_record',
                        chat_id_type: 'database_id'
                    });
                }

                // Legacy tracking for backwards compatibility
                if (this.statsManager) {
                    this.statsManager.recordChatPinned();
                }

                WVFavs.DomManager.showSnackbar(`📍 Pinned "${chatInfo.name}"`, 'success');
            } else {
                if (this.logger) {
                    this.logger.warn(`Direct pin failed for ${currentRecord.id}, trying fallback`);
                }
                // Fallback to recordChatInteraction with current record data
                await this.smartUserDB.recordChatInteraction({
                    ...currentRecord,
                    isPinned: true,
                    pinnedAt: new Date().toISOString()
                });
                if (this.logger) { this.logger.debug('✅ Pinned chat in database (fallback):', chatInfo.name); }

                // Track chat pinned with new analytics system (fallback case)
                if (this.logger) {
                    this.logger.analytics('chat_pinned', {
                        chat_type: 'fallback_record',
                        chat_id_type: 'database_id'
                    });
                }

                // Legacy tracking for backwards compatibility
                if (this.statsManager) {
                    this.statsManager.recordChatPinned();
                }

                WVFavs.DomManager.showSnackbar(`📍 Pinned "${chatInfo.name}"`, 'success');
            }

            // Refresh UI to show updated data (don't await to avoid blocking)
            WVFavs.DomManager.renderPinnedChats().catch(err => {
                if (this.logger) {
                    this.logger.warn('Failed to refresh pinned chats UI', { error: err.message });
                }
            });

        } catch (error) {
            if (this.logger) {
                this.logger.error('Failed to pin chat', { error: error.message, stack: error.stack });
            }
            WVFavs.DomManager.showSnackbar('Failed to pin chat', 'error');

            // Try emergency fallback with original chatInfo
            try {
                await this.smartUserDB.recordChatInteraction({
                    ...chatInfo,
                    isPinned: true,
                    pinnedAt: new Date().toISOString()
                });
                if (this.logger) { this.logger.debug('✅ Pinned chat in database (emergency fallback):', chatInfo.name); }
                WVFavs.DomManager.showSnackbar(`📍 Pinned "${chatInfo.name}"`, 'success');
            } catch (fallbackError) {
                if (this.logger) {
                    this.logger.error('Emergency fallback also failed', { error: fallbackError.message });
                }
            }
        }
    }

    // Find the most current record for a person by name (handles transitions from name-based to API-based IDs)
    async findCurrentRecordByName(name) {
        try {
            if (this.logger) { this.logger.debug(`🔍 Finding current record for: ${name}`); }

            // Get all records with matching name to find the most current one
            const allRecords = await this.smartUserDB.getAllUsers();

            // Look for records with matching name
            const matchingRecords = allRecords.filter(record =>
                record.name === name
            );

            if (matchingRecords.length === 0) {
                if (this.logger) {
                    this.logger.debug('No records found for name', { name });
                }
                return null;
            }

            if (this.logger) {
                this.logger.debug('Found matching records for name', { name, count: matchingRecords.length });
            }

            // PRIORITY 1: API-based records (most current)
            const apiRecord = matchingRecords.find(record =>
                !record.id.toString().startsWith('name_') && !record.isNameBased
            );

            if (apiRecord) {
                if (this.logger) {
                    this.logger.debug('Using API-based record for name', { name, id: apiRecord.id });
                }
                return apiRecord;
            }

            // PRIORITY 2: Name-based records (fallback)
            const nameBasedRecord = matchingRecords.find(record =>
                record.id.toString().startsWith('name_') || record.isNameBased
            );

            if (nameBasedRecord) {
                if (this.logger) { this.logger.debug(`📝 Using name-based record for ${name}: ${nameBasedRecord.id}`); }
                return nameBasedRecord;
            }

            if (this.logger) { this.logger.debug(`❌ No usable records found for ${name}`); }
            return null;
        } catch (error) {
            if (this.logger) {
                this.logger.warn('Error finding current record by name', { error: error.message });
            }
            return null;
        }
    }

    // Helper function for name similarity calculation (shared with DomManager)
    calculateNameSimilarity(str1, str2) {
        if (!str1 || !str2) return 0.0;
        if (str1 === str2) return 1.0;

        const cleanStr1 = str1.toLowerCase().trim().replace(/\s+/g, ' ').replace(/[^\w\s-]/g, '');
        const cleanStr2 = str2.toLowerCase().trim().replace(/\s+/g, ' ').replace(/[^\w\s-]/g, '');

        if (cleanStr1 === cleanStr2) return 1.0;

        const longer = cleanStr1.length > cleanStr2.length ? cleanStr1 : cleanStr2;
        const shorter = cleanStr1.length > cleanStr2.length ? cleanStr2 : cleanStr1;

        if (longer.length === 0) return 1.0;

        return (longer.length - this.levenshteinDistance(longer, shorter)) / longer.length;
    }

    // Levenshtein distance calculation
    levenshteinDistance(str1, str2) {
        const matrix = [];

        for (let i = 0; i <= str2.length; i++) {
            matrix[i] = [i];
        }

        for (let j = 0; j <= str1.length; j++) {
            matrix[0][j] = j;
        }

        for (let i = 1; i <= str2.length; i++) {
            for (let j = 1; j <= str1.length; j++) {
                if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1, // substitution
                        matrix[i][j - 1] + 1,     // insertion
                        matrix[i - 1][j] + 1      // deletion
                    );
                }
            }
        }

        return matrix[str2.length][str1.length];
    }

    async unpinChat(chatId) {
        try {
            // First try direct ID lookup
            let chatData = await this.smartUserDB.getUser(chatId);
            let actualChatId = chatId;

            // If not found by ID, try name-based lookup for unpinning
            if (!chatData) {
                if (this.logger) { this.logger.debug('🔍 Chat not found by ID, trying name-based lookup for unpin:', chatId); }

                // For name-based IDs, search by comparing the snakeCase versions
                const pinnedChats = await this.smartUserDB.getPinnedChats();
                const nameBasedRecord = pinnedChats.find(chat => {
                    if (chatId.startsWith('name_')) {
                        // Compare using snakeCase transformation
                        const expectedId = `name_${WVFavs.Helpers.snakeCase(chat.name)}`;
                        return expectedId === chatId;
                    } else {
                        // Direct name comparison for non-name-based IDs
                        return chat.name === chatId ||
                               chat.name?.trim() === chatId?.trim() ||
                               this.calculateNameSimilarity(chat.name, chatId) >= 0.99;
                    }
                });

                if (nameBasedRecord) {
                    chatData = nameBasedRecord;
                    actualChatId = nameBasedRecord.id;
                    this.logger.debug('✅ Found pinned chat by name for unpinning:', {
                        searchId: chatId,
                        foundName: nameBasedRecord.name,
                        actualId: actualChatId
                    });
                } else {
                    if (this.logger) {
                        this.logger.warn('Chat not found in pinned records', { chatId });
                    }
                    return;
                }
            }

            // Use the dedicated unpin method with the correct ID
            const success = await this.smartUserDB.unpinChat(actualChatId);

            if (success) {
                if (this.logger) { this.logger.debug('✅ Unpinned chat in database:', chatData.name); }

                // Track chat unpinned with new analytics system
                if (this.logger) {
                    this.logger.analytics('chat_unpinned', {
                        chat_id_type: actualChatId !== chatId ? 'name_based_lookup' : 'direct_id'
                    });
                }

                WVFavs.DomManager.showSnackbar(`📍 Unpinned "${chatData.name}"`, 'success');
            } else {
                throw new Error('Unpin operation failed');
            }

            // Refresh UI to show updated data
            await WVFavs.DomManager.renderPinnedChats();
        } catch (error) {
            if (this.logger) {
                this.logger.error('Failed to unpin chat', { error: error.message, stack: error.stack });
            }
            WVFavs.DomManager.showSnackbar('Failed to unpin chat', 'error');
        }
    }


    // Modifier key detection helper - respects Windows user preference
    isModifierKeyPressed(e) {
        const isMac = navigator.userAgent.toUpperCase().indexOf('MAC') >= 0;

        // Debug logging to help troubleshoot macOS issue
        if (isMac && (e.key === '\\' || e.code === 'Backslash')) {
            this.logger.log('🍎 macOS Debug - Backslash with modifiers:', {
                metaKey: e.metaKey,
                altKey: e.altKey,
                ctrlKey: e.ctrlKey,
                shiftKey: e.shiftKey,
                settingsLoaded: !!this.settings,
                windowsModifierKey: this.settings?.get('windowsModifierKey')
            });
        }

        // macOS always uses Cmd key
        if (isMac) {
            return e.metaKey;
        }

        // Windows/Linux - check user preference (with fallback if settings not loaded)
        const windowsPref = this.settings?.get('windowsModifierKey') || 'ctrl';

        switch (windowsPref) {
            case 'ctrl':
                return e.ctrlKey;
            case 'both':
                return e.altKey || e.ctrlKey;
            case 'alt':
            default:
                return e.altKey;
        }
    }

    // Modifier key release detection helper - respects Windows user preference
    isModifierKeyReleased(e) {
        const isMac = navigator.userAgent.toUpperCase().indexOf('MAC') >= 0;

        // Debug logging for macOS Cmd key releases
        if (isMac && (e.key === 'Meta' || e.key === 'MetaLeft' || e.key === 'MetaRight')) {
            this.logger.log('🍎 macOS Debug - Cmd key released:', {
                key: e.key,
                chatSwitcherOpen: this.chatSwitcherOpen,
                settingsLoaded: !!this.settings
            });
        }

        // macOS always uses Cmd key
        if (isMac) {
            return e.key === 'Meta' || e.key === 'MetaLeft' || e.key === 'MetaRight';
        }

        // Windows/Linux - check user preference
        const windowsPref = this.settings?.get('windowsModifierKey') || 'ctrl';

        switch (windowsPref) {
            case 'ctrl':
                return e.key === 'Control' || e.key === 'ControlLeft' || e.key === 'ControlRight';
            case 'both':
                return (e.key === 'Alt' || e.key === 'AltLeft' || e.key === 'AltRight') ||
                       (e.key === 'Control' || e.key === 'ControlLeft' || e.key === 'ControlRight');
            case 'alt':
            default:
                return e.key === 'Alt' || e.key === 'AltLeft' || e.key === 'AltRight';
        }
    }

    // Load pinned chats from storage during initialization
    async loadPinnedChatsFromStorage() {
        try {
            this.pinnedChats = await this.storageManager.loadPinnedChats();
            this.logger.log('✅ Loaded', this.pinnedChats.size, 'pinned chats from storage');
        } catch (error) {
            if (this.logger) {
                this.logger.error('Error loading pinned chats', { error: error.message, stack: error.stack });
            }
            this.pinnedChats = new Map(); // Fallback to empty Map
        }
    }
}

// Initialize extension with error handling
try {
    // Check if required modules are available
    if (typeof WVFavs === 'undefined') {
        throw new Error('WVFavs module not loaded');
    }

    console.log('🚀 WorkVivo Chat Favorites - Initializing extension...');
    window.workVivoFavorites = new WorkVivoFavorites();
    console.log('✅ WorkVivoFavorites instance created');

    // Expose for debugging
    window.wvf = window.workVivoFavorites;

    // Signal to background script that extension is ready
    chrome.runtime.sendMessage({ action: 'contentScriptReady' }).catch(() => {
        // Ignore errors if background script isn't available
    });

} catch (error) {
    console.error('❌ Extension initialization failed:', error);

    // Create a minimal fallback instance for popup/options communication
    window.workVivoFavorites = {
        pinnedChats: new Map(),
        smartUserDB: {
            getPinnedChats: async () => {
                // SmartUserDB not available, returning empty array
                return [];
            }
        }
    };
    if (this.logger) { this.logger.debug('⚠️ Created fallback instance for basic functionality'); }
}

// Message handling for popup and options page communication
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    const wvf = window.workVivoFavorites;

    switch (request.action) {
        case 'ping':
            // Health check from popup
            sendResponse({ status: 'active', version: window.WVFavs?.Version?.getVersionSync() || chrome.runtime.getManifest().version });
            break;

        case 'getStatistics':
            // Get comprehensive statistics from StatisticsManager
            if (wvf && wvf.statsManager) {
                wvf.statsManager.getAllStats().then(stats => {
                    if (this.logger) { this.logger.debug('📊 Content script returning statistics:', stats); }
                    sendResponse(stats);
                }).catch(error => {
                    // Error getting statistics - handled silently
                    sendResponse({});
                });
                return true; // Indicates async response
            } else {
                if (this.logger) { this.logger.debug('⚠️ StatisticsManager not available'); }
                sendResponse({});
            }
            break;

        case 'clearStatistics':
            // Clear all statistics via StatisticsManager
            if (wvf && wvf.statsManager) {
                wvf.statsManager.clearAllStats().then(() => {
                    if (this.logger) { this.logger.debug('🗑️ Content script cleared all statistics'); }
                    sendResponse({ success: true });
                }).catch(error => {
                    // Error clearing statistics - handled silently
                    sendResponse({ success: false, error: error.message });
                });
                return true; // Indicates async response
            } else {
                if (this.logger) { this.logger.debug('⚠️ StatisticsManager not available'); }
                sendResponse({ success: false, error: 'StatisticsManager not available' });
            }
            break;

        case 'getPinnedChats':
            // Get pinned chats from IndexedDB via SmartUserDatabase
            if (wvf && wvf.smartUserDB) {
                wvf.smartUserDB.getPinnedChats().then(pinnedChats => {
                    if (this.logger) { this.logger.debug('📋 Content script returning', pinnedChats.length, 'pinned chats from IndexedDB'); }

                    // Convert to the format popup expects: [chatId, chatData] pairs
                    const pinnedArray = pinnedChats.map(chat => [
                        chat.id || chat.chatId || `name_${chat.name.replace(/\s+/g, '')}`, // Use appropriate ID
                        {
                            name: chat.name,
                            avatar: chat.avatar || { type: 'character', content: chat.name.charAt(0) },
                            url: chat.url,
                            pinnedAt: chat.pinnedAt || new Date().toISOString(),
                            nickname: chat.nickname
                        }
                    ]);

                    sendResponse(pinnedArray);
                }).catch(error => {
                    // Error getting pinned chats from IndexedDB - handled silently
                    sendResponse([]);
                });
                return true; // Indicates async response
            } else {
                if (this.logger) { this.logger.debug('⚠️ SmartUserDatabase not available'); }
                sendResponse([]);
            }
            break;

        case 'navigateToChat':
            // Navigate to specific chat from popup
            if (request.chatData && wvf) {
                const chatData = request.chatData;
                if (chatData.url) {
                    // Direct URL navigation
                    window.location.href = chatData.url;
                    sendResponse({ success: true });
                } else {
                    // For now, just acknowledge - navigation logic can be enhanced later
                    if (this.logger) { this.logger.debug('Navigate to chat requested:', chatData); }
                    sendResponse({ success: true });
                }
            } else {
                sendResponse({ success: false, error: 'Invalid chat data' });
            }
            break;

        case 'updateSettings':
            // Update settings from options page
            console.log('🔧 [SETTINGS] Received updateSettings message with:', request.settings);
            if (request.settings && wvf && wvf.settings) {
                console.log('🔧 [SETTINGS] Current settings before update:', wvf.settings.getAll());

                // Update the settings
                wvf.settings.set(request.settings).then(() => {
                    console.log('🔧 [SETTINGS] Settings updated successfully');
                    console.log('🔧 [SETTINGS] New settings after update:', wvf.settings.getAll());
                    if (this.logger) { this.logger.debug('Settings updated successfully'); }

                    // Send debug settings to page-script.js
                    document.dispatchEvent(new CustomEvent('wv-fav-debug-settings', {
                        detail: {
                            debugLogging: request.settings.debugLogging || false
                        }
                    }));

                    // Refresh pinned chats UI to apply layout changes
                    if (WVFavs && WVFavs.DomManager) {
                        console.log('🔧 [SETTINGS] Calling renderPinnedChats...');
                        WVFavs.DomManager.renderPinnedChats().catch(err => {
                            console.error('❌ [SETTINGS] Failed to refresh pinned chats:', err);
                            if (this.logger) {
                                this.logger.warn('Failed to refresh pinned chats after settings update', { error: err.message });
                            }
                        });

                        // Refresh button group to respect feature toggles
                        console.log('🔧 [SETTINGS] Calling refreshButtonGroup...');
                        WVFavs.DomManager.refreshButtonGroup().catch(err => {
                            console.error('❌ [SETTINGS] Failed to refresh button group:', err);
                            if (this.logger) {
                                this.logger.warn('Failed to refresh button group after settings update', { error: err.message });
                            }
                        });

                        console.log('🔧 [SETTINGS] Calling setupSearchButtonOverride...');
                        WVFavs.DomManager.setupSearchButtonOverride().catch(err => {
                            console.error('❌ [SETTINGS] Failed to setup search button override:', err);
                            if (this.logger) {
                                this.logger.warn('Failed to setup search button override after settings update', { error: err.message });
                            }
                        });
                    }

                    sendResponse({ success: true });
                }).catch(error => {
                    console.error('❌ [SETTINGS] Error updating settings:', error);
                    // Error updating settings - handled silently
                    sendResponse({ success: false, error: error.message });
                });
                return true; // Indicates async response
            } else {
                console.error('❌ [SETTINGS] Settings manager not available. request.settings:', !!request.settings, 'wvf:', !!wvf, 'wvf.settings:', !!wvf?.settings);
                sendResponse({ success: false, error: 'Settings manager not available' });
            }
            break;

        case 'settingsUpdated':
            // Settings updated from popup - refresh UI elements
            if (request.settings && wvf && wvf.settings) {
                // Update the settings
                wvf.settings.settings = request.settings;

                if (WVFavs && WVFavs.DomManager) {
                    // Refresh button group to show/hide buttons based on new settings
                    WVFavs.DomManager.refreshButtonGroup().catch(err => {
                        if (this.logger) {
                            this.logger.warn('Failed to refresh button group after settings update', { error: err.message });
                        }
                    });

                    // Re-run search button override setup
                    WVFavs.DomManager.setupSearchButtonOverride().catch(err => {
                        if (this.logger) {
                            this.logger.warn('Failed to setup search button override after settings update', { error: err.message });
                        }
                    });

                    // Refresh Google Meet toolbar buttons (will add/remove based on toggle)
                    WVFavs.DomManager.addGoogleMeetToolbarButton().catch(err => {
                        if (this.logger) {
                            this.logger.warn('Failed to update GMeet toolbar button after settings update', { error: err.message });
                        }
                    });
                }

                sendResponse({ success: true });
            } else {
                sendResponse({ success: false });
            }
            break;

        case 'refreshPinnedChats':
            // Refresh pinned chats from options page
            if (wvf && wvf.storageManager) {
                // Reload pinned chats from storage
                wvf.storageManager.loadPinnedChats().then(pinnedChats => {
                    wvf.pinnedChats = pinnedChats;
                    if (this.logger) { this.logger.debug('Pinned chats refreshed'); }
                    sendResponse({ success: true });
                }).catch(error => {
                    // Error refreshing pinned chats - handled silently
                    sendResponse({ success: false, error: error.message });
                });
                return true; // Indicates async response
            } else {
                sendResponse({ success: false, error: 'Extension not initialized' });
            }
            break;

        case 'clearAllPinned':
            // Clear all pinned chats
            if (wvf && wvf.pinnedChats && wvf.storageManager) {
                wvf.pinnedChats.clear();
                wvf.storageManager.savePinnedChats(wvf.pinnedChats).then(() => {
                    if (this.logger) { this.logger.debug('All pinned chats cleared'); }
                    sendResponse({ success: true });
                }).catch(error => {
                    // Error clearing pinned chats - handled silently
                    sendResponse({ success: false, error: error.message });
                });
                return true; // Indicates async response
            } else {
                sendResponse({ success: false, error: 'Extension not properly initialized' });
            }
            break;

        case 'importPinnedChats':
            // Import pinned chats from popup
            if (request.data && wvf && wvf.storageManager) {
                try {
                    const pinnedChatsMap = new Map(request.data);
                    wvf.pinnedChats = pinnedChatsMap;
                    wvf.storageManager.savePinnedChats(wvf.pinnedChats).then(() => {
                        if (this.logger) { this.logger.debug('Pinned chats imported successfully'); }
                        sendResponse({ success: true });
                    }).catch(error => {
                        // Error importing pinned chats - handled silently
                        sendResponse({ success: false, error: error.message });
                    });
                    return true; // Indicates async response
                } catch (error) {
                    // Error processing import data - handled silently
                    sendResponse({ success: false, error: 'Invalid import data format' });
                }
            } else {
                sendResponse({ success: false, error: 'Extension not initialized or no data provided' });
            }
            break;

        default:
            // Unknown message action - handled silently
            sendResponse({ success: false, error: 'Unknown action' });
            break;
    }

    // Default synchronous response for most cases
    return false;
});