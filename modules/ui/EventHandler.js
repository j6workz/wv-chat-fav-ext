var WVFavs = WVFavs || {};

WVFavs.EventHandler = new (class EventHandler {
    constructor() {
        // Track last processed channel to prevent duplicate recordChatInteraction calls
        this.lastProcessedChannel = null;
        this.lastProcessedTime = 0;
        this.processingDebounceMs = 3000; // 3 second debounce window
    }

    init(app) {
        this.app = app;

        // Listen for channel changes to record chat interactions
        window.addEventListener('wv-channel-changed', async (event) => {
            const { currentChannel, source, channelData } = event.detail;

            // DEDUPLICATION 1: Skip if we just processed a sidebar click (prevents duplicate records)
            if (this.app.lastClickedSidebarChat) {
                const timeSinceClick = Date.now() - this.app.lastClickedSidebarChat.timestamp;
                if (timeSinceClick < 2000) { // Within 2 seconds of click
                    this.app?.logger?.log(`⏭️ [DEDUP-1] Skipping channel change - handled by sidebar click (${timeSinceClick}ms ago)`);
                    return;
                }
            }

            // DEDUPLICATION 2: Debounce same channel within time window
            // This prevents multiple wv-channel-changed events from different sources from causing duplicate writes
            const now = Date.now();
            const timeSinceLastProcess = now - this.lastProcessedTime;
            const isSameChannel = this.lastProcessedChannel === currentChannel;

            if (isSameChannel && timeSinceLastProcess < this.processingDebounceMs) {
                this.app?.logger?.log(`⏭️ [DEDUP-2] Skipping duplicate channel event - same channel processed ${timeSinceLastProcess}ms ago (source: ${source})`);
                return;
            }

            // Record chat interaction when channel is detected (from any source)
            if (currentChannel) {
                try {
                    let chatInfo;

                    // CRITICAL FIX: Always fetch from Sendbird API for channel_urls to prevent race conditions
                    if (currentChannel && currentChannel.startsWith('sendbird_group_channel_')) {
                        // WorkVivo doesn't call channel details endpoint on every navigation
                        // We MUST actively fetch it ourselves to avoid race conditions
                        this.app?.logger?.log(`🔄 [RACE-FIX] Fetching channel metadata from API:`, currentChannel);

                        try {
                            // Use APIManager.getChannelInfo which properly handles script context
                            const channelData = await this.app.APIManager.getChannelInfo(currentChannel);

                            if (channelData && channelData.name) {
                                this.app?.logger?.log(`✅ [RACE-FIX] Got channel data from API:`, channelData.name);

                                // Extract metadata from API response (not DOM!)
                                chatInfo = {
                                    id: channelData.channel_url,
                                    name: channelData.name,
                                    avatar: channelData.cover_url,
                                    channel_url: channelData.channel_url,
                                    userId: null,
                                    is_distinct: channelData.is_distinct,
                                    member_count: channelData.member_count,
                                    custom_type: channelData.custom_type,
                                    source: 'sendbird_api_via_manager'
                                };

                                // For 1:1 DMs, extract the OTHER user's data from members
                                if (channelData.is_distinct === true && channelData.members?.length > 0) {
                                    const currentUserId = window.WVFavsExtension?.userIdentity?.currentUser?.id;
                                    const otherMember = channelData.members.find(m =>
                                        m.user_id !== currentUserId && m.user_id !== null
                                    );

                                    if (otherMember) {
                                        chatInfo.userId = otherMember.user_id;
                                        chatInfo.name = otherMember.nickname || otherMember.name || chatInfo.name;
                                        chatInfo.avatar = otherMember.profile_url || chatInfo.avatar;
                                    }
                                }
                            } else {
                                throw new Error('No channel data from API');
                            }
                        } catch (apiError) {
                            // CRITICAL: Never fall back to DOM - only use API data
                            // DOM extraction causes mass corruption during re-initialization
                            this.app?.logger?.warn(`⚠️ [SKIP-WRITE] API failed, skipping write (not using DOM):`, apiError.message);
                            chatInfo = null; // Skip this write - no DOM fallback
                        }
                    } else {
                        // Non-sendbird channels - use DOM extraction
                        chatInfo = await this.extractCurrentChatInfo(currentChannel);
                    }

                    if (chatInfo) {
                        this.app?.logger?.log(`📊 Recording chat from channel change (source: ${source}):`, chatInfo.name);

                        // Check if avatar is expired and needs refresh from Sendbird
                        const needsAvatarRefresh = await this.checkAvatarExpiration(chatInfo.name);

                        if (needsAvatarRefresh && currentChannel?.startsWith('sendbird_')) {
                            this.app?.logger?.log('🔄 Avatar expired/missing, fetching fresh from Sendbird:', chatInfo.name);
                            const sendbirdAvatar = await this.fetchSendbirdAvatar(currentChannel, chatInfo.name);
                            if (sendbirdAvatar) {
                                // Add expiration tracking to Sendbird avatar
                                chatInfo.avatar = this.addAvatarExpiration(sendbirdAvatar);
                                this.app?.logger?.log('✅ Updated avatar from Sendbird for:', chatInfo.name);
                            }
                        }

                        // Update deduplication tracking BEFORE calling updateHistory
                        this.lastProcessedChannel = currentChannel;
                        this.lastProcessedTime = now;

                        await this.app.chatHistory.updateHistory(chatInfo, this.app, true);
                    }
                } catch (error) {
                    this.app?.logger?.warn('Failed to record chat from channel change:', error);
                }
            }
        });
    }

    setupHotkeys() {
        this.app?.logger?.log('⌨️ Setting up enhanced hotkeys...');

        const isMac = navigator.userAgent.toUpperCase().indexOf('MAC') >= 0;

        document.addEventListener('keydown', (e) => {
            const modifierKey = this.app.isModifierKeyPressed(e);

            // Enhanced quick search shortcuts (NEW: swapped with chat switcher)
            // Mac: Cmd+/ or Cmd+;
            // Windows/Linux: Alt+/ or Alt+;
            let isQuickSearchKey = false;

            if (modifierKey) {
                // Check slash key variations (PRIMARY for search)
                const isSlashKey = e.key === '/' ||
                                  e.key === '?' || // Shift+/ on some layouts
                                  e.code === 'Slash' ||
                                  e.keyCode === 191;

                // Check semicolon key as alternative
                const isSemicolonKey = e.key === ';' ||
                                      e.key === ':' || // Shift+; on some layouts
                                      e.code === 'Semicolon' ||
                                      e.keyCode === 186;

                isQuickSearchKey = isSlashKey || isSemicolonKey;
            }

            if (isQuickSearchKey) {
                e.preventDefault();
                e.stopPropagation();
                const platform = isMac ? 'Mac (Cmd+/)' : 'Windows/Linux (Alt+/)';
                this.app?.logger?.log(`🔍 Quick search shortcut pressed on ${platform}:`, { key: e.key, code: e.code, keyCode: e.keyCode });
                this.openQuickSearch();
                return;
            }

            // Close chat switcher on Escape (highest priority)
            // Use robust escape detection
            const isEscapeKey = e.key === 'Escape' ||
                               e.key === 'Esc' ||
                               e.code === 'Escape' ||
                               e.keyCode === 27;

            if (isEscapeKey) {
                if (this.app.chatSwitcherOpen) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.app?.logger?.log('🔄 Escape pressed - closing chat switcher (blocking other actions)');
                    this.closeChatSwitcher();
                    return;
                }
                if (this.app.quickSearchOpen) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.closeQuickSearch('escape_key');
                    return;
                }
                // Close mentions panel on Escape
                // DISABLED: Mentions panel is hidden
                /*
                if (this.app.mentionsPanel && this.app.mentionsPanel.isPanelOpen()) {
                    e.preventDefault();
                    e.stopPropagation();
                    this.app?.logger?.log('📧 Escape pressed - closing mentions panel');
                    this.app.mentionsPanel.closeMentionsPanel();
                    return;
                }
                */
            }

            // Mentions panel shortcut: Cmd+M (Mac) or Alt+M (Windows/Linux)
            // DISABLED: Mentions panel is hidden, but API still runs in background for thread tagging
            /*
            if (modifierKey && (e.key === 'm' || e.key === 'M')) {
                e.preventDefault();
                e.stopPropagation();
                const platform = isMac ? 'Mac (Cmd+M)' : 'Windows/Linux (Alt+M)';
                this.app?.logger?.log(`📧 Mentions shortcut pressed on ${platform}`);

                if (this.app.mentionsPanel) {
                    this.app.mentionsPanel.openMentionsPanel();
                }
                return;
            }
            */

            // Enhanced chat switcher shortcuts (NEW: using backslash for both OS)
            // Mac: Cmd+\
            // Windows/Linux: Alt+\
            // IMPORTANT: Only allow when quick search is NOT open AND chat switcher is NOT already open
            let isChatSwitcherKey = false;

            if (!this.app.quickSearchOpen && !this.app.chatSwitcherOpen && modifierKey) {
                // Check backslash key variations (PRIMARY for chat switcher on both OS)
                const isBackslashKey = e.key === '\\' ||
                                      e.key === '|' || // Shift+\ on some layouts
                                      e.code === 'Backslash' ||
                                      e.keyCode === 220;

                isChatSwitcherKey = isBackslashKey;

                if (isChatSwitcherKey) {
                    const keyDesc = isMac ? 'Cmd+\\' : 'Alt+\\';
                    const platform = isMac ? `Mac (${keyDesc})` : `Windows/Linux (${keyDesc})`;
                    this.app?.logger?.log(`🔄 Chat switcher shortcut pressed on ${platform}:`, {
                        key: e.key,
                        code: e.code,
                        keyCode: e.keyCode,
                        metaKey: e.metaKey,
                        altKey: e.altKey,
                        repeat: e.repeat,
                        cmdSlashPressed: this.app.cmdSlashPressed,
                        chatSwitcherOpen: this.app.chatSwitcherOpen
                    });
                }
            }

            if (isChatSwitcherKey) {
                e.preventDefault();
                e.stopPropagation();

                // Track this specific combination (with key repeat protection)
                if (!this.app.cmdSlashPressed) {
                    this.app.cmdSlashPressed = true;
                    this.app.cmdSlashPressTime = Date.now();
                    this.app.backslashAlreadyHandled = false; // Reset for new key sequence
                }

                // Handle key press - allow cycling when modal is open
                if (!this.app.backslashAlreadyHandled || this.app.chatSwitcherOpen) {
                    if (!this.app.chatSwitcherOpen) {
                        this.app.backslashAlreadyHandled = true; // Only block repeats for initial press
                    }
                    this.handleChatSwitcher(); // Don't await - let it run async
                }
                return;
            }

            // Handle quick search navigation when open
            // NOTE: Quick search keyboard navigation is handled by the input field listener
            // to avoid double-handling of arrow keys
            if (this.app.quickSearchOpen) {
                return;
            }

            // Handle chat switcher navigation when open
            // NOTE: Chat switcher keyboard navigation is handled by the modal-specific listener
            // to avoid double-handling of arrow keys
            if (this.app.chatSwitcherOpen) {
                return;
            }
        });

        document.addEventListener('keyup', (e) => {
            const isMac = navigator.userAgent.toUpperCase().indexOf('MAC') >= 0;

            // Track chat switcher key release with robust detection (NEW: backslash)
            const isChatSwitcherKeyUp = e.key === '\\' || e.key === '|' || e.code === 'Backslash' || e.keyCode === 220;

            if (isChatSwitcherKeyUp && this.app.cmdSlashPressed) {
                this.app?.logger?.log('🔧 Chat switcher key released (\\)');

                const wasPressed = this.app.cmdSlashPressed;
                const pressTime = this.app.cmdSlashPressTime ? Date.now() - this.app.cmdSlashPressTime : 0;

                this.app.cmdSlashPressed = false;
                this.app.backslashAlreadyHandled = false; // Reset for next key sequence

                // If chat switcher is open, DON'T commit yet - wait for modifier key release
                if (this.app.chatSwitcherOpen) {
                    this.app?.logger?.log('🔄 Chat switcher key released but modal still open - waiting for modifier key release');
                    // Do nothing - let the modifier key release handle the commit
                    return;
                } else if (wasPressed && pressTime < 250) {
                    // Quick release without opening switcher - do simple toggle
                    this.app?.logger?.log('🔄 Quick chat switcher key press detected - doing simple toggle');
                    setTimeout(() => {
                        this.toggleLastChat();
                    }, 50);
                    return;
                }
            }

            // Track modifier key release for committing chat switcher selection
            if (this.app.isModifierKeyReleased(e) && this.app.chatSwitcherOpen) {
                this.app?.logger?.log('🔄 Modifier key released while switcher open - committing to selected chat');
                this.commitChatSwitcherSelection();
            }

            // Debug logging for troubleshooting modifier key issues
            if (this.app.isModifierKeyReleased(e)) {
                this.app?.logger?.log('🔧 Modifier Key Release Debug:', {
                    platform: isMac ? 'Mac' : 'Windows/Linux',
                    key: e.key,
                    chatSwitcherOpen: this.app.chatSwitcherOpen,
                    cmdSlashPressed: this.app.cmdSlashPressed,
                    quickSearchOpen: this.app.quickSearchOpen
                });
            }
        });
    }

    setupClickDetection() {
        this.app?.logger?.log('🔧 Setting up click detection with event delegation...');

        // Remove any existing listener to prevent duplicates
        if (this.clickHandler) {
            document.body.removeEventListener('click', this.clickHandler, true);
        }

        // Also prevent multiple simultaneous setups
        if (this.setupInProgress) {
            this.app?.logger?.debug('🔧 Click detection setup already in progress, skipping...');
            return;
        }
        this.setupInProgress = true;

        // Create the click handler function
        this.clickHandler = (event) => {
            // Debug: Log every click to see if event listener is working
            this.app?.logger?.debug('🖱️ Click event detected on:', event.target);

            // Try multiple selectors to find chat buttons
            let chatButton = event.target.closest('[data-testid="channel-list"] button.tw-block.tw-w-full.tw-p-2.tw-rounded-lg');

            // Fallback: try a more flexible selector
            if (!chatButton) {
                chatButton = event.target.closest('[data-testid="channel-list"] button.tw-block.tw-w-full.tw-p-2');
            }

            // Another fallback: any button in channel list with block styling
            if (!chatButton) {
                chatButton = event.target.closest('[data-testid="channel-list"] button.tw-block.tw-w-full');
            }
            this.app?.logger?.debug('🔍 Searching for chat button, found:', !!chatButton);

            if (chatButton) {
                this.app?.logger?.debug('✅ Chat button element:', chatButton);
                this.app?.logger?.debug('📝 Button text content:', chatButton.textContent.trim());

                const inPinnedSection = chatButton.closest('.wv-favorites-pinned-section');
                this.app?.logger?.log('📌 In pinned section:', !!inPinnedSection);
            }

            if (chatButton && !chatButton.closest('.wv-favorites-pinned-section')) {
                this.app?.logger?.debug('🚀 Processing chat button click...');

                this.app?.logger?.debug('🧹 Extracting chat name from sidebar...');
                const cleanName = WVFavs.DomDataExtractor.extractChatNameFromSidebar(chatButton);
                this.app?.logger?.debug('🧹 Extracted name result:', cleanName);

                this.app?.logger?.debug('🆔 Generating chat ID...');
                const chatId = WVFavs.DomDataExtractor.generateChatId(chatButton);
                this.app?.logger?.debug('🆔 Generated ID:', chatId);

                const chatInfo = {
                    name: cleanName,
                    id: chatId,
                    avatar: this.extractAvatarFromButton(chatButton), // Extract avatar from DOM
                    element: chatButton
                    // Note: type will be determined by hitting both API endpoints
                };

                this.app?.logger?.debug('📋 Created chat info:', chatInfo);

                this.app.lastClickedSidebarChat = {
                    chatInfo,
                    timestamp: Date.now()
                };

                this.app?.logger?.debug('🖱️ Detected sidebar chat click:', chatInfo.name);
                this.app?.logger?.log('🖱️ Detected sidebar chat click:', chatInfo.name);

                // Smart data refresh: Check DB and fetch fresh data
                setTimeout(async () => {
                    this.app?.logger?.debug('⏰ Smart refresh timeout executed');
                    try {
                        // IMPORTANT: Don't save basic record first, wait for enriched data
                        // This prevents duplicate record creation

                        this.app?.logger?.debug('🚀 Calling smartDataRefresh...');
                        const enrichedChatInfo = await this.smartDataRefresh(chatInfo);

                        if (enrichedChatInfo && enrichedChatInfo !== chatInfo) {
                            this.app?.logger?.debug('📊 Smart refresh returned enhanced data');
                            this.app?.logger?.debug('🔄 Enhanced chat info ID:', enrichedChatInfo.id, 'vs original:', chatInfo.id);

                            // If ID changed (e.g., from name-based to API ID), delete old record first
                            if (enrichedChatInfo.id !== chatInfo.id) {
                                this.app?.logger?.debug('🗑️ ID changed, deleting old record:', chatInfo.id);
                                try {
                                    await this.app.smartUserDB.deleteChat(chatInfo.id);
                                } catch (err) {
                                    this.app?.logger?.debug('⚠️ Could not delete old record (may not exist yet):', err.message);
                                }
                            }

                            // Save the enriched data (with API ID)
                            await this.app.chatHistory.updateHistory(enrichedChatInfo, this.app, true);
                        } else {
                            // CRITICAL: No API data available - DO NOT save DOM-extracted data
                            // DOM extraction causes corruption during re-initialization
                            this.app?.logger?.warn('⚠️ [SKIP-WRITE] No API enrichment available, skipping write (not using DOM)');
                            // DO NOT save chatInfo - it's from DOM extraction
                        }

                        this.app?.logger?.debug('✅ Smart refresh process completed');
                        this.app?.logger?.log('📊 Updated chat history with fresh data:', chatInfo.name);
                    } catch (error) {
                        this.app?.logger?.error('❌ Smart refresh error:', error);
                        this.app?.logger?.log('❌ Failed to smart refresh chat data:', error.message);
                    }
                }, 100); // Small delay to let navigation complete
            }
        };

        // Add the event listener to document body
        document.body.addEventListener('click', this.clickHandler, true);
        this.setupInProgress = false;

        // Also set up periodic re-attachment in case DOM gets completely replaced
        if (!this.reattachmentInterval) {
            this.reattachmentInterval = setInterval(() => {
                // Only re-attach if not currently setting up
                if (!this.setupInProgress) {
                    this.app?.logger?.debug('🔧 Re-attaching click detection due to DOM changes...');
                    this.setupClickDetection();
                }
            }, 5000);
        }
    }

    setupLightweightObserver() {
        if (this.app?.lightweightTimer) {
            clearInterval(this.app.lightweightTimer);
            this.app.lightweightTimer = null;
        }

        if (!this.app) {
            console.warn('⚠️ [STATUS] EventHandler.app not set, skipping lightweight observer');
            return;
        }

        // Track MutationObserver health
        this.mutationObserverLastTrigger = Date.now();
        this.mutationObserverHealthy = true;

        // Check MutationObserver health every 30 seconds
        // Only enable polling if MutationObserver hasn't triggered in 30+ seconds
        this.app.lightweightTimer = setInterval(async () => {
            if (!chrome.runtime?.id) {
                clearInterval(this.app.lightweightTimer);
                return;
            }

            if (!this.app.initialized) return;

            const timeSinceLastMutation = Date.now() - this.mutationObserverLastTrigger;
            const mutationObserverStale = timeSinceLastMutation > 30000; // 30 seconds

            // Only run polling if MutationObserver appears to be failing
            if (mutationObserverStale) {
                if (this.mutationObserverHealthy) {
                    console.warn('⚠️ [WV STATUS] MutationObserver appears stale, enabling fallback polling');
                    this.mutationObserverHealthy = false;
                }

                try {
                    await WVFavs.DomManager.findAndSetupSidebar();

                    const messageSection = document.querySelector('[data-testid="message-section"]');
                    if (messageSection && !this.app.headerPinSetup) {
                        setTimeout(async () => {
                            if (!chrome.runtime?.id) return;
                            await this.app.setupChatHeaderPinButton();
                            this.app.headerPinSetup = true;
                        }, 500);
                    } else if (!messageSection && this.app.headerPinSetup) {
                        this.app.headerPinSetup = false;
                    }
                } catch (error) {
                    if (error.message.includes('Extension context invalidated')) {
                        clearInterval(this.app.lightweightTimer);
                    } else {
                        this.app?.logger?.error('Error in lightweight observer:', error);
                    }
                }
            } else {
                // MutationObserver is working fine
                if (!this.mutationObserverHealthy) {
                    console.log('✅ [WV STATUS] MutationObserver recovered, disabling fallback polling');
                    this.mutationObserverHealthy = true;
                }
            }
        }, 5000);

        this.setupNavigationListener();
    }

    setupNavigationListener() {
        let lastUrl = location.href;
        let lastActiveChat = null;

        try {
            lastActiveChat = WVFavs.DomDataExtractor.getCurrentActiveChatId();
        } catch (error) {
            this.app?.logger?.warn('⚠️ Error getting initial active chat:', error.message);
        }

        this.app?.logger?.debug('🔧 Navigation listener initialized', {
            initialUrl: lastUrl,
            initialChat: lastActiveChat
        });

        new MutationObserver((mutations) => {
            try {
                // Update MutationObserver health tracker
                this.mutationObserverLastTrigger = Date.now();

                const url = location.href;
                const currentActiveChat = WVFavs.DomDataExtractor.getCurrentActiveChatId();

                // Check thread panel status on every DOM change (if ThreadManager is enabled)
                if (this.app.threadManager) {
                    this.app.threadManager.checkThreadPanelStatus();
                }

                // Debug: Log comparison before condition
                const urlChanged = url !== lastUrl;
                const chatChanged = currentActiveChat !== lastActiveChat;

                // Debug: Log every check to see if chat ID is changing
                if (currentActiveChat && currentActiveChat !== lastActiveChat) {
                    this.app?.logger?.log(`🔍 [NAV OBSERVER] Chat ID changed: "${lastActiveChat}" → "${currentActiveChat}"`);
                }

            if (urlChanged || chatChanged) {
                this.app?.logger?.log('🔄 Navigation detected', {
                    urlChanged,
                    chatChanged,
                    oldUrl: lastUrl,
                    newUrl: url,
                    oldChat: lastActiveChat,
                    newChat: currentActiveChat
                });

                lastUrl = url;
                lastActiveChat = currentActiveChat;

                // When chat changes, immediately hide thread badge (will show again when data loads)
                if (chatChanged && currentActiveChat) {
                    this.app?.logger?.debug('📍 Calling detectAndDispatchChannelChange for:', currentActiveChat);

                    // INSTANT CHANNEL DETECTION: Try to get Sendbird channel URL immediately
                    this.detectAndDispatchChannelChange(currentActiveChat);

                    // Immediately update thread button to hide stale badge
                    const messageSection = document.querySelector('[data-testid="message-section"]');
                    if (messageSection) {
                        const chatHeader = messageSection.querySelector('.tw-p-4.tw-border-b.tw-border-slate-200.tw-rounded-t-lg.tw-absolute.tw-top-0');
                        if (chatHeader && this.app.threadManager) {
                            // Hide badge until we get fresh data (no need to await)
                            WVFavs.DomManager.addThreadButtonToChatHeader(chatHeader, true);
                        }
                    }

                    // Trigger fresh thread data fetch to avoid stale data
                    if (this.app.threadManager) {
                        setTimeout(() => {
                            WVFavs.DomManager.triggerMessageLoad();
                            this.app?.logger?.debug('📡 Triggered API fetch for fresh thread data after navigation');
                        }, 100); // Small delay to let WorkVivo settle
                    }

                    // Update chat history when navigation is detected
                    // Skip if ID is name-based (stale sidebar ID) to avoid race conditions
                    if (currentActiveChat && !String(currentActiveChat).startsWith('name_')) {
                        this.updateChatHistoryFromNavigation(currentActiveChat);
                    }
                }

                this.app.headerPinSetup = false;

                setTimeout(async () => {
                    await WVFavs.DomManager.findAndSetupSidebar();

                    // Check for pending new chat creation
                    this.checkForPendingNewChat();

                    const messageSection = document.querySelector('[data-testid="message-section"]');
                    if (messageSection) {
                        const chatHeader = messageSection.querySelector('.tw-p-4.tw-border-b.tw-border-slate-200.tw-rounded-t-lg.tw-absolute.tw-top-0');
                        if (chatHeader) {
                            const avatarContainer = chatHeader.querySelector('.tw-w-8.tw-h-8.tw-mr-3');
                            if (avatarContainer) {
                                WVFavs.DomManager.removePinUIFromHeader(avatarContainer);
                            }
                            await this.app.setupChatHeaderPinButton();
                        }
                    }
                }, 300);
            }
            } catch (error) {
                this.app?.logger?.warn('⚠️ Error in navigation listener:', error.message);
            }
        }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
    }

    async updateChatHistoryFromNavigation(chatId) {
        try {
            // CRITICAL: Only use API data, never DOM extraction
            // The wv-channel-changed event already handles sendbird channels with API data
            // This function is only for non-sendbird channels (if any exist)

            if (chatId && chatId.startsWith('sendbird_group_channel_')) {
                this.app?.logger?.log('🔄 Sendbird channel - wv-channel-changed event will handle this');
                return; // Skip - wv-channel-changed listener handles sendbird channels with API
            }

            // For non-sendbird channels (legacy/edge cases), extract from DOM
            // TODO: Investigate if these non-sendbird channels actually exist
            const chatInfo = await this.extractCurrentChatInfo(chatId);
            if (chatInfo) {
                this.app?.logger?.log('📊 Updating chat history from navigation (non-sendbird):', chatInfo.name);
                await this.app.chatHistory.updateHistory(chatInfo, this.app, true);
            }
        } catch (error) {
            this.app?.logger?.log('❌ Failed to update chat history from navigation:', error.message);
        }
    }

    async extractCurrentChatInfo(chatId) {
        // This function extracts chat info when a channel change is detected
        // It should extract avatar from the active sidebar chat

        const extractStartTime = Date.now();
        this.app?.logger?.log('🔍 Extracting current chat info for channel:', chatId);

        // Try to get the active sidebar button to extract avatar
        const activeSidebarButton = document.querySelector('button.tw-bg-primary-50.tw-text-primary-600');
        let avatarData = null;

        if (activeSidebarButton) {
            this.app?.logger?.log('✅ Found active sidebar button, extracting avatar...');
            avatarData = this.extractAvatarFromButton(activeSidebarButton);
        } else {
            this.app?.logger?.warn('⚠️ No active sidebar button found for avatar extraction');
        }

        // Try to get chat info from header first
        const messageSection = document.querySelector('[data-testid="message-section"]');
        if (messageSection) {
            const chatHeader = messageSection.querySelector('.tw-p-4.tw-border-b.tw-border-slate-200.tw-rounded-t-lg.tw-absolute.tw-top-0');
            if (chatHeader) {
                let chatName = WVFavs.DomDataExtractor.extractChatNameFromHeader(chatHeader);

                // Handle self-channels with empty names
                if (!chatName || chatName.trim() === '') {
                    try {
                        // Try to get channel info from API to check if it's a self-channel
                        const channelInfo = await this.app.APIManager?.getChannelInfo(chatId);
                        if (channelInfo && channelInfo.custom_type === 'self_channel') {
                            // Get display name for self-channel
                            chatName = await this.app.smartUserDatabase?.getSelfChannelDisplayName(channelInfo);

                            const result = {
                                id: chatId,
                                name: chatName,
                                avatar: avatarData,
                                channel_url: chatId,
                                custom_type: 'self_channel',
                                is_distinct: true,
                                member_count: 1,
                                isSelfChannel: true,
                                navigation: {
                                    currentChatUrl: window.location.href,
                                    chatNameForSearch: chatName
                                }
                            };
                            return result;
                        }
                    } catch (err) {
                        this.app?.logger?.warn('⚠️ Failed to check for self-channel:', err);
                    }
                }

                if (chatName) {
                    const result = {
                        id: chatId,
                        name: WVFavs.Helpers.cleanChatName(chatName),
                        avatar: avatarData, // CRITICAL: Include avatar
                        channel_url: chatId && String(chatId).startsWith('sendbird_') ? chatId : undefined,
                        navigation: {
                            currentChatUrl: window.location.href,
                            chatNameForSearch: chatName
                        }
                    };
                    return result;
                }
            }
        }

        // Fallback: try to get from sidebar
        const sidebarInfo = WVFavs.DomDataExtractor.extractActiveSidebarChatInfo();
        if (sidebarInfo && sidebarInfo.name) {
            const result = {
                id: chatId,
                name: WVFavs.Helpers.cleanChatName(sidebarInfo.name),
                avatar: avatarData, // CRITICAL: Include avatar
                channel_url: chatId && String(chatId).startsWith('sendbird_') ? chatId : undefined,
                navigation: {
                    currentChatUrl: window.location.href,
                    chatNameForSearch: sidebarInfo.name
                }
            };
            return result;
        }

        this.app?.logger?.warn('⚠️ Failed to extract chat info - returning null', chatId);
        return null;
    }

    checkForPendingNewChat() {
        const pendingChatData = sessionStorage.getItem('wv-fav-new-chat-user');
        if (pendingChatData && window.location.pathname.includes('/messages')) {
            try {
                const userData = JSON.parse(pendingChatData);
                sessionStorage.removeItem('wv-fav-new-chat-user'); // Clean up

                this.app?.logger?.log('🔄 Found pending new chat creation for:', userData.name);

                // Try to initiate new chat on messages page
                setTimeout(() => {
                    this.initiateChatFromMessagesPage(userData);
                }, 1000); // Wait for page to load

            } catch (error) {
                this.app?.logger?.log('❌ Failed to parse pending chat data:', error);
                sessionStorage.removeItem('wv-fav-new-chat-user');
            }
        }
    }

    async initiateChatFromMessagesPage(userData) {
        // Try to find and click new message button on messages page
        const success = await this.findAndClickNewMessageButton(userData);
        if (success) {
            this.app?.logger?.log('✅ Successfully initiated chat from messages page');
            WVFavs.DomManager.showSnackbar(`Creating chat with ${userData.name}`, 'success');
        } else {
            this.app?.logger?.log('⚠️ Could not find new message button on messages page');
            WVFavs.DomManager.showSnackbar(`Please manually start a new chat with ${userData.name}`, 'info');
        }
    }

    showSearchUI() {
        // Alias for openQuickSearch - used by FloatingSearchWidget
        this.openQuickSearch('floating_button');
    }

    openQuickSearch(source = 'keyboard_shortcut') {
        // Guard: Check if on chat page
        if (!this.app.isOnChatPage()) {
            this.app.handleNonChatPageAction('openQuickSearch', () => this.openQuickSearch(source));
            return;
        }

        if (this.app.quickSearchOpen) {
            const input = document.querySelector('.wv-favorites-quick-search-input');
            if (input) {
                input.focus();
            }
            return;
        }

        // Track search widget opened with new analytics system
        if (this.app.logger) {
            this.app?.logger?.analytics('search_widget_opened', {
                action_method: source
            });
        }

        // Track feature discovery (Phase 4 user engagement analytics)
        if (this.app.trackFeatureDiscovery) {
            this.app.trackFeatureDiscovery('search_widget', source);
        }

        // Legacy tracking for backwards compatibility
        if (this.app.statsManager) {
            this.app.statsManager.recordSearchWidgetOpened();
        }

        this.app.quickSearchOpen = true;
        this.app.selectedSearchIndex = 0;

        const modal = document.createElement('div');
        modal.className = 'wv-favorites-quick-search-backdrop';
        modal.innerHTML = `
            <div class="wv-favorites-quick-search-modal">
                <div class="wv-favorites-quick-search-header">
                    <input
                        type="text"
                        class="wv-favorites-quick-search-input"
                        placeholder="Search pinned and recent chats..."
                        autocomplete="off"
                        spellcheck="false"
                    >
                </div>
                <div class="wv-favorites-quick-search-content">
                    <div class="wv-favorites-quick-search-results">
                        <div class="wv-favorites-quick-search-loading">Loading...</div>
                    </div>
                </div>
                <div class="wv-favorites-quick-search-hint">
                    <button class="wv-favorites-quick-search-settings-btn" title="Open extension settings">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="3"></circle>
                            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                        </svg>
                        <span>Settings</span>
                    </button>
                    <button class="wv-favorites-quick-search-native-btn" title="Open WorkVivo's native search">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="11" cy="11" r="8"></circle>
                            <path d="M21 21l-4.35-4.35"></path>
                        </svg>
                        <span>WorkVivo Search</span>
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // Trigger animation
        requestAnimationFrame(() => {
            modal.classList.add('open');
        });

        const input = modal.querySelector('.wv-favorites-quick-search-input');
        setTimeout(() => {
            input.focus();
        }, 200);

        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                this.closeQuickSearch('backdrop_click');
            }
        });

        input.addEventListener('input', (e) => {
            this.handleSearchInput(e.target.value);
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeQuickSearch('escape_key');
            } else {
                this.handleQuickSearchKeyboard(e);
            }
        });

        // Add event delegation for action buttons
        modal.addEventListener('click', (e) => {
            // Handle native WorkVivo search button click
            if (e.target.closest('.wv-favorites-quick-search-native-btn')) {
                e.stopPropagation();
                this.app?.logger?.log('🔍 Opening WorkVivo native search from widget');

                // Close the extension's quick search modal
                this.closeQuickSearch('native_search_click');

                // Find WorkVivo's native search button
                const nativeSearchBtn = document.querySelector('button[aria-label="Search"], button[aria-label*="Search"]');
                if (nativeSearchBtn) {
                    // CRITICAL: Temporarily disable the extension's override handler
                    // Otherwise it will intercept our click and open the extension's search again
                    const overrideHandler = nativeSearchBtn.wvOverrideHandler;
                    if (overrideHandler) {
                        // Remove override handler temporarily
                        nativeSearchBtn.removeEventListener('click', overrideHandler, true);
                        this.app?.logger?.log('🔓 Temporarily disabled search override');

                        // Click the native button (will open WorkVivo's search)
                        nativeSearchBtn.click();
                        this.app?.logger?.log('✅ Triggered WorkVivo native search');

                        // Re-enable override after a delay to allow native search to open
                        setTimeout(() => {
                            nativeSearchBtn.addEventListener('click', overrideHandler, true);
                            this.app?.logger?.log('🔒 Re-enabled search override');
                        }, 500);
                    } else {
                        // No override handler, just click normally
                        nativeSearchBtn.click();
                        this.app?.logger?.log('✅ Triggered WorkVivo native search (no override present)');
                    }
                } else {
                    this.app?.logger?.warn('⚠️ WorkVivo native search button not found');
                }
                return;
            }

            // Handle settings button click
            if (e.target.closest('.wv-favorites-quick-search-settings-btn')) {
                e.stopPropagation();
                this.app?.logger?.log('⚙️ Opening extension settings from widget');

                // Close the extension's quick search modal
                this.closeQuickSearch('settings_click');

                // Send message to background script to open options page
                // (chrome.runtime.openOptionsPage only works in extension contexts, not content scripts)
                if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
                    chrome.runtime.sendMessage({ action: 'openOptionsPage' });
                }
                return;
            }

            // Handle info button clicks
            if (e.target.closest('.wv-favorites-quick-search-info-btn')) {
                e.stopPropagation();
                const button = e.target.closest('.wv-favorites-quick-search-info-btn');
                this.handleInfoButtonClick(button);
                return;
            }

            // Handle email button clicks
            if (e.target.closest('.wv-favorites-quick-search-email-btn')) {
                e.stopPropagation();
                const button = e.target.closest('.wv-favorites-quick-search-email-btn');
                this.handleEmailButtonClick(button);
                return;
            }

            // Handle search result item clicks (existing functionality)
            const resultItem = e.target.closest('.wv-favorites-quick-search-item');
            if (resultItem && !e.target.closest('.wv-favorites-quick-search-actions')) {
                // CRITICAL FIX: Ignore clicks during search result updates
                if (this.isUpdatingResults) {
                    this.app?.logger?.debug('🚫 Ignoring click during search results update');
                    return;
                }

                this.app?.logger?.debug('🔍 Search widget item clicked:', resultItem);
                const index = parseInt(resultItem.dataset.index);
                const chatId = resultItem.dataset.chatId;
                this.app?.logger?.debug('📋 Click index:', index, 'Chat ID:', chatId, 'Array length:', this.app.allSearchResults.length);

                // CRITICAL FIX: Use chat ID to find the correct item instead of relying on array index
                // This prevents race conditions when the array gets updated between render and click
                let selectedResult = null;

                if (chatId) {
                    // Find by chat ID with type-safe comparison (handle string vs number mismatches)
                    selectedResult = this.app.allSearchResults.find(item =>
                        item.id === chatId || String(item.id) === String(chatId)
                    );
                    if (selectedResult) {
                        this.app?.logger?.debug('✅ Found by chat ID (type-safe):', selectedResult);
                    } else {
                        this.app?.logger?.warn('⚠️ Chat ID not found in results, trying index fallback:', chatId);
                        this.app?.logger?.warn('🔍 Available IDs in allSearchResults:');
                        this.app.allSearchResults.forEach((item, idx) => {
                            this.app?.logger?.warn(`  [${idx}] ${item.name} - ID: ${item.id} | userId: ${item.userId} | user_id: ${item.user_id} | type: ${item.type}`);
                        });

                        // Try alternative ID fields with more robust matching
                        selectedResult = this.app.allSearchResults.find(item => {
                            const itemIds = [item.id, item.userId, item.user_id].filter(Boolean);
                            const itemIdsAsStrings = itemIds.map(id => String(id));
                            const chatIdAsString = String(chatId);

                            return itemIds.includes(chatId) ||
                                   itemIdsAsStrings.includes(chatIdAsString) ||
                                   itemIds.some(id => String(id) === chatIdAsString);
                        });

                        if (selectedResult) {
                            this.app?.logger?.debug('✅ Found by alternative ID matching:', selectedResult);
                        } else {
                            this.app?.logger?.warn('⚠️ No matching result found for chat ID:', chatId);
                            this.app?.logger?.warn('🔍 Searched for exact matches and string conversions');
                            this.app?.logger?.warn('📊 Total search results available:', this.app.allSearchResults.length);
                        }
                    }
                }

                // Fallback to index method if chat ID lookup fails
                if (!selectedResult && index >= 0 && index < this.app.allSearchResults.length) {
                    const indexResult = this.app.allSearchResults[index];
                    this.app?.logger?.debug('📋 Index fallback candidate:', indexResult);

                    // CRITICAL VALIDATION: If we have a chat ID from DOM, validate the fallback makes sense
                    if (chatId && indexResult) {
                        const isUserSearch = chatId.match(/^\d+$/); // Pure numeric IDs are usually users
                        const isGroupResult = indexResult.type === 'channel' || indexResult.id.includes('group_channel');

                        this.app?.logger?.debug('🔍 VALIDATION CHECK:');
                        this.app?.logger?.debug('  - Clicked chat ID:', chatId, '(type:', typeof chatId, ')');
                        this.app?.logger?.debug('  - Is numeric user ID:', isUserSearch);
                        this.app?.logger?.debug('  - Index result:', indexResult.name, '(ID:', indexResult.id, ', type:', indexResult.type, ')');
                        this.app?.logger?.debug('  - Is group result:', isGroupResult);

                        if (isUserSearch && isGroupResult) {
                            this.app?.logger?.warn('⚠️ NAVIGATION MISMATCH: User click resulted in group chat selection!');
                            this.app?.logger?.warn('👤 Expected user ID:', chatId);
                            this.app?.logger?.warn('👥 Got group result:', indexResult);
                            this.app?.logger?.warn('🚨 Rejecting index fallback to prevent wrong navigation.');
                            this.app?.logger?.warn('🔧 Root cause: Chat ID', chatId, 'not found in search results array');

                            // Try to recover by finding the correct user in Smart Database
                            this.app?.logger?.debug('🔧 RECOVERY ATTEMPT: Searching for user', chatId, 'in Smart Database...');
                            selectedResult = null; // Reject this to prevent wrong navigation
                        } else {
                            selectedResult = indexResult;
                            this.app?.logger?.debug('✅ VALIDATION PASSED: Using validated index fallback:', selectedResult);
                        }
                    } else {
                        selectedResult = indexResult;
                        this.app?.logger?.debug('📋 Using index fallback:', selectedResult);
                    }
                }

                if (selectedResult) {
                    this.app?.logger?.debug('✅ Committing search selection:', selectedResult);
                    this.commitSearchSelection(selectedResult);
                } else {
                    this.app?.logger?.warn('⚠️ No valid search result found - navigation blocked for safety');
                    this.app?.logger?.warn('🔍 Attempted Index:', index, 'Chat ID:', chatId, 'Available results:', this.app.allSearchResults.length);
                    this.app?.logger?.warn('🚨 This likely means the protection system blocked wrong navigation (user→group mismatch)');
                    this.app?.logger?.warn('💡 This is GOOD - prevents opening wrong chats! But we need to fix the root cause.');
                }
                return;
            }
        });

        // Load initial results (all pinned and recent chats)
        this.app?.logger?.debug('🚀 Loading initial search results...');
        this.performSearch('');
    }

    closeQuickSearch(source = 'unknown') {
        if (!this.app.quickSearchOpen) return;

        // Track search abandonment if there was a query but no selection
        const searchInput = document.querySelector('.wv-favorites-quick-search-input');
        const query = searchInput ? searchInput.value.trim() : '';

        // Analytics disabled per user request
        // Search abandonment tracking removed

        const modal = document.querySelector('.wv-favorites-quick-search-backdrop');
        if (modal) {
            modal.classList.remove('open');
            setTimeout(() => {
                if (modal.parentNode) {
                    modal.remove();
                    // Only clear results when modal is actually removed
                    this.app.allSearchResults = [];
                }
                // Restore floating button z-index when search is fully closed
                if (this.app.floatingWidget && typeof this.app.floatingWidget.restoreFloatingButtonZIndex === 'function') {
                    this.app.floatingWidget.restoreFloatingButtonZIndex();
                }
            }, 200);
        }
        this.app.quickSearchOpen = false;
        this.app.selectedSearchIndex = 0;
        // Don't clear allSearchResults immediately - wait for modal removal
    }

    handleSearchInput(query) {
        if (this.app.searchDebounceTimer) {
            clearTimeout(this.app.searchDebounceTimer);
        }

        // Track query refinement patterns - REMOVED (event eliminated in optimization)

        // Store current query for refinement tracking
        this.app.lastSearchQuery = query;

        // Only cancel API requests, but don't mark search as cancelled yet
        // The actual search cancellation will happen when the new search starts
        if (WVFavs.APIManager && typeof WVFavs.APIManager.cancelRequestGroup === 'function' && this.app.currentSearchId) {
            WVFavs.APIManager.cancelRequestGroup(this.app.currentSearchId, 'new search input');
        }

        this.app.searchDebounceTimer = setTimeout(async () => {
            await this.performSearch(query);
        }, query.length < 3 ? 500 : 300); // Longer debounce for short queries
    }

    // Cancel current search and any pending API requests
    cancelCurrentSearch(reason = 'cancelled') {
        if (this.app.currentSearchId) {
            this.app?.logger?.log(`🚫 Cancelling current search: ${this.app.currentSearchId} (${reason})`);

            // Cancel API requests via APIManager
            if (WVFavs.APIManager && typeof WVFavs.APIManager.cancelRequestGroup === 'function') {
                WVFavs.APIManager.cancelRequestGroup(this.app.currentSearchId, reason);
            }

            // Mark current search as cancelled
            this.app.currentSearchId = null;
        }
    }

    // Check if a search is still active/current
    isSearchActive(searchId) {
        return this.app.currentSearchId === searchId;
    }

    async performSearch(query) {
        // Start performance tracking
        const searchStartTime = performance.now();
        const trimmedQuery = query ? query.trim() : '';

        if (this.app.logger) {
            this.app?.logger?.debug('EventHandler.performSearch called', { query: trimmedQuery });
        }

        // Track search performed with new analytics system (only for non-empty queries)
        if (trimmedQuery.length > 0) {
            if (this.app.logger) {
                this.app?.logger?.analytics('search_performed', {
                    query_length: trimmedQuery.length,
                    has_special_chars: /[^a-zA-Z0-9\s]/.test(trimmedQuery),
                    timestamp: Date.now()
                });
            }

            // Legacy tracking for backwards compatibility
            if (this.app.statsManager) {
                this.app.statsManager.recordSearchPerformed();
            }
        }

        // Generate unique search ID to handle race conditions
        const searchId = `search-${Date.now()}-${Math.random()}`;
        this.app.currentSearchId = searchId;

        try {
            // Check if search was cancelled before we even start
            if (!this.isSearchActive(searchId)) {
                this.app?.logger?.log(`🏃‍♂️ Search ${searchId} was cancelled before starting`);
                return;
            }

            // Show loading state for non-empty queries
            if (query && query.trim().length > 0) {
                this.showSearchLoading(query);
            }

            this.app?.logger?.log('🔍 About to call SearchEngine.performHierarchicalSearch');
            // Delegate to SearchEngine for all search logic
            const allResults = await WVFavs.SearchEngine.performHierarchicalSearch(query, searchId);
            this.app?.logger?.log('🔍 SearchEngine returned results:', allResults);

            // Final check if this search is still current (prevent race conditions)
            if (this.isSearchActive(searchId)) {
                this.renderSearchResults(allResults, query);

                // Calculate search response time
                const searchEndTime = performance.now();
                const searchDuration = Math.round(searchEndTime - searchStartTime);

                // Track search results with new analytics system (only for non-empty queries)
                if (query && query.trim().length > 0 && this.app.logger) {
                    this.app?.logger?.analytics('search_completed', {
                        query_length: query.trim().length,
                        result_count: allResults.length,
                        has_results: allResults.length > 0,
                        timestamp: Date.now()
                    });

                    // Track search response time (Phase 4 performance metric)
                    this.app?.logger?.analytics('search_response_time', {
                        duration_ms: searchDuration
                    });
                }
            } else {
                this.app?.logger?.log(`🏃‍♂️ Search ${searchId} cancelled (newer search in progress)`);
            }
        } catch (error) {
            // Check if this is a cancellation error
            if (error.message && error.message.includes('cancelled')) {
                this.app?.logger?.log(`🚫 Search ${searchId} was cancelled: ${error.message}`);
                return;
            }

            this.app?.logger?.log('❌ Search failed:', error.message);
            if (this.isSearchActive(searchId)) {
                this.showSearchError(query);
            } else {
                this.app?.logger?.log(`🏃‍♂️ Ignoring error for cancelled search: ${searchId}`);
            }
        }
    }

    showSearchLoading(query) {
        const resultsContainer = document.querySelector('.wv-favorites-quick-search-results');
        if (!resultsContainer) return;

        resultsContainer.innerHTML = `
            <div class="wv-favorites-quick-search-loading">
                <div class="wv-favorites-search-loading-spinner">⏳</div>
                <div class="wv-favorites-search-loading-text">Searching for "${query}"...</div>
                <div class="wv-favorites-search-loading-subtext">Looking in local chats and company directory</div>
            </div>
        `;
    }

    showSearchError(query) {
        const resultsContainer = document.querySelector('.wv-favorites-quick-search-results');
        if (!resultsContainer) return;

        resultsContainer.innerHTML = `
            <div class="wv-favorites-quick-search-error">
                <div class="wv-favorites-search-error-icon">⚠️</div>
                <div class="wv-favorites-search-error-text">Search failed for "${query}"</div>
                <div class="wv-favorites-search-error-subtext">Please try again</div>
            </div>
        `;
    }

    mergeSearchResults(localResults, apiResults) {
        const allResults = new Map();
        localResults.forEach(item => {
            if (item.id) {
                allResults.set(item.id, { ...item, _source: 'local' });
            }
        });
        const apiItems = [
            ...(apiResults.users || []).map(u => ({ ...u, type: 'user' })),
            ...(apiResults.channels || []).map(c => ({ ...c, type: 'channel' }))
        ];
        apiItems.forEach(item => {
            if (item.id && !allResults.has(item.id)) {
                allResults.set(item.id, { ...item, _source: 'api' });
            }
        });
        return Array.from(allResults.values());
    }

    renderSearchResults(results, query = '') {
        // Start UI render timing (Phase 4 performance metric)
        const renderStartTime = performance.now();

        const resultsContainer = document.querySelector('.wv-favorites-quick-search-results');
        if (!resultsContainer) return;

        this.app?.logger?.debug('📋 Starting search results update with', results.length, 'items');

        // CRITICAL FIX: Disable clicks during transition to prevent race conditions
        this.isUpdatingResults = true;
        resultsContainer.style.pointerEvents = 'none';

        // Add smooth transition class
        resultsContainer.classList.add('wv-updating');

        // Use smooth transition and update array atomically with DOM
        this.smoothUpdateResults(resultsContainer, results, query, renderStartTime);
    }

    async smoothUpdateResults(container, results, query, renderStartTime) {
        // Fade out current content
        container.style.opacity = '0.6';
        container.style.transform = 'translateY(5px)';

        // Wait for fade out
        await new Promise(resolve => setTimeout(resolve, 150));

        // CRITICAL FIX: Update array and DOM atomically (at the same time)
        this.app?.logger?.debug('📋 Updating array and DOM atomically with', results.length, 'items');
        this.app.allSearchResults = results;
        this.app.selectedSearchIndex = 0;

        // Update DOM content
        this.updateResultsContent(container, results, query);

        // Fade in new content
        container.style.opacity = '1';
        container.style.transform = 'translateY(0)';
        container.classList.remove('wv-updating');

        // CRITICAL FIX: Re-enable clicks after DOM is fully updated
        container.style.pointerEvents = 'auto';
        this.isUpdatingResults = false;

        // Analytics disabled per user request
        // UI render time tracking removed

        this.app?.logger?.debug('✅ Search results update complete - clicks re-enabled');
    }

    updateResultsContent(resultsContainer, results, query) {
        resultsContainer.innerHTML = '';

        if (results.length === 0 && query) {
            resultsContainer.innerHTML = `
                <div class="wv-favorites-quick-search-empty">
                    <div class="wv-favorites-quick-search-empty-icon">🔍</div>
                    <div class="wv-favorites-quick-search-empty-text">No results found for "${query}"</div>
                </div>
            `;
            return;
        } else if (results.length === 0) {
            resultsContainer.innerHTML = `
                <div class="wv-favorites-quick-search-empty">
                    <div class="wv-favorites-quick-search-empty-icon">💬</div>
                    <div class="wv-favorites-quick-search-empty-text">No pinned or recent chats</div>
                </div>
            `;
            return;
        }

        // Separate results by type
        const pinnedResults = results.filter(item => item._resultType === 'pinned');
        const recentResults = results.filter(item => item._resultType === 'recent');
        const apiResults = results.filter(item => item._resultType === 'advanced_api' || item._resultType === 'light_api' || item._resultType === 'local');

        let html = '';

        // Render pinned section
        if (pinnedResults.length > 0) {
            html += `<div class="wv-favorites-quick-search-section">
                <div class="wv-favorites-quick-search-section-title">Pinned Chats</div>
            </div>`;

            pinnedResults.forEach((item, index) => {
                html += this.renderSearchResultItem(item, index, query, index * 0.05);
            });
        }

        // Render recent section
        if (recentResults.length > 0) {
            html += `<div class="wv-favorites-quick-search-section">
                <div class="wv-favorites-quick-search-section-title">Recent Chats</div>
            </div>`;

            const startIndex = pinnedResults.length;
            recentResults.forEach((item, index) => {
                html += this.renderSearchResultItem(item, startIndex + index, query, (startIndex + index) * 0.05);
            });
        }

        // Render API results
        if (apiResults.length > 0) {
            html += `<div class="wv-favorites-quick-search-section">
                <div class="wv-favorites-quick-search-section-title">Search Results</div>
            </div>`;

            const startIndex = pinnedResults.length + recentResults.length;
            apiResults.forEach((item, index) => {
                html += this.renderSearchResultItem(item, startIndex + index, query, (startIndex + index) * 0.05);
            });
        }

        // Add "Search for more" button if any search term is provided
        if (query && query.trim().length > 0) {
            html += `
                <div class="wv-favorites-quick-search-section">
                    <div class="wv-favorites-search-for-more-container">
                        <button class="wv-favorites-search-for-more-btn" data-query="${query.replace(/"/g, '&quot;')}">
                            <span class="wv-favorites-search-for-more-icon">🔍</span>
                            <span class="wv-favorites-search-for-more-text">Search for more results</span>
                            <span class="wv-favorites-search-for-more-subtext">Search company directory</span>
                        </button>
                    </div>
                </div>
            `;
        }

        resultsContainer.innerHTML = html;
        this.addResultClickListeners();
        this.addSearchForMoreListener();
        this.updateSelectedSearchResult();
    }

    renderSearchResultItem(item, index, query, animationDelay = 0) {
        const displayName = WVFavs.Helpers.getDisplayName ? WVFavs.Helpers.getDisplayName(item) : (item.name || 'Unknown');
        const highlightedName = this.highlightSearchText(displayName, query);
        const isSelected = index === this.app.selectedSearchIndex;
        const avatar = WVFavs.DomManager.renderSavedAvatar(item);

        let metaText = 'Chat';
        if (item._resultType === 'pinned') metaText = 'Pinned chat';
        else if (item._resultType === 'recent') metaText = 'Recent chat';
        else if (item.type === 'user') {
            // Priority order for meta text - show detailed relationship info
            // Note: sharedChannels includes the direct chat channel, so subtract 1 when hasDirectChat is true
            const actualSharedGroups = item.hasDirectChat && item.sharedChannels
                ? item.sharedChannels.length - 1
                : (item.sharedChannels ? item.sharedChannels.length : 0);

            if (item.hasDirectChat && actualSharedGroups > 0) {
                metaText = `Direct chat + ${actualSharedGroups} shared groups`;
            } else if (item.hasDirectChat) {
                metaText = 'Direct chat';
            } else if (actualSharedGroups >= 5) {
                metaText = `${actualSharedGroups} shared groups`;
            } else if (actualSharedGroups > 0) {
                metaText = `${actualSharedGroups} shared groups`;
            } else if (item.hasSharedConnection) {
                metaText = 'Shared connection';
            } else if (item._nameMatch) {
                // If it's a name match, show job title or department
                metaText = item.job_title || item.department_name || 'Person';
            } else if (query && item.bio && item.bio.toLowerCase().includes(query.toLowerCase())) {
                metaText = `Bio mentions "${query}"`;
            } else if (query && item.department_name && item.department_name.toLowerCase().includes(query.toLowerCase())) {
                metaText = `Department: ${item.department_name}`;
            } else {
                // Show department or job title for unknown users to help identify them
                metaText = item.department_name || item.job_title || 'Person';
            }
        }
        else if (item.type === 'channel') {
            if (item.is_distinct === true) metaText = 'Direct chat';
            else if (item.member_count) metaText = `Group chat (${item.member_count} members)`;
            else metaText = 'Channel';
        }

        // Add action buttons for users
        let actionButtons = '';
        if (item.type === 'user') {
            const hasProfileLink = item.profile_permalink || item.profile_url;
            const hasEmail = item.email;

            if (hasProfileLink) {
                actionButtons += `
                    <button class="wv-favorites-quick-search-info-btn" title="View profile" data-user-id="${item.id}" data-profile-permalink="${item.profile_permalink || ''}" data-profile-url="${item.profile_url || ''}">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>
                        </svg>
                    </button>
                `;
            }

            if (hasEmail) {
                actionButtons += `
                    <button class="wv-favorites-quick-search-email-btn" title="Copy email: ${item.email}" data-email="${item.email}">
                        @
                    </button>
                `;
            }
        }

        return `
            <div class="wv-favorites-quick-search-item ${isSelected ? 'selected' : ''}" data-index="${index}" data-chat-id="${item.id}" style="animation-delay: ${animationDelay}s">
                <div class="wv-favorites-quick-search-avatar">
                    ${avatar}
                </div>
                <div class="wv-favorites-quick-search-info">
                    <div class="wv-favorites-quick-search-name">${highlightedName}</div>
                    <div class="wv-favorites-quick-search-meta">${metaText}</div>
                </div>
                <div class="wv-favorites-quick-search-actions">
                    ${actionButtons}
                </div>
            </div>
        `;
    }

    highlightSearchText(text, query) {
        if (!query || !query.trim()) return text;
        const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\\]/g, '\\$&')})`, 'gi');
        return text.replace(regex, '<span class="wv-favorites-quick-search-highlight">$1</span>');
    }

    addResultClickListeners() {
        const resultsContainer = document.querySelector('.wv-favorites-quick-search-results');
        if (!resultsContainer) return;

        resultsContainer.querySelectorAll('.wv-favorites-quick-search-item').forEach((result) => {
            // Main item click handler (for navigation to chat)
            result.addEventListener('click', (e) => {
                // Don't trigger if clicking any action button
                if (e.target.closest('.wv-favorites-quick-search-info-btn')) return;
                if (e.target.closest('.wv-favorites-quick-search-email-btn')) return;
                if (e.target.closest('.wv-favorites-quick-search-actions')) return;

                // CRITICAL FIX: Apply same enhanced ID matching as main click handler
                const index = parseInt(result.dataset.index);
                const chatId = result.dataset.chatId;

                // Ignore clicks during search result updates
                if (this.isUpdatingResults) {
                    this.app?.logger?.debug('🚫 Ignoring duplicate click handler during search results update');
                    return;
                }

                this.app?.logger?.debug('🖱️ Duplicate click handler - Index:', index, 'Chat ID:', chatId, 'Array length:', this.app.allSearchResults.length);

                // Use same enhanced ID matching logic
                let selectedResult = null;

                if (chatId) {
                    // Find by chat ID with type-safe comparison (handle string vs number mismatches)
                    selectedResult = this.app.allSearchResults.find(item =>
                        item.id === chatId || String(item.id) === String(chatId)
                    );
                    if (!selectedResult) {
                        // Try alternative ID fields with robust matching
                        selectedResult = this.app.allSearchResults.find(item => {
                            const itemIds = [item.id, item.userId, item.user_id].filter(Boolean);
                            const itemIdsAsStrings = itemIds.map(id => String(id));
                            const chatIdAsString = String(chatId);

                            return itemIds.includes(chatId) ||
                                   itemIdsAsStrings.includes(chatIdAsString) ||
                                   itemIds.some(id => String(id) === chatIdAsString);
                        });
                    }
                }

                // Fallback to index method if chat ID lookup fails
                if (!selectedResult && index >= 0 && index < this.app.allSearchResults.length) {
                    const indexResult = this.app.allSearchResults[index];

                    // Apply same validation logic as main handler
                    if (chatId && indexResult) {
                        const isUserSearch = chatId.match(/^\d+$/);
                        const isGroupResult = indexResult.type === 'channel' || indexResult.id.includes('group_channel');

                        if (isUserSearch && isGroupResult) {
                            this.app?.logger?.warn('⚠️ DUPLICATE HANDLER - NAVIGATION MISMATCH: User click resulted in group chat selection!');
                            this.app?.logger?.warn('🔧 Root cause: Chat ID', chatId, 'not found in search results array');
                            selectedResult = null; // Block wrong navigation
                        } else {
                            selectedResult = indexResult;
                        }
                    } else {
                        selectedResult = indexResult;
                    }
                }

                if (selectedResult) {
                    this.app?.logger?.log('🖱️ Mouse click selection:', {
                        mouseIndex: index,
                        keyboardIndex: this.app.selectedSearchIndex,
                        clickedName: selectedResult.name,
                        clickedId: selectedResult.id,
                        isKeyboardMatch: index === this.app.selectedSearchIndex,
                        foundByMethod: chatId && this.app.allSearchResults.find(item => item.id === chatId || String(item.id) === String(chatId)) ? 'ChatID' : 'Index'
                    });
                    this.commitSearchSelection(selectedResult);
                } else {
                    this.app?.logger?.warn('⚠️ Duplicate handler - No valid search result found - navigation blocked for safety');
                }
            });

            // Info button click handler removed - now handled by modal-level event delegation
        });
    }

    addSearchForMoreListener() {
        const searchForMoreBtn = document.querySelector('.wv-favorites-search-for-more-btn');
        if (!searchForMoreBtn) return;

        searchForMoreBtn.addEventListener('click', async () => {
            const query = searchForMoreBtn.dataset.query;
            if (!query) return;

            // Disable button and show loading state
            searchForMoreBtn.disabled = true;
            searchForMoreBtn.innerHTML = `
                <span class="wv-favorites-search-for-more-icon">⏳</span>
                <span class="wv-favorites-search-for-more-text">Searching...</span>
                <span class="wv-favorites-search-for-more-subtext">Please wait</span>
            `;

            try {
                // Force Advanced API search via SearchEngine
                const results = await WVFavs.SearchEngine.searchForMore(query);
                this.renderSearchResults(results, query);
                this.app?.logger?.log('🔍➕ "Search for more" completed for:', query);
            } catch (error) {
                this.app?.logger?.log('❌ "Search for more" failed:', error.message);
                // Re-enable button with error state
                searchForMoreBtn.disabled = false;
                searchForMoreBtn.innerHTML = `
                    <span class="wv-favorites-search-for-more-icon">⚠️</span>
                    <span class="wv-favorites-search-for-more-text">Search failed</span>
                    <span class="wv-favorites-search-for-more-subtext">Try again</span>
                `;

                // Reset after delay
                setTimeout(() => {
                    searchForMoreBtn.innerHTML = `
                        <span class="wv-favorites-search-for-more-icon">🔍</span>
                        <span class="wv-favorites-search-for-more-text">Search for more results</span>
                        <span class="wv-favorites-search-for-more-subtext">Search company directory</span>
                    `;
                }, 2000);
            }
        });
    }

    handleQuickSearchKeyboard(e) {
        const results = document.querySelectorAll('.wv-favorites-quick-search-item');
        if (results.length === 0) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            this.app.selectedSearchIndex = (this.app.selectedSearchIndex + 1) % results.length;
            this.updateSelectedSearchResult();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            this.app.selectedSearchIndex = (this.app.selectedSearchIndex - 1 + results.length) % results.length;
            this.updateSelectedSearchResult();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            // CRITICAL FIX: Apply enhanced protection to keyboard navigation
            // This prevents mouse hover interference and race conditions
            if (this.isUpdatingResults) {
                this.app?.logger?.debug('🚫 Ignoring keyboard navigation during search results update');
                return;
            }

            if (this.app.selectedSearchIndex >= 0 && this.app.selectedSearchIndex < this.app.allSearchResults.length) {
                const selectedResult = this.app.allSearchResults[this.app.selectedSearchIndex];

                // Additional validation for keyboard navigation
                if (selectedResult) {
                    this.app?.logger?.log('⌨️ Keyboard Enter selection:', {
                        keyboardIndex: this.app.selectedSearchIndex,
                        selectedName: selectedResult.name,
                        selectedId: selectedResult.id,
                        arrayLength: this.app.allSearchResults.length
                    });
                    this.commitSearchSelection(selectedResult);
                } else {
                    this.app?.logger?.warn('⚠️ Keyboard navigation - Invalid result at index:', this.app.selectedSearchIndex);
                }
            } else {
                this.app?.logger?.warn('⚠️ Keyboard navigation - Index out of bounds:', this.app.selectedSearchIndex, 'Array length:', this.app.allSearchResults.length);
            }
        }
    }

    updateSelectedSearchResult() {
        const results = document.querySelectorAll('.wv-favorites-quick-search-item');
        results.forEach((item, index) => {
            if (index === this.app.selectedSearchIndex) {
                item.classList.add('selected');
                item.scrollIntoView({ block: 'nearest' });
            } else {
                item.classList.remove('selected');
            }
        });
    }

    commitSearchSelection(item) {
        if (this.app.logger) {
            this.app?.logger?.log('🎯 commitSearchSelection called', {
                name: item.name,
                id: item.id,
                channel_url: item.channel_url,
                userId: item.userId,
                resultType: item._resultType,
                type: item.type,
                hasNavigation: !!item.navigation
            });
        }

        // Track search result click with deep analytics
        if (this.app.logger) {
            this.app?.logger?.analytics('search_result_clicked', {
                result_type: item._resultType || 'unknown',
                result_category: item.type || 'unknown',
                result_position: this.app.selectedSearchIndex || 0,
                has_existing_conversation: !!item.navigation,
                is_pinned_chat: item._resultType === 'pinned',
                is_recent_chat: item._resultType === 'recent',
                timestamp: Date.now()
            });

            // Track specific recent chat access
            if (item._resultType === 'recent') {
                this.app?.logger?.analytics('recent_chat_accessed', {
                    source: 'search_widget',
                    chat_type: item.type || 'unknown',
                    is_pinned: false, // Recent chats accessed via search are not pinned
                    action_method: 'search_widget_selection',
                    search_position: this.app.selectedSearchIndex || 0
                });
            }
        }

        // Close search first
        this.closeQuickSearch('selection_made');

        // Handle pinned and recent chats
        if (item._resultType === 'pinned' || item._resultType === 'recent') {
            this.app?.logger?.log('📌 Taking pinned/recent path for:', item.name);

            this.app?.logger?.log('📌 Navigating to pinned/recent chat:', {
                name: item.name,
                id: item.id,
                userId: item.userId,
                resultType: item._resultType,
                hasNavigation: !!item.navigation
            });

            // Use original item
            WVFavs.DomManager.navigateToChat(item, 'search_widget_pinned_recent');

            // Record chat interaction for search widget navigation
            setTimeout(async () => {
                try {
                    await this.app.chatHistory.updateHistory(item, this.app, true);
                    this.app?.logger?.log('📊 Recorded search widget navigation for pinned/recent chat:', item.name);
                } catch (error) {
                    this.app?.logger?.log('❌ Failed to record search widget navigation:', error);
                }
            }, 500); // Small delay to ensure navigation starts
            return;
        }

        // Handle API search results (users from API)
        if (item.type === 'user' && this.isUserWithoutSharedConnection(item)) {
            this.app?.logger?.debug('🆕 Taking new user path for:', item.name);
            this.app?.logger?.log('🆕 Creating new chat for user without shared connection:', item.name);
            this.createNewChatWithUser(item);
            return;
        }

        // Default navigation path
        this.app?.logger?.debug('🚀 Taking default navigation path for:', item.name);
        const chatData = {
            id: item.id || item.user_id, // Ensure we always have an ID
            name: item.name,
            userId: item.user_id || item.userId,
            avatar: item.avatar,
            channel_url: item.channel_url,
            type: item.type
        };
        WVFavs.DomManager.navigateToChat(chatData, 'search_widget_result');

        // Record chat interaction for search widget navigation
        setTimeout(async () => {
            try {
                await this.app.chatHistory.updateHistory(chatData, this.app, true);
                this.app?.logger?.log('📊 Recorded search widget navigation for default path:', chatData.name);
            } catch (error) {
                this.app?.logger?.log('❌ Failed to record search widget navigation:', error);
            }
        }, 500); // Small delay to ensure navigation starts

        // For API results that represent existing chats, try to find the corresponding DOM element
        if (item.type === 'user') {
            this.app?.logger?.log('🔍 Trying to find existing chat for API user:', item.name);

            // If user has direct chat, try to use the direct chat channel URL
            if (item.hasDirectChat && item.sharedChannels && item.sharedChannels.length > 0) {
                // Find the direct chat channel (is_distinct = true)
                const directChatChannel = item.sharedChannels.find(channel => channel.is_distinct);
                if (directChatChannel && directChatChannel.channel_url) {
                    this.app?.logger?.log('✅ Found direct chat channel URL, navigating directly:', directChatChannel.channel_url);
                    const chatData = {
                        id: item.user_id || item.id, // Use user_id as ID, not channel_url
                        name: item.name,
                        userId: item.user_id || item.id,
                        avatar: item.avatar,
                        channel_url: directChatChannel.channel_url, // Store channel_url separately
                        type: 'user',
                        navigation: {
                            channelUrl: directChatChannel.channel_url
                        }
                    };
                    WVFavs.DomManager.navigateToChat(chatData);

                    // Record chat interaction for search widget navigation
                    setTimeout(async () => {
                        try {
                            await this.app.chatHistory.updateHistory(chatData, this.app, true);
                            this.app?.logger?.log('📊 Recorded search widget navigation for direct chat:', chatData.name);
                        } catch (error) {
                            this.app?.logger?.log('❌ Failed to record search widget navigation:', error);
                        }
                    }, 500); // Small delay to ensure navigation starts
                    return;
                }
            }

            // Fallback to sidebar search method
            this.findAndNavigateToExistingUserChat(item);
            return;
        }

        // Handle channel results
        if (item.type === 'channel') {
            this.app?.logger?.log('🔍 Navigating to channel:', {
                name: item.name,
                id: item.id,
                channel_url: item.channel_url,
                hasNavigation: !!item.navigation,
                navigation: item.navigation,
                fullItem: item
            });

            // For channels, navigate using React Fiber (PRIMARY) or name-based matching (SECONDARY)
            const chatData = {
                id: item.id, // This should be the channel_url
                name: item.name,
                avatar: item.avatar,
                channel_url: item.channel_url || item.id // Use channel_url for React Fiber navigation
                // navigation field removed - was causing data corruption
            };
            WVFavs.DomManager.navigateToChat(chatData, 'search_widget_channel');
            return;
        }

        this.app?.logger?.log('⚠️ Unknown search result type, using fallback navigation');
        WVFavs.DomManager.navigateToChat({
            id: item.id,
            name: item.name,
            avatar: item.avatar
            // navigation field removed - was causing data corruption
        });
    }

    async findAndNavigateToExistingUserChat(user) {
        // Try to find an existing chat element in the sidebar for this user
        const chatElements = document.querySelectorAll('[data-testid="channel-list"] button.tw-block.tw-w-full.tw-p-2.tw-rounded-lg');

        for (const element of chatElements) {
            // Skip pinned section
            if (element.closest('.wv-favorites-pinned-section')) continue;

            const elementText = element.textContent.toLowerCase().trim();
            const userName = user.name.toLowerCase().trim();

            // Try exact match first
            if (elementText === userName) {
                this.app?.logger?.log('✅ Found exact match for user in sidebar');
                element.click();
                return;
            }

            // Try partial match (user name might have additional text in sidebar)
            if (elementText.includes(userName) || userName.includes(elementText)) {
                this.app?.logger?.log('✅ Found partial match for user in sidebar');
                element.click();
                return;
            }
        }

        // If no existing chat found, create a new one
        this.app?.logger?.log('🆕 No existing chat found, creating new chat for user:', user.name);
        this.createNewChatWithUser(user);
    }

    openUserProfile(userId, profileUrl) {
        this.app?.logger?.log('👁️ Opening user profile:', { userId, profileUrl });

        // Close search first
        this.closeQuickSearch();

        try {
            if (profileUrl && profileUrl !== '') {
                // If we have a direct profile URL, use it
                const fullUrl = profileUrl.startsWith('http') ? profileUrl : `${window.location.origin}${profileUrl}`;
                window.open(fullUrl, '_blank');
                this.app?.logger?.log('✅ Opened profile URL:', fullUrl);
            } else {
                // Fallback: construct WorkVivo profile URL
                const host = window.location.host;
                const profilePath = `/directory/people/${userId}`;
                const fullUrl = `https://${host}${profilePath}`;
                window.open(fullUrl, '_blank');
                this.app?.logger?.log('✅ Opened constructed profile URL:', fullUrl);
            }

            WVFavs.DomManager.showSnackbar(`Opened profile for ${userId}`, 'info');
        } catch (error) {
            this.app?.logger?.log('❌ Failed to open user profile:', error.message);
            WVFavs.DomManager.showSnackbar('Failed to open user profile', 'error');
        }
    }

    isUserWithoutSharedConnection(item) {
        // CRITICAL: Check if user has direct chat first
        if (item.hasDirectChat) {
            return false; // Has direct chat = existing connection, don't create new
        }

        // Check if user has shared channels (excluding direct chat)
        if (item.sharedChannels && item.sharedChannels.length > 0) {
            return false; // Has shared connections
        }

        // Check for shared connection flag
        if (item.hasSharedConnection) {
            return false; // Has some form of shared connection
        }

        // Check meta text for shared connection indicators
        if (item._resultType === 'pinned' || item._resultType === 'recent') {
            return false; // Pinned/recent means existing chat
        }

        // Users from advanced API without any connections are likely new
        if (item.dataSource === 'advanced_search_filtered' && !item.hasDirectChat && !item.hasSharedConnection) {
            return true; // Truly new connection
        }

        // Users from API endpoints are typically existing connections
        if (item.dataSource === 'users_api' || item.dataSource === 'users_api_secondary') {
            return false; // Users from /users API are existing
        }

        // Default: if no clear shared connection indicators, consider as new
        return true;
    }

    async createNewChatWithUser(item) {
        try {
            this.app?.logger?.log('🆕 Starting new chat creation with:', item.name);

            // Show loading state
            WVFavs.DomManager.showSnackbar(`Creating new chat with ${item.name}...`, 'info');

            // Use WorkVivo's proper API to create direct chat
            const newChat = await this.createDirectChat(item.id);

            if (newChat && newChat.channel_url) {
                // Navigate to the newly created chat
                const newChatData = {
                    id: newChat.channel_url,
                    name: item.name,
                    avatar: item.avatar,
                    channel_url: newChat.channel_url,
                    isNewlyCreated: true,  // Flag to use gentle navigation
                    navigation: {
                        channelUrl: newChat.channel_url,
                        currentChatUrl: `${window.location.origin}/chat/${newChat.channel_url}`,
                        chatNameForSearch: item.name
                    }
                };

                this.app?.logger?.log('🆕 Navigating to newly created chat:', newChatData.name);
                WVFavs.DomManager.navigateToChat(newChatData);
                WVFavs.DomManager.showSnackbar(`Created new chat with ${item.name}`, 'success');
                return;
            } else {
                throw new Error('API returned invalid response');
            }

        } catch (error) {
            this.app?.logger?.log('❌ Failed to create new chat via API:', error.message);

            // Fallback to the old method if API fails
            await this.createNewChatWithUserFallback(item);
        }
    }

    async createDirectChat(userId) {
        const host = window.location.host;
        const createChatUrl = `https://${host}/api/chat/channel`;
        this.app?.logger?.log('💬 Creating chat with user:', userId);

        try {
            const response = await this.executeInPageContext('createChatAPI', {
                url: createChatUrl,
                method: 'POST',
                body: JSON.stringify({
                    "user_ids": [userId],
                    "is_distinct": true
                })
            });

            if (response && response.channel_url) {
                this.app?.logger?.log('✅ Created new chat:', response.channel_url);
                return response;
            } else {
                throw new Error('Failed to create chat');
            }
        } catch (error) {
            this.app?.logger?.error('❌ Failed to create chat:', error);
            throw error;
        }
    }

    async executeInPageContext(action, data) {
        return new Promise((resolve, reject) => {
            const requestId = `wvFav_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

            // Listen for the response
            const responseHandler = (event) => {
                if (event.detail.requestId === requestId) {
                    document.removeEventListener('wv-fav-api-response', responseHandler);

                    if (event.detail.success) {
                        resolve(event.detail.data);
                    } else {
                        reject(new Error(event.detail.error));
                    }
                }
            };

            document.addEventListener('wv-fav-api-response', responseHandler);

            // Send the request
            document.dispatchEvent(new CustomEvent('wv-fav-api-request', {
                detail: {
                    requestId,
                    action,
                    data
                }
            }));

            // Set timeout
            setTimeout(() => {
                document.removeEventListener('wv-fav-api-response', responseHandler);
                reject(new Error('Request timeout'));
            }, 10000);
        });
    }

    // Fallback method using the old approach
    async createNewChatWithUserFallback(item) {
        try {
            this.app?.logger?.log('🔄 Using fallback chat creation method');

            // Method 1: Try to find and click "New Message" or "Compose" button
            const success = await this.findAndClickNewMessageButton(item);
            if (success) {
                this.app?.logger?.log('✅ Successfully initiated new chat creation');
                return;
            }

            // Method 2: Try multiple WorkVivo compose URL patterns
            const host = window.location.host;
            const composeUrls = [
                `https://${host}/messages/compose?user=${item.id}`,
                `https://${host}/messages/new?to=${item.id}`,
                `https://${host}/chat/compose?recipient=${item.id}`,
                `https://${host}/messages?new&user=${item.id}`
            ];

            // Try the first URL pattern
            const composeUrl = composeUrls[0];
            this.app?.logger?.log('🔄 Trying direct compose URL:', composeUrl);

            try {
                window.location.href = composeUrl;
                WVFavs.DomManager.showSnackbar(`Opening chat with ${item.name}`, 'success');
                return; // Exit early if successful
            } catch (error) {
                this.app?.logger?.log('⚠️ Direct compose URL failed, trying alternative methods');
            }

            // Method 3: Try going to messages page first, then inject recipient
            const messagesUrl = `https://${host}/messages`;
            this.app?.logger?.log('🔄 Trying messages page navigation:', messagesUrl);

            // Store the user info for later injection
            sessionStorage.setItem('wv-fav-new-chat-user', JSON.stringify({
                id: item.id,
                name: item.name,
                email: item.email
            }));

            window.location.href = messagesUrl;

        } catch (error) {
            this.app?.logger?.log('❌ Failed to create new chat:', error.message);
            WVFavs.DomManager.showSnackbar(`Failed to create chat with ${item.name}`, 'error');

            // Fallback: try opening user profile
            if (item.profile_url) {
                this.app?.logger?.log('🔄 Falling back to profile view');
                this.openUserProfile(item.id, item.profile_url);
            }
        }
    }

    async findAndClickNewMessageButton(item) {
        // Look for WorkVivo-specific and common new message/compose button patterns
        const selectors = [
            // WorkVivo specific patterns
            'button[data-testid="fab-message"]',
            'button[data-testid="new-conversation"]',
            'button[aria-label*="New message"]',
            'button[aria-label*="Start conversation"]',
            '[data-testid="messages"] button[title*="New"]',
            '.fab-message',
            '.new-conversation-button',

            // Generic patterns
            'button[data-testid="new-message"]',
            'button[data-testid="compose"]',
            'button[title*="New message"]',
            'button[title*="Compose"]',
            'a[href*="/messages/compose"]',
            '[data-testid="compose-button"]',
            '.compose-button',
            '.new-message-button'
        ];

        for (const selector of selectors) {
            const element = document.querySelector(selector);
            if (element && element.offsetParent !== null) { // Check if visible
                this.app?.logger?.log(`🎯 Found new message button: ${selector}`);

                // Click the button
                element.click();

                // Wait a bit for the compose interface to load
                await new Promise(resolve => setTimeout(resolve, 1000));

                // Try to fill in the user
                const success = await this.fillComposeRecipient(item);
                if (success) {
                    return true;
                }
            }
        }

        return false;
    }

    async fillComposeRecipient(item) {
        // Look for WorkVivo-specific and common recipient input fields
        const recipientSelectors = [
            // WorkVivo specific patterns
            'input[data-testid="conversation-recipient"]',
            'input[data-testid="message-to"]',
            'input[placeholder*="Who do you want to message"]',
            'input[placeholder*="Start typing a name"]',
            'input[placeholder*="Search for people"]',
            '[data-testid="recipient-search"] input',
            '.recipient-search input',

            // Generic patterns
            'input[placeholder*="recipient"]',
            'input[placeholder*="To"]',
            'input[placeholder*="Send to"]',
            'input[data-testid="recipient"]',
            'input[name="recipient"]',
            'input[name="to"]',
            '.recipient-input',
            '.compose-to-input'
        ];

        for (const selector of recipientSelectors) {
            const input = document.querySelector(selector);
            if (input && input.offsetParent !== null) {
                this.app?.logger?.log(`📝 Found recipient input: ${selector}`);

                // Focus and fill the input
                input.focus();
                input.value = item.name || item.id;

                // Trigger input events
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));

                // Try pressing Enter to confirm
                await new Promise(resolve => setTimeout(resolve, 500));
                input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

                this.app?.logger?.log('✅ Filled recipient field');
                return true;
            }
        }

        this.app?.logger?.log('⚠️ Could not find recipient input field');
        return false;
    }

    async handleChatSwitcher() {
        const isMac = navigator.userAgent.toUpperCase().indexOf('MAC') >= 0;
        this.app?.logger?.log('🔄 Chat switcher triggered on', isMac ? 'macOS' : 'Windows/Linux');

        // Get available recent chats
        const recentChats = this.app.chatHistory.getAllRecents();
        this.app?.logger?.log('📊 Available recent chats on', isMac ? 'macOS' : 'Windows/Linux', ':', recentChats.length, recentChats.map(c => c.name));

        if (recentChats.length === 0) {
            this.app?.logger?.log('📊 No recent chats available for switching');
            WVFavs.DomManager.showSnackbar('No recent chats to switch between', 'info');
            return;
        }

        // If switcher is already open, cycle to next chat
        if (this.app.chatSwitcherOpen) {
            this.app?.logger?.log('🔄 Chat switcher already open - cycling to next chat');
            this.app.switcherIndex = (this.app.switcherIndex + 1) % this.app.switcherChats.length;
            this.updateChatSwitcherSelection();
            return;
        }

        // Determine timing based on platform for better UX
        const holdThreshold = isMac ? 180 : 200; // macOS feels more responsive with shorter threshold
        const waitTime = isMac ? 150 : 180;

        // Check how long the key has been held
        const pressTime = Date.now() - this.app.cmdSlashPressTime;
        this.app?.logger?.log('🔧 Key press timing:', pressTime + 'ms');

        // Different timing for macOS vs Windows for better UX
        if (pressTime < holdThreshold) {
            // Quick press - wait to see if they release quickly or hold
            this.app?.logger?.log(`🔄 Quick press - waiting ${waitTime}ms to see if held... (${isMac ? 'macOS' : 'Windows'} timing)`);
            setTimeout(async () => {
                if (this.app.cmdSlashPressed && !this.app.chatSwitcherOpen) {
                    // Still holding - open switcher
                    this.app?.logger?.log('🔄 Still holding - opening switcher');
                    await this.openChatSwitcher();
                }
                // If they released quickly, the keyup handler will do simple toggle
            }, waitTime);
        } else {
            // They're already holding - open switcher immediately
            this.app?.logger?.log('🔄 Already holding - opening switcher immediately');
            await this.openChatSwitcher();
        }
    }

    async getSwitcherChats() {
        // Get all chats with interaction history, sorted by most recent
        const [pinnedChats, recentChats] = await Promise.all([
            this.app.smartUserDB.getPinnedChats(),
            this.app.smartUserDB.getRecentChats()
        ]);

        // Combine all chats with deduplication (prioritize pinned over recent)
        const chatMap = new Map();

        // Add pinned chats first (higher priority)
        pinnedChats.forEach(chat => {
            const key = this.getChatDeduplicationKey(chat);
            chatMap.set(key, { ...chat, _resultType: 'pinned' });
        });

        // Add recent chats, but don't overwrite pinned chats
        recentChats.forEach(chat => {
            const key = this.getChatDeduplicationKey(chat);
            if (!chatMap.has(key)) {
                chatMap.set(key, { ...chat, _resultType: 'recent' });
            }
        });

        const allChats = Array.from(chatMap.values());

        // Sort by lastOpenedTime (most recent first), with fallback for pinned chats
        const sortedChats = allChats
            .filter(chat => chat.lastOpenedTime || chat.isPinned) // Only include chats with history or pinned
            .sort((a, b) => {
                // If both have lastOpenedTime, sort by it
                if (a.lastOpenedTime && b.lastOpenedTime) {
                    return b.lastOpenedTime - a.lastOpenedTime;
                }
                // Pinned chats without recent activity go after recent chats
                if (a.lastOpenedTime && !b.lastOpenedTime) return -1;
                if (!a.lastOpenedTime && b.lastOpenedTime) return 1;
                // If neither has lastOpenedTime, maintain original order
                return 0;
            })
            .slice(0, 5); // Limit to 5 chats maximum

        this.app?.logger?.debug('🔀 Chat switcher order:', sortedChats.map(c => ({
            name: c.name,
            type: c._resultType,
            lastOpened: c.lastOpenedTime ? new Date(c.lastOpenedTime).toLocaleString() : 'never'
        })));

        return sortedChats;
    }

    // Generate consistent deduplication key for chat records
    getChatDeduplicationKey(chat) {
        // Use name as primary key since that's what users see
        // This handles both name-based ("name_John Doe") and API-based ("12345") records
        const name = chat.name ? chat.name.toLowerCase().trim() : '';

        // For channels, include type to distinguish between users and channels with same name
        if (chat.type === 'channel' || chat.type === 'api_channel') {
            return `channel:${name}`;
        }

        // For users, just use the name
        return `user:${name}`;
    }

    async openChatSwitcher() {
        // Guard: Check if on chat page
        if (!this.app.isOnChatPage()) {
            this.app.handleNonChatPageAction('toggleChatSwitcher', () => this.openChatSwitcher());
            return;
        }

        // Track chat switcher opened with new analytics system
        if (this.app.logger) {
            this.app?.logger?.analytics('chat_switcher_opened', {
                action_method: 'keyboard_shortcut'
            });
        }

        // Track feature discovery (Phase 4 user engagement analytics)
        if (this.app.trackFeatureDiscovery) {
            this.app.trackFeatureDiscovery('chat_switcher', 'keyboard_shortcut');
        }

        // Legacy tracking for backwards compatibility
        if (this.app.statsManager) {
            this.app.statsManager.recordChatSwitcherOpened();
        }

        this.app.chatSwitcherOpen = true;
        this.app.switcherIndex = 0;

        // Get properly ordered and limited chats for switcher (max 5, recent first)
        try {
            const switcherChats = await this.getSwitcherChats();
            this.app.switcherChats = switcherChats;
            this.app?.logger?.debug('📋 Chat switcher loaded chats:', this.app.switcherChats.length);
        } catch (error) {
            this.app?.logger?.error('❌ Failed to load chats for switcher:', error);
            this.app.switcherChats = [];
        }

        if (this.app.switcherChats.length === 0) {
            WVFavs.DomManager.showSnackbar('No recent or pinned chats to switch to', 'warning');
            this.closeChatSwitcher();
            return;
        }

        const modal = document.createElement('div');
        modal.className = 'wv-favorites-chat-switcher-backdrop';
        modal.innerHTML = `
            <div class="wv-favorites-chat-switcher-modal">
                <div class="wv-favorites-chat-switcher-header">
                    <div class="wv-favorites-chat-switcher-title-row">
                        <div class="wv-favorites-chat-switcher-title">Recent Chats</div>
                        <button class="wv-favorites-chat-switcher-close">×</button>
                    </div>
                    <div class="wv-favorites-chat-switcher-hint">
                        Press <kbd>\\</kbd> or <kbd>↓</kbd> to cycle, <kbd>Enter</kbd> to select
                    </div>
                </div>
                <div class="wv-favorites-chat-switcher-list"></div>
            </div>
        `;

        document.body.appendChild(modal);

        // Trigger animation
        requestAnimationFrame(() => {
            modal.classList.add('open');
        });

        // Add keydown event listener for chat switcher keyboard navigation
        const keydownHandler = (e) => {
            if (this.app.chatSwitcherOpen) {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    this.closeChatSwitcher();
                } else if (e.key === 'Enter') {
                    e.preventDefault();
                    this.commitChatSwitcherSelection();
                } else {
                    this.handleChatSwitcherKeyboard(e);
                }
            }
        };

        document.addEventListener('keydown', keydownHandler);

        // Store handler for cleanup
        modal.keydownHandler = keydownHandler;

        // Add click handlers
        const closeBtn = modal.querySelector('.wv-favorites-chat-switcher-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                this.app?.logger?.log('🔄 Close button clicked');
                this.closeChatSwitcher();
            });
        }

        // Backdrop click handler
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                this.app?.logger?.log('🔄 Backdrop clicked');
                this.closeChatSwitcher();
            }
        });

        this.renderChatSwitcherList();
    }

    renderChatSwitcherList() {
        const listContainer = document.querySelector('.wv-favorites-chat-switcher-list');
        if (!listContainer) return;

        listContainer.innerHTML = '';

        this.app.switcherChats.forEach((chat, index) => {
            const item = document.createElement('div');
            item.className = 'wv-favorites-chat-switcher-item';
            if (index === this.app.switcherIndex) {
                item.classList.add('selected');
            }

            // Display special text for NoName groups
            const displayName = chat.isNoNameGroup === true
                ? '<span style="font-style: italic; opacity: 0.7;">No name group chat</span>'
                : chat.name;

            item.innerHTML = `
                <div class="wv-favorites-chat-switcher-avatar">
                    ${WVFavs.DomManager.renderSavedAvatar(chat)}
                </div>
                <div class="wv-favorites-chat-switcher-info">
                    <div class="wv-favorites-chat-switcher-name">${displayName}</div>
                </div>
            `;

            // Add click handler for mouse navigation
            item.addEventListener('click', () => {
                this.app.switcherIndex = index;
                this.updateChatSwitcherSelection();
                this.commitChatSwitcherSelection();
            });

            listContainer.appendChild(item);
        });
    }

    updateChatSwitcherSelection() {
        const items = document.querySelectorAll('.wv-favorites-chat-switcher-item');
        items.forEach((item, index) => {
            if (index === this.app.switcherIndex) {
                item.classList.add('selected');
                item.scrollIntoView({ block: 'nearest' });
            } else {
                item.classList.remove('selected');
            }
        });
    }

    handleChatSwitcherKeyboard(e) {
        const modifierKey = this.app.isModifierKeyPressed(e);
        const isBackslashKey = e.key === '\\' || e.key === '|' || e.code === 'Backslash' || e.keyCode === 220;

        // Handle backslash with modifier (for cycling when modal is open)
        if (modifierKey && isBackslashKey) {
            e.preventDefault();
            this.app.switcherIndex = (this.app.switcherIndex + 1) % this.app.switcherChats.length;
            this.updateChatSwitcherSelection();
            this.app?.logger?.log('🔄 Cycling with \\, new index:', this.app.switcherIndex);
        }
        // Handle arrow keys
        else if (e.key === 'ArrowDown') {
            e.preventDefault();
            this.app.switcherIndex = (this.app.switcherIndex + 1) % this.app.switcherChats.length;
            this.updateChatSwitcherSelection();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            this.app.switcherIndex = (this.app.switcherIndex - 1 + this.app.switcherChats.length) % this.app.switcherChats.length;
            this.updateChatSwitcherSelection();
        }
    }

    commitChatSwitcherSelection() {
        const selectedChat = this.app.switcherChats[this.app.switcherIndex];
        if (selectedChat) {
            if (this.app.statsManager) {
                this.app.statsManager.recordSwitcherSelection();
            }

            this.app?.logger?.log('🔄 Chat switcher navigation:', {
                name: selectedChat.name,
                id: selectedChat.id,
                hasNavigation: !!selectedChat.navigation,
                index: this.app.switcherIndex,
                totalChats: this.app.switcherChats.length
            });

            // Use original chat object - don't modify ID with channel_url
            WVFavs.DomManager.navigateToChat(selectedChat, 'chat_switcher');

            // Record chat interaction for chat switcher navigation
            setTimeout(async () => {
                try {
                    await this.app.chatHistory.updateHistory(selectedChat, this.app, true);
                    this.app?.logger?.log('📊 Recorded chat switcher navigation:', selectedChat.name);
                } catch (error) {
                    this.app?.logger?.log('❌ Failed to record chat switcher navigation:', error);
                }
            }, 500); // Small delay to ensure navigation starts
        } else {
            this.app?.logger?.log('❌ No selected chat found at index:', this.app.switcherIndex);
        }
        this.closeChatSwitcher();
    }

    closeChatSwitcher() {
        const modal = document.querySelector('.wv-favorites-chat-switcher-backdrop');
        if (modal) {
            // Remove the keydown handler
            if (modal.keydownHandler) {
                document.removeEventListener('keydown', modal.keydownHandler);
            }

            // Animate out
            modal.classList.remove('open');
            setTimeout(() => {
                if (modal.parentNode) {
                    modal.remove();
                }
            }, 200);
        }
        this.app.chatSwitcherOpen = false;
        this.app.cmdSlashPressed = false;
        this.app.backslashAlreadyHandled = false;
    }

    toggleLastChat() {
        if (this.app.chatHistory.canToggle()) {
            const targetChat = this.app.chatHistory.getToggleTarget();
            WVFavs.DomManager.navigateToChat(targetChat, 'quick_toggle_shortcut');

            // Record chat interaction for quick toggle navigation
            setTimeout(async () => {
                try {
                    await this.app.chatHistory.updateHistory(targetChat, this.app, true);
                    this.app?.logger?.log('📊 Recorded quick toggle navigation:', targetChat.name);
                } catch (error) {
                    this.app?.logger?.log('❌ Failed to record quick toggle navigation:', error);
                }
            }, 500); // Small delay to ensure navigation starts
        } else {
            WVFavs.DomManager.showSnackbar('No previous chat to toggle to', 'info');
        }
    }

    isModifierKeyPressed(e) {
        const isMac = navigator.userAgent.toUpperCase().indexOf('MAC') >= 0;
        if (isMac) {
            return e.metaKey;
        }
        const windowsPref = this.app.settings.get('windowsModifierKey') || 'ctrl';
        switch (windowsPref) {
            case 'ctrl':
                return e.ctrlKey;
            case 'both':
                return e.altKey || e.ctrlKey;
            case 'alt':
            default:
                return e.altKey;
        }
    }

    isModifierKeyReleased(e) {
        const isMac = navigator.userAgent.toUpperCase().indexOf('MAC') >= 0;
        if (isMac) {
            return e.key === 'Meta' || e.key === 'MetaLeft' || e.key === 'MetaRight';
        }
        const windowsPref = this.app.settings.get('windowsModifierKey') || 'ctrl';
        switch (windowsPref) {
            case 'ctrl':
                return e.key === 'Control' || e.key === 'ControlLeft' || e.key === 'ControlRight';
            case 'both':
                return (e.key === 'Alt' || e.key === 'AltLeft' || e.key === 'AltRight') ||
                       (e.key === 'Control' || e.key === 'ControlLeft' || e.key === 'ControlRight');
            case 'alt':
            default:
                return e.key === 'Alt' || e.key === 'AltLeft' || e.key === 'AltRight';
        }
    }

    // Handle info button clicks - open user profile
    handleInfoButtonClick(button) {
        const profilePermalink = button.dataset.profilePermalink;
        const profileUrl = button.dataset.profileUrl;
        const userId = button.dataset.userId;

        this.app?.logger?.log('ℹ️ Info button clicked for user:', { userId, profilePermalink, profileUrl });

        // Track feature discovery (essential user interaction)
        if (this.app.trackFeatureDiscovery) {
            this.app.trackFeatureDiscovery('user_profile_access', 'info_button');
        }

        // Priority: use profile_permalink from API, fallback to profile_url
        const targetUrl = profilePermalink || profileUrl;

        if (targetUrl) {
            // Construct full URL if it's a relative path
            const fullUrl = targetUrl.startsWith('http')
                ? targetUrl
                : `${window.location.protocol}//${window.location.host}${targetUrl.startsWith('/') ? '' : '/'}${targetUrl}`;

            this.app?.logger?.log(`🔗 Opening profile: ${fullUrl}`);
            window.open(fullUrl, '_blank', 'noopener,noreferrer');

            // Track info button click with success status
            if (this.app.logger) {
                this.app?.logger?.analytics('info_button_clicked', {
                    operation_status: 'success',
                    profile_url_type: profilePermalink ? 'permalink' : 'url',
                    source_context: 'search_results'
                });
            }
        } else {
            this.app?.logger?.log('⚠️ No profile URL available for user');
            WVFavs.DomManager.showSnackbar('❌ Profile URL not available', 'error');

            // Track info button click with failure status
            if (this.app.logger) {
                this.app?.logger?.analytics('info_button_clicked', {
                    operation_status: 'failure',
                    failure_reason: 'no_profile_url',
                    source_context: 'search_results'
                });
            }
        }
    }

    // Handle email button clicks - copy email to clipboard
    async handleEmailButtonClick(button) {
        const email = button.dataset.email;
        const userId = button.dataset.userId;

        // Track feature discovery (essential user interaction)
        if (this.app.trackFeatureDiscovery) {
            this.app.trackFeatureDiscovery('email_copy', 'email_button');
        }

        if (!email) {
            this.app?.logger?.log('⚠️ No email found for copy operation');
            WVFavs.DomManager.showSnackbar('❌ Email not available', 'error');

            // Track email button click with failure status
            if (this.app.logger) {
                this.app?.logger?.analytics('email_button_clicked', {
                    operation_status: 'failure',
                    failure_reason: 'no_email_available',
                    source_context: 'search_results'
                });
            }
            return;
        }

        const copyStartTime = performance.now();

        try {
            await navigator.clipboard.writeText(email);
            const copyDuration = Math.round(performance.now() - copyStartTime);

            this.app?.logger?.log(`📧 Email copied to clipboard: ${email}`);
            WVFavs.DomManager.showSnackbar(`📧 Copied: ${email}`, 'success');

            // Track email button click with success status
            if (this.app.logger) {
                this.app?.logger?.analytics('email_button_clicked', {
                    operation_status: 'success',
                    duration_ms: copyDuration,
                    source_context: 'search_results'
                });
            }
        } catch (error) {
            this.app?.logger?.log('❌ Failed to copy email:', error.message);

            // Fallback: create temporary input element
            try {
                const tempInput = document.createElement('input');
                tempInput.value = email;
                document.body.appendChild(tempInput);
                tempInput.select();
                document.execCommand('copy');
                document.body.removeChild(tempInput);

                const fallbackCopyDuration = Math.round(performance.now() - copyStartTime);

                this.app?.logger?.log(`📧 Email copied via fallback method: ${email}`);
                WVFavs.DomManager.showSnackbar(`📧 Copied: ${email}`, 'success');

                // Track email button click with success status (fallback method)
                if (this.app.logger) {
                    this.app?.logger?.analytics('email_button_clicked', {
                        operation_status: 'success',
                        duration_ms: fallbackCopyDuration,
                        failure_reason: error.message,
                        source_context: 'search_results'
                    });
                }
            } catch (fallbackError) {
                const failedCopyDuration = Math.round(performance.now() - copyStartTime);

                this.app?.logger?.log('❌ Fallback copy method also failed:', fallbackError.message);
                WVFavs.DomManager.showSnackbar('❌ Failed to copy email', 'error');

                // Track email button click with failure status
                if (this.app.logger) {
                    this.app?.logger?.analytics('email_button_clicked', {
                        operation_status: 'failure',
                        failure_reason: 'both_methods_failed',
                        duration_ms: failedCopyDuration,
                        source_context: 'search_results'
                    });
                }
            }
        }
    }

    // Smart data refresh system for sidebar clicks
    async smartDataRefresh(chatInfo) {
        this.app?.logger?.debug('🧠 Starting smart data refresh for:', chatInfo.name);
        this.app?.logger?.debug('🔍 Chat info ID:', chatInfo.id);

        // Step 1: Check if data exists in DB using text match
        const existingData = await this.checkExistingDataInDB(chatInfo.name);

        if (existingData) {
            this.app?.logger?.debug('📋 Found existing data in DB:', {
                id: existingData.id,
                name: existingData.name,
                type: existingData.type,
                isNameBased: String(existingData.id || '').startsWith('name_')
            });

            // If this is a name-based record, we don't know the real type yet
            // So we need to do comprehensive search to determine if it's user or channel
            if (String(existingData.id || '').startsWith('name_')) {
                this.app?.logger?.debug('🔄 Name-based record detected, performing comprehensive search to determine type...');
                const comprehensiveData = await this.performComprehensiveSearch(chatInfo.name);
                return await this.enrichChatInfo(chatInfo, comprehensiveData);
            } else {
                // This is already an API-based record, just refresh its metadata
                this.app?.logger?.debug('🚀 Starting refresh process for existing API data...');
                const refreshedData = await this.refreshExistingData(existingData);
                this.app?.logger?.debug('🏁 Refresh process completed, result:', !!refreshedData);
                return await this.enrichChatInfo(chatInfo, refreshedData);
            }
        } else {
            this.app?.logger?.debug('🔍 No existing data found, performing comprehensive search:', chatInfo.name);
            // Step 2b: Full comprehensive search and store
            const comprehensiveData = await this.performComprehensiveSearch(chatInfo.name);
            return await this.enrichChatInfo(chatInfo, comprehensiveData);
        }
    }

    // Check if data exists in DB using name-based ID
    async checkExistingDataInDB(chatName) {
        try {
            // Simply check for the name-based ID directly
            const nameBasedId = `name_${chatName.replace(/\s+/g, '')}`;
            this.app?.logger?.debug('🔍 Looking for name-based ID:', nameBasedId);

            const existingRecord = await this.app.smartUserDB.getUser(nameBasedId);
            this.app?.logger?.debug('📋 getUser result:', !!existingRecord);

            if (existingRecord) {
                this.app?.logger?.debug('✅ Found name-based record in DB:', existingRecord.name);
                return existingRecord;
            }

            // Also check if we already have the API record (in case of re-clicks)
            this.app?.logger?.debug('🔍 Searching locally for chat name:', chatName);
            const localResults = await this.app.smartUserDB.searchItemsLocally(chatName, 3);
            this.app?.logger?.debug('📋 Local search results count:', localResults.length);

            const apiMatch = localResults.find(item =>
                item.name && item.name.toLowerCase().trim() === chatName.toLowerCase().trim() &&
                item.id && !String(item.id || '').startsWith('name_')
            );

            if (apiMatch) {
                this.app?.logger?.debug('✅ Found existing API record in DB:', apiMatch.name);
                return apiMatch;
            }

            this.app?.logger?.debug('❌ No existing records found for:', chatName);
            return null;
        } catch (error) {
            this.app?.logger?.error('❌ Error checking existing data:', error);
            return null;
        }
    }

    // Refresh existing data with targeted API call
    async refreshExistingData(existingData) {
        try {
            this.app?.logger?.debug('🔄 Starting refresh for existing data:', existingData.name, 'Type:', existingData.type, 'ID:', existingData.id);

            if (existingData.type === 'user') {
                // Hit users endpoint for fresh user data
                this.app?.logger?.debug('🔄 Refreshing user data via users API:', existingData.name);
                const userResponse = await WVFavs.APIManager.executeSearchAPI(
                    `${window.location.protocol}//${window.location.host}/api/chat/users?page=1&query=${encodeURIComponent(existingData.name)}`
                );

                this.app?.logger?.debug('📊 API Response received:', !!userResponse, 'Data length:', userResponse?.data?.length || 0);

                if (userResponse?.data) {
                    this.app?.logger?.debug('🔍 Searching for match in API data...');
                    const matchedUser = userResponse.data.find(user =>
                        user.id === existingData.id ||
                        user.full_name === existingData.name ||
                        user.email === existingData.email
                    );

                    this.app?.logger?.debug('✅ Found matching user:', !!matchedUser, matchedUser ? `ID: ${matchedUser.id}` : 'None');

                    if (matchedUser) {
                        // Update with fresh data including avatar
                        const refreshedUserData = {
                            ...existingData,
                            id: matchedUser.id,  // Ensure we have the real API ID
                            email: matchedUser.email,
                            job_title: matchedUser.job_title,
                            department_name: matchedUser.department_name,
                            location_name: matchedUser.location_name,
                            profile_permalink: matchedUser.relative_permalink,
                            avatar: {
                                type: 'url',
                                content: matchedUser.avatar_url,
                                url: matchedUser.avatar_url
                            },
                            lastUpdated: Date.now()
                        };

                        this.app?.logger?.debug('🔧 About to transition record from name-based to API-based...');
                        // Transition from name-based record to API record
                        await this.transitionNameRecordToAPIRecord(refreshedUserData, existingData.name);
                        this.app?.logger?.debug('✅ Updated user data in DB with fresh avatar');
                        return refreshedUserData;
                    } else {
                        this.app?.logger?.debug('⚠️ No matching user found in API response');
                    }
                } else {
                    this.app?.logger?.debug('⚠️ No data in API response');
                }
            } else if (existingData.type === 'channel') {
                // Hit channels endpoint for fresh channel data
                this.app?.logger?.debug('🔄 Refreshing channel data via channels API:', existingData.name);
                const channelResponse = await WVFavs.APIManager.executeSearchAPI(
                    `${window.location.protocol}//${window.location.host}/api/chat/search/channels?query=${encodeURIComponent(existingData.name)}`
                );

                this.app?.logger?.debug('📊 Channel API Response received:', !!channelResponse, 'Channels length:', channelResponse?.channels?.length || 0);

                if (channelResponse?.channels) {
                    this.app?.logger?.debug('🔍 Searching for matching channel...');
                    const matchedChannel = channelResponse.channels.find(channel =>
                        channel.channel_url === existingData.channel_url ||
                        channel.name === existingData.name
                    );

                    this.app?.logger?.debug('✅ Found matching channel:', !!matchedChannel, matchedChannel ? `URL: ${matchedChannel.channel_url}` : 'None');

                    if (matchedChannel) {
                        // Update with fresh channel data
                        const refreshedChannelData = {
                            ...existingData,
                            id: matchedChannel.channel_url,  // Ensure we have the real channel URL as ID
                            member_count: matchedChannel.member_count,
                            is_distinct: matchedChannel.is_distinct,
                            is_public: matchedChannel.is_public,
                            avatar: {
                                type: 'url',
                                content: matchedChannel.cover_url,
                                url: matchedChannel.cover_url
                            },
                            lastUpdated: Date.now()
                        };

                        this.app?.logger?.debug('🔧 About to transition channel record from name-based to API-based...');
                        // Transition from name-based record to API record
                        await this.transitionNameRecordToAPIRecord(refreshedChannelData, existingData.name);
                        this.app?.logger?.debug('✅ Updated channel data in DB with fresh info');
                        return refreshedChannelData;
                    } else {
                        this.app?.logger?.debug('⚠️ No matching channel found in API response');
                    }
                } else {
                    this.app?.logger?.debug('⚠️ No channels in API response');
                }
            }

            // If refresh failed, return existing data
            this.app?.logger?.debug('⚠️ Could not refresh data, using existing');
            return existingData;

        } catch (error) {
            this.app?.logger?.debug('❌ Error refreshing existing data:', error.message);
            return existingData;
        }
    }

    // Perform comprehensive search for new data
    async performComprehensiveSearch(chatName) {
        try {
            this.app?.logger?.debug('🌐 Performing comprehensive search for:', chatName);
            const searchResults = await WVFavs.APIManager.comprehensiveSearch(chatName);

            this.app?.logger?.debug('📊 Comprehensive search results:', {
                users: searchResults?.users?.length || 0,
                channels: searchResults?.channels?.length || 0
            });

            if (searchResults && (searchResults.users?.length > 0 || searchResults.channels?.length > 0)) {
                // Deduplicate results - prioritize user records over channel records for same person
                const allResults = [...(searchResults.users || []), ...(searchResults.channels || [])];
                const deduplicatedResults = this.deduplicateResults(allResults);

                this.app?.logger?.debug('🔄 About to update existing records with API data...');
                // Update existing records instead of creating new ones
                await this.updateExistingRecordsWithAPIData(chatName, deduplicatedResults);

                // Find the best match
                const bestMatch = this.findBestMatch(chatName, deduplicatedResults);
                this.app?.logger?.debug('✅ Comprehensive search completed, found best match:', bestMatch?.name, 'Type:', bestMatch?.type);
                return bestMatch;
            }

            this.app?.logger?.debug('⚠️ Comprehensive search returned no results');
            return null;

        } catch (error) {
            this.app?.logger?.debug('❌ Error in comprehensive search:', error.message);
            return null;
        }
    }

    // Update existing name-based record with API data and transition to API ID
    async updateExistingRecordsWithAPIData(searchName, apiResults) {
        for (const apiResult of apiResults) {
            await this.transitionNameRecordToAPIRecord(apiResult, searchName);
        }
        this.app?.logger?.log(`📝 Transitioned ${apiResults.length} name-based records to API records`);
    }

    // Transition from name-based ID to API ID
    async transitionNameRecordToAPIRecord(apiData, originalSearchName = null) {
        try {
            // Look for name-based records using both API name and original search name
            const apiNameBasedId = `name_${apiData.name.replace(/\s+/g, '')}`;
            const searchNameBasedId = originalSearchName ? `name_${originalSearchName.replace(/\s+/g, '')}` : null;

            this.app?.logger?.debug('🔍 Looking for name-based records to transition:', {
                apiNameBasedId,
                searchNameBasedId,
                apiName: apiData.name,
                originalSearchName
            });

            // Check if API record already exists
            const existingApiRecord = await this.app.smartUserDB.getUser(apiData.id);
            if (existingApiRecord) {
                this.app?.logger?.debug('✅ API record already exists, just cleaning up name-based duplicates');

                // Delete both potential name-based records using raw IndexedDB
                const tx = this.app.smartUserDB.db.transaction(['users'], 'readwrite');
                const store = tx.objectStore('users');

                if (apiNameBasedId) {
                    store.delete(apiNameBasedId);
                    this.app?.logger?.debug('🗑️ Deleting duplicate:', apiNameBasedId);
                }
                if (searchNameBasedId && searchNameBasedId !== apiNameBasedId) {
                    store.delete(searchNameBasedId);
                    this.app?.logger?.debug('🗑️ Deleting duplicate:', searchNameBasedId);
                }

                await new Promise((resolve, reject) => {
                    tx.oncomplete = () => resolve();
                    tx.onerror = () => reject(tx.error);
                });
                return;
            }

            // Look for name-based record to transition
            let nameBasedRecord = null;
            let nameBasedId = null;

            // First try API name-based ID
            nameBasedRecord = await this.app.smartUserDB.getUser(apiNameBasedId);
            if (nameBasedRecord) {
                nameBasedId = apiNameBasedId;
                this.app?.logger?.debug('📋 Found name-based record with API name:', nameBasedId);
            } else if (searchNameBasedId && searchNameBasedId !== apiNameBasedId) {
                // Try search name-based ID
                nameBasedRecord = await this.app.smartUserDB.getUser(searchNameBasedId);
                if (nameBasedRecord) {
                    nameBasedId = searchNameBasedId;
                    this.app?.logger?.debug('📋 Found name-based record with search name:', nameBasedId);
                }
            }

            if (nameBasedRecord && nameBasedId) {
                this.app?.logger?.debug('🔄 Transitioning name-based record to API record:', nameBasedId, '→', apiData.id);

                // Preserve important flags from the existing record
                const preservedFlags = {
                    isPinned: nameBasedRecord.isPinned,
                    isRecent: nameBasedRecord.isRecent,
                    pinnedAt: nameBasedRecord.pinnedAt,
                    lastOpenedTime: nameBasedRecord.lastOpenedTime,
                    lastSeen: nameBasedRecord.lastSeen,
                    interactionCount: nameBasedRecord.interactionCount,
                    interactionMetrics: nameBasedRecord.interactionMetrics,
                };

                // Create merged record with API ID
                const mergedRecord = {
                    ...nameBasedRecord,  // Keep existing data
                    ...apiData,          // Overlay API data with real ID
                    ...preservedFlags,   // Force preserve flags
                    lastUpdated: Date.now()
                };

                this.app?.logger?.debug('📝 Preserving flags:', preservedFlags);

                // Delete old name-based record and store new API record using raw IndexedDB
                const tx = this.app.smartUserDB.db.transaction(['users'], 'readwrite');
                const store = tx.objectStore('users');

                // Delete the old name-based record
                store.delete(nameBasedId);
                this.app?.logger?.debug('🗑️ Deleting old name-based record:', nameBasedId);

                // Store the merged record with API ID
                store.put(mergedRecord);
                this.app?.logger?.debug('💾 Storing merged record with API ID:', apiData.id);

                await new Promise((resolve, reject) => {
                    tx.oncomplete = () => {
                        this.app?.logger?.debug('✅ Successfully transitioned record from', nameBasedId, 'to', apiData.id);
                        resolve();
                    };
                    tx.onerror = () => reject(tx.error);
                });
            } else {
                this.app?.logger?.debug('ℹ️ No name-based record found, storing new API record:', apiData.id);
                await this.app.smartUserDB.addItemsFromSearch(apiData.name, [apiData]);
            }

        } catch (error) {
            this.app?.logger?.error('❌ Error transitioning record:', error.message);
            // Fallback: just store the API record
            try {
                await this.app.smartUserDB.addItemsFromSearch(apiData.name, [apiData]);
            } catch (fallbackError) {
                this.app?.logger?.error('❌ Fallback storage also failed:', fallbackError);
            }
        }
    }

    // Deduplicate results by prioritizing user records over channel records for same person
    deduplicateResults(results) {
        const seen = new Map();
        const deduplicated = [];

        for (const item of results) {
            const key = item.name?.toLowerCase().trim();
            if (!key) continue;

            const existing = seen.get(key);

            if (!existing) {
                // First occurrence
                seen.set(key, item);
                deduplicated.push(item);
            } else if (item.type === 'user' && existing.type === 'channel') {
                // Replace channel with user record (user records have more data like email)
                const index = deduplicated.findIndex(d => d.name?.toLowerCase().trim() === key);
                if (index !== -1) {
                    deduplicated[index] = item;
                    seen.set(key, item);
                }
                this.app?.logger?.log('🔄 Replaced channel record with user record for:', item.name);
            }
            // If existing is user and current is channel, keep the user record (do nothing)
        }

        this.app?.logger?.log(`🧹 Deduplicated ${results.length} results to ${deduplicated.length} unique items`);
        return deduplicated;
    }

    // Find the best match from search results
    // IMPORTANT: Prioritizes user records over channel records for same name
    findBestMatch(searchName, results) {
        if (!results || results.length === 0) return null;

        // Look for exact name matches
        const exactMatches = results.filter(item =>
            item.name && item.name.toLowerCase().trim() === searchName.toLowerCase().trim()
        );

        if (exactMatches.length > 0) {
            // If multiple exact matches, prefer user type over channel type
            // (e.g., for "Xiao Hui Chin", prefer DM with person over group chat)
            const userMatch = exactMatches.find(item => item.type === 'user');
            if (userMatch) {
                this.app?.logger?.debug('✅ Selected user record over channel for:', searchName);
                return userMatch;
            }
            // Otherwise return first exact match
            return exactMatches[0];
        }

        // Look for partial match
        const partialMatch = results.find(item =>
            item.name && (
                item.name.toLowerCase().includes(searchName.toLowerCase()) ||
                searchName.toLowerCase().includes(item.name.toLowerCase())
            )
        );

        // Return best match or first result
        return partialMatch || results[0];
    }

    // Enrich chat info with API data
    async enrichChatInfo(originalChatInfo, apiData) {
        if (!apiData) {
            // Return original with basic navigation if no API data
            return {
                ...originalChatInfo,
                navigation: {
                    currentChatUrl: window.location.href,
                    chatNameForSearch: originalChatInfo.name
                }
            };
        }

        // CRITICAL: Check database for existing avatar to preserve it
        let existingAvatar = null;
        try {
            const existingRecord = await this.checkExistingDataInDB(originalChatInfo.name);
            if (existingRecord?.avatar) {
                existingAvatar = existingRecord.avatar;
                this.app?.logger?.debug('📦 Found existing avatar in DB for:', originalChatInfo.name, {
                    type: existingAvatar.type,
                    hasContent: !!existingAvatar.content,
                    hasExpiration: !!existingAvatar.expiresAt
                });
            }
        } catch (error) {
            this.app?.logger?.debug('⚠️ Could not check existing avatar:', error);
        }

        // Smart avatar selection: Prioritize image/url avatars over character avatars
        let bestAvatar = null;

        // Priority 1: If DB has an image/url avatar and it's not expired, keep it
        if (existingAvatar && (existingAvatar.type === 'image' || existingAvatar.type === 'url')) {
            const now = Date.now();
            const isExpired = existingAvatar.expiresAt && now >= existingAvatar.expiresAt;

            if (!isExpired) {
                this.app?.logger?.log('✅ Using existing DB avatar (image/url, not expired):', originalChatInfo.name);
                bestAvatar = existingAvatar;
            } else {
                this.app?.logger?.log('⏰ DB avatar expired, will check for fresher options:', originalChatInfo.name);
            }
        }

        // Priority 2: Only look for new avatars if we don't have a valid DB image
        if (!bestAvatar) {
            // Add expiration tracking to API avatar if it has one
            if (apiData.avatar) {
                bestAvatar = this.addAvatarExpiration(apiData.avatar);
                this.app?.logger?.debug('💡 Using API avatar:', originalChatInfo.name);
            }

            // Compare with original avatar (from DOM extraction)
            if (originalChatInfo.avatar) {
                const apiExpires = bestAvatar?.expiresAt || 0;
                const originalExpires = originalChatInfo.avatar?.expiresAt || 0;

                // Use whichever has later expiration
                if (originalExpires > apiExpires) {
                    this.app?.logger?.debug('💡 Using DOM avatar (fresher):', originalChatInfo.name);
                    bestAvatar = originalChatInfo.avatar;
                }
            }

            // Fallback: If we still don't have an avatar, preserve any existing one from DB
            if (!bestAvatar && existingAvatar) {
                this.app?.logger?.log('🔄 Preserving existing avatar from DB (fallback):', originalChatInfo.name);
                bestAvatar = existingAvatar;
            }
        }

        if (!bestAvatar) {
            this.app?.logger?.warn('⚠️ No avatar available from any source for:', originalChatInfo.name);
        }

        // Enrich with API data and update ID to API-based ID if available
        return {
            ...originalChatInfo,
            id: apiData.id || originalChatInfo.id, // Use API ID if available, fallback to original
            userId: apiData.user_id || apiData.id,
            email: apiData.email,
            avatar: bestAvatar, // Use freshest avatar
            type: apiData.type,
            channel_url: apiData.channel_url,
            job_title: apiData.job_title,
            department_name: apiData.department_name,
            navigation: {
                currentChatUrl: window.location.href,
                chatNameForSearch: originalChatInfo.name,
                channelUrl: apiData.channel_url
            }
        };
    }

    /**
     * Detect Sendbird channel URL for instant channel switching
     * Tries multiple sources in priority order:
     * 1. Database (fastest - cached from previous API calls)
     * 2. DOM data attributes (instant - if Workvivo sets them)
     * 3. window.__wvThreadData (from our fetch interceptor)
     */
    async detectAndDispatchChannelChange(currentActiveChatId) {
        if (!this.app.threadManager) {
            this.app?.logger?.debug('📍 detectAndDispatchChannelChange called but threadManager not available');
            return;
        }

        this.app?.logger?.debug('📍 detectAndDispatchChannelChange called for:', currentActiveChatId);

        try {
            let sendbirdChannelUrl = null;

            // Priority 1: Check if ID is already a Sendbird channel URL
            if (this.isSendbirdChannelUrl(currentActiveChatId)) {
                sendbirdChannelUrl = currentActiveChatId;
                this.app?.logger?.debug('📍 Chat ID is already Sendbird channel URL:', sendbirdChannelUrl);
            }

            // Priority 2: Look up in database by clean chat name from DOM
            if (!sendbirdChannelUrl) {
                const dbLookupStartTime = performance.now();
                try {
                    // Extract the actual clean chat name from the active sidebar button
                    const activeButton = document.querySelector('button.tw-bg-primary-50.tw-text-primary-600');
                    let cleanChatName = null;

                    if (activeButton) {
                        const chatNameSpan = activeButton.querySelector('span.tw-mr-1.tw-truncate');
                        if (chatNameSpan && chatNameSpan.textContent.trim()) {
                            cleanChatName = chatNameSpan.textContent.trim();
                            this.app?.logger?.debug('📍 Extracted clean chat name for DB lookup:', cleanChatName);
                        }
                    }

                    // Try database lookup with clean name first
                    let chatData = null;
                    let lookupMethod = null;

                    if (cleanChatName) {
                        chatData = await this.app.smartUserDB.getChatByName(cleanChatName);
                        lookupMethod = 'database_name_lookup';
                        this.app?.logger?.debug('📍 Name lookup result for "' + cleanChatName + '":', chatData ? 'found' : 'not found');

                        // Debug: Inspect the complete chatData object structure
                        if (chatData) {
                            this.app?.logger?.debug('📍 Complete chatData object:', JSON.stringify(chatData, null, 2));
                            this.app?.logger?.debug('📍 chatData.channel_url value:', chatData.channel_url);
                            this.app?.logger?.debug('📍 Object keys:', Object.keys(chatData));
                        }
                    }

                    // Fallback: try direct ID lookup (for Sendbird IDs)
                    if (!chatData && currentActiveChatId) {
                        chatData = await this.app.smartUserDB.getChat(currentActiveChatId);
                        lookupMethod = 'database_id_lookup';
                        this.app?.logger?.debug('📍 Direct ID lookup result:', chatData ? 'found' : 'not found');

                        // Debug: Inspect the complete chatData object structure
                        if (chatData) {
                            this.app?.logger?.debug('📍 Complete chatData object:', JSON.stringify(chatData, null, 2));
                            this.app?.logger?.debug('📍 chatData.channel_url value:', chatData.channel_url);
                            this.app?.logger?.debug('📍 Object keys:', Object.keys(chatData));
                        }
                    }

                    const dbLookupDuration = performance.now() - dbLookupStartTime;

                    if (chatData?.channel_url) {
                        sendbirdChannelUrl = chatData.channel_url;
                        this.app?.logger?.debug('📍 Found channel URL in database:', {
                            chatName: cleanChatName || currentActiveChatId,
                            channelUrl: sendbirdChannelUrl,
                            chatId: chatData.id
                        });

                        // Track successful database lookup
                        if (this.app.analytics) {
                            this.app.analytics.trackEvent('instant_channel_lookup', {
                                action_method: lookupMethod,
                                operation_status: 'success',
                                duration_ms: Math.round(dbLookupDuration),
                                chat_type: sendbirdChannelUrl.includes('_group_') ? 'group' : 'direct'
                            });
                        }
                    } else {
                        this.app?.logger?.debug('📍 No channel_url found for chat:', cleanChatName || currentActiveChatId);

                        // Track failed database lookup
                        if (this.app.analytics) {
                            this.app.analytics.trackEvent('instant_channel_lookup', {
                                action_method: lookupMethod || 'no_lookup_performed',
                                operation_status: 'failure',
                                duration_ms: Math.round(dbLookupDuration),
                                failure_reason: chatData ? 'no_channel_url_in_record' : 'record_not_found'
                            });
                        }
                    }
                } catch (error) {
                    this.app?.logger?.warn('📍 Database lookup failed:', error.message);

                    // Track database lookup error
                    const dbLookupDuration = performance.now() - dbLookupStartTime;
                    if (this.app.analytics) {
                        this.app.analytics.trackEvent('instant_channel_lookup', {
                            action_method: 'database_lookup',
                            operation_status: 'failure',
                            duration_ms: Math.round(dbLookupDuration),
                            failure_reason: 'database_error'
                        });
                    }
                }
            }

            // Priority 3: Check DOM data attributes
            if (!sendbirdChannelUrl) {
                const activeButton = document.querySelector('button.tw-bg-primary-50.tw-text-primary-600');
                if (activeButton) {
                    sendbirdChannelUrl = activeButton.dataset.channelUrl ||
                                        activeButton.getAttribute('data-sendbird-channel');
                    if (sendbirdChannelUrl) {
                        this.app?.logger?.debug('📍 Found channel URL in DOM:', sendbirdChannelUrl);
                    }
                }
            }

            // Priority 4: Check window.__wvThreadData (from fetch interceptor)
            if (!sendbirdChannelUrl && window.__wvThreadData?.currentChannel) {
                sendbirdChannelUrl = window.__wvThreadData.currentChannel;
                this.app?.logger?.debug('📍 Found channel URL from fetch interceptor:', sendbirdChannelUrl);
            }

            // If we have a Sendbird channel URL, dispatch instant channel change event
            if (sendbirdChannelUrl) {
                const previousChannel = this.app.threadManager.getCurrentChannel();

                // Only dispatch if channel actually changed
                if (sendbirdChannelUrl !== previousChannel) {
                    this.app?.logger?.log('📍 INSTANT channel change detected:', {
                        from: previousChannel,
                        to: sendbirdChannelUrl,
                        chatId: currentActiveChatId
                    });

                    window.dispatchEvent(new CustomEvent('wv-channel-changed', {
                        detail: {
                            previousChannel,
                            currentChannel: sendbirdChannelUrl,
                            source: 'instant_navigation'
                        }
                    }));

                    // Track successful instant channel change
                    if (this.app.analytics) {
                        this.app.analytics.trackEvent('instant_channel_change', {
                            operation_status: 'success',
                            chat_type: sendbirdChannelUrl.includes('_group_') ? 'group' : 'direct',
                            has_existing_conversation: !!previousChannel
                        });
                    }
                } else {
                    this.app?.logger?.log('📍 Channel unchanged, skipping dispatch:', sendbirdChannelUrl);
                }
            } else {
                this.app?.logger?.log('📍 No Sendbird channel URL found for:', currentActiveChatId, '- will wait for API');
            }
        } catch (error) {
            this.app?.logger?.warn('⚠️ Failed to detect channel for instant switching:', error.message);
        }
    }

    /**
     * Check if an ID is a Sendbird channel URL format
     */
    isSendbirdChannelUrl(id) {
        return id && typeof id === 'string' && id.startsWith('sendbird_group_channel_');
    }

    /**
     * Fetch fresh avatar from Sendbird API
     * Returns avatar data object or null
     */
    /**
     * Fetch complete channel details from Sendbird API with members
     * CRITICAL: Used to prevent race conditions by getting channel data from API (not DOM)
     */
    async fetchChannelDetailsFromSendbird(channelUrl) {
        try {
            this.app?.logger?.log('🔍 [RACE-FIX] Fetching channel details with members from Sendbird:', channelUrl);

            // Use APIManager to make authenticated Sendbird request
            const baseUrl = window.__wvSendbirdBaseUrl;
            if (!baseUrl) {
                throw new Error('Sendbird base URL not available');
            }

            // Include show_member=true to get member data (for extracting names)
            const url = `${baseUrl}/v3/group_channels/${encodeURIComponent(channelUrl)}?show_member=true&show_read_receipt=true&show_delivery_receipt=true`;

            const channelData = await WVFavs.APIManager.makeSendbirdAPIRequest(url);

            if (!channelData) {
                throw new Error('No channel data returned from Sendbird');
            }

            return channelData;
        } catch (error) {
            this.app?.logger?.error('❌ Failed to fetch channel details from Sendbird:', error.message);
            throw error;
        }
    }

    async fetchSendbirdAvatar(channelUrl, chatName) {
        try {
            this.app?.logger?.log('🔍 Fetching fresh avatar from Sendbird for:', chatName);

            // Determine if this is a group channel or direct message
            const isGroupChannel = channelUrl.includes('group_channel');

            if (isGroupChannel) {
                // Query Sendbird group channel API
                const channelData = await this.querySendbirdChannel(channelUrl);
                if (channelData?.cover_url) {
                    this.app?.logger?.log('✅ Got channel avatar from Sendbird:', channelData.cover_url);
                    return {
                        type: 'url',
                        content: channelData.cover_url,
                        src: channelData.cover_url
                    };
                }
            } else {
                // Query Sendbird member/user data
                const memberData = await this.querySendbirdMember(channelUrl);
                if (memberData?.profile_url) {
                    this.app?.logger?.log('✅ Got member avatar from Sendbird:', memberData.profile_url);
                    return {
                        type: 'url',
                        content: memberData.profile_url,
                        src: memberData.profile_url
                    };
                }
            }

            this.app?.logger?.log('⚠️ No avatar found in Sendbird for:', chatName);
            return null;
        } catch (error) {
            this.app?.logger?.warn('Failed to fetch Sendbird avatar:', error);
            return null;
        }
    }

    /**
     * Query Sendbird channel API for channel data
     */
    async querySendbirdChannel(channelUrl) {
        try {
            // Get Sendbird app ID from intercepted headers
            const appId = window.__wvSendbirdHeaders?.['sendbird-app-id'] ||
                         window.__wvSendbirdAppId;

            if (!appId) {
                this.app?.logger?.warn('Sendbird app ID not available');
                return null;
            }

            const url = `https://api-${appId}.sendbird.com/v3/group_channels/${encodeURIComponent(channelUrl)}`;
            this.app?.logger?.debug('📡 Querying Sendbird channel:', url);

            const response = await WVFavs.APIManager.makeSendbirdAPIRequest(url);
            return response;
        } catch (error) {
            this.app?.logger?.debug('Failed to query Sendbird channel:', error);
            return null;
        }
    }

    /**
     * Query Sendbird member data from channel
     */
    async querySendbirdMember(channelUrl) {
        try {
            const appId = window.__wvSendbirdHeaders?.['sendbird-app-id'] ||
                         window.__wvSendbirdAppId;

            if (!appId) return null;

            // First get channel details to find member user IDs
            const channelData = await this.querySendbirdChannel(channelUrl);
            if (!channelData?.members?.[0]) {
                this.app?.logger?.debug('No members found in channel data');
                return null;
            }

            // Get first member's profile (usually the other person in DM)
            const member = channelData.members[0];
            this.app?.logger?.debug('📡 Got member data:', member.nickname);
            return {
                profile_url: member.profile_url,
                nickname: member.nickname
            };
        } catch (error) {
            this.app?.logger?.debug('Failed to query Sendbird member:', error);
            return null;
        }
    }

    /**
     * Check if avatar is expired and needs refresh
     * Returns true if avatar needs to be refreshed
     */
    async checkAvatarExpiration(chatName) {
        try {
            // Get existing record
            const existingRecord = await this.checkExistingDataInDB(chatName);
            if (!existingRecord?.avatar) {
                this.app?.logger?.debug('📅 No avatar in DB for:', chatName, '- needs fetch');
                return true; // No avatar, needs fetch
            }

            // Check if avatar has expiration info
            if (!existingRecord.avatar.expiresAt) {
                // Old record without expiration tracking, assume expired
                this.app?.logger?.debug('📅 Avatar missing expiration for:', chatName, '- assuming expired');
                return true;
            }

            // Check if expired
            const now = Date.now();
            const isExpired = now >= existingRecord.avatar.expiresAt;

            if (isExpired) {
                const expiryDate = new Date(existingRecord.avatar.expiresAt).toISOString();
                this.app?.logger?.log('⏰ Avatar expired for:', chatName, 'Expired at:', expiryDate);
            } else {
                const timeLeft = Math.round((existingRecord.avatar.expiresAt - now) / 1000 / 60);
                this.app?.logger?.debug('✅ Avatar still fresh for:', chatName, `(${timeLeft} minutes left)`);
            }

            return isExpired;
        } catch (error) {
            this.app?.logger?.debug('Error checking avatar expiration:', error);
            return true; // Assume needs refresh on error
        }
    }

    /**
     * Extract avatar from sidebar chat button with expiration tracking
     */
    extractAvatarFromButton(chatButton) {
        try {
            this.app?.logger?.log('🔍 Extracting avatar from button...');

            // Find avatar container in the button using multiple selectors
            const avatarContainer = chatButton.querySelector('[class*="tw-w-"][class*="tw-h-"]') ||
                                  chatButton.querySelector('img, svg') ||
                                  chatButton.querySelector('[data-testid*="avatar"]');

            this.app?.logger?.log('🔍 Avatar container found:', !!avatarContainer, {
                hasWidthHeight: !!chatButton.querySelector('[class*="tw-w-"][class*="tw-h-"]'),
                hasImgSvg: !!chatButton.querySelector('img, svg'),
                hasTestId: !!chatButton.querySelector('[data-testid*="avatar"]')
            });

            if (avatarContainer) {
                const avatarData = WVFavs.DomDataExtractor.extractAvatarData(avatarContainer);
                this.app?.logger?.log('🔍 Avatar data extracted:', {
                    type: avatarData?.type,
                    hasContent: !!avatarData?.content,
                    hasSrc: !!avatarData?.src,
                    content: avatarData?.content?.substring?.(0, 100)
                });

                // Add expiration tracking
                const avatarWithExpiration = this.addAvatarExpiration(avatarData);
                this.app?.logger?.log('✅ Avatar extraction complete with expiration tracking');
                return avatarWithExpiration;
            } else {
                this.app?.logger?.warn('⚠️ No avatar container found in button');
            }
        } catch (error) {
            this.app?.logger?.error('❌ Failed to extract avatar from button:', error);
        }
        return null;
    }

    /**
     * Add expiration tracking to avatar data
     */
    addAvatarExpiration(avatarData) {
        if (!avatarData) return null;

        // Parse expires_at from URL
        const expiresAt = this.parseAvatarExpiration(avatarData);

        return {
            ...avatarData,
            fetchedAt: Date.now(),
            expiresAt: expiresAt
        };
    }

    /**
     * Parse expiration timestamp from avatar URL
     * Returns timestamp in milliseconds
     */
    parseAvatarExpiration(avatarData) {
        try {
            // Get URL from various avatar formats
            let avatarUrl = null;
            if (avatarData.type === 'url' || avatarData.type === 'image') {
                avatarUrl = avatarData.content || avatarData.src;
            } else if (typeof avatarData === 'string') {
                avatarUrl = avatarData;
            }

            if (!avatarUrl || typeof avatarUrl !== 'string') {
                // Default: 4 hours from now
                return Date.now() + (4 * 60 * 60 * 1000);
            }

            // Parse expires_at from URL
            const url = new URL(avatarUrl);
            const expiresParam = url.searchParams.get('expires_at') ||
                               url.searchParams.get('Expires') ||
                               url.searchParams.get('expires');

            if (expiresParam) {
                // Could be Unix timestamp (seconds) or milliseconds
                const expiresNum = parseInt(expiresParam);
                if (!isNaN(expiresNum)) {
                    // If less than current time in seconds, it's probably seconds, convert to ms
                    const expiresMs = expiresNum < 10000000000 ? expiresNum * 1000 : expiresNum;

                    // Validate it's in the future
                    if (expiresMs > Date.now()) {
                        this.app?.logger?.debug('📅 Parsed avatar expiration:', new Date(expiresMs).toISOString());
                        return expiresMs;
                    }
                }
            }

            // Default: 4 hours from now
            const defaultExpires = Date.now() + (4 * 60 * 60 * 1000);
            this.app?.logger?.debug('📅 Using default avatar expiration (4 hours):', new Date(defaultExpires).toISOString());
            return defaultExpires;
        } catch (error) {
            // Default: 4 hours from now
            return Date.now() + (4 * 60 * 60 * 1000);
        }
    }
})();