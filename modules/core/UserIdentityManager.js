/**
 * UserIdentityManager - Detects and manages current user identity
 * Stores user information in Chrome extension storage for persistence
 */

var WVFavs = WVFavs || {};

WVFavs.UserIdentityManager = class UserIdentityManager {
    constructor(app) {
        this.app = app;
        this.currentUser = null;
        this.detectionAttempts = 0;
        this.maxDetectionAttempts = 10;
    }

    /**
     * Initialize the manager - load from storage and set up detection
     */
    async init() {
        this.app?.logger?.log('🔐 UserIdentityManager: Initializing...');

        // Load from extension storage first
        await this.loadFromStorage();

        // Set up detection methods
        this.setupDetection();

        // If no user in storage, start detection
        if (!this.currentUser) {
            this.app?.logger?.log('🔍 No user in storage, starting detection...');
            await this.startDetection();
        } else {
            this.app?.logger?.log('✅ User loaded from storage:', this.currentUser);
        }
    }

    /**
     * Load user data from Chrome extension storage
     */
    async loadFromStorage() {
        try {
            const stored = await chrome.storage.local.get(['wv_current_user']);
            if (stored.wv_current_user) {
                this.currentUser = stored.wv_current_user;
                this.app?.logger?.log('📦 Loaded user from storage:', this.currentUser);
                return this.currentUser;
            }
        } catch (error) {
            this.app?.logger?.log('❌ Error loading user from storage:', error);
        }
        return null;
    }

    /**
     * Save user data to Chrome extension storage
     */
    async saveToStorage(userData) {
        try {
            const userToSave = {
                id: userData.id || userData.user_id,
                name: userData.name || userData.nickname,
                nickname: userData.nickname || userData.name,
                profile_url: userData.profile_url || userData.profileUrl,
                detected_from: userData.detected_from,
                detected_at: Date.now(),
                // Preserve fullProfile if it exists
                fullProfile: userData.fullProfile
            };

            await chrome.storage.local.set({
                wv_current_user: userToSave
            });

            this.currentUser = userToSave;
            this.app?.logger?.log('💾 Saved user to storage:', userToSave);

            // Dispatch event for other modules
            window.dispatchEvent(new CustomEvent('wv-user-saved', {
                detail: userToSave
            }));

            return userToSave;
        } catch (error) {
            this.app?.logger?.log('❌ Error saving user to storage:', error);
            return null;
        }
    }

    /**
     * Get current user - from cache, storage, or detection
     */
    async getCurrentUser() {
        // Return from cache if available
        if (this.currentUser) {
            return this.currentUser;
        }

        // Try loading from storage
        const fromStorage = await this.loadFromStorage();
        if (fromStorage) {
            return fromStorage;
        }

        // Try detection methods
        await this.startDetection();

        return this.currentUser;
    }

    /**
     * Start detection process through various methods
     */
    async startDetection() {
        this.detectionAttempts++;

        if (this.detectionAttempts > this.maxDetectionAttempts) {
            this.app?.logger?.log('⚠️ Max detection attempts reached');
            return null;
        }

        this.app?.logger?.log(`🔍 Detection attempt ${this.detectionAttempts}/${this.maxDetectionAttempts}`);

        // Method 1: Check intercepted API data from window object
        const fromApi = this.detectFromAPI();
        if (fromApi) {
            await this.saveToStorage({ ...fromApi, detected_from: 'sendbird_api_intercept' });
            return this.currentUser;
        }

        // Method 2: Check browser storage (localStorage/sessionStorage)
        const fromBrowserStorage = this.detectFromBrowserStorage();
        if (fromBrowserStorage) {
            await this.saveToStorage({ ...fromBrowserStorage, detected_from: 'browser_storage' });
            return this.currentUser;
        }

        // Method 3: Check DOM elements
        const fromDOM = this.detectFromDOM();
        if (fromDOM) {
            await this.saveToStorage({ ...fromDOM, detected_from: 'dom_extraction' });
            return this.currentUser;
        }

        // Method 4: Infer from messages (fallback)
        const inferred = await this.inferFromMessages();
        if (inferred) {
            await this.saveToStorage({ ...inferred, detected_from: 'message_inference' });
            return this.currentUser;
        }

        this.app?.logger?.log('❌ User detection failed in this attempt');

        // Retry after delay
        if (this.detectionAttempts < this.maxDetectionAttempts) {
            setTimeout(() => this.startDetection(), 2000);
        }

        return null;
    }

    /**
     * Set up event listeners for user identification
     */
    setupDetection() {
        // Listen for user-identified event from interceptor
        window.addEventListener('wv-user-identified', async (event) => {
            const userData = event.detail;
            this.app?.logger?.log('📨 Received wv-user-identified event:', userData);
            await this.saveToStorage({ ...userData, detected_from: 'api_intercept_event' });
        });

        // Listen for message events that might contain user info
        window.addEventListener('wv-thread-messages', (event) => {
            if (!this.currentUser) {
                this.tryExtractUserFromMessages(event.detail.messages);
            }
        });
    }

    /**
     * Detect user from intercepted API data
     */
    detectFromAPI() {
        try {
            // Check if interceptor stored user data in window
            if (window.__wvCurrentUser) {
                this.app?.logger?.log('✅ Found user in window.__wvCurrentUser');
                return window.__wvCurrentUser;
            }

            // Check thread data for user patterns
            if (window.__wvThreadData && window.__wvThreadData.messages) {
                for (const [channelUrl, messages] of window.__wvThreadData.messages) {
                    if (messages && messages.length > 0) {
                        // Look for patterns that indicate current user
                        const userIds = new Map();
                        messages.forEach(msg => {
                            if (msg.user && msg.user.user_id) {
                                const count = userIds.get(msg.user.user_id) || 0;
                                userIds.set(msg.user.user_id, count + 1);
                            }
                        });

                        // The user with most messages might be current user
                        // This is a heuristic - not always accurate
                        const sortedUsers = Array.from(userIds.entries())
                            .sort((a, b) => b[1] - a[1]);

                        if (sortedUsers.length > 0) {
                            const topUserId = sortedUsers[0][0];
                            const userMessage = messages.find(m => m.user && m.user.user_id === topUserId);
                            if (userMessage && userMessage.user) {
                                this.app?.logger?.log('✅ Inferred user from message frequency');
                                return {
                                    id: userMessage.user.user_id,
                                    name: userMessage.user.nickname,
                                    nickname: userMessage.user.nickname,
                                    profile_url: userMessage.user.profile_url
                                };
                            }
                        }
                    }
                }
            }
        } catch (error) {
            this.app?.logger?.log('Error detecting from API:', error);
        }
        return null;
    }

    /**
     * Detect user from browser storage (localStorage/sessionStorage)
     */
    detectFromBrowserStorage() {
        try {
            // Common keys where user info might be stored
            const storageKeys = [
                'currentUser', 'user', 'profile', 'sendbird_user',
                'wv_user', 'workvivo_user', 'sb_user', 'userProfile'
            ];

            for (const key of storageKeys) {
                // Try localStorage
                let data = localStorage.getItem(key);
                if (data) {
                    try {
                        const parsed = JSON.parse(data);
                        if (parsed && (parsed.user_id || parsed.id)) {
                            this.app?.logger?.log(`✅ Found user in localStorage['${key}']`);
                            return {
                                id: parsed.user_id || parsed.id,
                                name: parsed.nickname || parsed.name || parsed.displayName,
                                nickname: parsed.nickname || parsed.name,
                                profile_url: parsed.profile_url || parsed.profileUrl || parsed.avatar
                            };
                        }
                    } catch (e) {
                        // Not JSON, try as string
                        if (data.length > 0 && data.includes('user_id')) {
                            this.app?.logger?.log(`Found potential user data in localStorage['${key}'] but couldn't parse`);
                        }
                    }
                }

                // Try sessionStorage
                data = sessionStorage.getItem(key);
                if (data) {
                    try {
                        const parsed = JSON.parse(data);
                        if (parsed && (parsed.user_id || parsed.id)) {
                            this.app?.logger?.log(`✅ Found user in sessionStorage['${key}']`);
                            return {
                                id: parsed.user_id || parsed.id,
                                name: parsed.nickname || parsed.name || parsed.displayName,
                                nickname: parsed.nickname || parsed.name,
                                profile_url: parsed.profile_url || parsed.profileUrl || parsed.avatar
                            };
                        }
                    } catch (e) {}
                }
            }
        } catch (error) {
            this.app?.logger?.log('Error detecting from browser storage:', error);
        }
        return null;
    }

    /**
     * Detect user from DOM elements
     */
    detectFromDOM() {
        try {
            // Look for profile elements with user data attributes
            const selectors = [
                '[data-user-id]',
                '[data-profile-id]',
                '[data-sendbird-user]',
                '.user-profile[data-id]',
                '[data-current-user]'
            ];

            for (const selector of selectors) {
                const elements = document.querySelectorAll(selector);
                for (const el of elements) {
                    const userId = el.dataset.userId || el.dataset.profileId ||
                                   el.dataset.sendbirdUser || el.dataset.id || el.dataset.currentUser;
                    const userName = el.dataset.userName || el.dataset.name ||
                                    el.textContent.trim();

                    if (userId && userId.length > 5) { // Basic validation
                        this.app?.logger?.log(`✅ Found user in DOM element: ${selector}`);
                        return {
                            id: userId,
                            name: userName,
                            nickname: userName,
                            profile_url: el.dataset.profileUrl || el.dataset.avatar
                        };
                    }
                }
            }

            // Try to find profile dropdown or user menu
            const profileElements = document.querySelectorAll('[class*="profile"], [class*="user-menu"], [class*="avatar"]');
            for (const el of profileElements) {
                const userId = el.getAttribute('data-user-id') || el.getAttribute('data-id');
                if (userId) {
                    this.app?.logger?.log('✅ Found user in profile element');
                    return {
                        id: userId,
                        name: el.textContent.trim() || 'User',
                        nickname: el.textContent.trim() || 'User'
                    };
                }
            }
        } catch (error) {
            this.app?.logger?.log('Error detecting from DOM:', error);
        }
        return null;
    }

    /**
     * Infer user from message patterns
     */
    async inferFromMessages() {
        try {
            if (window.__wvThreadData && window.__wvThreadData.messages) {
                // Analyze message patterns to identify current user
                const userActivity = new Map();

                for (const [channelUrl, messages] of window.__wvThreadData.messages) {
                    if (messages && messages.length > 0) {
                        messages.forEach(msg => {
                            if (msg.user && msg.user.user_id) {
                                const userId = msg.user.user_id;
                                const activity = userActivity.get(userId) || {
                                    count: 0,
                                    user: msg.user,
                                    hasReadReceipt: false
                                };

                                activity.count++;

                                // Check for indicators that this is current user
                                // (These are heuristics and may need adjustment)
                                if (msg.is_op_msg === true) {
                                    activity.hasReadReceipt = true;
                                }

                                userActivity.set(userId, activity);
                            }
                        });
                    }
                }

                // Find most likely current user based on activity
                let bestMatch = null;
                let highestScore = 0;

                for (const [userId, activity] of userActivity) {
                    let score = activity.count;
                    if (activity.hasReadReceipt) score += 100; // Strong indicator

                    if (score > highestScore) {
                        highestScore = score;
                        bestMatch = activity.user;
                    }
                }

                if (bestMatch) {
                    this.app?.logger?.log('✅ Inferred user from message patterns (confidence: medium)');
                    return {
                        id: bestMatch.user_id,
                        name: bestMatch.nickname,
                        nickname: bestMatch.nickname,
                        profile_url: bestMatch.profile_url
                    };
                }
            }
        } catch (error) {
            this.app?.logger?.log('Error inferring from messages:', error);
        }
        return null;
    }

    /**
     * Try to extract user info from a batch of messages
     */
    tryExtractUserFromMessages(messages) {
        if (!messages || !Array.isArray(messages)) return;

        // Look for messages with strong indicators of being from current user
        for (const msg of messages) {
            if (msg.user && msg.user.user_id) {
                // Check for indicators (this is heuristic-based)
                // In real implementation, we'd need to identify what makes a message "mine"
                // For now, we'll defer to other detection methods
            }
        }
    }

    /**
     * Clear stored user data (for testing/troubleshooting)
     */
    async clearUserData() {
        try {
            await chrome.storage.local.remove(['wv_current_user']);
            this.currentUser = null;
            this.detectionAttempts = 0;
            this.app?.logger?.log('🗑️ Cleared user data from storage');

            window.dispatchEvent(new CustomEvent('wv-user-cleared'));
        } catch (error) {
            this.app?.logger?.log('❌ Error clearing user data:', error);
        }
    }

    /**
     * Get the detection method used for current user
     */
    getDetectionMethod() {
        return this.currentUser?.detected_from || 'Not detected';
    }

    /**
     * Get the timestamp when user was detected
     */
    getDetectionTimestamp() {
        return this.currentUser?.detected_at || null;
    }

    /**
     * Check if user is currently detected
     */
    isUserDetected() {
        return this.currentUser !== null;
    }

    /**
     * Manually set user (for testing or external integration)
     */
    async setUser(userData) {
        await this.saveToStorage({
            ...userData,
            detected_from: 'manual_override'
        });
    }

    /**
     * Parse status from short_bio field
     * Format: "Status text<<timestamp>>" or just "Status text"
     * Returns: { status: string, expiry: number|null }
     */
    parseStatus(shortBio) {
        try {
            // Handle null/undefined/empty
            if (!shortBio || typeof shortBio !== 'string') {
                return { status: null, expiry: null };
            }

            // Check if expiry delimiter exists
            const match = shortBio.match(/^(.+?)<<(\d+)>>$/);

            if (match) {
                const status = match[1].trim();
                const timestamp = parseInt(match[2], 10);

                // Validate timestamp (reasonable range check)
                const expiry = (timestamp > 0 && timestamp < 9999999999) ? timestamp : null;

                return { status, expiry };
            }

            // No expiry found, entire string is status
            return { status: shortBio.trim(), expiry: null };

        } catch (error) {
            this.app?.logger?.log('❌ Error parsing status:', error);
            return { status: null, expiry: null };
        }
    }

    /**
     * Format status for storage in short_bio
     * @param {string} status - Status text
     * @param {number|null} expiry - Unix timestamp or null
     * @returns {string} Formatted status string
     */
    formatStatusForStorage(status, expiry) {
        if (!status) return '';
        if (expiry) {
            return `${status}<<${expiry}>>`;
        }
        return status;
    }

    /**
     * Fetch and cache current user's full profile from API
     * @returns {Promise<object>} Full profile data
     */
    async fetchCurrentUserProfile(forceRefresh = false) {
        try {
            console.log('🔍 [WV STATUS] fetchCurrentUserProfile called', forceRefresh ? '(force refresh)' : '(check cache)');
            console.log('🔍 [WV STATUS] this.app:', !!this.app);
            console.log('🔍 [WV STATUS] this.app.apiManager:', !!this.app?.apiManager);

            const user = await this.getCurrentUser();
            console.log('👤 [WV STATUS] Current user:', user);

            if (!user || !user.id) {
                console.error('❌ [WV STATUS] Current user not detected');
                throw new Error('Current user not detected');
            }

            // Check if profile is already cached and return it unless forceRefresh is true
            if (!forceRefresh && this.currentUser.fullProfile) {
                console.log('💾 [WV STATUS] Returning cached profile data');
                return this.currentUser.fullProfile;
            }

            // Check if there's already a fetch in progress - return the same promise to avoid duplicate requests
            if (!forceRefresh && this._profileFetchPromise) {
                console.log('⏳ [WV STATUS] Profile fetch already in progress, returning existing promise');
                return this._profileFetchPromise;
            }

            console.log('📥 [WV STATUS] Fetching full profile for user ID:', user.id);
            console.log('📥 [WV STATUS] apiManager exists:', !!this.app?.apiManager);
            console.log('📥 [WV STATUS] fetchUserProfile method:', typeof this.app?.apiManager?.fetchUserProfile);

            this.app?.logger?.log('📥 Fetching full profile for current user:', user.id);

            if (!this.app?.apiManager) {
                console.error('❌ [WV STATUS] apiManager is NOT available!');
                throw new Error('APIManager not initialized');
            }

            // Store the fetch promise to prevent duplicate requests
            this._profileFetchPromise = (async () => {
                try {
                    const profileData = await this.app.apiManager.fetchUserProfile(user.id);
                    console.log('✅ [WV STATUS] Profile data fetched:', profileData);

                    // Cache the profile data
                    if (profileData) {
                        this.currentUser.fullProfile = profileData;
                        await this.saveToStorage(this.currentUser);
                        console.log('💾 [WV STATUS] Profile cached successfully');
                    }

                    return profileData;
                } finally {
                    // Clear the in-flight promise once complete
                    this._profileFetchPromise = null;
                }
            })();

            return this._profileFetchPromise;
        } catch (error) {
            console.error('❌ [WV STATUS] Error fetching profile:', error);
            console.error('❌ [WV STATUS] Error details:', error.message, error.stack);
            this.app?.logger?.log('❌ Error fetching current user profile:', error);
            throw error;
        }
    }

    /**
     * Get user status from profile data
     * Response structure from /api/people/{id}: { profile: { short_bio: "..." } }
     * @param {object} profileData - Profile data from /api/people endpoint
     * @returns {object} { status: string, expiry: number|null }
     */
    getUserStatus(profileData) {
        if (!profileData) return { status: null, expiry: null };

        // Check profile.short_bio (from /api/people/{id} endpoint)
        if (profileData.profile && profileData.profile.short_bio) {
            return this.parseStatus(profileData.profile.short_bio);
        }

        // Fallback: check top-level short_bio
        if (profileData.short_bio) {
            return this.parseStatus(profileData.short_bio);
        }

        return { status: null, expiry: null };
    }

    /**
     * Format status display with expiry time
     * @param {object} statusData - { status, expiry }
     * @returns {string|null} Formatted display string or null if no status
     */
    formatStatusDisplay(statusData) {
        if (!statusData || !statusData.status) {
            return null; // No status set, don't show anything
        }

        const { status, expiry } = statusData;

        if (!expiry) {
            return status;
        }

        // Check if expired
        const now = Math.floor(Date.now() / 1000);
        if (now >= expiry) {
            return null; // Expired, don't show anything
        }

        // Format expiry display
        const expiryDate = new Date(expiry * 1000);
        const nowDate = new Date();

        // Check if same day
        const isSameDay = expiryDate.toDateString() === nowDate.toDateString();

        if (isSameDay) {
            // Show time: "until 02:00 PM"
            const timeStr = expiryDate.toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: true
            });
            return `${status} until ${timeStr}`;
        } else {
            // Show date: "until Nov 03"
            const dateStr = expiryDate.toLocaleDateString('en-US', {
                month: 'short',
                day: '2-digit'
            });
            return `${status} until ${dateStr}`;
        }
    }

    /**
     * Update user status via API
     * @param {string} status - Status text
     * @param {number|null} expiry - Unix timestamp or null
     */
    async updateUserStatus(status, expiry) {
        try {
            this.app?.logger?.log('💾 Updating user status:', { status, expiry });

            // Get current user
            const user = await this.getCurrentUser();
            if (!user || !user.id) {
                throw new Error('User not detected');
            }

            // Format status for storage
            const shortBio = this.formatStatusForStorage(status, expiry);

            // Update via API
            const success = await this.app.apiManager?.updateProfileInfo(user.id, {
                short_bio: shortBio
            });

            if (success) {
                this.app?.logger?.log('✅ Status updated successfully');

                // Update cached full profile data
                if (!this.currentUser.fullProfile) {
                    this.currentUser.fullProfile = { profile: {} };
                }
                if (!this.currentUser.fullProfile.profile) {
                    this.currentUser.fullProfile.profile = {};
                }
                this.currentUser.fullProfile.profile.short_bio = shortBio;

                // Save to storage
                await this.saveToStorage(this.currentUser);

                // Dispatch event
                window.dispatchEvent(new CustomEvent('wv-status-updated', {
                    detail: { status, expiry }
                }));

                return true;
            } else {
                throw new Error('API update failed');
            }
        } catch (error) {
            this.app?.logger?.log('❌ Error updating status:', error);
            throw error;
        }
    }

    /**
     * Clear user status
     */
    async clearUserStatus() {
        return await this.updateUserStatus('', null);
    }

    /**
     * Check if status is expired and clear it
     */
    async checkAndClearExpiredStatus() {
        try {
            // Fetch the full profile from API to get current status
            const profileData = await this.fetchCurrentUserProfile();
            if (!profileData) return;

            const statusData = this.getUserStatus(profileData);
            if (!statusData || !statusData.expiry) return;

            const now = Math.floor(Date.now() / 1000);
            if (now >= statusData.expiry) {
                this.app?.logger?.log('⏰ Status expired, clearing...');
                await this.clearUserStatus();
            }
        } catch (error) {
            this.app?.logger?.log('❌ Error checking expired status:', error);
        }
    }
};

// Export to global namespace
if (typeof window !== 'undefined') {
    window.WVFavs = window.WVFavs || {};
    window.WVFavs.UserIdentityManager = WVFavs.UserIdentityManager;
}
