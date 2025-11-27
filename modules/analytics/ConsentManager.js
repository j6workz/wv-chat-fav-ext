/**
 * Consent Manager for WorkVivo Favorites Extension
 * Implements tiered consent system based on jurisdiction
 */

class ConsentManager {
    constructor() {
        this.jurisdictionDetector = null;
        this.isInitialized = false;
        this.debugLogging = false;
    }

    /**
     * Initialize the consent manager
     */
    async init() {
        if (this.isInitialized) return;

        // Initialize jurisdiction detector
        if (window.WVFavs && window.WVFavs.JurisdictionDetector) {
            this.jurisdictionDetector = new window.WVFavs.JurisdictionDetector();
            await this.jurisdictionDetector.init();
        }

        // Load debug logging setting
        const settings = await this.loadSettings();
        this.debugLogging = settings.debugLogging || false;

        this.isInitialized = true;
    }

    /**
     * Load settings from chrome storage
     */
    async loadSettings() {
        return new Promise((resolve) => {
            chrome.storage.sync.get(['debugLogging'], (result) => {
                resolve(result);
            });
        });
    }

    /**
     * Get current consent status
     */
    async getConsentStatus() {
        if (!this.isInitialized) await this.init();

        return new Promise((resolve) => {
            chrome.storage.sync.get([
                'analyticsConsent',
                'analyticsConsentTimestamp',
                'analyticsConsentVersion',
                'hasSeenConsentPrompt',
                'analyticsEnabled',
                'shareUsageData',
                'errorReporting'
            ], (result) => {
                resolve({
                    hasConsent: result.analyticsConsent || false,
                    timestamp: result.analyticsConsentTimestamp || null,
                    version: result.analyticsConsentVersion || null,
                    hasSeenPrompt: result.hasSeenConsentPrompt || false,
                    analyticsEnabled: result.analyticsEnabled || false,
                    shareUsageData: result.shareUsageData || false,
                    errorReporting: result.errorReporting !== false // Default true
                });
            });
        });
    }

    /**
     * Determine if user needs to see consent prompt
     */
    async needsConsentPrompt() {
        if (!this.isInitialized) await this.init();

        const jurisdiction = await this.jurisdictionDetector.getJurisdictionInfo();
        const consentStatus = await this.getConsentStatus();

        // For strict consent jurisdictions (GDPR, etc.)
        if (jurisdiction.requiresStrictConsent) {
            // Show prompt if they haven't seen it OR haven't given consent
            if (!consentStatus.hasSeenPrompt || !consentStatus.hasConsent) {
                return {
                    needsPrompt: true,
                    reason: 'strict_jurisdiction',
                    jurisdiction: jurisdiction
                };
            }
        }

        return {
            needsPrompt: false,
            jurisdiction: jurisdiction
        };
    }

    /**
     * Apply default analytics settings based on jurisdiction
     */
    async applyDefaultSettings(jurisdiction = null) {
        if (!jurisdiction) {
            if (!this.isInitialized) await this.init();
            jurisdiction = await this.jurisdictionDetector.getJurisdictionInfo();
        }

        const currentConsent = await this.getConsentStatus();

        // If user has already seen prompt and made a choice, respect that
        if (currentConsent.hasSeenPrompt) {
            if (this.debugLogging) {
                console.log('🔒 User has already made consent choice, respecting that');
            }
            return currentConsent;
        }

        const privacyRequirement = jurisdiction.privacyRequirement;
        let defaultSettings = {};

        if (privacyRequirement === 'strict_consent') {
            // GDPR and strict US states: Opt-out required, default OFF
            defaultSettings = {
                analyticsEnabled: false,
                shareUsageData: false,
                errorReporting: true, // Always enabled for critical bugs
                analyticsConsent: false,
                hasSeenConsentPrompt: false // Will show prompt
            };
        } else if (privacyRequirement === 'opt_in_permissible') {
            // Permissive jurisdictions: Can opt-in by default
            defaultSettings = {
                analyticsEnabled: true,
                shareUsageData: false, // Still conservative on device data
                errorReporting: true,
                analyticsConsent: true,
                hasSeenConsentPrompt: true // Auto-consented, but can change in settings
            };
        } else {
            // Minimal requirements: Can opt-in by default
            defaultSettings = {
                analyticsEnabled: true,
                shareUsageData: false,
                errorReporting: true,
                analyticsConsent: true,
                hasSeenConsentPrompt: true
            };
        }

        // Add metadata
        defaultSettings.analyticsConsentTimestamp = Date.now();
        defaultSettings.analyticsConsentVersion = '1.0';
        defaultSettings.consentJurisdiction = jurisdiction.jurisdiction;

        // Save to storage
        await this.saveConsentSettings(defaultSettings);

        if (this.debugLogging) {
            console.log('🔒 Applied default consent settings:', {
                jurisdiction: jurisdiction.jurisdiction,
                privacyRequirement,
                settings: defaultSettings
            });
        }

        return defaultSettings;
    }

    /**
     * Record user consent
     */
    async recordConsent(consentData) {
        const settings = {
            analyticsConsent: consentData.analyticsEnabled || false,
            analyticsEnabled: consentData.analyticsEnabled || false,
            shareUsageData: consentData.shareUsageData || false,
            errorReporting: consentData.errorReporting !== false, // Default true
            hasSeenConsentPrompt: true,
            analyticsConsentTimestamp: Date.now(),
            analyticsConsentVersion: '1.0'
        };

        await this.saveConsentSettings(settings);

        if (this.debugLogging) {
            console.log('✅ Consent recorded:', settings);
        }

        // Notify analytics manager of consent change
        if (window.WVFavs && window.WVFavs.analyticsManager) {
            await window.WVFavs.analyticsManager.updatePreferences({
                analyticsEnabled: settings.analyticsEnabled,
                shareUsageData: settings.shareUsageData,
                errorReporting: settings.errorReporting
            });
        }

        return settings;
    }

    /**
     * Revoke all consent
     */
    async revokeConsent() {
        const settings = {
            analyticsConsent: false,
            analyticsEnabled: false,
            shareUsageData: false,
            errorReporting: true, // Keep error reporting
            hasSeenConsentPrompt: true,
            analyticsConsentTimestamp: Date.now(),
            analyticsConsentVersion: '1.0'
        };

        await this.saveConsentSettings(settings);

        // Clear analytics data
        await this.clearAnalyticsData();

        if (this.debugLogging) {
            console.log('🚫 All consent revoked and data cleared');
        }

        // Notify analytics manager
        if (window.WVFavs && window.WVFavs.analyticsManager) {
            await window.WVFavs.analyticsManager.updatePreferences({
                analyticsEnabled: false,
                shareUsageData: false,
                errorReporting: true
            });
        }

        return settings;
    }

    /**
     * Clear all analytics data
     */
    async clearAnalyticsData() {
        return new Promise((resolve) => {
            chrome.storage.local.remove([
                'analytics_client_id',
                'analytics_session_id'
            ], () => {
                // Also clear any cached analytics events
                if (window.WVFavs && window.WVFavs.analyticsManager) {
                    window.WVFavs.analyticsManager.eventBatch = [];
                    window.WVFavs.analyticsManager.requestQueue = [];
                }
                resolve();
            });
        });
    }

    /**
     * Save consent settings to storage
     */
    async saveConsentSettings(settings) {
        return new Promise((resolve, reject) => {
            chrome.storage.sync.set(settings, () => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                } else {
                    resolve();
                }
            });
        });
    }

    /**
     * Get consent summary for UI display
     */
    async getConsentSummary() {
        if (!this.isInitialized) await this.init();

        const jurisdiction = await this.jurisdictionDetector.getJurisdictionInfo();
        const consentStatus = await this.getConsentStatus();
        const needsPrompt = await this.needsConsentPrompt();

        return {
            jurisdiction: {
                code: jurisdiction.jurisdiction,
                displayName: jurisdiction.displayName,
                privacyRequirement: jurisdiction.privacyRequirement,
                requiresStrictConsent: jurisdiction.requiresStrictConsent,
                applicableLaws: jurisdiction.applicableLaws
            },
            consent: consentStatus,
            needsPrompt: needsPrompt.needsPrompt,
            promptReason: needsPrompt.reason
        };
    }

    /**
     * Check if analytics should be enabled based on jurisdiction and consent
     */
    async shouldEnableAnalytics() {
        const consentStatus = await this.getConsentStatus();
        return consentStatus.analyticsEnabled && consentStatus.hasConsent;
    }
}

// Make ConsentManager available globally
if (typeof window !== 'undefined') {
    window.WVFavs = window.WVFavs || {};
    window.WVFavs.ConsentManager = ConsentManager;
}

// Export for Node.js environments (testing)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ConsentManager;
}
