var WVFavs = WVFavs || {};

WVFavs.SearchEngine = new (class SearchEngine {
    constructor() {
        this.smartDB = null;
        this.searchInProgress = false;
        this.currentSearchId = null;
        this.abortCurrentSearch = false;
    }

    init(app) {
        this.app = app;
        // Use the app's SmartUserDatabase instance (not the class)
        this.smartDB = app.smartUserDB;
    }

    // Cancel current search if one is active
    cancelCurrentSearch(reason = 'new search started') {
        if (this.searchInProgress && this.currentSearchId) {
            this.app?.logger?.log(`🚫 SearchEngine cancelling search: ${this.currentSearchId} (${reason})`);
            this.abortCurrentSearch = true;

            // Also cancel API requests if APIManager is available
            if (WVFavs.APIManager && typeof WVFavs.APIManager.cancelRequestGroup === 'function') {
                WVFavs.APIManager.cancelRequestGroup(this.currentSearchId, reason);
            }
        }
    }

    // Check if a search should continue (not cancelled)
    shouldContinueSearch(searchId) {
        return !this.abortCurrentSearch && this.currentSearchId === searchId;
    }

    // Clean up search state
    cleanupSearchState() {
        this.searchInProgress = false;
        this.currentSearchId = null;
        this.abortCurrentSearch = false;
    }

    async performHierarchicalSearch(query, searchId = null, forceAdvanced = false) {
        this.app?.logger?.log('🌐 SearchEngine.performHierarchicalSearch called with:', { query, searchId, forceAdvanced });

        // Handle backward compatibility - if second param is boolean, it's forceAdvanced
        if (typeof searchId === 'boolean') {
            forceAdvanced = searchId;
            searchId = null;
        }

        // Cancel any existing search before starting new one
        if (this.searchInProgress) {
            this.cancelCurrentSearch('superseded by new search');
            // Wait a moment for cleanup
            await new Promise(resolve => setTimeout(resolve, 10));
        }

        // Start new search - IMPORTANT: Set this FIRST before any async operations
        this.currentSearchId = searchId;
        this.searchInProgress = true;
        this.abortCurrentSearch = false;

        this.app?.logger?.log(`🔄 SearchEngine: Starting search "${query}" with ID: ${searchId}`);

        try {
            const trimmedQuery = query.trim();

            // Handle empty queries - return pinned and recent chats
            if (!trimmedQuery || trimmedQuery.length === 0) {
                this.app?.logger?.log('🔍 Empty query detected, returning pinned and recent chats');
                const importantChats = await this.smartDB.getImportantChats();
                this.app?.logger?.log('📋 Retrieved important chats:', importantChats.length);
                return importantChats;
            }

            // Skip early cancellation check - let the search proceed to API decision point

            // Stage 1: Always search local SmartUserDatabase first
            this.app?.logger?.log(`🔍 Starting local search for: "${trimmedQuery}"`);
            this.app?.logger?.log(`🔍 SmartDB status:`, {
                exists: !!this.smartDB,
                isReady: this.smartDB?.isReady,
                type: typeof this.smartDB
            });

            const rawLocalResults = await this.smartDB.searchItemsLocally(trimmedQuery, 20);
            this.app?.logger?.log(`🔍 Raw local results:`, rawLocalResults);

            const localResults = this.transformSmartDBResults(rawLocalResults);
            this.app?.logger?.log(`🔍 Transformed local results:`, localResults);

            this.app?.logger?.log(`🔍 Local search for "${trimmedQuery}":`, {
                found: localResults.length,
                topScores: localResults.slice(0, 3).map(r => ({ name: r.name, score: r.searchScore || r.score || 0 }))
            });

            // Allow search to proceed to API decision - only check cancellation right before API calls

            // Stage 2: Intelligent API decision - only call APIs when needed
            const hasGoodLocalCoverage = await this.smartDB.hasGoodCoverage(trimmedQuery);
            const needsAPISearch = forceAdvanced || !hasGoodLocalCoverage;

            this.app?.logger?.log(`🤔 API decision for "${trimmedQuery}": hasGoodLocalCoverage=${hasGoodLocalCoverage}, forceAdvanced=${forceAdvanced}, needsAPISearch=${needsAPISearch}`);

            if (needsAPISearch) {
                this.app?.logger?.log('🌐 Triggering API search sequence...');

                // Check if search was cancelled before API calls
                if (!this.shouldContinueSearch(searchId)) {
                    this.app?.logger?.log(`🏃‍♂️ Search ${searchId} cancelled before API calls`);
                    return localResults;
                }

                try {

                    // NEW: Use comprehensive 4-endpoint search strategy
                    this.app?.logger?.log('🌐 Calling comprehensive 4-endpoint search...');
                    const comprehensiveResults = await WVFavs.APIManager.comprehensiveSearch(trimmedQuery, searchId);

                    // Check if search was cancelled after API calls
                    if (!this.shouldContinueSearch(searchId)) {
                        this.app?.logger?.log(`🏃‍♂️ Search ${searchId} cancelled after comprehensive API calls`);
                        return localResults;
                    }

                    this.app?.logger?.log(`🌐 Comprehensive search returned:`, {
                        users: comprehensiveResults.users?.length || 0,
                        channels: comprehensiveResults.channels?.length || 0,
                        stats: comprehensiveResults.stats
                    });

                    // Store comprehensive results in SmartUserDatabase (new approach)
                    const allResults = [...(comprehensiveResults.users || []), ...(comprehensiveResults.channels || [])];
                    if (allResults.length > 0) {
                        await this.smartDB.addItemsFromSearch(trimmedQuery, allResults);
                        this.app?.logger?.log(`📊 Stored ${allResults.length} items in SmartUserDatabase`);
                    }

                    // Get fresh local results to include newly stored data
                    const rawEnhancedResults = await this.smartDB.searchItemsLocally(trimmedQuery, 20);
                    const enhancedLocalResults = this.transformSmartDBResults(rawEnhancedResults);

                    // Merge with fresh comprehensive results
                    this.app?.logger?.log(`🔄 Merging ${enhancedLocalResults.length} local results with ${allResults.length} API results`);
                    const mergedResults = this.mergeLocalAndAPIResults(enhancedLocalResults, allResults, trimmedQuery);
                    this.app?.logger?.log(`🔄 After merge: ${mergedResults.length} total results`);

                    const finalResults = this.addResultMetadata(mergedResults, trimmedQuery, true);
                    this.app?.logger?.log(`🎯 Final results for UI:`, finalResults.map(r => ({ name: r.name, email: r.email, _resultType: r._resultType, dataSource: r.dataSource })));

                    return finalResults;
                } catch (error) {
                    this.app?.logger?.error('API search failed, using local results', {
                        error: error.message,
                        stack: error.stack,
                        query: trimmedQuery,
                        operation: 'hierarchical_search_api_fallback'
                    });
                }
            } else {
                this.app?.logger?.log(`✅ Using local results only (good coverage: ${hasGoodLocalCoverage})`);
            }

            return this.addResultMetadata(localResults, trimmedQuery, false);

        } catch (error) {
            // Check if this was a cancellation
            if (this.abortCurrentSearch) {
                this.app?.logger?.log(`🚫 Search ${searchId} was cancelled:`, error.message || 'Unknown cancellation');
                return [];
            }
            // Re-throw non-cancellation errors
            throw error;
        } finally {
            this.cleanupSearchState();
        }
    }

    // Smart API trigger logic (your threshold-based strategy)
    shouldUseAdvancedAPI(query, localResults) {
        this.app?.logger?.log(`🔍 shouldUseAdvancedAPI check for query: "${query}", local results: ${localResults.length}`);

        // Pattern-based triggers
        if (this.hasEmailPattern(query)) {
            this.app?.logger?.log('📧 Email pattern detected, using Advanced API');
            return true;
        }

        if (this.hasSkillKeywords(query)) {
            this.app?.logger?.log('🎯 Skill keywords detected, using Advanced API');
            return true;
        }

        if (this.hasDepartmentKeywords(query)) {
            this.app?.logger?.log('🏢 Department keywords detected, using Advanced API');
            return true;
        }

        // Check for pinned/recent matches first - don't use API if we have them
        const pinnedOrRecentMatches = localResults.filter(r => r.isPinned || r.isRecent);
        if (pinnedOrRecentMatches.length > 0) {
            this.app?.logger?.log(`✅ Found ${pinnedOrRecentMatches.length} pinned/recent matches, skipping API`);
            return false;
        }

        // Threshold-based trigger (your main strategy)
        if (localResults.length < 3) {  // Reduced from 5 to 3 to be less aggressive
            this.app?.logger?.log(`📊 Insufficient local results (${localResults.length} < 3), using Advanced API`);
            return true;
        }

        // Quality-based trigger - only if really no good matches
        const highQualityResults = localResults.filter(r => r.score >= 5);  // Increased from 3 to 5
        if (highQualityResults.length === 0 && query.length >= 3) {
            this.app?.logger?.log('🎯 No high-quality results, using Advanced API');
            return true;
        }

        return false;
    }

    // Pattern detection methods
    hasEmailPattern(query) {
        const isEmail = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(query) ||
                       query.includes('@') ||
                       query.includes('.com') ||
                       query.includes('.org');

        if (isEmail) {
            this.app?.logger?.log(`📧 Email pattern detected in query: "${query}"`);
        }

        return isEmail;
    }

    hasSkillKeywords(query) {
        const skillKeywords = [
            'developer', 'designer', 'manager', 'engineer', 'analyst',
            'react', 'angular', 'vue', 'python', 'java', 'javascript',
            'frontend', 'backend', 'fullstack', 'devops', 'qa', 'tester',
            'marketing', 'sales', 'product', 'ux', 'ui', 'data'
        ];

        const lowerQuery = query.toLowerCase();
        return skillKeywords.some(keyword => lowerQuery.includes(keyword));
    }

    hasDepartmentKeywords(query) {
        const deptKeywords = [
            'engineering', 'design', 'marketing', 'sales', 'hr', 'finance',
            'operations', 'support', 'legal', 'admin', 'management'
        ];

        const lowerQuery = query.toLowerCase();
        return deptKeywords.some(keyword => lowerQuery.includes(keyword));
    }

    // Call Advanced API with proper data transformation
    async callAdvancedAPI(query) {
        try {
            const response = await WVFavs.APIManager.performAdvancedSearch(query);

            if (response && response.items) {
                // Transform Advanced API results to unified format
                return response.items.map(item => this.transformAdvancedAPIUser(item));
            }

            return [];
        } catch (error) {
            this.app?.logger?.error('Advanced API call failed', {
                error: error.message,
                stack: error.stack,
                query: query,
                operation: 'advanced_api_search'
            });
            return [];
        }
    }

    // Transform Advanced API user format to unified format
    transformAdvancedAPIUser(apiUser) {
        const cleanName = this.cleanHighlightTags(apiUser.title);
        return {
            id: apiUser.id,
            name: cleanName, // Advanced API uses 'title' not 'name'
            nickname: null, // Advanced API doesn't provide nickname directly
            email: apiUser.data?.email || null,
            bio: this.cleanHighlightTags(apiUser.excerpt),
            department: apiUser.data?.department_name || apiUser.data?.department || null,
            type: 'user',
            avatar: apiUser.avatar ? { type: 'url', content: apiUser.avatar, text: cleanName?.[0] || '?' } :
                    { type: 'character', content: cleanName?.[0] || '?', text: cleanName?.[0] || '?' },
            profile_url: apiUser.data?.permalink,
            dataSource: 'advanced_api',
            lastAdvancedUpdate: Date.now(),
            isPinned: false,
            isRecent: false,
            sharedChannels: [], // Will be populated later
            interactionCount: 0
        };
    }

    // Clean highlight tags from Advanced API responses
    cleanHighlightTags(text) {
        if (!text) return '';
        return text
            .replace(/<\/?em>/g, '')                    // Remove <em> tags
            .replace(/\[mark\]/g, '')                   // Remove [mark] opening tags
            .replace(/\[\/mark\]/g, '')                 // Remove [/mark] closing tags
            .trim();
    }

    // Extract shared connection user IDs from channel members API
    async extractSharedConnectionUserIds(channelMembersResults, searchQuery) {
        const sharedConnectionUserIds = new Set();
        const userChannelMapping = new Map(); // userId -> { distinctChannelUrl, allChannels }

        // Extract user IDs from channel members (these are shared connections)
        (channelMembersResults.channels || []).forEach(channel => {
            if (channel.members && Array.isArray(channel.members)) {
                const isDistinct = channel.is_distinct === true;

                channel.members.forEach(member => {
                    if (member.user_id) {
                        const userId = member.user_id.toString();
                        sharedConnectionUserIds.add(userId);

                        // Build user -> channel mapping
                        if (!userChannelMapping.has(userId)) {
                            userChannelMapping.set(userId, {
                                distinctChannelUrl: null,
                                allChannels: []
                            });
                        }

                        const userData = userChannelMapping.get(userId);
                        userData.allChannels.push({
                            channel_url: channel.channel_url,
                            name: channel.name,
                            is_distinct: isDistinct,
                            member_count: channel.member_count
                        });

                        // Store distinct channel URL for 1:1 DMs
                        if (isDistinct && !userData.distinctChannelUrl) {
                            userData.distinctChannelUrl = channel.channel_url;
                        }
                    }
                });
            }
        });

        this.app?.logger?.log(`🔗 Found ${sharedConnectionUserIds.size} shared connection user IDs from channel members`);
        this.app?.logger?.log(`📍 Built channel mapping for ${userChannelMapping.size} users`);

        // Optionally store channel data for future reference
        if (channelMembersResults.channels) {
            await this.storeChannelData(channelMembersResults.channels, searchQuery);
        }

        // Return both the user IDs set and the mapping
        return { sharedConnectionUserIds, userChannelMapping };
    }

    // Store channel data for reference (lightweight storage)
    async storeChannelData(channels, searchQuery) {
        const storePromises = channels.map(async (channel) => {
            try {
                const channelData = {
                    id: channel.channel_url || channel.id,
                    name: channel.name,
                    type: 'channel',
                    is_distinct: channel.is_distinct,
                    member_count: channel.member_count,
                    avatar: channel.cover_url ? { type: 'url', content: channel.cover_url, text: channel.name?.[0] || '?' } :
                            { type: 'character', content: channel.name?.[0] || '?', text: channel.name?.[0] || '?' },
                    dataSource: 'channel_members_api',
                    isPinned: false,
                    isRecent: false,
                    sharedChannels: [],
                    interactionCount: 0,
                    channel_url: channel.channel_url
                };

                await this.smartDB.addItemsFromSearch(searchQuery, [channelData]);

                // Search match recording handled by addItemsFromSearch

                this.app?.logger?.log(`💾 Stored channel: ${channelData.name} (${channelData.id})`);
            } catch (error) {
                console.warn(`Failed to store channel ${channel.id}:`, error);
            }
        });

        await Promise.all(storePromises);
        this.app?.logger?.log(`📊 Stored ${channels.length} channels from channel members API`);
    }

    // Identify users who matched via bio/excerpt (not name) for secondary lookup
    async identifyBioMatchUsers(advancedAPIResults, originalQuery) {
        const bioMatchUsers = [];
        const lowerQuery = originalQuery.toLowerCase();

        advancedAPIResults.forEach(user => {
            const userName = (user.name || '').toLowerCase();
            const userBio = (user.bio || '').toLowerCase();

            // Check if this is a bio match (not a name match)
            const isNameMatch = userName.includes(lowerQuery) ||
                              userName.split(/\s+/).some(word => word.includes(lowerQuery));
            const isBioMatch = userBio.includes(lowerQuery);

            // If it's a bio match but NOT a name match, flag for secondary lookup
            if (isBioMatch && !isNameMatch) {
                bioMatchUsers.push({
                    id: user.id,
                    name: user.name,
                    originalQuery: originalQuery,
                    matchedIn: 'bio'
                });
                this.app?.logger?.log(`📝 Bio match detected: ${user.name} (matched "${originalQuery}" in bio)`);
            }
        });

        return bioMatchUsers;
    }

    // Perform secondary channel members lookup for bio matched users
    async performSecondaryChannelLookup(bioMatchUsers, originalQuery) {
        for (const user of bioMatchUsers) {
            try {
                // Extract searchable parts of the user's name for channel lookup
                const searchTerms = this.extractSearchTermsFromName(user.name);

                for (const searchTerm of searchTerms) {
                    this.app?.logger?.log(`🔍 Secondary lookup for "${user.name}" using term: "${searchTerm}"`);

                    // Call channel members API with user name parts
                    const channelResults = await WVFavs.APIManager.getChannelMembers(searchTerm);

                    if (channelResults && channelResults.channels) {
                        const foundInChannels = this.findUserInChannelMembers(user.id, channelResults.channels);

                        if (foundInChannels.length > 0) {
                            await this.upgradeUserToSharedConnection(user, foundInChannels, originalQuery);
                            break; // Found in channels, no need to try other search terms
                        }
                    }

                    // Small delay to avoid hammering the API
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            } catch (error) {
                this.app?.logger?.log(`⚠️ Secondary lookup failed for ${user.name}:`, error.message);
            }
        }
    }

    // Extract searchable terms from a user's name
    extractSearchTermsFromName(name) {
        const terms = [];

        // Split by spaces and get individual parts
        const nameParts = name.split(/\s+/).filter(part => part.length > 2);

        // Add individual parts
        terms.push(...nameParts);

        // Add full name
        terms.push(name);

        // Remove duplicates and return
        return [...new Set(terms)];
    }

    // Find if user exists in channel members
    findUserInChannelMembers(userId, channels) {
        const foundInChannels = [];

        channels.forEach(channel => {
            if (channel.members && Array.isArray(channel.members)) {
                const memberFound = channel.members.find(member =>
                    member.user_id === userId || member.user_id === userId.toString()
                );

                if (memberFound) {
                    foundInChannels.push({
                        channelId: channel.channel_url || channel.id,
                        channelName: channel.name,
                        isDistinct: channel.is_distinct,
                        memberCount: channel.member_count
                    });
                }
            }
        });

        return foundInChannels;
    }

    // Upgrade bio-matched user to shared connection status
    async upgradeUserToSharedConnection(user, foundChannels, originalQuery) {
        try {
            // Get existing user data from DB
            const existingUser = await this.unifiedDB.getChat(user.id);

            if (existingUser) {
                // Calculate new priority based on channel types
                const hasDirectChannels = foundChannels.some(ch => ch.isDistinct);
                const sharedChannelsData = foundChannels.map(ch => ({
                    channel_url: ch.channelId,
                    name: ch.channelName,
                    is_distinct: ch.isDistinct,
                    member_count: ch.memberCount,
                    discovered_via: 'bio_secondary_lookup'
                }));

                // Extract distinct channel (1:1 DM) for instant channel switching
                const distinctChannel = foundChannels.find(ch => ch.isDistinct);
                const directChannelUrl = distinctChannel ? distinctChannel.channelId : null;

                // Update user with shared connection info
                const updatedUser = {
                    ...existingUser,
                    sharedChannels: sharedChannelsData,
                    channel_url: directChannelUrl || existingUser.channel_url, // Store DM channel URL
                    dataSource: 'bio_enhanced_shared_connection'
                };

                await this.unifiedDB.storeChat(updatedUser);

                const priorityType = hasDirectChannels ? 'DIRECT' : 'GROUP';
                this.app?.logger?.log(`🔗 UPGRADED: ${user.name} to shared connection via bio lookup (${priorityType} channels: ${foundChannels.length})${directChannelUrl ? ` - DM: ${directChannelUrl}` : ''}`);

                // Record this enhancement for self-learning
                await this.unifiedDB.recordSearchMatch(
                    user.id,
                    originalQuery,
                    'bio_secondary_enhancement',
                    0.9 // High confidence for discovered connections
                );
            }
        } catch (error) {
            this.app?.logger?.log(`⚠️ Failed to upgrade user ${user.name}:`, error.message);
        }
    }

    // Transform light API item to unified format
    transformLightAPIItem(item) {
        if (item.type === 'user') {
            return {
                id: item.id,
                name: item.name,
                nickname: null,
                email: null,
                bio: null,
                department: null,
                type: 'user',
                avatar: item.profile_url ? { type: 'url', content: item.profile_url, text: item.name?.[0] || '?' } :
                        item.avatar || { type: 'character', content: item.name?.[0] || '?', text: item.name?.[0] || '?' },
                profile_url: item.profile_url,
                dataSource: 'light_api',
                lastAdvancedUpdate: null,
                isPinned: false,
                isRecent: false,
                sharedChannels: [],
                interactionCount: 0,
                user_id: item.user_id
            };
        } else {
            // Channel
            return {
                id: item.id,
                name: item.name,
                nickname: null,
                email: null,
                bio: null,
                department: null,
                type: 'channel',
                avatar: item.cover_url ? { type: 'url', content: item.cover_url, text: item.name?.[0] || '?' } :
                        item.avatar || { type: 'character', content: item.name?.[0] || '?', text: item.name?.[0] || '?' },
                dataSource: 'light_api',
                lastAdvancedUpdate: null,
                isPinned: false,
                isRecent: false,
                sharedChannels: [],
                interactionCount: 0,
                is_distinct: item.is_distinct,
                member_count: item.member_count,
                channel_url: item.channel_url
            };
        }
    }

    // Store advanced API results in unified database
    async storeAPIResultsInDB(apiResults, searchQuery, sharedConnectionUserIds = new Set(), userChannelMapping = new Map()) {
        const storePromises = apiResults.map(async (user) => {
            try {
                // Check if this user has shared connections
                const hasSharedConnection = sharedConnectionUserIds.has(user.id.toString());
                const channelData = userChannelMapping.get(user.id.toString());

                if (hasSharedConnection) {
                    user.sharedChannels = [{ shared_connection: true }]; // Mark as shared connection
                    this.app?.logger?.log(`🔗 User ${user.name} has shared connection!`);
                }

                // Add distinct channel URL for instant channel switching
                if (channelData?.distinctChannelUrl) {
                    user.channel_url = channelData.distinctChannelUrl;
                    this.app?.logger?.log(`📍 Setting channel_url for ${user.name}: ${channelData.distinctChannelUrl}`);
                }

                // Store detailed channel data if available
                if (channelData?.allChannels && channelData.allChannels.length > 0) {
                    user.sharedChannels = channelData.allChannels;
                }

                // Store user in unified DB
                await this.unifiedDB.storeChat(user);

                // Record search match for self-learning with higher confidence for shared connections
                await this.unifiedDB.recordSearchMatch(
                    user.id,
                    searchQuery,
                    'advanced_api_search',
                    hasSharedConnection ? 0.9 : 0.8 // Higher confidence for shared connections
                );

                this.app?.logger?.log(`💾 Stored advanced API user: ${user.name} (${user.id})${hasSharedConnection ? ' [SHARED CONNECTION]' : ''}`);
            } catch (error) {
                console.warn(`Failed to store user ${user.id}:`, error);
            }
        });

        await Promise.all(storePromises);
        this.app?.logger?.log(`📊 Stored ${apiResults.length} advanced API results in unified DB`);
    }

    // Add metadata to results for UI display
    addResultMetadata(results, query, usedAdvancedAPI) {
        return results.map((result, index) => ({
            ...result,
            _resultType: this.determineResultType(result),
            _searchQuery: query,
            _index: index,
            _usedAdvancedAPI: usedAdvancedAPI,
            _timestamp: Date.now()
        }));
    }

    // Determine result type for UI display
    determineResultType(result) {
        if (result.isPinned) return 'pinned';
        if (result.isRecent) return 'recent';
        if (result.dataSource === 'advanced_api') return 'advanced_api';
        if (result.dataSource === 'light_api') return 'light_api';
        return 'local';
    }

    // Migration removed - using SmartUserDatabase with flags approach

    // Get database statistics
    async getStats() {
        return await this.smartDB.getStats();
    }

    // Merge local database results with fresh API results to ensure nothing is missed
    mergeLocalAndAPIResults(localResults, apiResults, query) {
        const merged = new Map();
        const lowerQuery = query.toLowerCase();

        // Add all local results first
        localResults.forEach(result => {
            if (result.id) {
                merged.set(result.id, result);
            }
        });

        // Add API results, but only if they actually match the query or aren't already included
        apiResults.forEach(apiResult => {
            if (!apiResult.id) return;

            const existingResult = merged.get(apiResult.id);

            // If result doesn't exist locally, add it - API results are pre-filtered
            if (!existingResult) {
                // Advanced search and other API results are already filtered by WorkVivo API
                // so we trust them and don't need additional query matching
                const shouldInclude = this.resultMatchesQuery(apiResult, lowerQuery) ||
                                    apiResult.dataSource === 'advanced_search_filtered' ||
                                    apiResult.found_in; // Advanced search has found_in field

                if (shouldInclude) {
                    // Transform API result to match database format
                    const transformedResult = {
                        ...apiResult,
                        isPinned: false,
                        isRecent: false,
                        baseRank: 0,
                        score: 0 // Will be calculated later
                    };
                    merged.set(apiResult.id, transformedResult);
                    this.app?.logger?.log(`📧 Added API result: ${apiResult.name} (source: ${apiResult.dataSource})`);
                } else {
                    this.app?.logger?.log(`🚫 Filtered out API result: ${apiResult.name} (doesn't match query: ${query})`);
                }
            } else {
                // Update existing result with API data if it has more complete information
                if (apiResult.email && !existingResult.email) {
                    existingResult.email = apiResult.email;
                }
                if (apiResult.bio && !existingResult.bio) {
                    existingResult.bio = apiResult.bio;
                }
                if (apiResult.department && !existingResult.department) {
                    existingResult.department = apiResult.department;
                }
            }
        });

        return Array.from(merged.values());
    }

    // Check if API result matches the search query (similar to UnifiedDatabase.chatMatchesQuery)
    resultMatchesQuery(result, lowerQuery) {
        const searchableFields = [
            result.name,
            result.nickname,
            result.email,
            result.bio,
            result.department
        ];

        return searchableFields.some(field =>
            field && field.toLowerCase().includes(lowerQuery)
        );
    }

    // Helper method to check if search is still current (race condition prevention)
    isSearchCurrent(searchId) {
        if (!this.app || !this.app.currentSearchId) return true; // No race condition tracking
        return this.app.currentSearchId === searchId;
    }

    // Public method for "Search for more" button
    async searchForMore(query) {
        this.app?.logger?.log('🔍➕ "Search for more" triggered for:', query);
        return await this.performHierarchicalSearch(query, null, true); // Force Advanced API
    }

    // Transform SmartUserDatabase results to match UI expectations
    transformSmartDBResults(smartResults) {
        if (!smartResults || !Array.isArray(smartResults)) {
            return [];
        }

        return smartResults.map(item => ({
            ...item,
            // Map searchScore to score for UI compatibility
            score: item.searchScore || 0,
            // Ensure required UI properties exist
            isPinned: item.isPinned || false,
            isRecent: item.isRecent || false,
            // Map interaction data for UI ranking
            baseRank: item.interactionCount || 0
        }));
    }
})();