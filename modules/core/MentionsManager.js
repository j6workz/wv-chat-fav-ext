/**
 * MentionsManager - Handles fetching and managing @mentions
 * Integrates with Sendbird Message Search API
 */

var WVFavs = WVFavs || {};

WVFavs.MentionsManager = class MentionsManager {
    constructor(app) {
        this.app = app;
        this.mentions = [];
        this.nextCursor = null;
        this.hasMore = false;
        this.isLoading = false;
        this.lastFetchTime = null;
        this.currentUserId = null;
        this.mightHaveMoreMentions = true; // Track if we should refetch on Load More
        this.lastSearchMode = null; // Track whether last search was for all channels or single channel
    }

    /**
     * Initialize the manager
     */
    async init() {
        this.app?.logger?.log('📧 MentionsManager: Initializing...');

        // Get current user
        if (this.app.userIdentity) {
            const user = await this.app.userIdentity.getCurrentUser();
            if (user) {
                this.currentUserId = user.id;
                this.app?.logger?.log('📧 Current user ID for mentions:', this.currentUserId);
            }
        }

        // Listen for user identification events
        window.addEventListener('wv-user-saved', (event) => {
            this.currentUserId = event.detail.id;
            this.app?.logger?.log('📧 User updated, new ID:', this.currentUserId);
        });
    }

    /**
     * Search for mentions of the current user
     * @param {boolean} reset - If true, reset and fetch from beginning
     * @param {boolean} allChannels - If true, search across all channels (ignore current channel)
     * @returns {Promise<Array>} Array of mention objects
     */
    async searchMentions(reset = false, allChannels = false) {
        // DEBUG: Log stack trace to see where this is called from
        console.log('📧 === searchMentions CALLED ===');
        console.log('📧 Reset:', reset, '| All Channels:', allChannels);
        console.log('📧 Call stack:', new Error().stack);

        // IMPORTANT: Check isLoading BEFORE reset to avoid clearing data
        // while another search is in progress
        if (this.isLoading) {
            this.app?.logger?.log('📧 Already loading mentions, skipping...');
            console.log('📧 SKIPPED - Already loading, returning existing', this.mentions.length, 'mentions');
            return this.mentions;
        }

        if (reset) {
            this.mentions = [];
            this.nextCursor = null;
            this.hasMore = true;
        }

        // Get current user info (ID and name)
        let user = null;
        if (this.app.userIdentity) {
            user = await this.app.userIdentity.getCurrentUser();
            if (user) {
                this.currentUserId = user.id;
            }
        }

        if (!this.currentUserId) {
            this.app?.logger?.log('⚠️ Cannot search mentions: User ID not available');
            return [];
        }

        // Get current channel URL from ThreadManager (if available)
        // BUT: Skip if allChannels=true (for global mentions panel)
        let channelUrl = null;
        if (!allChannels && this.app.threadManager) {
            channelUrl = this.app.threadManager.getCurrentChannel();
        }

        this.app?.logger?.log('📧 Searching mentions for user:', {
            id: this.currentUserId,
            name: user?.name || user?.nickname,
            channel: channelUrl || 'all channels',
            allChannels
        });

        try {
            this.isLoading = true;
            console.log('📧 isLoading SET TO TRUE');

            // Track the search mode (allChannels or single channel)
            this.lastSearchMode = allChannels;

            let results;
            const previousCursor = this.nextCursor;

            // Always use Sendbird API now that we've fixed the user_id parameter
            // This properly scopes the search to channels where the user is a member (up to 100 channels)
            console.log('📧 Using Sendbird API with user_id parameter');
            results = await this.fetchMentionsPage(this.currentUserId, user?.name || user?.nickname, this.nextCursor, channelUrl);

            // NOTE: WorkVivo API alternative is available but has authentication issues from content script context
            // If Sendbird API doesn't return enough results, we can fallback to WorkVivo API via page context

            if (results) {
                // Log API response details for debugging
                console.log(`📧 API returned ${results.mentions.length} mentions, has_next: ${results.has_next}, total_count: ${results.total_count || 'N/A'}`);

                if (results.mentions.length === 0) {
                    console.log('📧 ⚠️  Zero mentions returned from API');
                    console.log('📧 Possible reasons:');
                    console.log('  1. No mentions exist for this user');
                    console.log('  2. User ID incorrect:', this.currentUserId);
                    console.log('  3. Sendbird app ID incorrect');
                    console.log('  4. API authentication failed');
                    console.log('  5. Channel filter too restrictive:', channelUrl || 'NONE');

                    this.app?.logger?.log('⚠️  Empty mentions result', {
                        userId: this.currentUserId,
                        userName: user?.name,
                        channelUrl: channelUrl,
                        allChannels: allChannels
                    });
                }

                if (reset) {
                    // Reset: replace all mentions
                    this.mentions = results.mentions;
                } else {
                    // Append: only add NEW mentions that aren't already in the list (avoid duplicates)
                    const existingIds = new Set(this.mentions.map(m => m.message_id));
                    const newMentions = results.mentions.filter(m => !existingIds.has(m.message_id));

                    console.log(`📧 Fetched ${results.mentions.length} mentions, ${newMentions.length} are new, ${results.mentions.length - newMentions.length} duplicates filtered`);

                    this.mentions = [...this.mentions, ...newMentions];

                    // If we got 0 new mentions, we've hit the API limit (same results returned)
                    if (newMentions.length === 0) {
                        console.log('📧 No new mentions received - reached API limit');
                        this.hasMore = false; // Override API's has_next
                        this.mightHaveMoreMentions = false;
                        this.nextCursor = null;
                        this.lastFetchTime = Date.now();
                        this.app?.logger?.log('📧 Reached mention limit (no new results from API)');
                        return this.mentions;
                    }
                }

                // Check if cursor changed - if same cursor returned, we've hit the limit
                const cursorChanged = previousCursor !== results.next;
                if (!cursorChanged && !reset && previousCursor !== null) {
                    console.log('📧 Cursor unchanged - API returning same results (limit reached)');
                    this.hasMore = false;
                    this.mightHaveMoreMentions = false;
                    this.nextCursor = null;
                } else {
                    this.nextCursor = results.next;
                    this.hasMore = results.has_next;

                    // WorkVivo API returns all results at once, so hasMore will be false
                    // Sendbird API: track if we might have more mentions (hit the limit of 50)
                    // If we got exactly 50 results, there might be more mentions
                    // If we got less than 50, we've fetched all available mentions
                    this.mightHaveMoreMentions = results.mentions.length === 50 && results.has_next;
                }

                this.lastFetchTime = Date.now();

                this.app?.logger?.log(`📧 Fetched ${results.mentions.length} mentions. Total: ${this.mentions.length}`);
                this.app?.logger?.log(`📧 Has more: ${this.hasMore}, Might have more: ${this.mightHaveMoreMentions}`);
            }

            return this.mentions;
        } catch (error) {
            this.app?.logger?.log('❌ Error searching mentions:', error);
            console.log('📧 ❌ ERROR in searchMentions:', error.message);
            return this.mentions;
        } finally {
            this.isLoading = false;
            console.log('📧 isLoading SET TO FALSE (finally block)');
        }
    }

    /**
     * Fetch mentions from WorkVivo's backend API
     * This bypasses Sendbird's 20-result limit!
     * Uses page context to access session cookies for authentication
     * @param {string} userId - User ID to search mentions for
     * @returns {Promise<Object>} Results object with mentions
     */
    async fetchMentionsFromWorkVivo(userId) {
        try {
            const url = `https://allstars.workvivo.com/api/chat/search/messages?queryTerm=person:${userId}`;

            console.log('🔍 === USING WORKVIVO API ===');
            console.log('🔍 URL:', url);

            // Use page context API to make authenticated request (has access to session cookies)
            const requestId = `workvivo-mentions-${Date.now()}`;

            const data = await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    document.removeEventListener('wv-fav-api-response', handleResponse);
                    reject(new Error('WorkVivo API request timeout'));
                }, 30000); // 30 second timeout

                const handleResponse = (event) => {
                    if (event.detail.requestId === requestId) {
                        clearTimeout(timeout);
                        document.removeEventListener('wv-fav-api-response', handleResponse);

                        if (event.detail.success) {
                            resolve(event.detail.data);
                        } else {
                            reject(new Error(event.detail.error || 'WorkVivo API request failed'));
                        }
                    }
                };

                document.addEventListener('wv-fav-api-response', handleResponse);

                // Send request to page context
                document.dispatchEvent(new CustomEvent('wv-fav-api-request', {
                    detail: {
                        requestId,
                        action: 'workvivoMentionsSearchAPI',
                        data: { url }
                    }
                }));
            });

            console.log('🔍 === WORKVIVO API RESPONSE ===');
            console.log('🔍 Response keys:', Object.keys(data));
            console.log('🔍 Total results:', data.data?.length || data.results?.length || 0);
            console.log('🔍 Full response:', data);

            // Transform WorkVivo response to our format (await to fetch channel names from IndexedDB)
            return await this.parseWorkVivoResponse(data);

        } catch (error) {
            console.error('❌ WorkVivo API error:', error);
            this.app?.logger?.log('❌ WorkVivo API error:', error);
            return null;
        }
    }

    /**
     * Parse WorkVivo API response into our mention format
     * @param {Object} data - WorkVivo API response
     * @returns {Promise<Object>} Parsed mentions with pagination info
     */
    async parseWorkVivoResponse(data) {
        const mentions = [];
        const results = data.data || data.results || [];

        console.log('🔍 Parsing', results.length, 'results from WorkVivo API');

        // Parse mentions asynchronously to fetch channel names from IndexedDB
        for (const item of results) {
            const mention = await this.parseMentionItem(item);
            if (mention) {
                mentions.push(mention);
            }
        }

        return {
            mentions,
            next: null, // WorkVivo returns all results at once
            has_next: false,
            total_count: mentions.length
        };
    }

    /**
     * Fetch a page of mentions from Sendbird API
     * @param {string} userId - User ID to search mentions for
     * @param {string|null} userName - User name for logging/debugging
     * @param {string|null} cursor - Pagination cursor
     * @param {string|null} channelUrl - Optional channel URL to filter mentions
     * @returns {Promise<Object>} Results object with mentions and pagination info
     */
    async fetchMentionsPage(userId, userName = null, cursor = null, channelUrl = null) {
        try {
            // Extract Sendbird app ID from current page
            const sendbirdAppId = this.extractSendbirdAppId();
            if (!sendbirdAppId) {
                throw new Error('Could not extract Sendbird App ID');
            }

            // Build search URL
            const baseUrl = `https://api-${sendbirdAppId}.sendbird.com/v3/search/messages`;

            // Search for messages containing the mention format: @[Name](person:userId)
            // IMPORTANT: Do NOT URL encode the query - Sendbird expects raw format
            const searchQuery = `person:${userId}`;

            // Build URL with required parameters per Sendbird documentation:
            // - Either user_id OR channel_url must be specified
            // - user_id restricts search to channels where the user is a member (up to 100 channels)
            let url = `${baseUrl}?query=${searchQuery}&limit=50`;

            // Add user_id or channel_url (required per Sendbird docs)
            if (channelUrl) {
                // Search within specific channel
                url += `&channel_url=${encodeURIComponent(channelUrl)}`;
            } else {
                // Search across all channels where user is a member
                url += `&user_id=${encodeURIComponent(userId)}`;
            }

            // Add optional parameters
            url += `&sort_field=ts&exact_match=true`;

            // Add pagination cursor if provided
            if (cursor) {
                url += `&token=${encodeURIComponent(cursor)}`;
            }

            this.app?.logger?.log('📧 Fetching mentions from:', url);
            if (userName) {
                this.app?.logger?.log('📧 Searching for mentions of:', userName, `(${userId})`);
            }
            if (channelUrl) {
                this.app?.logger?.log('📧 Filtering by channel:', channelUrl);
            }

            // Use page script to make authenticated API call (same approach as search widget)
            const requestId = `mentions-${Date.now()}-${Math.random()}`;

            // Create promise to wait for response
            const responsePromise = new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Mentions API request timeout'));
                }, 30000); // 30 second timeout

                const handleResponse = (event) => {
                    if (event.detail.requestId === requestId) {
                        clearTimeout(timeout);
                        document.removeEventListener('wv-fav-api-response', handleResponse);

                        if (event.detail.success) {
                            resolve(event.detail.data);
                        } else {
                            reject(new Error(event.detail.error || 'Unknown error'));
                        }
                    }
                };

                document.addEventListener('wv-fav-api-response', handleResponse);
            });

            // Dispatch request to page script
            document.dispatchEvent(new CustomEvent('wv-fav-api-request', {
                detail: {
                    requestId,
                    action: 'mentionsSearchAPI',
                    data: { url, method: 'GET' }
                }
            }));

            const data = await responsePromise;

            // Log full API response for debugging
            console.log('📧 === SENDBIRD API RESPONSE ===');
            console.log('📧 Full response keys:', Object.keys(data));
            console.log('📧 Total count from API:', data.total_count);
            console.log('📧 Results in this page:', data.results?.length);
            console.log('📧 Has next page:', data.has_next);
            console.log('📧 Has prev page:', data.has_prev);
            console.log('📧 Next cursor:', data.next);
            console.log('📧 Start cursor:', data.start_cursor);
            console.log('📧 End cursor:', data.end_cursor);
            console.log('📧 Channel URL filter:', channelUrl || 'NONE (all channels)');

            // Log first result to see channel data structure
            if (data.results && data.results.length > 0) {
                console.log('📧 === FIRST RESULT SAMPLE ===');
                console.log('📧 Channel object:', data.results[0].channel);
                console.log('📧 Channel name:', data.results[0].channel?.name);
                console.log('📧 Channel URL:', data.results[0].channel_url);
            }

            this.app?.logger?.log('📧 === SENDBIRD API RESPONSE ===');
            this.app?.logger?.log('📧 Total count from API:', data.total_count);
            this.app?.logger?.log('📧 Results in this page:', data.results?.length);
            this.app?.logger?.log('📧 Has next page:', data.has_next);
            this.app?.logger?.log('📧 Next cursor:', data.next);

            return await this.parseMentionResults(data);

        } catch (error) {
            this.app?.logger?.log('❌ Error fetching mentions page:', error);
            throw error;
        }
    }

    /**
     * Extract Sendbird App ID from page or previous API calls
     * @returns {string|null} Sendbird App ID
     */
    extractSendbirdAppId() {
        // Method 1: Check if stored from previous API calls
        if (window.__wvSendbirdAppId) {
            return window.__wvSendbirdAppId;
        }

        // Method 2: Extract from any Sendbird API URL in network or scripts
        try {
            // Check performance entries for Sendbird API calls
            const entries = performance.getEntriesByType('resource');
            for (const entry of entries) {
                if (entry.name.includes('sendbird.com/v3/')) {
                    const match = entry.name.match(/api-([^\.]+)\.sendbird\.com/);
                    if (match && match[1]) {
                        window.__wvSendbirdAppId = match[1];
                        this.app?.logger?.log('📧 Extracted Sendbird App ID:', match[1]);
                        return match[1];
                    }
                }
            }

            // Method 3: Check window.__wvThreadData for any stored URLs
            if (window.__wvThreadData) {
                // Extract from stored data if available
                // This is a fallback method
            }
        } catch (error) {
            this.app?.logger?.log('Error extracting Sendbird App ID:', error);
        }

        return null;
    }

    /**
     * Get headers for Sendbird API requests
     * @returns {Object} Headers object
     */
    getSendbirdHeaders() {
        // Use captured headers from interceptor
        if (window.__wvSendbirdHeaders) {
            this.app?.logger?.log('📧 Using captured Sendbird headers:', Object.keys(window.__wvSendbirdHeaders));
            return window.__wvSendbirdHeaders;
        }

        // Fallback to basic headers
        this.app?.logger?.log('⚠️ No Sendbird headers captured, using basic headers');
        return {
            'Content-Type': 'application/json'
        };
    }

    /**
     * Parse mention results from API response
     * @param {Object} data - API response data
     * @returns {Promise<Object>} Parsed results
     */
    async parseMentionResults(data) {
        try {
            this.app?.logger?.log('📧 Raw API response:', {
                total_count: data.total_count,
                results_count: data.results?.length,
                has_next: data.has_next,
                next: data.next
            });

            if (data.results && data.results.length > 0) {
                this.app?.logger?.log('📧 Sample mention data (first result):', {
                    channel_url: data.results[0].channel_url,
                    channel_type: data.results[0].channel_type,
                    channel_name: data.results[0].channel?.name,
                    channel_object: data.results[0].channel,
                    message_id: data.results[0].message_id,
                    parent_message_id: data.results[0].parent_message_id,
                    is_reply: !!data.results[0].parent_message_id
                });
            }

            const mentions = [];

            if (data.results && Array.isArray(data.results)) {
                for (const result of data.results) {
                    const mention = await this.parseMentionItem(result);
                    if (mention) {
                        mentions.push(mention);
                    }

                    // Try to extract current user's name from mentioned_users array
                    if (this.currentUserId && result.mentioned_users) {
                        const currentUserMention = result.mentioned_users.find(
                            u => u.user_id === this.currentUserId
                        );

                        if (currentUserMention && currentUserMention.nickname) {
                            // Update user identity with the name if we don't have it
                            if (this.app.userIdentity) {
                                const currentUser = await this.app.userIdentity.getCurrentUser();
                                if (currentUser && (!currentUser.name || currentUser.name === 'Unknown User')) {
                                    this.app?.logger?.log('📧 Found current user name in mentions:', currentUserMention.nickname);
                                    await this.app.userIdentity.saveToStorage({
                                        ...currentUser,
                                        name: currentUserMention.nickname,
                                        nickname: currentUserMention.nickname,
                                        profile_url: currentUserMention.profile_url,
                                        detected_from: 'mentions_search_result'
                                    });
                                }
                            }
                        }
                    }
                }
            }

            return {
                mentions,
                next: data.next || null,
                has_next: data.has_next || false,
                total_count: data.total_count || mentions.length
            };
        } catch (error) {
            this.app?.logger?.log('❌ Error parsing mention results:', error);
            return {
                mentions: [],
                next: null,
                has_next: false,
                total_count: 0
            };
        }
    }

    /**
     * Parse a single mention item
     * @param {Object} item - Mention item from API
     * @returns {Promise<Object|null>} Parsed mention object with enhanced channel info
     */
    async parseMentionItem(item) {
        try {
            // Only get channel name from API response (fast)
            // Channel names will be fetched progressively later in the UI
            let channelName = item.channel?.name || null;

            return {
                // Message info
                message_id: item.message_id,
                message: item.message,
                message_type: item.type,
                created_at: item.created_at,

                // Sender info
                sender: {
                    id: item.user?.user_id,
                    name: item.user?.nickname,
                    profile_url: item.user?.profile_url
                },

                // Channel info
                channel_url: item.channel_url,
                channel_type: item.channel_type,
                channel_name: channelName,

                // Thread info (if it's a reply)
                // Check both parent_message_id and thread_info
                is_reply: !!item.parent_message_id || !!item.thread_info?.parent_message_id,
                parent_message_id: item.parent_message_id || item.thread_info?.parent_message_id || null,
                parent_message_text: item.parent_message_text || item.thread_info?.parent_message?.message || null,

                // Mention info
                mentioned_users: item.mentioned_users || [],
                mention_type: item.mention_type,

                // Full channel object for navigation
                channel: item.channel || null,

                // Metadata
                custom_type: item.custom_type,
                data: item.data,

                // For UI
                is_highlighted: false
            };
        } catch (error) {
            this.app?.logger?.log('❌ Error parsing mention item:', error);
            return null;
        }
    }

    /**
     * Fetch channel info using centralized API manager
     * Delegates to APIManager.getChannelInfo which handles multi-level caching
     * @param {string} channelUrl - Sendbird channel URL
     * @returns {Promise<Object|null>} Channel info or null
     */
    async fetchChannelInfoFromSendbird(channelUrl) {
        // Delegate to centralized APIManager which handles:
        // - Memory cache (CacheManager)
        // - IndexedDB persistence (UnifiedDatabase)
        // - Sendbird API calls
        return await WVFavs.APIManager.getChannelInfo(channelUrl);
    }

    /**
     * Parse channel name from channel URL (fallback only)
     * Format: sendbird_group_channel_{id}_{hash} -> "Channel {id}"
     * @param {string} channelUrl - Sendbird channel URL
     * @returns {string} Parsed channel name or "Channel"
     */
    parseChannelNameFromUrl(channelUrl) {
        if (!channelUrl) return 'Channel';

        try {
            // Extract the numeric ID from the channel URL
            // Format: sendbird_group_channel_642529723_985e24ede1b298179012461675e0b3d5cf832025
            const match = channelUrl.match(/sendbird_group_channel_(\d+)_/);
            if (match && match[1]) {
                return `Channel ${match[1]}`;
            }
        } catch (error) {
            // Fallback
        }

        return 'Channel';
    }

    /**
     * Load more mentions (pagination)
     * @returns {Promise<Array>} Updated mentions array
     */
    async loadMore() {
        console.log('📧 === loadMore CALLED ===');
        console.log('📧 Has more:', this.hasMore, '| Is loading:', this.isLoading);
        console.log('📧 Call stack:', new Error().stack);

        if (!this.hasMore || this.isLoading) {
            this.app?.logger?.log('📧 No more mentions to load or already loading');
            console.log('📧 SKIPPED - No more or already loading');
            return this.mentions;
        }

        // Use the same search mode as the last search (allChannels or single channel)
        const allChannels = this.lastSearchMode || false;
        this.app?.logger?.log('📧 Loading more mentions with mode:', allChannels ? 'all channels' : 'current channel');
        console.log('📧 Loading more with allChannels:', allChannels);

        return await this.searchMentions(false, allChannels);
    }

    /**
     * Refresh mentions (fetch from beginning)
     * @returns {Promise<Array>} Fresh mentions array
     */
    async refresh() {
        this.app?.logger?.log('📧 Refreshing mentions...');
        return await this.searchMentions(true);
    }

    /**
     * Get unread mentions count
     * @returns {number} Count of unread mentions
     */
    getUnreadCount() {
        return this.mentions.filter(m => !m.is_read).length;
    }

    /**
     * Mark a mention as read
     * @param {string} messageId - Message ID to mark as read
     */
    markAsRead(messageId) {
        const mention = this.mentions.find(m => m.message_id === messageId);
        if (mention) {
            mention.is_read = true;
            // TODO: Persist read status to storage
            this.app?.logger?.log('📧 Marked mention as read:', messageId);
        }
    }

    /**
     * Get mentions categorized by read status
     * @returns {Object} Object with unread and read arrays
     */
    categorizeMentions() {
        return {
            unread: this.mentions.filter(m => !m.is_read),
            read: this.mentions.filter(m => m.is_read)
        };
    }

    /**
     * Get mentions grouped by date
     * @returns {Object} Object with date keys and mention arrays
     */
    groupByDate() {
        const grouped = {};
        const now = Date.now();
        const oneDayMs = 24 * 60 * 60 * 1000;

        for (const mention of this.mentions) {
            const timestamp = mention.created_at;
            const age = now - timestamp;

            let key;
            if (age < oneDayMs) {
                key = 'Today';
            } else if (age < 2 * oneDayMs) {
                key = 'Yesterday';
            } else if (age < 7 * oneDayMs) {
                key = 'This Week';
            } else if (age < 30 * oneDayMs) {
                key = 'This Month';
            } else {
                key = 'Older';
            }

            if (!grouped[key]) {
                grouped[key] = [];
            }
            grouped[key].push(mention);
        }

        return grouped;
    }

    /**
     * Search mentions by text query
     * @param {string} query - Search query
     * @returns {Array} Filtered mentions
     */
    searchByText(query) {
        if (!query) return this.mentions;

        const lowerQuery = query.toLowerCase();
        return this.mentions.filter(m =>
            m.message.toLowerCase().includes(lowerQuery) ||
            m.sender.name.toLowerCase().includes(lowerQuery) ||
            m.channel_name.toLowerCase().includes(lowerQuery)
        );
    }

    /**
     * Clear all mentions
     */
    clear() {
        this.mentions = [];
        this.nextCursor = null;
        this.hasMore = false;
        this.lastFetchTime = null;
        this.app?.logger?.log('📧 Cleared all mentions');
    }

    /**
     * Get statistics about mentions
     * @returns {Object} Statistics object
     */
    getStats() {
        return {
            total: this.mentions.length,
            unread: this.getUnreadCount(),
            read: this.mentions.length - this.getUnreadCount(),
            last_fetch: this.lastFetchTime,
            has_more: this.hasMore,
            is_loading: this.isLoading
        };
    }

    /**
     * Cross-reference mentions with threads to find which threads have mentions
     * @param {Array} threads - Array of thread objects from ThreadManager
     * @returns {Set} Set of message IDs (parent message IDs) that have mentions
     */
    crossReferenceWithThreads(threads) {
        const mentionedThreadIds = new Set();

        if (!threads || threads.length === 0 || !this.mentions || this.mentions.length === 0) {
            return mentionedThreadIds;
        }

        // Create a set of parent message IDs from mentions (for faster lookup)
        const mentionParentIds = new Set();
        this.mentions.forEach(mention => {
            if (mention.parent_message_id) {
                mentionParentIds.add(mention.parent_message_id);
            }
        });

        this.app?.logger?.log('📧 Cross-referencing:', {
            mentions: this.mentions.length,
            threads: threads.length,
            mentionParentIds: mentionParentIds.size
        });

        // Check each thread to see if it has mentions
        threads.forEach(thread => {
            if (mentionParentIds.has(thread.messageId)) {
                mentionedThreadIds.add(thread.messageId);
                this.app?.logger?.log('✅ Thread has mention:', thread.messageId);
            }
        });

        this.app?.logger?.log('📧 Found mentioned threads:', mentionedThreadIds.size);
        return mentionedThreadIds;
    }
};

// Export to global namespace
if (typeof window !== 'undefined') {
    window.WVFavs = window.WVFavs || {};
    window.WVFavs.MentionsManager = WVFavs.MentionsManager;
}
