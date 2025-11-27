/**
 * ThreadManager - Manages thread tracking and notifications for chat channels
 *
 * This module intercepts SendBird API calls to track threads in channels,
 * detects when threads are opened/closed, and maintains thread read status.
 *
 * Storage Strategy:
 * - In-memory: Full thread data (session lifetime)
 * - localStorage: Thread metadata (persistent, ~80 KB for 1000 channels)
 * - Reads Workvivo's localStorage 'threadReads' for read status
 *
 * @version 1.0.0
 */

var WVFavs = WVFavs || {};

WVFavs.ThreadManager = class ThreadManager {
    constructor(app) {
        this.app = app;
        this.logger = app?.logger || { debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, analytics: () => {} };

        // State management
        this.channelMessages = new Map(); // channelUrl -> Map(messageId -> message data)
        this.channelThreads = new Map();  // channelUrl -> threads[]
        this.threadReplies = new Map();   // parentMessageId -> replies[] (last 2 replies per thread)
        this.currentChannelUrl = null;
        this.currentOpenThreadId = null;
        this.isThreadPanelOpen = false;
        this.channelChangeDebounce = null; // Debounce timer for rapid channel changes

        // Configuration
        this.config = {
            localStorageKey: 'wv_thread_metadata',
            metadataVersion: 1,
            maxChannelsInMemory: 50,  // LRU cache limit
            metadataTTL: 5 * 60 * 1000  // 5 minutes
        };

        // Feature flag
        this.enabled = false;

        this.logger.info('🧵 ThreadManager initialized');
    }

    /**
     * Initialize the ThreadManager
     * Sets up fetch interception (observer is handled by EventHandler)
     */
    async init() {
        try {
            this.logger.info('🧵 Starting ThreadManager initialization...');

            // Listen for intercepted data from inject-fetch-interceptor.js
            this.setupEventListeners();

            // Initialize WebSocket for real-time updates
            this.initializeWebSocket();

            // Load metadata from localStorage
            this.loadMetadataFromStorage();

            // Initial thread panel check
            this.detectOpenThread();

            // Enable feature
            this.enabled = true;

            // Detect current channel from DOM and trigger initial data load
            const initialChannel = this.detectChannelFromDOM();
            if (initialChannel) {
                this.currentChannelUrl = initialChannel;

                // Dispatch event to notify UI that we have a channel (even if no messages yet)
                window.dispatchEvent(new CustomEvent('wv-channel-changed', {
                    detail: {
                        previousChannel: null,
                        currentChannel: initialChannel,
                        source: 'initial_detection'
                    }
                }));
            } else {
                // Retry after a short delay (DOM might not be ready yet)
                setTimeout(() => {
                    const retryChannel = this.detectChannelFromDOM();
                    if (retryChannel) {
                        this.currentChannelUrl = retryChannel;
                        window.dispatchEvent(new CustomEvent('wv-channel-changed', {
                            detail: {
                                previousChannel: null,
                                currentChannel: retryChannel,
                                source: 'initial_detection_retry'
                            }
                        }));
                    }
                }, 500);
            }

            this.logger.info('✅ ThreadManager initialized successfully');

            // Analytics disabled per user request
            // Thread manager initialization tracking removed
        } catch (error) {
            this.logger.error('❌ ThreadManager initialization failed', { error: error.message, stack: error.stack });
            this.enabled = false;
        }
    }

    /**
     * Setup event listeners for intercepted fetch data
     * Data comes from inject-fetch-interceptor.js (page context)
     */
    setupEventListeners() {
        this.logger.info('🔧 Setting up ThreadManager event listeners');

        // Listen for channel changes with debouncing for rapid navigation (A→B→C)
        window.addEventListener('wv-channel-changed', (event) => {
            const { currentChannel, source } = event.detail;
            this.logger.debug(`🎯 Received channel change event: ${currentChannel} (${source})`);

            // Clear previous debounce to handle rapid events (last one wins)
            if (this.channelChangeDebounce) {
                clearTimeout(this.channelChangeDebounce);
            }

            // Debounce 150ms to wait for DOM to settle
            this.channelChangeDebounce = setTimeout(() => {
                this.logger.debug(`⏰ Debounce completed, calling handleChannelChange for ${currentChannel}`);
                this.handleChannelChange(currentChannel, source).catch(err => {
                    this.logger.error('❌ Error handling channel change:', err);
                });
            }, 150);
        });

        window.addEventListener('wv-thread-messages', (event) => {
            const { channelUrl, messages } = event.detail;

            // SPECIAL CASE: If this is the first channel (currentChannelUrl is null), dispatch event
            // This handles initial page load when DOM detection fails
            if (!this.currentChannelUrl && channelUrl) {
                window.dispatchEvent(new CustomEvent('wv-channel-changed', {
                    detail: {
                        previousChannel: null,
                        currentChannel: channelUrl,
                        source: 'first_message_event'
                    }
                }));
            }

            // Store threads for this channel (no verification - just store the data)
            // The handleChannelChange method will verify if this is the active channel
            this.processMessagesEndpoint({ messages }, channelUrl);

            // Update badge if this is the current channel
            if (channelUrl === this.currentChannelUrl) {
                const threads = this.channelThreads.get(channelUrl) || [];
                const unreadThreads = threads.filter(t => {
                    const hasReplies = (t.replyCount || 0) > 0;
                    const neverRead = t.lastReadAt === 0;
                    const readBeforeLastReply = t.lastReadAt < (t.lastRepliedAt || 0);
                    return hasReplies && (neverRead || readBeforeLastReply);
                });
                const unreadCount = unreadThreads.length;
                this.updateThreadBadge(unreadCount);
            }

            // Dispatch refresh event - panel will check if channel matches before acting
            window.dispatchEvent(new CustomEvent('wv-thread-panel-refresh', {
                detail: {
                    channelUrl: channelUrl,
                    source: 'api_data_received'
                }
            }));
        });

        window.addEventListener('wv-thread-changelogs', (event) => {
            const { channelUrl, data } = event.detail;
            this.processChangelogsEndpoint(data, channelUrl);
        });

        window.addEventListener('wv-thread-replies', (event) => {
            const { channelUrl, parentMessageId, replies } = event.detail;
            this.processThreadReplies(channelUrl, parentMessageId, replies);
        });

        this.logger.debug('🔧 Event listeners setup complete');
    }

    /**
     * Handle channel change with DOM verification
     * Waits for DOM to be consistent before updating badge
     * @param {string} eventChannelUrl - Channel URL from wv-channel-changed event
     * @param {string} source - Source of the event
     */
    async handleChannelChange(eventChannelUrl, source) {
        this.logger.debug(`📍 Handling channel change: ${eventChannelUrl} (source: ${source})`);

        // STEP 1: Wait for DOM to be in consistent state (retry up to 5 times)
        let chatInfo;
        let retries = 0;
        const maxRetries = 5;

        while (retries < maxRetries) {
            const messageSection = document.querySelector('[data-testid="message-section"]');
            const chatHeader = messageSection?.querySelector('.tw-p-4.tw-border-b.tw-border-slate-200.tw-rounded-t-lg.tw-absolute.tw-top-0');

            if (!chatHeader) {
                this.logger.debug(`⏸️ Chat header not found, waiting... (retry ${retries + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, 100));
                retries++;
                continue;
            }

            chatInfo = window.WVFavs?.DomDataExtractor?.extractChatInfo(chatHeader);

            // Check if DOM is consistent (header and sidebar match)
            if (chatInfo && chatInfo._verification?.isConsistent) {
                this.logger.debug(`✅ DOM is consistent (retry ${retries + 1}/${maxRetries})`);
                break; // DOM settled!
            }

            this.logger.debug(`⏸️ DOM not consistent, waiting... (retry ${retries + 1}/${maxRetries})`);
            await new Promise(resolve => setTimeout(resolve, 100));
            retries++;
        }

        if (!chatInfo || !chatInfo._verification?.isConsistent) {
            this.logger.warn('⚠️ DOM not consistent after retries, skipping this event');
            return; // Don't update - wait for next event
        }

        // STEP 2: Verify this channel URL belongs to the current DOM chat
        // Check if channel URL already exists in DB with a different chat name
        try {
            const allChats = await this.app.smartUserDB.getAllChats();
            const existingRecord = allChats.find(chat => chat.channel_url === eventChannelUrl);

            if (existingRecord) {
                // Channel URL exists - verify it matches current chat
                const existingName = existingRecord.name;
                const currentName = chatInfo.name;


                if (existingName !== currentName) {
                    this.logger.warn(`⚠️ Channel URL conflict detected!`);
                    this.logger.warn(`   Channel: ${eventChannelUrl}`);
                    this.logger.warn(`   Existing DB: "${existingName}"`);
                    this.logger.warn(`   Current DOM: "${currentName}"`);
                    this.logger.warn(`🚫 REJECTING - This is a stale/background event`);
                    return; // Ignore stale event
                }

                this.logger.debug(`✅ Verified: Channel URL matches existing record "${existingName}"`);
            } else {
                this.logger.debug(`🆕 New channel URL: ${eventChannelUrl}`);
            }
        } catch (err) {
            console.error(`❌ [handleChannelChange] Error verifying channel URL:`, err);
            this.logger.error('Error verifying channel URL:', err);
            return; // Don't proceed if verification fails
        }

        // STEP 3: Check if channel URL exists in database (for logging/tracking only)
        // NOTE: ThreadManager no longer blocks if record is missing!
        // Records may be created/updated by other parts of the system (EventHandler, sidebar clicks, etc.)
        // We continue to show threads regardless of DB state to avoid chicken-and-egg problems
        let chatRecord = null;
        try {
            const allChats = await this.app.smartUserDB.getAllChats();
            chatRecord = allChats.find(chat => chat.channel_url === eventChannelUrl);

            if (chatRecord) {
                this.logger.debug(`✅ Found record with channel_url: ${chatRecord.name}`);
            } else {
                this.logger.debug(`ℹ️ No record with channel_url yet (will be created by other systems)`);
                // NO LONGER RETURNING EARLY - Continue to show threads!
            }
        } catch (err) {
            console.error(`❌ [handleChannelChange] Error looking up record:`, err);
            this.logger.error('Error looking up record:', err);
            // Continue anyway - don't let DB errors block threads
        }

        // STEP 4: Update ThreadManager state (always reached - no DB blocking!)
        this.logger.debug(`✅ Channel change accepted: ${eventChannelUrl}`);
        const previousChannel = this.currentChannelUrl;
        this.currentChannelUrl = eventChannelUrl;
        this.currentOpenThreadId = null; // Reset when changing channels

        // Only dispatch event if channel actually changed (prevents feedback loop)
        if (previousChannel !== eventChannelUrl) {
            this.logger.debug(`📢 Dispatching wv-channel-changed: ${previousChannel?.substring(0,40)} → ${eventChannelUrl.substring(0,40)}`);
            window.dispatchEvent(new CustomEvent('wv-channel-changed', {
                detail: {
                    previousChannel: previousChannel,
                    currentChannel: eventChannelUrl,
                    source: source
                }
            }));
        } else {
            this.logger.debug(`⏭️ Skipping wv-channel-changed dispatch - channel unchanged`);
        }

        // Get threads for this channel
        const threads = this.channelThreads.get(eventChannelUrl) || [];


        // Calculate unread: threads with replies where lastReadAt is 0 or before lastRepliedAt
        const unreadThreads = threads.filter(t => {
            const hasReplies = (t.replyCount || 0) > 0;
            const neverRead = t.lastReadAt === 0;
            const readBeforeLastReply = t.lastReadAt < (t.lastRepliedAt || 0);

            return hasReplies && (neverRead || readBeforeLastReply);
        });
        const unreadCount = unreadThreads.length;


        // Update badge proactively
        this.updateThreadBadge(unreadCount);

        this.logger.debug(`📊 Updated badge: ${unreadCount} unread threads`);

        // Dispatch refresh event for any open panels
        window.dispatchEvent(new CustomEvent('wv-thread-panel-refresh', {
            detail: {
                channelUrl: eventChannelUrl,
                source: 'channel_change_verified',
                hasCachedData: threads.length > 0
            }
        }));

    }

    /**
     * Update thread badge on the thread button
     * @param {number} unreadCount - Number of unread threads
     */
    updateThreadBadge(unreadCount, retryCount = 0) {
        try {
            // Cancel any pending retries - prevents stale updates from overwriting fresh data
            if (retryCount === 0 && this._badgeRetryTimeout) {
                clearTimeout(this._badgeRetryTimeout);
                this._badgeRetryTimeout = null;
            }

            const messageSection = document.querySelector('[data-testid="message-section"]');
            const chatHeader = messageSection?.querySelector('.tw-p-4.tw-border-b.tw-border-slate-200.tw-rounded-t-lg.tw-absolute.tw-top-0');
            const threadButton = chatHeader?.querySelector('.wv-favorites-thread-btn');


            // Verify we're updating the right chat
            if (chatHeader) {
                const chatInfo = window.WVFavs?.DomDataExtractor?.extractChatInfo(chatHeader);
            }

            if (!threadButton) {
                if (retryCount < 3) {

                    // Retry after a short delay - the button might not be added yet
                    this._badgeRetryTimeout = setTimeout(() => {
                        this.updateThreadBadge(unreadCount, retryCount + 1);
                    }, 200);
                } else {
                }
                return;
            }


            // Find or create badge (check for both old and new class names)
            let badge = threadButton.querySelector('.wv-favorites-thread-badge, .wv-thread-badge');

            if (unreadCount > 0) {
                if (!badge) {
                    badge = document.createElement('span');
                    badge.className = 'wv-favorites-thread-badge';
                    // Apply styling to match the original badge
                    badge.style.cssText = `
                        position: absolute;
                        top: -2px;
                        right: -2px;
                        background: #dc2626;
                        color: white;
                        border-radius: 10px;
                        padding: 1px 5px;
                        font-size: 10px;
                        font-weight: 700;
                        line-height: 1.4;
                        min-width: 16px;
                        height: 16px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        box-shadow: 0 1px 3px rgba(0,0,0,0.2);
                    `;
                    threadButton.appendChild(badge);
                }
                const badgeText = unreadCount > 99 ? '99+' : unreadCount.toString();
                badge.textContent = badgeText;
                badge.style.display = 'flex';
            } else if (badge) {
                badge.style.display = 'none';
            } else {
            }
        } catch (err) {
            this.logger.error('Error updating thread badge:', err);
        }
    }

    /**
     * Initialize WebSocket for real-time updates
     */
    initializeWebSocket() {
        try {
            if (!window.WVFavs || !window.WVFavs.WebSocketStateManager) {
                this.logger.warn('⚠️ WebSocketStateManager not available, skipping WebSocket initialization (extension will still work via API polling)');
                return;
            }

            this.wsManager = new window.WVFavs.WebSocketStateManager();

            // Listen for real-time message events
            this.wsManager.on('message:received', (data) => {
                try {
                    this.handleRealtimeMessage(data);
                } catch (err) {
                    this.logger.error('Error handling real-time message:', err);
                }
            });

            // Listen for read receipt events
            this.wsManager.on('read:receipt', (data) => {
                try {
                    this.handleReadReceipt(data);
                } catch (err) {
                    this.logger.error('Error handling read receipt:', err);
                }
            });

            // Listen for connection status
            this.wsManager.on('status:connected', () => {
                this.logger.debug('🔌 WebSocket connected - real-time updates active');
            });

            this.wsManager.on('status:disconnected', () => {
                this.logger.debug('🔌 WebSocket disconnected');
            });

            this.logger.info('✅ WebSocket integration initialized');
        } catch (error) {
            this.logger.warn('⚠️ Failed to initialize WebSocket (extension will still work via API polling):', error.message);
            // Don't throw - allow ThreadManager to continue without WebSocket
        }
    }

    /**
     * Handle real-time message from WebSocket
     */
    handleRealtimeMessage(data) {
        if (!this.enabled) {
            this.logger.debug('⚠️ ThreadManager disabled, ignoring real-time message');
            return;
        }

        this.logger.debug('📨 Real-time message received:', {
            messageId: data.messageId,
            channelUrl: data.channelUrl,
            isThreadReply: data.isThreadReply,
            parentMessageId: data.parentMessageId,
            threadInfo: data.threadInfo
        });

        if (data.isThreadReply) {
            // This is a reply to an existing thread
            this.updateThreadWithReply(data);
        } else if (data.threadInfo) {
            // This is a message with thread info (parent thread updated)
            this.updateThreadMetadata(data);
        } else {
            // Regular new message
            this.handleNewMessage(data);
        }
    }

    /**
     * Update thread with new reply
     */
    updateThreadWithReply(data) {
        const { parentMessageId, channelUrl, threadInfo } = data;

        this.logger.debug('🔄 Updating thread with reply:', { parentMessageId, channelUrl, hasThreadInfo: !!threadInfo });

        // Get message cache for channel
        const messageCache = this.channelMessages.get(channelUrl);
        if (!messageCache) {
            this.logger.debug('⚠️ No message cache for channel, creating one');
            this.channelMessages.set(channelUrl, new Map());
        }

        // Update parent message with new thread info
        const parentMessage = messageCache?.get(parentMessageId);
        this.logger.debug('🔍 Looking for parent message:', parentMessageId, 'Found:', !!parentMessage);

        if (parentMessage) {
            parentMessage.thread_info = {
                reply_count: threadInfo?.replyCount || (parentMessage.thread_info?.reply_count || 0) + 1,
                last_replied_at: threadInfo?.lastRepliedAt || Date.now(),
                updated_at: threadInfo?.updatedAt || Date.now()
            };

            this.logger.debug(`🧵 Updated thread ${parentMessageId} with new reply`, {
                replyCount: parentMessage.thread_info.reply_count
            });

            // Re-extract threads and update UI
            const threads = this.extractThreads(channelUrl);
            this.channelThreads.set(channelUrl, threads);
            this.updateMetadata(channelUrl, threads);
            this.notifyUIUpdate(channelUrl);
        } else {
            this.logger.debug(`⚠️ Parent message ${parentMessageId} not in cache, will be synced on next API call`);
        }
    }

    /**
     * Update thread metadata from real-time event
     */
    updateThreadMetadata(data) {
        const { messageId, channelUrl, threadInfo } = data;

        this.logger.debug('🔄 Updating thread metadata:', { messageId, channelUrl, threadInfo });

        const messageCache = this.channelMessages.get(channelUrl);
        if (!messageCache) {
            this.logger.debug('⚠️ No message cache for channel:', channelUrl);
            return;
        }

        const message = messageCache.get(messageId);
        this.logger.debug('🔍 Looking for message in cache:', messageId, 'Found:', !!message, 'Cache size:', messageCache.size);

        if (message) {
            message.thread_info = {
                reply_count: threadInfo.replyCount,
                last_replied_at: threadInfo.lastRepliedAt,
                updated_at: threadInfo.updatedAt
            };

            this.logger.debug(`🧵 Updated thread metadata for ${messageId}`);

            // Re-extract threads and update UI
            const threads = this.extractThreads(channelUrl);
            this.channelThreads.set(channelUrl, threads);
            this.updateMetadata(channelUrl, threads);
            this.notifyUIUpdate(channelUrl);
        }
    }

    /**
     * Handle new message (not a thread reply)
     */
    handleNewMessage(data) {
        const { messageId, channelUrl, message, user, timestamp } = data;

        // Get or create message cache
        if (!this.channelMessages.has(channelUrl)) {
            this.channelMessages.set(channelUrl, new Map());
        }
        const messageCache = this.channelMessages.get(channelUrl);

        // Add message to cache
        messageCache.set(messageId, {
            message_id: messageId,
            message: message,
            user: user,
            created_at: timestamp,
            thread_info: data.threadInfo ? {
                reply_count: data.threadInfo.replyCount,
                last_replied_at: data.threadInfo.lastRepliedAt,
                updated_at: data.threadInfo.updatedAt
            } : null
        });

        this.logger.debug(`💾 Cached new message ${messageId}`);

        // Update threads and UI
        const threads = this.extractThreads(channelUrl);
        this.channelThreads.set(channelUrl, threads);
        this.updateMetadata(channelUrl, threads);
        this.notifyUIUpdate(channelUrl);
    }

    /**
     * Handle read receipt
     */
    handleReadReceipt(data) {
        // Read receipts might affect unread counts - can be enhanced later
        this.logger.debug('📖 Read receipt received:', data.channelUrl);
    }

    /**
     * Extract channel URL from API request URL
     */
    extractChannelFromUrl(url) {
        const match = url.match(/group_channels\/(sendbird_group_channel_[^\/\?]+)/);
        return match ? match[1] : null;
    }

    /**
     * Detect current channel from DOM (when API calls haven't happened yet)
     * Note: This is only used during initial page load. For ongoing navigation,
     * we rely on wv-channel-changed events with proper verification.
     */
    detectChannelFromDOM() {
        // This is only for initial detection - not for verification
        const channelUrl = null; // Removed broken getChannelFromDOM()

        if (channelUrl) {
            this.currentChannelUrl = channelUrl;
            this.logger.debug('📍 Detected channel from DOM:', this.currentChannelUrl);
            return this.currentChannelUrl;
        }

        // Strategy 4: Check localStorage for recent channel (fallback - kept for backward compatibility)
        try {
            const sendbirdLocalStorage = Object.keys(localStorage).find(key => key.includes('sendbird'));
            if (sendbirdLocalStorage) {
                const data = JSON.parse(localStorage.getItem(sendbirdLocalStorage));
                if (data && data.currentChannelUrl) {
                    this.currentChannelUrl = data.currentChannelUrl;
                    this.logger.debug('📍 Detected channel from localStorage:', this.currentChannelUrl);
                    return this.currentChannelUrl;
                }
            }
        } catch (e) {
            // Ignore
        }

        // Strategy 4: Wait for first API call
        this.logger.debug('📍 No channel detected yet, will wait for first API call');
        return null;
    }

    /**
     * Process messages from /messages endpoint
     */
    processMessagesEndpoint(data, channelUrl) {
        if (!data || !data.messages || !Array.isArray(data.messages)) {
            this.logger.warn('⚠️ Invalid message data received');
            return;
        }

        this.logger.debug(`📨 Processing ${data.messages.length} messages for ${channelUrl}`);

        // Get or create message cache for this channel
        if (!this.channelMessages.has(channelUrl)) {
            this.channelMessages.set(channelUrl, new Map());
        }
        const messageCache = this.channelMessages.get(channelUrl);

        // Add/update messages in cache
        let threadsFound = 0;
        data.messages.forEach(msg => {
            // Check if message already exists in cache
            const existingMsg = messageCache.get(msg.message_id);

            // If cached message has newer thread_info (from WebSocket), preserve it
            if (existingMsg?.thread_info?.updated_at && msg.thread_info?.updated_at) {
                if (existingMsg.thread_info.updated_at > msg.thread_info.updated_at) {
                    // Cache is newer (from WebSocket) - preserve it
                    this.logger.debug('🔄 Preserving newer WebSocket thread_info:', {
                        messageId: msg.message_id,
                        cachedUpdatedAt: existingMsg.thread_info.updated_at,
                        apiUpdatedAt: msg.thread_info.updated_at,
                        cachedReplyCount: existingMsg.thread_info.reply_count,
                        apiReplyCount: msg.thread_info.reply_count
                    });
                    msg.thread_info = existingMsg.thread_info;
                }
            }

            messageCache.set(msg.message_id, msg);

            if (msg.thread_info && msg.thread_info.reply_count > 0) {
                threadsFound++;
            }
        });

        this.logger.debug(`💾 Cached ${data.messages.length} messages (${threadsFound} with threads)`);

        // Extract and cache threads
        const threads = this.extractThreads(channelUrl);
        this.channelThreads.set(channelUrl, threads);

        this.logger.debug(`🧵 ${threads.length} threads total (${threads.filter(t => t.isUnread).length} unread)`);

        // Update metadata in localStorage
        this.updateMetadata(channelUrl, threads);

        // Notify UI to refresh thread button badge
        this.notifyUIUpdate(channelUrl);

        // Enforce memory limit
        this.enforceMemoryLimit();
    }

    /**
     * Process updates from /messages/changelogs endpoint
     */
    processChangelogsEndpoint(data, channelUrl) {
        if (!data) {
            this.logger.warn('⚠️ Invalid changelogs data received');
            return;
        }

        this.logger.debug(`🔄 Processing changelogs for ${channelUrl}`);

        const messageCache = this.channelMessages.get(channelUrl);
        if (!messageCache) {
            this.logger.debug('⚠️ No message cache for channel, skipping changelogs');
            return;
        }

        let updatedCount = 0;
        let deletedCount = 0;

        // Update existing messages
        if (data.updated && Array.isArray(data.updated)) {
            data.updated.forEach(msg => {
                if (messageCache.has(msg.message_id)) {
                    // Merge with existing data
                    const existing = messageCache.get(msg.message_id);

                    // Preserve newer thread_info from WebSocket
                    if (existing?.thread_info?.updated_at && msg.thread_info?.updated_at) {
                        if (existing.thread_info.updated_at > msg.thread_info.updated_at) {
                            this.logger.debug('🔄 Preserving newer WebSocket thread_info (changelog):', {
                                messageId: msg.message_id,
                                cachedReplyCount: existing.thread_info.reply_count,
                                apiReplyCount: msg.thread_info.reply_count
                            });
                            msg.thread_info = existing.thread_info;
                        }
                    }

                    messageCache.set(msg.message_id, { ...existing, ...msg });
                    updatedCount++;
                } else {
                    // New message
                    messageCache.set(msg.message_id, msg);
                    updatedCount++;
                }
            });
        }

        // Delete removed messages
        if (data.deleted && Array.isArray(data.deleted)) {
            data.deleted.forEach(msgId => {
                if (messageCache.delete(msgId)) {
                    deletedCount++;
                }
            });
        }

        this.logger.debug(`📝 Updated: ${updatedCount}, Deleted: ${deletedCount}`);

        // Refresh threads
        const threads = this.extractThreads(channelUrl);
        this.channelThreads.set(channelUrl, threads);

        this.logger.debug(`🧵 ${threads.length} threads after update (${threads.filter(t => t.isUnread).length} unread)`);

        // Update metadata
        this.updateMetadata(channelUrl, threads);

        // Notify UI to refresh thread button badge
        this.notifyUIUpdate(channelUrl);
    }

    /**
     * Process thread replies from /messages?parent_message_id= endpoint
     */
    processThreadReplies(channelUrl, parentMessageId, replies) {
        if (!replies || !Array.isArray(replies)) {
            this.logger.warn('⚠️ Invalid thread replies data received');
            return;
        }

        this.logger.debug(`💬 Processing ${replies.length} replies for thread ${parentMessageId}`);

        // Store only the last 2 replies for this thread
        const lastTwoReplies = replies
            .sort((a, b) => b.created_at - a.created_at) // Most recent first
            .slice(0, 2) // Take last 2
            .reverse() // Oldest first for display
            .map(reply => ({
                messageId: reply.message_id,
                message: reply.message || '',
                user: reply.user?.nickname || reply.user?.name || 'Unknown',
                createdAt: reply.created_at,
                userAvatar: reply.user?.profile_url || reply.user?.avatar || null
            }));

        this.threadReplies.set(parentMessageId, lastTwoReplies);

        this.logger.debug(`💾 Cached ${lastTwoReplies.length} replies for thread ${parentMessageId}`);

        // Refresh threads to include reply data
        if (channelUrl === this.currentChannelUrl) {
            const threads = this.extractThreads(channelUrl);
            this.channelThreads.set(channelUrl, threads);

            // Notify UI to refresh
            this.notifyUIUpdate(channelUrl);
        }
    }

    /**
     * Extract threads from message cache
     * @param {string} channelUrl - Channel URL
     * @param {string} sortBy - Sort option: 'lastReply' (default) or 'threadStart'
     */
    extractThreads(channelUrl, sortBy = 'lastReply') {
        const messageCache = this.channelMessages.get(channelUrl);
        if (!messageCache) return [];

        const threadReads = JSON.parse(localStorage.getItem('threadReads') || '{}');
        const threads = [];

        for (const [msgId, msg] of messageCache) {
            if (msg.thread_info && msg.thread_info.reply_count > 0) {
                // Only skip currently open thread if WorkVivo's thread panel is actually open
                if (this.currentOpenThreadId && msgId === this.currentOpenThreadId && this.isThreadPanelOpen) {
                    this.logger.debug(`🚫 Skipping currently open thread in WorkVivo panel: ${msgId}`);
                    continue;
                }

                const lastRead = threadReads[msgId] || 0;
                const lastReply = msg.thread_info.last_replied_at || 0;
                const isUnread = lastReply > lastRead;

                threads.push({
                    messageId: msgId,
                    message: msg.message || '',
                    replyCount: msg.thread_info.reply_count,
                    lastRepliedAt: lastReply,
                    lastReadAt: lastRead,
                    createdAt: msg.created_at,
                    user: msg.user?.nickname || msg.user?.name || 'Unknown',
                    isUnread: isUnread,
                    hasAttachment: !!(msg.file || msg.files?.length > 0 || msg.type === 'file'),
                    userAvatar: msg.user?.profile_url || msg.user?.avatar || null,
                    lastTwoReplies: this.threadReplies.get(msgId) || []
                });
            }
        }

        // Sort based on sortBy parameter
        if (sortBy === 'threadStart') {
            // Sort by thread creation time (oldest first for thread start)
            threads.sort((a, b) => b.createdAt - a.createdAt);
        } else {
            // Default: Sort by last replied at (most recent first)
            threads.sort((a, b) => b.lastRepliedAt - a.lastRepliedAt);
        }

        return threads;
    }

    /**
     * Update metadata in localStorage
     */
    updateMetadata(channelUrl, threads) {
        try {
            const metadata = this.loadMetadataFromStorage();

            metadata[channelUrl] = {
                unreadCount: threads.filter(t => t.isUnread).length,
                totalCount: threads.length,
                lastUpdate: Date.now(),
                version: this.config.metadataVersion
            };

            localStorage.setItem(this.config.localStorageKey, JSON.stringify(metadata));

            this.logger.debug(`💾 Updated metadata for ${channelUrl}:`, metadata[channelUrl]);
        } catch (error) {
            this.logger.warn('⚠️ Failed to update metadata in localStorage:', error);
        }
    }

    /**
     * Notify UI to update thread button badge + panel (called after thread data changes)
     */
    notifyUIUpdate(channelUrl) {
        this.logger.debug('🔔 notifyUIUpdate called:', { channelUrl, currentChannelUrl: this.currentChannelUrl, match: channelUrl === this.currentChannelUrl });

        // Only refresh if this is the current channel
        if (channelUrl === this.currentChannelUrl) {
            this.logger.debug('✅ Channel matches - refreshing UI');
            this.logger.debug('🔔 Notifying UI to refresh thread button + panel for current channel');

            // Trigger UI refresh via DomManager
            this.logger.debug('🔍 Checking DomManager:', !!(WVFavs && WVFavs.DomManager));
            if (WVFavs && WVFavs.DomManager) {
                const messageSection = document.querySelector('[data-testid="message-section"]');
                this.logger.debug('🔍 messageSection found:', !!messageSection);
                if (messageSection) {
                    const chatHeader = messageSection.querySelector('.tw-p-4.tw-border-b.tw-border-slate-200.tw-rounded-t-lg.tw-absolute.tw-top-0');
                    this.logger.debug('🔍 chatHeader found:', !!chatHeader);
                    if (chatHeader) {
                        this.logger.debug('✅ Calling refreshThreadButton');
                        // Refresh thread button badge
                        WVFavs.DomManager.refreshThreadButton(chatHeader);
                    } else {
                        this.logger.debug('❌ chatHeader not found - cannot refresh thread button');
                    }

                    // ALSO refresh panel if it's open
                    const panel = document.querySelector('.wv-favorites-thread-panel');
                    this.logger.debug('🔍 panel found:', !!panel, 'channelUrl match:', panel?.dataset.channelUrl === channelUrl);
                    if (panel && panel.dataset.channelUrl === channelUrl) {
                        // Check if any thread is currently open in WorkVivo
                        const threadPanel = document.querySelector('[data-testid="thread-message-section"]');
                        let openThreadMessageId = null;
                        if (threadPanel) {
                            const firstMessage = threadPanel.querySelector('[id^="message-"]');
                            if (firstMessage) {
                                openThreadMessageId = firstMessage.id.replace('message-', '');
                            }
                        }

                        this.logger.debug('🔍 openThreadMessageId:', openThreadMessageId);
                        // Only refresh if no thread is actively open
                        if (!openThreadMessageId) {
                            this.logger.debug('✅ Dispatching panel refresh event');
                            this.logger.debug('🔄 Panel is open, triggering re-render');
                            // Dispatch custom event to trigger panel refresh
                            window.dispatchEvent(new CustomEvent('wv-thread-panel-refresh', {
                                detail: { channelUrl }
                            }));
                        } else {
                            this.logger.debug('⏸️ Skipping panel refresh - thread is open:', openThreadMessageId);
                        }
                    }
                } else {
                    this.logger.debug('❌ messageSection not found - cannot refresh UI');
                }
            } else {
                this.logger.debug('❌ DomManager not available - cannot refresh UI');
            }
        } else {
            this.logger.debug('⏸️ Skipping UI refresh - channel does not match current channel');
        }
    }

    /**
     * Load metadata from localStorage
     */
    loadMetadataFromStorage() {
        try {
            const data = localStorage.getItem(this.config.localStorageKey);
            return data ? JSON.parse(data) : {};
        } catch (error) {
            this.logger.warn('⚠️ Failed to load metadata from localStorage:', error);
            return {};
        }
    }

    /**
     * Check thread panel status (called by EventHandler's MutationObserver)
     * This replaces the old observeThreadPanel() method
     */
    checkThreadPanelStatus() {
        if (!this.enabled) return;
        this.detectOpenThread();
    }

    /**
     * Detect currently open thread from DOM
     */
    detectOpenThread() {
        const threadPanel = document.querySelector('[data-testid="thread-message-section"]');

        if (threadPanel && !this.isThreadPanelOpen) {
            // Thread panel just opened
            this.isThreadPanelOpen = true;
            this.logger.debug('🔓 Thread panel opened');

            // Try to extract thread message ID
            const parentMessage = threadPanel.querySelector('[data-testid="message-container"]');
            if (parentMessage) {
                const messageText = parentMessage.textContent;

                // Find matching message in cache
                const messageCache = this.channelMessages.get(this.currentChannelUrl);
                if (messageCache) {
                    for (const [msgId, msg] of messageCache) {
                        if (msg.message && messageText.includes(msg.message.substring(0, 40))) {
                            this.currentOpenThreadId = msgId;
                            this.logger.debug(`🎯 Detected open thread: ${msgId}`);

                            // Mark as read in localStorage
                            const threadReads = JSON.parse(localStorage.getItem('threadReads') || '{}');
                            threadReads[msgId] = Date.now();
                            localStorage.setItem('threadReads', JSON.stringify(threadReads));

                            // Track analytics
                            if (this.logger.analytics) {
                                this.logger.analytics('thread_opened', {
                                    channel_id: this.currentChannelUrl,
                                    thread_message_id: msgId,
                                    reply_count: msg.thread_info?.reply_count || 0
                                });
                            }

                            // Refresh threads
                            const threads = this.extractThreads(this.currentChannelUrl);
                            this.channelThreads.set(this.currentChannelUrl, threads);
                            this.updateMetadata(this.currentChannelUrl, threads);

                            break;
                        }
                    }
                }
            }
        } else if (!threadPanel && this.isThreadPanelOpen) {
            // Thread panel closed
            this.isThreadPanelOpen = false;
            this.currentOpenThreadId = null;
            this.logger.debug('🔒 Thread panel closed');

            // Refresh threads
            if (this.currentChannelUrl) {
                const threads = this.extractThreads(this.currentChannelUrl);
                this.channelThreads.set(this.currentChannelUrl, threads);
                this.updateMetadata(this.currentChannelUrl, threads);
            }
        }
    }

    /**
     * Enforce memory limit (LRU cache)
     */
    enforceMemoryLimit() {
        if (this.channelMessages.size > this.config.maxChannelsInMemory) {
            // Find oldest channel (not current)
            let oldestChannel = null;
            let oldestTime = Infinity;

            const metadata = this.loadMetadataFromStorage();

            for (const [channelUrl] of this.channelMessages) {
                if (channelUrl === this.currentChannelUrl) continue;

                const lastUpdate = metadata[channelUrl]?.lastUpdate || 0;
                if (lastUpdate < oldestTime) {
                    oldestTime = lastUpdate;
                    oldestChannel = channelUrl;
                }
            }

            if (oldestChannel) {
                this.channelMessages.delete(oldestChannel);
                this.channelThreads.delete(oldestChannel);
                this.logger.debug(`🗑️ Evicted old channel from memory: ${oldestChannel}`);
            }
        }
    }

    /**
     * PUBLIC API: Get thread metadata for a channel
     */
    getThreadMetadata(channelUrl) {
        if (!this.enabled) return null;

        const metadata = this.loadMetadataFromStorage();
        return metadata[channelUrl] || null;
    }

    /**
     * PUBLIC API: Get full threads for current channel
     * @param {string} sortBy - Sort option: 'lastReply' (default) or 'threadStart'
     */
    getCurrentThreads(sortBy = 'lastReply') {
        if (!this.enabled || !this.currentChannelUrl) return [];

        // If sorting differs from cached, re-extract with new sort
        if (sortBy !== 'lastReply') {
            return this.extractThreads(this.currentChannelUrl, sortBy);
        }

        return this.channelThreads.get(this.currentChannelUrl) || [];
    }

    /**
     * PUBLIC API: Check if thread panel is open
     */
    isThreadPanelCurrentlyOpen() {
        return this.isThreadPanelOpen;
    }

    /**
     * PUBLIC API: Get current channel URL
     */
    getCurrentChannel() {
        return this.currentChannelUrl;
    }

    /**
     * PUBLIC API: Get message cache for a specific channel (for DomManager to access)
     */
    getMessageCache(channelUrl) {
        return this.channelMessages.get(channelUrl);
    }

    /**
     * PUBLIC API: Get stats for debugging
     */
    getStats() {
        return {
            enabled: this.enabled,
            channels: this.channelMessages.size,
            currentChannel: this.currentChannelUrl,
            messagesInCurrentChannel: this.channelMessages.get(this.currentChannelUrl)?.size || 0,
            threadsInCurrentChannel: this.channelThreads.get(this.currentChannelUrl)?.length || 0,
            isThreadPanelOpen: this.isThreadPanelOpen,
            currentOpenThreadId: this.currentOpenThreadId,
            metadataChannels: Object.keys(this.loadMetadataFromStorage()).length
        };
    }

    /**
     * PUBLIC API: Refresh threads for current channel
     */
    refreshCurrentChannel() {
        if (!this.enabled || !this.currentChannelUrl) return;

        const threads = this.extractThreads(this.currentChannelUrl);
        this.channelThreads.set(this.currentChannelUrl, threads);
        this.updateMetadata(this.currentChannelUrl, threads);

        this.logger.debug(`🔄 Refreshed ${threads.length} threads for current channel`);
    }

    /**
     * PUBLIC API: Refresh from notification (triggered by sidebar/message changes)
     * Forces a fresh data fetch from API and updates thread cache
     */
    async refreshFromNotification() {
        if (!this.enabled || !this.currentChannelUrl) return;

        // Guard: Only refresh if we're in a valid message view
        const messageSection = document.querySelector('[data-testid="message-section"]');
        if (!messageSection) {
            this.logger.debug('⏸️ Skip refresh: not in message view');
            return;
        }

        // Guard: Only refresh if thread panel is open (no point refreshing if closed)
        const panel = document.querySelector('.wv-favorites-thread-panel');
        if (!panel) {
            this.logger.debug('⏸️ Skip refresh: thread panel not open');
            return;
        }

        // Guard: Verify panel is for the current channel
        const panelChannelUrl = panel.dataset.channelUrl;
        if (panelChannelUrl !== this.currentChannelUrl) {
            this.logger.debug(`⏸️ Skip refresh: panel channel (${panelChannelUrl}) !== current (${this.currentChannelUrl})`);
            return;
        }

        this.logger.debug('📬 Notification-triggered refresh - fetching fresh thread data');

        try {
            // Trigger a small scroll to force WorkVivo to fetch latest messages
            const messageList = document.querySelector('[data-testid="message-list"]') ||
                              document.querySelector('[class*="message"][class*="list"]') ||
                              document.querySelector('[class*="chat"][class*="content"]');

            if (messageList) {
                // Tiny scroll that won't be noticeable to user
                const originalScroll = messageList.scrollTop;
                messageList.scrollTop = originalScroll + 1;
                messageList.dispatchEvent(new Event('scroll', { bubbles: true }));

                // Wait briefly for API call
                await new Promise(resolve => setTimeout(resolve, 100));

                // Restore scroll position
                messageList.scrollTop = originalScroll;

                this.logger.debug('✅ Triggered API fetch via scroll');
            }

            // The processMessagesEndpoint() will be called automatically when the API responds
            // and will update the cache, which the auto-refresh will pick up

        } catch (error) {
            this.logger.error('❌ Error in refreshFromNotification:', error);
        }
    }

    /**
     * PUBLIC API: Mark a thread as read
     */
    markThreadAsRead(messageId) {
        if (!this.enabled) return;

        this.logger.debug(`📖 Marking thread as read: ${messageId}`);

        // Update threadReads in localStorage with a timestamp that's definitely in the future
        // Add 1000ms buffer to handle any clock skew or timing issues
        const threadReads = JSON.parse(localStorage.getItem('threadReads') || '{}');
        threadReads[messageId] = Date.now() + 1000;
        localStorage.setItem('threadReads', JSON.stringify(threadReads));

        this.logger.debug(`✅ Thread ${messageId} marked as read at ${threadReads[messageId]}`);

        // Don't set currentOpenThreadId here - let detectOpenThread handle it
        // This prevents the thread from being excluded from the list prematurely

        // Refresh threads to update unread status
        if (this.currentChannelUrl) {
            const threads = this.extractThreads(this.currentChannelUrl);
            this.channelThreads.set(this.currentChannelUrl, threads);
            this.updateMetadata(this.currentChannelUrl, threads);

            // Notify UI to update the thread button and list
            this.notifyUIUpdate(this.currentChannelUrl);
        }
    }

    /**
     * PUBLIC API: Get date range of threads
     */
    getThreadDateRange(threads) {
        if (!threads || threads.length === 0) {
            return null;
        }

        const oldestThreadTime = Math.min(...threads.map(t => t.createdAt));
        const newestReplyTime = Math.max(...threads.map(t => t.lastRepliedAt));
        const oldestReplyTime = Math.min(...threads.map(t => t.lastRepliedAt));
        const newestThreadTime = Math.max(...threads.map(t => t.createdAt));

        return {
            oldestThread: oldestThreadTime,
            newestThread: newestThreadTime,
            oldestReply: oldestReplyTime,
            newestReply: newestReplyTime,
            oldestThreadDate: new Date(oldestThreadTime).toLocaleDateString(),
            newestThreadDate: new Date(newestThreadTime).toLocaleDateString(),
            oldestReplyDate: new Date(oldestReplyTime).toLocaleDateString(),
            newestReplyDate: new Date(newestReplyTime).toLocaleDateString(),
            threadCount: threads.length,
            unreadCount: threads.filter(t => t.isUnread).length
        };
    }

    /**
     * Cleanup - call on extension unload
     */
    destroy() {
        this.channelMessages.clear();
        this.channelThreads.clear();

        this.logger.info('🧹 ThreadManager destroyed');
    }
};

// Expose for debugging
if (typeof window !== 'undefined') {
    window.wvThreadManager = null; // Will be set when initialized
}
