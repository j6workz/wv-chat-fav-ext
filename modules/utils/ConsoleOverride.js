/**
 * Console Override for WorkVivo Chat Favorites Extension
 * Respects debug logging settings and reduces console noise
 */

class ConsoleOverride {
    constructor() {
        this.originalConsole = {
            log: console.log,
            warn: console.warn,
            error: console.error,
            debug: console.debug,
            info: console.info
        };

        this.debugEnabled = false;
        this.settingsLoaded = false;

        // Store instance globally for debugging
        if (typeof window !== 'undefined') {
            window.WVFavs = window.WVFavs || {};
            window.WVFavs.ConsoleOverrideInstance = this;
        }

        // CRITICAL: Apply override immediately with conservative defaults (debug OFF)
        // This prevents logs from showing during async initialization
        this.applyOverride();

        // Then load settings and re-apply if needed
        this.init();
    }

    async init() {
        try {
            await this.loadDebugSettings();
            this.applyOverride();
        } catch (error) {
            // Fallback to conservative logging
            this.debugEnabled = false;
            this.applyOverride();
        }
    }

    async loadDebugSettings() {
        try {
            // Try sync storage first (where settings are actually stored)
            let result = await chrome.storage.sync.get(['workvivoSettings']);
            let settings = result.workvivoSettings;

            // Fallback to local storage if not found in sync
            if (!settings) {
                result = await chrome.storage.local.get(['workvivoSettings']);
                settings = result.workvivoSettings;
            }

            this.debugEnabled = settings?.debugLogging === true;
            this.settingsLoaded = true;
        } catch (error) {
            // Storage not available, assume debug disabled
            this.debugEnabled = false;
            this.settingsLoaded = true;
        }
    }

    applyOverride() {
        // Override console methods
        console.log = (...args) => {
            // Show logs if debug is enabled OR if it's NOT an extension message (host page logs)
            const isExtMsg = this.isExtensionMessage(args);
            if (this.debugEnabled || !isExtMsg) {
                this.originalConsole.log(...args);
            }
        };

        console.debug = (...args) => {
            if (this.debugEnabled) {
                this.originalConsole.debug(...args);
            }
        };

        console.info = (...args) => {
            // Show info if debug is enabled OR if it's NOT an extension message (host page info)
            if (this.debugEnabled || !this.isExtensionMessage(args)) {
                this.originalConsole.info(...args);
            }
        };

        // Use console.log for warnings/errors to avoid Chrome extension error panel pollution
        console.warn = (...args) => {
            if (this.isExtensionMessage(args)) {
                // Only show extension warnings when debug is enabled
                if (this.debugEnabled) {
                    // Use console.log instead of console.warn to avoid Chrome error panel
                    this.originalConsole.log('[WV-Fav] ⚠️', ...args);
                }
            } else {
                // Let host page warnings through as-is
                this.originalConsole.warn(...args);
            }
        };

        console.error = (...args) => {
            if (this.isExtensionMessage(args)) {
                // Only show extension errors when debug is enabled
                if (this.debugEnabled) {
                    // Use console.log instead of console.error to avoid Chrome error panel
                    this.originalConsole.log('[WV-Fav] ❌', ...args);
                }
            } else {
                // Let host page errors through as-is
                this.originalConsole.error(...args);
            }
        };
    }

    isExtensionMessage(args) {
        if (!args || args.length === 0) return false;

        const firstArg = String(args[0]);
        const lowerFirstArg = firstArg.toLowerCase();

        // Check if first character is non-ASCII (likely an emoji)
        if (firstArg.length > 0 && firstArg.charCodeAt(0) > 127) {
            return true;
        }

        // Check for common extension log patterns
        return lowerFirstArg.includes('workvivo') ||
               lowerFirstArg.includes('[wv') ||           // [WV STATUS], [WV-StatusManager], etc.
               lowerFirstArg.includes('[status]') ||      // [STATUS]
               lowerFirstArg.includes('[sm-') ||          // [SM-1], [SM-2], etc.
               lowerFirstArg.includes('statusmanager') ||
               lowerFirstArg.includes('statusdialog') ||
               lowerFirstArg.includes('storagemanager') ||
               lowerFirstArg.includes('[cleanup]') ||
               lowerFirstArg.includes('webpack') ||
               lowerFirstArg.includes('dommanager') ||
               lowerFirstArg.includes('draftmanager') ||
               lowerFirstArg.includes('mentionsmanager') ||
               lowerFirstArg.includes('threadmanager') ||
               lowerFirstArg.includes('[drafts]') ||
               lowerFirstArg.includes('[mentions]') ||
               lowerFirstArg.includes('[page script]') ||
               lowerFirstArg.includes('analytics') ||
               lowerFirstArg.includes('privacy') ||
               lowerFirstArg.includes('jurisdiction') ||
               lowerFirstArg.includes('chrome.storage') ||
               lowerFirstArg.includes('init()') ||
               lowerFirstArg.includes('completed') ||
               lowerFirstArg.includes('calling') ||
               lowerFirstArg.includes('creating') ||
               lowerFirstArg.includes('options') ||
               lowerFirstArg.includes('popup') ||
               lowerFirstArg.includes('background') ||
               lowerFirstArg.includes('smart') ||
               lowerFirstArg.includes('favorites');
    }

    isImportantMessage(args) {
        if (!args || args.length === 0) return false;

        const firstArg = String(args[0]).toLowerCase();
        return firstArg.includes('error') ||
               firstArg.includes('failed') ||
               firstArg.includes('warning') ||
               firstArg.includes('✅') ||
               firstArg.includes('❌') ||
               firstArg.includes('🎉') ||
               firstArg.includes('initialized') ||
               firstArg.includes('ready');
    }

    // Method to restore original console (for testing)
    restore() {
        Object.assign(console, this.originalConsole);
    }

    // Method to update debug setting
    async updateDebugSetting(enabled) {
        this.debugEnabled = enabled;
        // Re-apply override with new setting
        this.applyOverride();
    }

    // Method to temporarily enable debug for testing
    enableDebugTemporarily(duration = 30000) {
        const wasEnabled = this.debugEnabled;
        this.debugEnabled = true;
        this.applyOverride();

        setTimeout(() => {
            this.debugEnabled = wasEnabled;
            this.applyOverride();
        }, duration);
    }
}

// Initialize console override immediately
const consoleOverride = new ConsoleOverride();

// Make available globally for debugging
if (typeof window !== 'undefined') {
    window.WVFavs = window.WVFavs || {};
    window.WVFavs.ConsoleOverride = consoleOverride;

    // Debug helper
    window.wvDebugLogs = (enable = true) => {
        consoleOverride.updateDebugSetting(enable);
        console.log(`🔍 Debug logging ${enable ? 'ENABLED' : 'DISABLED'}`);
    };
}

// Export for Node.js environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ConsoleOverride;
}