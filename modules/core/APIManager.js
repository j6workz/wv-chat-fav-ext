var WVFavs = WVFavs || {};

WVFavs.APIManager = new (class APIManager {
    constructor() {
        this.apiRequests = new Map();
        this.activeRequestGroups = new Map(); // searchId -> Set of requestIds
        this.setupAPIListener();
    }

    init(app) {
        this.app = app;
    }

    // Helper function to add expiration tracking to avatar URLs
    addAvatarExpiration(avatarUrl) {
        if (!avatarUrl) return null;

        try {
            const url = new URL(avatarUrl);
            const expiresParam = url.searchParams.get('expires');

            const now = Date.now();
            let expiresAt;

            if (expiresParam) {
                // If URL has expires parameter, parse it
                expiresAt = parseInt(expiresParam) * 1000; // Convert to milliseconds
            } else {
                // Default: 4 hours from now
                expiresAt = now + (4 * 60 * 60 * 1000);
            }

            return {
                type: 'url',
                content: avatarUrl,
                url: avatarUrl,
                fetchedAt: now,
                expiresAt: expiresAt
            };
        } catch (error) {
            // If URL parsing fails, return basic avatar with default expiration
            const now = Date.now();
            return {
                type: 'url',
                content: avatarUrl,
                url: avatarUrl,
                fetchedAt: now,
                expiresAt: now + (4 * 60 * 60 * 1000) // 4 hours default
            };
        }
    }

    // Analytics disabled per user request
    // API call duration tracking removed
    trackAPICallDuration(apiName, method, url, duration, success, errorMessage) {
        // Tracking disabled
    }

    // Sanitize URL for analytics (remove sensitive query parameters)
    sanitizeUrl(url) {
        try {
            const urlObj = new URL(url, window.location.origin);
            return urlObj.pathname; // Only return the path, not query params
        } catch (error) {
            return url; // Return original if parsing fails
        }
    }

    setupAPIListener() {
        document.addEventListener('wv-fav-api-response', (event) => {
            const { requestId, success, data, error, cancelled } = event.detail;
            const request = this.apiRequests.get(requestId);

            if (request) {
                this.apiRequests.delete(requestId);
                // Clean up request group tracking
                this.cleanupRequestFromGroup(requestId);

                if (cancelled) {
                    request.reject(new Error('Request was cancelled'));
                } else if (success) {
                    request.resolve(data);
                } else {
                    request.reject(new Error(error));
                }
            }
        });
    }

    // Cancel all requests for a specific searchId
    cancelRequestGroup(searchId, reason = 'new search started') {
        const requestGroup = this.activeRequestGroups.get(searchId);
        if (!requestGroup) {
            return 0; // No active requests for this searchId
        }

        this.app?.logger?.log(`🚫 Cancelling request group for searchId: ${searchId} (${requestGroup.size} requests)`);

        // Send bulk cancellation event to page script
        document.dispatchEvent(new CustomEvent('wv-fav-cancel-search', {
            detail: { searchId, reason }
        }));

        // Clean up our tracking
        for (const requestId of requestGroup) {
            const request = this.apiRequests.get(requestId);
            if (request) {
                request.reject(new Error(`Request cancelled: ${reason}`));
                this.apiRequests.delete(requestId);
            }
        }

        this.activeRequestGroups.delete(searchId);
        return requestGroup.size;
    }

    // Cancel previous searches before starting a new one
    cancelPreviousRequests(currentSearchId) {
        let totalCancelled = 0;

        for (const [searchId] of this.activeRequestGroups) {
            if (searchId !== currentSearchId) {
                totalCancelled += this.cancelRequestGroup(searchId, 'superseded by newer search');
            }
        }

        return totalCancelled;
    }

    // Track request as part of a search group
    trackRequestInGroup(searchId, requestId) {
        if (!this.activeRequestGroups.has(searchId)) {
            this.activeRequestGroups.set(searchId, new Set());
        }
        this.activeRequestGroups.get(searchId).add(requestId);
    }

    // Clean up completed request from group tracking
    cleanupRequestFromGroup(requestId) {
        for (const [searchId, requestGroup] of this.activeRequestGroups) {
            if (requestGroup.has(requestId)) {
                requestGroup.delete(requestId);
                // If group is empty, remove it
                if (requestGroup.size === 0) {
                    this.activeRequestGroups.delete(searchId);
                }
                break;
            }
        }
    }

    // Get channel members for shared connection analysis (simplified API call)
    async getChannelMembers(query) {
        const cachedResults = WVFavs.CacheManager.get('channelMembersCache', query);
        if (cachedResults) {
            this.app?.logger?.log('⚡️ Returning cached channel members for:', query);
            return cachedResults;
        }

        try {
            const host = window.location.host;
            const channelMembersResponse = await this.executeSearchAPI(
                `https://${host}/api/chat/search/channels/members?query=${encodeURIComponent(query)}`
            );

            WVFavs.CacheManager.set('channelMembersCache', query, channelMembersResponse);
            return channelMembersResponse;
        } catch (error) {
            this.app?.logger?.error('Error getting channel members:', error);
            return { channels: [] };
        }
    }

    // Comprehensive search using all 4 endpoints strategically
    async comprehensiveSearch(query, searchId = null) {
        // Handle empty queries
        if (!query || query.trim().length === 0) {
            this.app?.logger?.log('⚠️ Empty query provided to comprehensive search, returning empty results');
            return { users: [], channels: [], stats: { error: 'Empty query' } };
        }

        const cachedResults = WVFavs.CacheManager.get('comprehensiveSearchCache', query);
        if (cachedResults) {
            this.app?.logger?.log('⚡️ Returning cached comprehensive search results for:', query);
            return cachedResults;
        }

        // Cancel previous requests if searchId provided
        if (searchId) {
            const cancelledCount = this.cancelPreviousRequests(searchId);
            if (cancelledCount > 0) {
                this.app?.logger?.log(`🚫 Cancelled ${cancelledCount} previous requests before starting new search:`, searchId);
            }
        }

        try {
            const host = window.location.host;

            this.app?.logger?.log('🌐 Starting comprehensive 4-endpoint search for:', query, searchId ? `(${searchId})` : '');

            // Execute all 4 API calls in parallel
            const [advancedResponse, usersResponse, channelsResponse, membersResponse] = await Promise.all([
                this.executeAdvancedSearchAPI(`https://${host}/api/advanced-search`, {
                    term: query,
                    sort: "most_relevant",
                    page: 1,
                    limit: 20,
                    types: ["People"]
                }, searchId),
                this.executeSearchAPI(`https://${host}/api/chat/users?page=1&query=${encodeURIComponent(query)}`, searchId),
                this.executeSearchAPI(`https://${host}/api/chat/search/channels?query=${encodeURIComponent(query)}`, searchId),
                this.executeSearchAPI(`https://${host}/api/chat/search/channels/members?query=${encodeURIComponent(query)}`, searchId)
            ]);

            this.app?.logger?.log('📊 API responses received:', {
                advanced: advancedResponse?.items?.length || 0,
                users: usersResponse?.data?.length || 0,
                channels: channelsResponse?.channels?.length || 0,
                members: membersResponse?.channels?.length || 0
            });

            // Process results with your strategic approach
            const processedResults = await this.processComprehensiveResults(
                advancedResponse, usersResponse, channelsResponse, membersResponse, query
            );

            WVFavs.CacheManager.set('comprehensiveSearchCache', query, processedResults);
            return processedResults;
        } catch (error) {
            this.app?.logger?.error('Error in comprehensive search:', error);
            return { users: [], channels: [], stats: { errors: [error.message] } };
        }
    }

    // Legacy method for backward compatibility
    async searchChannelsAndUsers(query) {
        // Redirect to comprehensive search
        return await this.comprehensiveSearch(query);
    }

    async executeSearchAPI(url, searchId = null) {
        // Start API call timing (Phase 4 performance metric)
        const apiStartTime = performance.now();

        const requestId = searchId ?
            `search-${searchId}-${Date.now()}-${Math.random()}` :
            `search-${Date.now()}-${Math.random()}`;

        // Track request in group if searchId provided
        if (searchId) {
            this.trackRequestInGroup(searchId, requestId);
        }

        const promise = new Promise((resolve, reject) => {
            this.apiRequests.set(requestId, { resolve, reject });
        });

        document.dispatchEvent(new CustomEvent('wv-fav-api-request', {
            detail: {
                requestId,
                action: 'quickSearchAPI',
                data: { url, method: 'GET' }
            }
        }));

        try {
            const result = await promise;

            // Track successful API call duration
            const apiDuration = Math.round(performance.now() - apiStartTime);
            this.trackAPICallDuration('searchChannelsAndUsers', 'GET', url, apiDuration, true, null);

            return result;
        } catch (error) {
            // Track failed API call duration
            const apiDuration = Math.round(performance.now() - apiStartTime);
            this.trackAPICallDuration('searchChannelsAndUsers', 'GET', url, apiDuration, false, error.message);

            this.app?.logger?.warn('API call failed:', url, error);
            return null;
        }
    }

    async makeSendbirdAPIRequest(url) {
        // Start API call timing (Phase 4 performance metric)
        const apiStartTime = performance.now();

        const requestId = `sendbird-${Date.now()}-${Math.random()}`;

        const promise = new Promise((resolve, reject) => {
            this.apiRequests.set(requestId, { resolve, reject });
        });

        document.dispatchEvent(new CustomEvent('wv-fav-api-request', {
            detail: {
                requestId,
                action: 'sendbirdChannelAPI',
                data: { url, method: 'GET' }
            }
        }));

        try {
            const result = await promise;

            // Track successful API call duration
            const apiDuration = Math.round(performance.now() - apiStartTime);
            this.trackAPICallDuration('sendbirdAPI', 'GET', url, apiDuration, true, null);

            return result;
        } catch (error) {
            // Track failed API call duration
            const apiDuration = Math.round(performance.now() - apiStartTime);
            this.trackAPICallDuration('sendbirdAPI', 'GET', url, apiDuration, false, error.message);

            this.app?.logger?.warn('Sendbird API call failed:', url, error);
            return null;
        }
    }

    /**
     * Get channel information with multi-level caching
     * Checks: Memory cache -> IndexedDB -> Sendbird API
     * @param {string} channelUrl - Sendbird channel URL
     * @returns {Promise<Object|null>} Channel info with name, cover_url, member_count, etc.
     */
    async getChannelInfo(channelUrl) {
        if (!channelUrl) {
            console.log('⚠️ [WV-API] getChannelInfo: No channel URL provided');
            return null;
        }

        console.log(`🔍 [WV-API] getChannelInfo called for: ${channelUrl.substring(0, 50)}...`);

        const cacheKey = `channel:${channelUrl}`;

        // Level 1: Check memory cache (fastest)
        const cachedInfo = WVFavs.CacheManager.get('channelInfoCache', cacheKey);
        if (cachedInfo) {
            console.log(`📦 [WV-API] Channel info from cache: ${channelUrl.substring(0, 50)}...`);
            this.app?.logger?.log('📦 Channel info from cache:', channelUrl);
            return cachedInfo;
        }

        console.log(`🔍 [WV-API] Not in cache, checking IndexedDB...`);

        // Level 2: Check IndexedDB (persistent) using smartUserDB
        if (this.app?.smartUserDB) {
            const chat = await this.app.smartUserDB.getChat(channelUrl);
            console.log(`📚 [WV-API] IndexedDB query result:`, chat ? `Found (${chat.name})` : 'Not found');

            if (chat && chat.name) {
                this.app?.logger?.log('📚 Channel info from IndexedDB:', channelUrl);
                const channelInfo = {
                    channel_url: chat.channel_url,
                    name: chat.name,
                    cover_url: chat.cover_url || chat.avatar?.url,
                    member_count: chat.member_count,
                    created_at: chat.created_at,
                    custom_type: chat.custom_type,
                    is_distinct: chat.is_distinct
                };

                console.log(`✅ [WV-API] Returning from IndexedDB:`, {
                    name: channelInfo.name,
                    is_distinct: channelInfo.is_distinct,
                    member_count: channelInfo.member_count
                });

                // Store in memory cache for faster future access
                WVFavs.CacheManager.set('channelInfoCache', cacheKey, channelInfo);
                return channelInfo;
            }
        }

        console.log(`🔍 [WV-API] Not in IndexedDB, calling Sendbird API...`);

        // Level 3: Fetch from Sendbird API (slowest, last resort)
        try {
            const sendbirdAppId = this.extractSendbirdAppId();
            if (!sendbirdAppId) {
                console.log('⚠️ [WV-API] Cannot fetch channel info: Sendbird app ID not found');
                this.app?.logger?.warn('⚠️ Cannot fetch channel info: Sendbird app ID not found');
                return null;
            }

            const url = `https://api-${sendbirdAppId}.sendbird.com/v3/group_channels/${encodeURIComponent(channelUrl)}?show_member=true`;
            console.log(`📡 [WV-API] Fetching from Sendbird API: ${url.substring(0, 100)}...`);
            this.app?.logger?.log('📡 Fetching channel info from Sendbird API:', channelUrl);

            const channelInfo = await this.makeSendbirdAPIRequest(url);

            console.log(`📡 [WV-API] Sendbird API response:`, channelInfo ? `Success (${channelInfo.name || 'no name'})` : 'Failed/null');

            if (channelInfo && channelInfo.name) {
                console.log(`✅ [WV-API] Valid channel info received:`, {
                    name: channelInfo.name,
                    is_distinct: channelInfo.is_distinct,
                    member_count: channelInfo.member_count
                });

                // Store in memory cache
                WVFavs.CacheManager.set('channelInfoCache', cacheKey, channelInfo);

                // Store in IndexedDB for persistence using smartUserDB
                if (this.app?.smartUserDB) {
                    try {
                        await this.app.smartUserDB.addItemsFromSearch('channel_info', [{
                            id: channelUrl,
                            channel_url: channelUrl,
                            name: channelInfo.name,
                            type: 'channel',
                            avatar: channelInfo.cover_url ? {
                                type: 'url',
                                url: channelInfo.cover_url,
                                content: channelInfo.cover_url
                            } : null,
                            cover_url: channelInfo.cover_url,
                            member_count: channelInfo.member_count,
                            created_at: channelInfo.created_at,
                            custom_type: channelInfo.custom_type,
                            is_distinct: channelInfo.is_distinct
                        }]);
                        console.log(`💾 [WV-API] Stored in IndexedDB: ${channelInfo.name}`);
                        this.app?.logger?.log('💾 Stored channel info in IndexedDB:', channelInfo.name);
                    } catch (error) {
                        console.log(`⚠️ [WV-API] Failed to store in IndexedDB:`, error);
                        this.app?.logger?.warn('⚠️ Failed to store channel in IndexedDB:', error);
                    }
                }

                return channelInfo;
            }

            console.log(`⚠️ [WV-API] No valid channel info, returning null`);
            return null;
        } catch (error) {
            console.log(`❌ [WV-API] Error in getChannelInfo:`, error);
            this.app?.logger?.warn('❌ Failed to fetch channel info:', error);
            return null;
        }
    }

    /**
     * Extract Sendbird App ID from performance entries (same as SearchManager)
     * @returns {string|null} Sendbird App ID
     */
    extractSendbirdAppId() {
        // Method 1: Check if stored from previous API calls
        if (window.__wvSendbirdAppId) {
            return window.__wvSendbirdAppId;
        }

        // Method 2: Extract from any Sendbird API URL in network history
        try {
            // Check performance entries for Sendbird API calls
            const entries = performance.getEntriesByType('resource');
            for (const entry of entries) {
                if (entry.name.includes('sendbird.com/v3/')) {
                    const match = entry.name.match(/api-([^\\.]+)\\.sendbird\\.com/);
                    if (match && match[1]) {
                        window.__wvSendbirdAppId = match[1];
                        this.app?.logger?.log('🔍 Extracted Sendbird App ID from performance entries:', match[1]);
                        return match[1];
                    }
                }
            }
        } catch (error) {
            this.app?.logger?.warn('❌ Error extracting Sendbird App ID:', error);
        }

        // Method 3: Try searching script tags (fallback)
        try {
            const scripts = document.querySelectorAll('script');
            for (const script of scripts) {
                const content = script.textContent || script.innerText;
                const match = content.match(/SENDBIRD_APP_ID["\s:]+["']([^"']+)["']/);
                if (match && match[1]) {
                    window.__wvSendbirdAppId = match[1];
                    this.app?.logger?.log('🔍 Extracted Sendbird App ID from script tags:', match[1]);
                    return match[1];
                }
            }
        } catch (error) {
            this.app?.logger?.warn('❌ Error searching script tags:', error);
        }

        return null;
    }

    async executeAdvancedSearchAPI(url, payload, searchId = null) {
        // Start API call timing (Phase 4 performance metric)
        const apiStartTime = performance.now();

        const requestId = searchId ?
            `advanced-search-${searchId}-${Date.now()}-${Math.random()}` :
            `advanced-search-${Date.now()}-${Math.random()}`;

        // Track request in group if searchId provided
        if (searchId) {
            this.trackRequestInGroup(searchId, requestId);
        }

        const promise = new Promise((resolve, reject) => {
            this.apiRequests.set(requestId, { resolve, reject });
        });

        document.dispatchEvent(new CustomEvent('wv-fav-api-request', {
            detail: {
                requestId,
                action: 'advancedSearchAPI',
                data: {
                    url,
                    method: 'POST',
                    body: JSON.stringify(payload),
                    headers: {
                        'Content-Type': 'application/json'
                    }
                }
            }
        }));

        try {
            const result = await promise;

            // Track successful API call duration
            const apiDuration = Math.round(performance.now() - apiStartTime);
            this.trackAPICallDuration('searchPeopleAdvanced', 'POST', url, apiDuration, true, null);

            return result;
        } catch (error) {
            // Track failed API call duration
            const apiDuration = Math.round(performance.now() - apiStartTime);
            this.trackAPICallDuration('searchPeopleAdvanced', 'POST', url, apiDuration, false, error.message);

            this.app?.logger?.warn('Advanced API call failed:', url, error);
            return null;
        }
    }

    combineSearchResults(channelMembersResponse, channelsResponse, userResponse) {
        const allChannels = new Map();
        const allUsers = new Map();

        // Process channel members response
        if (channelMembersResponse) {
            (channelMembersResponse.channels || []).forEach(channel => {
                const channelId = channel.channel_url || channel.id;
                if (channelId) {
                    allChannels.set(channelId, this.transformChannelData(channel));
                }

                // Extract users from channel members
                if (channel.members && Array.isArray(channel.members)) {
                    channel.members.forEach(member => {
                        const userId = member.user_id || member.id;
                        if (userId && !allUsers.has(userId)) {
                            allUsers.set(userId, this.transformUserData(member));
                        }
                    });
                }
            });

            // Also check for direct users array (in case structure varies)
            (channelMembersResponse.users || []).forEach(user => {
                allUsers.set(user.user_id || user.id, this.transformUserData(user));
            });
        }

        // Process dedicated channels response
        if (channelsResponse) {
            (channelsResponse.channels || []).forEach(channel => {
                const channelId = channel.channel_url || channel.id;
                if (channelId && !allChannels.has(channelId)) {
                    allChannels.set(channelId, this.transformChannelData(channel));
                }
            });
        }

        // Process users response
        if (userResponse) {
            const users = userResponse.users || userResponse.results || userResponse;
            if (Array.isArray(users)) {
                users.forEach(user => {
                    const id = user.user_id || user.id;
                    if (!allUsers.has(id)) {
                        allUsers.set(id, this.transformUserData(user));
                    }
                });
            }
        }

        return {
            channels: Array.from(allChannels.values()),
            users: Array.from(allUsers.values())
        };
    }

    transformChannelData(channel) {
        return {
            id: channel.channel_url || channel.id, // Prefer channel_url, fallback to id
            name: channel.name,
            type: 'channel',
            is_distinct: channel.is_distinct,
            member_count: channel.member_count,
            avatar: channel.avatar || { type: 'character', content: channel.name?.[0] || '?', text: channel.name?.[0] || '?' },
            channel_url: channel.channel_url,
            source: 'light_api'
        };
    }

    transformUserData(user) {
        return {
            id: user.user_id || user.id,
            name: user.nickname || user.name,
            type: 'user',
            profile_url: user.profile_url,
            avatar: user.avatar || { type: 'character', content: (user.nickname || user.name)?.[0] || '?', text: (user.nickname || user.name)?.[0] || '?' },
            user_id: user.user_id || user.id,
            source: 'light_api'
        };
    }

    // Advanced API search for comprehensive results (used when threshold triggers)
    async performAdvancedSearch(query) {
        try {
            const host = window.location.host;
            const advancedUrl = `https://${host}/api/advanced-search`;

            const payload = {
                term: query,
                sort: "most_relevant",
                page: 1,
                limit: 20,
                characters: {
                    excerpt: 240,
                    title: 240
                },
                types: ["People"]
            };

            this.app?.logger?.log('🌐 Calling Advanced API with payload:', payload);

            const response = await this.executeAdvancedSearchAPI(advancedUrl, payload);

            if (response && response.items) {
                this.app?.logger?.log(`✅ Advanced API returned ${response.items.length} results`);
                return response; // Return full response for SearchEngine to handle
            }

            this.app?.logger?.log('⚠️ Advanced API returned no results');
            return { items: [] };
        } catch (error) {
            this.app?.logger?.log('❌ Advanced API failed:', error.message);
            throw error;
        }
    }

    // Process comprehensive search results using your strategic approach
    async processComprehensiveResults(advancedResponse, usersResponse, channelsResponse, membersResponse, searchTerm) {
        const results = { users: [], channels: [], stats: {} };

        try {
            // 1. Process /users endpoint (PRIMARY for user storage with channel correlation)
            const primaryUsers = await this.processUsersEndpoint(usersResponse, searchTerm);

            // 2. Process /channels endpoint (PRIMARY for channel storage)
            const primaryChannels = this.processChannelsEndpoint(channelsResponse, searchTerm);

            // 3. Process /advanced-search with filtering (NO direct storage)
            const filteredAdvancedUsers = this.processAdvancedSearchEndpoint(advancedResponse, searchTerm);

            // 4. Cross-correlate with /members for shared connections
            const sharedConnections = this.processSharedConnections(membersResponse);

            // 5. Enhance users with shared connection data
            const enhancedUsers = this.enhanceUsersWithConnections(primaryUsers, sharedConnections);
            const enhancedAdvancedUsers = this.enhanceUsersWithConnections(filteredAdvancedUsers, sharedConnections);

            // 6. Fetch complete data for advanced-search users via secondary API calls
            const completeAdvancedUsers = await this.fetchCompleteDataForAdvancedUsers(enhancedAdvancedUsers, searchTerm);

            results.users = [...enhancedUsers, ...completeAdvancedUsers];
            results.channels = primaryChannels;
            results.stats = {
                primaryUsers: primaryUsers.length,
                advancedUsers: filteredAdvancedUsers.length,
                channels: primaryChannels.length,
                sharedConnections: Object.keys(sharedConnections).length
            };

            this.app?.logger?.log('✅ Comprehensive search processed:', results.stats);
            return results;

        } catch (error) {
            this.app?.logger?.log('❌ Error processing comprehensive results:', error);
            return { users: [], channels: [], stats: { error: error.message } };
        }
    }

    // Process /users endpoint (PRIMARY source for user data)
    async processUsersEndpoint(usersResponse, searchTerm) {
        if (!usersResponse?.data) return [];

        const users = usersResponse.data.map(user => ({
            id: user.id,
            name: user.full_name,
            email: user.email, // ✅ Critical: Only /users has email!
            first_name: user.first_name,
            last_name: user.last_name,
            job_title: user.job_title,
            department_name: user.department_name,
            location_name: user.location_name,
            avatar: this.addAvatarExpiration(user.avatar_url), // ✅ Add expiration tracking
            type: 'user',
            chat_account_status: user.chat_account_status,
            profile_permalink: user.relative_permalink,
            dataSource: 'users_api',
            searchKeywords: [searchTerm],
            user_id: user.id
        }));

        // PHASE 4: Correlate users with their DM channel_urls
        return await this.correlateUsersWithChannels(users, searchTerm);
    }

    /**
     * Correlate users with their DM channel URLs using /members endpoint
     * This ensures only users with established DM channels are stored
     * @param {Array} users - User objects from /users endpoint
     * @param {string} searchTerm - Original search term
     * @returns {Promise<Array>} Users enriched with channel_url
     */
    async correlateUsersWithChannels(users, searchTerm) {
        if (!users || users.length === 0) return users;

        try {
            // Call /members endpoint ONCE for the search term to get all DM channels
            const membersUrl = `${window.location.protocol}//${window.location.host}/api/chat/search/channels/members?query=${encodeURIComponent(searchTerm)}`;

            this.app?.logger?.debug(`[CORRELATION] Fetching DM channels for search: ${searchTerm}`);

            const membersResponse = await this.executeSearchAPI(membersUrl);

            if (!membersResponse?.channels) {
                this.app?.logger?.warn('[CORRELATION] No channels found in members response');
                return users.map(u => ({ ...u, channel_url: null }));
            }

            // Build user_id → channel_url map (only for direct messages)
            const userChannelMap = new Map();

            membersResponse.channels.forEach(channel => {
                // Only map 1:1 DM channels (is_distinct=true, member_count=2)
                if (channel.is_distinct === true && channel.member_count === 2 && channel.members) {
                    channel.members.forEach(member => {
                        if (member.user_id) {
                            userChannelMap.set(String(member.user_id), channel.channel_url);
                        }
                    });
                }
            });

            this.app?.logger?.debug(`[CORRELATION] Found ${userChannelMap.size} user-to-channel mappings`);

            // Enrich users with channel_url
            const enrichedUsers = users.map(user => {
                const channel_url = userChannelMap.get(String(user.id)) || null;

                if (channel_url) {
                    this.app?.logger?.debug(`[CORRELATION] ✅ Mapped ${user.name} → ${channel_url}`);
                } else {
                    this.app?.logger?.debug(`[CORRELATION] ⚠️ No DM channel for ${user.name} (will be rejected)`);
                }

                return {
                    ...user,
                    channel_url: channel_url
                };
            });

            return enrichedUsers;

        } catch (error) {
            this.app?.logger?.error('[CORRELATION] Failed to correlate users with channels:', error);
            // Return users without channel_url (will be rejected by verification)
            return users.map(u => ({ ...u, channel_url: null }));
        }
    }

    // Process /channels endpoint (PRIMARY source for channel data)
    processChannelsEndpoint(channelsResponse, searchTerm) {
        if (!channelsResponse?.channels) return [];

        return channelsResponse.channels.map(channel => ({
            id: channel.channel_url,
            name: channel.name,
            type: 'channel',
            channel_url: channel.channel_url,
            member_count: channel.member_count,
            is_distinct: channel.is_distinct, // ✅ Critical for direct chat detection!
            is_super: channel.is_super,
            is_public: channel.is_public,
            avatar: this.addAvatarExpiration(channel.cover_url), // ✅ Add expiration tracking
            dataSource: 'channels_api',
            searchKeywords: [searchTerm]
        }));
    }

    // Process /advanced-search with [mark] filtering
    processAdvancedSearchEndpoint(advancedResponse, searchTerm) {
        if (!advancedResponse?.items) return [];

        const validUsers = advancedResponse.items
            .filter(item => {
                // Only process People type
                if (item.type !== 'People') return false;

                // Filter out name-only matches (has [mark] in title)
                const hasNameMarks = item.title?.includes('[mark]') && item.title?.includes('[/mark]');
                if (hasNameMarks) {
                    this.app?.logger?.log('🚫 Ignoring name-only advanced search result:', item.title);
                    return false;
                }

                // Accept bio/job title matches
                return true;
            })
            .map(item => ({
                id: item.id,
                name: item.title,
                excerpt: item.excerpt, // Job title or bio excerpt
                type: 'user',
                avatar: this.addAvatarExpiration(item.avatar), // ✅ Add expiration tracking
                profile_permalink: item.data?.permalink,
                dataSource: 'advanced_search_filtered',
                searchKeywords: [searchTerm],
                found_in: item.found_in,
                // Note: Missing email! Would need secondary /users call
                needsFullUserData: true
            }));

        this.app?.logger?.log(`🔍 Advanced search: ${advancedResponse.items.length} total, ${validUsers.length} valid after filtering`);
        return validUsers;
    }

    // Extract shared connections from /members endpoint
    processSharedConnections(membersResponse) {
        const connections = {};

        if (membersResponse?.channels) {
            membersResponse.channels.forEach(channel => {
                if (channel.members && Array.isArray(channel.members)) {
                    channel.members.forEach(member => {
                        const userId = member.user_id || member.id;
                        if (!connections[userId]) {
                            connections[userId] = {
                                sharedChannels: [],
                                hasDirectChat: false
                            };
                        }

                        connections[userId].sharedChannels.push({
                            channel_url: channel.channel_url,
                            name: channel.name,
                            is_distinct: channel.is_distinct,
                            member_count: channel.member_count
                        });

                        // Check for direct chat (is_distinct = true)
                        if (channel.is_distinct) {
                            connections[userId].hasDirectChat = true;
                        }
                    });
                }
            });
        }

        return connections;
    }

    // Enhance users with shared connection data
    enhanceUsersWithConnections(users, sharedConnections) {
        return users.map(user => {
            const userConnections = sharedConnections[user.id] || sharedConnections[user.user_id];

            // Extract distinct channel URL for instant channel switching
            const distinctChannel = userConnections?.sharedChannels?.find(ch => ch.is_distinct === true);
            const channel_url = distinctChannel?.channel_url || null;

            if (channel_url) {
                this.app?.logger?.log(`📍 Setting channel_url for ${user.name}: ${channel_url}`);
            }

            return {
                ...user,
                hasSharedConnection: !!userConnections,
                hasDirectChat: userConnections?.hasDirectChat || false,
                sharedChannels: userConnections?.sharedChannels || [],
                channel_url: channel_url // Add distinct channel URL for 1:1 DMs
            };
        });
    }

    // Fetch complete data for advanced search users via users API
    async fetchCompleteDataForAdvancedUsers(advancedUsers, searchTerm) {
        if (!advancedUsers || advancedUsers.length === 0) {
            return [];
        }

        this.app?.logger?.log(`🔄 Fetching complete data for ${advancedUsers.length} advanced search users`);

        const completeUsers = [];

        for (const advancedUser of advancedUsers) {
            try {
                // Fetch complete user data from both users and members endpoints in parallel
                const [userSearchResults, membersSearchResults] = await Promise.all([
                    // Users endpoint for complete profile data (email, job_title, etc.)
                    this.executeSearchAPI(
                        `${window.location.protocol}//${window.location.host}/api/chat/users?page=1&query=${encodeURIComponent(advancedUser.name)}`
                    ),
                    // Members endpoint for direct chat detection
                    this.executeSearchAPI(
                        `${window.location.protocol}//${window.location.host}/api/chat/search/channels/members?query=${encodeURIComponent(advancedUser.name)}`
                    )
                ]);

                if (userSearchResults?.data) {
                    // Find the matching user in the results
                    const matchingUser = userSearchResults.data.find(user =>
                        user.id === advancedUser.id ||
                        user.full_name === advancedUser.name ||
                        (user.first_name && user.last_name &&
                         `${user.first_name} ${user.last_name}` === advancedUser.name)
                    );

                    if (matchingUser) {
                        // Process members search results to detect direct chats and shared connections
                        const memberConnections = this.processMembersResultsForUser(membersSearchResults, matchingUser.id, advancedUser.name);

                        // Merge advanced search data with complete user data
                        const completeUser = {
                            // Start with complete user data from /users API
                            id: matchingUser.id,
                            name: matchingUser.full_name,
                            email: matchingUser.email, // ✅ Critical: Only /users has email!
                            first_name: matchingUser.first_name,
                            last_name: matchingUser.last_name,
                            job_title: matchingUser.job_title,
                            department_name: matchingUser.department_name,
                            location_name: matchingUser.location_name,
                            profile_permalink: matchingUser.relative_permalink,
                            avatar: this.addAvatarExpiration(matchingUser.avatar_url), // ✅ Add expiration tracking
                            type: 'user',
                            chat_account_status: matchingUser.chat_account_status,
                            user_id: matchingUser.id,
                            dataSource: 'users_api_secondary',

                            // Preserve advanced search specific data
                            excerpt: advancedUser.excerpt,
                            found_in: advancedUser.found_in,
                            searchKeywords: advancedUser.searchKeywords,

                            // Enhanced connection data from members endpoint cross-reference
                            hasSharedConnection: memberConnections.hasSharedConnection || advancedUser.hasSharedConnection,
                            hasDirectChat: memberConnections.hasDirectChat || advancedUser.hasDirectChat,
                            sharedChannels: memberConnections.sharedChannels || advancedUser.sharedChannels || [],
                            channel_url: memberConnections.channel_url || advancedUser.channel_url || null
                        };

                        completeUsers.push(completeUser);
                        this.app?.logger?.log(`✅ Fetched complete data for: ${advancedUser.name}`);
                    } else {
                        // If we can't find complete data, keep the advanced search user as is
                        completeUsers.push(advancedUser);
                        this.app?.logger?.log(`⚠️ No matching user data found for: ${advancedUser.name}, keeping advanced search data`);
                    }
                } else {
                    // If API call fails, keep the advanced search user as is
                    completeUsers.push(advancedUser);
                    this.app?.logger?.log(`⚠️ Failed to fetch user data for: ${advancedUser.name}, keeping advanced search data`);
                }
            } catch (error) {
                // If any error occurs, keep the advanced search user as is
                completeUsers.push(advancedUser);
                this.app?.logger?.log(`❌ Error fetching data for ${advancedUser.name}:`, error.message);
            }
        }

        this.app?.logger?.log(`🔄 Completed data fetching: ${completeUsers.length} users processed`);
        return completeUsers;
    }

    // Process members search results to find direct chats and shared connections for a specific user
    processMembersResultsForUser(membersResponse, userId, userName) {
        const connections = {
            hasSharedConnection: false,
            hasDirectChat: false,
            sharedChannels: [],
            channel_url: null
        };

        if (!membersResponse?.channels) {
            this.app?.logger?.log(`⚠️ No members data found for user: ${userName}`);
            return connections;
        }

        this.app?.logger?.log(`🔍 Processing members data for ${userName} (ID: ${userId})`);

        membersResponse.channels.forEach(channel => {
            if (channel.members && Array.isArray(channel.members)) {
                // Check if this user is in this channel
                const userInChannel = channel.members.find(member =>
                    member.user_id === userId ||
                    member.id === userId ||
                    member.nickname === userName ||
                    member.name === userName
                );

                if (userInChannel) {
                    connections.hasSharedConnection = true;

                    // Check if this is a direct chat (is_distinct = true)
                    if (channel.is_distinct) {
                        connections.hasDirectChat = true;
                        connections.channel_url = channel.channel_url; // Store direct chat channel URL
                        this.app?.logger?.log(`✅ Found direct chat with ${userName} in channel: ${channel.channel_url}`);
                    }

                    // Add to shared channels list
                    connections.sharedChannels.push({
                        channel_url: channel.channel_url,
                        name: channel.name,
                        is_distinct: channel.is_distinct,
                        member_count: channel.member_count
                    });

                    this.app?.logger?.log(`🔗 Found shared connection with ${userName} in: ${channel.name} (distinct: ${channel.is_distinct})`);
                }
            }
        });

        this.app?.logger?.log(`📊 Connection summary for ${userName}:`, {
            hasSharedConnection: connections.hasSharedConnection,
            hasDirectChat: connections.hasDirectChat,
            sharedChannelsCount: connections.sharedChannels.length,
            channel_url: connections.channel_url
        });

        return connections;
    }

    injectPageScript() {
        return new Promise((resolve, reject) => {
            if (document.querySelector('script[data-wv-fav-page-script]')) {
                this.app?.logger?.log('📄 Page script already injected, skipping');
                resolve();
                return;
            }

            // Check if Chrome runtime is available
            if (!chrome?.runtime?.getURL) {
                this.app?.logger?.error('❌ Chrome runtime not available, cannot inject page script');
                this.app?.logger?.log('❌ Chrome runtime not available for page script injection');
                reject(new Error('Chrome runtime not available'));
                return;
            }

            try {
                const script = document.createElement('script');
                script.id = 'wv-fav-page-script';
                script.src = chrome.runtime.getURL('page-script.js');
                script.setAttribute('data-wv-fav-page-script', 'true');

                script.onload = () => {
                    this.app?.logger?.log('📄 Page script injected successfully');
                    console.log('✅ [WV STATUS] Page script loaded and ready');
                    // Don't remove script immediately, let it stay for API access
                    resolve();
                };

                script.onerror = () => {
                    this.app?.logger?.error('❌ Failed to inject page script');
                    this.app?.logger?.log('❌ Page script injection failed');
                    reject(new Error('Page script injection failed'));
                };

                (document.head || document.documentElement).appendChild(script);

            } catch (error) {
                this.app?.logger?.error('❌ Error during page script injection:', error);
                this.app?.logger?.log('❌ Page script injection error:', error.message);
                reject(error);
            }
        });
    }

    /**
     * Fetch user profile by user ID using /api/people endpoint
     * @param {string} userId - User ID
     * @returns {Promise<object>} Profile data with profile.short_bio
     */
    async fetchUserProfile(userId) {
        try {
            console.log(`🌐 [WV STATUS] API: Fetching profile for user: ${userId}`);
            this.app?.logger?.log(`👤 Fetching profile for user: ${userId}`);

            const host = window.location.host;
            const url = `https://${host}/api/people/${userId}`;
            console.log(`🌐 [WV STATUS] API: Calling ${url}`);

            // Use the page script injection method like other API calls
            const requestId = `profile-${userId}-${Date.now()}`;

            const promise = new Promise((resolve, reject) => {
                this.apiRequests.set(requestId, { resolve, reject });
            });

            console.log(`🌐 [WV STATUS] API: Dispatching profile fetch event with requestId: ${requestId}`);

            document.dispatchEvent(new CustomEvent('wv-fav-api-request', {
                detail: {
                    requestId,
                    action: 'fetchUserProfile',
                    data: {
                        userId: userId,
                        url: url
                    }
                }
            }));

            console.log(`🌐 [WV STATUS] API: Waiting for profile response...`);
            const data = await promise;

            console.log(`🌐 [WV STATUS] API: Profile data received:`, data);
            this.app?.logger?.log(`✅ Profile fetched for user: ${userId}`);

            return data;
        } catch (error) {
            console.error(`🌐 [WV STATUS] API: Error fetching profile for user ${userId}:`, error);
            this.app?.logger?.log(`❌ Error fetching profile for user ${userId}:`, error);
            throw error;
        }
    }

    /**
     * Update profile info (bio, short_bio, interests, etc.)
     * @param {string} userId - User ID
     * @param {object} profileData - Profile data to update
     * @returns {Promise<boolean>} Success status
     */
    async updateProfileInfo(userId, profileData) {
        try {
            console.log('💾 [WV STATUS] Updating profile info:', profileData);
            this.app?.logger?.log('💾 Updating profile info:', profileData);

            // First, fetch current profile to get all existing data
            const currentProfile = await this.fetchUserProfile(userId);

            // Prepare payload with all required fields
            // Preserve existing values for fields we're not updating
            const payload = {
                bio: profileData.bio !== undefined ? profileData.bio : (currentProfile.profile?.bio ?? null),
                short_bio: profileData.short_bio !== undefined ? profileData.short_bio : (currentProfile.profile?.short_bio ?? null),
                interests: profileData.interests !== undefined ? profileData.interests : (currentProfile.profile?.interests ?? null),
                keywords: profileData.keywords !== undefined ? profileData.keywords : (currentProfile.profile?.keywords ?? null),
                education: profileData.education !== undefined ? profileData.education : (currentProfile.profile?.education ?? null),
                experience: profileData.experience !== undefined ? profileData.experience : (currentProfile.profile?.experience ?? null),
                expertise: profileData.expertise !== undefined ? profileData.expertise : (currentProfile.profile?.expertise ?? null)
            };

            console.log('💾 [WV STATUS] Sending profile update with payload:', payload);
            this.app?.logger?.log('💾 Sending profile update with payload:', payload);

            // Use page script injection for authenticated request
            const host = window.location.host;
            const url = `https://${host}/api/profile/info`;
            const requestId = `update-profile-${userId}-${Date.now()}`;

            const promise = new Promise((resolve, reject) => {
                this.apiRequests.set(requestId, { resolve, reject });
            });

            console.log(`💾 [WV STATUS] Dispatching profile update event with requestId: ${requestId}`);

            document.dispatchEvent(new CustomEvent('wv-fav-api-request', {
                detail: {
                    requestId,
                    action: 'updateProfileInfo',
                    data: {
                        userId: userId,
                        url: url,
                        payload: payload
                    }
                }
            }));

            console.log(`💾 [WV STATUS] Waiting for profile update response...`);
            const data = await promise;

            console.log(`✅ [WV STATUS] Profile updated successfully:`, data);
            this.app?.logger?.log('✅ Profile info updated successfully:', data);

            return true;
        } catch (error) {
            console.error('❌ [WV STATUS] Error updating profile info:', error);
            this.app?.logger?.log('❌ Error updating profile info:', error);
            throw error;
        }
    }

    /**
     * Get CSRF token from cookies or meta tags
     * @returns {string|null} CSRF token
     */
    getCsrfToken() {
        // Try to get from meta tag
        const metaTag = document.querySelector('meta[name="csrf-token"]');
        if (metaTag) {
            return metaTag.getAttribute('content');
        }

        // Try to get from cookie
        const cookies = document.cookie.split(';');
        for (const cookie of cookies) {
            const [name, value] = cookie.trim().split('=');
            if (name === 'XSRF-TOKEN' || name === 'csrf-token') {
                return decodeURIComponent(value);
            }
        }

        return null;
    }

    /**
     * Get XSRF token from cookies
     * @returns {string|null} XSRF token
     */
    getXsrfToken() {
        const cookies = document.cookie.split(';');
        for (const cookie of cookies) {
            const [name, value] = cookie.trim().split('=');
            if (name === 'XSRF-TOKEN') {
                return decodeURIComponent(value);
            }
        }
        return null;
    }
})();