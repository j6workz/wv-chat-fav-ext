var WVFavs = WVFavs || {};

WVFavs.SmartUserDatabase = class SmartUserDatabase {
    constructor(ttl = 30 * 24 * 60 * 60 * 1000, logger = null) {
        this.ttl = ttl;
        this.dbName = 'wv_smart_user_db';
        this.version = 5; // Incremented for removing unused search fields
        this.db = null;
        this.isReady = false;
        this.logger = logger || (window.WVFavs?.Logger ? new window.WVFavs.Logger() : { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} });
        this.initTime = Date.now(); // Track initialization time for uptime calculation
        this.lastCleanupTime = 0; // Track last cleanup to prevent excessive cleanup runs
        this.uiOperationsInProgress = 0; // Track if UI operations (panel opens) are in progress
        this.stats = {
            totalSearches: 0,
            totalUsers: 0,
            lastAPICall: null,
            cacheHitRate: 0
        };

        // Initialize IndexedDB
        this.initDB();
    }

    /**
     * Mark that a UI operation (panel open) is starting
     * This prevents cleanup from running during critical DOM stabilization
     */
    markUIOperationStart() {
        this.uiOperationsInProgress++;
    }

    /**
     * Mark that a UI operation (panel open) has completed
     */
    markUIOperationEnd() {
        this.uiOperationsInProgress = Math.max(0, this.uiOperationsInProgress - 1);
    }

    // Track database operation performance
    async trackDatabaseOperation(operationName, operationFn) {
        const startTime = performance.now();
        try {
            const result = await operationFn();
            const duration = Math.round(performance.now() - startTime);

            // Analytics disabled per user request
            // Database operation time tracking removed

            return result;
        } catch (error) {
            const duration = Math.round(performance.now() - startTime);

            // Analytics disabled per user request
            // Database operation time tracking removed

            throw error;
        }
    }

    // Initialize IndexedDB with proper schema and indexes
    async initDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.version);

            request.onerror = () => {
                this.logger.error('❌ IndexedDB failed to open:', request.error);
                reject(request.error);
            };

            request.onsuccess = async () => {
                this.db = request.result;
                this.isReady = true;
                this.loadStats();
                this.logger.info('🧠 IndexedDB Smart Database initialized');

                // Run cleanup on startup to remove duplicates
                try {
                    const cleanupResult = await this.cleanupDuplicates();
                    if (cleanupResult.removed > 0) {
                        this.logger.info(`🧹 Removed ${cleanupResult.removed} duplicate records on startup`);
                    }
                } catch (err) {
                    this.logger.warn('⚠️ Cleanup failed on startup:', err);
                }

                // CRITICAL: Migrate to channel_url as primary key FIRST
                try {
                    const schemaResult = await this.migrateToChannelUrlAsPrimaryKey();
                    if (schemaResult.migrated > 0 || schemaResult.deleted > 0) {
                        this.logger.info('✅ [SCHEMA-MIGRATION] Primary key migration:', schemaResult);
                    }
                } catch (err) {
                    this.logger.error('❌ [SCHEMA-MIGRATION] Failed:', err);
                }

                // DEDUPLICATION: Consolidate duplicate 1:1 DM channels (after schema migration)
                try {
                    const dedupResult = await this.consolidateDuplicate1to1Channels();
                    if (dedupResult.consolidated > 0) {
                        this.logger.info('✅ [DEDUP] Duplicate consolidation:', dedupResult);
                    }
                } catch (err) {
                    this.logger.error('❌ [DEDUP] Consolidation failed:', err);
                }

                // PHASE 6: Check if full verification is needed (after extension update)
                try {
                    const { needsFullVerification } = await new Promise((resolve) => {
                        chrome.storage.local.get('needsFullVerification', resolve);
                    });

                    if (needsFullVerification) {
                        this.logger.info('🔄 [MIGRATION] Starting full database verification after update...');
                        const migrationResult = await this.verifyAllRecords();
                        this.logger.info('✅ [MIGRATION] Verification complete:', migrationResult);

                        // Clear the flag
                        chrome.storage.local.remove('needsFullVerification');
                    }
                } catch (err) {
                    this.logger.warn('⚠️ [MIGRATION] Full verification failed:', err);
                }

                // PHASE 6: Verify unverified records on every startup
                try {
                    const unverifiedResult = await this.verifyUnverifiedRecords();
                    if (unverifiedResult.total > 0) {
                        this.logger.info(`🔍 [STARTUP] Unverified check: ${unverifiedResult.verified} verified, ${unverifiedResult.deleted} deleted, ${unverifiedResult.stillUnverified} still unverified`);
                    }
                } catch (err) {
                    this.logger.warn('⚠️ [STARTUP] Unverified records check failed:', err);
                }

                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // Users table with compound indexes for fast searches
                if (!db.objectStoreNames.contains('users')) {
                    const userStore = db.createObjectStore('users', { keyPath: 'id' });
                    userStore.createIndex('name', 'name', { unique: false });
                    userStore.createIndex('lastSeen', 'lastSeen', { unique: false });
                    // Removed searchHistory index - not used in search logic

                    // New indexes for flags and timestamps
                    userStore.createIndex('isPinned', 'isPinned', { unique: false });
                    userStore.createIndex('isRecent', 'isRecent', { unique: false });
                    userStore.createIndex('lastOpenedTime', 'lastOpenedTime', { unique: false });
                    userStore.createIndex('pinnedAt', 'pinnedAt', { unique: false });

                    // Compound indexes for efficient queries
                    userStore.createIndex('pinned_lastOpened', ['isPinned', 'lastOpenedTime'], { unique: false });
                    userStore.createIndex('recent_lastOpened', ['isRecent', 'lastOpenedTime'], { unique: false });
                }

                // Remove keywords table if it exists (cleanup from previous version)
                if (db.objectStoreNames.contains('keywords')) {
                    db.deleteObjectStore('keywords');
                }

                // Stats table for metadata
                if (!db.objectStoreNames.contains('stats')) {
                    db.createObjectStore('stats', { keyPath: 'key' });
                }
            };
        });
    }

    // Load and cache stats from IndexedDB
    async loadStats() {
        if (!this.isReady) return;

        try {
            const tx = this.db.transaction(['stats'], 'readonly');
            const store = tx.objectStore('stats');
            const request = store.get('main');

            request.onsuccess = () => {
                if (request.result) {
                    this.stats = { ...this.stats, ...request.result.data };
                }
            };
        } catch (error) {
            this.logger.warn('⚠️ Failed to load stats from IndexedDB:', error);
        }
    }

    // Save stats to IndexedDB
    async saveStats() {
        if (!this.isReady) return;

        try {
            const tx = this.db.transaction(['stats'], 'readwrite');
            const store = tx.objectStore('stats');
            store.put({
                key: 'main',
                data: this.stats,
                lastUpdated: Date.now()
            });
        } catch (error) {
            this.logger.warn('⚠️ Failed to save stats to IndexedDB:', error);
        }
    }

    // Add user and channel profiles from search results (IndexedDB version)
    async addItemsFromSearch(searchTerm, items) {
        if (!this.isReady || !searchTerm || !items || !items.length) return [];

        // Track database add operation performance
        return await this.trackDatabaseOperation('addItemsFromSearch', async () => {
            return await this._addItemsFromSearchCore(searchTerm, items);
        });
    }

    // Core add implementation (extracted for performance tracking)
    async _addItemsFromSearchCore(searchTerm, items) {

        const addedItems = [];

        try {
            const tx = this.db.transaction(['users'], 'readwrite');
            const userStore = tx.objectStore('users');

            // Process each item
            for (const item of items) {
                if (!item.id) continue;

                // Handle both users and channels
                const isChannel = item.type === 'channel' || item.type === 'api_channel';

                // CRITICAL: Look up by channel_url first (primary key after migration)
                let existingUser = null;
                if (item.channel_url) {
                    existingUser = await new Promise(resolve => {
                        const getReq = userStore.get(item.channel_url);
                        getReq.onsuccess = () => resolve(getReq.result);
                        getReq.onerror = () => resolve(null);
                    });
                }

                // Fallback: Look up by numeric ID if not found by channel_url
                if (!existingUser && item.id) {
                    existingUser = await new Promise(resolve => {
                        const getReq = userStore.get(item.id);
                        getReq.onsuccess = () => resolve(getReq.result);
                        getReq.onerror = () => resolve(null);
                    });
                }

                // Prepare user data for storage, preserving existing interaction data
                const userData = {
                    // CRITICAL: Use channel_url as primary key (id field)
                    id: item.channel_url || item.id, // Fallback to numeric id if no channel_url (will be rejected)
                    userId: item.user_id || item.userId || null, // Store numeric user_id separately
                    originalId: item.id, // Keep original ID for reference
                    name: item.name || 'Unknown',
                    type: item.type || 'user',
                    email: item.email || null,
                    profile_url: item.profile_url || null,
                    profile_permalink: item.profile_permalink || null,
                    avatar: item.avatar || null,
                    job_title: item.job_title || null,
                    department_name: item.department_name || null,
                    location_name: item.location_name || null,
                    bio: item.bio || item.excerpt || null, // Store bio/excerpt for identification
                    channel_url: item.channel_url || null,
                    member_count: item.member_count || null,
                    is_distinct: item.is_distinct || false,
                    custom_type: item.custom_type || null,
                    dataSource: item.dataSource || 'unknown',
                    hasSharedConnection: item.hasSharedConnection || false,
                    hasDirectChat: item.hasDirectChat || false,
                    sharedChannels: item.sharedChannels || [],
                    lastSeen: Date.now(),
                    user_id: item.user_id || item.id,
                    // Preserve existing interaction data or set defaults
                    isPinned: existingUser?.isPinned || false,
                    isRecent: existingUser?.isRecent || false,
                    lastOpenedTime: existingUser?.lastOpenedTime || null,
                    pinnedAt: existingUser?.pinnedAt || null,
                    interactionCount: existingUser?.interactionCount || 0,
                    // Frequency-based interaction metrics (hybrid approach)
                    interactionMetrics: this.initializeInteractionMetrics(existingUser?.interactionMetrics),
                    // Store search keywords that found this user
                    searchKeywords: this.mergeSearchKeywords(existingUser?.searchKeywords, item.searchKeywords, searchTerm),
                    // Verification fields (schema fields)
                    isVerified: existingUser?.isVerified || false,
                    verifiedAt: existingUser?.verifiedAt || null,
                    verificationSource: existingUser?.verificationSource || null,
                    isUnverified: existingUser?.isUnverified || false,
                    unverificationReason: existingUser?.unverificationReason || null,
                    lastVerificationAttempt: existingUser?.lastVerificationAttempt || null,
                    verificationRetryCount: existingUser?.verificationRetryCount || 0
                };

                // PHASE 3A: Reject items without channel_url (enforcement)
                if (!userData.channel_url) {
                    this.logger.warn(`🚫 [STORAGE] Rejected item without channel_url: ${userData.name} (${userData.id})`);

                    // Track rejection for analytics
                    if (this.logger && typeof this.logger.analytics === 'function') {
                        this.logger.analytics('item_rejected_no_channel_url', {
                            item_id: userData.id,
                            item_name: userData.name,
                            item_type: userData.type,
                            search_term: searchTerm
                        });
                    }
                    continue; // Skip this item
                }

                // PHASE 3A: Verify record via Sendbird API before storage
                const verifyResult = await this.verifyRecordViaSendbird(userData);

                if (verifyResult.action === 'verify' || verifyResult.action === 'fix_and_verify') {
                    // Apply verification updates
                    Object.assign(userData, verifyResult.updates);
                    this.logger.debug(`✅ [STORAGE] Verified and storing: ${userData.name}`);
                } else if (verifyResult.action === 'delete') {
                    this.logger.warn(`🗑️ [STORAGE] Skipping invalid record: ${userData.name} (${verifyResult.reason})`);
                    continue; // Skip this item
                } else if (verifyResult.action === 'mark_unverified') {
                    // Apply unverified updates but still store (for pinned items)
                    Object.assign(userData, verifyResult.updates);
                    this.logger.warn(`⚠️ [STORAGE] Storing unverified record: ${userData.name}`);
                } else if (verifyResult.action === 'skip') {
                    // Verification skipped (Sendbird not ready, recently verified, etc.)
                    this.logger.debug(`⏭️ [STORAGE] Verification skipped: ${userData.name} (${verifyResult.reason})`);
                }

                // Store user data (now verified or marked unverified)
                const putUserReq = userStore.put(userData);
                await new Promise((resolve, reject) => {
                    putUserReq.onsuccess = () => resolve();
                    putUserReq.onerror = () => reject(putUserReq.error);
                });

                // CLEANUP: Remove name-based record if this is a proper ID record
                if (userData.id && !String(userData.id).startsWith('name_') && userData.name) {
                    const nameBasedId = `name_${userData.name.replace(/\s+/g, '')}`;
                    const deleteReq = userStore.delete(nameBasedId);
                    await new Promise(resolve => {
                        deleteReq.onsuccess = () => resolve();
                        deleteReq.onerror = () => resolve();
                    });
                }

                addedItems.push(userData);
            }

            // Update stats
            this.stats.totalSearches++;
            if (addedItems.length > 0) {
                await this.updateStats();
            }

        } catch (error) {
            this.logger.warn('⚠️ Failed to add items to IndexedDB:', error);
        }

        return addedItems;
    }

    // Normalize search term for matching
    normalizeSearchTerm(searchTerm) {
        return searchTerm.toLowerCase().trim();
    }

    // Smart local search using direct user matching with interaction-based ranking
    async searchItemsLocally(searchTerm, limit = 10) {
        if (!this.isReady || !searchTerm) return [];

        // Track database search operation performance
        return await this.trackDatabaseOperation('searchItemsLocally', async () => {
            return await this._searchItemsLocallyCore(searchTerm, limit);
        });
    }

    // Core search implementation (extracted for performance tracking)
    async _searchItemsLocallyCore(searchTerm, limit = 10) {

        const normalizedSearch = this.normalizeSearchTerm(searchTerm);
        const results = [];

        try {
            const tx = this.db.transaction(['users'], 'readonly');
            const userStore = tx.objectStore('users');

            // Get all users and filter/rank them
            const allUsers = await new Promise((resolve, reject) => {
                const users = [];
                const req = userStore.openCursor();

                req.onsuccess = (event) => {
                    const cursor = event.target.result;
                    if (cursor) {
                        users.push(cursor.value);
                        cursor.continue();
                    } else {
                        resolve(users);
                    }
                };
                req.onerror = () => reject(req.error);
            });

            // Filter and score users and channels
            const scoredItems = allUsers
                .map(item => {
                    let score = 0;
                    let matchReason = [];
                    const isChannel = item.type === 'channel' || item.type === 'api_channel';

                    // Name matching (highest priority)
                    if (item.name && item.name.toLowerCase().includes(normalizedSearch)) {
                        score += 100;
                        matchReason.push('name');
                    }

                    // Self-channel keyword matching
                    if (this.isSelfChannel(item)) {
                        const selfKeywords = ['me', 'self', 'myself', 'notes', 'personal'];
                        if (selfKeywords.some(keyword => normalizedSearch.includes(keyword))) {
                            score += 150; // Higher than regular name match
                            matchReason.push('self_channel_keyword');
                        }
                    }

                    if (!isChannel) {
                        // User-specific matching

                        // Email matching (high priority)
                        if (item.email && item.email.toLowerCase().includes(normalizedSearch)) {
                            score += 80;
                            matchReason.push('email');
                        }

                        // Bio matching (high priority for identification)
                        if (item.bio && item.bio.toLowerCase().includes(normalizedSearch)) {
                            score += 110; // Higher than name matching for identification
                            matchReason.push('bio');
                        }

                        // Job title matching
                        if (item.job_title && item.job_title.toLowerCase().includes(normalizedSearch)) {
                            score += 60;
                            matchReason.push('job_title');
                        }

                        // Department matching
                        if (item.department_name && item.department_name.toLowerCase().includes(normalizedSearch)) {
                            score += 40;
                            matchReason.push('department');
                        }

                        // Search keywords matching (for advanced search results)
                        if (item.searchKeywords && Array.isArray(item.searchKeywords)) {
                            const keywordMatch = item.searchKeywords.some(keyword =>
                                keyword.toLowerCase().includes(normalizedSearch) ||
                                normalizedSearch.includes(keyword.toLowerCase())
                            );
                            if (keywordMatch) {
                                score += 70; // High priority for keyword matches
                                matchReason.push('search_keywords');
                            }
                        }
                    } else {
                        // Channel-specific matching

                        // Channel URL matching
                        if (item.channel_url && item.channel_url.toLowerCase().includes(normalizedSearch)) {
                            score += 50;
                            matchReason.push('channel_url');
                        }
                    }

                    // Skip if no matches
                    if (score === 0) return null;

                    // Boost score based on interaction patterns
                    if (item.isPinned) score += 500; // Pinned items get huge boost
                    if (item.isRecent) score += 200; // Recent interactions boost
                    if (item.interactionCount > 0) score += Math.min(item.interactionCount * 10, 100); // Interaction frequency
                    if (item.lastOpenedTime) {
                        const daysSinceLastChat = (Date.now() - item.lastOpenedTime) / (1000 * 60 * 60 * 24);
                        if (daysSinceLastChat < 7) score += 50; // Recent chats boost
                    }

                    // FREQUENCY-BASED SCORING: Prioritize based on interaction patterns
                    if (item.interactionMetrics) {
                        const metrics = item.interactionMetrics;

                        // High frequency recent interactions (most important)
                        if (metrics.last7Days >= 5) {
                            score += 150; // Daily interactions - very high priority
                            matchReason.push('high_frequency_daily');
                        } else if (metrics.last7Days >= 3) {
                            score += 100; // Every other day - high priority
                            matchReason.push('high_frequency_regular');
                        } else if (metrics.last7Days >= 1) {
                            score += 50; // Weekly interactions - medium priority
                            matchReason.push('medium_frequency_weekly');
                        }

                        // Consistency bonus (regular interaction pattern)
                        if (metrics.avgDaysBetween && metrics.avgDaysBetween < 3) {
                            score += 75; // Very consistent interactions
                            matchReason.push('consistent_interactions');
                        } else if (metrics.avgDaysBetween && metrics.avgDaysBetween < 7) {
                            score += 50; // Moderately consistent
                            matchReason.push('regular_interactions');
                        }

                        // Recent activity boost (last 24 hours)
                        if (metrics.lastInteraction && (Date.now() - metrics.lastInteraction) < 24 * 60 * 60 * 1000) {
                            score += 100; // Very recent interaction
                            matchReason.push('very_recent_interaction');
                        }
                    }

                    // PRIORITY: Relationship-based scoring (shared connections > name matching)
                    if (!isChannel && item.type === 'user') {
                        let relationshipScore = 0;
                        let relationshipType = '';

                        // Calculate actual shared group count (excluding direct chat channel)
                        const totalChannels = (item.sharedChannels && Array.isArray(item.sharedChannels))
                            ? item.sharedChannels.length
                            : 0;
                        const actualSharedGroups = item.hasDirectChat ? totalChannels - 1 : totalChannels;

                        // Check for both direct chat AND shared groups (strongest relationship)
                        if (item.hasDirectChat && actualSharedGroups >= 5) {
                            relationshipScore = 600; // Highest priority: direct chat + many shared groups
                            relationshipType = `best_friend_${actualSharedGroups}_groups_plus_direct`;
                        } else if (item.hasDirectChat && actualSharedGroups >= 1) {
                            relationshipScore = 550; // High priority: direct chat + some shared groups
                            relationshipType = `close_friend_${actualSharedGroups}_groups_plus_direct`;
                        } else if (item.hasDirectChat) {
                            relationshipScore = 400; // Direct chat only
                            relationshipType = 'direct_chat_only';
                        } else if (actualSharedGroups >= 5) {
                            relationshipScore = 350; // Many shared groups but no direct chat
                            relationshipType = `colleague_${actualSharedGroups}_groups`;
                        } else if (actualSharedGroups >= 3) {
                            relationshipScore = 300; // Some shared groups
                            relationshipType = `colleague_${actualSharedGroups}_groups`;
                        } else if (actualSharedGroups >= 1) {
                            relationshipScore = 250; // Few shared groups
                            relationshipType = `acquaintance_${actualSharedGroups}_groups`;
                        } else if (item.hasSharedConnection) {
                            relationshipScore = 200; // Fallback for hasSharedConnection without details
                            relationshipType = 'shared_connection';
                        }

                        if (relationshipScore > 0) {
                            score += relationshipScore;
                            matchReason.push(relationshipType);
                        }
                    }

                    // CRITICAL ENHANCEMENT: Group name match prioritization
                    // When user types "CRM", they want CRM group chats (both "CRM" and "Flight x CRM")
                    if (isChannel && item.name) {
                        const itemNameLower = item.name.toLowerCase();

                        // Exact group name match gets massive boost
                        if (itemNameLower === normalizedSearch) {
                            score += 1000; // Highest boost for exact matches like "CRM"
                            matchReason.push('exact_group_name_match');
                            this.logger.debug(`🎯 EXACT GROUP MATCH BOOST: "${item.name}" gets +1000 priority boost (total: ${score})`);
                        }
                        // Group name contains search term as whole word gets significant boost
                        else if (itemNameLower.split(/\s+/).includes(normalizedSearch)) {
                            score += 900; // Massive boost to beat direct chat relationships (was 600, now 900)
                            matchReason.push('group_word_match');
                            this.logger.debug(`🎯 GROUP WORD MATCH BOOST: "${item.name}" gets +900 priority boost (total: ${score})`);
                        }
                    }

                    return {
                        ...item,
                        searchScore: score,
                        matchReason
                    };
                })
                .filter(item => item !== null)
                .sort((a, b) => b.searchScore - a.searchScore)
                .slice(0, limit);

            results.push(...scoredItems);

        } catch (error) {
            this.logger.warn('⚠️ Local search failed:', error);
        }

        return results;
    }

    // Update user profile when they open a chat (IndexedDB version)
    async updateUserProfile(userId, updates) {
        if (!this.isReady || !userId || !updates) return false;

        try {
            const tx = this.db.transaction(['users'], 'readwrite');
            const store = tx.objectStore('users');

            const getReq = store.get(userId);
            getReq.onsuccess = () => {
                const existingUser = getReq.result || {};
                const updatedUser = {
                    ...existingUser,
                    ...updates,
                    lastUpdated: Date.now()
                };

                // Handle explicit undefined values (to delete fields)
                // Spread operator doesn't include undefined values, so we need to explicitly delete them
                for (const key in updates) {
                    if (updates[key] === undefined) {
                        delete updatedUser[key];
                        this.logger.debug(`🗑️ Removing field "${key}" from user ${userId}`);
                    }
                }

                store.put(updatedUser);
            };

            return true;
        } catch (error) {
            this.logger.warn('⚠️ Failed to update user profile in IndexedDB:', error);
            return false;
        }
    }

    // Clean expired entries using IndexedDB indexes (MUCH more efficient!)
    async cleanExpiredEntries() {
        if (!this.isReady) return 0;

        const now = Date.now();
        let removedCount = 0;

        try {
            const tx = this.db.transaction(['users'], 'readwrite');
            const userStore = tx.objectStore('users');

            // Use lastSeen index to efficiently find expired users
            const lastSeenIndex = userStore.index('lastSeen');
            const expiredRange = IDBKeyRange.upperBound(now - this.ttl);

            const cursorReq = lastSeenIndex.openCursor(expiredRange);

            await new Promise((resolve) => {
                cursorReq.onsuccess = (event) => {
                    const cursor = event.target.result;
                    if (cursor) {
                        cursor.delete(); // Delete expired user
                        removedCount++;
                        cursor.continue();
                    } else {
                        resolve();
                    }
                };
            });

            await this.updateStats();

        } catch (error) {
            this.logger.warn('⚠️ Failed to clean expired entries:', error);
        }

        return removedCount;
    }


    // Get database statistics (IndexedDB version)
    async getStats() {
        if (!this.isReady) {
            return { error: 'Database not ready' };
        }

        try {
            // Count users from IndexedDB
            const userCount = await this.countRecords('users');

            // Get resource usage metrics (Phase 4)
            const resourceMetrics = await this.getResourceUsageMetrics();

            return {
                ...this.stats,
                totalUsers: userCount,
                isReady: this.isReady,
                databaseEngine: 'IndexedDB',
                ...resourceMetrics
            };
        } catch (error) {
            return { error: error.message };
        }
    }

    // Helper: Count records in a store
    async countRecords(storeName) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction([storeName], 'readonly');
            const store = tx.objectStore(storeName);
            const countReq = store.count();

            countReq.onsuccess = () => resolve(countReq.result);
            countReq.onerror = () => reject(countReq.error);
        });
    }

    // Update stats counters
    async updateStats() {
        try {
            this.stats.totalUsers = await this.countRecords('users');
            await this.saveStats();
        } catch (error) {
            this.logger.warn('⚠️ Failed to update stats:', error);
        }
    }

    // Get resource usage metrics (Phase 4 performance monitoring)
    async getResourceUsageMetrics() {
        try {
            const metrics = {
                database_size_estimate: 0,
                cache_efficiency: 0,
                memory_usage_snapshot: {},
                storage_quota_info: {},
                performance_metrics: {}
            };

            // Estimate database size
            const userCount = await this.countRecords('users');
            metrics.database_size_estimate = userCount * 2048; // Rough estimate: 2KB per user

            // Calculate cache efficiency (search hits vs API calls)
            if (this.stats.totalSearches > 0) {
                metrics.cache_efficiency = Math.round(
                    ((this.stats.totalSearches - (this.stats.apiCalls || 0)) / this.stats.totalSearches) * 100
                );
            }

            // Memory usage snapshot using performance API
            if (performance.memory) {
                metrics.memory_usage_snapshot = {
                    used_js_heap_size: performance.memory.usedJSHeapSize,
                    total_js_heap_size: performance.memory.totalJSHeapSize,
                    js_heap_size_limit: performance.memory.jsHeapSizeLimit,
                    memory_pressure: Math.round((performance.memory.usedJSHeapSize / performance.memory.jsHeapSizeLimit) * 100)
                };
            }

            // Storage quota information
            if ('storage' in navigator && 'estimate' in navigator.storage) {
                const estimate = await navigator.storage.estimate();
                metrics.storage_quota_info = {
                    quota: estimate.quota,
                    usage: estimate.usage,
                    usage_percentage: estimate.quota ? Math.round((estimate.usage / estimate.quota) * 100) : 0
                };
            }

            // Database performance metrics
            metrics.performance_metrics = {
                avg_search_time: this.calculateAverageSearchTime(),
                total_operations: this.stats.totalSearches || 0,
                error_rate: this.calculateErrorRate(),
                uptime: Date.now() - (this.initTime || Date.now())
            };

            // Track resource usage metrics to analytics
            if (this.logger && typeof this.logger.analytics === 'function') {
                this.logger.analytics('database_size_growth', {
                    user_count: userCount,
                    estimated_size_bytes: metrics.database_size_estimate,
                    timestamp: Date.now()
                });

                this.logger.analytics('cache_efficiency_metrics', {
                    cache_hit_rate: metrics.cache_efficiency,
                    total_searches: this.stats.totalSearches,
                    api_calls: this.stats.apiCalls || 0,
                    timestamp: Date.now()
                });

                if (metrics.memory_usage_snapshot.used_js_heap_size) {
                    this.logger.analytics('memory_usage_snapshot', {
                        used_heap_mb: Math.round(metrics.memory_usage_snapshot.used_js_heap_size / 1024 / 1024),
                        total_heap_mb: Math.round(metrics.memory_usage_snapshot.total_js_heap_size / 1024 / 1024),
                        memory_pressure_percent: metrics.memory_usage_snapshot.memory_pressure,
                        timestamp: Date.now()
                    });
                }
            }

            return metrics;

        } catch (error) {
            this.logger.warn('⚠️ Failed to get resource usage metrics:', error);
            return {
                database_size_estimate: 0,
                cache_efficiency: 0,
                memory_usage_snapshot: {},
                error: error.message
            };
        }
    }

    // Helper methods for performance metrics
    calculateAverageSearchTime() {
        // This would need to be tracked over time - for now return 0
        return 0;
    }

    calculateErrorRate() {
        // This would need error tracking - for now return 0
        return 0;
    }

    // Get user by ID (IndexedDB version)
    async getUser(userId) {
        if (!this.isReady || !userId) return null;

        return new Promise((resolve) => {
            const tx = this.db.transaction(['users'], 'readonly');
            const store = tx.objectStore('users');
            const req = store.get(userId);

            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => resolve(null);
        });
    }

    // Get chat by ID (alias for getUser for compatibility)
    async getChat(chatId) {
        if (!this.isReady || !chatId) return null;

        return new Promise((resolve) => {
            const tx = this.db.transaction(['users'], 'readonly');
            const store = tx.objectStore('users');
            const req = store.get(chatId);

            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => resolve(null);
        });
    }

    // Get chat by name (for instant channel detection)
    // IMPORTANT: Returns most authoritative record when duplicates exist
    async getChatByName(chatName) {
        if (!this.isReady || !chatName) return null;

        return new Promise((resolve) => {
            const tx = this.db.transaction(['users'], 'readonly');
            const store = tx.objectStore('users');
            const cursorReq = store.openCursor();

            const matches = [];

            cursorReq.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    const chat = cursor.value;
                    // Check if name matches (case-insensitive)
                    if (chat.name && chat.name.toLowerCase() === chatName.toLowerCase()) {
                        matches.push(chat);
                    }
                    cursor.continue();
                } else {
                    // All records scanned, now pick the best match
                    if (matches.length === 0) {
                        resolve(null);
                        return;
                    }

                    if (matches.length === 1) {
                        resolve(matches[0]);
                        return;
                    }

                    // Multiple matches - pick the most authoritative one
                    this.logger.warn(`⚠️ Found ${matches.length} duplicate records for "${chatName}", selecting best match`);

                    // Priority ranking (CORRECTED):
                    // 1. User type over channel type (MOST IMPORTANT - prefer DM over group)
                    // 2. Real Sendbird channel URL (starts with 'sendbird_')
                    // 3. Most recently updated

                    const sorted = matches.sort((a, b) => {
                        // Priority 1: User type over channel type (MOST IMPORTANT!)
                        if (a.type === 'user' && b.type !== 'user') return -1;
                        if (a.type !== 'user' && b.type === 'user') return 1;

                        // Priority 2: Real Sendbird ID over name-based ID
                        const aIsReal = a.id && String(a.id).startsWith('sendbird_');
                        const bIsReal = b.id && String(b.id).startsWith('sendbird_');
                        if (aIsReal && !bIsReal) return -1;
                        if (!aIsReal && bIsReal) return 1;

                        // Priority 3: Most recent update
                        const aTime = a.lastUpdated || a.lastOpenedTime || 0;
                        const bTime = b.lastUpdated || b.lastOpenedTime || 0;
                        return bTime - aTime; // Descending (newest first)
                    });

                    const selected = sorted[0];
                    this.logger.warn(`✅ Selected record with ID: ${selected.id}, type: ${selected.type}, updated: ${new Date(selected.lastUpdated || 0).toISOString()}`);
                    resolve(selected);
                }
            };

            cursorReq.onerror = () => resolve(null);
        });
    }

    // Get chat by channel URL (for finding DM users when you have the channel URL)
    // Useful for drafts where the key is a channel URL but we need the user's name
    async getChatByChannelUrl(channelUrl) {
        if (!this.isReady || !channelUrl) return null;

        return new Promise((resolve) => {
            const tx = this.db.transaction(['users'], 'readonly');
            const store = tx.objectStore('users');
            const cursorReq = store.openCursor();
            const matches = []; // Collect ALL matches instead of returning first

            cursorReq.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    const chat = cursor.value;
                    // Check if channel_url matches
                    if (chat.channel_url && chat.channel_url === channelUrl) {
                        matches.push(chat);
                    }
                    // Also check if ID is the channel URL (for group channels)
                    else if (chat.id === channelUrl) {
                        matches.push(chat);
                    }
                    cursor.continue();
                } else {
                    // Cursor finished - now prioritize matches
                    if (matches.length === 0) {
                        resolve(null);
                        return;
                    }

                    if (matches.length === 1) {
                        resolve(matches[0]);
                        return;
                    }

                    // Multiple matches - apply prioritization logic (same as cleanupDuplicates)
                    this.logger.warn(`⚠️ Found ${matches.length} records with channel_url "${channelUrl}"`);
                    this.logger.warn(`   Records: ${matches.map(m => `${m.id} (${m.name}, type: ${m.type})`).join(', ')}`);

                    const sorted = matches.sort((a, b) => {
                        // Priority 1: User type over channel type (MOST IMPORTANT!)
                        if (a.type === 'user' && b.type !== 'user') return -1;
                        if (a.type !== 'user' && b.type === 'user') return 1;

                        // Priority 2: Real Sendbird ID over name-based ID
                        const aIsReal = a.id && String(a.id).startsWith('sendbird_');
                        const bIsReal = b.id && String(b.id).startsWith('sendbird_');
                        if (aIsReal && !bIsReal) return -1;
                        if (!aIsReal && bIsReal) return 1;

                        // Priority 3: Most recent update
                        const aTime = a.lastUpdated || a.lastOpenedTime || 0;
                        const bTime = b.lastUpdated || b.lastOpenedTime || 0;
                        return bTime - aTime;
                    });

                    const bestMatch = sorted[0];
                    this.logger.warn(`✅ Returning best match: ${bestMatch.id} (${bestMatch.name}, type: ${bestMatch.type})`);
                    resolve(bestMatch);
                }
            };

            cursorReq.onerror = () => resolve(null);
        });
    }

    // Delete a chat by ID
    async deleteChat(chatId) {
        if (!this.isReady || !chatId) return false;

        return new Promise((resolve) => {
            const tx = this.db.transaction(['users'], 'readwrite');
            const store = tx.objectStore('users');
            const req = store.delete(chatId);

            req.onsuccess = () => {
                this.logger.debug(`🗑️ Deleted chat record: ${chatId}`);
                resolve(true);
            };
            req.onerror = () => {
                this.logger.warn(`⚠️ Failed to delete chat: ${chatId}`);
                resolve(false);
            };
        });
    }

    // Clear corrupted navigation and channel_url data from all records
    // These fields were prone to race conditions and are not needed for navigation
    async clearCorruptedNavigationData() {
        if (!this.isReady) return { updated: 0 };

        try {
            const allChats = await this.getAllChats();
            let updated = 0;

            const tx = this.db.transaction(['users'], 'readwrite');
            const store = tx.objectStore('users');

            for (const chat of allChats) {
                let needsUpdate = false;

                // Remove navigation field (prone to race conditions)
                if (chat.navigation) {
                    delete chat.navigation;
                    needsUpdate = true;
                }

                // Remove channel_url if it doesn't match the ID
                // (corrupted channel_urls from race conditions)
                if (chat.channel_url && chat.id !== chat.channel_url) {
                    // Keep channel_url only if the ID is the actual Sendbird channel URL
                    if (!chat.id.startsWith('sendbird_')) {
                        delete chat.channel_url;
                        needsUpdate = true;
                    }
                }

                if (needsUpdate) {
                    store.put(chat);
                    updated++;
                }
            }

            await new Promise((resolve, reject) => {
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            });

            this.logger.info(`🧹 Cleared corrupted navigation data from ${updated} records`);
            return { updated };
        } catch (error) {
            this.logger.error('❌ Failed to clear navigation data:', error);
            return { updated: 0, error: error.message };
        }
    }

    // Cleanup duplicate records with same name
    // Keeps the most authoritative record and deletes duplicates
    async cleanupDuplicates() {
        if (!this.isReady) return { removed: 0, kept: 0 };

        try {
            const allChats = await this.getAllChats();
            const nameMap = new Map(); // name -> array of records

            // Group records by name
            for (const chat of allChats) {
                // Handle self-channels with empty names
                let key;
                if (!chat.name || chat.name.trim() === '') {
                    if (this.isSelfChannel(chat)) {
                        // Use channel_url as unique key for self-channels
                        key = `__self_channel__${chat.channel_url}`;
                    } else {
                        continue; // Skip other empty-name records
                    }
                } else {
                    key = chat.name.toLowerCase().trim();
                }

                if (!nameMap.has(key)) {
                    nameMap.set(key, []);
                }
                nameMap.get(key).push(chat);
            }

            // Find and merge duplicates
            let removed = 0;
            let kept = 0;

            for (const [name, records] of nameMap.entries()) {
                if (records.length <= 1) continue; // No duplicates

                this.logger.warn(`🔍 Found ${records.length} duplicate records for "${records[0].name}"`);

                // Sort records by priority
                // CRITICAL: User type is ALWAYS preferred, regardless of ID type
                const sorted = records.sort((a, b) => {
                    // Priority 1: User type over channel type (MOST IMPORTANT!)
                    if (a.type === 'user' && b.type !== 'user') return -1;
                    if (a.type !== 'user' && b.type === 'user') return 1;

                    // Priority 2: Real Sendbird ID over name-based ID
                    const aIsReal = a.id && String(a.id).startsWith('sendbird_');
                    const bIsReal = b.id && String(b.id).startsWith('sendbird_');
                    if (aIsReal && !bIsReal) return -1;
                    if (!aIsReal && bIsReal) return 1;

                    // Priority 3: Most recent update
                    const aTime = a.lastUpdated || a.lastOpenedTime || 0;
                    const bTime = b.lastUpdated || b.lastOpenedTime || 0;
                    return bTime - aTime;
                });

                const keeper = sorted[0];
                const toDelete = sorted.slice(1);

                this.logger.warn(`✅ Keeping record: ${keeper.id} (type: ${keeper.type})`);

                // Merge data from duplicates into keeper
                for (const dup of toDelete) {
                    // Preserve isPinned flag if any duplicate was pinned
                    if (dup.isPinned && !keeper.isPinned) {
                        keeper.isPinned = true;
                        keeper.pinnedAt = dup.pinnedAt || keeper.pinnedAt;
                    }

                    // Preserve highest interaction count
                    if (dup.interactionCount > (keeper.interactionCount || 0)) {
                        keeper.interactionCount = dup.interactionCount;
                    }

                    // Delete the duplicate
                    await this.deleteChat(dup.id);
                    this.logger.warn(`🗑️ Deleted duplicate: ${dup.id} (type: ${dup.type})`);
                    removed++;
                }

                // Update the keeper with merged data
                await this.recordChatInteraction(keeper);
                kept++;
            }

            this.logger.info(`🧹 Name-based cleanup complete: Removed ${removed} duplicates, kept ${kept} unique records`);

            // PHASE 2: Cleanup duplicate channel_url records
            // After name-based cleanup, we may still have duplicates with same channel_url
            // (e.g., one user-type record and one group-type record with same channel_url)
            this.logger.info('🔍 Starting channel_url-based cleanup...');

            const remainingChats = await this.getAllChats();
            const channelUrlMap = new Map(); // channel_url -> array of records

            // Group records by channel_url
            for (const chat of remainingChats) {
                if (!chat.channel_url) continue; // Skip records without channel_url
                const key = chat.channel_url.toLowerCase().trim();
                if (!channelUrlMap.has(key)) {
                    channelUrlMap.set(key, []);
                }
                channelUrlMap.get(key).push(chat);
            }

            // Find and merge channel_url duplicates
            let removedByChannelUrl = 0;
            let keptByChannelUrl = 0;

            for (const [channelUrl, records] of channelUrlMap.entries()) {
                if (records.length <= 1) continue; // No duplicates

                this.logger.warn(`🔍 Found ${records.length} duplicate records for channel_url "${channelUrl}"`);
                this.logger.warn(`   Records: ${records.map(r => `${r.id} (${r.name}, type: ${r.type})`).join(', ')}`);

                // Use SAME prioritization logic as name-based cleanup
                // CRITICAL: User type is ALWAYS preferred, regardless of ID type
                const sorted = records.sort((a, b) => {
                    // Priority 1: User type over channel type (MOST IMPORTANT!)
                    if (a.type === 'user' && b.type !== 'user') return -1;
                    if (a.type !== 'user' && b.type === 'user') return 1;

                    // Priority 2: Real Sendbird ID over name-based ID
                    const aIsReal = a.id && String(a.id).startsWith('sendbird_');
                    const bIsReal = b.id && String(b.id).startsWith('sendbird_');
                    if (aIsReal && !bIsReal) return -1;
                    if (!aIsReal && bIsReal) return 1;

                    // Priority 3: Most recent update
                    const aTime = a.lastUpdated || a.lastOpenedTime || 0;
                    const bTime = b.lastUpdated || b.lastOpenedTime || 0;
                    return bTime - aTime;
                });

                const keeper = sorted[0];
                const toDelete = sorted.slice(1);

                this.logger.warn(`✅ Keeping record: ${keeper.id} (name: "${keeper.name}", type: ${keeper.type})`);

                // Merge data from duplicates into keeper
                for (const dup of toDelete) {
                    // Preserve isPinned flag if any duplicate was pinned
                    if (dup.isPinned && !keeper.isPinned) {
                        keeper.isPinned = true;
                        keeper.pinnedAt = dup.pinnedAt || keeper.pinnedAt;
                    }

                    // Preserve highest interaction count
                    if (dup.interactionCount > (keeper.interactionCount || 0)) {
                        keeper.interactionCount = dup.interactionCount;
                    }

                    // Delete the duplicate
                    await this.deleteChat(dup.id);
                    this.logger.warn(`🗑️ Deleted duplicate: ${dup.id} (name: "${dup.name}", type: ${dup.type})`);
                    removedByChannelUrl++;
                }

                // Update the keeper with merged data
                await this.recordChatInteraction(keeper);
                keptByChannelUrl++;
            }

            this.logger.info(`🧹 channel_url-based cleanup complete: Removed ${removedByChannelUrl} duplicates, kept ${keptByChannelUrl} unique records`);
            this.logger.info(`🎯 Total cleanup: Removed ${removed + removedByChannelUrl} duplicates, kept ${kept + keptByChannelUrl} unique records`);

            return {
                removed: removed + removedByChannelUrl,
                kept: kept + keptByChannelUrl,
                removedByName: removed,
                removedByChannelUrl,
                keptByName: kept,
                keptByChannelUrl
            };

        } catch (error) {
            this.logger.error('❌ Failed to cleanup duplicates:', error);
            return { removed: 0, kept: 0, error: error.message };
        }
    }

    /**
     * Run cleanup if enough time has passed since last cleanup
     * This prevents cleanup from running too frequently but ensures duplicates get cleaned periodically
     * Uses requestIdleCallback to run during browser idle time, avoiding UI operations
     * @param {number} minIntervalMs - Minimum time between cleanups (default: 60 seconds)
     */
    async maybeRunCleanup(minIntervalMs = 60000) {
        // CRITICAL: Never run cleanup during UI operations (panel opens, animations)
        if (this.uiOperationsInProgress > 0) {
            return { skipped: true, reason: 'UI operation in progress' };
        }

        const now = Date.now();
        const timeSinceLastCleanup = now - this.lastCleanupTime;

        if (timeSinceLastCleanup < minIntervalMs) {
            return { skipped: true, reason: `Last cleanup was ${Math.round(timeSinceLastCleanup / 1000)}s ago` };
        }

        // Use requestIdleCallback if available for better timing
        const runCleanup = async () => {
            this.lastCleanupTime = now;
            const result = await this.cleanupDuplicates();
            return result;
        };

        if (typeof requestIdleCallback !== 'undefined') {
            return new Promise(resolve => {
                requestIdleCallback(async () => {
                    const result = await runCleanup();
                    resolve(result);
                });
            });
        } else {
            return await runCleanup();
        }
    }

    // Get all chats (for fallback search)
    async getAllChats() {
        if (!this.isReady) return [];

        return new Promise((resolve) => {
            const tx = this.db.transaction(['users'], 'readonly');
            const store = tx.objectStore('users');
            const req = store.getAll();

            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => resolve([]);
        });
    }

    // Check if we have good local coverage for a search term
    async hasGoodCoverage(searchTerm) {
        if (!this.isReady || !searchTerm) return false;

        try {
            // Quick local search to see if we have relevant matches
            const localResults = await this.searchItemsLocally(searchTerm, 5);

            if (localResults.length === 0) {
                return false; // No results = no coverage
            }

            // Enhanced coverage validation: ensure results are actually relevant
            const searchTermLower = searchTerm.toLowerCase().trim();
            const relevantResults = localResults.filter(result => {
                const nameLower = (result.name || '').toLowerCase();
                const emailLower = (result.email || '').toLowerCase();

                // Check if the search term actually appears in name or email
                // This prevents "jo" results being used for "john" searches
                return nameLower.includes(searchTermLower) ||
                       emailLower.includes(searchTermLower);
            });

            // We have good coverage if:
            // 1. We have at least 7 RELEVANT results (very strict), OR
            // 2. We have an EXACT match (name starts with search term AND score >= 200)
            // This forces fresh API calls for most searches
            const topResult = relevantResults[0];
            const isExactMatch = topResult &&
                                (topResult.name || '').toLowerCase().startsWith(searchTermLower) &&
                                topResult.searchScore >= 200;

            const hasGoodCoverage = relevantResults.length >= 7 || isExactMatch;

            this.logger.debug(`🔍 Coverage analysis for "${searchTerm}":`, {
                totalResults: localResults.length,
                relevantResults: relevantResults.length,
                hasGoodCoverage,
                isExactMatch,
                topRelevantMatch: relevantResults[0]?.name || 'none',
                topScore: relevantResults[0]?.searchScore || 0
            });

            return hasGoodCoverage;
        } catch (error) {
            this.logger.warn('⚠️ Coverage check failed:', error);
            return false;
        }
    }

    // Record chat interaction (every time a chat is opened)
    async recordChatInteraction(chatData) {
        if (!this.isReady) return;

        // Track database chat interaction recording performance
        return await this.trackDatabaseOperation('recordChatInteraction', async () => {
            return await this._recordChatInteractionCore(chatData);
        });
    }

    // Core chat interaction recording implementation (extracted for performance tracking)
    async _recordChatInteractionCore(chatData) {

        const now = Date.now();

        // CRITICAL: Warn if record is being saved from DOM extraction (race condition risk)
        if (chatData.source !== 'api_metadata') {
            this.logger.warn(`⚠️ [RACE-RISK] Saving record from DOM extraction (not API):`, {
                name: chatData.name,
                channel_url: chatData.channel_url,
                source: chatData.source || 'unknown',
                stack: new Error().stack.split('\n').slice(1, 4).join('\n')
            });
        }

        // Validate chatData integrity - detect and reject bad data
        if (chatData.name && chatData.id) {
            const idStr = String(chatData.id);

            // VALIDATION 1: Group Channel Records - id MUST equal channel_url
            if (idStr.startsWith('sendbird_group_channel_')) {
                // REJECT: If channel_url exists but doesn't match id (corruption!)
                if (chatData.channel_url && chatData.channel_url !== chatData.id) {
                    console.error(`🚨 [recordChatInteraction] CHANNEL CORRUPTION DETECTED!`);
                    console.error(`   ID: ${chatData.id}`);
                    console.error(`   channel_url: ${chatData.channel_url}`);
                    console.error(`   Name: ${chatData.name}`);
                    console.error(`   Stack:`, new Error().stack.split('\n').slice(1, 5));
                    return; // REJECT corrupted data
                }

                // Auto-fix: If id is channel URL but channel_url missing, set it
                if (!chatData.channel_url) {
                    chatData.channel_url = chatData.id;
                    this.logger.debug(`🔧 Auto-fixed missing channel_url for group channel: ${chatData.name}`);
                }
            }

            // VALIDATION 2: User (DM) Records - channel_url should match sharedChannels DM
            else if (chatData.type === 'user' && chatData.channel_url) {
                const userId = chatData.userId || chatData.id;

                // Strategy 1: Validate against sharedChannels (most reliable)
                if (chatData.sharedChannels && Array.isArray(chatData.sharedChannels) && chatData.sharedChannels.length > 0) {
                    const directChat = chatData.sharedChannels.find(ch =>
                        ch.member_count === 2 && ch.is_distinct === true
                    );

                    if (directChat && directChat.channel_url && chatData.channel_url !== directChat.channel_url) {
                        console.error(`🚨 [recordChatInteraction] USER CORRUPTION DETECTED!`);
                        console.error(`   userId: ${userId}`);
                        console.error(`   channel_url (provided): ${chatData.channel_url}`);
                        console.error(`   channel_url (correct from sharedChannels): ${directChat.channel_url}`);
                        console.error(`   Name: ${chatData.name}`);
                        console.error(`   Stack:`, new Error().stack.split('\n').slice(1, 5));
                        return; // REJECT corrupted data
                    }
                }
                // Strategy 2: No fallback validation - Sendbird channel URLs don't necessarily contain user IDs
                // If we don't have sharedChannels data, we accept the channel_url as-is
                // The previous validation (checking if userId is in channel_url) was too strict and rejected valid DMs
            }

            // REJECT: Name-based ID mismatch (data corruption)
            // Only validate name-based IDs (name_XXX), not numeric user IDs or sendbird channel URLs
            const nameFromId = idStr.replace('name_', '').replace(/([A-Z])/g, ' $1').trim();
            const normalizedName = chatData.name.replace(/\s+/g, '').replace('-', '');
            const normalizedIdName = nameFromId.replace(/\s+/g, '').replace('-', '');

            if (idStr.startsWith('name_') && normalizedName !== normalizedIdName) {
                console.error(`🚨 [recordChatInteraction] DATA CORRUPTION DETECTED! name="${chatData.name}" but id="${chatData.id}"`);
                console.error(`🚨 [recordChatInteraction] Rejecting corrupted data`);
                return; // Don't save corrupted data
            }
        }

        // SPECIAL HANDLING: NoName/Frankenstein groups
        // These are groups (is_distinct !== true) with empty names or comma-separated member names
        // Keep the original name from sidebar but flag as NoName group
        if (this.isNoNameGroup(chatData)) {
            this.logger.log(`⚠️ [recordChatInteraction] Detected NoName group (Frankenstein group from DM)`);
            this.logger.log(`   name: [REDACTED]`);
            this.logger.log(`   channel_url: ${chatData.channel_url || 'missing'}`);
            this.logger.log(`   is_distinct: ${chatData.is_distinct}`);
            this.logger.log(`   Storing with original name but flagged as NoName group`);
            this.logger.log(`   Will be deleted on next startup`);

            // Track NoName group detection
            if (this.logger && typeof this.logger.analytics === 'function') {
                this.logger.analytics('noname_group_detected', {
                    chat_type: chatData.type,
                    value_type: chatData.channel_url ? 'has_channel_url' : 'missing_channel_url',
                    setting_name: 'is_distinct',
                    new_value: String(chatData.is_distinct)
                });
            }

            // Flag as NoName group (keep original name for consistency)
            chatData.isNoNameGroup = true;
            chatData.type = 'channel'; // It's a group channel
        }

        try {
            const tx = this.db.transaction(['users'], 'readwrite');
            const store = tx.objectStore('users');

            // IMPORTANT: Check if ANY record already exists for this name OR channel_url to prevent duplicates
            // This prevents duplicates from recents/pinning, handleChannelChange, race conditions, etc.
            const idStr = String(chatData.id || '');
            const shouldCheckDuplicates = chatData.name && (
                (chatData.id && idStr.startsWith('sendbird_')) || // Sendbird channel URLs
                (chatData.userId && !idStr.startsWith('name_'))    // Numeric user IDs (not name-based)
            );

            if (shouldCheckDuplicates) {
                // Get all chats within THIS transaction to prevent race conditions
                const allChatsReq = store.getAll();
                const allChats = await new Promise(resolve => {
                    allChatsReq.onsuccess = () => resolve(allChatsReq.result || []);
                    allChatsReq.onerror = () => resolve([]);
                });

                // PRIORITY 1: Find by channel_url (most reliable)
                let existingRecord = null;
                if (chatData.channel_url) {
                    existingRecord = allChats.find(chat =>
                        chat.channel_url === chatData.channel_url &&
                        chat.id !== chatData.id
                    );
                }

                // PRIORITY 2: Find by name if no channel_url match
                if (!existingRecord) {
                    existingRecord = allChats.find(chat => chat.name === chatData.name && chat.userId)
                                    || allChats.find(chat => chat.name === chatData.name);
                }

                if (existingRecord) {
                    chatData.id = existingRecord.id;
                    chatData.userId = existingRecord.userId || chatData.userId;
                    chatData.type = existingRecord.type || chatData.type;

                    // IMPORTANT: Also use existing channel_url if it exists
                    // This prevents creating duplicates with same name but different channel_urls
                    if (existingRecord.channel_url && !chatData.channel_url) {
                        chatData.channel_url = existingRecord.channel_url;
                    }

                    // Preserve custom_type from existing record
                    chatData.custom_type = existingRecord.custom_type || chatData.custom_type;
                }

                // ADDITIONAL CHECK: Look for existing record with same channel_url
                // This handles cases where name might differ slightly but channel_url is identical
                if (chatData.channel_url) {
                    const existingByChannelUrl = allChats.find(chat =>
                        chat.channel_url === chatData.channel_url && chat.id !== chatData.id
                    );

                    if (existingByChannelUrl) {
                        // Apply same prioritization logic as cleanupDuplicates
                        // Prefer user-type records over channel-type records
                        if (existingByChannelUrl.type === 'user' && chatData.type !== 'user') {
                            // Existing record is user type, prefer it
                            this.logger.warn(`⚠️ Reusing existing user-type record for channel_url ${chatData.channel_url}`);
                            chatData.id = existingByChannelUrl.id;
                            chatData.userId = existingByChannelUrl.userId || chatData.userId;
                            chatData.type = existingByChannelUrl.type;
                            // Also preserve custom_type from existing record
                            chatData.custom_type = existingByChannelUrl.custom_type || chatData.custom_type;
                        }
                        // Otherwise keep chatData as-is (it might be user-type or more recent)
                    }
                }
            }

            // Get existing chat data - CRITICAL: Look up by channel_url first (primary key after migration)
            let existingChat = null;
            if (chatData.channel_url) {
                existingChat = await new Promise(resolve => {
                    const getReq = store.get(chatData.channel_url);
                    getReq.onsuccess = () => resolve(getReq.result);
                    getReq.onerror = () => resolve(null);
                });
            }

            // Fallback: Look up by chatData.id if not found by channel_url
            if (!existingChat && chatData.id) {
                existingChat = await new Promise(resolve => {
                    const getReq = store.get(chatData.id);
                    getReq.onsuccess = () => resolve(getReq.result);
                    getReq.onerror = () => resolve(null);
                });
            }

            // CLEANUP: If this is a proper ID (not name-based), check for name-based record and merge
            if (chatData.id && !String(chatData.id).startsWith('name_') && chatData.name) {
                const nameBasedId = `name_${chatData.name.replace(/\s+/g, '')}`;
                const nameBasedRecord = await new Promise(resolve => {
                    const getReq = store.get(nameBasedId);
                    getReq.onsuccess = () => resolve(getReq.result);
                    getReq.onerror = () => resolve(null);
                });

                if (nameBasedRecord && nameBasedRecord.id !== chatData.id) {
                    this.logger.debug(`🧹 Found name-based record ${nameBasedId}, merging into ${chatData.id}`);

                    // Merge name-based record data into existing record
                    existingChat = {
                        ...nameBasedRecord,
                        ...existingChat, // Prefer proper ID record if it exists
                        interactionCount: (nameBasedRecord.interactionCount || 0) + (existingChat?.interactionCount || 0),
                    };

                    // Delete name-based record
                    const deleteReq = store.delete(nameBasedId);
                    await new Promise(resolve => {
                        deleteReq.onsuccess = () => resolve();
                        deleteReq.onerror = () => resolve();
                    });
                }
            }

            // Debug: Log existing record and FULL call stack to find the real caller
            const stackLines = new Error().stack.split('\n');
            // Skip first 3 lines (Error, _recordChatInteractionCore, recordChatInteraction wrapper)
            const realCallers = stackLines.slice(3, 6).map(line => line.trim());

            if (existingChat) {
            } else {
            }

            // Prevent rapid duplicate recordings (within 2 seconds)
            if (existingChat?.lastOpenedTime && (now - existingChat.lastOpenedTime) < 2000) {
                this.logger.debug(`⏭️ Skipping duplicate chat interaction for ${chatData.name} (too recent: ${now - existingChat.lastOpenedTime}ms)`);
                return;
            }

            // Check if record is verified (frozen)
            const isVerified = existingChat?.isVerified || false;

            const updatedChat = {
                // Preserve existing data
                ...existingChat,

                // Update with new/current data
                // CRITICAL FIX: If verified, FREEZE core identity fields
                // Use channel_url as primary key (id field)
                id: isVerified ? existingChat.id : (chatData.channel_url || existingChat?.id || chatData.id),
                originalId: existingChat?.originalId || chatData.id, // Preserve original numeric ID
                name: isVerified ? existingChat.name : chatData.name,
                // Avatar is NEVER frozen - it's a signed URL with expiry
                avatar: chatData.avatar,

                // Update interaction tracking
                lastOpenedTime: now,
                lastSeen: now,
                lastVisited: chatData.lastVisited || now,
                interactionCount: (existingChat?.interactionCount || 0) + 1,
                interactionMetrics: this.updateInteractionMetrics(existingChat?.interactionMetrics, now),

                // Preserve flags
                isPinned: existingChat?.isPinned || false,
                isRecent: true,
                pinnedAt: existingChat?.pinnedAt || null,
                isNoNameGroup: chatData.isNoNameGroup || existingChat?.isNoNameGroup || false,

                // Store both user_id and channel_url as separate fields (not as ID)
                // CRITICAL FIX: If verified, FREEZE userId and channel_url
                userId: isVerified ? existingChat.userId : this.getValidUserId(chatData.userId, existingChat?.userId),
                channel_url: isVerified ? existingChat.channel_url : this.getVerifiedChannelUrl(chatData, existingChat),

                // Preserve existing is_distinct if new data doesn't have one (prevents overwrites from DOM interactions)
                is_distinct: chatData.is_distinct !== undefined ? chatData.is_distinct : existingChat?.is_distinct,
                // Preserve custom_type for self-channels and other special channel types
                custom_type: chatData.custom_type || existingChat?.custom_type || null,

                // Verification status
                isVerified: chatData.isVerified || existingChat?.isVerified || false,
                verifiedAt: chatData.verifiedAt || existingChat?.verifiedAt || null,
                verificationSource: chatData.verificationSource || existingChat?.verificationSource || null,

                // Metadata
                lastUpdated: now
            };

            // Determine type based on final merged userId value (AFTER merging)
            // CRITICAL FIX: Always determine type from userId, don't trust incoming or existing type
            // Type can be wrong from DOM extraction or initial storage without userId
            const finalUserId = updatedChat.userId;
            updatedChat.type = finalUserId ? 'user' : 'channel';

            // PHASE 3B: Reject if no channel_url (enforcement)
            if (!updatedChat.channel_url) {
                this.logger.error(`🚨 [INTERACTION] Cannot save: no channel_url for ${chatData.name} (${chatData.id})`);

                // Track rejection for analytics
                if (this.logger && typeof this.logger.analytics === 'function') {
                    this.logger.analytics('interaction_rejected_no_channel_url', {
                        chat_id: chatData.id,
                        chat_name: chatData.name,
                        chat_type: chatData.type
                    });
                }
                return; // Reject - don't save
            }

            // PHASE 3B: Verify record via Sendbird API if not already verified
            if (!updatedChat.isVerified || !updatedChat.verifiedAt) {
                const verifyResult = await this.verifyRecordViaSendbird(updatedChat);

                if (verifyResult.action === 'verify' || verifyResult.action === 'fix_and_verify') {
                    // Apply verification updates
                    Object.assign(updatedChat, verifyResult.updates);
                    this.logger.debug(`✅ [INTERACTION] Verified: ${updatedChat.name}`);
                } else if (verifyResult.action === 'delete') {
                    this.logger.warn(`🗑️ [INTERACTION] Cannot save invalid record: ${updatedChat.name} (${verifyResult.reason})`);
                    return; // Don't save invalid record
                } else if (verifyResult.action === 'mark_unverified') {
                    // Apply unverified updates but still store (for pinned items)
                    Object.assign(updatedChat, verifyResult.updates);
                    this.logger.warn(`⚠️ [INTERACTION] Saving unverified record: ${updatedChat.name}`);
                } else if (verifyResult.action === 'skip') {
                    // Verification skipped (recently verified, Sendbird not ready, etc.)
                    this.logger.debug(`⏭️ [INTERACTION] Verification skipped: ${updatedChat.name} (${verifyResult.reason})`);
                }
            }

            // Ensure verification fields exist (schema compatibility)
            updatedChat.isUnverified = updatedChat.isUnverified || false;
            updatedChat.unverificationReason = updatedChat.unverificationReason || null;
            updatedChat.lastVerificationAttempt = updatedChat.lastVerificationAttempt || null;
            updatedChat.verificationRetryCount = updatedChat.verificationRetryCount || 0;

            // Debug: Log what we're about to save

            // Store the interaction (now verified or marked unverified)
            const putReq = store.put(updatedChat);
            await new Promise((resolve, reject) => {
                putReq.onsuccess = () => resolve();
                putReq.onerror = () => reject(putReq.error);
            });

            this.logger.debug(`📊 Recorded chat interaction: ${chatData.name} (ID: ${chatData.id})`);

            // Fetch complete user data if this is a user and we don't have email
            if (chatData.userId && (!existingChat?.email || !existingChat?.job_title)) {
                this.logger.debug(`🔍 Fetching complete user data for: ${chatData.name}`);
                await this.fetchAndStoreUserData(chatData.userId, chatData.name);
            }

            // FRANKENSTEIN DETECTION: For NoName groups with name-based IDs, trigger recovery
            // Name-based IDs mean we couldn't find the real channel_url yet
            const hasNameBasedId = String(updatedChat.id || '').startsWith('name_');
            if (updatedChat.isNoNameGroup === true && hasNameBasedId) {
                this.logger.debug(`🔍 Triggering Frankenstein recovery for: ${updatedChat.name}`);
                // Attempt recovery (will call APIs and update record if successful)
                await this.detectAndRecoverFrankensteinGroup(updatedChat);
            }

        } catch (error) {
            this.logger.warn('⚠️ Failed to record chat interaction:', error);
        }
    }

    // Initialize interaction metrics for frequency-based scoring
    initializeInteractionMetrics(existingMetrics) {
        const now = Date.now();
        const defaultMetrics = {
            last7Days: 0,           // Count of interactions in last 7 days
            last30Days: 0,          // Count of interactions in last 30 days
            lastInteraction: null,  // Timestamp of last interaction
            avgDaysBetween: null,   // Average days between interactions
            lastUpdated: now        // When these metrics were last calculated
        };

        // If no existing metrics, return defaults
        if (!existingMetrics) {
            return defaultMetrics;
        }

        // Return existing metrics (will be updated when interactions occur)
        return {
            ...defaultMetrics,
            ...existingMetrics,
            lastUpdated: existingMetrics.lastUpdated || now
        };
    }

    // Update interaction metrics when a chat interaction occurs
    updateInteractionMetrics(existingMetrics, interactionTime) {
        const now = interactionTime || Date.now();
        const sevenDaysAgo = now - (7 * 24 * 60 * 60 * 1000);
        const thirtyDaysAgo = now - (30 * 24 * 60 * 60 * 1000);

        // Initialize if no existing metrics
        if (!existingMetrics) {
            return {
                last7Days: 1,
                last30Days: 1,
                lastInteraction: now,
                avgDaysBetween: null,
                lastUpdated: now,
                interactionHistory: [now] // Keep last 10 interactions for avg calculation
            };
        }

        // Get interaction history for average calculation
        const history = existingMetrics.interactionHistory || [];
        const newHistory = [...history, now].slice(-10); // Keep only last 10 interactions

        // Calculate average days between interactions
        let avgDaysBetween = null;
        if (newHistory.length >= 2) {
            const intervals = [];
            for (let i = 1; i < newHistory.length; i++) {
                const daysDiff = (newHistory[i] - newHistory[i-1]) / (24 * 60 * 60 * 1000);
                intervals.push(daysDiff);
            }
            avgDaysBetween = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        }

        // Count recent interactions (decay old counts, add new one)
        const existingLast7Days = this.decayInteractionCount(existingMetrics.last7Days, existingMetrics.lastUpdated, now, 7);
        const existingLast30Days = this.decayInteractionCount(existingMetrics.last30Days, existingMetrics.lastUpdated, now, 30);

        return {
            last7Days: existingLast7Days + 1,
            last30Days: existingLast30Days + 1,
            lastInteraction: now,
            avgDaysBetween: avgDaysBetween,
            lastUpdated: now,
            interactionHistory: newHistory
        };
    }

    // Decay interaction counts based on time elapsed (approximate decay)
    decayInteractionCount(currentCount, lastUpdated, now, windowDays) {
        if (!lastUpdated || !currentCount) return 0;

        const timeSinceUpdate = now - lastUpdated;
        const windowMs = windowDays * 24 * 60 * 60 * 1000;

        // If more than the window period has passed, reset to 0
        if (timeSinceUpdate >= windowMs) {
            return 0;
        }

        // Simple linear decay - could be more sophisticated
        const decayRatio = Math.max(0, 1 - (timeSinceUpdate / windowMs));
        return Math.floor(currentCount * decayRatio);
    }

    /**
     * Get valid userId - validates that userId is NOT a channel URL
     * CRITICAL FIX: Prevents corruption where channel URLs get stored as userId
     *
     * @param {string} newUserId - New userId from chatData
     * @param {string} existingUserId - Existing userId from database
     * @returns {string|null} Valid userId or null
     */
    getValidUserId(newUserId, existingUserId) {
        // Helper: Check if value is a sendbird channel URL
        const isChannelUrl = (value) => {
            return value && String(value).startsWith('sendbird_');
        };

        // RULE 1: If new userId is a channel URL, reject it
        if (isChannelUrl(newUserId)) {
            this.logger.warn(`⚠️ [VALIDATE] Rejecting userId (is channel URL): ${newUserId}`);
            newUserId = null;
        }

        // RULE 2: If existing userId is a channel URL, clear it
        if (isChannelUrl(existingUserId)) {
            this.logger.warn(`⚠️ [VALIDATE] Clearing corrupted userId (is channel URL): ${existingUserId}`);
            existingUserId = null;
        }

        // RULE 3: Prefer new valid userId, fallback to existing valid userId
        return newUserId || existingUserId || null;
    }

    /**
     * Get verified channel_url with freezing logic
     * IMPORTANT: Once channel_url is verified and set, it's FROZEN (never changes)
     * Priority: existingChat.channel_url (frozen) > validated chatData.channel_url > navigation fallback
     *
     * @param {Object} chatData - New chat data being recorded
     * @param {Object} existingChat - Existing chat record from DB
     * @returns {string|null} The verified channel_url or null
     */
    getVerifiedChannelUrl(chatData, existingChat) {
        // RULE 1: If existing record has channel_url, FREEZE it (never change)
        if (existingChat?.channel_url) {
            this.logger.debug(`🔒 [FREEZE] Using existing frozen channel_url: ${existingChat.channel_url}`);
            return existingChat.channel_url;
        }

        // RULE 2: For new records, validate before setting
        const idStr = String(chatData.id || '');

        // Group channels: channel_url must equal id
        if (idStr.startsWith('sendbird_group_channel_')) {
            const verified = chatData.channel_url || chatData.id;
            if (verified) {
                this.logger.debug(`✅ [VERIFY] Group channel verified: ${verified}`);
            }
            return verified;
        }

        // User DMs: Try to find from sharedChannels first (most reliable)
        if (chatData.type === 'user' && chatData.sharedChannels && Array.isArray(chatData.sharedChannels) && chatData.sharedChannels.length > 0) {
            // Try to find DM with member_count validation first (most reliable)
            let directChat = chatData.sharedChannels.find(ch =>
                ch.member_count === 2 && ch.is_distinct === true
            );

            // FALLBACK: If member_count is missing (backward compatibility), use is_distinct alone
            if (!directChat) {
                directChat = chatData.sharedChannels.find(ch =>
                    ch.is_distinct === true && ch.member_count === undefined
                );
                if (directChat) {
                    this.logger.debug(`⚠️ [VERIFY] Using is_distinct fallback (member_count missing)`);
                }
            }

            if (directChat && directChat.channel_url) {
                this.logger.debug(`✅ [VERIFY] User DM verified from sharedChannels: ${directChat.channel_url}`);
                return directChat.channel_url;
            }
        }

        // Fallback: Use provided channel_url or navigation fallback
        const fallback = chatData.channel_url || chatData.navigation?.channelUrl || null;
        if (fallback) {
            this.logger.debug(`⚠️ [FALLBACK] Using fallback channel_url: ${fallback}`);
        }
        return fallback;
    }

    /**
     * Check if this is a group channel (not a DM)
     * @param {Object} chat - Chat record to check
     * @returns {boolean} True if group, false if DM
     */
    isGroup(chat) {
        return chat.is_distinct !== true;
    }

    /**
     * Check if this is a NoName/Frankenstein group
     * - Group channel (is_distinct !== true)
     * - Empty or missing name OR comma-separated member names (fake name)
     * @param {Object} chat - Chat record to check
     * @returns {boolean} True if NoName group
     */
    isNoNameGroup(chat) {
        // Must be a group (not a DM)
        if (chat.is_distinct === true) return false;

        // Pattern 1: Empty or missing name
        if (!chat.name || chat.name.trim() === '') return true;

        // Pattern 2: Name looks like comma-separated member list
        // These are generated by the extension when group has no actual name
        // Examples: "Siddharth Jain, Vijayaraghavan Krishnamurthy -"
        //           "John Doe, Jane Smith, Bob Wilson"
        const name = chat.name.trim();

        // Check if name contains comma (member list pattern)
        if (name.includes(',')) {
            // Additional checks to avoid false positives:
            // - Name ends with " -" (truncated member list)
            // - Name has 2+ commas (3+ members)
            // - Name-based ID (starts with 'name_')
            const endsWithDash = name.endsWith(' -') || name.endsWith('-');
            const hasMultipleCommas = (name.match(/,/g) || []).length >= 1;
            const hasNameBasedId = String(chat.id || '').startsWith('name_');

            if ((endsWithDash || hasMultipleCommas) && hasNameBasedId) {
                return true;
            }
        }

        return false;
    }

    /**
     * Check if this is a self-channel (chat with yourself / notes)
     * @param {Object} chat - Chat record to check
     * @returns {boolean} True if self-channel
     */
    isSelfChannel(chat) {
        return chat.custom_type === 'self_channel' &&
               chat.is_distinct === true &&
               chat.member_count === 1;
    }

    /**
     * Get display name for self-channel
     * @param {Object} channelData - Channel data from API
     * @returns {Promise<string>} Display name for self-channel
     */
    async getSelfChannelDisplayName(channelData) {
        // Strategy 1: Use current user's name from UserIdentityManager
        if (this.app?.userIdentityManager) {
            try {
                const currentUser = await this.app.userIdentityManager.getCurrentUser();
                if (currentUser?.name || currentUser?.nickname) {
                    const userName = currentUser.name || currentUser.nickname;
                    return `${userName} (Notes)`;
                }
            } catch (err) {
                this.logger.warn('Failed to get current user for self-channel name:', err);
            }
        }

        // Strategy 2: Extract from channel members
        if (channelData.members && channelData.members.length === 1) {
            const member = channelData.members[0];
            const memberName = member.nickname || member.name;
            if (memberName) {
                return `${memberName} (Notes)`;
            }
        }

        // Strategy 3: Generic fallback
        return 'Me (Notes)';
    }

    // Helper method to merge search keywords
    mergeSearchKeywords(existingKeywords, newKeywords, currentSearchTerm) {
        const keywordSet = new Set();

        // Add existing keywords
        if (existingKeywords && Array.isArray(existingKeywords)) {
            existingKeywords.forEach(kw => keywordSet.add(kw.toLowerCase()));
        }

        // Add new keywords from API response
        if (newKeywords && Array.isArray(newKeywords)) {
            newKeywords.forEach(kw => keywordSet.add(kw.toLowerCase()));
        }

        // Always add current search term
        if (currentSearchTerm) {
            keywordSet.add(currentSearchTerm.toLowerCase());
        }

        return Array.from(keywordSet);
    }

    /**
     * Detect and recover Frankenstein group when API returns empty results
     * @param {Object} chatData - The chat record with comma-separated member names
     * @returns {Promise<boolean>} True if recovery successful
     */
    async detectAndRecoverFrankensteinGroup(chatData) {
        try {
            this.logger.log(`🔍 [FRANKENSTEIN] Attempting recovery for: [REDACTED]`);
            this.logger.log(`   type: ${chatData.type}, id: ${chatData.id}`);

            // Split name by comma to get first person's name
            const memberNames = chatData.name.split(',').map(n => n.trim());
            if (memberNames.length === 0) {
                this.logger.log(`❌ [FRANKENSTEIN] No member names found in record`);
                return false;
            }

            const firstMemberName = memberNames[0];
            this.logger.log(`   Searching /members for first member in group`);

            // Call /members endpoint with first member's name
            const membersResponse = await WVFavs.APIManager.getChannelMembers(firstMemberName);

            if (!membersResponse?.channels || membersResponse.channels.length === 0) {
                this.logger.log(`❌ [FRANKENSTEIN] No channels found in /members`);
                return false;
            }

            // Find group with no name and is_distinct === false
            const frankensteinGroup = membersResponse.channels.find(ch =>
                (!ch.name || ch.name.trim() === '') && ch.is_distinct === false
            );

            if (!frankensteinGroup) {
                this.logger.log(`❌ [FRANKENSTEIN] No NoName group found in /members results`);
                return false;
            }

            this.logger.log(`✅ [FRANKENSTEIN] Found NoName group!`);
            this.logger.log(`   channel_url: ${frankensteinGroup.channel_url}`);
            this.logger.log(`   member_count: ${frankensteinGroup.member_count}`);
            this.logger.log(`   is_distinct: ${frankensteinGroup.is_distinct}`);

            // Update the record with correct channel_url and flag
            const tx = this.db.transaction(['users'], 'readwrite');
            const store = tx.objectStore('users');

            const getReq = store.get(chatData.id);
            await new Promise((resolve, reject) => {
                getReq.onsuccess = async () => {
                    const chat = getReq.result;
                    if (!chat) {
                        this.logger.log(`❌ [FRANKENSTEIN] Chat record not found: ${chatData.id}`);
                        reject(new Error('Chat not found'));
                        return;
                    }

                    // Update with recovered channel_url
                    chat.channel_url = frankensteinGroup.channel_url;
                    chat.isNoNameGroup = true;
                    chat.type = 'channel';
                    chat.is_distinct = false;
                    chat.lastUpdated = Date.now();

                    const putReq = store.put(chat);
                    putReq.onsuccess = () => {
                        this.logger.log(`✅ [FRANKENSTEIN] Updated record with channel_url: ${frankensteinGroup.channel_url}`);
                        resolve();
                    };
                    putReq.onerror = () => reject(putReq.error);
                };
                getReq.onerror = () => reject(getReq.error);
            });

            await new Promise((resolve, reject) => {
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            });

            // Cleanup zombie user records (exclude the Frankenstein record itself)
            await this.cleanupZombieUserRecords(frankensteinGroup.channel_url, chatData.id);

            this.logger.log(`✅ [FRANKENSTEIN] Recovery complete`);

            // Track successful Frankenstein recovery
            if (this.logger && typeof this.logger.analytics === 'function') {
                this.logger.analytics('frankenstein_recovery', {
                    operation_status: 'success',
                    setting_name: 'member_count',
                    new_value: String(frankensteinGroup.member_count),
                    value_type: 'has_channel_url'
                });
            }

            return true;

        } catch (error) {
            console.error(`❌ [FRANKENSTEIN] Recovery failed:`, error);

            // Track failed Frankenstein recovery
            if (this.logger && typeof this.logger.analytics === 'function') {
                this.logger.analytics('frankenstein_recovery', {
                    operation_status: 'failure',
                    error_type: error.message || 'unknown',
                    error_message: String(error)
                });
            }

            return false;
        }
    }

    /**
     * Cleanup zombie user records containing the Frankenstein group's channel_url
     * @param {string} frankensteinChannelUrl - The channel_url of the Frankenstein group
     * @param {string} excludeRecordId - The ID of the Frankenstein record to exclude from cleanup
     */
    async cleanupZombieUserRecords(frankensteinChannelUrl, excludeRecordId) {
        try {
            this.logger.log(`🧹 [ZOMBIE CLEANUP] Searching for records with channel_url: ${frankensteinChannelUrl}`);
            this.logger.log(`   Excluding Frankenstein record: ${excludeRecordId}`);

            const allChats = await this.getAllChats();
            const tx = this.db.transaction(['users'], 'readwrite');
            const store = tx.objectStore('users');
            let cleanedCount = 0;

            for (const chat of allChats) {
                // Skip the Frankenstein record itself
                if (chat.id === excludeRecordId) {
                    this.logger.log(`⏭️ [ZOMBIE] Skipping Frankenstein record: [REDACTED] (ID: ${chat.id})`);
                    continue;
                }

                let needsUpdate = false;
                let cleanupActions = [];

                // Check 1: Main channel_url key
                if (chat.channel_url === frankensteinChannelUrl) {
                    this.logger.log(`🧹 [ZOMBIE] Found Frankenstein channel_url in record:`);
                    this.logger.log(`   Record Name: [REDACTED]`);
                    this.logger.log(`   Record ID: ${chat.id}`);
                    this.logger.log(`   Record Type: ${chat.type}`);
                    this.logger.log(`   userId: ${chat.userId || 'none'}`);
                    this.logger.log(`   Action: Setting channel_url to null`);

                    chat.channel_url = null;
                    cleanupActions.push('Cleared channel_url');
                    needsUpdate = true;
                }

                // Check 2: sharedChannels array
                if (chat.sharedChannels && Array.isArray(chat.sharedChannels)) {
                    const originalLength = chat.sharedChannels.length;
                    const removedChannels = chat.sharedChannels.filter(ch =>
                        ch.channel_url === frankensteinChannelUrl
                    );

                    chat.sharedChannels = chat.sharedChannels.filter(ch =>
                        ch.channel_url !== frankensteinChannelUrl
                    );

                    if (chat.sharedChannels.length < originalLength) {
                        this.logger.log(`🧹 [ZOMBIE] Found Frankenstein channel in sharedChannels array:`);
                        this.logger.log(`   Record Name: [REDACTED]`);
                        this.logger.log(`   Record ID: ${chat.id}`);
                        this.logger.log(`   Record Type: ${chat.type}`);
                        this.logger.log(`   userId: ${chat.userId || 'none'}`);
                        this.logger.log(`   Removed ${removedChannels.length} channel(s) from sharedChannels`);
                        this.logger.log(`   Removed channels:`, removedChannels.map(ch => `name=[REDACTED], is_distinct=${ch.is_distinct}`));

                        cleanupActions.push(`Removed ${removedChannels.length} item(s) from sharedChannels`);
                        needsUpdate = true;
                    }
                }

                // Update if modified
                if (needsUpdate) {
                    chat.lastUpdated = Date.now();
                    await new Promise((resolve, reject) => {
                        const putReq = store.put(chat);
                        putReq.onsuccess = () => resolve();
                        putReq.onerror = () => reject(putReq.error);
                    });
                    cleanedCount++;
                    this.logger.log(`✅ [ZOMBIE] Cleaned record [REDACTED]: ${cleanupActions.join(', ')}`);
                }
            }

            await new Promise((resolve, reject) => {
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            });

            this.logger.log(`✅ [ZOMBIE CLEANUP] Complete: Cleaned ${cleanedCount} zombie records`);

            // Track zombie cleanup completion
            if (this.logger && typeof this.logger.analytics === 'function') {
                this.logger.analytics('zombie_cleanup', {
                    operation_status: 'success',
                    setting_name: 'cleaned_count',
                    new_value: String(cleanedCount),
                    value_type: cleanedCount > 0 ? 'had_zombies' : 'no_zombies'
                });
            }

        } catch (error) {
            console.error(`❌ [ZOMBIE CLEANUP] Failed:`, error);

            // Track zombie cleanup failure
            if (this.logger && typeof this.logger.analytics === 'function') {
                this.logger.analytics('zombie_cleanup', {
                    operation_status: 'failure',
                    error_type: error.message || 'unknown',
                    error_message: String(error)
                });
            }
        }
    }

    // Fetch complete user data from API and store it
    async fetchAndStoreUserData(userId, userName) {
        try {
            // Use comprehensive search to get complete user data
            const searchResults = await WVFavs.APIManager.comprehensiveSearch(userName);

            if (searchResults?.users?.length > 0) {
                // Find the user by ID
                const userData = searchResults.users.find(user => user.id === userId || user.user_id === userId);

                if (userData) {
                    // Store the complete user data
                    await this.addItemsFromSearch(userName, [userData]);
                    this.logger.debug(`✅ Fetched and stored complete data for: ${userName}`);
                } else {
                    this.logger.debug(`⚠️ User ${userName} not found in search results`);
                }
            }
        } catch (error) {
            this.logger.warn(`❌ Failed to fetch user data for ${userName}:`, error.message);
        }
    }

    /**
     * Fetch and verify channel data from API when a chat is opened
     * This provides authoritative data that gets frozen once verified
     *
     * @param {string} channelUrl - The sendbird channel URL
     */
    async fetchAndVerifyChannelData(channelUrl) {
        if (!channelUrl || !this.isReady) return;

        try {
            this.logger.log(`🔍 [VERIFY] Fetching authoritative data for channel: ${channelUrl}`);

            // CRITICAL FIX: Use Sendbird API via APIManager instead of WorkVivo search endpoint
            // WorkVivo search endpoint (/api/chat/search/channels/members) is for SEARCH, not channel lookup!
            const channelData = await this.app.APIManager.getChannelInfo(channelUrl);

            if (!channelData || !channelData.channel_url) {
                this.logger.warn(`⚠️ [VERIFY] No channel data returned from Sendbird API`);
                return;
            }

            this.logger.log(`✅ [VERIFY] Got channel data from Sendbird API:`, {
                channel_url: channelData.channel_url,
                name: channelData.name,
                member_count: channelData.member_count,
                is_distinct: channelData.is_distinct,
                members: channelData.members?.length || 0
            });

            // Prepare verified record
            const verifiedRecord = {
                id: channelData.channel_url, // Use channel_url as ID for channels
                name: channelData.name || 'Unknown Channel',
                channel_url: channelData.channel_url,
                member_count: channelData.member_count,
                is_distinct: channelData.is_distinct,
                custom_type: channelData.custom_type || null,

                // For DMs (is_distinct === true), extract userId
                userId: null,
                type: 'channel', // Default, will be updated based on userId

                // Verification metadata
                isVerified: true,
                verifiedAt: Date.now(),
                verificationSource: 'sendbird_api_via_manager',

                // Interaction data
                lastSeen: Date.now(),
                lastOpenedTime: Date.now()
            };

            // If it's a DM (is_distinct === true), extract the other user's data
            if (channelData.is_distinct === true && channelData.members?.length > 0) {
                // Get current user ID
                const currentUserId = window.WVFavsExtension?.userIdentity?.currentUser?.id;

                // Find the other user (not the current user)
                const otherUser = channelData.members.find(member =>
                    member.user_id !== currentUserId && member.user_id !== null
                );

                if (otherUser) {
                    verifiedRecord.userId = otherUser.user_id;
                    verifiedRecord.type = 'user';
                    verifiedRecord.name = otherUser.nickname || otherUser.name || verifiedRecord.name;
                    verifiedRecord.avatar = otherUser.profile_url || otherUser.avatar || null;

                    this.logger.log(`✅ [VERIFY] DM detected - userId: ${otherUser.user_id}, name: ${verifiedRecord.name}`);
                }
            }

            // Store the verified record
            const tx = this.db.transaction(['users'], 'readwrite');
            const store = tx.objectStore('users');

            // Get existing record to preserve interaction history
            const getReq = store.get(verifiedRecord.id);
            await new Promise((resolve, reject) => {
                getReq.onsuccess = () => {
                    const existingRecord = getReq.result;

                    if (existingRecord) {
                        // Merge with existing record, preserving interaction data
                        verifiedRecord.isPinned = existingRecord.isPinned || false;
                        verifiedRecord.pinnedAt = existingRecord.pinnedAt || null;
                        verifiedRecord.interactionCount = existingRecord.interactionCount || 0;
                        verifiedRecord.interactionMetrics = existingRecord.interactionMetrics || null;

                        this.logger.log(`📝 [VERIFY] Updating existing record with verified data`);
                    } else {
                        this.logger.log(`📝 [VERIFY] Creating new verified record`);
                    }

                    const putReq = store.put(verifiedRecord);
                    putReq.onsuccess = () => {
                        this.logger.log(`✅ [VERIFY] Record verified and frozen: ${verifiedRecord.name}`);
                        resolve();
                    };
                    putReq.onerror = () => reject(putReq.error);
                };
                getReq.onerror = () => reject(getReq.error);
            });

        } catch (error) {
            this.logger.warn(`❌ [VERIFY] Failed to fetch and verify channel data:`, error.message);
        }
    }

    /**
     * Verify record against Sendbird API
     * Uses dynamically captured Sendbird base URL to verify channel integrity
     * @param {Object} record - Database record to verify
     * @returns {Promise<Object>} Verification result with action and updates
     */
    async verifyRecordViaSendbird(record) {
        // Skip if no channel_url (will be rejected elsewhere)
        if (!record.channel_url) {
            return { action: 'skip', reason: 'no_channel_url' };
        }

        // Skip if already verified recently (within 24 hours)
        if (record.isVerified && record.verifiedAt) {
            const hoursSinceVerification = (Date.now() - record.verifiedAt) / (1000 * 60 * 60);
            if (hoursSinceVerification < 24) {
                return { action: 'skip', reason: 'recently_verified' };
            }
        }

        try {
            const baseUrl = window.__wvSendbirdBaseUrl;
            if (!baseUrl) {
                this.logger.debug('[VERIFY] Sendbird base URL not yet captured, skipping verification');
                return { action: 'skip', reason: 'sendbird_not_initialized' };
            }

            // Call Sendbird API with full channel details
            const url = `${baseUrl}/v3/group_channels/${encodeURIComponent(record.channel_url)}?show_member=true&show_read_receipt=true&show_delivery_receipt=true&show_latest_message=false`;

            this.logger.debug(`[VERIFY] Verifying record: ${record.name} (${record.channel_url})`);

            const response = await WVFavs.APIManager.makeSendbirdAPIRequest(url);

            if (!response) {
                throw new Error('Sendbird API returned null');
            }

            // Run verification checks
            return await this.runVerificationChecks(record, response);

        } catch (error) {
            this.logger.warn(`[VERIFY] Verification failed for ${record.name}:`, error.message);

            // Handle 404 - channel not found
            if (error.message && error.message.includes('404')) {
                if (record.isPinned) {
                    return {
                        action: 'mark_unverified',
                        updates: {
                            isUnverified: true,
                            unverificationReason: 'Channel not found (404)',
                            lastVerificationAttempt: Date.now(),
                            verificationRetryCount: (record.verificationRetryCount || 0) + 1
                        }
                    };
                } else {
                    return { action: 'delete', reason: 'channel_not_found' };
                }
            }

            // Network error or other issue - retry later
            if (record.isPinned) {
                return {
                    action: 'mark_unverified',
                    updates: {
                        isUnverified: true,
                        unverificationReason: `Network error: ${error.message}`,
                        lastVerificationAttempt: Date.now(),
                        verificationRetryCount: (record.verificationRetryCount || 0) + 1
                    }
                };
            } else {
                return { action: 'delete', reason: 'verification_failed' };
            }
        }
    }

    /**
     * Run verification checks against Sendbird API response
     * @param {Object} record - Database record
     * @param {Object} sendbirdData - Sendbird API response
     * @returns {Promise<Object>} Verification result
     */
    async runVerificationChecks(record, sendbirdData) {
        const checks = {
            channelUrlMatch: record.channel_url === sendbirdData.channel_url,
            nameMatch: record.name === sendbirdData.name,
            typeMatch: null,
            membershipValid: false,
            isDistinctMatch: record.is_distinct === sendbirdData.is_distinct
        };

        // User-type verification
        if (record.type === 'user' && record.userId) {
            const memberIds = sendbirdData.members?.map(m => m.user_id) || [];
            checks.membershipValid = memberIds.includes(record.userId);
            checks.typeMatch = sendbirdData.is_distinct === true && sendbirdData.member_count === 2;

            // Verify name matches member nickname
            const member = sendbirdData.members?.find(m => m.user_id === record.userId);
            if (member) {
                checks.nameMatch = record.name === member.nickname;
            }
        }

        // Group-type verification
        if (record.type === 'channel') {
            checks.typeMatch = sendbirdData.is_distinct === false;
        }

        this.logger.debug('[VERIFY] Checks:', checks);

        // Decision tree: All checks pass
        if (checks.channelUrlMatch && checks.nameMatch && checks.typeMatch && (checks.membershipValid || record.type === 'channel')) {
            this.logger.info(`✅ [VERIFY] Record verified: ${record.name}`);
            return {
                action: 'verify',
                updates: {
                    isVerified: true,
                    verifiedAt: Date.now(),
                    verificationSource: 'sendbird_api',
                    isUnverified: false,
                    unverificationReason: null
                }
            };
        }

        // Channel URL mismatch - critical error
        if (!checks.channelUrlMatch) {
            this.logger.error(`🚨 [VERIFY] Channel URL mismatch for ${record.name}`);
            if (record.isPinned) {
                return {
                    action: 'mark_unverified',
                    updates: {
                        isUnverified: true,
                        unverificationReason: 'Channel URL mismatch',
                        lastVerificationAttempt: Date.now()
                    }
                };
            } else {
                return { action: 'delete', reason: 'channel_url_mismatch' };
            }
        }

        // Fixable mismatches - update and verify
        if (checks.channelUrlMatch && (!checks.nameMatch || !checks.typeMatch || !checks.isDistinctMatch)) {
            this.logger.warn(`⚠️ [VERIFY] Fixing mismatched data for ${record.name}`);

            // Extract correct name based on channel type
            let correctName = sendbirdData.name;
            let correctUserId = record.userId;
            let correctAvatar = record.avatar;

            // For 1:1 DMs, extract the OTHER member's data
            if (sendbirdData.is_distinct === true && sendbirdData.member_count === 2 && sendbirdData.members?.length > 0) {
                const currentUserId = window.WVFavsExtension?.userIdentity?.currentUser?.id;
                const otherMember = sendbirdData.members.find(m =>
                    m.user_id !== currentUserId && m.user_id !== null
                );

                if (otherMember) {
                    correctName = otherMember.nickname || otherMember.name || correctName;
                    correctUserId = otherMember.user_id;
                    correctAvatar = otherMember.profile_url || correctAvatar;
                    this.logger.info(`🔧 [VERIFY] Extracted DM name from other member: ${correctName}`);
                }
            }
            // For groups, use channel name (not member names)
            else if (sendbirdData.is_distinct === false) {
                correctName = sendbirdData.name;
                this.logger.info(`🔧 [VERIFY] Using group channel name: ${correctName}`);
            }

            const updates = {
                name: correctName,
                userId: correctUserId,
                avatar: correctAvatar,
                is_distinct: sendbirdData.is_distinct,
                member_count: sendbirdData.member_count,
                custom_type: sendbirdData.custom_type,
                isVerified: true,
                verifiedAt: Date.now(),
                verificationSource: 'sendbird_api_fixed',
                isUnverified: false,
                unverificationReason: null
            };

            // Fix type if needed
            if (!checks.typeMatch) {
                updates.type = sendbirdData.is_distinct ? 'user' : 'channel';
                this.logger.warn(`🔧 [VERIFY] Corrected type: ${record.type} → ${updates.type}`);
            }

            this.logger.warn(`🔧 [VERIFY] Fixed data - Name: ${record.name} → ${correctName}, Type: ${record.type} → ${updates.type}`);

            return {
                action: 'fix_and_verify',
                updates: updates
            };
        }

        // Membership invalid for user-type
        if (record.type === 'user' && !checks.membershipValid) {
            this.logger.error(`🚨 [VERIFY] User ${record.userId} not in channel members`);
            if (record.isPinned) {
                return {
                    action: 'mark_unverified',
                    updates: {
                        isUnverified: true,
                        unverificationReason: 'User not in channel members',
                        lastVerificationAttempt: Date.now()
                    }
                };
            } else {
                return { action: 'delete', reason: 'membership_invalid' };
            }
        }

        // Fallback - shouldn't reach here
        return {
            action: 'mark_unverified',
            updates: {
                isUnverified: true,
                unverificationReason: 'Unknown verification failure',
                lastVerificationAttempt: Date.now()
            }
        };
    }

    /**
     * CRITICAL MIGRATION: Change primary key from numeric ID to channel_url
     * This ensures channel_url is the single source of truth
     * @returns {Promise<Object>} Migration results
     */
    async migrateToChannelUrlAsPrimaryKey() {
        if (!this.isReady) return { migrated: 0, deleted: 0, skipped: 0 };

        this.logger.info('🔄 [SCHEMA-MIGRATION] Changing primary key to channel_url...');

        const results = {
            migrated: 0,
            deleted: 0,
            skipped: 0,
            total: 0
        };

        try {
            const tx = this.db.transaction(['users'], 'readwrite');
            const store = tx.objectStore('users');

            // Get ALL records
            const allRecords = await new Promise((resolve) => {
                const getAllReq = store.getAll();
                getAllReq.onsuccess = () => resolve(getAllReq.result || []);
                getAllReq.onerror = () => resolve([]);
            });

            results.total = allRecords.length;
            this.logger.info(`[SCHEMA-MIGRATION] Found ${results.total} records to migrate`);

            for (const oldRecord of allRecords) {
                try {
                    const oldId = oldRecord.id;

                    // Skip if no channel_url
                    if (!oldRecord.channel_url) {
                        if (!oldRecord.isPinned) {
                            // Delete records without channel_url
                            await new Promise((resolve) => {
                                const deleteReq = store.delete(oldId);
                                deleteReq.onsuccess = () => resolve();
                                deleteReq.onerror = () => resolve();
                            });
                            results.deleted++;
                            this.logger.warn(`[SCHEMA-MIGRATION] ❌ Deleted (no channel_url): ${oldRecord.name}`);
                        } else {
                            results.skipped++;
                            this.logger.warn(`[SCHEMA-MIGRATION] ⏭️ Skipped pinned without channel_url: ${oldRecord.name}`);
                        }
                        continue;
                    }

                    // Check if already using channel_url as id
                    if (oldId === oldRecord.channel_url) {
                        results.skipped++;
                        this.logger.debug(`[SCHEMA-MIGRATION] ⏭️ Already migrated: ${oldRecord.name}`);
                        continue;
                    }

                    // Create new record with channel_url as primary key
                    const newRecord = {
                        ...oldRecord,
                        id: oldRecord.channel_url, // channel_url becomes the primary key
                        userId: oldRecord.userId || null, // Preserve userId in separate field
                        originalId: oldId // Keep old ID for reference
                    };

                    // Delete old record
                    await new Promise((resolve) => {
                        const deleteReq = store.delete(oldId);
                        deleteReq.onsuccess = () => resolve();
                        deleteReq.onerror = () => resolve();
                    });

                    // Add new record with channel_url as id
                    await new Promise((resolve, reject) => {
                        const addReq = store.put(newRecord);
                        addReq.onsuccess = () => resolve();
                        addReq.onerror = () => reject(addReq.error);
                    });

                    results.migrated++;
                    this.logger.debug(`[SCHEMA-MIGRATION] ✅ Migrated: ${oldRecord.name} (${oldId} → ${oldRecord.channel_url})`);

                } catch (error) {
                    this.logger.error(`[SCHEMA-MIGRATION] Failed to migrate ${oldRecord.name}:`, error);
                    results.skipped++;
                }
            }

            this.logger.info('✅ [SCHEMA-MIGRATION] Primary key migration complete:', results);

        } catch (error) {
            this.logger.error('[SCHEMA-MIGRATION] Migration failed:', error);
        }

        return results;
    }

    /**
     * PHASE 6: Verify all records in database (migration on version update)
     * @returns {Promise<Object>} Migration results with counts
     */
    async verifyAllRecords() {
        if (!this.isReady) return { verified: 0, fixed: 0, deleted: 0, unverified: 0, skipped: 0 };

        this.logger.info('🔄 [MIGRATION] Starting full database verification...');

        const results = {
            verified: 0,
            fixed: 0,
            deleted: 0,
            unverified: 0,
            skipped: 0,
            total: 0
        };

        try {
            const allRecords = await this.getAllChats();
            results.total = allRecords.length;

            this.logger.info(`[MIGRATION] Found ${results.total} records to verify`);

            // Process in batches of 10 with 2s delay to avoid rate limiting
            const batchSize = 10;
            for (let i = 0; i < allRecords.length; i += batchSize) {
                const batch = allRecords.slice(i, i + batchSize);

                this.logger.debug(`[MIGRATION] Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(allRecords.length / batchSize)}`);

                await Promise.all(batch.map(async (record) => {
                    try {
                        // Delete if no channel_url and not pinned
                        if (!record.channel_url && !record.isPinned) {
                            await this.deleteChat(record.id);
                            results.deleted++;
                            this.logger.debug(`[MIGRATION] ❌ Deleted: ${record.name} (no channel_url)`);
                            return;
                        }

                        // Skip if no channel_url but pinned (mark for manual review)
                        if (!record.channel_url && record.isPinned) {
                            results.skipped++;
                            this.logger.warn(`[MIGRATION] ⏭️ Skipped pinned record without channel_url: ${record.name}`);
                            return;
                        }

                        // Verify via Sendbird API
                        const verifyResult = await this.verifyRecordViaSendbird(record);

                        if (verifyResult.action === 'verify') {
                            results.verified++;
                            // Apply updates
                            await this.recordChatInteraction({
                                ...record,
                                ...verifyResult.updates
                            });
                            this.logger.debug(`[MIGRATION] ✅ Verified: ${record.name}`);
                        } else if (verifyResult.action === 'fix_and_verify') {
                            results.fixed++;
                            // Apply fixes
                            await this.recordChatInteraction({
                                ...record,
                                ...verifyResult.updates
                            });
                            this.logger.warn(`[MIGRATION] 🔧 Fixed: ${record.name}`);
                        } else if (verifyResult.action === 'mark_unverified') {
                            results.unverified++;
                            // Mark as unverified
                            await this.recordChatInteraction({
                                ...record,
                                ...verifyResult.updates
                            });
                            this.logger.warn(`[MIGRATION] ⚠️ Marked unverified: ${record.name}`);
                        } else if (verifyResult.action === 'delete') {
                            await this.deleteChat(record.id);
                            results.deleted++;
                            this.logger.warn(`[MIGRATION] 🗑️ Deleted: ${record.name} (${verifyResult.reason})`);
                        } else if (verifyResult.action === 'skip') {
                            results.skipped++;
                        }
                    } catch (error) {
                        this.logger.error(`[MIGRATION] Failed to verify ${record.name}:`, error);
                        results.skipped++;
                    }
                }));

                // Rate limiting delay between batches
                if (i + batchSize < allRecords.length) {
                    await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay
                    this.logger.debug(`[MIGRATION] Waiting 2s before next batch...`);
                }
            }

            this.logger.info('✅ [MIGRATION] Full database verification complete:', results);

        } catch (error) {
            this.logger.error('[MIGRATION] Failed during full verification:', error);
        }

        return results;
    }

    /**
     * PHASE 6: Verify only unverified records (daily startup verification)
     * @returns {Promise<Object>} Verification results
     */
    async verifyUnverifiedRecords() {
        if (!this.isReady) return { verified: 0, deleted: 0, stillUnverified: 0 };

        this.logger.info('🔍 [STARTUP] Verifying unverified records...');

        const results = {
            verified: 0,
            deleted: 0,
            stillUnverified: 0,
            total: 0
        };

        try {
            const unverifiedRecords = await this.getUnverifiedRecords();
            results.total = unverifiedRecords.length;

            if (results.total === 0) {
                this.logger.debug('[STARTUP] No unverified records found');
                return results;
            }

            this.logger.info(`[STARTUP] Found ${results.total} unverified records`);

            for (const record of unverifiedRecords) {
                try {
                    const verifyResult = await this.verifyRecordViaSendbird(record);

                    if (verifyResult.action === 'verify' || verifyResult.action === 'fix_and_verify') {
                        await this.recordChatInteraction({
                            ...record,
                            ...verifyResult.updates
                        });
                        results.verified++;
                        this.logger.info(`[STARTUP] ✅ Verified: ${record.name}`);
                    } else if (verifyResult.action === 'delete') {
                        await this.deleteChat(record.id);
                        results.deleted++;
                        this.logger.info(`[STARTUP] 🗑️ Deleted: ${record.name}`);
                    } else {
                        results.stillUnverified++;
                    }

                    // Small delay to avoid rate limiting
                    await new Promise(resolve => setTimeout(resolve, 500));

                } catch (error) {
                    this.logger.error(`[STARTUP] Failed to verify ${record.name}:`, error);
                    results.stillUnverified++;
                }
            }

            this.logger.info('✅ [STARTUP] Unverified records check complete:', results);

        } catch (error) {
            this.logger.error('[STARTUP] Failed during unverified records verification:', error);
        }

        return results;
    }

    /**
     * Get all unverified records from database
     * @returns {Promise<Array>} Array of unverified records
     */
    async getUnverifiedRecords() {
        if (!this.isReady) return [];

        const tx = this.db.transaction(['users'], 'readonly');
        const store = tx.objectStore('users');

        return new Promise((resolve) => {
            const getAllReq = store.getAll();
            getAllReq.onsuccess = () => {
                const all = getAllReq.result || [];
                const unverified = all.filter(record =>
                    record.isUnverified === true ||
                    (record.isVerified !== true && record.channel_url) // Not verified but has channel_url
                );
                resolve(unverified);
            };
            getAllReq.onerror = () => resolve([]);
        });
    }

    /**
     * Detect duplicate 1:1 DM channels (same userId, different channel_urls)
     * @returns {Promise<Array>} Array of duplicate groups [{userId, name, records: [...]}]
     */
    async detectDuplicate1to1Channels() {
        if (!this.isReady) return [];

        this.logger.info('🔍 [DEDUP] Detecting duplicate 1:1 DM channels...');

        const tx = this.db.transaction(['users'], 'readonly');
        const store = tx.objectStore('users');

        return new Promise((resolve) => {
            const getAllReq = store.getAll();
            getAllReq.onsuccess = () => {
                const all = getAllReq.result || [];

                // Group records by userId (only type='user' records with userId)
                const userIdMap = new Map();

                all.forEach(record => {
                    if (record.type === 'user' && record.userId && record.channel_url) {
                        if (!userIdMap.has(record.userId)) {
                            userIdMap.set(record.userId, []);
                        }
                        userIdMap.get(record.userId).push(record);
                    }
                });

                // Find duplicates (same userId with multiple channel_urls)
                const duplicates = [];
                userIdMap.forEach((records, userId) => {
                    if (records.length > 1) {
                        // Verify they have different channel_urls
                        const channelUrls = new Set(records.map(r => r.channel_url));
                        if (channelUrls.size > 1) {
                            duplicates.push({
                                userId: userId,
                                name: records[0].name, // First record's name
                                count: records.length,
                                records: records.sort((a, b) => {
                                    // Sort by priority: pinned > most recent interaction > highest interaction count
                                    if (a.isPinned && !b.isPinned) return -1;
                                    if (!a.isPinned && b.isPinned) return 1;
                                    if (a.lastSeen !== b.lastSeen) return (b.lastSeen || 0) - (a.lastSeen || 0);
                                    return (b.interactionCount || 0) - (a.interactionCount || 0);
                                })
                            });
                        }
                    }
                });

                this.logger.info(`🔍 [DEDUP] Found ${duplicates.length} duplicate 1:1 DM groups`);
                duplicates.forEach(dup => {
                    this.logger.debug(`  - ${dup.name} (userId: ${dup.userId}): ${dup.count} records`);
                });

                resolve(duplicates);
            };
            getAllReq.onerror = () => {
                this.logger.error('[DEDUP] Failed to detect duplicates');
                resolve([]);
            };
        });
    }

    /**
     * Consolidate duplicate 1:1 DM channels
     * Keeps best record, merges interaction history, deletes duplicates
     * @returns {Promise<Object>} Consolidation results
     */
    async consolidateDuplicate1to1Channels() {
        if (!this.isReady) return { consolidated: 0, deleted: 0, errors: 0 };

        this.logger.info('🔧 [DEDUP] Consolidating duplicate 1:1 DM channels...');

        const results = {
            consolidated: 0,
            deleted: 0,
            errors: 0,
            details: []
        };

        try {
            const duplicates = await this.detectDuplicate1to1Channels();

            if (duplicates.length === 0) {
                this.logger.info('[DEDUP] No duplicates found to consolidate');
                return results;
            }

            const tx = this.db.transaction(['users'], 'readwrite');
            const store = tx.objectStore('users');

            for (const duplicate of duplicates) {
                try {
                    const { userId, name, records } = duplicate;

                    // First record is the best one (already sorted by priority)
                    const bestRecord = records[0];
                    const duplicateRecords = records.slice(1);

                    this.logger.info(`🔧 [DEDUP] Consolidating ${name} (${records.length} records) → Keep: ${bestRecord.channel_url}`);

                    // Merge interaction data from duplicates into best record
                    let totalInteractionCount = bestRecord.interactionCount || 0;
                    let earliestInteraction = bestRecord.lastSeen || Date.now();
                    let latestInteraction = bestRecord.lastSeen || 0;

                    duplicateRecords.forEach(dup => {
                        totalInteractionCount += (dup.interactionCount || 0);
                        if (dup.lastSeen) {
                            earliestInteraction = Math.min(earliestInteraction, dup.lastSeen);
                            latestInteraction = Math.max(latestInteraction, dup.lastSeen);
                        }

                        this.logger.debug(`  🗑️ Deleting duplicate: ${dup.channel_url}`);
                    });

                    // Update best record with merged data
                    const consolidatedRecord = {
                        ...bestRecord,
                        interactionCount: totalInteractionCount,
                        lastSeen: latestInteraction,
                        firstSeenAt: earliestInteraction,
                        consolidatedAt: Date.now(),
                        consolidatedFrom: duplicateRecords.map(r => r.channel_url)
                    };

                    // Update best record
                    await new Promise((resolve, reject) => {
                        const putReq = store.put(consolidatedRecord);
                        putReq.onsuccess = () => resolve();
                        putReq.onerror = () => reject(putReq.error);
                    });

                    // Delete duplicate records
                    for (const dup of duplicateRecords) {
                        await new Promise((resolve, reject) => {
                            const deleteReq = store.delete(dup.id);
                            deleteReq.onsuccess = () => {
                                results.deleted++;
                                resolve();
                            };
                            deleteReq.onerror = () => reject(deleteReq.error);
                        });
                    }

                    results.consolidated++;
                    results.details.push({
                        userId,
                        name,
                        keptChannel: bestRecord.channel_url,
                        deletedChannels: duplicateRecords.map(r => r.channel_url),
                        mergedInteractionCount: totalInteractionCount
                    });

                } catch (error) {
                    this.logger.error(`[DEDUP] Failed to consolidate ${duplicate.name}:`, error);
                    results.errors++;
                }
            }

            this.logger.info('✅ [DEDUP] Consolidation complete:', {
                consolidated: results.consolidated,
                deleted: results.deleted,
                errors: results.errors
            });

        } catch (error) {
            this.logger.error('[DEDUP] Consolidation failed:', error);
            results.errors++;
        }

        return results;
    }

    // Pin a chat (set isPinned flag)
    async pinChat(chatId) {
        if (!this.isReady) return false;

        try {
            const tx = this.db.transaction(['users'], 'readwrite');
            const store = tx.objectStore('users');

            // Get all currently pinned chats to find the highest pinnedOrder
            const allRecords = await new Promise((resolve) => {
                const getAllReq = store.getAll();
                getAllReq.onsuccess = () => resolve(getAllReq.result || []);
                getAllReq.onerror = () => resolve([]);
            });

            const pinnedChats = allRecords.filter(chat => chat.isPinned === true);
            const maxPinnedOrder = pinnedChats.reduce((max, chat) => {
                return chat.pinnedOrder !== undefined && chat.pinnedOrder > max ? chat.pinnedOrder : max;
            }, -1);

            // New chat gets pinnedOrder = maxPinnedOrder + 1 (goes to the end)
            const newPinnedOrder = maxPinnedOrder + 1;

            const getReq = store.get(chatId);

            return new Promise((resolve) => {
                let chatName = null;

                getReq.onsuccess = () => {
                    const chat = getReq.result;
                    if (!chat) {
                        this.logger.debug(`⚠️ Chat not found for pinning: ${chatId}`);
                        resolve(false);
                        return;
                    }

                    // PREVENT: NoName groups cannot be pinned
                    if (chat.isNoNameGroup === true) {
                        console.warn(`🚫 [pinChat] Cannot pin NoName group (Frankenstein group)`);
                        console.warn(`   chatId: ${chatId}`);
                        console.warn(`   name: ${chat.name}`);
                        resolve(false);
                        return;
                    }

                    chatName = chat.name;
                    chat.isPinned = true;
                    chat.pinnedAt = Date.now();
                    chat.pinnedOrder = newPinnedOrder; // Assign position at the end
                    chat.lastUpdated = Date.now();

                    this.logger.debug(`📌 Pinning chat "${chatName}" at position ${newPinnedOrder}`);

                    const putReq = store.put(chat);

                    // Set up transaction completion handler only after we have work to do
                    tx.oncomplete = () => {
                        this.logger.debug(`📌 Chat pinned: ${chatName} at position ${newPinnedOrder}`);
                        resolve(true);
                    };

                    tx.onerror = () => {
                        this.logger.error(`❌ Pin transaction failed: ${chatName}`);
                        resolve(false);
                    };

                    putReq.onerror = () => {
                        this.logger.error(`❌ Pin put request failed: ${chatName}`);
                        resolve(false);
                    };
                };

                getReq.onerror = () => {
                    this.logger.error(`❌ Pin get request failed: ${chatId}`);
                    resolve(false);
                };
            });

        } catch (error) {
            this.logger.warn('⚠️ Failed to pin chat:', error);
            return false;
        }
    }

    // Unpin a chat (remove isPinned flag)
    async unpinChat(chatId) {
        if (!this.isReady) return false;

        try {
            const tx = this.db.transaction(['users'], 'readwrite');
            const store = tx.objectStore('users');

            const getReq = store.get(chatId);

            return new Promise((resolve) => {
                let chatName = null;

                getReq.onsuccess = () => {
                    const chat = getReq.result;
                    if (!chat) {
                        this.logger.debug(`⚠️ Chat not found for unpinning: ${chatId}`);
                        resolve(false);
                        return;
                    }

                    chatName = chat.name;
                    chat.isPinned = false;
                    chat.pinnedAt = null;
                    chat.pinnedOrder = undefined; // Clear the pinnedOrder field
                    chat.lastUpdated = Date.now();

                    this.logger.debug(`📍 Unpinning chat "${chatName}" and clearing pinnedOrder`);

                    const putReq = store.put(chat);

                    // Set up transaction completion handler only after we have work to do
                    tx.oncomplete = () => {
                        this.logger.debug(`📍 Chat unpinned: ${chatName}`);
                        resolve(true);
                    };

                    tx.onerror = () => {
                        this.logger.error(`❌ Unpin transaction failed: ${chatName}`);
                        resolve(false);
                    };

                    putReq.onerror = () => {
                        this.logger.error(`❌ Unpin put request failed: ${chatName}`);
                        resolve(false);
                    };
                };

                getReq.onerror = () => {
                    this.logger.error(`❌ Unpin get request failed: ${chatId}`);
                    resolve(false);
                };
            });

        } catch (error) {
            this.logger.warn('⚠️ Failed to unpin chat:', error);
            return false;
        }
    }

    // Get all pinned chats
    async getPinnedChats() {
        if (!this.isReady) return [];

        try {
            const tx = this.db.transaction(['users'], 'readonly');
            const store = tx.objectStore('users');

            // Simple approach: get all records and filter in memory
            const request = store.getAll();

            return new Promise((resolve) => {
                request.onsuccess = () => {
                    const allRecords = request.result;
                    const pinnedChats = allRecords
                        .filter(chat =>
                            chat.isPinned === true &&
                            !String(chat.id).startsWith('name_') // Exclude name-based records (transition only)
                        )
                        .sort((a, b) => {
                            // Sort by pinnedOrder if both have it
                            if (a.pinnedOrder !== undefined && b.pinnedOrder !== undefined) {
                                return a.pinnedOrder - b.pinnedOrder;
                            }
                            // If only one has pinnedOrder, prioritize it
                            if (a.pinnedOrder !== undefined) return -1;
                            if (b.pinnedOrder !== undefined) return 1;
                            // If neither has pinnedOrder, fall back to lastOpenedTime
                            return (b.lastOpenedTime || 0) - (a.lastOpenedTime || 0);
                        });

                    this.logger.debug('📌 Found pinned chats:', pinnedChats.length, pinnedChats.map(c => ({ name: c.name, isPinned: c.isPinned })));
                    resolve(pinnedChats);
                };
                request.onerror = () => resolve([]);
            });

        } catch (error) {
            this.logger.warn('⚠️ Failed to get pinned chats:', error);
            return [];
        }
    }

    // Get recent chats (last 5, excluding pinned)
    async getRecentChats() {
        if (!this.isReady) return [];

        try {
            const tx = this.db.transaction(['users'], 'readonly');
            const store = tx.objectStore('users');

            // Simple approach: get all records and filter in memory
            const request = store.getAll();

            return new Promise((resolve) => {
                request.onsuccess = () => {
                    const allRecords = request.result;
                    // Filter and deduplicate recent chats
                    const filteredChats = allRecords
                        .filter(chat =>
                            chat.lastOpenedTime && // Has interaction history
                            !String(chat.id).startsWith('name_') // Exclude name-based records (transition only)
                        )
                        .sort((a, b) => (b.lastOpenedTime || 0) - (a.lastOpenedTime || 0));

                    // Deduplicate by name (keep most recent entry for each person)
                    const seenNames = new Set();
                    const recentChats = filteredChats
                        .filter(chat => {
                            if (seenNames.has(chat.name)) {
                                this.logger.debug(`🔍 Filtering duplicate chat: ${chat.name} (ID: ${chat.id})`);
                                return false; // Skip duplicate
                            }
                            seenNames.add(chat.name);
                            return true;
                        })
                        .slice(0, 5); // Last 5 recent chats

                    this.logger.debug('📊 Final recent chats after deduplication:', recentChats.map(c => ({ name: c.name, id: c.id, lastOpenedTime: c.lastOpenedTime })));

                    this.logger.debug('📊 Found recent chats:', recentChats.length);
                    resolve(recentChats);
                };
                request.onerror = () => resolve([]);
            });

        } catch (error) {
            this.logger.warn('⚠️ Failed to get recent chats:', error);
            return [];
        }
    }

    // Get a user record by ID
    async getUserById(userId) {
        if (!this.isReady || !userId) return null;

        try {
            const tx = this.db.transaction(['users'], 'readonly');
            const store = tx.objectStore('users');
            const request = store.get(userId);

            return new Promise((resolve) => {
                request.onsuccess = () => resolve(request.result || null);
                request.onerror = () => resolve(null);
            });
        } catch (error) {
            this.logger.warn(`⚠️ Failed to get user ${userId}:`, error);
            return null;
        }
    }

    // Ensure channel_url exists for a user record, fetch from API if missing
    async ensureChannelUrl(userId) {
        if (!this.isReady || !userId) return null;

        try {
            // Get existing record
            const record = await this.getUserById(userId);

            if (!record) {
                this.logger.warn(`⚠️ No record found for user ${userId}`);
                return null;
            }

            // If channel_url already exists, return it
            if (record.channel_url) {
                this.logger.debug(`✅ Channel URL already exists for ${record.name}: ${record.channel_url}`);
                return record.channel_url;
            }

            // Fetch from /members endpoint
            this.logger.debug(`📥 Fetching channel URL for ${record.name} via /members endpoint`);

            if (!window.WVFavs?.APIManager) {
                this.logger.warn('⚠️ APIManager not available');
                return null;
            }

            const membersResponse = await window.WVFavs.APIManager.getChannelMembers(record.name);

            // Find the direct chat (is_distinct = true)
            const directChat = membersResponse?.channels?.find(ch => ch.is_distinct === true);

            if (directChat?.channel_url) {
                this.logger.debug(`✅ Found channel URL: ${directChat.channel_url}`);

                // Update record with channel_url
                await this.recordChatInteraction({
                    ...record,
                    channel_url: directChat.channel_url
                });

                return directChat.channel_url;
            } else {
                this.logger.warn(`⚠️ No direct chat found for ${record.name}`);
                return null;
            }
        } catch (error) {
            this.logger.error(`❌ Failed to ensure channel URL for ${userId}:`, error);
            return null;
        }
    }

    // Get the current active chat (most recently visited)
    async getCurrentChat() {
        if (!this.isReady) return null;
        try {
            return new Promise((resolve) => {
                const tx = this.db.transaction(['users'], 'readonly');
                const store = tx.objectStore('users');
                const request = store.getAll();

                request.onsuccess = () => {
                    const allChats = request.result || [];

                    // Find the most recently visited chat
                    const currentChat = allChats
                        .filter(chat =>
                            (chat.lastVisited || chat.lastOpenedTime) &&
                            !String(chat.id).startsWith('name_') // Exclude name-based records (transition only)
                        )
                        .sort((a, b) => {
                            const aTime = Math.max(a.lastVisited || 0, a.lastOpenedTime || 0);
                            const bTime = Math.max(b.lastVisited || 0, b.lastOpenedTime || 0);
                            return bTime - aTime;
                        })[0] || null;

                    this.logger.debug('📱 Current chat:', currentChat?.name || 'None');
                    resolve(currentChat);
                };
                request.onerror = () => resolve(null);
            });

        } catch (error) {
            this.logger.warn('⚠️ Failed to get current chat:', error);
            return null;
        }
    }

    // Get all important chats (pinned + recent) for search widget
    async getImportantChats() {
        const [pinnedChats, recentChats] = await Promise.all([
            this.getPinnedChats(),
            this.getRecentChats()
        ]);

        // Add result type flags
        const results = [
            ...pinnedChats.map(chat => ({ ...chat, _resultType: 'pinned' })),
            ...recentChats.map(chat => ({ ...chat, _resultType: 'recent' }))
        ];

        this.logger.debug('🏷️ Important chats with result types:', results.map(c => ({ name: c.name, type: c._resultType, isPinned: c.isPinned })));
        return results;
    }

    // Clean up duplicate name-based records when API-based records exist
    async cleanupUserDuplicates() {
        if (!this.isReady) return { cleaned: 0, errors: [] };

        this.logger.log('🧹 Starting user duplicate cleanup...');
        let cleaned = 0;
        const errors = [];

        try {
            const tx = this.db.transaction(['users'], 'readwrite');
            const store = tx.objectStore('users');
            const allUsers = await new Promise(resolve => {
                const req = store.getAll();
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => resolve([]);
            });

            // Group by name to find duplicates
            const byName = new Map();
            for (const user of allUsers) {
                if (!byName.has(user.name)) {
                    byName.set(user.name, []);
                }
                byName.get(user.name).push(user);
            }

            // Process duplicates
            for (const [name, users] of byName.entries()) {
                if (users.length > 1) {
                    // Find channel_url based record and user_id based record
                    const channelRecord = users.find(u => u.id?.includes('sendbird_group_channel_'));
                    const userIdRecord = users.find(u => !u.id?.includes('sendbird_') && u.type === 'user');

                    if (channelRecord && userIdRecord) {
                        this.logger.log(`🔗 Merging duplicate for ${name}: ${userIdRecord.id} → ${channelRecord.id}`);

                        // Merge data
                        const merged = {
                            ...userIdRecord,
                            ...channelRecord,
                            interactionCount: (channelRecord.interactionCount || 0) + (userIdRecord.interactionCount || 0),
                        };

                        // Update channel record with merged data
                        const tx2 = this.db.transaction(['users'], 'readwrite');
                        const store2 = tx2.objectStore('users');
                        await new Promise(resolve => {
                            const putReq = store2.put(merged);
                            putReq.onsuccess = () => resolve();
                        });

                        // Delete user_id record
                        const tx3 = this.db.transaction(['users'], 'readwrite');
                        const store3 = tx3.objectStore('users');
                        await new Promise(resolve => {
                            const delReq = store3.delete(userIdRecord.id);
                            delReq.onsuccess = () => resolve();
                        });

                        cleaned++;
                    }
                }
            }

            this.logger.log(`✅ Cleaned up ${cleaned} duplicate user records`);
            return { cleaned, errors };

        } catch (error) {
            this.logger.error('Failed to cleanup user duplicates:', error);
            errors.push(error.message);
            return { cleaned, errors };
        }
    }

    async cleanupDuplicateRecords() {
        if (!this.isReady) return;

        try {
            this.logger.debug('🧹 Starting duplicate record cleanup...');
            const tx = this.db.transaction(['users'], 'readwrite');
            const store = tx.objectStore('users');

            return new Promise((resolve, reject) => {
                const getAllReq = store.getAll();
                let cleanupCount = 0;

                getAllReq.onsuccess = () => {
                    const allRecords = getAllReq.result;
                    const nameBasedRecords = allRecords.filter(record =>
                        record.id && record.id.toString().startsWith('name_')
                    );

                    this.logger.debug(`🔍 Found ${nameBasedRecords.length} name-based records to check`);

                    // For each name-based record, check if API-based equivalent exists
                    nameBasedRecords.forEach(nameRecord => {
                        const name = nameRecord.name;
                        const apiRecord = allRecords.find(record =>
                            record.name === name &&
                            !record.id.toString().startsWith('name_')
                        );

                        if (apiRecord) {
                            this.logger.debug(`🗑️ Removing duplicate name-based record: ${nameRecord.id} (API record exists: ${apiRecord.id})`);
                            store.delete(nameRecord.id);
                            cleanupCount++;
                        }
                    });

                    tx.oncomplete = () => {
                        this.logger.debug(`✅ Duplicate cleanup completed: ${cleanupCount} records removed`);
                        resolve(cleanupCount);
                    };

                    tx.onerror = () => reject(tx.error);
                };

                getAllReq.onerror = () => reject(getAllReq.error);
            });

        } catch (error) {
            this.logger.warn('⚠️ Error during duplicate cleanup:', error);
            return 0;
        }
    }

    // Get all user records from the database
    async getAllUsers() {
        if (!this.isReady) return [];

        try {
            const tx = this.db.transaction(['users'], 'readonly');
            const store = tx.objectStore('users');

            return new Promise((resolve) => {
                const request = store.getAll();
                request.onsuccess = () => {
                    resolve(request.result || []);
                };
                request.onerror = () => resolve([]);
            });

        } catch (error) {
            this.logger.warn('⚠️ Failed to get all users:', error);
            return [];
        }
    }

    // Proactive cleanup: Remove name-based record when API record is stored
    async cleanupNameBasedRecord(personName, apiId, userStore) {
        try {
            const nameBasedId = `name_${personName.replace(/\s+/g, '')}`;

            // Skip if the API ID is actually a name-based ID (shouldn't happen but safety check)
            if (String(apiId).startsWith('name_')) {
                return;
            }

            // Check if name-based record exists
            const nameBasedRecord = await new Promise(resolve => {
                const getReq = userStore.get(nameBasedId);
                getReq.onsuccess = () => resolve(getReq.result);
                getReq.onerror = () => resolve(null);
            });

            if (nameBasedRecord) {
                this.logger.debug(`🧹 Proactive cleanup: Found name-based record ${nameBasedId} for API record ${apiId}`);

                // Preserve important data from name-based record before deletion
                const preservedData = {
                    isPinned: nameBasedRecord.isPinned,
                    pinnedAt: nameBasedRecord.pinnedAt,
                    isRecent: nameBasedRecord.isRecent,
                    lastOpenedTime: nameBasedRecord.lastOpenedTime,
                    interactionCount: nameBasedRecord.interactionCount,
                    interactionMetrics: nameBasedRecord.interactionMetrics
                };

                // If name-based record has important data, merge it into the API record
                if (preservedData.isPinned || preservedData.isRecent || preservedData.interactionCount > 0) {
                    this.logger.debug(`🔄 Merging important data from ${nameBasedId} to ${apiId}`);

                    // Get the API record and update it with preserved data
                    const apiRecord = await new Promise(resolve => {
                        const getApiReq = userStore.get(apiId);
                        getApiReq.onsuccess = () => resolve(getApiReq.result);
                        getApiReq.onerror = () => resolve(null);
                    });

                    if (apiRecord) {
                        // Merge preserved data into API record
                        const mergedRecord = {
                            ...apiRecord,
                            isPinned: preservedData.isPinned || apiRecord.isPinned,
                            pinnedAt: preservedData.pinnedAt || apiRecord.pinnedAt,
                            isRecent: preservedData.isRecent || apiRecord.isRecent,
                            lastOpenedTime: Math.max(preservedData.lastOpenedTime || 0, apiRecord.lastOpenedTime || 0),
                            interactionCount: (preservedData.interactionCount || 0) + (apiRecord.interactionCount || 0),
                            interactionMetrics: this.mergeInteractionMetrics(preservedData.interactionMetrics, apiRecord.interactionMetrics),
                            lastUpdated: Date.now()
                        };

                        // Update API record with merged data
                        await new Promise((resolve, reject) => {
                            const putReq = userStore.put(mergedRecord);
                            putReq.onsuccess = () => resolve();
                            putReq.onerror = () => reject(putReq.error);
                        });

                        this.logger.debug(`✅ Merged data from ${nameBasedId} into ${apiId}`);
                    }
                }

                // Delete the name-based record
                await new Promise((resolve, reject) => {
                    const deleteReq = userStore.delete(nameBasedId);
                    deleteReq.onsuccess = () => {
                        this.logger.debug(`🗑️ Cleaned up name-based record: ${nameBasedId}`);
                        resolve();
                    };
                    deleteReq.onerror = () => reject(deleteReq.error);
                });
            }
        } catch (error) {
            this.logger.warn(`⚠️ Failed to cleanup name-based record for ${personName}:`, error);
        }
    }

    // Helper method to merge interaction metrics
    mergeInteractionMetrics(metrics1, metrics2) {
        if (!metrics1 && !metrics2) return this.initializeInteractionMetrics();
        if (!metrics1) return metrics2;
        if (!metrics2) return metrics1;

        return {
            lastTenDays: [...(metrics1.lastTenDays || []), ...(metrics2.lastTenDays || [])].slice(-10),
            weeklyFrequency: Math.max(metrics1.weeklyFrequency || 0, metrics2.weeklyFrequency || 0),
            monthlyFrequency: Math.max(metrics1.monthlyFrequency || 0, metrics2.monthlyFrequency || 0),
            lastInteraction: Math.max(metrics1.lastInteraction || 0, metrics2.lastInteraction || 0)
        };
    }

    /**
     * CLEANUP UTILITY: Fix corrupted channel_url records
     * This function scans all records and fixes corruption issues:
     * 1. Group channels where id !== channel_url
     * 2. User DMs where channel_url doesn't contain userId
     *
     * Usage: await WVFavs.Extension.smartUserDB.fixCorruptedChannelUrls()
     *
     * @returns {Object} { fixed: number, deleted: number, errors: string[] }
     */
    async fixCorruptedChannelUrls() {
        if (!this.isReady) {
            return { fixed: 0, deleted: 0, errors: ['Database not ready'] };
        }

        console.log('🔧 [CLEANUP] Starting channel_url corruption cleanup...');

        try {
            const allChats = await this.getAllChats();
            let fixed = 0;
            let deleted = 0;
            const errors = [];

            const tx = this.db.transaction(['users'], 'readwrite');
            const store = tx.objectStore('users');

            for (const chat of allChats) {
                const idStr = String(chat.id || '');
                let needsUpdate = false;
                let shouldDelete = false;

                // FIX 1: Group channel records - id MUST equal channel_url
                if (idStr.startsWith('sendbird_group_channel_')) {
                    if (chat.channel_url && chat.channel_url !== chat.id) {
                        this.logger.log(`🚨 [CLEANUP] Found corrupted group channel: [REDACTED]`);
                        this.logger.log(`   ID: ${chat.id}`);
                        this.logger.log(`   channel_url (WRONG): ${chat.channel_url}`);

                        // Strategy: If the chat has a valid name and the ID is a proper sendbird channel,
                        // fix the channel_url to match the ID
                        if (chat.name && idStr.startsWith('sendbird_group_channel_')) {
                            chat.channel_url = chat.id;
                            needsUpdate = true;
                            console.log(`✅ [CLEANUP] Fixed: Set channel_url = ${chat.id}`);
                        } else {
                            // Delete if data is too corrupted
                            shouldDelete = true;
                            console.log(`🗑️ [CLEANUP] Deleting: Record too corrupted`);
                        }
                    }
                    // Auto-fix: Add missing channel_url
                    else if (!chat.channel_url) {
                        chat.channel_url = chat.id;
                        needsUpdate = true;
                        console.log(`🔧 [CLEANUP] Added missing channel_url for: "${chat.name}"`);
                    }
                }

                // FIX 2: User DM records - channel_url should be found from sharedChannels
                else if (chat.type === 'user') {
                    const userId = chat.userId || chat.id;

                    // Strategy 1: Find correct channel_url from sharedChannels (most reliable)
                    if (chat.sharedChannels && Array.isArray(chat.sharedChannels) && chat.sharedChannels.length > 0) {
                        // Try to find DM with member_count validation first (most reliable)
                        let directChat = chat.sharedChannels.find(ch =>
                            ch.member_count === 2 && ch.is_distinct === true
                        );

                        // FALLBACK: If member_count is missing (backward compatibility), use is_distinct alone
                        if (!directChat) {
                            directChat = chat.sharedChannels.find(ch =>
                                ch.is_distinct === true && ch.member_count === undefined
                            );
                            if (directChat) {
                                console.log(`⚠️ [CLEANUP] Using is_distinct fallback for "${chat.name}" (member_count missing)`);
                            }
                        }

                        if (directChat && directChat.channel_url) {
                            // Found the correct DM channel!
                            if (chat.channel_url !== directChat.channel_url) {
                                this.logger.log(`🚨 [CLEANUP] Found corrupted/missing user DM channel_url: [REDACTED]`);
                                this.logger.log(`   userId: ${userId}`);
                                this.logger.log(`   channel_url (WRONG/MISSING): ${chat.channel_url || 'missing'}`);
                                this.logger.log(`   channel_url (CORRECT from sharedChannels): ${directChat.channel_url}`);

                                chat.channel_url = directChat.channel_url;
                                needsUpdate = true;
                                console.log(`✅ [CLEANUP] Fixed channel_url from sharedChannels`);
                            }
                        } else if (chat.channel_url) {
                            // Has sharedChannels but no DM found - channel_url might be wrong
                            this.logger.log(`⚠️ [CLEANUP] User [REDACTED] has sharedChannels but no DM channel found`);
                            this.logger.log(`   Keeping existing channel_url: ${chat.channel_url}`);
                        }
                    }
                    // Strategy 2: Validate existing channel_url (fallback if no sharedChannels)
                    else if (chat.channel_url && userId && !chat.channel_url.includes(String(userId))) {
                        this.logger.log(`🚨 [CLEANUP] Found corrupted user DM: [REDACTED]`);
                        this.logger.log(`   userId: ${userId}`);
                        this.logger.log(`   channel_url (WRONG): ${chat.channel_url}`);
                        this.logger.log(`   sharedChannels: missing or empty`);

                        // Remove invalid channel_url - will need /members call to fix
                        delete chat.channel_url;
                        needsUpdate = true;
                        console.log(`✅ [CLEANUP] Removed invalid channel_url (needs /members refresh)`);
                    }
                }

                // FIX 3: Delete NoName/Frankenstein groups (groups with empty names)
                if (this.isNoNameGroup(chat)) {
                    this.logger.log(`🗑️ [CLEANUP] Deleting NoName group (Frankenstein group from DM)`);
                    this.logger.log(`   chatId: ${chat.id}`);
                    this.logger.log(`   channel_url: ${chat.channel_url || 'missing'}`);
                    this.logger.log(`   is_distinct: ${chat.is_distinct}`);
                    shouldDelete = true;
                }

                // FIX 4: Clean zombie user records (DM that became a group)
                // Remove invalid channel_url and the transformed group channel from sharedChannels
                if (chat.type === 'user' && chat.sharedChannels && Array.isArray(chat.sharedChannels)) {
                    // Check if the current channel_url points to a group (not a DM)
                    if (chat.channel_url) {
                        const currentChannel = chat.sharedChannels.find(ch => ch.channel_url === chat.channel_url);
                        if (currentChannel && currentChannel.is_distinct !== true) {
                            // This is a zombie record - the DM became a group
                            this.logger.log(`🧹 [CLEANUP] Cleaning zombie user record: [REDACTED]`);
                            this.logger.log(`   userId: ${chat.userId || chat.id}`);
                            this.logger.log(`   Invalid channel_url: ${chat.channel_url} (is_distinct: ${currentChannel.is_distinct})`);

                            // Remove the invalid channel_url
                            delete chat.channel_url;

                            // Remove the group channel from sharedChannels (keep only DMs)
                            chat.sharedChannels = chat.sharedChannels.filter(ch => ch.is_distinct === true);

                            needsUpdate = true;
                            console.log(`✅ [CLEANUP] Cleaned zombie record (removed invalid channel_url and group from sharedChannels)`);
                        }
                    }
                }

                // Apply fixes
                if (shouldDelete) {
                    await new Promise((resolve, reject) => {
                        const deleteReq = store.delete(chat.id);
                        deleteReq.onsuccess = () => resolve();
                        deleteReq.onerror = () => reject(deleteReq.error);
                    });
                    deleted++;
                } else if (needsUpdate) {
                    chat.lastUpdated = Date.now();
                    await new Promise((resolve, reject) => {
                        const putReq = store.put(chat);
                        putReq.onsuccess = () => resolve();
                        putReq.onerror = () => reject(putReq.error);
                    });
                    fixed++;
                }
            }

            await new Promise((resolve, reject) => {
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            });

            console.log(`✅ [CLEANUP] Complete: Fixed ${fixed} records, deleted ${deleted} corrupted records`);
            return { fixed, deleted, errors };

        } catch (error) {
            console.error(`❌ [CLEANUP] Error:`, error);
            return { fixed: 0, deleted: 0, errors: [error.message] };
        }
    }

    // Statistics Management Methods for StatisticsManager integration
    async getStatistics() {
        if (!this.isReady) {
            this.logger.warn('⚠️ SmartUserDatabase not ready for getStatistics');
            return null;
        }

        try {
            const transaction = this.db.transaction(['stats'], 'readonly');
            const store = transaction.objectStore('stats');
            const request = store.get('statistics');

            return new Promise((resolve, reject) => {
                request.onsuccess = () => {
                    const result = request.result;
                    resolve(result ? result.data : null);
                };
                request.onerror = () => reject(request.error);
            });
        } catch (error) {
            this.logger.error('Error getting statistics from IndexedDB:', error);
            return null;
        }
    }

    async saveStatistics(stats) {
        if (!this.isReady) {
            this.logger.warn('⚠️ SmartUserDatabase not ready for saveStatistics');
            return false;
        }

        try {
            const transaction = this.db.transaction(['stats'], 'readwrite');
            const store = transaction.objectStore('stats');

            const record = {
                key: 'statistics',
                data: stats,
                lastUpdated: new Date().toISOString()
            };

            const request = store.put(record);

            return new Promise((resolve, reject) => {
                request.onsuccess = () => resolve(true);
                request.onerror = () => reject(request.error);
            });
        } catch (error) {
            this.logger.error('Error saving statistics to IndexedDB:', error);
            return false;
        }
    }

    async clearStatistics() {
        if (!this.isReady) {
            this.logger.warn('⚠️ SmartUserDatabase not ready for clearStatistics');
            return false;
        }

        try {
            const transaction = this.db.transaction(['stats'], 'readwrite');
            const store = transaction.objectStore('stats');
            const request = store.delete('statistics');

            return new Promise((resolve, reject) => {
                request.onsuccess = () => resolve(true);
                request.onerror = () => reject(request.error);
            });
        } catch (error) {
            this.logger.error('Error clearing statistics from IndexedDB:', error);
            return false;
        }
    }

    // Helper methods for live statistics calculation
    async getPinnedChatsCount() {
        try {
            const pinnedChats = await this.getPinnedChats();
            return pinnedChats.length;
        } catch (error) {
            this.logger.error('Error getting pinned chats count:', error);
            return 0;
        }
    }

    async getUserCount() {
        if (!this.isReady) return 0;

        try {
            const transaction = this.db.transaction(['users'], 'readonly');
            const store = transaction.objectStore('users');
            const request = store.count();

            return new Promise((resolve, reject) => {
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
        } catch (error) {
            this.logger.error('Error counting users:', error);
            return 0;
        }
    }

    async getKeywordCount() {
        if (!this.isReady) return 0;

        // Check extension context before IndexedDB operations
        if (typeof WVFavs !== 'undefined' && WVFavs.ContextManager && !WVFavs.ContextManager.isContextValid()) {
            this.logger.warn('Skipping keyword count - extension context invalid');
            return 0;
        }

        try {
            // Validate database state
            if (!this.db || this.db.readyState !== 'open') {
                this.logger.warn('Database not ready for keyword count');
                return 0;
            }

            const transaction = this.db.transaction(['keywords'], 'readonly');
            const store = transaction.objectStore('keywords');
            const request = store.count();

            return new Promise((resolve, reject) => {
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => {
                    this.logger.error('IndexedDB keyword count request error:', request.error);
                    reject(request.error);
                };

                // Add transaction error handling
                transaction.onerror = () => {
                    this.logger.error('IndexedDB keyword count transaction error:', transaction.error);
                    reject(transaction.error);
                };

                transaction.onabort = () => {
                    this.logger.error('IndexedDB keyword count transaction aborted');
                    reject(new Error('Transaction aborted'));
                };
            });
        } catch (error) {
            this.logger.error('Error counting keywords:', error);
            this.logger.error('Error details:', {
                name: error.name,
                message: error.message,
                code: error.code
            });
            return 0;
        }
    }

    /**
     * Attempt to enrich a record by fetching its channel_url
     * @param {Object} record - The database record to enrich
     * @param {number} maxRetries - Maximum number of retry attempts (default: 1)
     * @returns {Promise<{success: boolean, channel_url: string|null}>}
     */
    async attemptEnrichment(record, maxRetries = 1) {
        let attempts = 0;
        let lastError = null;

        while (attempts < maxRetries) {
            attempts++;

            try {
                this.logger.log(`🔄 Enrichment attempt ${attempts}/${maxRetries} for:`, record.name);

                // Use existing ensureChannelUrl method
                const channelUrl = await this.ensureChannelUrl(record);

                if (channelUrl) {
                    this.logger.log(`✅ Enrichment successful for ${record.name}:`, channelUrl);
                    return { success: true, channel_url: channelUrl };
                } else {
                    this.logger.debug(`⚠️ Enrichment attempt ${attempts} failed: no channel_url returned`);
                }
            } catch (error) {
                lastError = error;
                this.logger.warn(`⚠️ Enrichment attempt ${attempts} error:`, error.message);

                // Add delay before retry (100ms)
                if (attempts < maxRetries) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            }
        }

        this.logger.warn(`❌ Enrichment failed after ${maxRetries} attempts for:`, record.name);
        return { success: false, channel_url: null, error: lastError };
    }

    /**
     * Clean up incomplete records (missing channel_url) from database
     * For pinned/recent chats: attempts enrichment before removal
     * For other chats: removes immediately
     * @returns {Promise<{total: number, enriched: number, removed: number, kept: number}>}
     */
    async cleanupIncompleteRecords() {
        if (!this.isReady) {
            this.logger.warn('⚠️ SmartUserDatabase not ready for cleanup');
            return { total: 0, enriched: 0, removed: 0, kept: 0 };
        }

        try {
            this.logger.log('🧹 Starting cleanup of incomplete records...');

            // Get pinned and recent chats for fast lookup
            const pinnedChats = await this.getPinnedChats();
            const recentChats = await this.getRecentChats();

            this.logger.debug(`📌 Found ${pinnedChats.length} pinned chats, ${recentChats.length} recent chats`);

            // Create Set of pinned/recent IDs for fast lookup
            const pinnedIds = new Set(pinnedChats.map(c => c.id));
            const recentIds = new Set(recentChats.map(c => c.id));

            // Get all records
            const allRecords = await this.getAllChats();
            this.logger.debug(`📊 Total records in database: ${allRecords.length}`);

            // Filter incomplete records (missing channel_url)
            const incompleteRecords = allRecords.filter(record => {
                // Only consider user type records (not groups)
                if (record.type === 'group') return false;

                // Missing channel_url or has invalid/placeholder channel_url
                return !record.channel_url || record.channel_url === '' || record.channel_url === 'undefined';
            });

            this.logger.log(`🔍 Found ${incompleteRecords.length} incomplete user records`);

            if (incompleteRecords.length === 0) {
                this.logger.log('✅ No incomplete records to clean up');
                return { total: 0, enriched: 0, removed: 0, kept: 0 };
            }

            let enrichedCount = 0;
            let removedCount = 0;
            let keptCount = 0;

            // Process each incomplete record
            for (const record of incompleteRecords) {
                const isPinned = pinnedIds.has(record.id);
                const isRecent = recentIds.has(record.id);

                if (isPinned || isRecent) {
                    const label = isPinned ? '📌 Pinned' : '🕐 Recent';
                    this.logger.log(`${label} chat found: ${record.name}, attempting enrichment...`);

                    // Attempt enrichment (2 retries for pinned, 1 for recent)
                    const enrichResult = await this.attemptEnrichment(record, isPinned ? 2 : 1);

                    if (enrichResult.success) {
                        enrichedCount++;
                        keptCount++;
                        this.logger.log(`✅ ${label} chat enriched and kept:`, record.name);
                    } else {
                        // Enrichment failed, remove even if pinned/recent
                        await this.deleteChat(record.id);
                        removedCount++;
                        this.logger.warn(`❌ ${label} chat removed (enrichment failed):`, record.name);
                    }

                    // Add delay between API calls to avoid rate limiting
                    await new Promise(resolve => setTimeout(resolve, 100));
                } else {
                    // Not pinned or recent, remove immediately
                    await this.deleteChat(record.id);
                    removedCount++;
                    this.logger.debug(`🗑️ Removed incomplete record:`, record.name);
                }
            }

            const result = {
                total: incompleteRecords.length,
                enriched: enrichedCount,
                removed: removedCount,
                kept: keptCount
            };

            this.logger.log('🧹 Cleanup complete:', result);

            // Track analytics if available
            if (this.logger && typeof this.logger.analytics === 'function') {
                this.logger.analytics('cleanup_incomplete_records', {
                    total_incomplete: result.total,
                    enriched_count: result.enriched,
                    removed_count: result.removed,
                    kept_count: result.kept
                });
            }

            return result;
        } catch (error) {
            this.logger.error('❌ Error during cleanup:', error);
            return { total: 0, enriched: 0, removed: 0, kept: 0, error: error.message };
        }
    }
}