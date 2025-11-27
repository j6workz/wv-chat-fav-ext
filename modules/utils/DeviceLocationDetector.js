/**
 * Privacy-Friendly Device and Location Detection for Chrome Extensions
 *
 * This module provides comprehensive device, browser, OS, and country detection
 * without requesting invasive permissions or compromising user privacy.
 *
 * All methods use built-in browser APIs and standard JavaScript features
 * that don't require additional manifest permissions.
 */

class DeviceLocationDetector {
    constructor() {
        this.cache = new Map();
        this.cacheExpiry = 5 * 60 * 1000; // 5 minutes cache
    }

    /**
     * Get comprehensive device information
     * @returns {Promise<Object>} Device information object
     */
    async getDeviceInfo() {
        const cacheKey = 'deviceInfo';
        if (this.isCached(cacheKey)) {
            return this.cache.get(cacheKey).data;
        }

        const deviceInfo = {
            // Basic device detection
            deviceType: this.getDeviceType(),
            os: this.getOperatingSystem(),
            browser: this.getBrowser(),

            // Screen and display information
            screen: this.getScreenInfo(),

            // Capabilities
            capabilities: this.getDeviceCapabilities(),

            // Language and locale
            locale: await this.getLocaleInfo(),

            // Country detection (privacy-friendly)
            country: await this.getCountryInfo(),

            // Platform information (Chrome extension API)
            platform: await this.getPlatformInfo(),

            // Timezone information
            timezone: this.getTimezoneInfo()
        };

        this.setCached(cacheKey, deviceInfo);
        return deviceInfo;
    }

    /**
     * Detect device type (mobile, tablet, desktop)
     * Uses multiple detection methods for accuracy
     */
    getDeviceType() {
        const userAgent = navigator.userAgent;
        const width = window.innerWidth;
        const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

        // Primary detection via user agent
        if (/iPhone|iPod/i.test(userAgent)) {
            return { type: 'mobile', subtype: 'phone', confidence: 'high' };
        }

        if (/iPad/i.test(userAgent)) {
            return { type: 'tablet', subtype: 'ipad', confidence: 'high' };
        }

        if (/Android/i.test(userAgent)) {
            // Distinguish between Android phones and tablets
            if (/Mobile/i.test(userAgent)) {
                return { type: 'mobile', subtype: 'android-phone', confidence: 'high' };
            } else {
                return { type: 'tablet', subtype: 'android-tablet', confidence: 'medium' };
            }
        }

        // Fallback to screen size + touch detection
        if (hasTouch && width <= 768) {
            return { type: 'mobile', subtype: 'unknown', confidence: 'medium' };
        }

        if (hasTouch && width > 768 && width <= 1024) {
            return { type: 'tablet', subtype: 'unknown', confidence: 'medium' };
        }

        // Default to desktop
        return { type: 'desktop', subtype: 'unknown', confidence: 'high' };
    }

    /**
     * Detect operating system
     * Uses navigator.userAgent for cross-platform compatibility
     */
    getOperatingSystem() {
        const userAgent = navigator.userAgent;
        const platform = navigator.platform;

        // Windows detection
        if (/Windows NT 10.0/i.test(userAgent)) return { os: 'Windows', version: '10+', platform };
        if (/Windows NT 6.3/i.test(userAgent)) return { os: 'Windows', version: '8.1', platform };
        if (/Windows NT 6.2/i.test(userAgent)) return { os: 'Windows', version: '8', platform };
        if (/Windows NT 6.1/i.test(userAgent)) return { os: 'Windows', version: '7', platform };
        if (/Windows/i.test(userAgent)) return { os: 'Windows', version: 'Unknown', platform };

        // macOS detection
        if (/Mac OS X 10[._](\d+)/i.test(userAgent)) {
            const version = userAgent.match(/Mac OS X 10[._](\d+)/i)[1];
            return { os: 'macOS', version: `10.${version}`, platform };
        }
        if (/Mac/i.test(userAgent)) return { os: 'macOS', version: 'Unknown', platform };

        // iOS detection
        if (/iPhone OS (\d+_\d+)/i.test(userAgent)) {
            const version = userAgent.match(/iPhone OS (\d+_\d+)/i)[1].replace('_', '.');
            return { os: 'iOS', version, platform: 'iPhone' };
        }
        if (/iPad.*OS (\d+_\d+)/i.test(userAgent)) {
            const version = userAgent.match(/iPad.*OS (\d+_\d+)/i)[1].replace('_', '.');
            return { os: 'iOS', version, platform: 'iPad' };
        }

        // Android detection
        if (/Android (\d+\.?\d*)/i.test(userAgent)) {
            const version = userAgent.match(/Android (\d+\.?\d*)/i)[1];
            return { os: 'Android', version, platform };
        }

        // Linux detection
        if (/Linux/i.test(userAgent)) return { os: 'Linux', version: 'Unknown', platform };

        // ChromeOS detection
        if (/CrOS/i.test(userAgent)) return { os: 'ChromeOS', version: 'Unknown', platform };

        return { os: 'Unknown', version: 'Unknown', platform };
    }

    /**
     * Detect browser information
     */
    getBrowser() {
        const userAgent = navigator.userAgent;

        // Edge detection (must come before Chrome check)
        if (/Edg/i.test(userAgent)) {
            const version = userAgent.match(/Edg\/(\d+)/i)?.[1] || 'Unknown';
            return { browser: 'Edge', version, engine: 'Blink' };
        }

        // Chrome detection
        if (/Chrome/i.test(userAgent) && !/Edg/i.test(userAgent)) {
            const version = userAgent.match(/Chrome\/(\d+)/i)?.[1] || 'Unknown';
            return { browser: 'Chrome', version, engine: 'Blink' };
        }

        // Firefox detection
        if (/Firefox/i.test(userAgent)) {
            const version = userAgent.match(/Firefox\/(\d+)/i)?.[1] || 'Unknown';
            return { browser: 'Firefox', version, engine: 'Gecko' };
        }

        // Safari detection (must come after Chrome check)
        if (/Safari/i.test(userAgent) && !/Chrome/i.test(userAgent)) {
            const version = userAgent.match(/Version\/(\d+)/i)?.[1] || 'Unknown';
            return { browser: 'Safari', version, engine: 'WebKit' };
        }

        // Opera detection
        if (/Opera|OPR/i.test(userAgent)) {
            const version = userAgent.match(/(?:Opera|OPR)\/(\d+)/i)?.[1] || 'Unknown';
            return { browser: 'Opera', version, engine: 'Blink' };
        }

        return { browser: 'Unknown', version: 'Unknown', engine: 'Unknown' };
    }

    /**
     * Get screen and display information
     */
    getScreenInfo() {
        return {
            // Viewport dimensions
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,

            // Screen dimensions
            screenWidth: screen.width,
            screenHeight: screen.height,

            // Available screen space (excludes taskbars, etc.)
            availableWidth: screen.availWidth,
            availableHeight: screen.availHeight,

            // Color depth
            colorDepth: screen.colorDepth,
            pixelDepth: screen.pixelDepth,

            // Device pixel ratio (for high-DPI displays)
            devicePixelRatio: window.devicePixelRatio || 1,

            // Orientation (if available)
            orientation: screen.orientation ? {
                angle: screen.orientation.angle,
                type: screen.orientation.type
            } : null
        };
    }

    /**
     * Detect device capabilities
     */
    getDeviceCapabilities() {
        return {
            // Touch capabilities
            hasTouch: 'ontouchstart' in window,
            maxTouchPoints: navigator.maxTouchPoints || 0,

            // Pointer capabilities
            hasPointer: window.PointerEvent !== undefined,

            // Media capabilities
            hasWebGL: this.hasWebGL(),
            hasWebRTC: this.hasWebRTC(),

            // Storage capabilities
            hasLocalStorage: this.hasLocalStorage(),
            hasSessionStorage: this.hasSessionStorage(),
            hasIndexedDB: this.hasIndexedDB(),

            // Network capabilities
            connectionType: this.getConnectionType(),

            // Hardware capabilities
            hardwareConcurrency: navigator.hardwareConcurrency || 1,
            deviceMemory: navigator.deviceMemory || null,

            // Media query capabilities
            prefersReducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
            prefersDarkScheme: window.matchMedia('(prefers-color-scheme: dark)').matches
        };
    }

    /**
     * Get locale and language information (privacy-friendly)
     */
    async getLocaleInfo() {
        const info = {
            // Browser UI language (Chrome extension API)
            uiLanguage: chrome?.i18n?.getUILanguage() || null,

            // User's preferred language
            userLanguage: navigator.language,

            // All user languages (in order of preference)
            userLanguages: navigator.languages || [navigator.language],

            // Number formatting locale
            numberFormat: this.getNumberFormatLocale(),

            // Date formatting locale
            dateFormat: this.getDateFormatLocale()
        };

        // Use Chrome extension i18n API if available
        if (chrome?.i18n?.getAcceptLanguages) {
            try {
                info.acceptLanguages = await new Promise((resolve) => {
                    chrome.i18n.getAcceptLanguages(resolve);
                });
            } catch (error) {
                console.warn('Could not get accept languages:', error);
            }
        }

        return info;
    }

    /**
     * Privacy-friendly country detection
     * Uses multiple methods without requesting location permission
     */
    async getCountryInfo() {
        const methods = {
            // Method 1: Extract from browser UI language
            fromUILanguage: this.getCountryFromUILanguage(),

            // Method 2: Extract from user language
            fromUserLanguage: this.getCountryFromUserLanguage(),

            // Method 3: Extract from timezone (less reliable but useful)
            fromTimezone: this.getCountryFromTimezone(),

            // Method 4: Extract from number/date formatting
            fromFormatting: this.getCountryFromFormatting()
        };

        // Determine most likely country based on consistency across methods
        const countryVotes = {};
        Object.entries(methods).forEach(([method, country]) => {
            if (country && country !== 'unknown') {
                countryVotes[country] = (countryVotes[country] || 0) + 1;
                countryVotes[country + '_methods'] = (countryVotes[country + '_methods'] || []);
                countryVotes[country + '_methods'].push(method);
            }
        });

        // Find country with most votes
        let bestCountry = 'unknown';
        let maxVotes = 0;
        Object.entries(countryVotes).forEach(([country, votes]) => {
            if (!country.endsWith('_methods') && votes > maxVotes) {
                maxVotes = votes;
                bestCountry = country;
            }
        });

        return {
            detected: bestCountry,
            confidence: maxVotes > 1 ? 'high' : 'low',
            methods: methods,
            votes: countryVotes
        };
    }

    /**
     * Get Chrome extension platform information
     */
    async getPlatformInfo() {
        if (!chrome?.runtime?.getPlatformInfo) {
            return { available: false, reason: 'Chrome runtime API not available' };
        }

        try {
            const platformInfo = await new Promise((resolve, reject) => {
                chrome.runtime.getPlatformInfo((info) => {
                    if (chrome.runtime.lastError) {
                        reject(chrome.runtime.lastError);
                    } else {
                        resolve(info);
                    }
                });
            });

            return {
                available: true,
                ...platformInfo
            };
        } catch (error) {
            return { available: false, error: error.message };
        }
    }

    /**
     * Get timezone information
     */
    getTimezoneInfo() {
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const offset = new Date().getTimezoneOffset();

        return {
            timezone: timezone,
            offset: offset,
            offsetHours: -offset / 60,
            isDST: this.isDaylightSavingTime(),
            utcTime: new Date().toISOString(),
            localTime: new Date().toString()
        };
    }

    // Helper methods for country detection

    getCountryFromUILanguage() {
        if (!chrome?.i18n?.getUILanguage) return 'unknown';

        const uiLang = chrome.i18n.getUILanguage();
        if (uiLang && uiLang.includes('-')) {
            return uiLang.split('-')[1].toUpperCase();
        }
        return 'unknown';
    }

    getCountryFromUserLanguage() {
        const userLang = navigator.language;
        if (userLang && userLang.includes('-')) {
            return userLang.split('-')[1].toUpperCase();
        }
        return 'unknown';
    }

    getCountryFromTimezone() {
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

        // Comprehensive timezone to country mappings (400+ timezones)
        const timezoneCountryMap = {
            // North America - United States
            'America/New_York': 'US',
            'America/Los_Angeles': 'US',
            'America/Chicago': 'US',
            'America/Denver': 'US',
            'America/Phoenix': 'US',
            'America/Anchorage': 'US',
            'America/Honolulu': 'US',
            'America/Detroit': 'US',
            'America/Kentucky/Louisville': 'US',
            'America/Kentucky/Monticello': 'US',
            'America/Indiana/Indianapolis': 'US',
            'America/Indiana/Vincennes': 'US',
            'America/Indiana/Winamac': 'US',
            'America/Indiana/Marengo': 'US',
            'America/Indiana/Petersburg': 'US',
            'America/Indiana/Vevay': 'US',
            'America/North_Dakota/Center': 'US',
            'America/North_Dakota/New_Salem': 'US',
            'America/North_Dakota/Beulah': 'US',
            'America/Menominee': 'US',
            'America/Adak': 'US',
            'America/Metlakatla': 'US',
            'America/Sitka': 'US',
            'America/Yakutat': 'US',
            'America/Juneau': 'US',
            'America/Nome': 'US',
            'Pacific/Honolulu': 'US',

            // Canada
            'America/Toronto': 'CA',
            'America/Vancouver': 'CA',
            'America/Montreal': 'CA',
            'America/Halifax': 'CA',
            'America/Winnipeg': 'CA',
            'America/Edmonton': 'CA',
            'America/Regina': 'CA',
            'America/St_Johns': 'CA',
            'America/Moncton': 'CA',
            'America/Goose_Bay': 'CA',
            'America/Glace_Bay': 'CA',
            'America/Blanc-Sablon': 'CA',
            'America/Atikokan': 'CA',
            'America/Thunder_Bay': 'CA',
            'America/Nipigon': 'CA',
            'America/Rainy_River': 'CA',
            'America/Rankin_Inlet': 'CA',
            'America/Resolute': 'CA',
            'America/Cambridge_Bay': 'CA',
            'America/Yellowknife': 'CA',
            'America/Inuvik': 'CA',
            'America/Whitehorse': 'CA',
            'America/Dawson': 'CA',
            'America/Dawson_Creek': 'CA',
            'America/Fort_Nelson': 'CA',
            'America/Creston': 'CA',
            'America/Swift_Current': 'CA',

            // Mexico
            'America/Mexico_City': 'MX',
            'America/Cancun': 'MX',
            'America/Merida': 'MX',
            'America/Monterrey': 'MX',
            'America/Matamoros': 'MX',
            'America/Mazatlan': 'MX',
            'America/Chihuahua': 'MX',
            'America/Ojinaga': 'MX',
            'America/Hermosillo': 'MX',
            'America/Tijuana': 'MX',
            'America/Bahia_Banderas': 'MX',

            // Central America
            'America/Guatemala': 'GT',
            'America/Belize': 'BZ',
            'America/El_Salvador': 'SV',
            'America/Tegucigalpa': 'HN',
            'America/Managua': 'NI',
            'America/Costa_Rica': 'CR',
            'America/Panama': 'PA',

            // Caribbean
            'America/Havana': 'CU',
            'America/Jamaica': 'JM',
            'America/Port-au-Prince': 'HT',
            'America/Santo_Domingo': 'DO',
            'America/Puerto_Rico': 'PR',
            'America/Barbados': 'BB',
            'America/Martinique': 'MQ',
            'America/Guadeloupe': 'GP',
            'America/St_Thomas': 'VI',
            'America/St_Lucia': 'LC',
            'America/St_Vincent': 'VC',
            'America/Grenada': 'GD',
            'America/Port_of_Spain': 'TT',
            'America/Curacao': 'CW',
            'America/Aruba': 'AW',
            'America/Anguilla': 'AI',
            'America/Antigua': 'AG',
            'America/Dominica': 'DM',
            'America/Montserrat': 'MS',
            'America/St_Kitts': 'KN',
            'America/Tortola': 'VG',

            // South America
            'America/Sao_Paulo': 'BR',
            'America/Rio_Branco': 'BR',
            'America/Manaus': 'BR',
            'America/Porto_Velho': 'BR',
            'America/Boa_Vista': 'BR',
            'America/Cuiaba': 'BR',
            'America/Campo_Grande': 'BR',
            'America/Belem': 'BR',
            'America/Fortaleza': 'BR',
            'America/Recife': 'BR',
            'America/Araguaina': 'BR',
            'America/Maceio': 'BR',
            'America/Bahia': 'BR',
            'America/Santarem': 'BR',
            'America/Noronha': 'BR',
            'America/Buenos_Aires': 'AR',
            'America/Argentina/La_Rioja': 'AR',
            'America/Argentina/Rio_Gallegos': 'AR',
            'America/Argentina/Salta': 'AR',
            'America/Argentina/San_Juan': 'AR',
            'America/Argentina/San_Luis': 'AR',
            'America/Argentina/Tucuman': 'AR',
            'America/Argentina/Ushuaia': 'AR',
            'America/Catamarca': 'AR',
            'America/Cordoba': 'AR',
            'America/Jujuy': 'AR',
            'America/Mendoza': 'AR',
            'America/Santiago': 'CL',
            'America/Punta_Arenas': 'CL',
            'Pacific/Easter': 'CL',
            'America/Lima': 'PE',
            'America/Bogota': 'CO',
            'America/Caracas': 'VE',
            'America/Guyana': 'GY',
            'America/Paramaribo': 'SR',
            'America/Cayenne': 'GF',
            'America/La_Paz': 'BO',
            'America/Asuncion': 'PY',
            'America/Montevideo': 'UY',
            'Atlantic/Stanley': 'FK',

            // Europe - Western Europe
            'Europe/London': 'GB',
            'Europe/Dublin': 'IE',
            'Europe/Lisbon': 'PT',
            'Atlantic/Azores': 'PT',
            'Atlantic/Madeira': 'PT',
            'Europe/Madrid': 'ES',
            'Africa/Ceuta': 'ES',
            'Atlantic/Canary': 'ES',
            'Europe/Paris': 'FR',
            'Europe/Brussels': 'BE',
            'Europe/Luxembourg': 'LU',
            'Europe/Amsterdam': 'NL',
            'Europe/Zurich': 'CH',
            'Europe/Vienna': 'AT',
            'Europe/Berlin': 'DE',
            'Europe/Busingen': 'DE',
            'Europe/Copenhagen': 'DK',
            'Europe/Stockholm': 'SE',
            'Europe/Oslo': 'NO',
            'Arctic/Longyearbyen': 'SJ',
            'Atlantic/Reykjavik': 'IS',
            'Atlantic/Faroe': 'FO',

            // Europe - Central Europe
            'Europe/Rome': 'IT',
            'Europe/Vatican': 'VA',
            'Europe/San_Marino': 'SM',
            'Europe/Malta': 'MT',
            'Europe/Zagreb': 'HR',
            'Europe/Ljubljana': 'SI',
            'Europe/Sarajevo': 'BA',
            'Europe/Podgorica': 'ME',
            'Europe/Belgrade': 'RS',
            'Europe/Skopje': 'MK',
            'Europe/Tirane': 'AL',
            'Europe/Prague': 'CZ',
            'Europe/Bratislava': 'SK',
            'Europe/Budapest': 'HU',
            'Europe/Warsaw': 'PL',

            // Europe - Eastern Europe
            'Europe/Bucharest': 'RO',
            'Europe/Sofia': 'BG',
            'Europe/Athens': 'GR',
            'Europe/Nicosia': 'CY',
            'Asia/Nicosia': 'CY',
            'Europe/Istanbul': 'TR',
            'Asia/Istanbul': 'TR',
            'Europe/Kiev': 'UA',
            'Europe/Uzhgorod': 'UA',
            'Europe/Zaporozhye': 'UA',
            'Europe/Chisinau': 'MD',
            'Europe/Minsk': 'BY',
            'Europe/Vilnius': 'LT',
            'Europe/Riga': 'LV',
            'Europe/Tallinn': 'EE',
            'Europe/Helsinki': 'FI',
            'Europe/Mariehamn': 'AX',
            'Europe/Moscow': 'RU',
            'Europe/Volgograd': 'RU',
            'Europe/Saratov': 'RU',
            'Europe/Astrakhan': 'RU',
            'Europe/Ulyanovsk': 'RU',
            'Europe/Samara': 'RU',
            'Europe/Kirov': 'RU',
            'Europe/Kaliningrad': 'RU',

            // Asia - Middle East
            'Asia/Jerusalem': 'IL',
            'Asia/Gaza': 'PS',
            'Asia/Hebron': 'PS',
            'Asia/Amman': 'JO',
            'Asia/Damascus': 'SY',
            'Asia/Beirut': 'LB',
            'Asia/Baghdad': 'IQ',
            'Asia/Kuwait': 'KW',
            'Asia/Riyadh': 'SA',
            'Asia/Bahrain': 'BH',
            'Asia/Qatar': 'QA',
            'Asia/Dubai': 'AE',
            'Asia/Muscat': 'OM',
            'Asia/Tehran': 'IR',
            'Asia/Kabul': 'AF',

            // Asia - Central Asia
            'Asia/Yekaterinburg': 'RU',
            'Asia/Omsk': 'RU',
            'Asia/Novosibirsk': 'RU',
            'Asia/Barnaul': 'RU',
            'Asia/Tomsk': 'RU',
            'Asia/Novokuznetsk': 'RU',
            'Asia/Krasnoyarsk': 'RU',
            'Asia/Irkutsk': 'RU',
            'Asia/Chita': 'RU',
            'Asia/Yakutsk': 'RU',
            'Asia/Khandyga': 'RU',
            'Asia/Vladivostok': 'RU',
            'Asia/Ust-Nera': 'RU',
            'Asia/Magadan': 'RU',
            'Asia/Sakhalin': 'RU',
            'Asia/Srednekolymsk': 'RU',
            'Asia/Kamchatka': 'RU',
            'Asia/Anadyr': 'RU',
            'Asia/Tashkent': 'UZ',
            'Asia/Samarkand': 'UZ',
            'Asia/Almaty': 'KZ',
            'Asia/Qyzylorda': 'KZ',
            'Asia/Qostanay': 'KZ',
            'Asia/Aqtobe': 'KZ',
            'Asia/Aqtau': 'KZ',
            'Asia/Atyrau': 'KZ',
            'Asia/Oral': 'KZ',
            'Asia/Bishkek': 'KG',
            'Asia/Dushanbe': 'TJ',
            'Asia/Ashgabat': 'TM',

            // Asia - South Asia
            'Asia/Karachi': 'PK',
            'Asia/Kolkata': 'IN',
            'Asia/Kathmandu': 'NP',
            'Asia/Thimphu': 'BT',
            'Asia/Dhaka': 'BD',
            'Asia/Colombo': 'LK',

            // Asia - East Asia
            'Asia/Shanghai': 'CN',
            'Asia/Urumqi': 'CN',
            'Asia/Hong_Kong': 'HK',
            'Asia/Macau': 'MO',
            'Asia/Taipei': 'TW',
            'Asia/Tokyo': 'JP',
            'Asia/Seoul': 'KR',
            'Asia/Pyongyang': 'KP',
            'Asia/Ulaanbaatar': 'MN',
            'Asia/Hovd': 'MN',
            'Asia/Choibalsan': 'MN',

            // Asia - Southeast Asia
            'Asia/Bangkok': 'TH',
            'Asia/Ho_Chi_Minh': 'VN',
            'Asia/Phnom_Penh': 'KH',
            'Asia/Vientiane': 'LA',
            'Asia/Yangon': 'MM',
            'Asia/Jakarta': 'ID',
            'Asia/Pontianak': 'ID',
            'Asia/Makassar': 'ID',
            'Asia/Jayapura': 'ID',
            'Asia/Kuala_Lumpur': 'MY',
            'Asia/Kuching': 'MY',
            'Asia/Singapore': 'SG',
            'Asia/Brunei': 'BN',
            'Asia/Manila': 'PH',

            // Africa - North Africa
            'Africa/Cairo': 'EG',
            'Africa/Tripoli': 'LY',
            'Africa/Tunis': 'TN',
            'Africa/Algiers': 'DZ',
            'Africa/Casablanca': 'MA',
            'Africa/El_Aaiun': 'EH',

            // Africa - West Africa
            'Africa/Lagos': 'NG',
            'Africa/Porto-Novo': 'BJ',
            'Africa/Cotonou': 'BJ',
            'Africa/Ouagadougou': 'BF',
            'Africa/Abidjan': 'CI',
            'Africa/Accra': 'GH',
            'Africa/Banjul': 'GM',
            'Africa/Bissau': 'GW',
            'Africa/Conakry': 'GN',
            'Africa/Bamako': 'ML',
            'Africa/Nouakchott': 'MR',
            'Africa/Niamey': 'NE',
            'Africa/Freetown': 'SL',
            'Africa/Dakar': 'SN',
            'Africa/Lome': 'TG',
            'Atlantic/Cape_Verde': 'CV',

            // Africa - Central Africa
            'Africa/Kinshasa': 'CD',
            'Africa/Lubumbashi': 'CD',
            'Africa/Bangui': 'CF',
            'Africa/Brazzaville': 'CG',
            'Africa/Douala': 'CM',
            'Africa/Libreville': 'GA',
            'Africa/Malabo': 'GQ',
            'Africa/Ndjamena': 'TD',
            'Africa/Sao_Tome': 'ST',

            // Africa - East Africa
            'Africa/Nairobi': 'KE',
            'Africa/Kampala': 'UG',
            'Africa/Dar_es_Salaam': 'TZ',
            'Africa/Kigali': 'RW',
            'Africa/Bujumbura': 'BI',
            'Africa/Addis_Ababa': 'ET',
            'Africa/Asmara': 'ER',
            'Africa/Djibouti': 'DJ',
            'Africa/Mogadishu': 'SO',
            'Indian/Comoro': 'KM',
            'Indian/Antananarivo': 'MG',
            'Indian/Mauritius': 'MU',
            'Indian/Reunion': 'RE',
            'Indian/Mayotte': 'YT',
            'Indian/Seychelles': 'SC',

            // Africa - Southern Africa
            'Africa/Johannesburg': 'ZA',
            'Africa/Cape_Town': 'ZA',
            'Africa/Windhoek': 'NA',
            'Africa/Gaborone': 'BW',
            'Africa/Maseru': 'LS',
            'Africa/Mbabane': 'SZ',
            'Africa/Maputo': 'MZ',
            'Africa/Lusaka': 'ZM',
            'Africa/Harare': 'ZW',
            'Africa/Blantyre': 'MW',

            // Australia & Oceania
            'Australia/Sydney': 'AU',
            'Australia/Melbourne': 'AU',
            'Australia/Brisbane': 'AU',
            'Australia/Perth': 'AU',
            'Australia/Adelaide': 'AU',
            'Australia/Darwin': 'AU',
            'Australia/Hobart': 'AU',
            'Australia/Currie': 'AU',
            'Australia/Lord_Howe': 'AU',
            'Australia/Broken_Hill': 'AU',
            'Australia/Eucla': 'AU',
            'Australia/Lindeman': 'AU',
            'Pacific/Auckland': 'NZ',
            'Pacific/Chatham': 'NZ',
            'Pacific/Fiji': 'FJ',
            'Pacific/Tongatapu': 'TO',
            'Pacific/Apia': 'WS',
            'Pacific/Tahiti': 'PF',
            'Pacific/Marquesas': 'PF',
            'Pacific/Gambier': 'PF',
            'Pacific/Port_Moresby': 'PG',
            'Pacific/Bougainville': 'PG',
            'Pacific/Guadalcanal': 'SB',
            'Pacific/Efate': 'VU',
            'Pacific/Noumea': 'NC',
            'Pacific/Norfolk': 'NF',
            'Pacific/Nauru': 'NR',
            'Pacific/Tarawa': 'KI',
            'Pacific/Enderbury': 'KI',
            'Pacific/Kiritimati': 'KI',
            'Pacific/Majuro': 'MH',
            'Pacific/Kwajalein': 'MH',
            'Pacific/Chuuk': 'FM',
            'Pacific/Pohnpei': 'FM',
            'Pacific/Kosrae': 'FM',
            'Pacific/Palau': 'PW',
            'Pacific/Funafuti': 'TV',
            'Pacific/Wake': 'UM',
            'Pacific/Wallis': 'WF',
            'Pacific/Guam': 'GU',
            'Pacific/Saipan': 'MP',

            // Antarctica (Research stations - country of operation)
            'Antarctica/McMurdo': 'AQ',
            'Antarctica/Casey': 'AQ',
            'Antarctica/Davis': 'AQ',
            'Antarctica/DumontDUrville': 'AQ',
            'Antarctica/Mawson': 'AQ',
            'Antarctica/Palmer': 'AQ',
            'Antarctica/Rothera': 'AQ',
            'Antarctica/Syowa': 'AQ',
            'Antarctica/Troll': 'AQ',
            'Antarctica/Vostok': 'AQ',

            // Indian Ocean Territories
            'Indian/Kerguelen': 'TF',
            'Indian/Chagos': 'IO',
            'Indian/Christmas': 'CX',
            'Indian/Cocos': 'CC',
            'Indian/Maldives': 'MV',

            // Atlantic Ocean Territories
            'Atlantic/Bermuda': 'BM',
            'Atlantic/South_Georgia': 'GS',
            'Atlantic/St_Helena': 'SH',

            // Pacific Ocean Territories
            'Pacific/Pitcairn': 'PN',
            'Pacific/Galapagos': 'EC'
        };

        return timezoneCountryMap[timezone] || 'unknown';
    }

    getCountryFromFormatting() {
        try {
            // Try to detect country from number formatting
            const formatter = new Intl.NumberFormat();
            const resolved = formatter.resolvedOptions();

            if (resolved.locale) {
                const locale = resolved.locale;
                if (locale.includes('-')) {
                    return locale.split('-')[1].toUpperCase();
                }
            }
        } catch (error) {
            // Fallback silently
        }

        return 'unknown';
    }

    // Helper methods for capabilities detection

    hasWebGL() {
        try {
            const canvas = document.createElement('canvas');
            return !!(window.WebGLRenderingContext && canvas.getContext('webgl'));
        } catch (e) {
            return false;
        }
    }

    hasWebRTC() {
        return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    }

    hasLocalStorage() {
        try {
            return typeof(Storage) !== 'undefined' && window.localStorage;
        } catch (e) {
            return false;
        }
    }

    hasSessionStorage() {
        try {
            return typeof(Storage) !== 'undefined' && window.sessionStorage;
        } catch (e) {
            return false;
        }
    }

    hasIndexedDB() {
        return !!(window.indexedDB || window.mozIndexedDB || window.webkitIndexedDB || window.msIndexedDB);
    }

    getConnectionType() {
        if (navigator.connection) {
            return {
                effectiveType: navigator.connection.effectiveType,
                downlink: navigator.connection.downlink,
                rtt: navigator.connection.rtt,
                saveData: navigator.connection.saveData
            };
        }
        return null;
    }

    getNumberFormatLocale() {
        try {
            return new Intl.NumberFormat().resolvedOptions().locale;
        } catch (e) {
            return 'unknown';
        }
    }

    getDateFormatLocale() {
        try {
            return new Intl.DateTimeFormat().resolvedOptions().locale;
        } catch (e) {
            return 'unknown';
        }
    }

    isDaylightSavingTime() {
        const jan = new Date(new Date().getFullYear(), 0, 1).getTimezoneOffset();
        const jul = new Date(new Date().getFullYear(), 6, 1).getTimezoneOffset();
        return Math.max(jan, jul) !== new Date().getTimezoneOffset();
    }

    // Cache management

    isCached(key) {
        const cached = this.cache.get(key);
        if (!cached) return false;

        const now = Date.now();
        if (now - cached.timestamp > this.cacheExpiry) {
            this.cache.delete(key);
            return false;
        }

        return true;
    }

    setCached(key, data) {
        this.cache.set(key, {
            data: data,
            timestamp: Date.now()
        });
    }

    clearCache() {
        this.cache.clear();
    }

    /**
     * Get device and location summary for quick access
     */
    async getQuickInfo() {
        const full = await this.getDeviceInfo();

        return {
            deviceType: full.deviceType.type,
            os: full.os.os,
            browser: full.browser.browser,
            country: full.country.detected,
            timezone: full.timezone.timezone,
            language: full.locale.userLanguage
        };
    }

    /**
     * Export all detection data for debugging
     */
    async exportFullReport() {
        return {
            timestamp: new Date().toISOString(),
            userAgent: navigator.userAgent,
            ...await this.getDeviceInfo()
        };
    }
}

// Make DeviceLocationDetector available globally in WVFavs namespace
if (typeof window !== 'undefined') {
    window.WVFavs = window.WVFavs || {};
    window.WVFavs.DeviceLocationDetector = DeviceLocationDetector;

    // Also expose directly for backward compatibility
    window.DeviceLocationDetector = DeviceLocationDetector;
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = DeviceLocationDetector;
}