/**
 * StatusManager - Manages fetching and displaying status for other users
 * Listens to chat navigation events and updates recipient status in chat header
 */

var WVFavs = WVFavs || {};

WVFavs.StatusManager = class StatusManager {
    constructor(app) {
        this.app = app;
        this.logger = app.logger;
        this.currentRecipientId = null;
        this.statusCache = new Map(); // userId -> { status, fetchedAt, expiresAt }
        this.cacheTTL = 5 * 60 * 1000; // 5 minutes
        this.debounceTimer = null;
        this.debounceDelay = 150; // Match ThreadManager's debounce
        this.lastProcessedChannel = null; // Track last processed channel
        this.lastProcessedTime = 0; // Timestamp of last processing
        this.dedupeWindow = 1000; // 1 second deduplication window

        console.log('📊 [WV-StatusManager] Constructor called');
    }

    /**
     * Initialize the status manager - set up event listeners
     */
    async init() {
        console.log('🚀 [WV-StatusManager] init() called, setting up listeners...');
        this.setupEventListeners();
        console.log('✅ [WV-StatusManager] init() completed');
    }

    /**
     * Set up event listeners for chat navigation
     */
    setupEventListeners() {
        console.log('🔧 [WV-StatusManager] Setting up event listeners');

        // Listen for channel changes (matches ThreadManager/DraftManager pattern)
        window.addEventListener('wv-channel-changed', (event) => {
            const { currentChannel, source } = event.detail;
            console.log(`🎯 [WV-StatusManager] Received channel change event: ${currentChannel} (${source})`);
            this.handleChannelChange(event.detail);
        });

        console.log('📡 [WV-StatusManager] Event listeners set up');
    }

    /**
     * Handle channel change event with debouncing
     * @param {Object} detail - Event detail with currentChannel, previousChannel, source
     */
    handleChannelChange(detail) {
        const { currentChannel, source } = detail;

        console.log(`🔄 [WV-StatusManager] handleChannelChange called: ${currentChannel.substring(0,50)} (source: ${source})`);

        // Debounce rapid channel switches (A→B→C navigation)
        if (this.debounceTimer) {
            console.log('⏱️ [WV-StatusManager] Clearing previous debounce timer');
            clearTimeout(this.debounceTimer);
        }

        this.debounceTimer = setTimeout(async () => {
            console.log(`⏱️ [WV-StatusManager] Debounce complete, processing channel: ${currentChannel.substring(0,50)}`);
            await this.processChannelChange(currentChannel);
        }, this.debounceDelay);
    }

    /**
     * Process channel change after debouncing
     * @param {string} channelUrl - Current channel URL
     */
    async processChannelChange(channelUrl) {
        try {
            console.log(`🔍 [WV-StatusManager] Processing channel: ${channelUrl}`);

            if (!channelUrl) {
                console.log('⚠️ [WV-StatusManager] No channel URL provided');
                this.clearRecipientStatus();
                return;
            }

            // Deduplication: Skip if same channel processed recently
            const now = Date.now();
            if (this.lastProcessedChannel === channelUrl &&
                (now - this.lastProcessedTime) < this.dedupeWindow) {
                console.log('⏭️ [WV-StatusManager] Skipping duplicate channel processing (within 1s window)');
                return;
            }

            // Update last processed tracking
            this.lastProcessedChannel = channelUrl;
            this.lastProcessedTime = now;

            // CRITICAL: Fetch and verify channel data from API for authoritative information
            // This ensures we have correct userId, channel_url, and other metadata
            if (this.app?.smartUserDB?.fetchAndVerifyChannelData) {
                // Don't await - let it run in background to not block status display
                this.app.smartUserDB.fetchAndVerifyChannelData(channelUrl).catch(error => {
                    console.warn('⚠️ [WV-StatusManager] Background verification failed:', error);
                });
            }

            // Get chat info from SmartUserDatabase
            const chat = await this.getChatFromDatabase(channelUrl);

            if (!chat) {
                console.log('⚠️ [WV-StatusManager] Chat not found in database');
                this.clearRecipientStatus();
                return;
            }

            console.log(`📊 [WV-StatusManager] Chat from database:`, {
                name: chat.name,
                is_distinct: chat.is_distinct,
                member_count: chat.member_count,
                type: chat.type
            });

            // Check if this is a Direct Message
            if (this.isDMChat(chat)) {
                console.log(`👤 [WV-StatusManager] DM detected: ${chat.name}`);

                // Display recipient status (handles ID extraction and validation)
                await this.displayRecipientStatus(chat);
            } else {
                // Group chat or channel - hide status
                console.log('👥 [WV-StatusManager] Group chat detected, clearing status');
                this.clearRecipientStatus();
            }
        } catch (error) {
            console.error('❌ [WV-StatusManager] Error processing channel change:', error);
            this.clearRecipientStatus();
        }
    }

    /**
     * Get chat from SmartUserDatabase
     * @param {string} channelUrl - Channel URL
     * @returns {Promise<Object|null>} Chat record or null
     */
    async getChatFromDatabase(channelUrl) {
        try {
            if (!this.app.smartUserDB?.getChatByChannelUrl) {
                console.log('⚠️ [WV-StatusManager] SmartUserDB not available');
                return null;
            }

            // Always query by channel_url field (not by id)
            const chat = await this.app.smartUserDB.getChatByChannelUrl(channelUrl);

            if (chat) {
                console.log(`✅ [WV-StatusManager] Found chat in database: ${chat.name}`);
                return chat;
            }

            console.log(`⚠️ [WV-StatusManager] Chat not found in database for: ${channelUrl.substring(0, 50)}...`);
            return null;
        } catch (error) {
            console.error('❌ [WV-StatusManager] Error querying database:', error);
            return null;
        }
    }

    /**
     * Check if chat is a Direct Message
     * @param {Object} chat - Chat record from database
     * @returns {boolean} True if DM
     */
    isDMChat(chat) {
        // Use type field which is set during database verification
        // type === 'user' means it's a one-on-one DM
        // type === 'group', 'channel', or anything else means group chat
        return chat.type === 'user';
    }

    /**
     * Get all possible user ID candidates from chat record
     * @param {Object} chat - Chat record from database
     * @returns {Array<Object>} Array of {source, value} candidates to try
     */
    getRecipientUserIdCandidates(chat) {
        const candidates = [];

        // Priority 1: id field (if numeric)
        if (chat.id && /^\d+$/.test(String(chat.id))) {
            candidates.push({ source: 'id', value: String(chat.id) });
        }

        // Priority 2: userId field (if numeric)
        if (chat.userId && /^\d+$/.test(String(chat.userId))) {
            candidates.push({ source: 'userId', value: String(chat.userId) });
        }

        // Priority 3: user_id field (if numeric)
        if (chat.user_id && /^\d+$/.test(String(chat.user_id))) {
            candidates.push({ source: 'user_id', value: String(chat.user_id) });
        }

        console.log(`🔍 [WV-StatusManager] Found ${candidates.length} user ID candidates:`, candidates.map(c => c.source).join(', '));
        return candidates;
    }

    /**
     * Update chat avatar in database
     * @param {Object} chat - Chat record
     * @param {string} avatarUrl - Avatar URL from profile
     */
    async updateChatAvatar(chat, avatarUrl) {
        try {
            if (!this.app.smartUserDB?.updateChat) {
                console.log('⚠️ [WV-StatusManager] Cannot update avatar: updateChat not available');
                return;
            }

            // Update the chat record with new avatar_url
            const updatedChat = {
                ...chat,
                avatar_url: avatarUrl,
                lastUpdated: Date.now()
            };

            await this.app.smartUserDB.updateChat(updatedChat);
            console.log(`🖼️ [WV-StatusManager] Updated avatar_url in database`);
        } catch (error) {
            console.error('❌ [WV-StatusManager] Error updating avatar:', error);
            // Don't fail the whole operation if avatar update fails
        }
    }

    /**
     * Display status for a recipient user
     * @param {Object} chat - Chat record from database
     */
    async displayRecipientStatus(chat) {
        try {
            console.log(`📥 [WV-StatusManager] Fetching status for chat: ${chat.name}`);

            // Get all possible user ID candidates
            const candidates = this.getRecipientUserIdCandidates(chat);

            if (candidates.length === 0) {
                console.log('⚠️ [WV-StatusManager] No user ID candidates found in chat record');
                return;
            }

            // Try each candidate until one succeeds
            for (const {source, value} of candidates) {
                console.log(`🔍 [WV-StatusManager] Trying ${source}: ${value}`);

                try {
                    // Check cache first
                    const cached = this.getFromCache(value);
                    if (cached) {
                        console.log(`💾 [WV-StatusManager] Using cached status for ${source}`);
                        this.currentRecipientId = value;
                        await WVFavs.DomManager?.displayRecipientStatusInHeader(cached, chat.name);
                        return; // Success!
                    }

                    // Fetch user profile
                    const profileData = await this.app.apiManager?.fetchUserProfile(value);

                    if (profileData) {
                        console.log(`✅ [WV-StatusManager] Success with ${source}: ${value}`);

                        // Extract status from profile
                        const statusData = this.app.userIdentity?.getUserStatus(profileData);
                        console.log('📊 [WV-StatusManager] Status data:', statusData);

                        // Update database with fresh avatar_url
                        if (profileData.avatar_url) {
                            await this.updateChatAvatar(chat, profileData.avatar_url);
                        }

                        // Cache the status
                        this.currentRecipientId = value;
                        this.addToCache(value, statusData);

                        // Display in chat header
                        await WVFavs.DomManager?.displayRecipientStatusInHeader(statusData, chat.name);

                        console.log('✅ [WV-StatusManager] Recipient status displayed');
                        return; // Mission accomplished!
                    } else {
                        console.log(`⚠️ [WV-StatusManager] ${source} returned no profile data, trying next...`);
                    }
                } catch (error) {
                    console.log(`⚠️ [WV-StatusManager] ${source} failed: ${error.message}, trying next...`);
                }
            }

            // All attempts failed
            console.log('❌ [WV-StatusManager] All user ID candidates failed, data may be corrupted');
        } catch (error) {
            console.error('❌ [WV-StatusManager] Error displaying recipient status:', error);
            // Fail gracefully - don't show broken UI
        }
    }

    /**
     * Clear recipient status from display
     */
    clearRecipientStatus() {
        this.currentRecipientId = null;
        WVFavs.DomManager?.clearRecipientStatusFromHeader();
        console.log('🗑️ [WV-StatusManager] Recipient status cleared');
    }

    /**
     * Get status from cache
     * @param {string} userId - User ID
     * @returns {Object|null} Status data or null if expired/missing
     */
    getFromCache(userId) {
        const cached = this.statusCache.get(userId);

        if (!cached) {
            return null;
        }

        const now = Date.now();

        // Check if cache expired
        if (cached.expiresAt && cached.expiresAt < now) {
            console.log('⏰ [WV-StatusManager] Cache expired for user:', userId);
            this.statusCache.delete(userId);
            return null;
        }

        // Check if TTL expired
        if (now - cached.fetchedAt > this.cacheTTL) {
            console.log('⏰ [WV-StatusManager] Cache TTL expired for user:', userId);
            this.statusCache.delete(userId);
            return null;
        }

        return cached.status;
    }

    /**
     * Add status to cache
     * @param {string} userId - User ID
     * @param {Object} statusData - Status data
     */
    addToCache(userId, statusData) {
        const now = Date.now();

        this.statusCache.set(userId, {
            status: statusData,
            fetchedAt: now,
            expiresAt: statusData?.expiry ? statusData.expiry * 1000 : null // Convert to ms
        });

        console.log(`💾 [WV-StatusManager] Cached status for user: ${userId}`);
    }

    /**
     * Clear all cached statuses
     */
    clearCache() {
        this.statusCache.clear();
        console.log('🗑️ [WV-StatusManager] Status cache cleared');
    }

    /**
     * Refresh current recipient status (force refetch)
     */
    async refreshCurrentRecipient() {
        if (this.currentRecipientId) {
            console.log('🔄 [WV-StatusManager] Refreshing current recipient status');

            // Remove from cache to force refetch
            this.statusCache.delete(this.currentRecipientId);

            // Re-trigger channel change processing
            const currentChannel = this.app.threadManager?.getCurrentChannel();
            if (currentChannel) {
                await this.processChannelChange(currentChannel);
            }
        }
    }
};
