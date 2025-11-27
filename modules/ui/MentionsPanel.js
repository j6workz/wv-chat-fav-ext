/**
 * MentionsPanel - UI component for displaying @mentions
 * Similar to ThreadsPanel but shows all messages where the current user is mentioned
 */

var WVFavs = WVFavs || {};

WVFavs.MentionsPanel = class MentionsPanel {
    constructor(app) {
        this.app = app;
        this.currentPanel = null;
        this.isLoading = false;

        // Load show full message setting from localStorage: true or false (default)
        this.showFullMessage = localStorage.getItem('wv-mentions-show-full-message') === 'true';
    }

    /**
     * Open the mentions panel
     */
    async openMentionsPanel() {
        // Mark UI operation start to prevent cleanup during DOM stabilization
        this.app.smartUserDatabase?.markUIOperationStart();

        this.app?.logger?.log('📧 Opening mentions panel...');

        // Get current user
        const user = await this.app.userIdentity?.getCurrentUser();

        // Get mentions
        const mentions = await this.app.mentionsManager?.searchMentions(true);
        const stats = this.app.mentionsManager?.getStats();

        this.app?.logger?.log('📧 Mentions data:', {
            user,
            mentionsCount: mentions?.length || 0,
            stats
        });

        // Check if panel is already open, don't open another
        const existingPanel = document.querySelector('.wv-favorites-mentions-panel');
        if (existingPanel) {
            this.app?.logger?.log('📧 Mentions panel already open');
            this.app.smartUserDatabase?.markUIOperationEnd();
            return; // Panel already open, do nothing
        }

        // Track panel open
        if (this.app.analytics) {
            this.app.analytics.trackEvent('mentions_panel_opened', {
                mentions_count: mentions?.length || 0,
                user_detected: !!user
            });
        }

        // Find the message section to attach the panel
        const messageSection = document.querySelector('[data-testid="message-section"]');
        if (!messageSection) {
            this.app?.logger?.log('❌ Could not find message section');
            this.app.smartUserDatabase?.markUIOperationEnd();
            return;
        }

        // Create panel
        const panel = this.createPanelElement(user, mentions, stats);
        this.currentPanel = panel;

        // Append to message section
        messageSection.style.position = 'relative';
        messageSection.appendChild(panel);

        // Adjust chat content to make room for mentions panel
        const chatContent = messageSection.querySelector('[data-testid="chat-content"]');
        if (chatContent) {
            chatContent.style.marginRight = '400px';
            this.app?.logger?.debug('✅ Adjusted chat content margin for mentions panel');
        }

        // Add CSS animations
        this.addPanelAnimations();

        // Set up event listeners for panel
        this.setupPanelEventListeners(panel, user, mentions);

        this.app?.logger?.log('✅ Mentions panel opened');

        // Mark UI operation complete - cleanup can resume
        this.app.smartUserDatabase?.markUIOperationEnd();
    }

    /**
     * Create the panel DOM element
     */
    createPanelElement(user, mentions, stats) {
        const panel = document.createElement('div');
        panel.className = 'wv-favorites-mentions-panel';
        panel.style.cssText = `
            position: absolute;
            top: 12px;
            right: 12px;
            width: 380px;
            max-height: calc(100vh - 140px);
            background: white;
            border-radius: 16px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
            display: flex;
            flex-direction: column;
            overflow: hidden;
            z-index: 1000;
            animation: slideInRight 0.3s ease-out;
        `;

        // Create header
        const header = this.createHeader();
        panel.appendChild(header);

        // Create mentions list (no tabs - just show all)
        const mentionsList = this.createMentionsList(mentions, user);
        panel.appendChild(mentionsList);

        // Create footer with show full message toggle
        console.log('🔍 [MentionsPanel] Creating footer...');
        const footer = this.createFooter();
        console.log('🔍 [MentionsPanel] Footer created:', footer);
        console.log('🔍 [MentionsPanel] Footer HTML:', footer.innerHTML.substring(0, 200));
        panel.appendChild(footer);
        console.log('🔍 [MentionsPanel] Footer appended to panel');

        return panel;
    }

    /**
     * Create panel header
     */
    createHeader() {
        const header = document.createElement('div');
        header.style.cssText = `
            padding: 20px;
            border-bottom: 1px solid #e2e8f0;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            flex-shrink: 0;
        `;

        header.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: space-between;">
                <div style="display: flex; align-items: center; gap: 12px;">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                        <text x="12" y="14" font-size="10" fill="currentColor" text-anchor="middle" font-weight="bold">@</text>
                    </svg>
                    <h3 style="margin: 0; font-size: 18px; font-weight: 600;">Mentions</h3>
                </div>
                <button class="wv-favorites-mentions-close" style="
                    background: rgba(255, 255, 255, 0.2);
                    border: none;
                    color: white;
                    width: 32px;
                    height: 32px;
                    border-radius: 8px;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: background 0.2s;
                ">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M18 6L6 18M6 6l12 12"/>
                    </svg>
                </button>
            </div>
        `;

        return header;
    }

    /**
     * Create panel footer with show full message toggle
     */
    createFooter() {
        console.log('🔍 [MentionsPanel] createFooter() called');
        const footer = document.createElement('div');
        footer.className = 'wv-mentions-footer';
        footer.style.cssText = `
            padding: 12px 20px;
            border-top: 1px solid #e2e8f0;
            background: #f8fafc;
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 13px;
            flex-shrink: 0;
        `;

        console.log('🔍 [MentionsPanel] showFullMessage setting:', this.showFullMessage);

        footer.innerHTML = `
            <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; user-select: none; margin-bottom: 0;">
                <input type="checkbox" class="wv-mentions-show-full-toggle" ${this.showFullMessage ? 'checked' : ''}
                    style="width: 14px; height: 14px; cursor: pointer;">
                <span style="color: #475569; margin-bottom: 0;">Show full message</span>
            </label>
        `;

        // Add click handler to checkbox
        const checkbox = footer.querySelector('.wv-mentions-show-full-toggle');
        console.log('🔍 [MentionsPanel] Checkbox element:', checkbox);

        checkbox.addEventListener('change', () => {
            this.showFullMessage = checkbox.checked;
            localStorage.setItem('wv-mentions-show-full-message', this.showFullMessage.toString());

            console.log('🔍 [MentionsPanel] Toggle changed to:', this.showFullMessage);

            // Find the panel that contains this footer
            const panel = footer.closest('.wv-favorites-mentions-panel, .wv-favorites-global-mentions-panel');
            console.log('🔍 [MentionsPanel] Found panel:', panel?.className);

            // Re-render the panel with new setting
            const currentMentions = panel?.querySelectorAll('.wv-favorites-mention-item');
            if (currentMentions) {
                console.log('🔍 [MentionsPanel] Updating', currentMentions.length, 'mention items');
                currentMentions.forEach(item => {
                    const messageDiv = item.querySelector('.wv-mention-message-text');
                    if (messageDiv) {
                        this.applyMessageDisplayMode(messageDiv, this.showFullMessage);
                    }
                });
            } else {
                console.warn('⚠️ [MentionsPanel] No mention items found to update');
            }
        });

        return footer;
    }

    /**
     * Create debug info section showing detected user
     */
    createDebugInfo(user, stats) {
        const debugSection = document.createElement('div');
        debugSection.className = 'wv-favorites-mentions-debug';
        debugSection.style.cssText = `
            padding: 12px 20px;
            background: #f8fafc;
            border-bottom: 1px solid #e2e8f0;
            font-size: 12px;
            color: #64748b;
        `;

        const detectionMethod = user.detected_from || 'unknown';
        const detectedAt = user.detected_at ? new Date(user.detected_at).toLocaleTimeString() : 'N/A';

        debugSection.innerHTML = `
            <div style="display: flex; align-items: flex-start; gap: 8px; margin-bottom: 8px;">
                <div style="
                    width: 32px;
                    height: 32px;
                    border-radius: 50%;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: white;
                    font-weight: 600;
                    font-size: 14px;
                    flex-shrink: 0;
                ">
                    ${this.getInitials(user.name || user.nickname || 'U')}
                </div>
                <div style="flex: 1; min-width: 0;">
                    <div style="font-weight: 600; color: #334155; margin-bottom: 2px;">
                        Searching for mentions of:
                    </div>
                    <div style="color: #475569; font-weight: 500; margin-bottom: 2px;">
                        ${this.escapeHtml(user.name || user.nickname || 'Unknown User')}
                    </div>
                    <div style="color: #94a3b8; font-size: 11px; font-family: monospace;">
                        ID: ${this.escapeHtml(user.id || 'unknown')}
                    </div>
                </div>
            </div>
            <div style="display: flex; gap: 12px; padding-top: 8px; border-top: 1px solid #e2e8f0;">
                <div style="flex: 1;">
                    <div style="font-weight: 500; color: #64748b; margin-bottom: 2px;">Detection</div>
                    <div style="color: #475569; font-size: 11px;">${this.formatDetectionMethod(detectionMethod)}</div>
                </div>
                <div style="flex: 1;">
                    <div style="font-weight: 500; color: #64748b; margin-bottom: 2px;">Detected At</div>
                    <div style="color: #475569; font-size: 11px;">${detectedAt}</div>
                </div>
                <div style="flex: 1;">
                    <div style="font-weight: 500; color: #64748b; margin-bottom: 2px;">Status</div>
                    <div style="color: #059669; font-size: 11px; font-weight: 600;">✓ Active</div>
                </div>
            </div>
        `;

        return debugSection;
    }

    /**
     * Create "detecting user" info section
     */
    createDetectingUserInfo() {
        const detectingSection = document.createElement('div');
        detectingSection.style.cssText = `
            padding: 16px 20px;
            background: #fef3c7;
            border-bottom: 1px solid #fde047;
            font-size: 13px;
            color: #92400e;
        `;

        detectingSection.innerHTML = `
            <div style="display: flex; align-items: center; gap: 12px;">
                <div style="
                    width: 24px;
                    height: 24px;
                    border: 3px solid #f59e0b;
                    border-top-color: transparent;
                    border-radius: 50%;
                    animation: spin 1s linear infinite;
                "></div>
                <div>
                    <div style="font-weight: 600; margin-bottom: 2px;">Detecting User Identity...</div>
                    <div style="font-size: 11px; opacity: 0.8;">Analyzing API calls and page data</div>
                </div>
            </div>
        `;

        // Add spin animation
        if (!document.querySelector('#wv-spin-animation')) {
            const style = document.createElement('style');
            style.id = 'wv-spin-animation';
            style.textContent = `
                @keyframes spin {
                    to { transform: rotate(360deg); }
                }
            `;
            document.head.appendChild(style);
        }

        return detectingSection;
    }

    /**
     * Create tabs for Unread/All filter
     */
    createTabs() {
        const tabsContainer = document.createElement('div');
        tabsContainer.className = 'wv-favorites-mentions-tabs';
        tabsContainer.style.cssText = `
            display: flex;
            gap: 0;
            padding: 8px 12px;
            border-bottom: 1px solid #e5e7eb;
            background: white;
        `;

        tabsContainer.innerHTML = `
            <div style="display: inline-flex; border: 1px solid #d1d5db; border-radius: 6px; overflow: hidden; width: 100%;">
                <button class="wv-mentions-tab wv-mentions-tab-active" data-tab="unread" style="
                    flex: 1;
                    padding: 6px 12px;
                    border: none;
                    border-right: 1px solid #d1d5db;
                    background: #eff6ff;
                    cursor: pointer;
                    font-size: 12px;
                    font-weight: 600;
                    color: #1e40af;
                    transition: all 0.15s;
                ">
                    Unread
                </button>
                <button class="wv-mentions-tab" data-tab="all" style="
                    flex: 1;
                    padding: 6px 12px;
                    border: none;
                    background: white;
                    cursor: pointer;
                    font-size: 12px;
                    font-weight: 500;
                    color: #374151;
                    transition: all 0.15s;
                ">
                    All
                </button>
            </div>
        `;

        return tabsContainer;
    }

    /**
     * Create mentions list container
     */
    createMentionsList(mentions, user) {
        const container = document.createElement('div');
        container.className = 'wv-favorites-mentions-list-container';
        container.style.cssText = `
            flex: 1;
            overflow-y: auto;
            padding: 8px 12px;
            background: #f9fafb;
            min-height: 0;
        `;

        const mentionsList = document.createElement('div');
        mentionsList.className = 'wv-favorites-mentions-list';
        container.appendChild(mentionsList);

        // Show all mentions
        this.renderMentionsList(mentionsList, mentions, user);

        return container;
    }

    /**
     * Render mentions list
     */
    renderMentionsList(listElement, mentions, user) {
        listElement.innerHTML = '';

        if (!user) {
            listElement.innerHTML = `
                <div style="text-align: center; padding: 40px 20px; color: #94a3b8;">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin: 0 auto 16px;">
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                        <circle cx="12" cy="7" r="4"/>
                    </svg>
                    <p style="margin: 0; font-size: 14px;">Detecting user identity...</p>
                    <p style="margin: 8px 0 0 0; font-size: 12px; color: #cbd5e1;">Please wait while we identify your account</p>
                </div>
            `;
            return;
        }

        if (!mentions || mentions.length === 0) {
            listElement.innerHTML = `
                <div style="text-align: center; padding: 40px 20px; color: #94a3b8;">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin: 0 auto 16px;">
                        <circle cx="12" cy="12" r="10"/>
                        <text x="12" y="16" font-size="14" fill="currentColor" text-anchor="middle" font-weight="bold">@</text>
                    </svg>
                    <p style="margin: 0; font-size: 14px;">No mentions found</p>
                    <p style="margin: 8px 0 0 0; font-size: 12px; color: #cbd5e1;">You haven't been mentioned yet</p>
                </div>
            `;
            return;
        }

        // Render mention items
        mentions.forEach(mention => {
            const mentionItem = this.createMentionItem(mention, user);
            listElement.appendChild(mentionItem);
        });

        // Add "Load More" button if there are more mentions
        const stats = this.app.mentionsManager?.getStats();
        if (stats?.has_more) {
            const loadMoreBtn = this.createLoadMoreButton();
            listElement.appendChild(loadMoreBtn);
        }
    }

    /**
     * Create a single mention item
     */
    createMentionItem(mention, user = null) {
        const item = document.createElement('div');
        item.className = 'wv-favorites-mention-item';
        item.dataset.messageId = mention.message_id;
        item.dataset.channelUrl = mention.channel_url;

        item.style.cssText = `
            background: white;
            border-radius: 8px;
            padding: 12px;
            margin-bottom: 8px;
            cursor: pointer;
            transition: all 0.2s;
            border: 1px solid #e5e7eb;
            box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
        `;

        // Sender avatar - use actual profile image or fallback to initials
        const senderInitials = this.getInitials(mention.sender?.name || 'U');
        const hasProfileImage = mention.sender?.profile_url;

        // Format timestamp
        const timestamp = this.formatTimestamp(mention.created_at);

        // Clean message text (remove markdown, mentions formatting)
        const messagePreview = this.cleanMessageText(mention.message);

        // Thread indicator
        const threadBadge = mention.is_reply ? `
            <span style="
                display: inline-flex;
                align-items: center;
                gap: 4px;
                padding: 2px 8px;
                background: #f1f5f9;
                border-radius: 4px;
                font-size: 10px;
                color: #64748b;
                margin-left: 8px;
            ">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="17 1 21 5 17 9"/>
                    <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
                </svg>
                Reply
            </span>
        ` : '';

        // Channel name section (only show if channel name exists)
        const channelSection = mention.channel_name ? `
            <div class="wv-mention-channel-section" style="font-size: 12px; color: #64748b; margin-bottom: 6px; display: flex; align-items: center; gap: 4px;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink: 0;">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
                <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0;">${this.escapeHtml(mention.channel_name)}</span>
                ${threadBadge}
            </div>
        ` : (mention.is_reply ? `
            <div class="wv-mention-channel-section" style="font-size: 12px; color: #64748b; margin-bottom: 6px; display: flex; align-items: center;">
                ${threadBadge}
            </div>
        ` : '');

        // Avatar HTML - either image or initials
        const avatarHtml = hasProfileImage ? `
            <img src="${this.escapeHtml(mention.sender.profile_url)}"
                 alt="${this.escapeHtml(mention.sender?.name || 'User')}"
                 style="
                    width: 40px;
                    height: 40px;
                    border-radius: 50%;
                    object-fit: cover;
                    flex-shrink: 0;
                 "
                 onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';"
            />
            <div style="
                width: 40px;
                height: 40px;
                border-radius: 50%;
                background: #3b82f6;
                display: none;
                align-items: center;
                justify-content: center;
                color: white;
                font-weight: 600;
                font-size: 14px;
                flex-shrink: 0;
            ">
                ${senderInitials}
            </div>
        ` : `
            <div style="
                width: 40px;
                height: 40px;
                border-radius: 50%;
                background: #3b82f6;
                display: flex;
                align-items: center;
                justify-content: center;
                color: white;
                font-weight: 600;
                font-size: 14px;
                flex-shrink: 0;
            ">
                ${senderInitials}
            </div>
        `;

        item.innerHTML = `
            <div style="display: flex; gap: 12px;">
                ${avatarHtml}
                <div style="flex: 1; min-width: 0;" data-message-content="${mention.message_id}">
                    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
                        <div style="font-weight: 600; color: #1e293b; font-size: 13px;">
                            ${this.escapeHtml(mention.sender?.name || 'Unknown')}
                        </div>
                        <div style="font-size: 11px; color: #94a3b8; flex-shrink: 0;">
                            ${timestamp}
                        </div>
                    </div>
                    ${channelSection}
                    <div class="wv-mention-message-text" style="font-size: 13px; color: #334155; line-height: 1.5; word-wrap: break-word;">
                        ${this.highlightMentions(mention.message, user)}
                    </div>
                </div>
            </div>
        `;

        // Apply line clamp based on current setting
        const messageText = item.querySelector('.wv-mention-message-text');
        if (messageText) {
            this.applyMessageDisplayMode(messageText, this.showFullMessage);
        }

        // Hover effects
        item.addEventListener('mouseenter', () => {
            item.style.transform = 'translateX(-4px)';
            item.style.boxShadow = '0 4px 12px rgba(102, 126, 234, 0.2)';
        });

        item.addEventListener('mouseleave', () => {
            item.style.transform = 'translateX(0)';
            item.style.boxShadow = '0 1px 3px rgba(0, 0, 0, 0.1)';
        });

        return item;
    }

    /**
     * Create "Load More" button
     */
    createLoadMoreButton() {
        const button = document.createElement('button');
        button.className = 'wv-favorites-mentions-load-more';
        button.style.cssText = `
            width: 100%;
            padding: 12px;
            border: 2px dashed #cbd5e1;
            border-radius: 12px;
            background: white;
            color: #64748b;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
            margin-top: 8px;
        `;

        button.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: center; gap: 8px;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="23 4 23 10 17 10"/>
                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                </svg>
                Load More Mentions
            </div>
        `;

        button.addEventListener('mouseenter', () => {
            button.style.borderColor = '#667eea';
            button.style.color = '#667eea';
            button.style.background = '#f8fafc';
        });

        button.addEventListener('mouseleave', () => {
            button.style.borderColor = '#cbd5e1';
            button.style.color = '#64748b';
            button.style.background = 'white';
        });

        return button;
    }

    /**
     * Set up event listeners for the panel
     * @param {boolean} isGlobalPanel - Whether this is the global mentions panel
     */
    setupPanelEventListeners(panel, user, mentions, isGlobalPanel = false) {

        // Close button
        const closeBtn = panel.querySelector('.wv-favorites-mentions-close');
        closeBtn.addEventListener('click', () => {
            panel.remove();

            // Restore chat content margin (only for per-channel panel)
            if (!isGlobalPanel) {
                const messageSection = document.querySelector('[data-testid="message-section"]');
                const chatContent = messageSection?.querySelector('[data-testid="chat-content"]');
                if (chatContent) {
                    chatContent.style.marginRight = '0';
                }
            }

            if (this.app.analytics) {
                this.app.analytics.trackEvent(isGlobalPanel ? 'global_mentions_panel_closed' : 'mentions_panel_closed', {
                    action_method: 'close_button',
                    mentions_count: mentions?.length || 0
                });
            }
        });

        closeBtn.addEventListener('mouseenter', () => {
            closeBtn.style.background = isGlobalPanel ? '#f3f4f6' : 'rgba(255, 255, 255, 0.3)';
        });

        closeBtn.addEventListener('mouseleave', () => {
            closeBtn.style.background = isGlobalPanel ? 'transparent' : 'rgba(255, 255, 255, 0.2)';
        });

        // Tab switching
        // Mention item clicks
        this.attachMentionClickHandlers(panel);

        // Load more button
        this.attachLoadMoreHandler(panel);

        // Listen for user identification updates (only for per-channel panels)
        if (!isGlobalPanel) {
            const handleUserUpdate = async () => {
                this.app?.logger?.log('📧 User identified, refreshing mentions panel...');

                // Refresh mentions
                const newUser = await this.app.userIdentity?.getCurrentUser();
                const newMentions = await this.app.mentionsManager?.searchMentions(true);

                // Close and reopen panel with new data
                panel.remove();
                await this.openMentionsPanel();
            };

            window.addEventListener('wv-user-saved', handleUserUpdate);
            panel.dataset.userUpdateListener = 'attached';
        }
    }

    /**
     * Attach click handlers to mention items
     */
    attachMentionClickHandlers(panel) {
        const mentionItems = panel.querySelectorAll('.wv-favorites-mention-item');

        mentionItems.forEach(item => {
            item.addEventListener('click', async () => {
                const messageId = item.dataset.messageId;
                const channelUrl = item.dataset.channelUrl;

                this.app?.logger?.log('📧 Navigating to mention:', { messageId, channelUrl });

                // Debug: Check types
                console.log('🔍 === MESSAGE ID TYPE CHECK ===');
                console.log('🔍 messageId from dataset:', messageId, 'type:', typeof messageId);
                console.log('🔍 mentions array length:', this.app.mentionsManager?.mentions.length);
                if (this.app.mentionsManager?.mentions.length > 0) {
                    console.log('🔍 First mention message_id:', this.app.mentionsManager.mentions[0].message_id, 'type:', typeof this.app.mentionsManager.mentions[0].message_id);
                }

                // Find the full mention object to check if it's a reply
                // Convert messageId to number for comparison since dataset values are strings
                const messageIdNum = parseInt(messageId, 10);
                const mention = this.app.mentionsManager?.mentions.find(m => m.message_id === messageIdNum);

                // Mark as read
                if (this.app.mentionsManager) {
                    this.app.mentionsManager.markAsRead(messageId);
                }

                // Track click
                if (this.app.analytics) {
                    this.app.analytics.trackEvent('mention_clicked', {
                        message_id: messageId,
                        has_channel_url: !!channelUrl,
                        is_reply: !!mention?.is_reply,
                        parent_message_id: mention?.parent_message_id || null
                    });
                }

                // Navigate to the message or parent message (if reply)
                if (WVFavs.DomManager && WVFavs.DomManager.navigateToMention) {
                    // Debug: Log the mention object to see what we have
                    console.log('🔍 === MENTION CLICK DEBUG ===');
                    console.log('🔍 Looking for message ID:', messageId);
                    console.log('🔍 Mention found:', !!mention);
                    console.log('🔍 mention.is_reply:', mention?.is_reply);
                    console.log('🔍 mention.parent_message_id:', mention?.parent_message_id);
                    console.log('🔍 Full mention object:', mention);
                    console.log('🔍 All mention keys:', mention ? Object.keys(mention) : []);

                    // If this is a reply (thread reply), navigate to the parent thread and open it
                    const isReply = !!(mention?.is_reply && mention?.parent_message_id);
                    const parentMessageId = isReply ? mention.parent_message_id : null;
                    const replyMessageId = isReply ? messageId : null;

                    this.app?.logger?.log('📧 Navigation details:', {
                        originalMessageId: messageId,
                        parentMessageId,
                        replyMessageId,
                        isReply,
                        willOpenThread: isReply
                    });

                    // Pass parent message ID, reply message ID, and created_at timestamp
                    await WVFavs.DomManager.navigateToMention(
                        channelUrl,
                        isReply ? parentMessageId : messageId,
                        isReply,
                        replyMessageId,
                        mention?.created_at  // CRITICAL: Pass timestamp for loading old messages
                    );
                } else {
                    this.app?.logger?.log('⚠️ navigateToMention not implemented in DomManager yet');
                }

                // Don't close panel - keep it open for reference
            });
        });
    }

    /**
     * Attach handler for Load More button
     */
    attachLoadMoreHandler(panel) {
        const loadMoreBtn = panel.querySelector('.wv-favorites-mentions-load-more');

        if (loadMoreBtn) {
            loadMoreBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();

                console.log('📧 === LOAD MORE BUTTON CLICKED ===');

                if (this.isLoading) {
                    console.log('📧 Already loading, skipping...');
                    return;
                }

                this.isLoading = true;
                loadMoreBtn.disabled = true;
                loadMoreBtn.innerHTML = `
                    <div style="display: flex; align-items: center; justify-content: center; gap: 8px;">
                        <div style="
                            width: 14px;
                            height: 14px;
                            border: 2px solid #cbd5e1;
                            border-top-color: #667eea;
                            border-radius: 50%;
                            animation: spin 1s linear infinite;
                        "></div>
                        Loading...
                    </div>
                `;

                try {
                    console.log('📧 Calling loadMore()...');
                    // Load more mentions
                    const newMentions = await this.app.mentionsManager?.loadMore();
                    console.log('📧 LoadMore returned:', newMentions?.length, 'mentions');

                    const user = await this.app.userIdentity?.getCurrentUser();

                    // Re-render list
                    const mentionsList = panel.querySelector('.wv-favorites-mentions-list');
                    if (mentionsList) {
                        console.log('📧 Re-rendering mentions list...');
                        this.renderMentionsList(mentionsList, newMentions, user);

                        // Re-attach handlers
                        console.log('📧 Re-attaching click handlers...');
                        this.attachMentionClickHandlers(panel);
                        this.attachLoadMoreHandler(panel);

                        // Re-attach footer toggle handler
                        this.reattachFooterHandlers(panel);

                        // Fetch channel names progressively for newly loaded mentions
                        console.log('🔄 Fetching channel names for newly loaded mentions...');
                        this.fetchChannelNamesProgressively(newMentions, mentionsList);
                    } else {
                        console.error('❌ Mentions list element not found!');
                    }

                    // Track load more
                    if (this.app.analytics) {
                        this.app.analytics.trackEvent('mentions_load_more', {
                            total_mentions: newMentions?.length || 0
                        });
                    }

                    console.log('📧 Load more completed successfully');
                } catch (error) {
                    console.error('❌ Error loading more mentions:', error);
                    this.app?.logger?.log('❌ Error loading more mentions:', error);

                    // Re-enable button on error
                    loadMoreBtn.disabled = false;
                    loadMoreBtn.innerHTML = `
                        <div style="display: flex; align-items: center; justify-content: center; gap: 8px;">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="23 4 23 10 17 10"/>
                                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                            </svg>
                            Load More Mentions (Error - Retry)
                        </div>
                    `;
                } finally {
                    this.isLoading = false;
                    console.log('📧 isLoading set to false');
                }
            });
        }
    }

    /**
     * Add CSS animations
     */
    addPanelAnimations() {
        if (!document.querySelector('#wv-mentions-panel-animations')) {
            const style = document.createElement('style');
            style.id = 'wv-mentions-panel-animations';
            style.textContent = `
                @keyframes slideInRight {
                    from {
                        transform: translateX(100%);
                        opacity: 0;
                    }
                    to {
                        transform: translateX(0);
                        opacity: 1;
                    }
                }

                @keyframes slideInLeft {
                    from {
                        transform: translateX(-100%);
                        opacity: 0;
                    }
                    to {
                        transform: translateX(0);
                        opacity: 1;
                    }
                }

                @keyframes slideOutLeft {
                    from {
                        transform: translateX(0);
                        opacity: 1;
                    }
                    to {
                        transform: translateX(-100%);
                        opacity: 0;
                    }
                }

                .wv-favorites-mentions-list-container::-webkit-scrollbar {
                    width: 8px;
                }

                .wv-favorites-mentions-list-container::-webkit-scrollbar-track {
                    background: #f1f5f9;
                    border-radius: 4px;
                }

                .wv-favorites-mentions-list-container::-webkit-scrollbar-thumb {
                    background: #cbd5e1;
                    border-radius: 4px;
                }

                .wv-favorites-mentions-list-container::-webkit-scrollbar-thumb:hover {
                    background: #94a3b8;
                }
            `;
            document.head.appendChild(style);
        }
    }

    /**
     * Re-attach footer event handlers (after panel refresh)
     */
    reattachFooterHandlers(panel) {
        const checkbox = panel.querySelector('.wv-mentions-show-full-toggle');
        if (!checkbox) {
            console.warn('⚠️ [MentionsPanel] Footer checkbox not found for re-attachment');
            return;
        }

        // Remove old listeners by cloning the element
        const newCheckbox = checkbox.cloneNode(true);
        checkbox.parentNode.replaceChild(newCheckbox, checkbox);

        // Add fresh listener
        newCheckbox.addEventListener('change', () => {
            this.showFullMessage = newCheckbox.checked;
            localStorage.setItem('wv-mentions-show-full-message', this.showFullMessage.toString());

            console.log('🔍 [MentionsPanel] Toggle changed to:', this.showFullMessage);

            // Re-render the panel with new setting
            const currentMentions = panel.querySelectorAll('.wv-favorites-mention-item');
            if (currentMentions) {
                console.log('🔍 [MentionsPanel] Updating', currentMentions.length, 'mention items');
                currentMentions.forEach(item => {
                    const messageDiv = item.querySelector('.wv-mention-message-text');
                    if (messageDiv) {
                        this.applyMessageDisplayMode(messageDiv, this.showFullMessage);
                    }
                });
            }
        });

        console.log('✅ [MentionsPanel] Footer handlers re-attached');
    }

    /**
     * Apply message display mode (full or clamped)
     */
    applyMessageDisplayMode(messageElement, showFull) {
        if (!messageElement) return;

        // Clear all line-clamp related styles first
        messageElement.style.overflow = '';
        messageElement.style.display = '';
        messageElement.style.webkitLineClamp = '';
        messageElement.style.webkitBoxOrient = '';

        if (showFull) {
            // Show full message - just regular block display
            messageElement.style.display = 'block';
            console.log('📖 [MentionsPanel] Applied full message display');
        } else {
            // Apply line clamp - truncate to 2 lines
            messageElement.style.overflow = 'hidden';
            messageElement.style.display = '-webkit-box';
            messageElement.style.webkitLineClamp = '2';
            messageElement.style.webkitBoxOrient = 'vertical';
            console.log('📄 [MentionsPanel] Applied clamped message display');
        }
    }

    /**
     * Helper: Get initials from name
     */
    getInitials(name) {
        if (!name) return 'U';
        const parts = name.trim().split(' ');
        if (parts.length >= 2) {
            return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
        }
        return name.substring(0, 2).toUpperCase();
    }

    /**
     * Helper: Format detection method for display
     */
    formatDetectionMethod(method) {
        const methodMap = {
            'api_intercept_event': 'API Intercept',
            'sendbird_api_intercept': 'Sendbird API',
            'browser_storage': 'Browser Storage',
            'dom_extraction': 'DOM Analysis',
            'message_inference': 'Message Pattern',
            'manual_override': 'Manual',
            'header': 'API Header',
            'url_pattern': 'URL Pattern'
        };
        return methodMap[method] || method;
    }

    /**
     * Helper: Format timestamp
     */
    formatTimestamp(timestamp) {
        if (!timestamp) return '';

        const now = Date.now();
        const diff = now - timestamp;

        const minute = 60 * 1000;
        const hour = 60 * minute;
        const day = 24 * hour;

        if (diff < minute) {
            return 'Just now';
        } else if (diff < hour) {
            const mins = Math.floor(diff / minute);
            return `${mins}m ago`;
        } else if (diff < day) {
            const hours = Math.floor(diff / hour);
            return `${hours}h ago`;
        } else if (diff < 7 * day) {
            const days = Math.floor(diff / day);
            return `${days}d ago`;
        } else {
            return new Date(timestamp).toLocaleDateString();
        }
    }

    /**
     * Helper: Clean message text (remove markdown, mentions)
     */
    cleanMessageText(text) {
        if (!text) return '';

        let cleaned = text;

        // Remove mention markdown: @[Name](person:id) -> @Name
        cleaned = cleaned.replace(/@\[([^\]]+)\]\([^)]+\)/g, '@$1');

        // Remove other markdown
        cleaned = cleaned.replace(/\*\*([^*]+)\*\*/g, '$1'); // Bold
        cleaned = cleaned.replace(/\*([^*]+)\*/g, '$1'); // Italic
        cleaned = cleaned.replace(/`([^`]+)`/g, '$1'); // Code
        cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'); // Links

        return cleaned.trim() || '(no message)';
    }

    /**
     * Helper: Highlight @mentions in text
     * Format: @[Full Name](person:ID) -> highlight only the name part
     */
    highlightMentions(text, currentUser = null) {
        if (!text) return '';

        console.log('🎨 [MentionsPanel] Highlighting mentions:', {
            text: text.substring(0, 100),
            hasUser: !!currentUser,
            userId: currentUser?.id || currentUser?.user_id
        });

        // Parse mentions BEFORE escaping HTML (so brackets aren't encoded)
        let result = text;

        // Parse mentions in format: @[Full Name](person:ID)
        // Replace with highlighted name (without the person:ID part)
        result = result.replace(/@\[([^\]]+)\]\(([^)]+)\)/g, (match, name, personId) => {
            console.log('🔍 [MentionsPanel] Found mention:', { name, personId });

            // If we have current user info, only highlight mentions for this user
            if (currentUser) {
                // Extract the ID from person:ID format
                const mentionedUserId = personId.replace('person:', '');
                const currentUserId = String(currentUser.id || currentUser.user_id || '');

                console.log('👤 [MentionsPanel] Comparing IDs:', {
                    mentionedUserId,
                    currentUserId,
                    match: mentionedUserId === currentUserId
                });

                // Only highlight if this mention is for the current user
                if (currentUserId && mentionedUserId === currentUserId) {
                    // Use a placeholder that won't be escaped
                    return `__HIGHLIGHT_START__${name}__HIGHLIGHT_END__`;
                }
            }

            // For other mentions or when no user context, show name without highlight
            return `@${name}`;
        });

        // Now escape HTML to prevent XSS
        result = this.escapeHtml(result);

        // Replace placeholders with highlighted HTML
        result = result.replace(/__HIGHLIGHT_START__([^_]+)__HIGHLIGHT_END__/g,
            '<span style="background: #ede9fe; color: #667eea; font-weight: 600; padding: 2px 4px; border-radius: 4px;">@$1</span>');

        return result;
    }

    /**
     * Helper: Escape HTML
     */
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Open the GLOBAL mentions panel (sidebar overlay)
     * Shows mentions from ALL channels, not just the current one
     */
    async openGlobalMentionsPanel() {
        this.app?.logger?.log('📧 Opening GLOBAL mentions panel...');

        // Check if global panel already exists, don't open another
        const existingGlobalPanel = document.querySelector('.wv-favorites-global-mentions-panel');
        if (existingGlobalPanel) {
            this.app?.logger?.log('📧 Global mentions panel already open');
            return; // Panel already open, do nothing
        }

        console.log('📧 === OPENING GLOBAL MENTIONS PANEL ===');
        this.app?.logger?.log('📧 === OPENING GLOBAL MENTIONS PANEL ===');

        // Create panel IMMEDIATELY with loading state
        const panel = this.createGlobalPanelElement(null, [], null, true); // Pass loading=true

        // Append to body immediately
        document.body.appendChild(panel);

        // CRITICAL: Set currentPanel reference so footer toggle can find mentions
        this.currentPanel = panel;

        // Add CSS animations
        this.addPanelAnimations();

        // Track panel open
        if (this.app.analytics) {
            this.app.analytics.trackEvent('global_mentions_panel_opened', {
                mentions_count: 0,
                user_detected: false
            });
        }

        // Add resize handler to keep panel synchronized with sidebar
        this.globalPanelResizeHandler = () => {
            const sidebar = document.querySelector('[data-testid="channel-list"]');
            const currentPanel = document.querySelector('.wv-favorites-global-mentions-panel');
            if (sidebar && currentPanel) {
                const sidebarRect = sidebar.getBoundingClientRect();
                currentPanel.style.top = `${sidebarRect.top}px`;
                currentPanel.style.left = `${sidebarRect.left}px`;
                currentPanel.style.width = `${sidebarRect.width}px`;
                currentPanel.style.height = `${sidebarRect.height}px`;
            }
        };

        window.addEventListener('resize', this.globalPanelResizeHandler);

        // Click outside to close (after brief delay to prevent immediate close)
        setTimeout(() => {
            const closeOnClickOutside = (e) => {
                // Don't close if clicking inside the panel or on the mentions button
                if (panel.contains(e.target) ||
                    e.target.closest('.wv-favorites-mentions-btn') ||
                    e.target.closest('[data-testid="global-mentions-button"]')) {
                    return;
                }

                // Close panel
                this.closeGlobalMentionsPanel();
                document.removeEventListener('click', closeOnClickOutside);
            };
            document.addEventListener('click', closeOnClickOutside);

            // Store cleanup function
            panel._cleanupClickOutside = () => {
                document.removeEventListener('click', closeOnClickOutside);
            };
        }, 100);

        // Now fetch data in background and update panel progressively
        this.loadMentionsProgressively(panel);

        this.app?.logger?.log('✅ Global mentions panel opened');
    }

    /**
     * Load mentions progressively in background
     */
    async loadMentionsProgressively(panel) {
        try {
            // Step 1: Get user
            const user = await this.app.userIdentity?.getCurrentUser();

            // Step 2: Fetch mentions (fast - without channel names)
            const mentions = await this.app.mentionsManager?.searchMentions(true, true);
            const stats = this.app.mentionsManager?.getStats();

            console.log('📧 Mentions returned:', mentions?.length);

            // Step 3: Update panel with mentions immediately
            const listContainer = panel.querySelector('.wv-favorites-mentions-list');
            if (listContainer) {
                // Clear loading state
                listContainer.innerHTML = '';

                if (!mentions || mentions.length === 0) {
                    listContainer.innerHTML = `
                        <div style="padding: 40px 20px; text-align: center;">
                            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" stroke-width="2" style="margin: 0 auto 12px;">
                                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                                <text x="12" y="14" font-size="10" fill="currentColor" text-anchor="middle" font-weight="bold">@</text>
                            </svg>
                            <p style="margin: 8px 0 0 0; font-size: 12px; color: #cbd5e1;">You haven't been mentioned yet</p>
                        </div>
                    `;
                } else {
                    // Render mentions without channel names first
                    mentions.forEach(mention => {
                        const mentionItem = this.createMentionItem(mention, user);
                        listContainer.appendChild(mentionItem);
                    });

                    // Add "Load More" button if needed
                    if (stats?.has_more) {
                        const loadMoreBtn = this.createLoadMoreButton();
                        listContainer.appendChild(loadMoreBtn);
                    }

                    // Set up event listeners
                    this.setupPanelEventListeners(panel, user, mentions, true);

                    // Step 4: Fetch channel names progressively in background
                    this.fetchChannelNamesProgressively(mentions, listContainer);
                }
            }
        } catch (error) {
            console.error('❌ Error loading mentions:', error);
            const listContainer = panel.querySelector('.wv-favorites-mentions-list');
            if (listContainer) {
                listContainer.innerHTML = `
                    <div style="padding: 40px 20px; text-align: center; color: #ef4444;">
                        <p>Failed to load mentions</p>
                    </div>
                `;
            }
        }
    }

    /**
     * Fetch channel names progressively and update UI
     * Uses centralized APIManager.getChannelInfo which handles all caching
     */
    async fetchChannelNamesProgressively(mentions, listContainer) {
        console.log('🔄 Starting progressive channel name fetching for', mentions.length, 'mentions');

        // Group mentions by channel_url to avoid duplicate fetches within this batch
        const channelGroups = new Map();

        for (const mention of mentions) {
            // Skip if already has channel name
            if (mention.channel_name) {
                console.log('⏭️ Skipping', mention.message_id, '- already has channel name:', mention.channel_name);
                continue;
            }

            if (!mention.channel_url) {
                console.log('⏭️ Skipping', mention.message_id, '- no channel_url');
                continue;
            }

            // Group mentions by channel_url
            if (!channelGroups.has(mention.channel_url)) {
                channelGroups.set(mention.channel_url, []);
            }
            channelGroups.get(mention.channel_url).push(mention);
        }

        console.log('📊 Grouped into', channelGroups.size, 'unique channels');

        // Process each unique channel_url only once
        for (const [channelUrl, mentionsGroup] of channelGroups) {
            console.log('🔍 Processing channel:', channelUrl, '(', mentionsGroup.length, 'mentions)');

            try {
                // Use centralized APIManager which handles:
                // - Memory cache (CacheManager)
                // - IndexedDB persistence (UnifiedDatabase)
                // - Sendbird API calls
                const channelInfo = await WVFavs.APIManager.getChannelInfo(channelUrl);

                if (channelInfo && channelInfo.name) {
                    console.log(`🎨 Updating ${mentionsGroup.length} mentions with channel name:`, channelInfo.name);

                    // Update all mentions with this channel_url
                    for (const mention of mentionsGroup) {
                        mention.channel_name = channelInfo.name; // Update the mention object
                        this.updateMentionChannelName(listContainer, mention.message_id, channelInfo.name, mention.is_reply);
                    }
                } else {
                    console.log('⚠️ No channel name found for', channelUrl);
                }
            } catch (error) {
                console.error('❌ Error fetching channel name for', channelUrl, error);
            }
        }

        console.log('✅ Progressive channel name fetching complete');
    }

    /**
     * Update a specific mention's channel name in the DOM
     */
    updateMentionChannelName(listContainer, messageId, channelName, isReply = false) {
        console.log('🎨 updateMentionChannelName called for message:', messageId, 'channel:', channelName, 'isReply:', isReply);

        // Use data attribute for easy selection
        const contentDiv = listContainer.querySelector(`[data-message-content="${messageId}"]`);
        console.log('🎨 Found content div:', contentDiv);

        if (!contentDiv) {
            console.warn('⚠️ Could not find content div for message:', messageId);
            return;
        }

        // Generate thread badge HTML if this is a reply
        const threadBadge = isReply ? `
            <span style="
                display: inline-flex;
                align-items: center;
                gap: 4px;
                padding: 2px 8px;
                background: #f1f5f9;
                border-radius: 4px;
                font-size: 10px;
                color: #64748b;
                margin-left: 8px;
            ">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="17 1 21 5 17 9"/>
                    <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
                </svg>
                Reply
            </span>
        ` : '';

        // Check if channel section already exists
        let channelSection = contentDiv.querySelector('.wv-mention-channel-section');
        console.log('🎨 Existing channel section:', channelSection);

        if (!channelSection) {
            console.log('🎨 Creating new channel section');
            // Create channel section
            channelSection = document.createElement('div');
            channelSection.className = 'wv-mention-channel-section';
            channelSection.style.cssText = 'font-size: 12px; color: #64748b; margin-bottom: 6px; display: flex; align-items: center; gap: 4px;';

            // Insert after sender name/timestamp, before message text
            const messageText = contentDiv.querySelector('div[style*="-webkit-line-clamp"]');
            console.log('🎨 Message text element:', messageText);

            if (messageText) {
                contentDiv.insertBefore(channelSection, messageText);
                console.log('🎨 Inserted channel section before message text');
            } else {
                contentDiv.appendChild(channelSection);
                console.log('🎨 Appended channel section to content div');
            }
        }

        // Update channel section content with ellipsis truncation AND thread badge
        channelSection.innerHTML = `
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink: 0;">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
            <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0;">${this.escapeHtml(channelName)}</span>
            ${threadBadge}
        `;

        console.log('✅ Channel name updated in DOM for message:', messageId);
    }

    /**
     * Create the GLOBAL panel DOM element (sidebar overlay)
     */
    createGlobalPanelElement(user, mentions, stats, loading = false) {
        // Find the sidebar to position the panel exactly on top of it
        const sidebar = document.querySelector('[data-testid="channel-list"]');

        if (!sidebar) {
            console.error('❌ Sidebar not found, cannot position mentions panel');
            // Fallback positioning
            const panel = document.createElement('div');
            panel.className = 'wv-favorites-global-mentions-panel';
            panel.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 300px;
                height: 100vh;
                background: white;
                border-right: 1px solid #e5e7eb;
                z-index: 10000;
                display: flex;
                flex-direction: column;
                overflow: hidden;
            `;
            return panel;
        }

        // Get exact sidebar dimensions and position
        const sidebarRect = sidebar.getBoundingClientRect();
        const sidebarStyles = window.getComputedStyle(sidebar);
        const borderRadius = sidebarStyles.borderRadius || '0px';

        console.log('📏 Sidebar dimensions:', {
            top: sidebarRect.top,
            left: sidebarRect.left,
            width: sidebarRect.width,
            height: sidebarRect.height,
            borderRadius
        });

        const panel = document.createElement('div');
        panel.className = 'wv-favorites-global-mentions-panel';
        panel.style.cssText = `
            position: fixed;
            top: ${sidebarRect.top}px;
            left: ${sidebarRect.left}px;
            width: ${sidebarRect.width}px;
            height: ${sidebarRect.height}px;
            background: white;
            border-radius: ${borderRadius};
            box-shadow: 0 4px 24px rgba(0, 0, 0, 0.12), 0 0 0 1px rgba(0, 0, 0, 0.05);
            z-index: 10000;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            animation: slideInLeft 0.2s ease-out;
        `;

        // Header - matching threads panel style
        const header = document.createElement('div');
        header.style.cssText = `
            padding: 10px 12px;
            border-bottom: 1px solid #e5e7eb;
            background: #f9fafb;
        `;

        header.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <svg width="18" height="18" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="flex-shrink: 0;">
                        <path fill="#667eea" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10h5v-2h-5c-4.34 0-8-3.66-8-8s3.66-8 8-8 8 3.66 8 8v1.43c0 .79-.71 1.57-1.5 1.57s-1.5-.78-1.5-1.57V12c0-2.76-2.24-5-5-5s-5 2.24-5 5 2.24 5 5 5c1.38 0 2.64-.56 3.54-1.47.65.89 1.77 1.47 2.96 1.47 1.97 0 3.5-1.6 3.5-3.57V12c0-5.52-4.48-10-10-10zm0 13c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3z"/>
                    </svg>
                    <h3 style="margin: 0; font-size: 15px; font-weight: 600; color: #111827;">Mentions</h3>
                </div>
                <button class="wv-favorites-mentions-close wv-favorites-close-global-mentions" style="
                    background: transparent;
                    border: none;
                    cursor: pointer;
                    padding: 0;
                    width: 28px;
                    height: 28px;
                    border-radius: 6px;
                    color: #6b7280;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: background 0.15s;
                    flex-shrink: 0;
                ">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M18 6L6 18M6 6l12 12"/>
                    </svg>
                </button>
            </div>
        `;

        panel.appendChild(header);

        // Mentions list (show loading state or actual mentions)
        if (loading) {
            // Create loading state
            const mentionsList = document.createElement('div');
            mentionsList.className = 'wv-favorites-mentions-list';
            mentionsList.style.cssText = `
                flex: 1;
                overflow-y: auto;
                padding: 8px;
            `;

            mentionsList.innerHTML = `
                <div style="padding: 40px 20px; text-align: center;">
                    <div style="
                        width: 40px;
                        height: 40px;
                        border: 3px solid #f3f4f6;
                        border-top-color: #667eea;
                        border-radius: 50%;
                        margin: 0 auto 16px;
                        animation: spin 1s linear infinite;
                    "></div>
                    <p style="margin: 0; font-size: 13px; color: #9ca3af;">Loading mentions...</p>
                </div>
            `;

            // Add spin animation
            const style = document.createElement('style');
            style.textContent = `
                @keyframes spin {
                    to { transform: rotate(360deg); }
                }
            `;
            if (!document.querySelector('style[data-wv-spin-animation]')) {
                style.setAttribute('data-wv-spin-animation', 'true');
                document.head.appendChild(style);
            }

            panel.appendChild(mentionsList);
        } else {
            // Create actual mentions list
            const mentionsList = this.createMentionsList(mentions, user);
            panel.appendChild(mentionsList);
        }

        // CRITICAL: Add footer for global panel (was missing!)
        console.log('🔍 [MentionsPanel] Creating footer for global panel...');
        const footer = this.createFooter();
        console.log('🔍 [MentionsPanel] Footer created for global panel');
        panel.appendChild(footer);

        return panel;
    }

    /**
     * Close the mentions panel
     */
    closeMentionsPanel() {
        const panel = document.querySelector('.wv-favorites-mentions-panel');
        if (panel) {
            panel.remove();

            // Restore chat content margin
            const messageSection = document.querySelector('[data-testid="message-section"]');
            const chatContent = messageSection?.querySelector('[data-testid="chat-content"]');
            if (chatContent) {
                chatContent.style.marginRight = '0';
            }

            this.currentPanel = null;
        }
    }

    /**
     * Close the GLOBAL mentions panel
     */
    closeGlobalMentionsPanel() {
        const panel = document.querySelector('.wv-favorites-global-mentions-panel');
        if (panel) {
            // Remove resize handler
            if (this.globalPanelResizeHandler) {
                window.removeEventListener('resize', this.globalPanelResizeHandler);
                this.globalPanelResizeHandler = null;
            }

            // Remove click outside handler
            if (panel._cleanupClickOutside) {
                panel._cleanupClickOutside();
            }

            // Animate panel out
            panel.style.animation = 'slideOutLeft 0.2s ease-out';

            // Remove panel after animation completes
            setTimeout(() => {
                panel.remove();
            }, 200);
        }
    }

    /**
     * Check if panel is currently open
     */
    isPanelOpen() {
        return !!document.querySelector('.wv-favorites-mentions-panel');
    }

    /**
     * Check if GLOBAL panel is currently open
     */
    isGlobalPanelOpen() {
        return !!document.querySelector('.wv-favorites-global-mentions-panel');
    }
};

// Export to global namespace
if (typeof window !== 'undefined') {
    window.WVFavs = window.WVFavs || {};
    window.WVFavs.MentionsPanel = WVFavs.MentionsPanel;
}
