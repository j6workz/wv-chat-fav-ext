var WVFavs = WVFavs || {};

WVFavs.CacheManager = new (class CacheManager {
    constructor() {
        this.searchCache = new Map();
        this.userProfileCache = new Map();
        this.conversationMappingCache = new Map();
        this.channelInfoCache = new Map(); // Cache for channel information
        this.CACHE_TTL = 15 * 60 * 1000; // 15 minutes
        this.PROFILE_CACHE_TTL = 60 * 60 * 1000; // 1 hour
        this.MAX_CACHE_ENTRIES = 100;
    }

    get(cacheName, key) {
        const cache = this[cacheName];
        if (cache && cache.has(key)) {
            const cached = cache.get(key);
            if (cached.timestamp > Date.now() - this.CACHE_TTL) {
                // Cache hit - record it
                if (window.wvf && window.wvf.statsManager) {
                    window.wvf.statsManager.recordCacheHit();
                }
                return cached.data;
            }
        }

        // Cache miss - record it
        if (window.wvf && window.wvf.statsManager) {
            window.wvf.statsManager.recordCacheMiss();
        }
        return null;
    }

    set(cacheName, key, data) {
        const cache = this[cacheName];
        if (cache) {
            cache.set(key, {
                data,
                timestamp: Date.now()
            });

            if (cache.size > this.MAX_CACHE_ENTRIES) {
                const oldestKey = cache.keys().next().value;
                cache.delete(oldestKey);
            }
        }
    }

    getStats() {
        return {
            searchCacheSize: this.searchCache.size,
            userProfileCacheSize: this.userProfileCache.size,
            conversationMappingCacheSize: this.conversationMappingCache.size,
            channelInfoCacheSize: this.channelInfoCache.size,
        };
    }

    clearAll() {
        this.searchCache.clear();
        this.userProfileCache.clear();
        this.conversationMappingCache.clear();
        this.channelInfoCache.clear();
    }
})();