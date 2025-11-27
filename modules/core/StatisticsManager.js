var WVFavs = WVFavs || {};

WVFavs.StatisticsManager = class StatisticsManager {
    constructor() {
        this.smartUserDB = null;
        this.stats = {
            searchWidgetOpened: 0,
            searchesPerformed: 0,
            chatClicks: 0,
            chatsPinned: 0,
            chatSwitcherOpened: 0,
            switcherSelections: 0,
            cacheHits: 0,
            cacheMisses: 0,
            lastUpdated: new Date().toISOString()
        };
        this.isInitialized = false;
    }

    init(smartUserDB, logger = null) {
        this.smartUserDB = smartUserDB;
        this.logger = logger;
        this.loadStats();
        this.isInitialized = true;
        if (this.logger) {
            this.logger.log('📊 StatisticsManager initialized');
        }
    }

    async loadStats() {
        if (!this.smartUserDB) {
            console.warn('⚠️ StatisticsManager: SmartUserDB not available for loading stats');
            return;
        }

        if (!this.smartUserDB.isReady) {
            console.warn('⚠️ StatisticsManager: SmartUserDB not ready yet, skipping IndexedDB stats load');
            // Still try to load from chrome.storage as fallback
            try {
                const result = await chrome.storage.sync.get(['workvivoStatistics']);
                if (result.workvivoStatistics) {
                    this.stats = { ...this.stats, ...result.workvivoStatistics };
                    if (this.logger) {
                        this.logger.log('📊 Statistics loaded from chrome.storage fallback');
                    }
                }
            } catch (error) {
                console.error('Error loading statistics from chrome.storage:', error);
            }
            return;
        }

        try {
            // Load from IndexedDB first (primary source)
            const indexedStats = await this.smartUserDB.getStatistics();
            if (indexedStats) {
                this.stats = { ...this.stats, ...indexedStats };
                if (this.logger) {
                    this.logger.log('📊 Statistics loaded from IndexedDB:', this.stats);
                }
            }

            // Load from chrome.storage as fallback/merge (for sync across devices)
            const result = await chrome.storage.sync.get(['workvivoStatistics']);
            if (result.workvivoStatistics) {
                // Merge, preferring IndexedDB values but taking max for counters
                Object.keys(result.workvivoStatistics).forEach(key => {
                    if (typeof result.workvivoStatistics[key] === 'number') {
                        this.stats[key] = Math.max(this.stats[key] || 0, result.workvivoStatistics[key]);
                    }
                });
                if (this.logger) {
                    this.logger.log('📊 Statistics merged with chrome.storage fallback');
                }
            }
        } catch (error) {
            console.error('Error loading statistics:', error);
        }
    }

    async incrementStat(statName) {
        if (!this.isInitialized) {
            console.warn('⚠️ StatisticsManager not initialized, queuing increment for:', statName);
            // Could implement a queue here for early events
            return;
        }

        try {
            this.stats[statName] = (this.stats[statName] || 0) + 1;
            this.stats.lastUpdated = new Date().toISOString();

            if (this.logger) {
                this.logger.log(`📈 ${statName} incremented to ${this.stats[statName]}`);
            }

            // Save to both storage locations for redundancy
            const savePromises = [];

            if (this.smartUserDB) {
                savePromises.push(this.smartUserDB.saveStatistics(this.stats));
            }

            // Always backup to chrome.storage (works even when WorkVivo closed)
            savePromises.push(chrome.storage.sync.set({ workvivoStatistics: this.stats }));

            await Promise.all(savePromises);

        } catch (error) {
            console.error(`Error incrementing ${statName}:`, error);
        }
    }

    // Convenience methods for common tracking
    recordSearchWidgetOpened() {
        this.incrementStat('searchWidgetOpened');
    }

    recordSearchPerformed() {
        this.incrementStat('searchesPerformed');
    }

    recordChatClick() {
        this.incrementStat('chatClicks');
    }

    recordChatPinned() {
        this.incrementStat('chatsPinned');
    }

    recordChatSwitcherOpened() {
        this.incrementStat('chatSwitcherOpened');
    }

    recordSwitcherSelection() {
        this.incrementStat('switcherSelections');
    }

    recordCacheHit() {
        this.incrementStat('cacheHits');
    }

    recordCacheMiss() {
        this.incrementStat('cacheMisses');
    }

    calculateCacheHitRate() {
        const total = (this.stats.cacheHits || 0) + (this.stats.cacheMisses || 0);
        if (total === 0) return 0;
        return Math.round((this.stats.cacheHits / total) * 100);
    }

    async getAllStats() {
        try {
            // Get base stats
            const baseStats = { ...this.stats };

            // Add calculated live metrics if SmartUserDB is available
            if (this.smartUserDB) {
                const [pinnedCount, userCount, keywordCount] = await Promise.all([
                    this.smartUserDB.getPinnedChatsCount().catch(() => 0),
                    this.smartUserDB.getUserCount().catch(() => 0),
                    this.smartUserDB.getKeywordCount().catch(() => 0)
                ]);

                baseStats.currentlyPinned = pinnedCount;
                baseStats.usersInDatabase = userCount;
                baseStats.keywordsIndexed = keywordCount;
            }

            // Add calculated cache hit rate
            baseStats.cacheHitRate = this.calculateCacheHitRate();

            return baseStats;
        } catch (error) {
            console.error('Error getting all stats:', error);
            return { ...this.stats, cacheHitRate: this.calculateCacheHitRate() };
        }
    }

    async clearAllStats() {
        try {
            // Reset all counters
            this.stats = {
                searchWidgetOpened: 0,
                searchesPerformed: 0,
                chatClicks: 0,
                chatsPinned: 0,
                chatSwitcherOpened: 0,
                switcherSelections: 0,
                cacheHits: 0,
                cacheMisses: 0,
                lastUpdated: new Date().toISOString()
            };

            // Clear from both storage locations
            const clearPromises = [];

            if (this.smartUserDB) {
                clearPromises.push(this.smartUserDB.clearStatistics());
            }

            clearPromises.push(chrome.storage.sync.remove(['workvivoStatistics']));

            await Promise.all(clearPromises);

            if (this.logger) {
                this.logger.log('🗑️ All statistics cleared');
            }
        } catch (error) {
            console.error('Error clearing statistics:', error);
            throw error;
        }
    }

    // Fallback method for when WorkVivo tab is not available
    async getStatsFromStorage() {
        try {
            const result = await chrome.storage.sync.get(['workvivoStatistics']);
            if (result.workvivoStatistics) {
                return {
                    ...result.workvivoStatistics,
                    cacheHitRate: this.calculateCacheHitRate.call({ stats: result.workvivoStatistics })
                };
            }
            return this.stats;
        } catch (error) {
            console.error('Error getting stats from storage:', error);
            return this.stats;
        }
    }
};