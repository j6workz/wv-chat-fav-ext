/**
 * DraftsPanel - UI component for displaying all draft messages
 * Shows saved drafts from localStorage with channel info and navigation
 * Design and positioning matches MentionsPanel (sidebar overlay)
 */

var WVFavs = WVFavs || {};

WVFavs.DraftsPanel = class DraftsPanel {
    constructor(app) {
        this.app = app;
        this.currentPanel = null;
        this.isLoading = false;
        this.storageListener = null;
        this.currentDraftsList = []; // Track current drafts for incremental updates

        // Set up real-time updates for drafts panel
        this.setupRealtimeUpdates();
    }

    /**
     * Setup real-time updates when localStorage changes
     */
    setupRealtimeUpdates() {
        // Listen for storage changes (when drafts are saved/deleted)
        this.storageListener = (e) => {
            // Only care about wv_draft_lexical changes
            if (e.key === 'wv_draft_lexical' || e.key === null) {
                // If panel is open, refresh it
                if (this.currentPanel && document.body.contains(this.currentPanel)) {
                    console.log('🔄 [DraftsPanel] localStorage changed, refreshing panel');
                    this.refreshPanel();
                }
            }
        };

        window.addEventListener('storage', this.storageListener);

        // Also listen to custom event for same-tab updates (storage event doesn't fire in same tab)
        this.customStorageListener = () => {
            if (this.currentPanel && document.body.contains(this.currentPanel)) {
                console.log('🔄 [DraftsPanel] Draft updated, refreshing panel');
                this.refreshPanel();
            }
        };

        document.addEventListener('wv-draft-updated', this.customStorageListener);
    }

    /**
     * Refresh the drafts panel content (incremental update)
     */
    async refreshPanel() {
        if (!this.currentPanel || this.isLoading) return;

        this.isLoading = true;
        try {
            // Get current drafts
            const drafts = this.app.draftManager?.getAllDrafts() || {};
            const newDraftsList = await this.enrichDraftsWithChannelData(drafts);

            // Perform incremental update instead of full re-render
            await this.updateDraftsIncremental(newDraftsList);

            // Update cached list
            this.currentDraftsList = newDraftsList;
        } catch (error) {
            console.error('❌ Error refreshing drafts panel:', error);
        } finally {
            this.isLoading = false;
        }
    }

    /**
     * Update drafts incrementally (add/remove/update only changed items)
     */
    async updateDraftsIncremental(newDraftsList) {
        const listContainer = this.currentPanel.querySelector('.wv-favorites-drafts-list');
        if (!listContainer) return;

        // Check if we need to transition from empty state to having drafts
        const hasEmptyState = !listContainer.querySelector('.wv-favorites-draft-item');
        const willHaveDrafts = newDraftsList.length > 0;

        if (hasEmptyState && willHaveDrafts) {
            // Clear empty state message and render full list
            console.log('🔄 [DraftsPanel] Transitioning from empty to having drafts');
            this.renderDraftsList(listContainer, newDraftsList);
            return;
        }

        // Check if we need to transition from having drafts to empty
        if (!hasEmptyState && !willHaveDrafts) {
            // Clear drafts and show empty state
            console.log('🔄 [DraftsPanel] Transitioning from drafts to empty');
            this.renderDraftsList(listContainer, newDraftsList);
            return;
        }

        // Build maps for easy lookup
        const oldDraftsMap = new Map(this.currentDraftsList.map(d => [d.key, d]));
        const newDraftsMap = new Map(newDraftsList.map(d => [d.key, d]));

        // Find removed drafts
        const removedKeys = [...oldDraftsMap.keys()].filter(key => !newDraftsMap.has(key));

        // Find added drafts
        const addedDrafts = newDraftsList.filter(draft => !oldDraftsMap.has(draft.key));

        // Find updated drafts (content changed)
        const updatedDrafts = newDraftsList.filter(draft => {
            const oldDraft = oldDraftsMap.get(draft.key);
            return oldDraft && (
                oldDraft.textContent !== draft.textContent ||
                oldDraft.timestamp !== draft.timestamp
            );
        });

        console.log('🔄 [DraftsPanel] Incremental update:', {
            removed: removedKeys.length,
            added: addedDrafts.length,
            updated: updatedDrafts.length,
            total: newDraftsList.length
        });

        // Remove deleted drafts
        for (const key of removedKeys) {
            const item = listContainer.querySelector(`[data-draft-key="${key}"]`);
            if (item) {
                item.style.transition = 'all 0.2s ease-out';
                item.style.opacity = '0';
                item.style.transform = 'translateX(-10px)';
                setTimeout(() => item.remove(), 200);
            }
        }

        // Add new drafts at the top
        for (const draft of addedDrafts) {
            const draftItem = this.createDraftItem(draft);
            draftItem.style.opacity = '0';
            draftItem.style.transform = 'translateY(-10px)';

            // Insert at the correct position (sorted by timestamp)
            const allItems = listContainer.querySelectorAll('.wv-favorites-draft-item');
            let inserted = false;

            for (const existingItem of allItems) {
                const existingKey = existingItem.dataset.draftKey;
                const existingDraft = newDraftsMap.get(existingKey);

                if (existingDraft && draft.timestamp > existingDraft.timestamp) {
                    listContainer.insertBefore(draftItem, existingItem);
                    inserted = true;
                    break;
                }
            }

            if (!inserted) {
                listContainer.appendChild(draftItem);
            }

            // Animate in
            requestAnimationFrame(() => {
                draftItem.style.transition = 'all 0.2s ease-out';
                draftItem.style.opacity = '1';
                draftItem.style.transform = 'translateY(0)';
            });

            // Attach click handler
            this.attachSingleDraftClickHandler(draftItem, draft);
        }

        // Update changed drafts
        for (const draft of updatedDrafts) {
            const item = listContainer.querySelector(`[data-draft-key="${draft.key}"]`);
            if (item) {
                // Flash to indicate update
                item.style.transition = 'background-color 0.3s ease';
                item.style.backgroundColor = '#fef3c7';

                // Update the content
                const messageDiv = item.querySelector('div[style*="-webkit-line-clamp"]');
                if (messageDiv) {
                    messageDiv.textContent = this.cleanMessageText(draft.textContent);
                }

                // Update timestamp
                const timestampDiv = item.querySelector('div[style*="color: #94a3b8"]');
                if (timestampDiv) {
                    timestampDiv.textContent = this.formatTimestamp(draft.timestamp);
                }

                // Reset background
                setTimeout(() => {
                    item.style.backgroundColor = '';
                }, 300);
            }
        }

        // Update header count
        const header = this.currentPanel.querySelector('h3');
        if (header) {
            header.textContent = `Drafts${newDraftsList.length > 0 ? ` (${newDraftsList.length})` : ''}`;
        }

        // Show empty state if no drafts
        if (newDraftsList.length === 0) {
            this.renderDraftsList(listContainer, []);
        }
    }

    /**
     * Open the drafts panel (sidebar overlay)
     */
    async openDraftsPanel() {
        // Mark UI operation start to prevent cleanup during DOM stabilization
        this.app.smartUserDatabase?.markUIOperationStart();

        this.app?.logger?.log('📝 Opening drafts panel...');

        // Check if panel is already open
        const existingPanel = document.querySelector('.wv-favorites-global-drafts-panel');
        if (existingPanel) {
            this.app?.logger?.log('📝 Drafts panel already open');
            this.app.smartUserDatabase?.markUIOperationEnd();
            return;
        }

        // Create panel IMMEDIATELY with loading state
        const panel = this.createGlobalPanelElement([], true);

        // Append to body immediately
        document.body.appendChild(panel);
        this.currentPanel = panel;

        // Add CSS animations
        this.addPanelAnimations();

        // Load drafts in background
        this.loadDraftsData(panel);

        // Mark UI operation complete - cleanup can resume
        this.app.smartUserDatabase?.markUIOperationEnd();
    }

    /**
     * Load drafts data and update panel
     */
    async loadDraftsData(panel) {
        try {
            // Get all drafts from DraftManager
            const drafts = this.app.draftManager?.getAllDrafts() || {};

            // Convert to array and enrich with channel data
            const draftsList = await this.enrichDraftsWithChannelData(drafts);

            // Store current drafts list for incremental updates
            this.currentDraftsList = draftsList;

            this.app?.logger?.log('📝 Drafts data loaded:', {
                draftsCount: draftsList.length
            });

            // Update panel content
            const listContainer = panel.querySelector('.wv-favorites-drafts-list');
            if (listContainer) {
                this.renderDraftsList(listContainer, draftsList);
                this.attachDraftClickHandlers(panel, draftsList);

                // CRITICAL: Update footer buttons after loading drafts
                this.updateFooterButtons(panel, draftsList);
            }
        } catch (error) {
            console.error('❌ Error loading drafts:', error);
            const listContainer = panel.querySelector('.wv-favorites-drafts-list');
            if (listContainer) {
                listContainer.innerHTML = `
                    <div style="padding: 40px 20px; text-align: center; color: #ef4444;">
                        <p style="margin: 0; font-size: 13px;">Failed to load drafts</p>
                    </div>
                `;
            }
        }
    }

    /**
     * Enrich drafts with channel data from SmartUserDatabase
     */
    async enrichDraftsWithChannelData(drafts) {
        const draftsList = [];

        for (const [key, draft] of Object.entries(drafts)) {
            const isThread = key.includes('::thread::');
            let channelUrl, threadId;

            if (isThread) {
                const parts = key.split('::thread::');
                channelUrl = parts[0];
                threadId = parts[1];
            } else {
                channelUrl = key;
                threadId = null;
            }

            // Get channel data from SmartUserDatabase
            let channelName = 'Unknown Channel';
            let channelType = 'group';
            let avatarUrl = null;

            console.log('🔍 [DraftsPanel] Fetching chat data for:', {
                channelUrl: channelUrl.substring(0, 50) + '...',
                hasSmartUserDB: !!this.app.smartUserDB,
                isReady: this.app.smartUserDB?.isReady
            });

            if (this.app.smartUserDB && this.app.smartUserDB.isReady) {
                // Try to get chat data by ID first (works for group channels)
                let chatData = await this.app.smartUserDB.getChat(channelUrl);

                // If not found, try by channel URL (works for DM users)
                if (!chatData && this.app.smartUserDB.getChatByChannelUrl) {
                    console.log('🔍 [DraftsPanel] getChat failed, trying getChatByChannelUrl...');
                    chatData = await this.app.smartUserDB.getChatByChannelUrl(channelUrl);
                }

                console.log('📊 [DraftsPanel] Chat data result:', {
                    found: !!chatData,
                    keys: chatData ? Object.keys(chatData) : [],
                    type: chatData?.type,
                    name: chatData?.name,
                    profile_url: typeof chatData?.profile_url === 'string' ? chatData.profile_url.substring(0, 50) : chatData?.profile_url,
                    avatar: typeof chatData?.avatar === 'string' ? chatData.avatar.substring(0, 50) : chatData?.avatar,
                    avatar_type: typeof chatData?.avatar,
                    cover_url: typeof chatData?.cover_url === 'string' ? chatData.cover_url.substring(0, 50) : chatData?.cover_url
                });

                if (chatData) {
                    channelType = chatData.type || 'group';

                    // Get avatar URL - handle both string and object formats
                    let rawAvatarUrl = null;

                    // Try profile_url first (string)
                    if (typeof chatData.profile_url === 'string' && chatData.profile_url.length > 0) {
                        rawAvatarUrl = chatData.profile_url;
                    }
                    // Try avatar field (can be string or object)
                    else if (chatData.avatar) {
                        if (typeof chatData.avatar === 'string') {
                            rawAvatarUrl = chatData.avatar;
                        } else if (typeof chatData.avatar === 'object') {
                            // Avatar is an object - try src, content, or url fields
                            rawAvatarUrl = chatData.avatar.src || chatData.avatar.content || chatData.avatar.url || null;
                        }
                    }
                    // Try cover_url as fallback
                    else if (typeof chatData.cover_url === 'string' && chatData.cover_url.length > 0) {
                        rawAvatarUrl = chatData.cover_url;
                    }

                    avatarUrl = (typeof rawAvatarUrl === 'string' && rawAvatarUrl.length > 0) ? rawAvatarUrl : null;

                    if (channelType === 'user') {
                        // Direct chat - use the user's name
                        channelName = chatData.name || chatData.nickname || 'Direct Message';
                    } else {
                        // Group channel - use channel name
                        channelName = chatData.name || this.extractNameFromUrl(channelUrl);
                    }

                    console.log('✅ [DraftsPanel] Enriched draft:', {
                        channelName,
                        channelType,
                        hasAvatar: !!avatarUrl,
                        avatarUrl: avatarUrl?.substring(0, 50)
                    });
                } else {
                    console.warn('⚠️ [DraftsPanel] No chat data found in IndexedDB for:', channelUrl.substring(0, 50));
                    // Fallback: extract from URL
                    channelName = this.extractNameFromUrl(channelUrl);
                }
            } else {
                console.warn('⚠️ [DraftsPanel] SmartUserDB not available or not ready');
                channelName = this.extractNameFromUrl(channelUrl);
            }

            draftsList.push({
                key,
                channelUrl,
                threadId,
                isThread,
                channelName,
                channelType,
                avatarUrl,
                ...draft
            });
        }

        // Sort by timestamp (most recent first)
        draftsList.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

        return draftsList;
    }

    /**
     * Extract channel name from URL as fallback
     */
    extractNameFromUrl(url) {
        try {
            const parts = url.split('/').filter(p => p);
            const lastPart = parts[parts.length - 1];
            const decoded = decodeURIComponent(lastPart);

            if (decoded.length > 50 || /^[0-9a-f-]{30,}$/i.test(decoded)) {
                return 'Chat Channel';
            }

            return decoded;
        } catch (error) {
            return 'Unknown Channel';
        }
    }

    /**
     * Create the GLOBAL panel DOM element (sidebar overlay - exactly like MentionsPanel)
     */
    createGlobalPanelElement(draftsList, loading = false) {
        // Find the sidebar to position the panel exactly on top of it
        const sidebar = document.querySelector('[data-testid="channel-list"]');

        if (!sidebar) {
            console.error('❌ Sidebar not found, cannot position drafts panel');
            // Fallback positioning
            const panel = document.createElement('div');
            panel.className = 'wv-favorites-global-drafts-panel';
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
        panel.className = 'wv-favorites-global-drafts-panel';
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

        // Header - matching mentions panel style
        const header = document.createElement('div');
        header.style.cssText = `
            padding: 10px 12px;
            border-bottom: 1px solid #e5e7eb;
            background: #f9fafb;
            flex-shrink: 0;
        `;

        const count = Array.isArray(draftsList) ? draftsList.length : 0;

        header.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <svg width="18" height="18" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="flex-shrink: 0;">
                        <path fill="#10b981" d="M8 6H5c-.553 0-1-.448-1-1s.447-1 1-1h3c.553 0 1 .448 1 1s-.447 1-1 1zM13 10H5c-.553 0-1-.448-1-1s.447-1 1-1h8c.553 0 1 .448 1 1s-.447 1-1 1zM13 14H5c-.553 0-1-.448-1-1s.447-1 1-1h8c.553 0 1 .448 1 1s-.447 1-1 1z"/>
                        <path fill="#10b981" d="M18 2v8c0 .55-.45 1-1 1s-1-.45-1-1V2.5c0-.28-.22-.5-.5-.5h-13c-.28 0-.5.22-.5.5v19c0 .28.22.5.5.5h13c.28 0 .5-.22.5-.5V21c0-.55.45-1 1-1s1 .45 1 1v1c0 1.1-.9 2-2 2H2c-1.1 0-2-.9-2-2V2C0 .9.9 0 2 0h14c1.1 0 2 .9 2 2z"/>
                        <path fill="#10b981" d="M23.71 8.817c.44.438.372 1.212-.148 1.732l-7.835 7.84c-.07.068-.148.126-.227.173l-2.382 1.317c-.33.183-.7.152-.927-.075-.226-.227-.25-.603-.07-.923l1.328-2.373c.042-.085.1-.153.162-.216 0-.012.007-.018.007-.018l7.835-7.84c.52-.52 1.294-.587 1.73-.15l.53.53z"/>
                    </svg>
                    <h3 style="margin: 0; font-size: 15px; font-weight: 600; color: #111827;">Drafts${count > 0 ? ` (${count})` : ''}</h3>
                </div>
                <div style="display: flex; align-items: center; gap: 4px;">
                    ${count > 0 ? `
                    <button class="wv-favorites-drafts-clear-all" style="
                        background: transparent;
                        border: none;
                        cursor: pointer;
                        padding: 4px 8px;
                        border-radius: 6px;
                        color: #ef4444;
                        display: flex;
                        align-items: center;
                        gap: 4px;
                        font-size: 12px;
                        font-weight: 500;
                        transition: background 0.15s;
                        flex-shrink: 0;
                    " title="Clear all drafts">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        </svg>
                        Clear All
                    </button>
                    ` : ''}
                    <button class="wv-favorites-drafts-close wv-favorites-close-global-drafts" style="
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
            </div>
        `;

        panel.appendChild(header);

        // Drafts list (show loading state or actual drafts)
        const draftListEl = document.createElement('div');
        draftListEl.className = 'wv-favorites-drafts-list';
        draftListEl.style.cssText = `
            flex: 1;
            overflow-y: auto;
            padding: 8px;
            min-height: 0;
        `;

        if (loading) {
            // Loading state
            draftListEl.innerHTML = `
                <div style="padding: 40px 20px; text-align: center;">
                    <div style="
                        width: 40px;
                        height: 40px;
                        border: 3px solid #f3f4f6;
                        border-top-color: #10b981;
                        border-radius: 50%;
                        margin: 0 auto 16px;
                        animation: spin 1s linear infinite;
                    "></div>
                    <p style="margin: 0; font-size: 13px; color: #9ca3af;">Loading drafts...</p>
                </div>
            `;

            // Add spin animation
            if (!document.querySelector('style[data-wv-spin-animation]')) {
                const style = document.createElement('style');
                style.setAttribute('data-wv-spin-animation', 'true');
                style.textContent = `
                    @keyframes spin {
                        to { transform: rotate(360deg); }
                    }
                `;
                document.head.appendChild(style);
            }
        }

        panel.appendChild(draftListEl);

        // Create footer with ADAS toggle
        console.log('🔍 [DraftsPanel] Creating footer...');
        const footer = document.createElement('div');
        footer.className = 'wv-drafts-footer';
        footer.style.cssText = `
            padding: 10px 12px;
            border-top: 1px solid #e2e8f0;
            background: #f8fafc;
            display: flex;
            flex-direction: column;
            gap: 8px;
            font-size: 12px;
            flex-shrink: 0;
        `;

        // Get ADAS setting
        const adasEnabled = WVFavs.Settings.get('adasEnabled');
        console.log('🔍 [DraftsPanel] ADAS enabled:', adasEnabled);
        console.log('🔍 [DraftsPanel] Drafts list length:', Array.isArray(draftsList) ? draftsList.length : 'not array');

        footer.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: space-between;">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <label style="
                        display: flex;
                        align-items: center;
                        gap: 8px;
                        cursor: pointer;
                        user-select: none;
                        margin-bottom: 0;
                    " title="Accidental Deletion Assistance - Saves deleted drafts with 60s countdown">
                        <input type="checkbox" class="wv-drafts-adas-toggle" ${adasEnabled ? 'checked' : ''}
                            style="width: 14px; height: 14px; cursor: pointer;">
                        <span style="color: #475569; font-weight: 500; margin-bottom: 0; font-size: 12px;">
                            ADAS
                        </span>
                        <div style="
                            background: #e0e7ff;
                            color: #4338ca;
                            padding: 2px 6px;
                            border-radius: 4px;
                            font-size: 10px;
                            font-weight: 600;
                            margin-bottom: 0;
                            line-height: 1;
                        ">
                            Beta
                        </div>
                    </label>
                </div>
                ${Array.isArray(draftsList) && draftsList.length > 0 ? `
                    <button class="wv-drafts-footer-clear-all" style="
                        background: transparent;
                        border: 1px solid #e5e7eb;
                        cursor: pointer;
                        padding: 4px 10px;
                        border-radius: 6px;
                        color: #ef4444;
                        font-size: 11px;
                        font-weight: 600;
                        transition: all 0.15s;
                        white-space: nowrap;
                        line-height: 1;
                    " title="Clear all drafts">
                        Clear All
                    </button>
                ` : ''}
            </div>
        `;

        console.log('🔍 [DraftsPanel] Footer HTML created, length:', footer.innerHTML.length);
        console.log('🔍 [DraftsPanel] Footer HTML preview:', footer.innerHTML.substring(0, 200));
        panel.appendChild(footer);
        console.log('🔍 [DraftsPanel] Footer appended to panel');

        // Setup ADAS toggle
        const adasCheckbox = footer.querySelector('.wv-drafts-adas-toggle');
        adasCheckbox.addEventListener('change', async () => {
            const newValue = adasCheckbox.checked;
            await WVFavs.Settings.set({ adasEnabled: newValue });
            console.log(`🛡️ [ADAS] ${newValue ? 'Enabled' : 'Disabled'} - ${newValue ? 'Drafts will be saved with countdown' : 'Drafts will be deleted immediately'}`);
        });

        // Setup footer clear all button (if it exists)
        const footerClearAllBtn = footer.querySelector('.wv-drafts-footer-clear-all');
        console.log('🔍 [DraftsPanel] Footer Clear All button:', footerClearAllBtn);
        if (footerClearAllBtn) {
            footerClearAllBtn.addEventListener('click', async () => {
                // Show confirmation dialog
                const confirmed = confirm('Are you sure you want to clear all drafts? This action cannot be undone.');
                if (confirmed) {
                    // Clear all drafts
                    await this.app.draftManager.clearAllDrafts();

                    // Close panel
                    this.closePanel();

                    // Dispatch event to update UI
                    document.dispatchEvent(new CustomEvent('wv-draft-updated'));
                }
            });

            // Add hover effects
            footerClearAllBtn.addEventListener('mouseenter', () => {
                footerClearAllBtn.style.background = '#fee2e2';
                footerClearAllBtn.style.borderColor = '#fca5a5';
            });

            footerClearAllBtn.addEventListener('mouseleave', () => {
                footerClearAllBtn.style.background = 'transparent';
                footerClearAllBtn.style.borderColor = '#e5e7eb';
            });
        }

        // Setup close button
        const closeBtn = header.querySelector('.wv-favorites-drafts-close');
        closeBtn.addEventListener('click', () => this.closePanel());

        // Add hover effects
        closeBtn.addEventListener('mouseenter', () => {
            closeBtn.style.background = '#f3f4f6';
        });

        closeBtn.addEventListener('mouseleave', () => {
            closeBtn.style.background = 'transparent';
        });

        // Setup clear all button (if it exists)
        const clearAllBtn = header.querySelector('.wv-favorites-drafts-clear-all');
        if (clearAllBtn) {
            clearAllBtn.addEventListener('click', async () => {
                // Show confirmation dialog
                const confirmed = confirm('Are you sure you want to clear all drafts? This action cannot be undone.');
                if (confirmed) {
                    // Clear all drafts
                    await this.app.draftManager.clearAllDrafts();

                    // Close panel
                    this.closePanel();

                    // Dispatch event to update UI
                    document.dispatchEvent(new CustomEvent('wv-draft-updated'));
                }
            });

            // Add hover effects
            clearAllBtn.addEventListener('mouseenter', () => {
                clearAllBtn.style.background = '#fee2e2';
            });

            clearAllBtn.addEventListener('mouseleave', () => {
                clearAllBtn.style.background = 'transparent';
            });
        }

        // Note: No "click outside to close" handler - matches MentionsPanel behavior
        // Panel stays open when navigating to drafts, user must explicitly close it

        return panel;
    }

    /**
     * Update footer buttons based on drafts count
     */
    updateFooterButtons(panel, draftsList) {
        const footer = panel.querySelector('.wv-drafts-footer');
        if (!footer) return;

        const hasDrafts = Array.isArray(draftsList) && draftsList.length > 0;

        // Find or create the button container
        let buttonContainer = footer.querySelector('.wv-footer-button-container');
        const labelContainer = footer.querySelector('div[style*="justify-content: space-between"]');

        if (!labelContainer) return;

        // Remove existing button if present
        const existingBtn = footer.querySelector('.wv-drafts-footer-clear-all');
        if (existingBtn) {
            existingBtn.remove();
        }

        // Add button if there are drafts
        if (hasDrafts) {
            const clearAllBtn = document.createElement('button');
            clearAllBtn.className = 'wv-drafts-footer-clear-all';
            clearAllBtn.style.cssText = `
                background: transparent;
                border: 1px solid #e5e7eb;
                cursor: pointer;
                padding: 4px 10px;
                border-radius: 6px;
                color: #ef4444;
                font-size: 11px;
                font-weight: 600;
                transition: all 0.15s;
                white-space: nowrap;
                line-height: 1;
            `;
            clearAllBtn.textContent = 'Clear All';
            clearAllBtn.title = 'Clear all drafts';

            // Add to the label container
            labelContainer.appendChild(clearAllBtn);

            // Setup event handlers (no confirmation, header already asked)
            clearAllBtn.addEventListener('click', async () => {
                await this.app.draftManager.clearAllDrafts();
                this.closePanel();
                document.dispatchEvent(new CustomEvent('wv-draft-updated'));
            });

            clearAllBtn.addEventListener('mouseenter', () => {
                clearAllBtn.style.background = '#fee2e2';
                clearAllBtn.style.borderColor = '#fca5a5';
            });

            clearAllBtn.addEventListener('mouseleave', () => {
                clearAllBtn.style.background = 'transparent';
                clearAllBtn.style.borderColor = '#e5e7eb';
            });

            console.log('🔍 [DraftsPanel] Footer Clear All button added dynamically');
        }
    }

    /**
     * Render drafts list
     */
    renderDraftsList(listElement, draftsList) {
        listElement.innerHTML = '';

        if (!draftsList || draftsList.length === 0) {
            listElement.innerHTML = `
                <div style="padding: 40px 20px; text-align: center; color: #94a3b8;">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin: 0 auto 16px; opacity: 0.3;">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                        <polyline points="14 2 14 8 20 8"></polyline>
                    </svg>
                    <p style="margin: 0; font-size: 13px; color: #9ca3af;">No drafts yet</p>
                    <p style="margin: 8px 0 0 0; font-size: 12px; color: #cbd5e1;">Start typing in any chat</p>
                </div>
            `;
            return;
        }

        // Render draft items
        draftsList.forEach(draft => {
            const draftItem = this.createDraftItem(draft);
            listElement.appendChild(draftItem);
        });

        // Update header count
        const header = this.currentPanel?.querySelector('h3');
        if (header) {
            header.textContent = `Drafts (${draftsList.length})`;
        }
    }

    /**
     * Create a single draft item (matching MentionsPanel card design)
     */
    createDraftItem(draft) {
        const item = document.createElement('div');
        item.className = 'wv-favorites-draft-item';
        item.dataset.draftKey = draft.key;
        item.dataset.channelUrl = draft.channelUrl;
        item.dataset.threadId = draft.threadId || '';

        // Check if this draft has pending deletion
        const hasPendingDeletion = !!draft.pendingDeletion;
        if (hasPendingDeletion) {
            item.dataset.pendingDeletion = draft.pendingDeletion;
        }

        // Different styling for pending deletion drafts
        const backgroundColor = hasPendingDeletion ? '#fef3c7' : 'white';
        const borderColor = hasPendingDeletion ? '#fbbf24' : '#e5e7eb';

        item.style.cssText = `
            background: ${backgroundColor};
            border-radius: 8px;
            padding: 12px;
            margin-bottom: 8px;
            cursor: pointer;
            transition: all 0.2s;
            border: 1px solid ${borderColor};
            box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
            position: relative;
        `;

        // Format timestamp
        const timestamp = this.formatTimestamp(draft.timestamp);

        // Clean message text
        const messagePreview = this.cleanMessageText(draft.textContent);

        // Thread badge (inline with channel name)
        const threadBadge = draft.isThread ? `
            <span style="
                display: inline-flex;
                align-items: center;
                gap: 4px;
                padding: 2px 6px;
                background: #f1f5f9;
                border-radius: 4px;
                font-size: 10px;
                color: #64748b;
            ">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="17 1 21 5 17 9"/>
                    <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
                </svg>
                Thread
            </span>
        ` : '';

        // Avatar section (matching mentions style exactly)
        const initials = this.getInitials(draft.channelName);
        const hasAvatar = typeof draft.avatarUrl === 'string' && draft.avatarUrl.length > 0 && draft.avatarUrl.startsWith('http');

        const avatarHtml = hasAvatar ? `
            <img src="${this.escapeHtml(draft.avatarUrl)}"
                 alt="${this.escapeHtml(draft.channelName)}"
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
                background: #10b981;
                color: white;
                display: none;
                align-items: center;
                justify-content: center;
                font-weight: 600;
                font-size: 14px;
                flex-shrink: 0;
            ">${initials}</div>
        ` : `
            <div style="
                width: 40px;
                height: 40px;
                border-radius: 50%;
                background: #10b981;
                color: white;
                display: flex;
                align-items: center;
                justify-content: center;
                font-weight: 600;
                font-size: 14px;
                flex-shrink: 0;
            ">${initials}</div>
        `;

        // Channel icon
        const channelIcon = draft.channelType === 'user'
            ? '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'
            : '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>';

        // Delete/Restore button (inline with channel name)
        const actionButton = hasPendingDeletion ? `
            <button class="wv-favorites-draft-restore" style="
                background: #10b981;
                border: none;
                padding: 4px 8px;
                cursor: pointer;
                color: white;
                border-radius: 4px;
                display: flex;
                align-items: center;
                gap: 4px;
                justify-content: center;
                transition: all 0.2s;
                margin-left: auto;
                flex-shrink: 0;
                font-size: 11px;
                font-weight: 500;
            " title="Restore draft">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>
                    <path d="M21 3v5h-5"/>
                </svg>
                Restore
            </button>
        ` : `
            <button class="wv-favorites-draft-delete" style="
                background: none;
                border: none;
                padding: 4px;
                cursor: pointer;
                color: #9ca3af;
                border-radius: 4px;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: all 0.2s;
                margin-left: auto;
                flex-shrink: 0;
            " title="Delete draft">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
            </button>
        `;

        // Countdown timer for pending deletion drafts
        const countdownHtml = hasPendingDeletion ? `
            <div class="wv-draft-countdown" style="
                font-size: 11px;
                color: #d97706;
                font-weight: 500;
                display: flex;
                align-items: center;
                gap: 4px;
            ">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"/>
                    <polyline points="12 6 12 12 16 14"/>
                </svg>
                <span class="wv-draft-countdown-text">Calculating...</span>
            </div>
        ` : '';

        item.innerHTML = `
            <div style="display: flex; gap: 12px;">
                ${avatarHtml}
                <div style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px;">
                    <!-- Channel name + thread badge + action button -->
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink: 0; color: #64748b;">
                            ${channelIcon}
                        </svg>
                        <span style="
                            font-weight: 600;
                            font-size: 13px;
                            color: #1e293b;
                            overflow: hidden;
                            text-overflow: ellipsis;
                            white-space: nowrap;
                            flex: 1;
                            min-width: 0;
                        ">${this.escapeHtml(draft.channelName)}</span>
                        ${threadBadge}
                        ${actionButton}
                    </div>

                    <!-- Message preview -->
                    <div style="
                        font-size: 13px;
                        color: #475569;
                        line-height: 1.4;
                        overflow: hidden;
                        display: -webkit-box;
                        -webkit-line-clamp: 2;
                        -webkit-box-orient: vertical;
                    ">
                        ${this.escapeHtml(messagePreview)}
                    </div>

                    <!-- Timestamp/Countdown at bottom -->
                    <div style="font-size: 11px; color: #94a3b8;">
                        ${hasPendingDeletion ? countdownHtml : timestamp}
                    </div>
                </div>
            </div>
        `;

        // Hover effects
        const hoverBorderColor = hasPendingDeletion ? '#f59e0b' : '#cbd5e1';
        const normalBorderColor = hasPendingDeletion ? '#fbbf24' : '#e5e7eb';

        item.addEventListener('mouseenter', () => {
            item.style.borderColor = hoverBorderColor;
            item.style.boxShadow = '0 2px 4px rgba(0, 0, 0, 0.08)';
        });

        item.addEventListener('mouseleave', () => {
            item.style.borderColor = normalBorderColor;
            item.style.boxShadow = '0 1px 2px rgba(0, 0, 0, 0.05)';
        });

        // Setup button event listeners based on type
        if (hasPendingDeletion) {
            // Restore button hover - brighten
            const restoreBtn = item.querySelector('.wv-favorites-draft-restore');
            restoreBtn.addEventListener('mouseenter', (e) => {
                e.stopPropagation();
                restoreBtn.style.background = '#059669';
            });

            restoreBtn.addEventListener('mouseleave', (e) => {
                e.stopPropagation();
                restoreBtn.style.background = '#10b981';
            });

            // Restore button click - remove pending deletion flag
            restoreBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                await this.restoreDraft(draft.key, item);
            });

            // Update countdown timer
            this.updateCountdown(item, draft.pendingDeletion);
        } else {
            // Delete button hover - turn red
            const deleteBtn = item.querySelector('.wv-favorites-draft-delete');
            deleteBtn.addEventListener('mouseenter', (e) => {
                e.stopPropagation();
                deleteBtn.style.background = '#fee2e2';
                deleteBtn.style.color = '#ef4444';
            });

            deleteBtn.addEventListener('mouseleave', (e) => {
                e.stopPropagation();
                deleteBtn.style.background = 'none';
                deleteBtn.style.color = '#9ca3af';
            });

            // Prevent delete button from triggering item click
            deleteBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                await this.deleteDraft(draft.key, item);
            });
        }

        return item;
    }

    /**
     * Attach click handler to a single draft item
     */
    attachSingleDraftClickHandler(item, draft) {
        item.addEventListener('click', async (e) => {
            console.log('🔥🔥🔥 DRAFT ITEM CLICKED 🔥🔥🔥');

            // Don't trigger if clicking delete or restore button
            if (e.target.closest('.wv-favorites-draft-delete') || e.target.closest('.wv-favorites-draft-restore')) {
                console.log('Action button clicked, ignoring');
                return;
            }

            console.log('Draft key:', draft.key);
            console.log('Found draft:', draft);

            this.app?.logger?.log('📝 Navigating to draft:', draft);

            try {
                // Use openThreadById for thread drafts (doesn't need timestamp)
                if (draft.isThread) {
                    console.log('Thread draft - navigating to channel and opening thread');
                    // Navigate to channel first
                    const currentChannel = this.app.threadManager?.getCurrentChannel();
                    if (currentChannel !== draft.channelUrl) {
                        console.log('Navigating to channel:', draft.channelUrl);
                        // TIER 1: Try WebpackNavigator first (most reliable after WorkVivo updates)
                        if (this.app.webpackNav && this.app.webpackNav.initialized) {
                            const result = await this.app.webpackNav.navigateToMessage({
                                message_id: null,
                                channel_url: draft.channelUrl,
                                parent_message_id: null
                            });
                            if (!result.success && this.app.reactFiberNav) {
                                // TIER 2: Fallback to ReactFiberNav
                                await this.app.reactFiberNav.openChannelByUrl(draft.channelUrl);
                            }
                        } else if (this.app.reactFiberNav) {
                            await this.app.reactFiberNav.openChannelByUrl(draft.channelUrl);
                        }
                        // Wait longer for channel messages to load
                        await new Promise(resolve => setTimeout(resolve, 800));
                    }

                    // Open thread via DomManager
                    console.log('Opening thread:', draft.threadId);
                    await WVFavs.DomManager.openThreadById(draft.threadId);
                    await new Promise(resolve => setTimeout(resolve, 500));
                } else {
                    console.log('Main chat draft - navigating to channel');
                    // Main chat - just navigate to channel
                    // TIER 1: Try WebpackNavigator first (most reliable after WorkVivo updates)
                    if (this.app.webpackNav && this.app.webpackNav.initialized) {
                        const result = await this.app.webpackNav.navigateToMessage({
                            message_id: null,
                            channel_url: draft.channelUrl,
                            parent_message_id: null
                        });
                        if (!result.success && this.app.reactFiberNav) {
                            // TIER 2: Fallback to ReactFiberNav
                            await this.app.reactFiberNav.openChannelByUrl(draft.channelUrl);
                        }
                    } else if (this.app.reactFiberNav) {
                        await this.app.reactFiberNav.openChannelByUrl(draft.channelUrl);
                    }
                    await new Promise(resolve => setTimeout(resolve, 800));
                }

                // Restore the draft content - add extra delay for editor to be ready
                console.log('Restoring draft content');
                await new Promise(resolve => setTimeout(resolve, 300));
                await this.app.draftManager?.restoreDraft(draft.channelUrl, draft.threadId);
                console.log('✅ Draft navigation complete');

            } catch (error) {
                console.error('❌ ERROR:', error);
                console.error('Error message:', error.message);
                console.error('Error stack:', error.stack);
                this.app?.logger?.error('❌ Error navigating to draft:', error);
            }
        });
    }

    /**
     * Attach click handlers to draft items
     */
    attachDraftClickHandlers(panel, draftsList) {
        const draftItems = panel.querySelectorAll('.wv-favorites-draft-item');

        draftItems.forEach(item => {
            item.addEventListener('click', async (e) => {
                console.log('🔥🔥🔥 DRAFT ITEM CLICKED 🔥🔥🔥');

                // Don't trigger if clicking delete button
                if (e.target.closest('.wv-favorites-draft-delete')) {
                    console.log('Delete button clicked, ignoring');
                    return;
                }

                const draftKey = item.dataset.draftKey;
                const draft = draftsList.find(d => d.key === draftKey);

                console.log('Draft key:', draftKey);
                console.log('Found draft:', draft);

                if (draft) {
                    this.app?.logger?.log('📝 Navigating to draft:', draft);

                    try {
                        // Use openThreadById for thread drafts (doesn't need timestamp)
                        if (draft.isThread) {
                            console.log('Thread draft - navigating to channel and opening thread');
                            // Navigate to channel first
                            const currentChannel = this.app.threadManager?.getCurrentChannel();
                            if (currentChannel !== draft.channelUrl) {
                                console.log('Navigating to channel:', draft.channelUrl);
                                // TIER 1: Try WebpackNavigator first (most reliable after WorkVivo updates)
                                if (this.app.webpackNav && this.app.webpackNav.initialized) {
                                    const result = await this.app.webpackNav.navigateToMessage({
                                        message_id: null,
                                        channel_url: draft.channelUrl,
                                        parent_message_id: null
                                    });
                                    if (!result.success && this.app.reactFiberNav) {
                                        // TIER 2: Fallback to ReactFiberNav
                                        await this.app.reactFiberNav.openChannelByUrl(draft.channelUrl);
                                    }
                                } else if (this.app.reactFiberNav) {
                                    await this.app.reactFiberNav.openChannelByUrl(draft.channelUrl);
                                }
                                // Wait longer for channel messages to load
                                await new Promise(resolve => setTimeout(resolve, 800));
                            }

                            // Open thread via DomManager
                            console.log('Opening thread:', draft.threadId);
                            await WVFavs.DomManager.openThreadById(draft.threadId);
                            await new Promise(resolve => setTimeout(resolve, 500));
                        } else {
                            console.log('Main chat draft - navigating to channel');
                            // Main chat - just navigate to channel
                            // TIER 1: Try WebpackNavigator first (most reliable after WorkVivo updates)
                            if (this.app.webpackNav && this.app.webpackNav.initialized) {
                                const result = await this.app.webpackNav.navigateToMessage({
                                    message_id: null,
                                    channel_url: draft.channelUrl,
                                    parent_message_id: null
                                });
                                if (!result.success && this.app.reactFiberNav) {
                                    // TIER 2: Fallback to ReactFiberNav
                                    await this.app.reactFiberNav.openChannelByUrl(draft.channelUrl);
                                }
                            } else if (this.app.reactFiberNav) {
                                await this.app.reactFiberNav.openChannelByUrl(draft.channelUrl);
                            }
                            await new Promise(resolve => setTimeout(resolve, 800));
                        }

                        // Restore the draft content - add extra delay for editor to be ready
                        console.log('Restoring draft content');
                        await new Promise(resolve => setTimeout(resolve, 300));
                        await this.app.draftManager?.restoreDraft(draft.channelUrl, draft.threadId);
                        console.log('✅ Draft navigation complete');

                    } catch (error) {
                        console.error('❌ ERROR:', error);
                        console.error('Error message:', error.message);
                        console.error('Error stack:', error.stack);
                        this.app?.logger?.error('❌ Error navigating to draft:', error);
                    }
                }
            });
        });
    }

    /**
     * Delete a draft from storage
     */
    async deleteDraft(draftKey, itemElement) {
        this.app?.logger?.log('🗑️ Deleting draft:', draftKey);

        // Animate out
        itemElement.style.transition = 'all 0.3s ease-out';
        itemElement.style.opacity = '0';
        itemElement.style.transform = 'translateX(-20px)';

        await new Promise(resolve => setTimeout(resolve, 300));

        // Parse the key
        const isThread = draftKey.includes('::thread::');
        let channelUrl, threadId;

        if (isThread) {
            const parts = draftKey.split('::thread::');
            channelUrl = parts[0];
            threadId = parts[1];
        } else {
            channelUrl = draftKey;
            threadId = null;
        }

        // Delete from storage
        this.app.draftManager?.clearDraft(channelUrl, threadId);

        // Update drafts button badge
        const remainingDrafts = this.app.draftManager?.getAllDrafts() || {};
        const count = Object.keys(remainingDrafts).length;
        this.app.domManager?.updateDraftsButtonBadge(count);

        // Remove from DOM
        itemElement.remove();

        // Update header count
        if (this.currentPanel) {
            const remainingItems = this.currentPanel.querySelectorAll('.wv-favorites-draft-item');
            const header = this.currentPanel.querySelector('h3');
            if (header) {
                header.textContent = `Drafts (${remainingItems.length})`;
            }

            // If no drafts left, show empty state
            if (remainingItems.length === 0) {
                const listContainer = this.currentPanel.querySelector('.wv-favorites-drafts-list');
                if (listContainer) {
                    this.renderDraftsList(listContainer, []);
                }
            }
        }
    }

    /**
     * Restore a draft by removing pending deletion flag
     */
    async restoreDraft(draftKey, itemElement) {
        this.app?.logger?.log('♻️ Restoring draft:', draftKey);

        try {
            // Clear countdown interval if exists
            if (itemElement.dataset.countdownInterval) {
                clearInterval(parseInt(itemElement.dataset.countdownInterval));
                delete itemElement.dataset.countdownInterval;
            }

            // Get all drafts
            const drafts = this.app.draftManager?.getAllDrafts() || {};
            const draft = drafts[draftKey];

            if (!draft) {
                console.error('Draft not found:', draftKey);
                return;
            }

            // Remove pendingDeletion flag
            delete draft.pendingDeletion;

            // Save back to storage
            localStorage.setItem(this.app.draftManager.config.storageKey, JSON.stringify(drafts));

            // Dispatch update event
            document.dispatchEvent(new CustomEvent('wv-draft-updated'));

            // Animate feedback
            itemElement.style.transition = 'all 0.3s ease-out';
            itemElement.style.transform = 'scale(1.05)';
            setTimeout(() => {
                itemElement.style.transform = 'scale(1)';
            }, 200);

            console.log('✅ Draft restored:', draftKey);

            // Trigger full refresh of panel to update UI
            if (this.currentPanel) {
                const listContainer = this.currentPanel.querySelector('.wv-favorites-drafts-list');
                if (listContainer) {
                    const draftsList = await this.enrichDraftsWithChannelData(drafts);
                    this.renderDraftsList(listContainer, draftsList);
                    this.attachDraftClickHandlers(this.currentPanel, draftsList);
                }
            }
        } catch (error) {
            console.error('Error restoring draft:', error);
            this.app?.logger?.error('Error restoring draft:', error);
        }
    }

    /**
     * Update countdown timer for a draft item with pending deletion
     */
    updateCountdown(itemElement, pendingDeletion) {
        const countdownText = itemElement.querySelector('.wv-draft-countdown-text');
        if (!countdownText) return;

        // Declare intervalId first so it's in scope for updateTimer
        let intervalId;

        const updateTimer = () => {
            const now = Date.now();
            const remaining = pendingDeletion - now;

            if (remaining <= 0) {
                countdownText.textContent = 'Deleting...';
                if (intervalId) clearInterval(intervalId);
                return;
            }

            const seconds = Math.ceil(remaining / 1000);
            countdownText.textContent = `Deletes in ${seconds}s`;
        };

        // Update immediately
        updateTimer();

        // Update every second
        intervalId = setInterval(updateTimer, 1000);

        // Store interval ID on element for cleanup
        itemElement.dataset.countdownInterval = intervalId;

        // Cleanup will happen when:
        // 1. Timer expires (handled in updateTimer)
        // 2. User clicks restore (handled in restoreDraft)
        // 3. Panel is closed (handled in closePanel)
    }

    /**
     * Clean message text
     */
    cleanMessageText(text) {
        if (!text) return '';

        return text
            .replace(/\*\*(.*?)\*\*/g, '$1')
            .replace(/\*(.*?)\*/g, '$1')
            .replace(/`(.*?)`/g, '$1')
            .replace(/\[(.*?)\]\(.*?\)/g, '$1')
            .trim();
    }

    /**
     * Format timestamp
     */
    formatTimestamp(timestamp) {
        const now = Date.now();
        const diff = now - timestamp;
        const seconds = Math.floor(diff / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (seconds < 60) return 'Just now';
        if (minutes < 60) return `${minutes}m ago`;
        if (hours < 24) return `${hours}h ago`;
        if (days < 7) return `${days}d ago`;

        const date = new Date(timestamp);
        return date.toLocaleDateString();
    }

    /**
     * Escape HTML
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Get initials from name (for avatar fallback)
     */
    getInitials(name) {
        if (!name) return 'C';
        const parts = name.trim().split(' ');
        if (parts.length >= 2) {
            return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
        }
        return name.substring(0, 2).toUpperCase();
    }

    /**
     * Add panel animations
     */
    addPanelAnimations() {
        if (document.querySelector('#wv-favorites-drafts-animations')) {
            return;
        }

        const style = document.createElement('style');
        style.id = 'wv-favorites-drafts-animations';
        style.textContent = `
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
        `;
        document.head.appendChild(style);
    }

    /**
     * Close the panel
     */
    closePanel() {
        if (!this.currentPanel) return;

        // Animate out
        this.currentPanel.style.animation = 'slideOutLeft 0.2s ease-out';

        setTimeout(() => {
            if (this.currentPanel) {
                this.currentPanel.remove();
                this.currentPanel = null;
            }
        }, 200);

        this.app?.logger?.log('✅ Drafts panel closed');
    }
};
