/**
 * FeatureStabilityManager - Centralized Feature Stability Control
 *
 * Fetches and caches feature stability configuration from a remote JSON file.
 * Allows the admin to disable specific features globally when issues are detected,
 * preventing broken functionality from affecting users until a fix is released.
 *
 * Features:
 * - Version-controlled feature toggles (minVersion, maxVersion)
 * - Fail-safe defaults (all features enabled if config unavailable)
 * - Local caching with 30-minute refresh
 * - User opt-out capability
 * - Announcements support
 *
 * @version 1.0.0
 */

var WVFavs = WVFavs || {};

WVFavs.FeatureStabilityManager = class FeatureStabilityManager {
    constructor(app) {
        this.app = app;
        this.logger = app?.logger || { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

        // Configuration
        this.config = null;
        this.configUrl = 'https://raw.githubusercontent.com/j6workz/wv-chat-fav-ext/main/feature-stability.json';
        this.cacheKey = 'wvfav_feature_stability';
        this.cacheTimestampKey = 'wvfav_feature_stability_timestamp';
        this.cacheDuration = 30 * 60 * 1000; // 30 minutes
        this.extensionVersion = null;

        // State
        this.initialized = false;
        this.lastFetchTime = null;
        this.fetchInProgress = false;

        this.logger.info('FeatureStabilityManager initialized');
    }

    /**
     * Initialize the manager - load from cache first, then fetch fresh config
     */
    async init() {
        try {
            // Get extension version
            this.extensionVersion = chrome.runtime?.getManifest?.()?.version || '0.0.0';
            this.logger.debug(`Extension version: ${this.extensionVersion}`);

            // Check if user has opted out of feature stability
            const settings = this.app?.settings;
            if (settings && settings.get('enableFeatureStability') === false) {
                this.logger.info('Feature stability control is disabled by user');
                this.initialized = true;
                return null;
            }

            // 1. Load from cache first (non-blocking for fast startup)
            this.config = await this.loadFromCache();

            if (this.config) {
                this.logger.info('Loaded feature stability config from cache');
            }

            // 2. Fetch fresh config in background (don't await)
            this.fetchConfigInBackground();

            this.initialized = true;
            return this.config;

        } catch (error) {
            this.logger.error('Failed to initialize FeatureStabilityManager:', error);
            this.initialized = true; // Mark as initialized even on failure (fail-safe)
            return null;
        }
    }

    /**
     * Load config from local storage cache
     */
    async loadFromCache() {
        try {
            const result = await chrome.storage.local.get([this.cacheKey, this.cacheTimestampKey]);

            if (!result[this.cacheKey]) {
                return null;
            }

            const cachedConfig = result[this.cacheKey];
            const timestamp = result[this.cacheTimestampKey] || 0;

            // Check if cache is still valid
            const age = Date.now() - timestamp;
            if (age > this.cacheDuration) {
                this.logger.debug('Cache expired, will refresh');
            }

            return cachedConfig;

        } catch (error) {
            this.logger.warn('Failed to load from cache:', error);
            return null;
        }
    }

    /**
     * Save config to local storage cache
     */
    async saveToCache(config) {
        try {
            await chrome.storage.local.set({
                [this.cacheKey]: config,
                [this.cacheTimestampKey]: Date.now()
            });
            this.logger.debug('Saved feature stability config to cache');
        } catch (error) {
            this.logger.warn('Failed to save to cache:', error);
        }
    }

    /**
     * Fetch fresh config from remote URL (non-blocking background operation)
     */
    fetchConfigInBackground() {
        if (this.fetchInProgress) {
            return;
        }

        this.fetchInProgress = true;

        this.fetchConfig()
            .catch(error => {
                this.logger.warn('Background config fetch failed:', error.message);
            })
            .finally(() => {
                this.fetchInProgress = false;
            });
    }

    /**
     * Fetch fresh config from remote URL
     */
    async fetchConfig() {
        try {
            this.logger.debug('Fetching feature stability config...');

            const response = await fetch(this.configUrl, {
                cache: 'no-store',
                headers: {
                    'Accept': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const config = await response.json();

            // Validate config structure
            if (!this.validateConfig(config)) {
                throw new Error('Invalid config structure');
            }

            // Update config and cache
            this.config = config;
            this.lastFetchTime = Date.now();
            await this.saveToCache(config);

            this.logger.info('Feature stability config updated successfully');

            return config;

        } catch (error) {
            this.logger.warn('Feature stability config fetch failed:', error.message);
            throw error;
        }
    }

    /**
     * Validate the config structure
     */
    validateConfig(config) {
        if (!config || typeof config !== 'object') {
            return false;
        }

        // Must have version
        if (!config.version) {
            return false;
        }

        // Features must be an object if present
        if (config.features && typeof config.features !== 'object') {
            return false;
        }

        // Announcements must be an array if present
        if (config.announcements && !Array.isArray(config.announcements)) {
            return false;
        }

        return true;
    }

    /**
     * Check if a feature is enabled
     * Returns true (enabled) if:
     * - No config available (fail-safe)
     * - Feature not defined in config (unknown features default to enabled)
     * - Feature enabled flag is true AND version constraints satisfied
     *
     * @param {string} featureName - The feature name to check
     * @returns {boolean} - Whether the feature is enabled
     */
    isFeatureEnabled(featureName) {
        // Check if user has opted out
        const settings = this.app?.settings;
        if (settings && settings.get('enableFeatureStability') === false) {
            return true; // All features enabled when opted out
        }

        // Emergency disable - all features off
        if (this.config?.emergencyDisable) {
            this.logger.warn(`Emergency disable active - all features disabled`);
            return false;
        }

        // No config - fail-safe, allow all features
        if (!this.config) {
            return true;
        }

        const feature = this.config.features?.[featureName];

        // Unknown feature - default to enabled
        if (!feature) {
            return true;
        }

        // Check if version is within the constraint range
        const meetsMinVersion = !feature.minVersion || this.isVersionGte(this.extensionVersion, feature.minVersion);
        const meetsMaxVersion = !feature.maxVersion || this.isVersionLte(this.extensionVersion, feature.maxVersion);
        const versionInRange = meetsMinVersion && meetsMaxVersion;

        // If enabled is false AND version is in range, feature is disabled
        // If enabled is false BUT version is OUTSIDE range, feature is enabled (not affected)
        if (feature.enabled === false) {
            // Only disable if version is within the affected range
            if (versionInRange) {
                return false; // Feature disabled for this version
            }
            // Version is outside the range, so this disable rule doesn't apply
            return true;
        }

        // If enabled is true but version constraints exist and aren't met, disable
        if (!versionInRange) {
            return false;
        }

        return true;
    }

    /**
     * Get the message for a disabled feature
     */
    getFeatureMessage(featureName) {
        return this.config?.features?.[featureName]?.message || null;
    }

    /**
     * Get all disabled features with their messages
     */
    getDisabledFeatures() {
        const disabled = [];

        if (!this.config?.features) {
            return disabled;
        }

        for (const [name, feature] of Object.entries(this.config.features)) {
            if (!this.isFeatureEnabled(name)) {
                disabled.push({
                    name,
                    message: feature.message || 'Temporarily disabled',
                    minVersion: feature.minVersion,
                    maxVersion: feature.maxVersion
                });
            }
        }

        return disabled;
    }

    /**
     * Get active announcements for current version
     */
    getAnnouncements() {
        if (!this.config?.announcements) {
            return [];
        }

        return this.config.announcements.filter(announcement => {
            // Check if announcement targets specific versions
            if (announcement.targetVersions && announcement.targetVersions.length > 0) {
                return announcement.targetVersions.includes(this.extensionVersion);
            }
            return true;
        });
    }

    /**
     * Mark an announcement as seen
     */
    async markAnnouncementSeen(announcementId) {
        try {
            const key = `wvfav_announcement_seen_${announcementId}`;
            await chrome.storage.local.set({ [key]: Date.now() });
        } catch (error) {
            this.logger.warn('Failed to mark announcement as seen:', error);
        }
    }

    /**
     * Check if an announcement has been seen
     */
    async isAnnouncementSeen(announcementId) {
        try {
            const key = `wvfav_announcement_seen_${announcementId}`;
            const result = await chrome.storage.local.get(key);
            return !!result[key];
        } catch (error) {
            return false;
        }
    }

    /**
     * Get unseen announcements
     */
    async getUnseenAnnouncements() {
        const announcements = this.getAnnouncements();
        const unseen = [];

        for (const announcement of announcements) {
            if (announcement.showOnce) {
                const seen = await this.isAnnouncementSeen(announcement.id);
                if (!seen) {
                    unseen.push(announcement);
                }
            } else {
                unseen.push(announcement);
            }
        }

        return unseen;
    }

    /**
     * Compare two semantic version strings: v1 >= v2
     */
    isVersionGte(v1, v2) {
        const parts1 = v1.split('.').map(Number);
        const parts2 = v2.split('.').map(Number);

        for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
            const p1 = parts1[i] || 0;
            const p2 = parts2[i] || 0;

            if (p1 > p2) return true;
            if (p1 < p2) return false;
        }

        return true; // Equal versions
    }

    /**
     * Compare two semantic version strings: v1 <= v2
     */
    isVersionLte(v1, v2) {
        const parts1 = v1.split('.').map(Number);
        const parts2 = v2.split('.').map(Number);

        for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
            const p1 = parts1[i] || 0;
            const p2 = parts2[i] || 0;

            if (p1 < p2) return true;
            if (p1 > p2) return false;
        }

        return true; // Equal versions
    }

    /**
     * Get diagnostic information
     */
    getDiagnostics() {
        return {
            initialized: this.initialized,
            configLoaded: !!this.config,
            configVersion: this.config?.version || null,
            extensionVersion: this.extensionVersion,
            lastFetchTime: this.lastFetchTime,
            emergencyDisable: this.config?.emergencyDisable || false,
            disabledFeatures: this.getDisabledFeatures(),
            announcements: this.getAnnouncements()
        };
    }

    /**
     * Force refresh config from remote
     */
    async forceRefresh() {
        try {
            await this.fetchConfig();
            return true;
        } catch (error) {
            return false;
        }
    }
};

// Expose for debugging
if (typeof window !== 'undefined') {
    window.wvFeatureStability = null; // Will be set when initialized
}
