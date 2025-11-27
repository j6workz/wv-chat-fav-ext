/**
 * Jurisdiction Detector for WorkVivo Favorites Extension
 * Detects user's legal jurisdiction for privacy compliance
 * Supports multi-method detection with confidence scoring
 */

class JurisdictionDetector {
    constructor() {
        this.detectionCache = new Map();
        this.cacheExpiry = 24 * 60 * 60 * 1000; // 24 hours
        this.isInitialized = false;

        // Jurisdiction classification for privacy compliance
        this.strictConsentJurisdictions = [
            // EU/EEA (GDPR)
            'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU',
            'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES',
            'SE', 'IS', 'LI', 'NO', 'CH',
            // US States with strict privacy laws
            'CA-US', 'VA-US', 'CO-US', 'CT-US', 'UT-US', 'IA-US', 'DE-US', 'NE-US',
            'NH-US', 'NJ-US', 'TN-US', 'MN-US', 'MD-US'
        ];

        this.optInPermissibleJurisdictions = [
            // US States without strict privacy laws
            'AL-US', 'AK-US', 'AZ-US', 'AR-US', 'FL-US', 'GA-US', 'HI-US', 'ID-US',
            'IL-US', 'IN-US', 'KS-US', 'KY-US', 'LA-US', 'ME-US', 'MA-US', 'MI-US',
            'MS-US', 'MO-US', 'MT-US', 'NV-US', 'NY-US', 'NC-US', 'ND-US', 'OH-US',
            'OK-US', 'OR-US', 'PA-US', 'RI-US', 'SC-US', 'SD-US', 'TX-US', 'VT-US',
            'WA-US', 'WV-US', 'WI-US', 'WY-US', 'DC-US',
            // Other countries with permissive privacy laws
            'CA', 'AU', 'GB', 'NZ', 'JP', 'KR', 'SG', 'HK', 'MY', 'TH', 'ID', 'PH', 'TW', 'BD', 'PK', 'IN', 'AE'
        ];

        // US state abbreviation mapping
        this.usStateMap = {
            'Alabama': 'AL', 'Alaska': 'AK', 'Arizona': 'AZ', 'Arkansas': 'AR',
            'California': 'CA', 'Colorado': 'CO', 'Connecticut': 'CT', 'Delaware': 'DE',
            'Florida': 'FL', 'Georgia': 'GA', 'Hawaii': 'HI', 'Idaho': 'ID',
            'Illinois': 'IL', 'Indiana': 'IN', 'Iowa': 'IA', 'Kansas': 'KS',
            'Kentucky': 'KY', 'Louisiana': 'LA', 'Maine': 'ME', 'Maryland': 'MD',
            'Massachusetts': 'MA', 'Michigan': 'MI', 'Minnesota': 'MN', 'Mississippi': 'MS',
            'Missouri': 'MO', 'Montana': 'MT', 'Nebraska': 'NE', 'Nevada': 'NV',
            'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY',
            'North Carolina': 'NC', 'North Dakota': 'ND', 'Ohio': 'OH', 'Oklahoma': 'OK',
            'Oregon': 'OR', 'Pennsylvania': 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC',
            'South Dakota': 'SD', 'Tennessee': 'TN', 'Texas': 'TX', 'Utah': 'UT',
            'Vermont': 'VT', 'Virginia': 'VA', 'Washington': 'WA', 'West Virginia': 'WV',
            'Wisconsin': 'WI', 'Wyoming': 'WY', 'District of Columbia': 'DC'
        };

        // Timezone to US state mapping (primary timezone per state)
        this.timezoneToStateMap = {
            'America/New_York': ['NY', 'PA', 'NJ', 'CT', 'MA', 'VT', 'NH', 'ME', 'RI', 'DE', 'MD', 'DC', 'VA', 'WV', 'NC', 'SC', 'GA', 'FL', 'OH', 'MI', 'IN', 'KY', 'TN'],
            'America/Chicago': ['IL', 'WI', 'MN', 'IA', 'MO', 'AR', 'LA', 'MS', 'AL', 'TN', 'KY', 'IN', 'MI', 'OH', 'WV', 'VA', 'NC', 'SC', 'GA', 'FL', 'TX', 'OK', 'KS', 'NE', 'SD', 'ND'],
            'America/Denver': ['CO', 'WY', 'MT', 'UT', 'NM', 'AZ', 'TX', 'OK', 'KS', 'NE', 'SD', 'ND'],
            'America/Los_Angeles': ['CA', 'NV', 'OR', 'WA'],
            'America/Anchorage': ['AK'],
            'Pacific/Honolulu': ['HI']
        };

        this.init();
    }

    /**
     * Initialize the jurisdiction detector
     */
    async init() {
        try {
            // Load cached jurisdiction if available
            await this.loadCachedJurisdiction();
            this.isInitialized = true;
        } catch (error) {
            this.logger('JurisdictionDetector initialization failed:', error);
        }
    }

    /**
     * Detect user's jurisdiction using multiple methods
     */
    async detectJurisdiction() {
        if (!this.isInitialized) {
            await this.init();
        }

        // Check cache first
        const cached = this.getCachedJurisdiction();
        if (cached && cached.confidence > 0.7) {
            return cached;
        }

        const detectionMethods = {
            chromeI18n: await this.detectViaChromeI18n(),
            navigatorLanguage: this.detectViaNavigatorLanguage(),
            timezone: this.detectViaTimezone(),
            locale: this.detectViaLocale(),
            deviceDetector: await this.detectViaDeviceDetector()
        };

        // Consensus analysis
        const jurisdiction = this.analyzeConsensus(detectionMethods);

        // Cache the result
        this.cacheJurisdiction(jurisdiction);

        return jurisdiction;
    }

    /**
     * Method 1: Chrome Extension i18n API (most reliable for extensions)
     */
    async detectViaChromeI18n() {
        try {
            if (typeof chrome !== 'undefined' && chrome.i18n && chrome.i18n.getUILanguage) {
                const uiLanguage = chrome.i18n.getUILanguage();
                const result = this.parseLanguageCode(uiLanguage);

                // For US, try to detect state
                if (result.country === 'US') {
                    const state = await this.detectUSState();
                    if (state) {
                        result.jurisdiction = `${state}-US`;
                        result.state = state;
                    }
                }

                result.confidence = 0.7; // Lower confidence for language - user might use different language than location
                result.method = 'chrome_i18n';
                return result;
            }
        } catch (error) {
            this.logger('Chrome i18n detection failed:', error);
        }

        return { confidence: 0, method: 'chrome_i18n' };
    }

    /**
     * Method 2: Navigator language API
     */
    detectViaNavigatorLanguage() {
        try {
            const userLanguage = navigator.language;
            const result = this.parseLanguageCode(userLanguage);
            result.confidence = 0.65; // Lower confidence for language - user might use different language than location
            result.method = 'navigator_language';
            return result;
        } catch (error) {
            this.logger('Navigator language detection failed:', error);
            return { confidence: 0, method: 'navigator_language' };
        }
    }

    /**
     * Method 3: Timezone-based detection
     */
    detectViaTimezone() {
        try {
            const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
            const result = this.inferCountryFromTimezone(timezone);
            result.confidence = 0.85; // Higher confidence for timezone - it's more reliable for actual location
            result.method = 'timezone';
            return result;
        } catch (error) {
            this.logger('Timezone detection failed:', error);
            return { confidence: 0, method: 'timezone' };
        }
    }

    /**
     * Method 4: Locale-based detection
     */
    detectViaLocale() {
        try {
            const locale = new Intl.NumberFormat().resolvedOptions().locale;
            const result = this.parseLanguageCode(locale);
            result.confidence = 0.6; // Lower confidence for locale - user might use different locale than location
            result.method = 'locale';
            return result;
        } catch (error) {
            this.logger('Locale detection failed:', error);
            return { confidence: 0, method: 'locale' };
        }
    }

    /**
     * Method 5: Device detector integration
     */
    async detectViaDeviceDetector() {
        try {
            if (window.WVFavs && window.WVFavs.DeviceLocationDetector) {
                const detector = new window.WVFavs.DeviceLocationDetector();
                const deviceInfo = await detector.getDeviceInfo();

                if (deviceInfo && deviceInfo.country && deviceInfo.country.detected) {
                    const countryCode = deviceInfo.country.detected;
                    if (countryCode && countryCode !== 'unknown') {
                        return {
                            country: countryCode,
                            jurisdiction: countryCode,
                            confidence: deviceInfo.country.confidence === 'high' ? 0.9 : 0.7,
                            method: 'device_detector'
                        };
                    }
                }
            }
        } catch (error) {
            this.logger('Device detector failed:', error);
        }

        return { confidence: 0, method: 'device_detector' };
    }

    /**
     * Parse language code (e.g., "en-US" -> country: "US")
     */
    parseLanguageCode(languageCode) {
        if (!languageCode) return { confidence: 0 };

        const parts = languageCode.split('-');
        if (parts.length >= 2) {
            const country = parts[1].toUpperCase();
            return {
                country: country,
                jurisdiction: country,
                language: parts[0].toLowerCase()
            };
        }

        return { confidence: 0 };
    }

    /**
     * Infer country from timezone
     */
    inferCountryFromTimezone(timezone) {
        const timezoneCountryMap = {
            // Americas
            'America/New_York': 'US',
            'America/Chicago': 'US',
            'America/Denver': 'US',
            'America/Los_Angeles': 'US',
            'America/Anchorage': 'US',
            'Pacific/Honolulu': 'US',
            'America/Toronto': 'CA',
            'America/Vancouver': 'CA',
            'America/Sao_Paulo': 'BR',

            // Europe
            'Europe/London': 'GB',
            'Europe/Berlin': 'DE',
            'Europe/Paris': 'FR',
            'Europe/Rome': 'IT',
            'Europe/Madrid': 'ES',
            'Europe/Amsterdam': 'NL',
            'Europe/Stockholm': 'SE',
            'Europe/Oslo': 'NO',
            'Europe/Copenhagen': 'DK',
            'Europe/Helsinki': 'FI',
            'Europe/Warsaw': 'PL',
            'Europe/Prague': 'CZ',
            'Europe/Budapest': 'HU',
            'Europe/Vienna': 'AT',
            'Europe/Zurich': 'CH',
            'Europe/Brussels': 'BE',
            'Europe/Dublin': 'IE',

            // Asia Pacific
            'Asia/Tokyo': 'JP',
            'Asia/Seoul': 'KR',
            'Asia/Shanghai': 'CN',
            'Asia/Singapore': 'SG',
            'Asia/Hong_Kong': 'HK',
            'Asia/Kuala_Lumpur': 'MY',
            'Asia/Bangkok': 'TH',
            'Asia/Jakarta': 'ID',
            'Asia/Manila': 'PH',
            'Asia/Taipei': 'TW',
            'Asia/Dhaka': 'BD',
            'Asia/Karachi': 'PK',
            'Asia/Kolkata': 'IN',
            'Asia/Dubai': 'AE',
            'Australia/Sydney': 'AU',
            'Australia/Melbourne': 'AU',
            'Australia/Perth': 'AU',
            'Pacific/Auckland': 'NZ'
        };

        const country = timezoneCountryMap[timezone];
        if (country) {
            const result = {
                country: country,
                jurisdiction: country,
                timezone: timezone
            };

            // For US, try to detect state from timezone
            if (country === 'US') {
                const state = this.getStateFromTimezone(timezone);
                if (state) {
                    result.jurisdiction = `${state}-US`;
                    result.state = state;
                }
            }

            return result;
        }

        return { confidence: 0 };
    }

    /**
     * Get US state from timezone
     */
    getStateFromTimezone(timezone) {
        for (const [tz, states] of Object.entries(this.timezoneToStateMap)) {
            if (timezone === tz && states.length > 0) {
                // Return most likely state (first in list for that timezone)
                return states[0];
            }
        }
        return null;
    }

    /**
     * Detect US state using multiple methods
     */
    async detectUSState() {
        // Method 1: Try timezone inference
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const stateFromTimezone = this.getStateFromTimezone(timezone);
        if (stateFromTimezone) {
            return stateFromTimezone;
        }

        // Method 2: Try locale inference (less reliable)
        try {
            const locale = new Intl.NumberFormat().resolvedOptions().locale;
            if (locale.includes('US-')) {
                const statePart = locale.split('US-')[1];
                if (statePart && statePart.length === 2) {
                    return statePart.toUpperCase();
                }
            }
        } catch (error) {
            // Ignore locale detection errors
        }

        // Default: Unable to detect state
        return null;
    }

    /**
     * Analyze consensus from multiple detection methods
     */
    analyzeConsensus(methods) {
        const votes = new Map();
        const methodResults = [];

        // Check for timezone vs language conflicts and prioritize timezone
        const timezoneResult = methods.timezone;
        const languageResults = [methods.chromeI18n, methods.navigatorLanguage, methods.locale].filter(r => r && r.confidence > 0);

        // If timezone gives a strong result and language methods give different countries, boost timezone
        if (timezoneResult && timezoneResult.confidence > 0.7) {
            const timezoneCountry = timezoneResult.jurisdiction || timezoneResult.country;
            const languageCountries = languageResults.map(r => r.jurisdiction || r.country);

            // If timezone country differs from all language countries, boost timezone confidence
            if (timezoneCountry && !languageCountries.includes(timezoneCountry)) {
                timezoneResult.confidence = Math.min(timezoneResult.confidence + 0.2, 0.95);
                this.logger && this.logger(`🌍 Timezone-language conflict detected. Boosting timezone confidence for ${timezoneCountry}`);
            }
        }

        // Collect all valid results
        Object.entries(methods).forEach(([methodName, result]) => {
            if (result && result.confidence > 0) {
                methodResults.push(result);
                const jurisdiction = result.jurisdiction || result.country;
                if (jurisdiction) {
                    const current = votes.get(jurisdiction) || { count: 0, totalConfidence: 0, methods: [] };
                    current.count++;
                    current.totalConfidence += result.confidence;
                    current.methods.push(methodName);
                    votes.set(jurisdiction, current);
                }
            }
        });

        // Find best consensus with improved algorithm
        let bestJurisdiction = null;
        let bestScore = 0;

        for (const [jurisdiction, data] of votes.entries()) {
            const avgConfidence = data.totalConfidence / data.count;

            // New algorithm: Heavily weight high-confidence results
            // If a single method has >0.9 confidence, it should win
            const hasHighConfidence = methodResults.some(r =>
                (r.jurisdiction || r.country) === jurisdiction && r.confidence > 0.9);

            // Check if this jurisdiction comes from timezone method specifically
            const isTimezoneResult = methodResults.some(r =>
                (r.jurisdiction || r.country) === jurisdiction && r.method === 'timezone');

            let score;
            if (hasHighConfidence && isTimezoneResult) {
                // Timezone with high confidence gets massive boost (should always win)
                score = avgConfidence * data.count * 5;
            } else if (hasHighConfidence) {
                // Other high confidence results get moderate boost
                score = avgConfidence * avgConfidence * data.count * 2;
            } else {
                // Normal scoring for lower confidence results
                score = avgConfidence * data.count;
            }

            if (score > bestScore) {
                bestScore = score;
                bestJurisdiction = jurisdiction;
            }

            // Debug logging
            if (this.logger && typeof this.logger === 'function') {
                this.logger(`📊 Jurisdiction scoring: ${jurisdiction} - Score: ${score.toFixed(2)} (Avg Conf: ${avgConfidence.toFixed(2)}, Count: ${data.count}, High Conf: ${hasHighConfidence})`);
            }
        }

        if (bestJurisdiction) {
            const consensusData = votes.get(bestJurisdiction);
            const avgConfidence = consensusData.totalConfidence / consensusData.count;

            return {
                jurisdiction: bestJurisdiction,
                country: bestJurisdiction.includes('-') ? bestJurisdiction.split('-')[1] : bestJurisdiction,
                state: bestJurisdiction.includes('-US') ? bestJurisdiction.split('-')[0] : null,
                confidence: Math.min(avgConfidence + (consensusData.count - 1) * 0.1, 0.95),
                consensus: consensusData.count,
                methods: consensusData.methods,
                allResults: methodResults
            };
        }

        // Fallback to highest confidence single method
        const bestSingle = methodResults.reduce((best, current) =>
            current.confidence > best.confidence ? current : best,
            { confidence: 0 }
        );

        return bestSingle.confidence > 0 ? bestSingle : {
            jurisdiction: 'unknown',
            country: 'unknown',
            confidence: 0,
            methods: []
        };
    }

    /**
     * Get privacy requirement level for jurisdiction
     */
    getPrivacyRequirement(jurisdiction) {
        if (this.strictConsentJurisdictions.includes(jurisdiction)) {
            return 'strict_consent';
        } else if (this.optInPermissibleJurisdictions.includes(jurisdiction)) {
            return 'opt_in_permissible';
        } else {
            return 'minimal_requirements';
        }
    }

    /**
     * Check if jurisdiction requires strict consent
     */
    requiresStrictConsent(jurisdiction) {
        return this.getPrivacyRequirement(jurisdiction) === 'strict_consent';
    }

    /**
     * Get jurisdiction display name
     */
    getJurisdictionDisplayName(jurisdiction) {
        if (jurisdiction.includes('-US')) {
            const state = jurisdiction.split('-')[0];
            const stateNames = {
                'CA': 'California', 'VA': 'Virginia', 'CO': 'Colorado', 'CT': 'Connecticut',
                'UT': 'Utah', 'IA': 'Iowa', 'DE': 'Delaware', 'NE': 'Nebraska',
                'NH': 'New Hampshire', 'NJ': 'New Jersey', 'TN': 'Tennessee',
                'MN': 'Minnesota', 'MD': 'Maryland', 'DC': 'District of Columbia'
            };
            return stateNames[state] || `${state}, United States`;
        }

        const countryNames = {
            'US': 'United States', 'CA': 'Canada', 'GB': 'United Kingdom',
            'DE': 'Germany', 'FR': 'France', 'IT': 'Italy', 'ES': 'Spain',
            'AU': 'Australia', 'NZ': 'New Zealand', 'JP': 'Japan', 'KR': 'South Korea'
        };

        return countryNames[jurisdiction] || jurisdiction;
    }

    /**
     * Cache jurisdiction result
     */
    cacheJurisdiction(jurisdiction) {
        const cacheData = {
            ...jurisdiction,
            timestamp: Date.now()
        };

        this.detectionCache.set('current_jurisdiction', cacheData);

        // Also cache in chrome storage for persistence
        if (typeof chrome !== 'undefined' && chrome.storage) {
            chrome.storage.local.set({
                jurisdiction_cache: cacheData
            }).catch(() => {
                // Ignore storage errors
            });
        }
    }

    /**
     * Get cached jurisdiction
     */
    getCachedJurisdiction() {
        const cached = this.detectionCache.get('current_jurisdiction');
        if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
            return cached;
        }
        return null;
    }

    /**
     * Load cached jurisdiction from storage
     */
    async loadCachedJurisdiction() {
        if (typeof chrome !== 'undefined' && chrome.storage) {
            try {
                const result = await new Promise(resolve => {
                    chrome.storage.local.get(['jurisdiction_cache'], resolve);
                });

                if (result.jurisdiction_cache) {
                    const cached = result.jurisdiction_cache;
                    if (Date.now() - cached.timestamp < this.cacheExpiry) {
                        this.detectionCache.set('current_jurisdiction', cached);
                    }
                }
            } catch (error) {
                // Ignore storage errors
            }
        }
    }

    /**
     * Clear jurisdiction cache
     */
    clearCache() {
        this.detectionCache.clear();
        if (typeof chrome !== 'undefined' && chrome.storage) {
            chrome.storage.local.remove(['jurisdiction_cache']).catch(() => {
                // Ignore storage errors
            });
        }
    }

    /**
     * Get comprehensive jurisdiction information
     */
    async getJurisdictionInfo() {
        const jurisdiction = await this.detectJurisdiction();

        return {
            ...jurisdiction,
            privacyRequirement: this.getPrivacyRequirement(jurisdiction.jurisdiction),
            requiresStrictConsent: this.requiresStrictConsent(jurisdiction.jurisdiction),
            displayName: this.getJurisdictionDisplayName(jurisdiction.jurisdiction),
            isEU: this.isEUJurisdiction(jurisdiction.jurisdiction),
            isUS: this.isUSJurisdiction(jurisdiction.jurisdiction),
            applicableLaws: this.getApplicableLaws(jurisdiction.jurisdiction)
        };
    }

    /**
     * Check if jurisdiction is in EU/EEA
     */
    isEUJurisdiction(jurisdiction) {
        const euCountries = [
            'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU',
            'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES',
            'SE', 'IS', 'LI', 'NO', 'CH'
        ];
        return euCountries.includes(jurisdiction);
    }

    /**
     * Check if jurisdiction is in US
     */
    isUSJurisdiction(jurisdiction) {
        return jurisdiction === 'US' || jurisdiction.endsWith('-US');
    }

    /**
     * Get applicable privacy laws for jurisdiction
     */
    getApplicableLaws(jurisdiction) {
        const laws = [];

        if (this.isEUJurisdiction(jurisdiction)) {
            laws.push('GDPR');
        }

        if (this.isUSJurisdiction(jurisdiction)) {
            if (jurisdiction === 'CA-US') {
                laws.push('CCPA', 'CPRA');
            } else if (jurisdiction === 'VA-US') {
                laws.push('VCDPA');
            } else if (jurisdiction === 'CO-US') {
                laws.push('CPA');
            } else if (['CT-US', 'UT-US', 'IA-US', 'DE-US', 'NE-US', 'NH-US', 'NJ-US', 'TN-US', 'MN-US', 'MD-US'].includes(jurisdiction)) {
                laws.push('State Privacy Law');
            }
        }

        if (jurisdiction === 'CA') {
            laws.push('PIPEDA');
        } else if (jurisdiction === 'BR') {
            laws.push('LGPD');
        } else if (jurisdiction === 'CN') {
            laws.push('PIPL');
        } else if (jurisdiction === 'AU') {
            laws.push('Privacy Act');
        }

        return laws;
    }
}

// Make JurisdictionDetector available globally
if (typeof window !== 'undefined') {
    window.WVFavs = window.WVFavs || {};
    window.WVFavs.JurisdictionDetector = JurisdictionDetector;
}

// Export for Node.js environments (testing)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = JurisdictionDetector;
}