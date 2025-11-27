var WVFavs = WVFavs || {};

WVFavs.StorageManager = new (class StorageManager {
    constructor() {
        // Use direct console methods to avoid circular dependency with Logger
        // Logger itself tries to load settings from storage, creating a deadlock
        this.logger = {
            debug: (...args) => console.log(...args),
            warn: (...args) => console.warn(...args),
            error: (...args) => console.error(...args),
            log: (...args) => console.log(...args)
        };
    }

    async loadPinnedChats() {
        try {
            const result = await chrome.storage.sync.get(['workvivoFavorites']);
            if (result.workvivoFavorites) {
                return new Map(result.workvivoFavorites);
            }
        } catch (error) {
            this.logger.error('Error loading pinned chats:', error);
        }
        return new Map();
    }

    async savePinnedChats(pinnedChats) {
        // Use ContextManager for safe storage operations
        if (typeof WVFavs !== 'undefined' && WVFavs.ContextManager) {
            const success = await WVFavs.ContextManager.safeSyncStorageSet({
                workvivoFavorites: Array.from(pinnedChats.entries())
            });
            if (!success) {
                this.logger.warn('Failed to save pinned chats - context invalid');
            }
            return;
        }

        // Fallback to original method
        try {
            if (!chrome.runtime?.id) {
                this.logger.warn('Extension context invalidated - skipping pinned chats save');
                return;
            }
            await chrome.storage.sync.set({
                workvivoFavorites: Array.from(pinnedChats.entries())
            });
        } catch (error) {
            if (error.message?.includes('Extension context invalidated')) {
                this.logger.warn('Extension context invalidated during pinned chats save - this is normal during extension updates');
            } else {
                this.logger.error('Error saving pinned chats:', error);
            }
        }
    }

    // DEPRECATED: Chat history now uses IndexedDB exclusively (v2.0+)
    // These methods are kept for legacy compatibility but should not be used
    async loadChatHistory() {
        this.logger.warn('⚠️ DEPRECATED: loadChatHistory() - Chat history now uses IndexedDB exclusively');
        return { recents: [], current: null };
    }

    async saveChatHistory(chatHistory) {
        this.logger.warn('⚠️ DEPRECATED: saveChatHistory() - Chat history now uses IndexedDB exclusively');
        // No-op - do nothing
    }

    async loadSettings(defaultSettings) {
        this.logger.debug('📝 StorageManager.loadSettings() called');

        // IMPORTANT: Use callback-based API wrapped in Promise with timeout
        // The await-based chrome.storage API seems to hang in this context

        // Try sync storage first
        try {
            this.logger.debug('📝 Attempting chrome.storage.sync.get() with callback...');

            const syncResult = await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    this.logger.warn('⚠️ Sync storage timeout after 1s');
                    reject(new Error('Sync storage timeout'));
                }, 1000);

                try {
                    chrome.storage.sync.get(['workvivoSettings'], (result) => {
                        clearTimeout(timeout);
                        if (chrome.runtime.lastError) {
                            reject(chrome.runtime.lastError);
                        } else {
                            resolve(result);
                        }
                    });
                } catch (err) {
                    clearTimeout(timeout);
                    reject(err);
                }
            });

            this.logger.debug('✅ chrome.storage.sync.get() returned:', syncResult);

            if (syncResult.workvivoSettings) {
                this.logger.debug('📝 Found settings in sync storage, using them');
                const settings = { ...defaultSettings, ...syncResult.workvivoSettings };
                if (!settings.windowsModifierKey) {
                    settings.windowsModifierKey = 'ctrl';
                }
                if (!settings.floatingWidgetFirstClick) {
                    settings.floatingWidgetFirstClick = 'recents';
                }
                this.logger.debug('✅ Returning merged settings from sync storage');
                return settings;
            } else {
                this.logger.debug('📝 No settings in sync storage, trying local...');
            }
        } catch (error) {
            this.logger.warn('⚠️ Error loading from sync storage:', error.message);
            // Try local as fallback
        }

        // Fallback to local storage
        try {
            this.logger.debug('📝 Attempting chrome.storage.local.get() with callback...');

            const localResult = await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    this.logger.warn('⚠️ Local storage timeout after 1s');
                    reject(new Error('Local storage timeout'));
                }, 1000);

                try {
                    chrome.storage.local.get(['workvivoSettings'], (result) => {
                        clearTimeout(timeout);
                        if (chrome.runtime.lastError) {
                            reject(chrome.runtime.lastError);
                        } else {
                            resolve(result);
                        }
                    });
                } catch (err) {
                    clearTimeout(timeout);
                    reject(err);
                }
            });

            this.logger.debug('✅ chrome.storage.local.get() returned:', localResult);

            if (localResult.workvivoSettings) {
                this.logger.debug('📝 Found settings in local storage, using them');
                const settings = { ...defaultSettings, ...localResult.workvivoSettings };
                if (!settings.windowsModifierKey) {
                    settings.windowsModifierKey = 'ctrl';
                }
                if (!settings.floatingWidgetFirstClick) {
                    settings.floatingWidgetFirstClick = 'recents';
                }
                this.logger.debug('✅ Returning merged settings from local storage');
                // Migrate to sync storage for future
                try {
                    await chrome.storage.sync.set({ workvivoSettings: settings });
                    this.logger.debug('✅ Migrated settings from local to sync storage');
                } catch (e) {
                    this.logger.warn('⚠️ Could not migrate to sync storage:', e.message);
                }
                return settings;
            } else {
                this.logger.debug('📝 No settings in local storage either');
            }
        } catch (error) {
            this.logger.warn('⚠️ Error loading from local storage:', error.message);
        }

        this.logger.debug('✅ Returning default settings');
        return defaultSettings;
    }

    async saveSettings(settings) {
        // Save to sync storage for cross-device sync
        try {
            if (!chrome.runtime?.id) {
                this.logger.warn('Extension context invalidated - skipping settings save');
                return;
            }
            await chrome.storage.sync.set({
                workvivoSettings: settings
            });
            this.logger.debug('✅ Settings saved to sync storage');
        } catch (error) {
            if (error.message?.includes('Extension context invalidated')) {
                this.logger.warn('Extension context invalidated during settings save - this is normal during extension updates');
            } else {
                this.logger.error('Error saving settings to sync storage:', error);
                // Fallback to local storage if sync fails
                try {
                    await chrome.storage.local.set({
                        workvivoSettings: settings
                    });
                    this.logger.debug('✅ Settings saved to local storage as fallback');
                } catch (localError) {
                    this.logger.error('Error saving settings to local storage:', localError);
                }
            }
        }
    }
})();