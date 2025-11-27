// WorkVivo Favorites - Background Script

// Import PKCE utilities for OAuth 2.0 with PKCE
importScripts('modules/auth/PKCEUtils.js');

// Import OAuth secrets (gitignored - see secrets.example.js for template)
importScripts('secrets.js');

// OAuth Configuration
// Client secret is acceptable in extension code per RFC 8252 & Google's guidance
// See OAUTH_MIGRATION_JUSTIFICATION.md for detailed security rationale
const OAUTH_CONFIG = {
    clientId: OAUTH_SECRETS.clientId,
    clientSecret: OAUTH_SECRETS.clientSecret,
    redirectUri: 'https://hfkghekdnhobfgaepencjdmhmomccjha.chromiumapp.org',
    authEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenEndpoint: 'https://oauth2.googleapis.com/token',
    revokeEndpoint: 'https://oauth2.googleapis.com/revoke',
    userInfoEndpoint: 'https://www.googleapis.com/oauth2/v2/userinfo',
    scopes: [
        'https://www.googleapis.com/auth/calendar.events',
        'https://www.googleapis.com/auth/userinfo.email',
        'https://www.googleapis.com/auth/userinfo.profile'
    ]
};

// Handle installation
chrome.runtime.onInstalled.addListener((details) => {
    console.log('🎉 WorkVivo Favorites extension installed');

    if (details.reason === 'install') {
        // Track first-time installation
        trackInstallationEvent('extension_installed', {
            installation_timestamp: Date.now(),
            version: chrome.runtime.getManifest().version
        });
        // Set up default settings
        chrome.storage.sync.set({
            workvivoFavorites: [],
            workvivoSettings: {
                showScrollbar: true,
                showPinIndicator: true,
                showPinnedSidebar: true,
                autoCollapse: false,
                debugLogging: false,
                showSnackbars: true,
                windowsModifierKey: 'ctrl', // 'alt', 'ctrl', or 'both'
                floatingWidgetEnabled: true,
                floatingWidgetFirstClick: 'recents', // 'recents' or 'search'
                analyticsEnabled: null, // Will be set based on jurisdiction
                shareUsageData: null,   // Will be set based on jurisdiction
                errorReporting: true    // Always enabled
            }
        });

        // Initialize jurisdiction-aware privacy settings
        initializeJurisdictionAwarePrivacy();

        // Open welcome page
        chrome.tabs.create({
            url: chrome.runtime.getURL('welcome.html'),
            active: true
        });

    } else if (details.reason === 'update') {
        // Track extension updates
        trackInstallationEvent('extension_updated', {
            from_version: details.previousVersion,
            to_version: chrome.runtime.getManifest().version,
            update_timestamp: Date.now()
        });

        // Open update page on web (thank you + changelog)
        chrome.tabs.create({
            url: 'https://j6.studio/workvivo-chat-favorites-extension/update.html',
            active: true
        });
    }
});

// Handle messages from content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('Background received message:', request);
    
    switch (request.action) {
        case 'getPinnedChats':
            chrome.storage.sync.get(['workvivoFavorites']).then(result => {
                sendResponse(result.workvivoFavorites || []);
            });
            return true; // Will respond asynchronously
            
        case 'savePinnedChats':
            chrome.storage.sync.set({ workvivoFavorites: request.data }).then(() => {
                sendResponse({ success: true });
            });
            return true;
            
        case 'showNotification':
            if (request.message) {
                chrome.notifications.create({
                    type: 'basic',
                    iconUrl: 'icons/icon48.png',
                    title: 'WorkVivo Favorites',
                    message: request.message
                });
            }
            break;

        case 'contentScriptReady':
            // Content script is signaling it's ready
            if (sender.tab && sender.tab.id) {
                tabStatusCache.set(sender.tab.id, 'working');
                updateBadge(sender.tab.id, true);
            }
            break;

        case 'sendGA4Event':
            // Handle GA4 analytics events from content scripts
            handleGA4Event(request.eventData)
                .then(result => {
                    sendResponse({ success: true, result });
                })
                .catch(error => {
                    // GA4 event failed - handled silently
                    sendResponse({ success: false, error: error.message });
                });
            return true; // Will respond asynchronously

        case 'WS_STATUS_UPDATE':
            // Handle WebSocket status updates from content script
            if (sender.tab && sender.tab.id) {
                updateWebSocketBadge(sender.tab.id, request.status);
                sendResponse({ success: true });
            }
            break;

        case 'openOptionsPage':
            // Open the extension's options page (only available in background context)
            chrome.runtime.openOptionsPage();
            sendResponse({ success: true });
            break;

        case 'GOOGLE_MEET_AUTH':
            // Handle Google OAuth authentication (chrome.identity only works in background)
            handleGoogleMeetAuth()
                .then(result => {
                    sendResponse({ success: true, ...result });
                })
                .catch(error => {
                    sendResponse({ success: false, error: error.message });
                });
            return true; // Will respond asynchronously

        case 'GOOGLE_MEET_SIGN_OUT':
            // Handle Google OAuth sign out
            handleGoogleMeetSignOut(request.token)
                .then(() => {
                    sendResponse({ success: true });
                })
                .catch(error => {
                    sendResponse({ success: false, error: error.message });
                });
            return true; // Will respond asynchronously

        case 'GOOGLE_MEET_CLEAR_AUTH':
            // Clear all Google OAuth data and force re-authentication
            handleClearGoogleAuth()
                .then(() => {
                    sendResponse({ success: true });
                })
                .catch(error => {
                    sendResponse({ success: false, error: error.message });
                });
            return true; // Will respond asynchronously

        case 'CHECK_GOOGLE_MEET_TOKEN':
            // Check if token is valid and refresh if needed
            // Used by content scripts and popup on load
            getValidAccessToken()
                .then(token => {
                    if (token) {
                        // Get user profile too
                        chrome.storage.local.get('googleMeetAuth').then(result => {
                            const auth = result.googleMeetAuth;
                            sendResponse({
                                success: true,
                                isSignedIn: true,
                                userProfile: auth?.userProfile || null
                            });
                        });
                    } else {
                        sendResponse({
                            success: true,
                            isSignedIn: false
                        });
                    }
                })
                .catch(error => {
                    sendResponse({
                        success: false,
                        isSignedIn: false,
                        error: error.message
                    });
                });
            return true; // Will respond asynchronously

        case 'GET_GOOGLE_MEET_AUTH_STATUS':
            // Get current auth status without triggering refresh
            chrome.storage.local.get('googleMeetAuth')
                .then(result => {
                    const auth = result.googleMeetAuth;
                    const isSignedIn = !!(auth && auth.accessToken && auth.expiresAt > Date.now());
                    sendResponse({
                        success: true,
                        isSignedIn: isSignedIn,
                        userProfile: isSignedIn ? auth.userProfile : null
                    });
                })
                .catch(error => {
                    sendResponse({
                        success: false,
                        error: error.message
                    });
                });
            return true; // Will respond asynchronously
    }
});

// Cache for tab statuses to make badge updates faster
const tabStatusCache = new Map();

// Cache for WebSocket status per tab
const wsStatusCache = new Map();

/**
 * Update badge based on WebSocket connection status
 */
function updateWebSocketBadge(tabId, status) {
    if (!chrome.action) return;

    try {
        wsStatusCache.set(tabId, status);

        switch (status) {
            case 'connected':
                chrome.action.setBadgeText({ text: '●', tabId: tabId });
                chrome.action.setBadgeBackgroundColor({ color: '#00FF00', tabId: tabId }); // Green
                chrome.action.setTitle({
                    title: 'WorkVivo Favs - Live Updates Active',
                    tabId: tabId
                });
                console.log('🔌 WebSocket connected - badge updated to green');
                break;

            case 'disconnected':
                chrome.action.setBadgeText({ text: '●', tabId: tabId });
                chrome.action.setBadgeBackgroundColor({ color: '#FF0000', tabId: tabId }); // Red
                chrome.action.setTitle({
                    title: 'WorkVivo Favs - Disconnected',
                    tabId: tabId
                });
                console.log('🔌 WebSocket disconnected - badge updated to red');
                break;

            case 'reconnecting':
                chrome.action.setBadgeText({ text: '●', tabId: tabId });
                chrome.action.setBadgeBackgroundColor({ color: '#FFA500', tabId: tabId }); // Orange
                chrome.action.setTitle({
                    title: 'WorkVivo Favs - Reconnecting...',
                    tabId: tabId
                });
                console.log('🔌 WebSocket reconnecting - badge updated to orange');
                break;

            default:
                // Unknown status - clear badge
                chrome.action.setBadgeText({ text: '', tabId: tabId });
                console.log('🔌 Unknown WebSocket status:', status);
        }
    } catch (error) {
        console.error('Error updating WebSocket badge:', error);
    }
}

// Update badge based on extension connectivity status
async function updateBadge(tabId = null, immediate = false) {
    if (chrome.action) {
        try {
            // Get current active tab if no tabId provided
            if (!tabId) {
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                tabId = tab?.id;
            }

            if (!tabId) {
                // No active tab, clear badge
                chrome.action.setBadgeText({ text: '' });
                return;
            }

            // Get the tab info
            const tab = await chrome.tabs.get(tabId);

            if (tab.url && tab.url.includes('workvivo.com') && tab.url.includes('/chat')) {
                // On WorkVivo chat - show optimistic badge immediately
                if (immediate || tabStatusCache.has(tabId)) {
                    const cachedStatus = tabStatusCache.get(tabId);
                    if (cachedStatus === 'working' || !cachedStatus) {
                        // Show green badge immediately (optimistic)
                        chrome.action.setBadgeText({ text: '✓', tabId: tabId });
                        chrome.action.setBadgeBackgroundColor({ color: '#28a745', tabId: tabId }); // Green
                    }
                }

                // Then verify with ping in background (non-blocking)
                chrome.tabs.sendMessage(tabId, { action: 'ping' })
                    .then(() => {
                        // Content script responded - extension is working
                        tabStatusCache.set(tabId, 'working');
                        chrome.action.setBadgeText({ text: '✓', tabId: tabId });
                        chrome.action.setBadgeBackgroundColor({ color: '#28a745', tabId: tabId }); // Green
                    })
                    .catch(() => {
                        // Content script not responding - extension not working
                        tabStatusCache.set(tabId, 'not-working');
                        chrome.action.setBadgeText({ text: '!', tabId: tabId });
                        chrome.action.setBadgeBackgroundColor({ color: '#ffc107', tabId: tabId }); // Yellow/Orange
                    });
            } else {
                // Not on WorkVivo chat - extension can't work here
                tabStatusCache.delete(tabId); // Clear cache for non-chat tabs
                chrome.action.setBadgeText({ text: '', tabId: tabId });
            }
        } catch (error) {
            console.error('Error updating badge:', error);
            // On error, show warning badge
            if (tabId) {
                chrome.action.setBadgeText({ text: '!', tabId: tabId });
                chrome.action.setBadgeBackgroundColor({ color: '#dc3545', tabId: tabId }); // Red
            }
        }
    }
}

// Listen for tab changes to update badge
chrome.tabs.onActivated.addListener((activeInfo) => {
    // Update immediately when switching tabs
    updateBadge(activeInfo.tabId, true);
});

// Listen for tab updates (URL changes, page loads)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (tab.active) {
        if (changeInfo.url) {
            // URL changed - update immediately
            updateBadge(tabId, true);
        } else if (changeInfo.status === 'complete') {
            // Page finished loading - do a thorough check
            updateBadge(tabId, false);
        }
    }
});

// Listen for window focus changes
chrome.windows.onFocusChanged.addListener((windowId) => {
    if (windowId !== chrome.windows.WINDOW_ID_NONE) {
        updateBadge();
    }
});

// Update badge on startup and check OAuth token
chrome.runtime.onStartup.addListener(() => {
    updateBadge();
    checkAndRefreshTokenOnStartup();
});

// Initial badge update and token check
updateBadge();
checkAndRefreshTokenOnStartup();

// ===== ANALYTICS HANDLING =====

/**
 * Handle GA4 event sending from content scripts
 * This runs in the background script to avoid CORS issues
 * CENTRALIZED POINT: Adds device/geo data to ALL events based on user settings
 */
async function handleGA4Event(eventData) {
    const GA4_MEASUREMENT_ID = 'G-DPXPRJM747';
    const GA4_API_SECRET = 'yeHKo5OBT0W0ZPS2QR38xw';
    const GA4_ENDPOINT = `https://www.google-analytics.com/mp/collect?measurement_id=${GA4_MEASUREMENT_ID}&api_secret=${GA4_API_SECRET}`;

    try {
        console.debug('📤 Background: Sending GA4 event:', eventData.events[0].name);

        // CENTRALIZED: Add device/geo data if not already present and user opted in
        if (!eventData.device && !eventData.user_location) {
            // Read user's shareUsageData preference from storage
            const settings = await chrome.storage.sync.get(['workvivoSettings']);
            const shareUsageData = settings.workvivoSettings?.shareUsageData;

            // Add device/geo data if user opted in
            if (shareUsageData) {
                const deviceGeo = detectEssentialDeviceGeo();
                if (deviceGeo) {
                    eventData.device = deviceGeo.device;
                    eventData.user_location = deviceGeo.user_location;
                    console.debug('📍 Background: Added device/geo data to event');
                }
            }
        }

        const response = await fetch(GA4_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(eventData)
        });

        if (response.ok) {
            console.debug('✅ Background: GA4 event sent successfully:', eventData.events[0].name);
            return { status: response.status, statusText: response.statusText };
        } else {
            const responseText = await response.text().catch(() => 'Unable to read response');
            // Background: GA4 API error - handled silently
            throw new Error(`GA4 API error: ${response.status} ${response.statusText}`);
        }

    } catch (error) {
        // Background: Failed to send GA4 event - handled silently
        throw error;
    }
}

/**
 * Enhanced rate limiting for GA4 requests with intelligent queuing and prioritization
 */
const ga4RequestTimestamps = [];
const ga4EventQueue = [];
const MAX_GA4_REQUESTS_PER_MINUTE = 100; // Increased limit for essential events
const MAX_QUEUE_SIZE = 500; // Maximum events to queue
let isProcessingQueue = false;

function canSendGA4Request() {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;

    // Remove timestamps older than 1 minute
    const recentRequests = ga4RequestTimestamps.filter(timestamp => timestamp > oneMinuteAgo);
    ga4RequestTimestamps.length = 0;
    ga4RequestTimestamps.push(...recentRequests);

    // Check if we're under the rate limit
    return ga4RequestTimestamps.length < MAX_GA4_REQUESTS_PER_MINUTE;
}

// Event prioritization system for intelligent queuing
function getEventPriority(eventName) {
    // Critical events - always send immediately if possible
    const critical = ['javascript_error', 'extension_installed', 'extension_updated'];

    // High priority - essential user interactions and feature usage
    const high = [
        'session_started', 'session_ended', 'info_button_clicked', 'email_copied_successfully',
        'chat_pinned', 'chat_unpinned', 'search_performed', 'search_completed',
        'profile_accessed', 'email_button_clicked', 'search_widget_opened',
        'popup_opened', 'options_page_opened', 'setting_changed', 'settings_saved',
        'floating_widget_setting_changed', 'consent_revoke_confirmed', 'data_deletion_confirmed'
    ];

    // Low priority - analytics and performance
    const low = [
        'feature_discovered', 'ui_render_time', 'memory_usage_snapshot', 'database_operation_time',
        'popup_refresh_clicked', 'popup_settings_clicked', 'popup_clear_stats_clicked',
        'analytics_stats_viewed', 'consent_revoke_cancelled', 'data_deletion_cancelled'
    ];

    if (critical.includes(eventName)) return 1;
    if (high.includes(eventName)) return 2;
    if (low.includes(eventName)) return 3;
    return 2; // Default high priority
}

// Queue event with intelligent prioritization
function queueGA4Event(eventData) {
    // Don't queue if queue is full - drop lowest priority events
    if (ga4EventQueue.length >= MAX_QUEUE_SIZE) {
        ga4EventQueue.sort((a, b) => b.priority - a.priority);
        const dropped = ga4EventQueue.pop();
        console.warn('⚠️ GA4 queue full, dropping low priority event:', dropped.eventData.events?.[0]?.name);
    }

    const eventName = eventData.events?.[0]?.name || 'unknown';
    const priority = getEventPriority(eventName);

    ga4EventQueue.push({
        eventData,
        priority,
        timestamp: Date.now(),
        eventName
    });

    // Sort by priority (lower number = higher priority)
    ga4EventQueue.sort((a, b) => a.priority - b.priority);

    // Start processing queue if not already running
    if (!isProcessingQueue) {
        setTimeout(processGA4Queue, 100);
    }
}

// Process queued events with intelligent timing
async function processGA4Queue() {
    if (isProcessingQueue || ga4EventQueue.length === 0) {
        return;
    }

    isProcessingQueue = true;

    try {
        let processed = 0;
        const maxProcessPerCycle = 5; // Limit processing per cycle

        while (ga4EventQueue.length > 0 && processed < maxProcessPerCycle) {
            if (!canSendGA4Request()) {
                // Rate limit reached, schedule next processing
                setTimeout(processGA4Queue, 5000); // Try again in 5 seconds
                break;
            }

            const queuedEvent = ga4EventQueue.shift();

            // Skip very old events (older than 10 minutes) except critical ones
            if (Date.now() - queuedEvent.timestamp > 600000 && queuedEvent.priority > 1) {
                console.warn('⚠️ Dropping old GA4 event:', queuedEvent.eventName);
                continue;
            }

            ga4RequestTimestamps.push(Date.now());

            try {
                await originalHandleGA4Event(queuedEvent.eventData);
                processed++;

                // Progressive delay based on queue size
                const delay = ga4EventQueue.length > 50 ? 200 : 100;
                await new Promise(resolve => setTimeout(resolve, delay));
            } catch (error) {
                console.error('❌ Failed to send queued GA4 event:', queuedEvent.eventName, error);
            }
        }

        // Schedule next processing if queue not empty
        if (ga4EventQueue.length > 0) {
            setTimeout(processGA4Queue, 2000);
        }
    } catch (error) {
        console.error('❌ Error processing GA4 queue:', error);
    } finally {
        isProcessingQueue = false;
    }
}

// Enhanced handleGA4Event with intelligent queuing instead of errors
const originalHandleGA4Event = handleGA4Event;
handleGA4Event = async function(eventData) {
    const eventName = eventData.events?.[0]?.name || 'unknown';
    const priority = getEventPriority(eventName);

    // Critical events bypass rate limiting if possible
    if (priority === 1 && canSendGA4Request()) {
        ga4RequestTimestamps.push(Date.now());
        return originalHandleGA4Event(eventData);
    }

    // Check if we can send immediately
    if (canSendGA4Request()) {
        ga4RequestTimestamps.push(Date.now());
        return originalHandleGA4Event(eventData);
    }

    // Rate limit reached - queue the event instead of throwing error
    console.debug(`🕐 GA4 rate limit reached, queuing event: ${eventName} (priority: ${priority})`);
    queueGA4Event(eventData);

    // Return success to prevent error propagation
    return { success: true, queued: true, eventName, priority };
};

// Queue monitoring and debugging functions
function getGA4QueueStats() {
    const priorityCounts = { 1: 0, 2: 0, 3: 0 };
    ga4EventQueue.forEach(event => {
        priorityCounts[event.priority]++;
    });

    return {
        queueSize: ga4EventQueue.length,
        maxQueueSize: MAX_QUEUE_SIZE,
        isProcessing: isProcessingQueue,
        recentRequestCount: ga4RequestTimestamps.length,
        maxRequestsPerMinute: MAX_GA4_REQUESTS_PER_MINUTE,
        canSendNow: canSendGA4Request(),
        priorityCounts,
        oldestEvent: ga4EventQueue.length > 0 ?
            new Date(Math.min(...ga4EventQueue.map(e => e.timestamp))).toISOString() : null
    };
}

// Expose queue stats for debugging
if (typeof chrome !== 'undefined' && chrome.runtime) {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'getGA4QueueStats') {
            sendResponse(getGA4QueueStats());
            return true;
        }
    });
}

/**
 * Extract enhanced geographic data from timezone (GA4 Measurement Protocol compliant)
 * Returns object with city, region_id, country_id, subcontinent_id, continent_id
 * Following GA4 Measurement Protocol specification
 */
function extractGeographicDataFromTimezone(timezone, countryCode) {
    try {
        // Parse timezone to extract region and city
        const parts = timezone.split('/');
        const continent = parts[0]; // e.g., "Asia", "Europe", "America"
        let cityRaw = parts[parts.length - 1]; // e.g., "Kuala_Lumpur", "New_York"
        let state = parts.length > 2 ? parts[1] : null; // e.g., "Indiana" from "America/Indiana/Indianapolis"

        // Format city name (replace underscores with spaces)
        const city = cityRaw.replace(/_/g, ' ');

        // UN M49 continent codes
        const continentCodes = {
            'Africa': '002',
            'Americas': '019', // Note: "America" in timezone becomes "Americas" in UN M49
            'America': '019',
            'Asia': '142',
            'Europe': '150',
            'Oceania': '009',
            'Pacific': '009',
            'Antarctica': '009', // Antarctic regions
            'Arctic': '150',     // Arctic (part of Europe)
            'Atlantic': '019',   // Atlantic islands (part of Americas)
            'Indian': '142'      // Indian Ocean (part of Asia)
        };

        // UN M49 subcontinent codes (major subcontinents only)
        const subcontinentCodes = {
            // Africa
            'Northern Africa': '015',
            'Sub-Saharan Africa': '202',
            'Eastern Africa': '014',
            'Middle Africa': '017',
            'Southern Africa': '018',
            'Western Africa': '011',

            // Americas
            'Latin America and the Caribbean': '419',
            'Northern America': '021',
            'Caribbean': '029',
            'Central America': '013',
            'South America': '005',

            // Asia
            'Central Asia': '143',
            'Eastern Asia': '030',
            'South-eastern Asia': '035',
            'Southern Asia': '034',
            'Western Asia': '145',

            // Europe
            'Eastern Europe': '151',
            'Northern Europe': '154',
            'Southern Europe': '039',
            'Western Europe': '155',

            // Oceania
            'Australia and New Zealand': '053',
            'Melanesia': '054',
            'Micronesia': '057',
            'Polynesia': '061'
        };

        // Map countries to subcontinents (selection of major countries)
        const countryToSubcontinent = {
            // Asia - South-eastern
            'MY': '035', 'SG': '035', 'TH': '035', 'ID': '035', 'PH': '035',
            'VN': '035', 'MM': '035', 'KH': '035', 'LA': '035', 'BN': '035', 'TL': '035',

            // Asia - Eastern
            'CN': '030', 'JP': '030', 'KR': '030', 'KP': '030', 'MN': '030',
            'TW': '030', 'HK': '030', 'MO': '030',

            // Asia - Southern
            'IN': '034', 'PK': '034', 'BD': '034', 'LK': '034', 'NP': '034',
            'BT': '034', 'MV': '034', 'AF': '034',

            // Asia - Western
            'SA': '145', 'AE': '145', 'IL': '145', 'IQ': '145', 'IR': '145',
            'JO': '145', 'KW': '145', 'LB': '145', 'OM': '145', 'QA': '145',
            'SY': '145', 'TR': '145', 'YE': '145', 'BH': '145', 'CY': '145', 'PS': '145',

            // Asia - Central
            'KZ': '143', 'UZ': '143', 'TM': '143', 'TJ': '143', 'KG': '143',

            // Europe - Western
            'GB': '154', 'FR': '155', 'DE': '155', 'NL': '155', 'BE': '155',
            'CH': '155', 'AT': '155', 'LU': '155', 'LI': '155', 'MC': '155',

            // Europe - Northern
            'SE': '154', 'NO': '154', 'DK': '154', 'FI': '154', 'IS': '154',
            'IE': '154', 'EE': '154', 'LV': '154', 'LT': '154',

            // Europe - Southern
            'ES': '039', 'IT': '039', 'PT': '039', 'GR': '039', 'MT': '039',
            'SM': '039', 'VA': '039', 'AD': '039', 'AL': '039', 'BA': '039',
            'HR': '039', 'ME': '039', 'MK': '039', 'RS': '039', 'SI': '039',

            // Europe - Eastern
            'RU': '151', 'UA': '151', 'BY': '151', 'MD': '151', 'BG': '151',
            'RO': '151', 'CZ': '151', 'HU': '151', 'PL': '151', 'SK': '151',

            // Americas - Northern
            'US': '021', 'CA': '021',

            // Americas - Central
            'MX': '013', 'GT': '013', 'BZ': '013', 'HN': '013', 'SV': '013',
            'NI': '013', 'CR': '013', 'PA': '013',

            // Americas - Caribbean
            'CU': '029', 'JM': '029', 'HT': '029', 'DO': '029', 'PR': '029',
            'TT': '029', 'BB': '029', 'BS': '029',

            // Americas - South
            'BR': '005', 'AR': '005', 'CL': '005', 'CO': '005', 'VE': '005',
            'PE': '005', 'EC': '005', 'BO': '005', 'PY': '005', 'UY': '005',
            'GY': '005', 'SR': '005', 'GF': '005',

            // Africa - Northern
            'EG': '015', 'LY': '015', 'TN': '015', 'DZ': '015', 'MA': '015', 'SD': '015',

            // Africa - Sub-Saharan
            'NG': '011', 'ZA': '018', 'KE': '014', 'ET': '014', 'TZ': '014',
            'UG': '014', 'GH': '011', 'CD': '017', 'CM': '017', 'ZW': '018',

            // Oceania
            'AU': '053', 'NZ': '053', 'PG': '054', 'FJ': '054'
        };

        // Build the enhanced location object
        const location = {
            country_id: countryCode
        };

        // Add city if available
        if (city && city !== countryCode) {
            location.city = city;
        }

        // Add region_id for US states (ISO 3166-2 format)
        if (countryCode === 'US' && state) {
            // Map state names to abbreviations
            const stateAbbr = {
                'Indiana': 'IN', 'Kentucky': 'KY', 'North_Dakota': 'ND',
                'New_York': 'NY', 'Los_Angeles': 'CA', 'Chicago': 'IL',
                'Detroit': 'MI', 'Denver': 'CO', 'Phoenix': 'AZ'
                // Add more as needed
            };
            const abbr = stateAbbr[state] || state.substring(0, 2).toUpperCase();
            location.region_id = `US-${abbr}`;
        }

        // Add subcontinent_id
        const subcontinentId = countryToSubcontinent[countryCode];
        if (subcontinentId) {
            location.subcontinent_id = subcontinentId;
        }

        // Add continent_id
        const continentId = continentCodes[continent];
        if (continentId) {
            location.continent_id = continentId;
        }

        return location;

    } catch (error) {
        console.debug('Failed to extract geographic data from timezone:', error);
        // Return basic structure with just country_id
        return {
            country_id: countryCode
        };
    }
}

/**
 * Detect essential device/geo info in background context (privacy-friendly)
 * Matches AnalyticsManager.detectEssentialDeviceGeo() for consistency
 */
function detectEssentialDeviceGeo() {
    try {
        const userAgent = navigator.userAgent;

        // Device category
        const isMobile = /Mobile|Android|iPhone|iPad|iPod/i.test(userAgent);
        const category = isMobile ? 'mobile' : 'desktop';

        // Operating system
        let os = 'unknown';
        if (userAgent.includes('Win')) os = 'Windows';
        else if (userAgent.includes('Mac')) os = 'macOS';
        else if (userAgent.includes('Linux')) os = 'Linux';
        else if (userAgent.includes('Android')) os = 'Android';
        else if (userAgent.includes('iOS') || userAgent.includes('iPhone') || userAgent.includes('iPad')) os = 'iOS';

        // Browser
        let browser = 'unknown';
        if (userAgent.includes('Chrome') && !userAgent.includes('Edg')) browser = 'Chrome';
        else if (userAgent.includes('Edg')) browser = 'Edge';
        else if (userAgent.includes('Firefox')) browser = 'Firefox';
        else if (userAgent.includes('Safari') && !userAgent.includes('Chrome')) browser = 'Safari';

        // Country (privacy-friendly detection)
        let country = 'unknown';
        try {
            // Method 1: Timezone-based detection (most accurate for geographic location)
            // Comprehensive timezone mappings (387 timezones) from IANA timezone database
            try {
                const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
                const timezoneToCountry = {
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

                if (timezoneToCountry[timezone]) {
                    country = timezoneToCountry[timezone];
                    console.debug('🌍 Country detected via timezone:', timezone, '→', country);
                }

                // Extract additional geographic data from timezone (GA4 Measurement Protocol compliant)
                if (timezone && country !== 'unknown') {
                    const geoData = extractGeographicDataFromTimezone(timezone, country);
                    if (geoData) {
                        console.debug('📍 Enhanced geo data:', geoData);
                        // Store for later use
                        country = geoData;
                    }
                }
            } catch (error) {
                console.debug('Timezone detection failed:', error);
            }

            // Method 2: Chrome i18n API (fallback)
            if (country === 'unknown' && chrome.i18n && chrome.i18n.getUILanguage) {
                const uiLanguage = chrome.i18n.getUILanguage();
                if (uiLanguage.includes('-')) {
                    country = uiLanguage.split('-')[1].toUpperCase();
                    console.debug('🌍 Country detected via Chrome i18n:', uiLanguage, '→', country);
                }
            }

            // Method 3: Navigator language (last resort fallback)
            if (country === 'unknown') {
                const language = navigator.language || navigator.languages?.[0];
                if (language && language.includes('-')) {
                    country = language.split('-')[1].toUpperCase();
                    console.debug('🌍 Country detected via navigator language:', language, '→', country);
                }
            }
        } catch (error) {
            // Country detection failed, keep as 'unknown'
            console.debug('All country detection methods failed:', error);
        }

        return {
            device: {
                category: category,
                operating_system: os,
                browser: browser
            },
            user_location: typeof country === 'object' ? country : { country_id: country }
        };
    } catch (error) {
        console.warn('🔍 Device/geo detection failed:', error);
        return null;
    }
}

/**
 * Generate UUID for client ID (matches AnalyticsManager implementation)
 */
function generateClientId() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

/**
 * Get or create persistent client_id from chrome.storage.local
 * Ensures all events from all contexts use the same client_id
 */
async function getPersistentClientId() {
    try {
        const result = await chrome.storage.local.get(['analytics_client_id']);

        if (result.analytics_client_id) {
            return result.analytics_client_id;
        }

        // Generate new client_id if none exists
        const newClientId = generateClientId();
        await chrome.storage.local.set({ analytics_client_id: newClientId });
        return newClientId;
    } catch (error) {
        console.warn('Failed to get persistent client_id, using temporary fallback:', error);
        return 'background-fallback-' + Date.now();
    }
}

/**
 * Track installation/update events (called from background script)
 * These events ALWAYS include device/country data for installation analytics
 * Uses official GA4 structure with top-level device/user_location fields
 */
async function trackInstallationEvent(eventName, parameters) {
    try {
        // Get persistent client_id (same as content script, popup, and options page)
        const clientId = await getPersistentClientId();

        // Detect device/geo info
        const deviceGeo = detectEssentialDeviceGeo();

        // Create GA4 event payload with official structure
        const eventPayload = {
            client_id: clientId, // Use persistent client_id across all contexts
            events: [{
                name: eventName,
                params: {
                    engagement_time_msec: 100,
                    extension_version: chrome.runtime.getManifest()?.version || 'unknown',
                    device_data_enabled: true, // Always true for installation events
                    ...parameters  // Original parameters
                }
            }]
        };

        // Add device/geo as top-level fields (official GA4 structure)
        if (deviceGeo) {
            eventPayload.device = deviceGeo.device;
            eventPayload.user_location = deviceGeo.user_location;
        }

        // Send directly from background script
        await handleGA4Event(eventPayload);

    } catch (error) {
        // Track installation events failed - handled silently
    }
}

/**
 * Initialize jurisdiction-aware privacy settings on first install
 */
async function initializeJurisdictionAwarePrivacy() {
    try {
        // Simple jurisdiction detection in background context
        const jurisdiction = await detectJurisdictionInBackground();

        // Get privacy tier based on jurisdiction
        const privacyTier = getPrivacyTierForJurisdiction(jurisdiction);

        // Set jurisdiction-appropriate defaults
        const defaultSettings = getJurisdictionDefaults(privacyTier);

        // Update settings with jurisdiction-aware defaults
        const result = await chrome.storage.sync.get(['workvivoSettings']);
        const currentSettings = result.workvivoSettings || {};

        const updatedSettings = {
            ...currentSettings,
            analyticsEnabled: defaultSettings.analyticsEnabled,
            shareUsageData: defaultSettings.shareUsageData,
            jurisdiction: jurisdiction,
            privacyTier: privacyTier,
            privacyInitialized: true,
            privacyInitTimestamp: Date.now()
        };

        await chrome.storage.sync.set({ workvivoSettings: updatedSettings });

        console.log(`🌍 Jurisdiction-aware privacy initialized: ${jurisdiction} (${privacyTier})`);

        // Track jurisdiction detection for analytics
        trackInstallationEvent('jurisdiction_detected_background', {
            jurisdiction: jurisdiction,
            privacy_tier: privacyTier,
            analytics_default: defaultSettings.analyticsEnabled,
            usage_data_default: defaultSettings.shareUsageData
        });

    } catch (error) {
        console.warn('🌍 Jurisdiction detection failed, using conservative defaults:', error);

        // Fallback to strict consent defaults
        const result = await chrome.storage.sync.get(['workvivoSettings']);
        const currentSettings = result.workvivoSettings || {};

        const conservativeSettings = {
            ...currentSettings,
            analyticsEnabled: false,  // Conservative default
            shareUsageData: false,    // Conservative default
            jurisdiction: 'unknown',
            privacyTier: 'strict_consent',
            privacyInitialized: true,
            privacyInitTimestamp: Date.now()
        };

        await chrome.storage.sync.set({ workvivoSettings: conservativeSettings });
    }
}

/**
 * Detect jurisdiction in background context using available APIs
 */
async function detectJurisdictionInBackground() {
    try {
        // Method 1: Chrome i18n API
        if (chrome.i18n && chrome.i18n.getUILanguage) {
            const uiLanguage = chrome.i18n.getUILanguage();
            if (uiLanguage.includes('-')) {
                const country = uiLanguage.split('-')[1].toUpperCase();
                console.log('🌍 Background: Detected country via Chrome i18n:', country);
                return country;
            }
        }

        // Method 2: Accept-Language header estimation
        const language = navigator.language || navigator.languages?.[0];
        if (language && language.includes('-')) {
            const country = language.split('-')[1].toUpperCase();
            console.log('🌍 Background: Detected country via navigator language:', country);
            return country;
        }

        // Default fallback
        return 'US';

    } catch (error) {
        console.warn('🌍 Background jurisdiction detection failed:', error);
        return 'US'; // Safe default
    }
}

/**
 * Get privacy tier for jurisdiction
 */
function getPrivacyTierForJurisdiction(country) {
    // GDPR countries (EU/EEA)
    const strictConsentCountries = [
        'DE', 'FR', 'IT', 'ES', 'NL', 'BE', 'AT', 'PL', 'SE', 'DK', 'FI', 'NO',
        'IE', 'PT', 'GR', 'CZ', 'HU', 'SK', 'SI', 'EE', 'LV', 'LT', 'BG', 'RO',
        'HR', 'MT', 'CY', 'LU'
    ];

    if (strictConsentCountries.includes(country)) {
        return 'strict_consent';
    }

    // Countries with privacy laws but permissive defaults
    const optInPermissibleCountries = ['CA', 'AU', 'GB', 'NZ'];
    if (country === 'US' || optInPermissibleCountries.includes(country)) {
        return 'opt_in_permissible';
    }

    // Other countries - minimal requirements
    return 'minimal_requirements';
}

/**
 * Get default settings for privacy tier
 */
function getJurisdictionDefaults(privacyTier) {
    switch (privacyTier) {
        case 'strict_consent':
            return {
                analyticsEnabled: false,  // Require explicit consent
                shareUsageData: false,    // Require explicit consent
                errorReporting: true      // Always enabled
            };

        case 'opt_in_permissible':
            return {
                analyticsEnabled: true,   // Default enabled with opt-out
                shareUsageData: true,     // Default enabled with opt-out
                errorReporting: true      // Always enabled
            };

        case 'minimal_requirements':
        default:
            return {
                analyticsEnabled: true,   // Default enabled
                shareUsageData: true,     // Default enabled
                errorReporting: true      // Always enabled
            };
    }
}

// ===== GOOGLE MEET OAUTH HANDLING =====

/**
 * Initiate OAuth 2.0 Authorization Code Flow with PKCE
 *
 * OAuth 2.0 with PKCE provides better security than Implicit Flow:
 * - Authorization code (not token) in redirect URL
 * - PKCE prevents code interception attacks
 * - Refresh tokens enable automatic token renewal
 * - Compliant with OAuth 2.1 recommendations
 *
 * @param {boolean} interactive - Whether to show UI for authentication
 * @returns {Promise<Object|null>} Auth data with refresh token, or null if failed
 */
async function attemptAuthCodeFlowWithPKCE(interactive = false) {
    try {
        console.log(`🔐 Starting OAuth ${interactive ? 'interactive' : 'silent'} flow with PKCE...`);

        // Generate PKCE values
        const { verifier, challenge } = await WVFavs.PKCEUtils.generatePKCEPair();
        const state = WVFavs.PKCEUtils.generateState();

        // Store verifier and state temporarily (needed for token exchange)
        await chrome.storage.session.set({
            oauth_code_verifier: verifier,
            oauth_state: state
        });

        // Build authorization URL with PKCE
        const authUrl = new URL(OAUTH_CONFIG.authEndpoint);
        authUrl.searchParams.append('client_id', OAUTH_CONFIG.clientId);
        authUrl.searchParams.append('response_type', 'code'); // Authorization code, not token
        authUrl.searchParams.append('redirect_uri', OAUTH_CONFIG.redirectUri);
        authUrl.searchParams.append('scope', OAUTH_CONFIG.scopes.join(' '));
        authUrl.searchParams.append('state', state);
        authUrl.searchParams.append('code_challenge', challenge);
        authUrl.searchParams.append('code_challenge_method', 'S256');
        authUrl.searchParams.append('access_type', 'offline'); // CRITICAL: Get refresh token
        authUrl.searchParams.append('prompt', interactive ? 'consent' : 'none'); // Ensure refresh token

        console.log('📋 OAuth URL constructed with PKCE');

        // Launch OAuth flow
        const redirectUrl = await new Promise((resolve, reject) => {
            chrome.identity.launchWebAuthFlow(
                {
                    url: authUrl.toString(),
                    interactive: interactive
                },
                (redirectUrl) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                        return;
                    }

                    if (!redirectUrl) {
                        reject(new Error('No redirect URL received'));
                        return;
                    }

                    resolve(redirectUrl);
                }
            );
        });

        // Extract authorization code and state from redirect URL
        const url = new URL(redirectUrl);
        const code = url.searchParams.get('code');
        const returnedState = url.searchParams.get('state');

        if (!code) {
            throw new Error('No authorization code in redirect URL');
        }

        // Validate state parameter (CSRF protection)
        if (returnedState !== state) {
            throw new Error('State parameter mismatch - possible CSRF attack');
        }

        console.log('✅ Authorization code received, exchanging for tokens...');

        // Exchange authorization code for tokens
        const authData = await exchangeCodeForTokens(code, verifier);

        // Clean up temporary storage
        await chrome.storage.session.remove(['oauth_code_verifier', 'oauth_state']);

        console.log(`✅ OAuth ${interactive ? 'interactive' : 'silent'} flow completed successfully`);
        return authData;

    } catch (error) {
        console.log(`❌ OAuth ${interactive ? 'interactive' : 'silent'} flow failed:`, error.message);

        // Clean up temporary storage on error
        try {
            await chrome.storage.session.remove(['oauth_code_verifier', 'oauth_state']);
        } catch (cleanupError) {
            // Ignore cleanup errors
        }

        return null;
    }
}

/**
 * Exchange authorization code for access token and refresh token
 *
 * POST to token endpoint with:
 * - Authorization code from OAuth flow
 * - PKCE code_verifier (proves we initiated the request)
 * - Client credentials
 *
 * Receives:
 * - access_token (1 hour validity)
 * - refresh_token (never expires unless revoked)
 * - expires_in (seconds until expiry)
 *
 * @param {string} code - Authorization code from OAuth redirect
 * @param {string} codeVerifier - PKCE code verifier
 * @returns {Promise<Object>} Auth data with tokens and user profile
 */
async function exchangeCodeForTokens(code, codeVerifier) {
    console.log('🔄 Exchanging authorization code for tokens...');

    // Prepare token exchange request
    const tokenRequestBody = new URLSearchParams({
        client_id: OAUTH_CONFIG.clientId,
        client_secret: OAUTH_CONFIG.clientSecret,
        code: code,
        code_verifier: codeVerifier, // PKCE verification
        grant_type: 'authorization_code',
        redirect_uri: OAUTH_CONFIG.redirectUri
    });

    // Exchange code for tokens
    const tokenResponse = await fetch(OAUTH_CONFIG.tokenEndpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: tokenRequestBody.toString()
    });

    if (!tokenResponse.ok) {
        const error = await tokenResponse.json();
        throw new Error(`Token exchange failed: ${error.error_description || error.error}`);
    }

    const tokens = await tokenResponse.json();

    console.log('✅ Tokens received:', {
        hasAccessToken: !!tokens.access_token,
        hasRefreshToken: !!tokens.refresh_token,
        expiresIn: tokens.expires_in
    });

    // Fetch user profile
    const profileResponse = await fetch(OAUTH_CONFIG.userInfoEndpoint, {
        headers: {
            'Authorization': `Bearer ${tokens.access_token}`
        }
    });

    if (!profileResponse.ok) {
        throw new Error('Failed to fetch user profile');
    }

    const profileData = await profileResponse.json();

    // Prepare auth data with refresh token
    const authData = {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token, // NEW! Enables automatic renewal
        expiresAt: Date.now() + (tokens.expires_in * 1000),
        userProfile: {
            name: profileData.name,
            email: profileData.email,
            picture: profileData.picture
        }
    };

    // Store tokens securely
    await chrome.storage.local.set({ googleMeetAuth: authData });

    console.log('✅ Auth data stored with refresh token');

    return authData;
}

/**
 * Refresh access token using refresh token
 *
 * This enables automatic "stay signed in" functionality:
 * - When access token expires (1 hour), use refresh token to get new one
 * - No user interaction required
 * - User stays signed in indefinitely (until manual sign out or token revocation)
 *
 * @param {string} refreshToken - Long-lived refresh token
 * @returns {Promise<Object>} Updated auth data with new access token
 */
async function refreshAccessToken(refreshToken) {
    console.log('🔄 Refreshing access token...');

    const refreshRequestBody = new URLSearchParams({
        client_id: OAUTH_CONFIG.clientId,
        client_secret: OAUTH_CONFIG.clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token'
    });

    const tokenResponse = await fetch(OAUTH_CONFIG.tokenEndpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: refreshRequestBody.toString()
    });

    if (!tokenResponse.ok) {
        const error = await tokenResponse.json();
        throw new Error(`Token refresh failed: ${error.error_description || error.error}`);
    }

    const tokens = await tokenResponse.json();

    // Get current auth data to preserve user profile
    const currentAuth = await chrome.storage.local.get('googleMeetAuth');
    const authData = currentAuth.googleMeetAuth || {};

    // Update with new tokens
    authData.accessToken = tokens.access_token;
    authData.expiresAt = Date.now() + (tokens.expires_in * 1000);

    // Sometimes Google issues new refresh token
    if (tokens.refresh_token) {
        authData.refreshToken = tokens.refresh_token;
        console.log('✅ New refresh token received');
    }

    // Store updated auth data
    await chrome.storage.local.set({ googleMeetAuth: authData });

    console.log('✅ Access token refreshed successfully');

    return authData;
}

/**
 * Get a valid access token, refreshing if necessary
 * This is the main function that content scripts and popup should use
 * to get tokens for API calls
 *
 * @returns {Promise<string|null>} Valid access token or null if not signed in
 */
async function getValidAccessToken() {
    try {
        // Get current auth data
        const result = await chrome.storage.local.get('googleMeetAuth');
        const auth = result.googleMeetAuth;

        // No auth data stored
        if (!auth || !auth.accessToken) {
            console.log('📭 No stored authentication found');
            return null;
        }

        const now = Date.now();
        const timeUntilExpiry = auth.expiresAt - now;

        // Token is still valid (more than 5 minutes remaining)
        if (timeUntilExpiry > 5 * 60 * 1000) {
            return auth.accessToken;
        }

        // Token expired or expiring soon - attempt refresh
        console.log('🔄 Token expiring soon, refreshing...');

        // Check if we have a refresh token
        if (!auth.refreshToken) {
            console.log('⚠️ No refresh token available');
            return null;
        }

        // Use refresh token to get new access token
        try {
            const newAuth = await refreshAccessToken(auth.refreshToken);
            return newAuth.accessToken;
        } catch (error) {
            console.log('❌ Token refresh failed:', error.message);
            // Clear invalid auth
            await chrome.storage.local.remove('googleMeetAuth');
            return null;
        }

    } catch (error) {
        console.error('❌ Error getting valid access token:', error);
        return null;
    }
}

/**
 * Check token validity and attempt refresh on extension startup
 * Called automatically when extension loads
 * Now uses refresh tokens for automatic renewal
 */
async function checkAndRefreshTokenOnStartup() {
    try {
        console.log('🔍 Checking Google Meet auth status on startup...');

        // Get current auth data
        const result = await chrome.storage.local.get('googleMeetAuth');
        const auth = result.googleMeetAuth;

        // No auth data stored
        if (!auth || !auth.accessToken) {
            console.log('📭 No stored authentication found');
            return;
        }

        const now = Date.now();
        const timeUntilExpiry = auth.expiresAt - now;

        // Token is still valid (more than 10 minutes remaining)
        if (timeUntilExpiry > 10 * 60 * 1000) {
            console.log(`✅ Token is valid for ${Math.round(timeUntilExpiry / 60000)} more minutes`);
            return;
        }

        // Token expired or expiring soon - attempt refresh with refresh token
        console.log('⚠️ Token expired or expiring soon, attempting refresh...');

        // Check if we have a refresh token
        if (!auth.refreshToken) {
            console.log('🗑️ No refresh token available, clearing expired auth');
            await chrome.storage.local.remove('googleMeetAuth');
            return;
        }

        // Use refresh token to get new access token
        try {
            const newAuth = await refreshAccessToken(auth.refreshToken);
            console.log('✅ Token refreshed successfully');
        } catch (error) {
            // Refresh token failed (likely revoked) - clear auth
            console.log('🗑️ Refresh token failed, clearing expired auth:', error.message);
            await chrome.storage.local.remove('googleMeetAuth');
        }

    } catch (error) {
        console.error('❌ Error checking token on startup:', error);
    }
}

/**
 * Proactive token refresh - checks every 30 minutes and refreshes at 50-minute mark
 * Helps keep users signed in during active usage
 * Now uses refresh tokens for automatic renewal
 */
async function proactiveTokenRefresh() {
    try {
        // Get current auth data
        const result = await chrome.storage.local.get('googleMeetAuth');
        const auth = result.googleMeetAuth;

        // No auth data - skip
        if (!auth || !auth.accessToken) {
            return;
        }

        const now = Date.now();
        const timeUntilExpiry = auth.expiresAt - now;
        const minutesRemaining = Math.round(timeUntilExpiry / 60000);

        console.log(`⏰ Token check: ${minutesRemaining} minutes remaining`);

        // Refresh if less than 10 minutes remaining (50+ minutes have passed)
        if (timeUntilExpiry < 10 * 60 * 1000 && timeUntilExpiry > 0) {
            console.log('🔄 Proactive token refresh triggered');

            // Check if we have a refresh token
            if (!auth.refreshToken) {
                console.log('⚠️ No refresh token available, cannot refresh');
                return;
            }

            // Use refresh token to get new access token
            try {
                await refreshAccessToken(auth.refreshToken);
                console.log('✅ Token refreshed proactively');
            } catch (error) {
                console.log('⚠️ Proactive refresh failed:', error.message);
                // Don't clear the token yet - let it expire naturally
                // User will be prompted to sign in when they try to use GMeet
            }
        }

    } catch (error) {
        console.error('❌ Error in proactive token refresh:', error);
    }
}

// Start proactive token refresh timer (check every 30 minutes)
setInterval(proactiveTokenRefresh, 30 * 60 * 1000);

/**
 * Handle Google Meet OAuth authentication
 * Uses Authorization Code Flow with PKCE for secure authentication
 * chrome.identity API is only available in background scripts
 */
async function handleGoogleMeetAuth() {
    try {
        console.log('🔐 Starting Google Meet authentication...');

        // Use the new OAuth flow with PKCE (interactive mode)
        const authData = await attemptAuthCodeFlowWithPKCE(true);

        if (!authData) {
            throw new Error('Authentication failed');
        }

        console.log('✅ Google Meet authentication successful');
        return authData;

    } catch (error) {
        console.error('Google authentication failed:', error);
        throw error;
    }
}

/**
 * Handle Google Meet sign out
 * Revokes the OAuth token from Google's servers
 */
async function handleGoogleMeetSignOut(token) {
    if (!token) {
        throw new Error('No token provided');
    }

    try {
        // Revoke the token from Google's servers
        // This ensures the user sees the consent screen next time
        const revokeResponse = await fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`, {
            method: 'POST'
        });

        if (!revokeResponse.ok) {
            console.warn('Token revocation from Google failed, but continuing with local cleanup');
        }

        // Clear from storage
        await chrome.storage.local.remove(['googleMeetAuth']);

        console.log('✅ Signed out from Google Meet and revoked token');
    } catch (error) {
        console.error('Error revoking token from Google:', error);
        // Still clear local storage even if revocation fails
        await chrome.storage.local.remove(['googleMeetAuth']);
    }
}

/**
 * Clear all Google authentication and force account selection on next sign-in
 * This removes ALL cached Google tokens from Chrome
 */
async function handleClearGoogleAuth() {
    try {
        // Get current auth data
        const authData = await chrome.storage.local.get(['googleMeetAuth']);

        if (authData.googleMeetAuth && authData.googleMeetAuth.accessToken) {
            const token = authData.googleMeetAuth.accessToken;

            // Revoke from Google servers
            try {
                await fetch(`https://accounts.google.com/o/oauth2/revoke?token=${token}`, {
                    method: 'POST'
                });
                console.log('✅ Token revoked from Google servers');
            } catch (error) {
                console.warn('Token revocation failed:', error);
            }
        }

        // Clear from storage
        await chrome.storage.local.remove(['googleMeetAuth']);

        console.log('✅ Cleared all Google authentication data');
    } catch (error) {
        console.error('Error clearing Google auth:', error);
        throw error;
    }
}
