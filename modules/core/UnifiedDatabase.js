var WVFavs = WVFavs || {};

WVFavs.UnifiedDatabase = class UnifiedDatabase {
    constructor(ttl = 30 * 24 * 60 * 60 * 1000, logger = console.log, app = null) {
        this.ttl = ttl;
        this.dbName = 'wv_unified_db';
        this.version = 2;
        this.db = null;
        this.isReady = false;
        this.logger = logger;
        this.app = app;
        this.debugEnabled = false; // Debug logging flag

        this.initDB();
    }

    // Initialize IndexedDB with unified schema
    async initDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.version);

            request.onerror = () => {
                if (this.debugEnabled) {
                    console.error('❌ UnifiedDB failed to open:', request.error);
                }
                reject(request.error);
            };

            request.onsuccess = () => {
                this.db = request.result;
                this.isReady = true;
                if (this.debugEnabled) {
                    console.log('🚀 UnifiedDatabase initialized');
                }
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // Main chats table - one entry per user/channel
                if (!db.objectStoreNames.contains('chats')) {
                    const chatStore = db.createObjectStore('chats', { keyPath: 'id' });

                    // Indexes for fast searches
                    chatStore.createIndex('name', 'name', { unique: false });
                    chatStore.createIndex('email', 'email', { unique: false });
                    chatStore.createIndex('nickname', 'nickname', { unique: false });
                    chatStore.createIndex('rank', 'baseRank', { unique: false });
                    chatStore.createIndex('lastInteraction', 'lastInteraction', { unique: false });
                    chatStore.createIndex('dataSource', 'dataSource', { unique: false });
                }

                // Search tags table for self-learning system
                if (!db.objectStoreNames.contains('searchTags')) {
                    const tagStore = db.createObjectStore('searchTags', { keyPath: ['userId', 'keyword'] });

                    tagStore.createIndex('keyword', 'keyword', { unique: false });
                    tagStore.createIndex('userId', 'userId', { unique: false });
                    tagStore.createIndex('confidence', 'confidence', { unique: false });
                    tagStore.createIndex('lastMatched', 'lastMatched', { unique: false });
                }

                // Settings and metadata
                if (!db.objectStoreNames.contains('metadata')) {
                    const metaStore = db.createObjectStore('metadata', { keyPath: 'key' });
                }
            };
        });
    }

    // Store or update a chat/user with ranking data
    async storeChat(chatData) {
        if (!this.isReady) {
            await this.initDB();
        }

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(['chats'], 'readwrite');
            const store = tx.objectStore('chats');

            // First check if user already exists to merge data
            const getReq = store.get(chatData.id);
            getReq.onsuccess = () => {
                const existingChat = getReq.result;

                // Debug logging for potential ID collisions
                if (existingChat && existingChat.name !== chatData.name) {
                    if (this.debugEnabled) {
                        console.warn('🚨 Potential ID collision detected:', {
                            id: chatData.id,
                            existingName: existingChat.name,
                            newName: chatData.name,
                            existingType: existingChat.type,
                            newType: chatData.type
                        });
                    }
                }

                // Calculate base rank
                const baseRank = this.calculateBaseRank(chatData);

                // Merge existing data with new data (prefer more complete data)
                const enhancedChat = {
                    id: chatData.id,
                    name: chatData.name || existingChat?.name,
                    nickname: chatData.nickname || existingChat?.nickname || null,
                    email: chatData.email || existingChat?.email || null,
                    bio: chatData.bio || existingChat?.bio || null,
                    department: chatData.department || existingChat?.department || null,
                    type: chatData.type, // 'user' | 'channel'

                    // Ranking data (preserve existing pinned/recent status)
                    baseRank: Math.max(baseRank, existingChat?.baseRank || 0),
                    isPinned: chatData.isPinned || existingChat?.isPinned || false,
                    isRecent: chatData.isRecent || existingChat?.isRecent || false,

                    // Social graph (merge shared channels)
                    sharedChannels: this.mergeSharedChannels(existingChat?.sharedChannels || [], chatData.sharedChannels || []),
                    directChatHistory: chatData.directChatHistory || existingChat?.directChatHistory || false,

                    // Metadata (prefer better avatar, newer data source)
                    avatar: this.chooseBetterAvatar(chatData.avatar, existingChat?.avatar),
                    dataSource: this.chooseBetterDataSource(chatData.dataSource, existingChat?.dataSource),
                    lastInteraction: Math.max(chatData.lastInteraction || 0, existingChat?.lastInteraction || 0),
                    lastAdvancedUpdate: chatData.lastAdvancedUpdate || existingChat?.lastAdvancedUpdate || null,

                    // Navigation data removed - was causing data corruption

                    // Stats (merge counts)
                    interactionCount: Math.max(chatData.interactionCount || 0, existingChat?.interactionCount || 0),
                    searchMatchCount: (chatData.searchMatchCount || 0) + (existingChat?.searchMatchCount || 0),

                    // Channel specific
                    is_distinct: chatData.is_distinct !== undefined ? chatData.is_distinct : existingChat?.is_distinct,
                    member_count: chatData.member_count || existingChat?.member_count,
                    channel_url: chatData.channel_url || existingChat?.channel_url,

                    // User specific
                    profile_url: chatData.profile_url || existingChat?.profile_url,
                    user_id: chatData.user_id || existingChat?.user_id
                };

                const req = store.put(enhancedChat);
                req.onsuccess = () => resolve(enhancedChat);
                req.onerror = () => reject(req.error);
            };
            getReq.onerror = () => reject(getReq.error);
        });
    }

    // Helper methods for merging data
    mergeSharedChannels(existing, newChannels) {
        const merged = [...(existing || [])];
        (newChannels || []).forEach(newChannel => {
            if (!merged.find(existing => existing.channel_url === newChannel.channel_url)) {
                merged.push(newChannel);
            }
        });
        return merged;
    }

    chooseBetterAvatar(newAvatar, existingAvatar) {
        // Prefer URL avatars over character avatars
        if (newAvatar?.type === 'url') return newAvatar;
        if (existingAvatar?.type === 'url') return existingAvatar;
        return newAvatar || existingAvatar;
    }

    chooseBetterDataSource(newSource, existingSource) {
        // Preference order: advanced_api > light_api > others
        if (newSource === 'advanced_api') return newSource;
        if (existingSource === 'advanced_api') return existingSource;
        if (newSource === 'light_api') return newSource;
        if (existingSource === 'light_api') return existingSource;
        return newSource || existingSource;
    }

    // Calculate base rank from pinned/recent status
    calculateBaseRank(chatData) {
        let rank = 0;
        if (chatData.isPinned) rank += 1;
        if (chatData.isRecent) rank += 1;
        return rank;
    }

    // Smart search with enhanced ranking
    async smartSearch(query, limit = 10) {
        if (!this.isReady) {
            return [];
        }

        // If no query, return all important chats (pinned + recent) from original sources
        // This avoids ID mismatch issues from database migration
        if (!query || !query.trim()) {
            return this.getImportantChatsFromOriginalSources();
        }

        const results = await this.searchChatsLocally(query, limit * 2); // Get more for ranking
        const rankedResults = await this.rankSearchResults(results, query);

        return rankedResults.slice(0, limit);
    }

    // Local search across all fields
    async searchChatsLocally(query, limit = 20) {
        return new Promise((resolve) => {
            const tx = this.db.transaction(['chats'], 'readonly');
            const store = tx.objectStore('chats');
            const results = [];
            const lowerQuery = query.toLowerCase();

            const req = store.openCursor();
            req.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor && results.length < limit) {
                    const chat = cursor.value;

                    // Check if chat matches query in any field
                    if (this.chatMatchesQuery(chat, lowerQuery)) {
                        results.push(chat);
                    }

                    cursor.continue();
                } else {
                    resolve(results);
                }
            };

            req.onerror = () => resolve([]);
        });
    }

    // Check if chat matches query in any searchable field
    chatMatchesQuery(chat, lowerQuery) {
        const searchableFields = [
            chat.name,
            chat.nickname,
            chat.email,
            chat.bio,
            chat.department
        ];

        return searchableFields.some(field =>
            field && field.toLowerCase().includes(lowerQuery)
        );
    }

    // Enhanced ranking algorithm with exact group name match prioritization
    async rankSearchResults(results, query) {
        const lowerQuery = query.toLowerCase();

        const rankedResults = await Promise.all(
            results.map(async (chat) => {
                let score = 0;

                // Priority 1: Shared Connections (highest priority)
                if (chat.sharedChannels && chat.sharedChannels.length > 0) {
                    // Base score for shared connections
                    score += 1000;

                    // Bio-enhanced shared connections get extra priority
                    if (chat.dataSource === 'bio_enhanced_shared_connection') {
                        score += 100; // Extra boost for discovered connections
                    }

                    // Count of shared channels matters
                    const connectionCount = chat.sharedChannels.length;
                    score += Math.min(connectionCount * 10, 50); // Up to 50 extra points

                    // Extra boost for direct chats (is_distinct: true)
                    const hasDirectChat = chat.sharedChannels.some(channel =>
                        channel.is_distinct === true || channel.shared_connection === true
                    );
                    if (hasDirectChat || chat.directChatHistory) {
                        score += 50; // Increased from 20 to 50 for direct channels
                    }

                    // Extra boost if discovered via bio secondary lookup
                    const hasBioDiscoveredChannels = chat.sharedChannels.some(channel =>
                        channel.discovered_via === 'bio_secondary_lookup'
                    );
                    if (hasBioDiscoveredChannels) {
                        score += 25; // Bonus for bio-discovered connections
                    }
                }

                // Calculate name match score once for reuse
                const nameMatchScore = this.calculateNameMatchScore(chat, lowerQuery);

                // Priority 2: Group Chats You're Part Of (with exact name match boost)
                if (chat.type === 'channel' && !chat.is_distinct && chat.member_count > 1) {
                    // Check if this is a group chat from channel members API (indicates membership)
                    if (chat.dataSource === 'channel_members_api' || chat.dataSource === 'light_api') {
                        score += 800; // Base score for group chats you're part of

                        // CRITICAL ENHANCEMENT: Exact group name match gets massive boost
                        // When user types "CRM", they want CRM group chat, not CRM team members
                        if (nameMatchScore >= 100) { // Exact full name match (100 points from calculateNameMatchScore)
                            score += 500; // Total: 1300 points (beats shared connections at 1000+)
                        }
                    }
                }

                // Priority 3: Exact Name Matches (3rd priority)
                if (nameMatchScore > 0) {
                    score += 500 + nameMatchScore; // Base 500 + match quality
                }

                // Priority 4: Bio/Excerpt Matches (lowest priority for API results)
                const bioMatchScore = this.calculateBioMatchScore(chat, lowerQuery);
                score += bioMatchScore;

                // Base Interactions (pinned/recent) - boost existing categories
                if (chat.baseRank > 0) {
                    score += chat.baseRank * 100; // Multiply existing bonuses
                }

                return {
                    ...chat,
                    score: score,
                    _searchQuery: query,
                    _nameMatch: nameMatchScore > 0,
                    _bioMatch: bioMatchScore > 0
                };
            })
        );

        // Sort by score (highest first)
        return rankedResults.sort((a, b) => b.score - a.score);
    }

    // Calculate name match score with priority for exact matches
    calculateNameMatchScore(chat, lowerQuery) {
        let nameScore = 0;
        const name = (chat.name || '').toLowerCase();
        const nickname = (chat.nickname || '').toLowerCase();

        // Exact full name match (highest)
        if (name === lowerQuery || nickname === lowerQuery) {
            nameScore += 100;
        }
        // Exact word match in name (very high)
        else if (name.split(/\s+/).includes(lowerQuery) || nickname.split(/\s+/).includes(lowerQuery)) {
            nameScore += 80;
        }
        // Name starts with query (high)
        else if (name.startsWith(lowerQuery) || nickname.startsWith(lowerQuery)) {
            nameScore += 60;
        }
        // Name contains query (medium)
        else if (name.includes(lowerQuery) || nickname.includes(lowerQuery)) {
            nameScore += 40;
        }
        // Character matching (low)
        else {
            nameScore += this.characterMatch(lowerQuery, name);
            nameScore += this.characterMatch(lowerQuery, nickname);
        }

        return nameScore;
    }

    // Calculate bio/excerpt match score
    calculateBioMatchScore(chat, lowerQuery) {
        let bioScore = 0;

        if (chat.bio && chat.bio.toLowerCase().includes(lowerQuery)) {
            bioScore += 30;
        }

        if (chat.department && chat.department.toLowerCase().includes(lowerQuery)) {
            bioScore += 20;
        }

        return bioScore;
    }

    // Calculate search relevance score (legacy method for compatibility)
    async calculateSearchRelevance(chat, lowerQuery) {
        let relevanceScore = 0;

        // Exact nickname match (highest priority for "Honey" use case)
        if (chat.nickname && chat.nickname.toLowerCase() === lowerQuery) {
            relevanceScore += 10;
        }

        // Exact name match
        if (chat.name && chat.name.toLowerCase() === lowerQuery) {
            relevanceScore += 8;
        }

        // Character matching for partial matches
        relevanceScore += this.characterMatch(lowerQuery, chat.name || '');
        relevanceScore += this.characterMatch(lowerQuery, chat.nickname || '');
        relevanceScore += this.characterMatch(lowerQuery, chat.email || '');

        // Bio/department matching
        if (chat.bio && chat.bio.toLowerCase().includes(lowerQuery)) {
            relevanceScore += 3;
        }

        if (chat.department && chat.department.toLowerCase().includes(lowerQuery)) {
            relevanceScore += 2;
        }

        // Search tags matching (self-learning system)
        const tagScore = await this.getTagMatchScore(chat.id, lowerQuery);
        relevanceScore += tagScore;

        return relevanceScore;
    }

    // Character-by-character matching score
    characterMatch(query, text) {
        if (!query || !text) return 0;

        let matches = 0;
        const lowerText = text.toLowerCase();
        const lowerQuery = query.toLowerCase();

        for (let i = 0; i < lowerQuery.length; i++) {
            if (lowerText.includes(lowerQuery[i])) {
                matches++;
            }
        }

        return matches;
    }

    // Get score from search tags
    async getTagMatchScore(userId, query) {
        return new Promise((resolve) => {
            const tx = this.db.transaction(['searchTags'], 'readonly');
            const store = tx.objectStore('searchTags');
            const index = store.index('userId');

            let totalScore = 0;
            const req = index.openCursor(IDBKeyRange.only(userId));

            req.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    const tag = cursor.value;
                    if (tag.keyword.toLowerCase().includes(query)) {
                        totalScore += tag.confidence * 3;
                    }
                    cursor.continue();
                } else {
                    resolve(totalScore);
                }
            };

            req.onerror = () => resolve(0);
        });
    }

    // Record search match for self-learning
    async recordSearchMatch(userId, keyword, source, matchStrength = 1.0) {
        if (!this.isReady) return;

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(['searchTags'], 'readwrite');
            const store = tx.objectStore('searchTags');

            const tagKey = [userId, keyword];
            const req = store.get(tagKey);

            req.onsuccess = () => {
                let tag = req.result;

                if (!tag) {
                    // Create new tag
                    tag = {
                        userId: userId,
                        keyword: keyword,
                        source: source,
                        matchCount: 0,
                        confidence: 0,
                        lastMatched: null,
                        firstSeen: Date.now()
                    };
                }

                // Update tag statistics
                tag.matchCount++;
                tag.lastMatched = Date.now();
                tag.confidence = Math.min(1.0, tag.confidence + (matchStrength * 0.1));

                const updateReq = store.put(tag);
                updateReq.onsuccess = () => resolve(tag);
                updateReq.onerror = () => reject(updateReq.error);
            };

            req.onerror = () => reject(req.error);
        });
    }

    // Get all chats with baseRank > 0 (pinned + recent)
    async getImportantChats() {
        return new Promise((resolve) => {
            if (!this.isReady) {
                resolve([]);
                return;
            }

            const tx = this.db.transaction(['chats'], 'readonly');
            const store = tx.objectStore('chats');
            const results = [];

            // Get all chats and filter by baseRank > 0 (pinned or recent)
            const req = store.openCursor();
            req.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    const chat = cursor.value;
                    if (chat.baseRank > 0) {
                        results.push(chat);
                    }
                    cursor.continue();
                } else {
                    // Sort by baseRank (pinned first) then by lastInteraction
                    results.sort((a, b) => {
                        if (a.baseRank !== b.baseRank) {
                            return b.baseRank - a.baseRank;
                        }
                        return (b.lastInteraction || 0) - (a.lastInteraction || 0);
                    });
                    resolve(results);
                }
            };

            req.onerror = () => resolve([]);
        });
    }

    // Get important chats from original sources (not migrated database)
    // This ensures IDs match the working sidebar components
    getImportantChatsFromOriginalSources() {
        const results = [];

        // Get pinned chats from original source
        if (this.app?.pinnedChats) {
            for (const [id, chatData] of this.app.pinnedChats.entries()) {
                results.push({
                    id: id,
                    name: chatData.name,
                    type: chatData.userId ? 'user' : 'channel',
                    avatar: chatData.avatar,
                    // navigation field removed - was causing data corruption
                    isPinned: true,
                    isRecent: false,
                    user_id: chatData.userId,
                    channel_url: chatData.channel_url || chatData.id,
                    baseRank: 2, // High priority for pinned
                    _resultType: 'pinned' // Will be set by SearchEngine
                });
            }
        }

        // Get recent chats from original source
        if (this.app?.chatHistory) {
            const recentChats = this.app.chatHistory.getAllRecents();
            for (const chatData of recentChats) {
                // Don't duplicate if already pinned
                if (!results.find(r => r.id === chatData.id)) {
                    results.push({
                        id: chatData.id,
                        name: chatData.name,
                        type: 'user', // Assume user for recent chats
                        avatar: chatData.avatar,
                        // navigation field removed - was causing data corruption
                        isPinned: false,
                        isRecent: true,
                        lastInteraction: chatData.lastVisited || Date.now(),
                        baseRank: 1, // Lower priority than pinned
                        _resultType: 'recent' // Will be set by SearchEngine
                    });
                }
            }
        }

        // Sort by baseRank (pinned first) then by lastInteraction
        results.sort((a, b) => {
            if (a.baseRank !== b.baseRank) {
                return b.baseRank - a.baseRank;
            }
            return (b.lastInteraction || 0) - (a.lastInteraction || 0);
        });

        return results;
    }

    // Update user interaction stats
    async updateInteractionStats(userId) {
        if (!this.isReady) return;

        const chat = await this.getChat(userId);
        if (chat) {
            chat.interactionCount = (chat.interactionCount || 0) + 1;
            chat.lastInteraction = Date.now();
            await this.storeChat(chat);
        }
    }

    // Get single chat by ID
    async getChat(chatId) {
        if (!this.isReady) return null;

        return new Promise((resolve) => {
            const tx = this.db.transaction(['chats'], 'readonly');
            const store = tx.objectStore('chats');
            const req = store.get(chatId);

            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => resolve(null);
        });
    }

    // Get chat by name (for instant channel detection)
    async getChatByName(chatName) {
        if (!this.isReady) return null;

        return new Promise((resolve) => {
            const tx = this.db.transaction(['chats'], 'readonly');
            const store = tx.objectStore('chats');
            const cursorReq = store.openCursor();

            cursorReq.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    const chat = cursor.value;
                    // Check if name matches (case-insensitive)
                    if (chat.name && chat.name.toLowerCase() === chatName.toLowerCase()) {
                        resolve(chat);
                        return;
                    }
                    cursor.continue();
                } else {
                    // No match found
                    resolve(null);
                }
            };

            cursorReq.onerror = () => resolve(null);
        });
    }

    // Get database statistics
    async getStats() {
        if (!this.isReady) return null;

        return new Promise((resolve) => {
            const tx = this.db.transaction(['chats', 'searchTags'], 'readonly');
            const chatStore = tx.objectStore('chats');
            const tagStore = tx.objectStore('searchTags');

            let stats = {
                totalChats: 0,
                pinnedChats: 0,
                recentChats: 0,
                totalTags: 0,
                averageRank: 0
            };

            // Count chats
            const chatReq = chatStore.count();
            chatReq.onsuccess = () => {
                stats.totalChats = chatReq.result;

                // Count tags
                const tagReq = tagStore.count();
                tagReq.onsuccess = () => {
                    stats.totalTags = tagReq.result;
                    resolve(stats);
                };
            };
        });
    }

    // Clean up old/unused data
    async cleanup() {
        if (!this.isReady) return;

        const expiredTime = Date.now() - this.ttl;

        return new Promise((resolve) => {
            const tx = this.db.transaction(['chats', 'searchTags'], 'readwrite');
            const chatStore = tx.objectStore('chats');
            const tagStore = tx.objectStore('searchTags');

            // Clean up old chats with no interactions
            const chatIndex = chatStore.index('lastInteraction');
            const req = chatIndex.openCursor(IDBKeyRange.upperBound(expiredTime));

            req.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    const chat = cursor.value;
                    // Only delete if not pinned/recent and no significant interactions
                    if (chat.baseRank === 0 && chat.interactionCount < 2) {
                        cursor.delete();
                    }
                    cursor.continue();
                } else {
                    resolve();
                }
            };
        });
    }
};