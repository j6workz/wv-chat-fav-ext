/**
 * SearchManager - Handle channel-scoped message search using Sendbird API
 * Searches messages within the currently open channel
 */

var WVFavs = WVFavs || {};

WVFavs.SearchManager = class SearchManager {
    constructor(app) {
        this.app = app;
        this.currentQuery = null;
        this.currentChannelUrl = null;
        this.advancedQuery = false; // Track if current search uses advanced query
        this.exactMatch = false; // Track if current search uses exact match
        this.results = [];
        this.nextToken = null;
        this.hasMore = false;
        this.isSearching = false;
    }

    /**
     * Get current user ID from userIdentity
     * @returns {Promise<string|null>} User ID or null
     */
    async getCurrentUserId() {
        if (this.app.userIdentity) {
            try {
                const user = await this.app.userIdentity.getCurrentUser();
                return user?.id || null;
            } catch (error) {
                this.app?.logger?.error('❌ Error getting current user ID:', error);
                return null;
            }
        }
        return null;
    }

    /**
     * Search messages (either in a specific channel or all channels)
     * @param {string|null} channelUrl - Sendbird channel URL (null for all channels)
     * @param {string} query - Search term
     * @param {Object} options - Search options
     * @param {boolean} options.advancedQuery - Enable Sendbird advanced search with AND/OR operators
     * @param {boolean} options.exactMatch - Enable exact match search
     * @param {string|null} options.nextToken - Pagination token (optional)
     * @returns {Promise<Object>} Search results with pagination info
     */
    async searchMessages(channelUrl, query, options = {}) {
        const { advancedQuery = false, exactMatch = false, nextToken = null } = options;
        if (!query || query.trim().length === 0) {
            this.app?.logger?.log('⚠️ Invalid search parameters:', { channelUrl, query });
            return { results: [], hasMore: false, nextToken: null };
        }

        this.isSearching = true;

        try {
            // Extract Sendbird app ID from page (like MentionsManager does)
            const sendbirdAppId = this.extractSendbirdAppId();
            if (!sendbirdAppId) {
                throw new Error('Could not extract Sendbird App ID');
            }

            // Build search URL
            const baseUrl = `https://api-${sendbirdAppId}.sendbird.com/v3/search/messages`;

            // Build URL with required parameters (sort by timestamp for chronological order)
            let url = `${baseUrl}?query=${encodeURIComponent(query.trim())}&limit=20&sort_field=ts`;

            // Add channel URL if searching specific channel, otherwise use user_id for global search
            if (channelUrl) {
                url += `&channel_url=${encodeURIComponent(channelUrl)}`;
            } else {
                // Global search: use user_id to search across all user's channels
                const userId = await this.getCurrentUserId();
                if (!userId) {
                    throw new Error('Could not get current user ID for global search');
                }
                url += `&user_id=${encodeURIComponent(userId)}`;
            }

            // Add advanced query parameter if enabled
            if (advancedQuery) {
                url += '&advanced_query=true';
            }

            // Add exact match parameter if enabled
            if (exactMatch) {
                url += '&exact_match=true';
            }

            // Add pagination token if provided
            if (nextToken) {
                url += `&next_token=${encodeURIComponent(nextToken)}`;
            }

            this.app?.logger?.log('🔍 Searching messages:', {
                channelUrl: channelUrl ? channelUrl.substring(0, 40) + '...' : 'all channels (user_id)',
                query,
                advancedQuery,
                exactMatch,
                url: url.substring(0, 150) + '...',
                hasNextToken: !!nextToken
            });

            // Make API request via page context (same as MentionsManager)
            const response = await this.makeSendbirdMessageSearchRequest(url);

            if (!response) {
                throw new Error('No response from search API');
            }

            // Parse results
            const searchResults = this.parseSearchResults(response);

            // Update state if this is a new search (not pagination)
            if (!nextToken) {
                this.currentQuery = query;
                this.currentChannelUrl = channelUrl;
                this.advancedQuery = advancedQuery;
                this.exactMatch = exactMatch;
                this.results = searchResults.results;
            } else {
                // Append results for pagination
                this.results = [...this.results, ...searchResults.results];
            }

            this.nextToken = searchResults.nextToken;
            this.hasMore = searchResults.hasMore;

            this.app?.logger?.log('✅ Search completed:', {
                resultsCount: searchResults.results.length,
                totalResults: this.results.length,
                hasMore: this.hasMore
            });

            return {
                results: searchResults.results,
                totalResults: this.results.length,
                hasMore: this.hasMore,
                nextToken: this.nextToken
            };

        } catch (error) {
            this.app?.logger?.error('❌ Search error:', error);
            throw error;
        } finally {
            this.isSearching = false;
        }
    }

    /**
     * Legacy method for backward compatibility
     * @deprecated Use searchMessages instead
     */
    async searchMessagesInChannel(channelUrl, query, options = {}) {
        return this.searchMessages(channelUrl, query, options);
    }

    /**
     * Parse Sendbird search API response
     * @param {Object} response - API response
     * @returns {Object} Parsed results with pagination info
     */
    parseSearchResults(response) {
        if (!response || !Array.isArray(response.results)) {
            return { results: [], hasMore: false, nextToken: null };
        }

        const results = response.results.map(item => ({
            messageId: item.message_id,
            message: item.message || item.data || '',
            user: {
                userId: item.user?.user_id || 'unknown',
                nickname: item.user?.nickname || 'Unknown User',
                profileUrl: item.user?.profile_url || null
            },
            createdAt: item.created_at || Date.now(),
            channelUrl: item.channel_url,
            parentMessageId: item.parent_message_id || null,
            isThread: !!item.parent_message_id,
            // Additional fields that might be useful
            type: item.type || 'MESG',
            customType: item.custom_type || null
        }));

        const parsed = {
            results,
            hasMore: response.has_next || false,
            nextToken: response.next || null
        };

        this.app?.logger?.log('📊 Pagination data:', {
            apiHasNext: response.has_next,
            apiNext: response.next?.substring(0, 20) + '...',
            parsedHasMore: parsed.hasMore,
            parsedNextToken: parsed.nextToken ? 'present' : 'null',
            resultsCount: results.length
        });

        return parsed;
    }

    /**
     * Load more results (pagination)
     * @returns {Promise<Object>} Additional search results
     */
    async loadMore() {
        if (!this.hasMore || !this.nextToken || !this.currentQuery) {
            this.app?.logger?.log('⚠️ Cannot load more:', {
                hasMore: this.hasMore,
                hasToken: !!this.nextToken,
                hasQuery: !!this.currentQuery
            });
            return { results: [], hasMore: false };
        }

        return await this.searchMessages(
            this.currentChannelUrl,
            this.currentQuery,
            {
                advancedQuery: this.advancedQuery,
                exactMatch: this.exactMatch,
                nextToken: this.nextToken
            }
        );
    }

    /**
     * Reset search state
     */
    resetSearch() {
        this.currentQuery = null;
        this.currentChannelUrl = null;
        this.advancedQuery = false;
        this.exactMatch = false;
        this.results = [];
        this.nextToken = null;
        this.hasMore = false;
        this.isSearching = false;
        this.app?.logger?.log('🔄 Search state reset');
    }

    /**
     * Get current search results
     * @returns {Array} Current results array
     */
    getCurrentResults() {
        return this.results;
    }

    /**
     * Check if more results available
     * @returns {boolean} True if pagination available
     */
    hasMoreResults() {
        return this.hasMore && !!this.nextToken;
    }

    /**
     * Get current pagination token
     * @returns {string|null} Next token for pagination
     */
    getNextToken() {
        return this.nextToken;
    }

    /**
     * Get current search query
     * @returns {string|null} Current query
     */
    getCurrentQuery() {
        return this.currentQuery;
    }

    /**
     * Check if search is in progress
     * @returns {boolean} True if searching
     */
    isSearchInProgress() {
        return this.isSearching;
    }

    /**
     * Make Sendbird message search API request via page context
     * @param {string} url - Full Sendbird API URL with query parameters
     * @returns {Promise<Object>} API response
     */
    async makeSendbirdMessageSearchRequest(url) {
        const requestId = `message-search-${Date.now()}-${Math.random()}`;

        const promise = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Search API request timeout'));
            }, 30000); // 30 second timeout

            // Listen for response
            const responseHandler = (event) => {
                if (event.detail.requestId === requestId) {
                    clearTimeout(timeout);
                    document.removeEventListener('wv-fav-api-response', responseHandler);

                    if (event.detail.cancelled) {
                        reject(new Error('Request was cancelled'));
                    } else if (event.detail.success) {
                        resolve(event.detail.data);
                    } else {
                        reject(new Error(event.detail.error));
                    }
                }
            };

            document.addEventListener('wv-fav-api-response', responseHandler);

            // Dispatch request to page context with URL (same as MentionsManager)
            document.dispatchEvent(new CustomEvent('wv-fav-api-request', {
                detail: {
                    requestId,
                    action: 'mentionsSearchAPI',  // Use existing mentions search handler
                    data: { url, method: 'GET' }
                }
            }));
        });

        return await promise;
    }

    /**
     * Extract Sendbird App ID from performance entries (same as MentionsManager)
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
                    const match = entry.name.match(/api-([^\.]+)\.sendbird\.com/);
                    if (match && match[1]) {
                        window.__wvSendbirdAppId = match[1];
                        this.app?.logger?.log('🔍 Extracted Sendbird App ID:', match[1]);
                        return match[1];
                    }
                }
            }
        } catch (error) {
            this.app?.logger?.log('❌ Error extracting Sendbird App ID:', error);
        }

        return null;
    }
};
