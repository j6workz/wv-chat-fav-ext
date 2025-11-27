var WVFavs = WVFavs || {};

console.log('🔧 [STATUS] DomManager.js loading...');

WVFavs.DomManager = new (class DomManager {
    constructor() {
        console.log('🔧 [STATUS] DomManager constructor called');
        this.pinnedContainer = null;
        this.lastRenderTime = 0;
        this.renderCooldown = 1000; // 1 second minimum between renders
        this.setupInProgress = false;
        this.lastSetupTime = 0;
        this.setupCooldown = 3000; // 3 seconds minimum between sidebar setups
    }

    init(app) {
        console.log('🔧 [STATUS] DomManager.init called with app:', !!app);
        this.app = app;
        console.log('🔧 [STATUS] DomManager.app set, statusDialog exists:', !!app?.statusDialog);
        this.setupRealtimeBadgeUpdates();
    }

    /**
     * Setup real-time badge updates when drafts change
     */
    setupRealtimeBadgeUpdates() {
        // Listen for draft updates
        document.addEventListener('wv-draft-updated', () => {
            // Get current draft count
            const drafts = this.app?.draftManager?.getAllDrafts() || {};
            const count = Object.keys(drafts).length;

            // Update badge
            this.updateDraftsButtonBadge(count);
        });

        this.app?.logger?.debug('✅ Real-time badge updates setup complete');
    }

    showSnackbar(message, type = 'success') {
        if (this.app.settings.get('showSnackbars')) {
            this.showNotification(message, type);
        }
    }

    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `wv-favorites-notification wv-favorites-${type}`;
        notification.textContent = message;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: ${type === 'success' ? '#10b981' : type === 'warning' ? '#f59e0b' : '#3b82f6'};
            color: white;
            padding: 12px 16px;
            border-radius: 6px;
            font-size: 14px;
            font-weight: 500;
            z-index: 10000;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            animation: slideInRight 0.3s ease-out;
        `;

        document.body.appendChild(notification);

        setTimeout(() => {
            notification.style.animation = 'slideOutRight 0.3s ease-in forwards';
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }

    /**
     * Verify the pinned container is still attached to DOM
     * Called periodically to catch when React re-renders remove our container
     */
    verifyPinnedContainerHealth() {
        // Check if container exists and is attached to DOM
        if (!this.pinnedContainer || !document.body.contains(this.pinnedContainer)) {
            this.app?.logger?.log('⚠️ Pinned container missing from DOM, forcing recreation');
            this.pinnedContainer = null; // Clear stale reference
            this.findAndSetupSidebar(true); // Force setup, bypassing cooldown
            return false;
        }
        return true;
    }

    async findAndSetupSidebar(force = false) {
        console.log('🔍 [STATUS] findAndSetupSidebar called, force:', force);

        // Bypass cooldown if container is missing from DOM
        const containerMissing = !this.pinnedContainer || !document.body.contains(this.pinnedContainer);
        if (containerMissing && !force) {
            this.app?.logger?.log('🔄 Container missing, bypassing cooldown for recreation');
            force = true;
        }

        // Prevent concurrent setup calls and excessive retries
        const now = Date.now();
        if (this.setupInProgress || (!force && (now - this.lastSetupTime < this.setupCooldown))) {
            console.log('⏸️ [STATUS] Skipping sidebar setup (in progress or cooldown)');
            this.app?.logger?.debug('⏸️ Skipping sidebar setup:', {
                setupInProgress: this.setupInProgress,
                timeSinceLastSetup: now - this.lastSetupTime,
                cooldown: this.setupCooldown,
                force: force
            });
            return;
        }

        this.setupInProgress = true;
        this.lastSetupTime = now;

        const sidebar = document.querySelector('[data-testid="channel-list"]');
        console.log('🔍 [STATUS] Sidebar found:', !!sidebar);

        if (sidebar) {
            console.log('✅ [STATUS] Found sidebar, setting up...');
            this.app?.logger?.debug('✅ Found sidebar, setting up pinned container and button group');
            await this.setupPinnedContainer(sidebar);
            await this.setupButtonGroup(sidebar);
            console.log('🔧 [STATUS] About to call makeAvatarAndNameClickable');
            await this.makeAvatarAndNameClickable();
            await this.setupSearchButtonOverride();
        } else {
            this.app?.logger?.debug('❌ Sidebar not found, will retry in 3 seconds');
            // Only retry if we haven't been trying for too long
            setTimeout(() => {
                this.setupInProgress = false;
                this.findAndSetupSidebar();
            }, 3000);
            return;
        }

        this.setupInProgress = false;
    }

    async setupPinnedContainer(sidebar) {
        if (!this.app.settings.get('showPinnedSidebar')) {
            // Remove container if setting is disabled
            if (this.pinnedContainer) {
                this.pinnedContainer.remove();
                this.pinnedContainer = null;
            }
            return;
        }

        const scrollContainer = sidebar.querySelector('.tw-overflow-y-scroll');
        if (!scrollContainer) {
            this.app?.logger?.log('⚠️ Scroll container .tw-overflow-y-scroll not found, retrying in 1s...');
            setTimeout(() => this.findAndSetupSidebar(true), 1000);
            return;
        }

        // Check if container already exists, is in DOM, and is properly attached
        if (this.pinnedContainer &&
            document.body.contains(this.pinnedContainer) &&
            this.pinnedContainer.parentNode === scrollContainer &&
            this.pinnedContainer.querySelector('.wv-favorites-container')) {
            // Container exists and is valid, just refresh the content
            await this.renderPinnedChats();
            return;
        }

        // Remove existing container if it exists but is invalid or detached
        if (this.pinnedContainer) {
            try {
                this.pinnedContainer.remove();
            } catch (e) {
                // Container may already be removed from DOM
            }
            this.pinnedContainer = null;
        }

        // Create new container
        this.pinnedContainer = document.createElement('div');
        this.pinnedContainer.className = 'wv-favorites-pinned-section';

        const savedAccordionState = localStorage.getItem('wv-favorites-accordion-open');
        const initiallyOpen = savedAccordionState !== null ? savedAccordionState === 'true' : true;

        this.pinnedContainer.innerHTML = `
            <div class="wv-favorites-accordion">
                <button class="wv-favorites-accordion-btn" aria-expanded="${initiallyOpen}" aria-controls="wv-favorites-content" style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
                    <span class="tw-text-xs tw-font-semibold tw-text-gray-500 tw-pt-0 tw-px-3 tw-pb-2">Pinned</span>
                    <svg class="wv-favorites-chevron ${!initiallyOpen ? 'wv-rotated' : ''}" width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M7 10l5 5 5-5z"/>
                    </svg>
                </button>
                <div class="wv-favorites-accordion-content" id="wv-favorites-content" style="display: ${initiallyOpen ? 'block' : 'none'};">
                    <div class="wv-favorites-container"></div>
                </div>
            </div>
        `;

        scrollContainer.insertBefore(this.pinnedContainer, scrollContainer.firstChild);

        this.setupAccordion();

        await this.renderPinnedChats();
    }

    async setupButtonGroup(sidebar) {
        const scrollContainer = sidebar.querySelector('.tw-overflow-y-scroll');
        if (!scrollContainer) return;

        // Check if button group already exists
        if (this.buttonGroup && this.buttonGroup.parentNode === sidebar) {
            return; // Already set up
        }

        // Remove existing button group if it exists
        if (this.buttonGroup) {
            this.buttonGroup.remove();
        }

        // Get current settings to check which buttons should be visible
        const settings = WVFavs.Settings.getAll();

        // Create button group container
        this.buttonGroup = document.createElement('div');
        this.buttonGroup.className = 'wv-favorites-button-group';
        this.buttonGroup.style.cssText = `
            display: flex;
            gap: 6px;
            padding: 8px 12px;
            border-bottom: 1px solid #e2e8f0;
            background: white;
        `;

        // Create Drafts button (only if enabled)
        let draftsButton = null;
        if (settings.enableDrafts !== false) {
            draftsButton = this.createButtonGroupButton({
            icon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 24" width="16" height="16" fill="currentColor">
                <path d="M8 6H5c-.553 0-1-.448-1-1s.447-1 1-1h3c.553 0 1 .448 1 1s-.447 1-1 1zM13 10H5c-.553 0-1-.448-1-1s.447-1 1-1h8c.553 0 1 .448 1 1s-.447 1-1 1zM13 14H5c-.553 0-1-.448-1-1s.447-1 1-1h8c.553 0 1 .448 1 1s-.447 1-1 1z"/>
                <path d="M18 2v8c0 .55-.45 1-1 1s-1-.45-1-1V2.5c0-.28-.22-.5-.5-.5h-13c-.28 0-.5.22-.5.5v19c0 .28.22.5.5.5h13c.28 0 .5-.22.5-.5V21c0-.55.45-1 1-1s1 .45 1 1v1c0 1.1-.9 2-2 2H2c-1.1 0-2-.9-2-2V2C0 .9.9 0 2 0h14c1.1 0 2 .9 2 2z"/>
                <path d="M23.71 8.817c.44.438.372 1.212-.148 1.732l-7.835 7.84c-.07.068-.148.126-.227.173l-2.382 1.317c-.33.183-.7.152-.927-.075-.226-.227-.25-.603-.07-.923l1.328-2.373c.042-.085.1-.153.162-.216 0-.012.007-.018.007-.018l7.835-7.84c.52-.52 1.294-.587 1.73-.15l.53.53z"/>
            </svg>`,
            label: 'Drafts',
            className: 'wv-favorites-drafts-group-btn',
            onClick: async () => {
                if (this.app.draftsPanel) {
                    await this.app.draftsPanel.openDraftsPanel();
                }
            }
            });
        }

        // Create Mentions button (only if enabled)
        let mentionsButton = null;
        if (settings.enableMentionsPanel !== false) {
            mentionsButton = this.createButtonGroupButton({
            icon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 92 92" width="16" height="16" fill="currentColor">
                <path d="m55.145 10.832c-11.895-1.5-23.625 2.293-32.25 10.438s-13.105 19.625-12.312 31.5c1.3125 19.23 16.75 34.957 35.938 36.605 1.168 0.10547 2.332 0.14453 3.5 0.14453 4.6875 0 9.25-0.8125 13.645-2.4375l-2.875-7.8125c-4.3125 1.582-8.875 2.207-13.543 1.793-15.125-1.293-27.293-13.707-28.332-28.855-0.64453-9.375 2.8945-18.438 9.707-24.855 6.8125-6.418 16.105-9.4375 25.48-8.2305 14.062 1.793 25.375 13.332 26.875 27.457 0.5 4.7695-0.019531 9.418-1.582 13.832-0.26953 0.79297-1 1.332-1.8125 1.332-3.3945 0-6.1445-2.7695-6.1445-6.168v-5.5625c0-11.812-9.6055-21.438-21.438-21.438s-21.438 9.6055-21.438 21.438 9.6055 21.438 21.438 21.438c6.3555 0 12.062-2.793 16-7.207 2.6445 3.543 6.8555 5.832 11.582 5.832 4.332 0 8.207-2.7695 9.668-6.875 1.9805-5.6055 2.668-11.48 2.0195-17.5-1.918-17.918-16.27-32.582-34.125-34.855zm-5.1445 52.273c-7.2305 0-13.105-5.875-13.105-13.105s5.875-13.105 13.105-13.105 13.105 5.875 13.105 13.105-5.875 13.105-13.105 13.105z"/>
            </svg>`,
            label: 'Mentions',
            className: 'wv-favorites-mentions-group-btn',
            onClick: async () => {
                if (this.app.mentionsPanel) {
                    await this.app.mentionsPanel.openGlobalMentionsPanel();
                }
            }
            });
        }

        // Create Global Search button (only if enabled)
        let searchButton = null;
        if (settings.enableSearchPanel !== false) {
            searchButton = this.createButtonGroupButton({
            icon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72" width="16" height="16" fill="currentColor">
                <path d="M58.7446809,12 C59.9383601,12 60.9154455,12.915741 60.9947969,14.0746088 L61,14.2270889 L61.000962,36.5676709 L60.9669368,36.5464996 C65.8009703,39.5464722 69.0199993,44.9023137 69.0199993,51.0099996 C69.0199993,55.4961272 67.2833396,59.5766361 64.4456376,62.6159092 L70.4142136,68.5857864 C71.1952621,69.366835 71.1952621,70.633165 70.4142136,71.4142136 C69.6742728,72.1541543 68.4987886,72.1930986 67.7130012,71.5310463 L67.5857864,71.4142136 L61.3799119,65.2088938 C58.6930121,66.9855646 55.4723085,68.0199993 52.0099996,68.0199993 C42.6156362,68.0199993 35,60.404363 35,51.0099996 L35.0000354,50.9749057 L35.0000354,50.9749057 L24.539383,50.9740563 L11.6085106,60.5505388 C10.2118309,61.5849367 8.25484631,60.723177 8.0227662,59.0935622 L8.00613186,58.9385706 L8,58.7688676 L8,14.2270889 C8,13.0483511 8.92734873,12.0834961 10.1009062,12.005138 L10.2553191,12 L58.7446809,12 Z M52.0099996,38.3200001 C45.0015064,38.3200001 39.3200001,44.0015064 39.3200001,51.0099996 C39.3200001,58.0184929 45.0015064,63.6999992 52.0099996,63.6999992 C59.0184929,63.6999992 64.6999992,58.0184929 64.6999992,51.0099996 C64.6999992,44.0015064 59.0184929,38.3200001 52.0099996,38.3200001 Z M56.4893617,16.4541779 L12.5106383,16.4541779 L12.5106383,54.3146897 L22.4340426,46.9652963 C22.7208576,46.7528776 23.0532476,46.6121589 23.4029492,46.5524434 L23.5791118,46.529379 L23.787234,46.5198785 L35.5991176,46.5190701 L35.5914929,46.5470923 C37.5519525,39.3175607 44.1599846,34 52.0099996,34 C53.572828,34 55.0864301,34.2107629 56.523933,34.6054157 L56.4899227,34.5961166 L56.4899227,34.5961166 L56.4893617,16.4541779 Z M41,31 C42.1045695,31 43,31.8954305 43,33 C43,34.0543618 42.1841222,34.9181651 41.1492623,34.9945143 L41,35 L26,35 C24.8954305,35 24,34.1045695 24,33 C24,31.9456382 24.8158778,31.0818349 25.8507377,31.0054857 L26,31 L41,31 Z"/>
            </svg>`,
            label: 'Search',
            className: 'wv-favorites-search-group-btn',
            onClick: async () => {
                if (this.app.searchPanel) {
                    await this.app.searchPanel.openGlobalSearchPanel();
                }
            }
            });
        }

        // Add buttons to group (only those that were created)
        if (draftsButton) this.buttonGroup.appendChild(draftsButton);
        if (mentionsButton) this.buttonGroup.appendChild(mentionsButton);
        if (searchButton) this.buttonGroup.appendChild(searchButton);

        // Insert after header but before scroll container (so it stays fixed)
        sidebar.insertBefore(this.buttonGroup, scrollContainer);

        // Fix scroll container height to account for button group (49px with padding)
        // Profile header is 65px, button group is 49px (8px padding top/bottom + content)
        scrollContainer.style.height = 'calc(100% - 114px)';

        // Update drafts button badge
        if (this.app.draftManager) {
            const drafts = this.app.draftManager.getAllDrafts() || {};
            const draftsCount = Object.keys(drafts).length;
            if (draftsCount > 0) {
                this.updateButtonGroupBadge('drafts', draftsCount);
            }
        }

        this.app?.logger?.log('✅ Button group added to sidebar');
    }

    /**
     * Refresh button group based on current settings
     * Called when settings change
     */
    async refreshButtonGroup() {
        const sidebar = document.querySelector('[data-testid="sidebar"]');
        if (!sidebar) return;

        // Remove existing button group
        if (this.buttonGroup) {
            this.buttonGroup.remove();
            this.buttonGroup = null;
        }

        // Recreate button group with updated settings
        await this.setupButtonGroup(sidebar);

        this.app?.logger?.log('🔄 Button group refreshed based on settings');
    }

    createButtonGroupButton({ icon, label, className, onClick }) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `${className} tw-flex-1 tw-px-3 tw-py-2 tw-rounded-lg tw-bg-slate-100 tw-text-slate-600 tw-transition tw-duration-200 hover:tw-bg-slate-200 tw-flex tw-flex-row tw-items-center tw-gap-2 tw-relative tw-justify-center`;
        button.title = label;

        button.innerHTML = `
            <div class="tw-flex tw-items-center tw-justify-center tw-flex-shrink-0">${icon}</div>
            <span class="tw-text-xs tw-font-medium tw-whitespace-nowrap">${label}</span>
        `;

        button.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            await onClick();
        });

        return button;
    }

    updateButtonGroupBadge(buttonType, count) {
        if (!this.buttonGroup) return;

        const className = `wv-favorites-${buttonType}-group-btn`;
        const button = this.buttonGroup.querySelector(`.${className}`);
        if (!button) return;

        // Remove existing badge
        const existingBadge = button.querySelector('.wv-button-group-badge');
        if (existingBadge) {
            existingBadge.remove();
        }

        // Add new badge if count > 0
        if (count > 0) {
            const badge = document.createElement('span');
            badge.className = 'wv-button-group-badge';
            badge.textContent = count > 99 ? '99+' : count;
            badge.style.cssText = `
                position: absolute;
                top: 4px;
                right: 4px;
                background: linear-gradient(135deg, #10b981 0%, #059669 100%);
                color: white;
                border-radius: 10px;
                padding: 2px 6px;
                font-size: 10px;
                font-weight: 600;
                line-height: 1;
                min-width: 18px;
                text-align: center;
                box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
            `;
            button.appendChild(badge);
        }
    }

    async renderPinnedChats() {
        if (!this.pinnedContainer) return;

        const container = this.pinnedContainer.querySelector('.wv-favorites-container');
        if (!container) return;

        // Throttle frequent renders to reduce unnecessary work and logging
        const now = Date.now();
        if (now - this.lastRenderTime < this.renderCooldown) {
            return;
        }
        this.lastRenderTime = now;

        // Get layout setting
        const layout = this.app.settings?.get('pinnedChatsLayout') || 'carousel';

        // Apply appropriate layout class
        container.classList.remove('wv-favorites-carousel-scroll', 'wv-favorites-grid', 'wv-grid-3', 'wv-grid-4');
        if (layout === 'grid-3') {
            container.classList.add('wv-favorites-grid', 'wv-grid-3');
        } else if (layout === 'grid-4') {
            container.classList.add('wv-favorites-grid', 'wv-grid-4');
        } else {
            container.classList.add('wv-favorites-carousel-scroll');
        }

        // Get pinned chats from IndexedDB and find their current records
        const pinnedChats = await this.app.smartUserDB.getPinnedChats();
        // Reduced logging: only log count unless debug mode is enabled
        if (this.app.settings?.get('debugLogging')) {
            this.app?.logger?.debug('🔍 Raw pinned chats from DB:', pinnedChats.length, pinnedChats.map(c => ({ id: c.id, name: c.name, isPinned: c.isPinned })));
        } else if (pinnedChats.length > 0) {
            this.app?.logger?.log(`📌 Rendering ${pinnedChats.length} pinned chats`);
        }

        const pinnedChatsArray = [];

        // For each pinned chat, get the most current record by name
        for (const chat of pinnedChats) {
            try {
                // Find the current record for this person (handles name-based -> API-based transitions)
                const currentRecord = await this.app.findCurrentRecordByName(chat.name);

                if (currentRecord) {
                    // IMPORTANT: Use the ORIGINAL chat.id for data-chat-id (for reordering)
                    // but use currentRecord data for display and navigation
                    // Store both the original pinned ID and the current record data
                    const mergedRecord = {
                        ...currentRecord,
                        _pinnedRecordId: chat.id, // Keep original pinned record ID for database updates
                        isPinned: true, // Ensure it's marked as pinned
                        pinnedAt: chat.pinnedAt, // Preserve original pin date
                        pinnedOrder: chat.pinnedOrder // Preserve pinned order
                    };

                    // DEBUG: Log avatar data for this pinned chat
                    this.app?.logger?.log('📌 Pinned chat avatar data for:', chat.name, {
                        originalAvatar: chat.avatar,
                        currentRecordAvatar: currentRecord.avatar,
                        mergedAvatar: mergedRecord.avatar,
                        avatarType: mergedRecord.avatar?.type,
                        avatarContent: typeof mergedRecord.avatar?.content === 'string' ?
                            mergedRecord.avatar.content.substring(0, 50) + '...' :
                            mergedRecord.avatar?.content
                    });

                    pinnedChatsArray.push([chat.id, mergedRecord]);

                    // Only log in debug mode to reduce spam
                    if (this.app.settings?.get('debugLogging')) {
                        this.app?.logger?.debug(`🔄 Using current record ID ${currentRecord.id} for navigation, storing original pinned ID ${chat.id} for ${chat.name}`);
                    }
                } else {
                    // Fallback to original chat data if no current record found
                    pinnedChatsArray.push([chat.id, chat]);
                    // Only log warnings in debug mode to reduce console spam
                    if (this.app.settings?.get('debugLogging')) {
                        this.app?.logger?.debug(`⚠️ No current record found for pinned chat, using original: ${chat.name}`);
                    }
                }
            } catch (error) {
                this.app?.logger?.warn(`⚠️ Error finding current record for pinned chat ${chat.name}:`, error);
                // Fallback to original chat data
                pinnedChatsArray.push([chat.id, chat]);
            }
        }

        // Check if content has changed to avoid unnecessary re-rendering
        const currentChatIds = pinnedChatsArray.map(([chatId]) => chatId).sort().join(',');
        if (this._lastRenderedChatIds === currentChatIds) {
            return; // No changes, skip re-rendering
        }
        this._lastRenderedChatIds = currentChatIds;

        container.innerHTML = '';

        if (pinnedChatsArray.length === 0) {
            this.pinnedContainer.classList.remove('wv-has-pinned');
            container.innerHTML = `
                <div class="wv-favorites-empty-state">
                    <span class="tw-text-xs tw-text-gray-400">No pinned chats</span>
                </div>
            `;
            return;
        }

        this.pinnedContainer.classList.add('wv-has-pinned');

        pinnedChatsArray.forEach(([chatId, chatData]) => {
            const pinnedCard = document.createElement('div');
            pinnedCard.className = 'wv-favorites-pinned-card';
            pinnedCard.setAttribute('data-chat-id', chatId);
            pinnedCard.setAttribute('draggable', 'true');

            const displayName = WVFavs.Helpers.getDisplayName(chatData);

            pinnedCard.innerHTML = `
                <div class="wv-favorites-card-content" title="${displayName}">
                    <div class="wv-favorites-card-avatar">
                        ${this.renderSavedAvatar(chatData)}
                        <div class="wv-favorites-card-unpin" title="Unpin ${displayName}">×</div>
                    </div>
                    <div class="wv-favorites-card-name">${displayName}</div>
                </div>
            `;

            const cardContent = pinnedCard.querySelector('.wv-favorites-card-content');
            cardContent.addEventListener('click', (e) => {
                if (!e.target.closest('.wv-favorites-card-unpin')) {
                    this.app?.logger?.log('🎯 Pinned chat clicked:', {
                        name: chatData.name,
                        id: chatData.id,
                        navigation: chatData.navigation
                    });
                    this.navigateToChat(chatData, 'pinned_chat_card_click');
                }
            });

            const unpinBtn = pinnedCard.querySelector('.wv-favorites-card-unpin');
            if (unpinBtn) {
                unpinBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    this.app.unpinChat(chatId);
                });
            }

            container.appendChild(pinnedCard);
        });

        this.setupCarouselDragAndDrop(container);

        // Only setup drag scrolling and scrollbar for carousel mode
        if (layout === 'carousel') {
            this.setupCarouselDragScrolling(container);
            this.applyScrollbarSetting(container);
        }
    }

    setupCarouselDragAndDrop(container) {
        let draggedElement = null;
        let draggedChatId = null;
        let placeholder = null;
        let lastDragOverTime = 0;
        const dragOverThrottle = 50; // ms - limit dragover to 20 times per second max

        container.addEventListener('dragstart', (e) => {
            const card = e.target.closest('.wv-favorites-pinned-card');
            if (card) {
                draggedElement = card;
                draggedChatId = card.getAttribute('data-chat-id');

                // Create placeholder element
                placeholder = card.cloneNode(true);
                placeholder.classList.add('wv-drag-placeholder');
                placeholder.classList.remove('wv-dragging-card');
                placeholder.style.opacity = '0.4';

                card.classList.add('wv-dragging-card');
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/html', card.innerHTML);

                this.app?.logger?.log('🎯 Started dragging card:', draggedChatId);
            }
        });

        container.addEventListener('dragend', (e) => {
            if (draggedElement) {
                draggedElement.classList.remove('wv-dragging-card');
                draggedElement = null;
                draggedChatId = null;
            }
            // Remove placeholder
            if (placeholder && placeholder.parentNode) {
                placeholder.remove();
                placeholder = null;
            }
            // Remove all drag-over indicators
            container.querySelectorAll('.wv-drag-over').forEach(el => {
                el.classList.remove('wv-drag-over');
            });
        });

        container.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';

            // Throttle dragover events to prevent excessive re-rendering
            const now = Date.now();
            if (now - lastDragOverTime < dragOverThrottle) {
                return;
            }
            lastDragOverTime = now;

            if (!draggedElement || !placeholder) return;

            // Find the drop position using both X and Y coordinates
            const afterElement = this.getDragAfterElement(container, e.clientX, e.clientY);

            // Check if placeholder needs to move
            const needsMove = afterElement == null
                ? placeholder.nextElementSibling !== null // If afterElement is null, check if placeholder is already last
                : placeholder.nextElementSibling !== afterElement; // Otherwise, check if it's already before afterElement

            // Only move placeholder if position changes
            if (needsMove) {
                if (afterElement == null) {
                    container.appendChild(placeholder);
                } else {
                    container.insertBefore(placeholder, afterElement);
                }
            }
        });

        container.addEventListener('drop', async (e) => {
            e.preventDefault();
            e.stopPropagation();

            if (draggedElement && draggedChatId && placeholder) {
                // Get the position where placeholder is
                const placeholderIndex = Array.from(container.children).indexOf(placeholder);

                // Move the actual dragged element to placeholder position
                if (placeholderIndex >= 0) {
                    const nextSibling = placeholder.nextElementSibling;
                    if (nextSibling) {
                        container.insertBefore(draggedElement, nextSibling);
                    } else {
                        container.appendChild(draggedElement);
                    }
                }

                // Get all cards in their new order (excluding placeholder)
                const cards = Array.from(container.querySelectorAll('.wv-favorites-pinned-card:not(.wv-drag-placeholder)'));
                const newOrder = cards.map(card => card.getAttribute('data-chat-id'));

                this.app?.logger?.log('🔄 New order after drop:', newOrder);

                // Reorder pinned chats in the database
                await this.reorderPinnedChats(newOrder);
            }

            // Clean up
            if (draggedElement) {
                draggedElement.classList.remove('wv-dragging-card');
                draggedElement = null;
                draggedChatId = null;
            }
            if (placeholder && placeholder.parentNode) {
                placeholder.remove();
                placeholder = null;
            }
        });
    }

    getDragAfterElement(container, x, y) {
        const draggableElements = [...container.querySelectorAll('.wv-favorites-pinned-card:not(.wv-dragging-card):not(.wv-drag-placeholder)')];

        let closestElement = null;
        let closestDistance = Number.POSITIVE_INFINITY;

        draggableElements.forEach(child => {
            const box = child.getBoundingClientRect();

            // Calculate center points
            const childCenterX = box.left + box.width / 2;
            const childCenterY = box.top + box.height / 2;

            // We want to find the closest element that comes AFTER the cursor position
            // "After" means: to the right on same row, OR on a row below
            const isSameRow = Math.abs(childCenterY - y) < box.height / 2;
            const isRowBelow = childCenterY > y + box.height / 2;
            const isRightOnSameRow = isSameRow && childCenterX > x;

            if (isRightOnSameRow || isRowBelow) {
                // Calculate distance to determine closest
                const distance = Math.sqrt(
                    Math.pow(x - childCenterX, 2) +
                    Math.pow(y - childCenterY, 2)
                );

                if (distance < closestDistance) {
                    closestDistance = distance;
                    closestElement = child;
                }
            }
        });

        // If no element found (cursor is after all elements), return null to append at end
        return closestElement;
    }

    async reorderPinnedChats(newOrder) {
        try {
            // Get all pinned chats from the database
            const pinnedChats = await this.app.smartUserDB.getPinnedChats();

            // Create a map of chat ID to chat data
            const chatMap = new Map();
            pinnedChats.forEach(chat => {
                chatMap.set(chat.id, chat);
                // Also map by string version in case of type mismatch
                chatMap.set(chat.id.toString(), chat);
            });

            // Track which chats were successfully matched
            const matchedIds = new Set();
            let matchedCount = 0;

            // Reorder based on newOrder array
            newOrder.forEach((chatId, index) => {
                // Try to get chat from map (we've stored both number and string versions)
                let chat = chatMap.get(chatId);

                // If string didn't work and it's a numeric string, try converting to number
                if (!chat && typeof chatId === 'string' && !isNaN(chatId)) {
                    const numericId = parseInt(chatId, 10);
                    chat = chatMap.get(numericId);
                }

                if (chat) {
                    chat.pinnedOrder = index;
                    matchedIds.add(chat.id); // Use the original chat.id from DB
                    matchedCount++;
                } else {
                    this.app?.logger?.warn(`⚠️ Chat ID ${chatId} from DOM not found in database!`);
                }
            });

            // Log any pinned chats that weren't in the new order
            pinnedChats.forEach(chat => {
                if (!matchedIds.has(chat.id)) {
                    this.app?.logger?.warn(`⚠️ Pinned chat "${chat.name}" (ID: ${chat.id}) was not in the reordered list!`);
                }
            });

            // Update ALL pinned chats in the database with new order
            for (const chat of pinnedChats) {
                if (matchedIds.has(chat.id)) {
                    // Update with the new pinnedOrder
                    await this.app.smartUserDB.updateUserProfile(chat.id, {
                        pinnedOrder: chat.pinnedOrder
                    });
                } else {
                    // This chat wasn't in the reordered list - set pinnedOrder to undefined
                    // so it falls back to lastOpenedTime sorting
                    await this.app.smartUserDB.updateUserProfile(chat.id, {
                        pinnedOrder: undefined
                    });
                }
            }

            // Track analytics for pinned chat reordering
            if (this.app.logger && typeof this.app?.logger?.analytics === 'function') {
                this.app?.logger?.analytics('pinned_chats_reordered', {
                    total_pinned: pinnedChats.length,
                    reordered_count: matchedCount,
                    new_order_positions: newOrder.length
                });
            }

            // Show a success message
            if (this.app.settings?.get('showSnackbars')) {
                this.showSnackbar('Chat order updated');
            }

            // Re-render the carousel with new order
            await this.renderPinnedChats();
        } catch (error) {
            this.app?.logger?.error('❌ Error reordering pinned chats:', error);
            if (this.app.settings?.get('showSnackbars')) {
                this.showSnackbar('Failed to reorder chats');
            }
        }
    }

    setupAccordion() {
        if (!this.pinnedContainer) return;

        const button = this.pinnedContainer.querySelector('.wv-favorites-accordion-btn');
        const content = this.pinnedContainer.querySelector('.wv-favorites-accordion-content');
        const chevron = this.pinnedContainer.querySelector('.wv-favorites-chevron');

        if (!button || !content || !chevron) return;

        button.addEventListener('click', () => {
            const isExpanded = button.getAttribute('aria-expanded') === 'true';
            const newExpanded = !isExpanded;

            button.setAttribute('aria-expanded', newExpanded.toString());
            chevron.style.transform = newExpanded ? 'rotate(0deg)' : 'rotate(-90deg)';
            content.style.display = newExpanded ? 'block' : 'none';

            chrome.storage.sync.set({ pinnedAccordionExpanded: newExpanded });
        });

        chrome.storage.sync.get(['pinnedAccordionExpanded']).then(result => {
            const expanded = result.pinnedAccordionExpanded !== false;
            button.setAttribute('aria-expanded', expanded.toString());
            chevron.style.transform = expanded ? 'rotate(0deg)' : 'rotate(-90deg)';
            content.style.display = expanded ? 'block' : 'none';
        });
    }

    setupCarouselDragScrolling(container) {
        let isDown = false;
        let startX;
        let scrollLeft;
        let hasMoved = false;

        container.addEventListener('mousedown', (e) => {
            if (e.target.closest('.wv-favorites-card-content, .wv-favorites-card-unpin')) {
                return;
            }

            isDown = true;
            hasMoved = false;
            container.classList.add('wv-dragging');
            startX = e.pageX - container.offsetLeft;
            scrollLeft = container.scrollLeft;
        });

        container.addEventListener('mouseleave', () => {
            isDown = false;
            container.classList.remove('wv-dragging');
        });

        container.addEventListener('mouseup', () => {
            isDown = false;
            container.classList.remove('wv-dragging');
        });

        container.addEventListener('mousemove', (e) => {
            if (!isDown) return;
            e.preventDefault();

            const x = e.pageX - container.offsetLeft;
            const walk = (x - startX) * 2;

            if (Math.abs(walk) > 5) {
                hasMoved = true;
            }

            container.scrollLeft = scrollLeft - walk;
        });

        container.addEventListener('click', (e) => {
            if (hasMoved) {
                e.preventDefault();
                e.stopPropagation();
                hasMoved = false;
            }
        });
    }

    applyScrollbarSetting(container) {
        if (this.app.settings.get('showScrollbar')) {
            container.classList.remove('wv-hide-scrollbar');
        } else {
            container.classList.add('wv-hide-scrollbar');
        }
    }

    renderSavedAvatar(chatData) {
        // Enhanced avatar rendering with better fallback handling

        if (!chatData) {
            this.app?.logger?.debug('⚠️ No chatData provided to renderSavedAvatar');
            return this.renderFallbackAvatar('?');
        }

        // DEBUG: Log avatar data structure for troubleshooting
        this.app?.logger?.log('🎨 renderSavedAvatar called for:', chatData.name, {
            hasAvatar: !!chatData.avatar,
            avatarType: chatData.avatar?.type,
            avatarContent: typeof chatData.avatar?.content === 'string' ?
                chatData.avatar.content.substring(0, 100) + (chatData.avatar.content.length > 100 ? '...' : '') :
                chatData.avatar?.content,
            avatarSrc: chatData.avatar?.src,
            avatarKeys: chatData.avatar ? Object.keys(chatData.avatar) : [],
            isString: typeof chatData.avatar === 'string'
        });

        // Priority 1: Structured avatar object with content
        if (chatData.avatar && chatData.avatar.content && chatData.avatar.content !== '?') {
            let content = chatData.avatar.content;

            // Handle icon type (SVG or HTML content)
            if (chatData.avatar.type === 'icon') {
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = content;
                const avatarElement = tempDiv.querySelector('span');

                if (avatarElement) {
                    // Clean up WorkVivo's original classes from legacy stored avatars
                    const classesToRemove = ['tw-w-8', 'tw-h-8', 'tw-mr-3', 'tw-w-full', 'tw-h-full'];
                    classesToRemove.forEach(className => avatarElement.classList.remove(className));

                    return avatarElement.outerHTML;
                }
            }

            // Handle URL/image type avatars (including those with expiration tracking)
            if (chatData.avatar.type === 'url' || chatData.avatar.type === 'image') {
                // Validate URL
                if (content && typeof content === 'string' && content.trim().startsWith('http')) {
                    return `<img src="${content}" alt="${chatData.name || 'Avatar'}" data-testid="channel-avatar-image" class="tw-rounded-full" style="width: 32px; height: 32px; object-fit: cover;">`;
                }
            }

            // Handle character type avatars
            if (chatData.avatar.type === 'character' && content) {
                const avatarColor = this.getConsistentAvatarColor(chatData.name || content);
                return `<span class="tw-flex tw-justify-center tw-items-center tw-rounded-full tw-text-white tw-font-semibold" data-testid="channel-avatar-image" style="width: 32px; height: 32px; background-color: ${avatarColor}; font-size: 14px; line-height: 1;">${content}</span>`;
            }
        }

        // Priority 2: Legacy src field (still check for URLs)
        if (chatData.avatar && chatData.avatar.src && typeof chatData.avatar.src === 'string') {
            if (chatData.avatar.src.trim().startsWith('http')) {
                return `<img src="${chatData.avatar.src}" alt="${chatData.name || 'Avatar'}" data-testid="channel-avatar-image" class="tw-rounded-full" style="width: 32px; height: 32px; object-fit: cover;">`;
            }
        }

        // Priority 3: Direct avatar URL string (API response format)
        if (chatData.avatar && typeof chatData.avatar === 'string' && chatData.avatar.startsWith('http')) {
            return `<img src="${chatData.avatar}" alt="${chatData.name || 'Avatar'}" data-testid="channel-avatar-image" class="tw-rounded-full" style="width: 32px; height: 32px; object-fit: cover;">`;
        }

        // Priority 4: Consistent initials fallback with better styling
        return this.renderFallbackAvatar(chatData.name);
    }

    renderFallbackAvatar(name) {
        const firstLetter = name ? name.charAt(0).toUpperCase() : '?';
        const avatarColor = this.getConsistentAvatarColor(name || '');
        return `<span class="tw-flex tw-justify-center tw-items-center tw-rounded-full tw-text-white tw-font-semibold" data-testid="channel-avatar-image" style="width: 32px; height: 32px; background-color: ${avatarColor}; font-size: 14px; line-height: 1;">${firstLetter}</span>`;
    }

    // Generate consistent avatar colors based on name hash
    getConsistentAvatarColor(name) {
        const colors = [
            '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6',
            '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16'
        ];

        let hash = 0;
        for (let i = 0; i < name.length; i++) {
            hash = name.charCodeAt(i) + ((hash << 5) - hash);
        }

        return colors[Math.abs(hash) % colors.length];
    }

    async addAvatarHoverPinToChatHeader(chatHeader) {
        // Try multiple selectors for avatar container
        let avatarContainer = chatHeader.querySelector('.tw-w-8.tw-h-8.tw-mr-3');

        if (!avatarContainer) {
            // Try alternative selectors
            avatarContainer = chatHeader.querySelector('[class*="tw-w-8"][class*="tw-h-8"]');
        }

        if (!avatarContainer) {
            // Try more generic avatar selectors
            avatarContainer = chatHeader.querySelector('.tw-rounded-full, .rounded-full, [src*="avatar"], img[alt*="avatar"]');
        }

        if (!avatarContainer) {
            // Only log detailed debug info in debug mode
            if (this.app.settings?.get('debugLogging')) {
                this.app?.logger?.warn('❌ Chat header avatar container not found with any selector');
                this.app?.logger?.warn('🔍 Available elements in chat header:', chatHeader.innerHTML.substring(0, 500));
                // Try to find by structure
                const allElements = chatHeader.querySelectorAll('*');
                this.app?.logger?.warn('🔍 All chat header elements:', Array.from(allElements).map(el => el.className).slice(0, 10));
            }
            return;
        }

        // Only log successful finds in debug mode
        if (this.app.settings?.get('debugLogging')) {
            this.app?.logger?.debug('✅ Found chat header avatar container:', avatarContainer, 'with classes:', avatarContainer.className);
        }

        this.removePinUIFromHeader(avatarContainer);

        const chatInfo = WVFavs.DomDataExtractor.extractChatInfo(chatHeader);
        if (!chatInfo.name || !chatInfo.id) {
            this.app?.logger?.warn('Could not extract chat info for pinning:', chatInfo);
            return;
        }

        // Check if this is a NoName group - if so, don't add pin button
        let isNoNameGroup = false;

        // INLINE DETECTION: Check if this looks like a NoName group
        // Pattern 1: Empty or missing name
        if (!chatInfo.name || chatInfo.name.trim() === '') {
            isNoNameGroup = true;
        }
        // Pattern 2: Name looks like comma-separated member list (fake name)
        else if (chatInfo.name.includes(',')) {
            const name = chatInfo.name.trim();
            const endsWithDash = name.endsWith(' -') || name.endsWith('-');
            const hasMultipleCommas = (name.match(/,/g) || []).length >= 1;
            const hasNameBasedId = String(chatInfo.id || '').startsWith('name_');

            if ((endsWithDash || hasMultipleCommas) && hasNameBasedId) {
                isNoNameGroup = true;
            }
        }

        // Also check database for existing NoName group flag
        if (!isNoNameGroup && chatInfo.name) {
            const databaseChat = await this.app.smartUserDB.getChatByName(chatInfo.name);
            if (databaseChat && databaseChat.isNoNameGroup === true) {
                isNoNameGroup = true;
            }
        }

        // Skip pin button for NoName groups
        if (isNoNameGroup) {
            this.app?.logger?.warn('🚫 Skipping pin button for NoName group:', chatInfo.name);
            return; // Don't add pin button at all for NoName groups
        }

        // Check pin status using name-based matching only (ignore IDs completely)
        let isPinned = false;
        let databaseRecord = null;

        if (chatInfo.name) {
            this.app?.logger?.debug('🔍 Checking pin status using name-based matching for:', chatInfo.name);
            const pinnedChats = await this.app.smartUserDB.getPinnedChats();

            // Find the best match using name similarity
            const bestMatch = this.findBestNameMatch(chatInfo.name, pinnedChats);

            if (bestMatch) {
                isPinned = true;
                databaseRecord = bestMatch.record;
                this.app?.logger?.debug('✅ Found pinned status via name matching:', {
                    headerName: chatInfo.name,
                    matchedName: bestMatch.record.name,
                    similarity: bestMatch.similarity,
                    matchType: bestMatch.matchType
                });
            } else {
                this.app?.logger?.log('📌 No pinned match found for:', chatInfo.name);
            }
        }

        const showPinIndicatorSetting = this.app.settings.get('showPinIndicator');

        this.app?.logger?.log('📌 Pin status check:', {
            chatName: chatInfo.name,
            isPinned: isPinned,
            showPinIndicatorSetting: showPinIndicatorSetting,
            willShowBadge: isPinned && showPinIndicatorSetting,
            lookupMethod: 'Name-based matching',
            matchedName: databaseRecord?.name,
            similarity: isPinned ? '99%+' : 'None',
            source: chatInfo._verification?.source
        });

        avatarContainer.style.position = 'relative';
        avatarContainer.setAttribute('data-chat-id', chatInfo.id);

        if (isPinned && showPinIndicatorSetting) {
            this.app?.logger?.log('📌 Chat is pinned and showPinIndicator is enabled - adding badge to header avatar');
            this.addPinIndicatorToHeaderAvatar(avatarContainer);
        } else if (isPinned && !showPinIndicatorSetting) {
            this.app?.logger?.log('📌 Chat is pinned but showPinIndicator is disabled - skipping badge');
        } else if (!isPinned) {
            this.app?.logger?.log('📌 Chat is not pinned - no badge needed');
        }

        const pinOverlay = document.createElement('div');
        pinOverlay.className = 'wv-favorites-header-overlay';
        pinOverlay.style.background = isPinned ? 'rgba(220, 38, 38, 0.85)' : 'rgba(0, 0, 0, 0.75)';

        pinOverlay.innerHTML = `
            <button class="wv-favorites-header-pin-btn" title="${isPinned ? 'Unpin chat' : 'Pin chat'}">
                ${isPinned ?
                    `<svg width="16" height="16" viewBox="0 0 14 14" fill="white">
                        <path d="M12 5L8.5 1.5L6.5 3.5L4.5 3L3 4.5L5.5 7L1.5 11L2.5 12L6.5 8L9 10.5L10.5 9L10 7L12 5Z"
                              fill="white"/>
                    </svg>` :
                    `<svg width="16" height="16" viewBox="0 0 14 14" fill="white">
                        <path d="M8.5 1.5L6.5 3.5L4.5 3L3 4.5L5.5 7L1.5 11L2.5 12L6.5 8L9 10.5L10.5 9L10 7L12 5L8.5 1.5Z"
                              fill="white"/>
                    </svg>`
                }
            </button>
        `;

        const pinButton = pinOverlay.querySelector('.wv-favorites-header-pin-btn');
        pinButton.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();

            if (isPinned) {
                await this.app.unpinChat(chatInfo.id);
            } else {
                await this.app.pinChatFromInfo(chatInfo);
            }

            await this.refreshChatHeader(chatHeader);
        });

        avatarContainer.appendChild(pinOverlay);

        // Add search and thread buttons next to avatar
        await this.addSearchButtonToChatHeader(chatHeader);
        await this.addThreadButtonToChatHeader(chatHeader);
    }

    refreshThreadButton(chatHeader, expectedChannelUrl = null) {
        this.app?.logger?.debug('🔄 refreshThreadButton called', { expectedChannelUrl });

        // If expectedChannelUrl is provided, verify it matches current channel
        if (expectedChannelUrl) {
            const currentChannelUrl = this.app.threadManager?.getCurrentChannel();
            if (currentChannelUrl !== expectedChannelUrl) {
                this.app?.logger?.warn('⏸️ Skipping thread button refresh - channel mismatch', {
                    expected: expectedChannelUrl,
                    current: currentChannelUrl
                });
                return;
            }
        }

        // Simply re-add the thread button (it removes existing first)
        this.addThreadButtonToChatHeader(chatHeader);
        this.app?.logger?.debug('✅ Thread button refreshed');
    }

    async triggerMessageLoad() {
        // Trigger WorkVivo's API call with minimal visual impact
        const messageList = document.querySelector('[data-testid="message-list"]') ||
                          document.querySelector('[class*="message"][class*="list"]') ||
                          document.querySelector('[class*="chat"][class*="content"]');

        if (messageList) {
            // Try event dispatch first (completely invisible)
            messageList.dispatchEvent(new Event('scroll', { bubbles: true }));

            // Fallback: instant micro-scroll if WorkVivo needs actual DOM change
            // This is 1px with immediate restore (no delay = invisible)
            const originalScroll = messageList.scrollTop;
            messageList.scrollTop = originalScroll + 1;
            messageList.scrollTop = originalScroll; // Restore immediately

            this.app?.logger?.debug('📜 Triggered message load (event + micro-scroll)');
        } else {
            this.app?.logger?.warn('❌ Could not find message list container to trigger load');
        }
    }

    async loadOlderThreadsProactively(minThreadCount = 20, maxAttempts = 10) {
        this.app?.logger?.debug(`🔄 loadOlderThreadsProactively called: target=${minThreadCount}, maxAttempts=${maxAttempts}`);

        // Find the scrollable chat container - try multiple selectors
        let messageList = document.querySelector('[data-testid="message-list"]');

        if (!messageList) {
            // Try finding by various selectors (excluding the thread panel itself!)
            const allCandidates = [
                { el: document.querySelector('[class*="message"][class*="list"]'), name: 'message-list class' },
                { el: document.querySelector('[class*="chat"][class*="content"]'), name: 'chat-content class' },
                { el: document.querySelector('[data-testid="message-section"] [class*="overflow"]'), name: 'message-section overflow' },
                { el: document.querySelector('[data-testid="message-section"] > div'), name: 'message-section > div' },
                { el: document.querySelector('[data-testid="message-section"] > div > div'), name: 'message-section > div > div' },
                { el: document.querySelector('[data-testid="message-section"] div[class*="scroll"]'), name: 'message-section scroll div' },
                { el: document.querySelector('[data-testid="message-section"] div[style*="overflow"]'), name: 'message-section overflow style' },
                { el: document.querySelector('[data-testid="chat-content"]'), name: 'chat-content testid' },
                { el: document.querySelector('.tw-flex.tw-flex-col.tw-flex-1.tw-overflow-y-auto'), name: 'flex overflow-y-auto' },
                // Find parent of message containers
                { el: document.querySelector('[data-testid="message-container"]')?.parentElement, name: 'message-container parent' },
                { el: document.querySelector('[data-testid="message-container"]')?.parentElement?.parentElement, name: 'message-container grandparent' }
            ];

            // Filter out the thread panel and anything inside it
            const candidates = [];
            allCandidates.forEach(({el, name}) => {
                if (!el) return;
                const isThreadPanel = el.classList?.contains('wv-favorites-thread-panel') || el.closest('.wv-favorites-thread-panel');
                if (isThreadPanel) {
                    this.app?.logger?.debug(`❌ Filtered out (thread panel): ${name}`);
                } else {
                    candidates.push({el, name});
                }
            });

            // Log all valid candidates
            this.app?.logger?.debug('🔍 Searching for message container (after filtering):');
            candidates.forEach(({el, name}) => {
                if (el) {
                    this.app?.logger?.debug(`  - ${name}: scrollable=${el.scrollHeight > el.clientHeight}, scrollTop=${el.scrollTop}, scrollHeight=${el.scrollHeight}, clientHeight=${el.clientHeight}`);
                } else {
                    this.app?.logger?.debug(`  - ${name}: NOT FOUND`);
                }
            });

            // First try to find a scrollable element
            let found = candidates.find(({el}) => el && el.scrollHeight > el.clientHeight);

            // If no scrollable element, find the tallest element (likely the message container)
            if (!found) {
                this.app?.logger?.debug('⚠️ No scrollable element found, finding tallest container...');
                const validCandidates = candidates.filter(({el}) => el && el.clientHeight > 100);
                if (validCandidates.length > 0) {
                    found = validCandidates.reduce((tallest, current) =>
                        current.el.clientHeight > tallest.el.clientHeight ? current : tallest
                    );
                    this.app?.logger?.debug(`✅ Using tallest element: ${found.name} (height: ${found.el.clientHeight}px)`);
                }
            } else {
                this.app?.logger?.debug(`✅ Using scrollable element: ${found.name}`);
            }

            if (found) {
                messageList = found.el;
            }
        }

        if (!messageList) {
            this.app?.logger?.error('❌ Message list not found for proactive loading');
            this.app?.logger?.error('🔍 Tried all selectors but none are scrollable');
            return { success: false, threadsLoaded: 0 };
        }

        // If element is not scrollable, try to find scrollable ancestor
        if (messageList.scrollHeight <= messageList.clientHeight) {
            this.app?.logger?.debug(`⚠️ Selected element is not scrollable (${messageList.scrollHeight} <= ${messageList.clientHeight}), checking ancestors...`);

            // First, find ALL scrollable elements in the page for debugging
            this.app?.logger?.debug('🔍 Searching for ALL scrollable elements in page:');
            const allScrollable = Array.from(document.querySelectorAll('*')).filter(el =>
                el.scrollHeight > el.clientHeight &&
                !el.classList?.contains('wv-favorites-thread-panel') &&
                !el.closest('.wv-favorites-thread-panel')
            ).slice(0, 10); // Limit to first 10

            allScrollable.forEach((el, i) => {
                this.app?.logger?.debug(`  ${i + 1}. ${el.getAttribute('data-testid') || el.className || el.tagName} - scrollTop=${el.scrollTop}, scrollHeight=${el.scrollHeight}, clientHeight=${el.clientHeight}, messages=${el.querySelectorAll('[data-testid="message-container"]').length}`);
            });

            let ancestor = messageList.parentElement;
            let depth = 0;
            while (ancestor && depth < 5) {
                if (ancestor.scrollHeight > ancestor.clientHeight) {
                    this.app?.logger?.debug(`✅ Found scrollable ancestor at depth ${depth + 1}: ${ancestor.getAttribute('data-testid') || ancestor.className || 'no-class'}`);
                    this.app?.logger?.debug(`   scrollTop=${ancestor.scrollTop}, scrollHeight=${ancestor.scrollHeight}, clientHeight=${ancestor.clientHeight}`);
                    messageList = ancestor;
                    break;
                }
                depth++;
                ancestor = ancestor.parentElement;
            }

            if (messageList.scrollHeight <= messageList.clientHeight) {
                this.app?.logger?.debug(`⚠️ No scrollable ancestor found within 5 levels.`);
                // If we found scrollable elements in the page, try using the first one with messages
                const withMessages = allScrollable.find(el => el.querySelectorAll('[data-testid="message-container"]').length > 0);
                if (withMessages) {
                    this.app?.logger?.debug(`✅ Using first scrollable element with messages from page scan`);
                    messageList = withMessages;
                } else {
                    this.app?.logger?.debug(`❌ No scrollable elements with messages found in entire page`);
                }
            }
        }

        this.app?.logger?.debug(`📍 Using element: ${messageList.getAttribute('data-testid') || messageList.className}`);
        this.app?.logger?.debug(`📏 Scroll dimensions: scrollTop=${messageList.scrollTop}, scrollHeight=${messageList.scrollHeight}, clientHeight=${messageList.clientHeight}`);

        // Log first few messages to understand structure
        const messages = messageList.querySelectorAll('[data-testid="message-container"]');
        this.app?.logger?.debug(`📊 Current messages in DOM: ${messages.length}`);

        const initialScrollTop = messageList.scrollTop;
        let attempts = 0;
        let previousThreadCount = this.app.threadManager.getCurrentThreads().length;
        let staleAttempts = 0;
        let previousMessageCount = this.app.threadManager.getStats().messagesInCurrentChannel;

        this.app?.logger?.debug(`🔄 Starting proactive thread loading (target: ${minThreadCount} threads)...`);
        this.app?.logger?.debug(`📊 Initial state: ${previousThreadCount} threads, ${previousMessageCount} messages, scrollTop: ${messageList.scrollTop}, scrollHeight: ${messageList.scrollHeight}`);

        while (attempts < maxAttempts) {
            const currentThreads = this.app.threadManager.getCurrentThreads();
            const currentCount = currentThreads.length;
            const currentMessageCount = this.app.threadManager.getStats().messagesInCurrentChannel;

            // Stop if we have enough threads
            if (currentCount >= minThreadCount) {
                this.app?.logger?.log(`✅ Loaded ${currentCount} threads (target met)`);
                return { success: true, threadsLoaded: currentCount };
            }

            // Scroll up to trigger data load
            const previousScroll = messageList.scrollTop;

            // When near top, do smaller scroll; otherwise scroll 800px up
            const scrollAmount = previousScroll <= 300 ? Math.max(50, previousScroll) : 800;
            const targetScroll = Math.max(0, previousScroll - scrollAmount);

            // Do multiple small scrolls to trigger WorkVivo's scroll handlers
            const steps = 8;
            const stepAmount = (previousScroll - targetScroll) / steps;

            for (let step = 0; step < steps; step++) {
                const newScrollTop = previousScroll - (stepAmount * (step + 1));
                messageList.scrollTop = Math.max(0, newScrollTop);

                // Dispatch comprehensive set of events
                messageList.dispatchEvent(new Event('scroll', { bubbles: true, cancelable: false }));
                messageList.dispatchEvent(new UIEvent('scroll', { bubbles: true, cancelable: false, view: window }));

                // Simulate wheel event (some apps listen to this instead of scroll)
                try {
                    messageList.dispatchEvent(new WheelEvent('wheel', {
                        deltaY: -stepAmount,
                        bubbles: true,
                        cancelable: true,
                        view: window
                    }));
                } catch (e) {
                    // Ignore if WheelEvent not supported
                }

                await new Promise(resolve => setTimeout(resolve, 30)); // Reduced from 50ms
            }

            // Final position
            messageList.scrollTop = targetScroll;

            // Dispatch final events
            messageList.dispatchEvent(new Event('scroll', { bubbles: true }));
            messageList.dispatchEvent(new UIEvent('scroll', { bubbles: true, view: window }));

            // Try scrollIntoView on first visible message
            const messages = messageList.querySelectorAll('[data-testid="message-container"]');
            if (messages.length > 0 && messageList.scrollTop > 100) {
                const firstVisible = Array.from(messages).find(msg => {
                    const rect = msg.getBoundingClientRect();
                    return rect.top >= 0 && rect.top < window.innerHeight;
                });

                if (firstVisible) {
                    firstVisible.scrollIntoView({ block: 'start', behavior: 'auto' });
                }
            }

            // Wait for any async loading to trigger
            await new Promise(resolve => setTimeout(resolve, 300));

            const actualScrolled = previousScroll - messageList.scrollTop;

            // If can't scroll (already at top), simulate STRONG scroll with momentum
            if (actualScrolled === 0) {
                this.app?.logger?.debug('📍 At top, simulating STRONG scroll with momentum to trigger virtual scroll');

                // Simulate aggressive scroll with multiple wheel events (strong momentum)
                for (let i = 0; i < 10; i++) {
                    // Large wheel deltas to simulate strong scroll
                    try {
                        messageList.dispatchEvent(new WheelEvent('wheel', {
                            deltaY: -500,  // Strong upward scroll
                            deltaMode: 0,
                            bubbles: true,
                            cancelable: true,
                            view: window
                        }));
                    } catch (e) {}

                    // Rapid scroll position changes
                    messageList.scrollTop = i % 2 === 0 ? 200 : 0;
                    messageList.dispatchEvent(new Event('scroll', { bubbles: true }));
                    await new Promise(resolve => setTimeout(resolve, 20)); // Very fast
                }

                // Final position at top
                messageList.scrollTop = 0;
                messageList.dispatchEvent(new Event('scroll', { bubbles: true }));

                // Wait for WorkVivo's virtual scroll to load
                await new Promise(resolve => setTimeout(resolve, 1000));

                const newCount = this.app.threadManager.getCurrentThreads().length;
                const newMessages = this.app.threadManager.getStats().messagesInCurrentChannel;
                this.app?.logger?.debug(`📊 After strong scroll: threads ${currentCount}→${newCount}, messages ${currentMessageCount}→${newMessages}`);
                if (newCount === currentCount && newMessages === currentMessageCount) {
                    this.app?.logger?.debug(`⏸️ No more data after strong scroll. Loaded ${currentCount} threads.`);
                    return { success: true, threadsLoaded: currentCount, reason: 'no_more_data' };
                }
                attempts++;
                continue;
            }

            this.app?.logger?.debug(`📜 Attempt ${attempts + 1}: scrolled ${actualScrolled}px, now at ${messageList.scrollTop}px, ${currentCount} threads, ${currentMessageCount} messages`);

            // Wait for WorkVivo's API call to complete
            await new Promise(resolve => setTimeout(resolve, 800)); // Reduced from 1500ms

            // Check if new messages OR threads were loaded
            const newMessageCount = this.app.threadManager.getStats().messagesInCurrentChannel;
            const newThreadCount = this.app.threadManager.getCurrentThreads().length;
            const gotNewMessages = newMessageCount !== currentMessageCount;
            const gotNewThreads = newThreadCount !== currentCount;

            if (!gotNewMessages && !gotNewThreads) {
                staleAttempts++;
                this.app?.logger?.debug(`⚠️ Stale attempt ${staleAttempts} - no new data (messages: ${currentMessageCount}, threads: ${currentCount})`);

                if (staleAttempts >= 2) {
                    // Final attempt: STRONG scroll to absolute top with momentum
                    this.app?.logger?.debug(`🔝 Final attempt: STRONG scroll to absolute top with momentum`);

                    // Aggressive scroll with momentum
                    for (let i = 0; i < 10; i++) {
                        try {
                            messageList.dispatchEvent(new WheelEvent('wheel', {
                                deltaY: -500,
                                deltaMode: 0,
                                bubbles: true,
                                cancelable: true,
                                view: window
                            }));
                        } catch (e) {}

                        messageList.scrollTop = i % 2 === 0 ? 200 : 0;
                        messageList.dispatchEvent(new Event('scroll', { bubbles: true }));
                        await new Promise(resolve => setTimeout(resolve, 20));
                    }

                    messageList.scrollTop = 0;
                    messageList.dispatchEvent(new Event('scroll', { bubbles: true }));
                    await new Promise(resolve => setTimeout(resolve, 1000));

                    const finalCount = this.app.threadManager.getCurrentThreads().length;
                    const finalMessages = this.app.threadManager.getStats().messagesInCurrentChannel;
                    this.app?.logger?.debug(`📊 Final check: threads ${currentCount}→${finalCount}, messages ${currentMessageCount}→${finalMessages}`);
                    if (finalCount === currentCount && finalMessages === currentMessageCount) {
                        this.app?.logger?.debug(`⏸️ No new data after strong scroll. Final: ${finalCount} threads, ${finalMessages} messages`);
                        return { success: true, threadsLoaded: finalCount, reason: 'no_new_data' };
                    }
                }
            } else {
                staleAttempts = 0;
                this.app?.logger?.debug(`✅ Progress: ${gotNewMessages ? `+${newMessageCount - currentMessageCount} messages` : ''} ${gotNewThreads ? `+${newThreadCount - currentCount} threads` : ''}`);
            }

            previousThreadCount = currentCount;
            previousMessageCount = currentMessageCount;
            attempts++;
        }

        const finalCount = this.app.threadManager.getCurrentThreads().length;
        this.app?.logger?.log(`⏱️ Max attempts (${maxAttempts}) reached. Loaded ${finalCount} threads.`);
        return { success: true, threadsLoaded: finalCount, reason: 'max_attempts' };
    }

    async addSearchButtonToChatHeader(chatHeader) {
        // Check if search feature is enabled
        const searchEnabled = this.app.settings?.get('enableSearchPanel') !== false;
        if (!searchEnabled || !this.app.searchPanel) {
            return; // Search disabled or SearchPanel not initialized
        }

        // Check if button already exists
        const existing = chatHeader.querySelector('.wv-favorites-search-btn');
        if (existing) {
            return; // Don't recreate
        }

        // Find the actions container on the right side
        const infoBtn = chatHeader.querySelector('#chat-info-button');
        if (!infoBtn) {
            this.app?.logger?.warn('❌ Could not find info button in chat header');
            return;
        }

        const actionsContainer = infoBtn.closest('.tw-flex.tw-items-center');
        if (!actionsContainer) {
            this.app?.logger?.warn('❌ Could not find actions container for info button');
            return;
        }

        this.app?.logger?.debug('🔍 Adding search button to chat header');

        // Create search button matching WorkVivo's style
        const searchButton = document.createElement('button');
        searchButton.type = 'button';
        searchButton.setAttribute('aria-label', 'Search messages');
        searchButton.className = 'wv-favorites-search-btn tw-text-primary-500 focus:tw-outline-primary-400 tw-rounded-lg tw-p-1.5 hover:tw-text-primary-700 tw-mr-2.5';
        searchButton.style.position = 'relative';
        searchButton.title = 'Search messages in this channel';

        searchButton.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="11" cy="11" r="8"/>
                <path d="m21 21-4.35-4.35"/>
            </svg>
        `;

        // Click handler - open search panel
        searchButton.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();

            if (this.app.searchPanel) {
                await this.app.searchPanel.openSearchPanel();
            }
        });

        // Insert as the FIRST child of actions container (leftmost icon, before thread button)
        actionsContainer.insertBefore(searchButton, actionsContainer.firstChild);

        this.app?.logger?.debug('🔍 Search button added to chat header');
    }

    async addThreadButtonToChatHeader(chatHeader, hideBadge = false) {
        // Guard: Ensure app is initialized
        if (!this.app) {
            console.warn('⚠️ DomManager.app not initialized, skipping thread button');
            return;
        }

        // Check if threads feature is enabled
        const threadsEnabled = this.app.settings?.get('enableThreadsPanel') !== false;
        if (!threadsEnabled || !this.app.threadManager) {
            return; // Threads disabled or ThreadManager not initialized
        }

        const chatInfo = this.app.domDataExtractor?.extractChatInfo(chatHeader);

        // Check if chat record has channel_url - if not, don't show thread button
        if (chatInfo?.name) {
            const chatRecord = await this.app.smartUserDB.getChatByName(chatInfo.name);
            if (chatRecord && !chatRecord.channel_url) {
                this.app?.logger?.debug('🚫 Skipping thread button - no channel_url in DB record:', chatInfo.name);
                return;
            }
        }

        // Get thread metadata for current channel (need this to check if button is for same chat)
        let channelUrl = this.app.threadManager?.getCurrentChannel();

        // Double-check channel detection by looking at DOM
        const activeSidebarButton = document.querySelector('button.tw-bg-primary-50.tw-text-primary-600');
        const domChannelUrl = activeSidebarButton?.getAttribute('data-sendbird-channel');

        // If ThreadManager doesn't have channel yet but DOM has it, verify DB record exists first
        if (!channelUrl && domChannelUrl) {
            // Check if DB has record for this channel before showing button
            const allChats = await this.app.smartUserDB.getAllChats();
            const hasRecord = allChats.some(chat => chat.channel_url === domChannelUrl);

            if (!hasRecord) {
                return; // Don't create button for chats without DB records
            }

            this.app?.logger?.debug('🧵 Using DOM channel for initial thread button (ThreadManager not ready):', domChannelUrl);
            channelUrl = domChannelUrl;
            const metadata = this.app.threadManager.getThreadMetadata(channelUrl);
            var unreadCount = (hideBadge || !metadata) ? 0 : (metadata.unreadCount || 0);
        }
        // Warn if mismatch between ThreadManager's channel and DOM's channel
        else if (domChannelUrl && channelUrl && domChannelUrl !== channelUrl) {
            this.app?.logger?.warn('⚠️ Channel mismatch detected!', {
                threadManagerChannel: channelUrl,
                domChannel: domChannelUrl
            });
            // Verify DOM channel has DB record before using it
            const allChats = await this.app.smartUserDB.getAllChats();
            const hasRecord = allChats.some(chat => chat.channel_url === domChannelUrl);

            if (!hasRecord) {
                return; // Don't create button during mismatch if no DB record
            }

            // Use DOM channel as source of truth (it has a DB record)
            const correctedChannelUrl = domChannelUrl;
            const metadata = this.app.threadManager.getThreadMetadata(correctedChannelUrl);
            var unreadCount = (hideBadge || !metadata) ? 0 : (metadata.unreadCount || 0);
        } else {
            const metadata = channelUrl ? this.app.threadManager.getThreadMetadata(channelUrl) : null;
            var unreadCount = (hideBadge || !metadata) ? 0 : (metadata.unreadCount || 0);
        }

        // If we still don't have a valid channel URL, don't create button
        if (!channelUrl) {
            return;
        }

        // Check if button already exists for THE SAME channel - if so, skip recreation (preserves badge)
        const existing = chatHeader.querySelector('.wv-favorites-thread-btn');
        if (existing) {
            const existingChannelUrl = existing.dataset.channelUrl;
            const existingBadge = existing.querySelector('.wv-favorites-thread-badge, .wv-thread-badge');
            const badgeCount = existingBadge ? existingBadge.textContent : 'none';

            if (existingChannelUrl === channelUrl) {
                return; // Don't recreate - preserves badge and event listeners
            } else {
                // Different channel - remove old button and create new one
                if (existing._cleanupListener) {
                    existing._cleanupListener();
                }
                existing.remove();
            }
        }


        // Find the actions container on the right side
        const infoBtn = chatHeader.querySelector('#chat-info-button');
        if (!infoBtn) {
            this.app?.logger?.warn('❌ Could not find info button in chat header');
            return;
        }

        const actionsContainer = infoBtn.closest('.tw-flex.tw-items-center');
        if (!actionsContainer) {
            this.app?.logger?.warn('❌ Could not find actions container for info button');
            return;
        }

        // Check if thread data is loaded for this channel
        const messageCache = channelUrl ? this.app.threadManager?.getMessageCache(channelUrl) : null;
        const isDataLoaded = messageCache && messageCache.size > 0;

        // Debug logging
        this.app?.logger?.debug('🧵 Adding thread button:', {
            channelUrl,
            domChannelUrl,
            unreadCount,
            isDataLoaded
        });

        // Create thread button matching WorkVivo's style
        const threadButton = document.createElement('button');
        threadButton.type = 'button';
        threadButton.setAttribute('aria-label', 'Threads');

        // Add loading class if data not loaded yet
        const baseClasses = 'wv-favorites-thread-btn tw-text-primary-500 focus:tw-outline-primary-400 tw-rounded-lg tw-p-1.5 hover:tw-text-primary-700 tw-mr-2.5';
        const loadingClass = isDataLoaded ? '' : ' wv-thread-btn-loading';
        threadButton.className = baseClasses + loadingClass;

        threadButton.style.position = 'relative';
        threadButton.disabled = !isDataLoaded;
        threadButton.title = !isDataLoaded ? 'Loading threads...' : (unreadCount > 0 ? `${unreadCount} unread threads` : 'View threads');

        // If data is already loaded but button was created after, it will never get the event
        // So we manually trigger a check after a short delay
        if (!isDataLoaded && channelUrl) {
            setTimeout(() => {
                const freshMessageCache = this.app.threadManager?.getMessageCache(channelUrl);
                if (freshMessageCache && freshMessageCache.size > 0 && threadButton.disabled) {
                    this.app?.logger?.debug('🧵 Data loaded after button creation, enabling button:', channelUrl);
                    threadButton.disabled = false;
                    threadButton.classList.remove('wv-thread-btn-loading');

                    const metadata = this.app.threadManager.getThreadMetadata(channelUrl);
                    const freshUnreadCount = metadata?.unreadCount || 0;
                    threadButton.title = freshUnreadCount > 0 ? `${freshUnreadCount} unread threads` : 'View threads';

                    if (freshUnreadCount > 0) {
                        this.refreshThreadButton(chatHeader, channelUrl);
                    }
                }
            }, 500); // Check after 500ms
        }

        // Store channel URL for later updates
        threadButton.dataset.channelUrl = channelUrl || '';

        threadButton.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="6 0 84 84" width="18" height="18" fill="currentColor">
                <path d="m18.75 16.668c-5.7344 0-10.418 4.6797-10.418 10.414v25c0 4.9258 3.7305 8.4805 8.3359 9.5547v11.281c0 0.83984 0.50781 1.6016 1.2852 1.9219 0.77734 0.32422 1.6758 0.14453 2.2695-0.44922l11.891-11.891h5.3867v2.082c0 5.7344 4.6836 10.418 10.418 10.418h24.137l7.7227 7.7227c0.59375 0.59766 1.4922 0.77344 2.2695 0.45312 0.77734-0.32422 1.2852-1.082 1.2852-1.9258v-7.1133c4.6055-1.0742 8.3359-4.6289 8.3359-9.5547v-16.664c0-5.7344-4.6836-10.418-10.418-10.418h-10.418v-10.418c0-5.7344-4.6797-10.414-10.414-10.414zm0 4.1641h41.668c3.4961 0 6.25 2.7539 6.25 6.25v25c0 3.5-2.7539 6.25-6.25 6.25h-29.168c-0.55078 0-1.082 0.22266-1.4727 0.61328l-8.9453 8.9414v-7.4688c0-1.1523-0.92969-2.0859-2.082-2.0859-3.5 0-6.25-2.75-6.25-6.25v-25c0-3.4961 2.75-6.25 6.25-6.25z"/>
                <path d="m27.082 29.168c-0.55078 0-1.082 0.21875-1.4727 0.60938l-4.1641 4.168c-0.81641 0.8125-0.81641 2.1289 0 2.9453l4.1641 4.1641c0.81641 0.81641 2.1328 0.81641 2.9453 0 0.81641-0.8125 0.81641-2.1289 0-2.9453l-0.60938-0.60938h22.055c2.3242 0 4.168 1.8398 4.168 4.168 0 2.3242-1.8438 4.1641-4.168 4.1641h-14.582c-1.1523 0-2.0859 0.93359-2.0859 2.0859 0 0.55078 0.22266 1.082 0.61328 1.4727 0.39063 0.39062 0.91797 0.60938 1.4727 0.60938h14.582c4.5781 0 8.332-3.7539 8.332-8.332s-3.7539-8.3359-8.332-8.3359h-22.055l0.60938-0.60938c0.81641-0.8125 0.81641-2.1328 0-2.9453-0.39063-0.39062-0.91797-0.60938-1.4727-0.60938z"/>
            </svg>
        `;

        // DON'T create badge here - let handleChannelChange() create it after channel verification
        // This prevents stale badges from being shown

        // Click handler - open thread panel
        threadButton.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();

            if (this.app.threadManager && !threadButton.disabled) {
                await this.openThreadPanel();
            }
        });

        // Listen for thread data loading to enable button
        const enableButtonOnDataLoad = (event) => {
            const eventChannelUrl = event.detail?.channelUrl;
            const buttonChannelUrl = threadButton.dataset.channelUrl;

            // If button has no channel yet (initial load), verify from DOM
            if (!buttonChannelUrl || buttonChannelUrl === '') {
                const activeSidebarButton = document.querySelector('button.tw-bg-primary-50.tw-text-primary-600');
                const currentDomChannel = activeSidebarButton?.getAttribute('data-sendbird-channel');

                // If event channel matches current DOM channel, this is our button
                if (eventChannelUrl === currentDomChannel) {
                    this.app?.logger?.debug('🧵 Initial thread data loaded, enabling button for channel:', eventChannelUrl);
                    threadButton.dataset.channelUrl = eventChannelUrl; // Store the channel now
                    threadButton.disabled = false;
                    threadButton.classList.remove('wv-thread-btn-loading');

                    // Get fresh metadata for badge count
                    const metadata = this.app.threadManager.getThreadMetadata(eventChannelUrl);
                    const freshUnreadCount = metadata?.unreadCount || 0;
                    threadButton.title = freshUnreadCount > 0 ? `${freshUnreadCount} unread threads` : 'View threads';

                    // Update badge if needed
                    if (freshUnreadCount > 0) {
                        this.refreshThreadButton(threadButton.closest('.tw-p-4.tw-border-b'), eventChannelUrl);
                    }
                }
            }
            // Normal case: button has channel, match it
            else if (eventChannelUrl === buttonChannelUrl) {
                this.app?.logger?.debug('🧵 Thread data loaded, enabling button for channel:', eventChannelUrl);
                threadButton.disabled = false;
                threadButton.classList.remove('wv-thread-btn-loading');
                threadButton.title = unreadCount > 0 ? `${unreadCount} unread threads` : 'View threads';
            }
        };

        // Listen for thread messages event
        window.addEventListener('wv-thread-messages', enableButtonOnDataLoad);

        // Store cleanup function on button for later removal
        threadButton._cleanupListener = () => {
            window.removeEventListener('wv-thread-messages', enableButtonOnDataLoad);
        };

        // Insert AFTER search button if it exists, otherwise as first child
        // This ensures order: Search (left) → Threads (right)
        const searchButton = actionsContainer.querySelector('.wv-favorites-search-btn');
        if (searchButton) {
            actionsContainer.insertBefore(threadButton, searchButton.nextSibling);
            this.app?.logger?.debug('🧵 Thread button added after search button', { unreadCount, isDataLoaded });
        } else {
            actionsContainer.insertBefore(threadButton, actionsContainer.firstChild);
            this.app?.logger?.debug('🧵 Thread button added as first icon', { unreadCount, isDataLoaded });
        }

        // Update badge after button is added to DOM (fixes badge loss when button is recreated)
        if (channelUrl && channelUrl === this.app.threadManager?.getCurrentChannel()) {
            const threads = this.app.threadManager.channelThreads.get(channelUrl) || [];
            if (threads.length > 0) {
                const unreadThreads = threads.filter(t => {
                    const hasReplies = (t.replyCount || 0) > 0;
                    const neverRead = t.lastReadAt === 0;
                    const readBeforeLastReply = t.lastReadAt < (t.lastRepliedAt || 0);
                    return hasReplies && (neverRead || readBeforeLastReply);
                });
                const badgeCount = unreadThreads.length;
                this.app.threadManager.updateThreadBadge(badgeCount);
            }
        }
    }

    /**
     * Add mentions button to chat header
     * @param {HTMLElement} chatHeader - The chat header element
     * DISABLED: Use global mentions button in sidebar instead
     */
    async addMentionsButtonToChatHeader(chatHeader) {
        // DISABLED - Use global mentions button in sidebar instead
        return;

        // Check if button already exists
        const existing = chatHeader.querySelector('.wv-favorites-mentions-btn');
        if (existing) {
            return; // Don't recreate
        }

        // Find the actions container on the right side
        const infoBtn = chatHeader.querySelector('#chat-info-button');
        if (!infoBtn) {
            this.app?.logger?.warn('❌ Could not find info button in chat header for mentions button');
            return;
        }

        const actionsContainer = infoBtn.closest('.tw-flex.tw-items-center');
        if (!actionsContainer) {
            this.app?.logger?.warn('❌ Could not find actions container for mentions button');
            return;
        }

        // Get unread mentions count
        const unreadCount = this.app.mentionsManager?.getUnreadCount() || 0;

        this.app?.logger?.debug('📧 Adding mentions button:', { unreadCount });

        // Create mentions button matching WorkVivo's style
        const mentionsButton = document.createElement('button');
        mentionsButton.type = 'button';
        mentionsButton.setAttribute('aria-label', 'Mentions');
        mentionsButton.className = 'wv-favorites-mentions-btn tw-text-primary-500 focus:tw-outline-primary-400 tw-rounded-lg tw-p-1.5 hover:tw-text-primary-700 tw-mr-2.5';
        mentionsButton.style.position = 'relative';
        mentionsButton.title = unreadCount > 0 ? `${unreadCount} unread mentions` : 'View mentions';

        mentionsButton.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.71" width="18" height="18">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" style="fill: none; stroke: currentcolor; stroke-linecap: round; stroke-linejoin: round;"/>
                <circle cx="12" cy="10" r="1" fill="currentColor"/>
                <circle cx="12" cy="14" r="1" fill="currentColor"/>
                <text x="12" y="13" font-size="10" fill="currentColor" text-anchor="middle" font-weight="bold" style="font-family: system-ui;">@</text>
            </svg>
        `;

        // Add badge if there are unread mentions
        if (unreadCount > 0) {
            const badge = document.createElement('span');
            badge.className = 'wv-favorites-mentions-badge';
            badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
            badge.style.cssText = `
                position: absolute;
                top: -4px;
                right: -4px;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                border-radius: 10px;
                padding: 2px 6px;
                font-size: 10px;
                font-weight: 600;
                line-height: 1;
                min-width: 18px;
                text-align: center;
                box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
            `;
            mentionsButton.appendChild(badge);
        }

        // Click handler - open mentions panel
        mentionsButton.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();

            if (this.app.mentionsPanel) {
                await this.app.mentionsPanel.openMentionsPanel();
            }
        });

        // Listen for user identification to enable button
        const handleUserUpdate = () => {
            this.app?.logger?.debug('📧 User identified, mentions button now active');
        };

        window.addEventListener('wv-user-saved', handleUserUpdate);

        // Insert after thread button (or as first child if no thread button)
        const threadButton = actionsContainer.querySelector('.wv-favorites-thread-btn');
        if (threadButton && threadButton.nextSibling) {
            actionsContainer.insertBefore(mentionsButton, threadButton.nextSibling);
        } else if (threadButton) {
            actionsContainer.appendChild(mentionsButton);
        } else {
            // No thread button, insert as first child
            actionsContainer.insertBefore(mentionsButton, actionsContainer.firstChild);
        }

        this.app?.logger?.debug('📧 Mentions button added to chat header');
    }

    /**
     * Update mentions button badge
     * @param {number} count - The number of unread mentions
     */
    updateMentionsBadge(count) {
        const mentionsButton = document.querySelector('.wv-favorites-mentions-btn');
        if (!mentionsButton) return;

        // Remove existing badge
        const existingBadge = mentionsButton.querySelector('.wv-favorites-mentions-badge');
        if (existingBadge) {
            existingBadge.remove();
        }

        // Add new badge if count > 0
        if (count > 0) {
            const badge = document.createElement('span');
            badge.className = 'wv-favorites-mentions-badge';
            badge.textContent = count > 99 ? '99+' : count;
            badge.style.cssText = `
                position: absolute;
                top: -4px;
                right: -4px;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                border-radius: 10px;
                padding: 2px 6px;
                font-size: 10px;
                font-weight: 600;
                line-height: 1;
                min-width: 18px;
                text-align: center;
                box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
            `;
            mentionsButton.appendChild(badge);
        }

        // Update title
        mentionsButton.title = count > 0 ? `${count} unread mentions` : 'View mentions';

        this.app?.logger?.debug('📧 Mentions badge updated:', count);
    }

    /**
     * Update drafts button badge count
     */
    updateDraftsButtonBadge(count) {
        // Update badge in button group
        this.updateButtonGroupBadge('drafts', count);

        this.app?.logger?.debug('📝 Drafts badge updated:', count);
    }


    /**
     * Make avatar and name in sidebar header clickable to open status dialog
     * Wraps them in a transparent button with hover effects and adds status display
     */
    async makeAvatarAndNameClickable() {
        console.log('🔧 [STATUS] makeAvatarAndNameClickable called');

        // Check if status dialog is available
        if (!this.app) {
            console.error('❌ [STATUS] DomManager.app is not set! Did you forget to call DomManager.init()?');
            return;
        }

        console.log('✅ [STATUS] DomManager.app is set:', !!this.app);
        console.log('✅ [STATUS] StatusDialog exists:', !!this.app.statusDialog);

        if (!this.app.statusDialog) {
            console.warn('⚠️ [STATUS] StatusDialog not available, skipping avatar clickable setup');
            return;
        }

        console.log('✅ [STATUS] StatusDialog available, proceeding with setup');

        // Find the sidebar header container
        console.log('🔍 [WV STATUS] Looking for sidebar header container...');
        const headerContainer = document.querySelector('[data-testid="channel-list"] .tw-p-4.tw-flex.tw-items-center.tw-border-b');
        console.log('🔍 [WV STATUS] Header container found:', !!headerContainer);

        if (!headerContainer) {
            console.warn('⚠️ [WV STATUS] Could not find sidebar header container - EXITING');
            this.app?.logger?.warn('⚠️ Could not find sidebar header container');
            return;
        }

        // Check if already wrapped - don't refresh constantly
        console.log('🔍 [WV STATUS] Checking if header already wrapped...');
        const existingWrapper = headerContainer.querySelector('.wv-header-status-clickable');
        console.log('🔍 [WV STATUS] Existing wrapper found:', !!existingWrapper);

        if (existingWrapper) {
            console.log('⏸️ [WV STATUS] Header already wrapped, EXITING makeAvatarAndNameClickable');
            this.app?.logger?.debug('Header already has status clickable wrapper, skipping');
            return;
        }

        console.log('✅ [WV STATUS] Header not wrapped yet, proceeding with profile fetch...');

        // Find the flex container with avatar and name (first part before the buttons)
        const avatarAndNameContainer = headerContainer.querySelector('.tw-mr-2\\.5');
        const nameContainer = headerContainer.querySelector('.tw-font-medium.tw-overflow-hidden');

        if (!avatarAndNameContainer || !nameContainer) {
            this.app?.logger?.warn('⚠️ Could not find avatar or name containers');
            return;
        }

        // Create transparent button wrapper
        const buttonWrapper = document.createElement('button');
        buttonWrapper.className = 'wv-header-status-clickable';
        buttonWrapper.type = 'button';
        buttonWrapper.style.cssText = `
            display: flex;
            align-items: center;
            background: transparent;
            border: none;
            padding: 4px 8px;
            margin: -8px;
            border-radius: 8px;
            cursor: pointer;
            transition: background-color 0.2s ease;
            flex: 1;
            min-width: 0;
        `;

        // Save references before moving elements
        const parent = avatarAndNameContainer.parentElement;
        const insertPosition = nameContainer.nextElementSibling;

        // Create a container for name and status (vertical layout)
        const nameStatusContainer = document.createElement('div');
        nameStatusContainer.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 2px;
            flex: 1;
            min-width: 0;
        `;

        // Update name container styling to ensure truncation
        nameContainer.style.cssText = `
            font-weight: 500;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            width: 100%;
            text-align: left;
        `;

        // Create status display below name
        const statusDisplay = document.createElement('div');
        statusDisplay.className = 'wv-status-display';
        statusDisplay.style.cssText = `
            display: flex;
            align-items: center;
            gap: 4px;
            font-size: 11px;
            color: #64748b;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            width: 100%;
        `;

        // Fetch full profile from API to get current status
        console.log('📥 [WV STATUS] ===== ABOUT TO FETCH CURRENT USER PROFILE =====');
        console.log('📥 [WV STATUS] this.app:', !!this.app);
        console.log('📥 [WV STATUS] this.app.userIdentity:', !!this.app?.userIdentity);
        console.log('📥 [WV STATUS] fetchCurrentUserProfile method:', typeof this.app?.userIdentity?.fetchCurrentUserProfile);

        const profileData = await this.app.userIdentity?.fetchCurrentUserProfile();

        console.log('✅ [WV STATUS] ===== PROFILE DATA RECEIVED =====');
        console.log('✅ [WV STATUS] Profile data:', profileData);

        const statusData = this.app.userIdentity?.getUserStatus(profileData);
        console.log('📊 [WV STATUS] Status data:', statusData);

        const statusText = this.app.userIdentity?.formatStatusDisplay(statusData);
        console.log('📝 [WV STATUS] Status text:', statusText);

        // Load edit icon SVG
        const editIconSvg = await this.loadEditIconSvg();

        // Show default message if no status is set
        const displayText = statusText || 'Set your status';

        statusDisplay.innerHTML = `
            <span style="overflow: hidden; text-overflow: ellipsis; ${!statusText ? 'color: #94a3b8; font-style: italic;' : ''}">${this.escapeHtml(displayText)}</span>
            ${editIconSvg}
        `;

        // Assemble the structure: avatar + (name + status)
        nameStatusContainer.appendChild(nameContainer);
        nameStatusContainer.appendChild(statusDisplay);

        buttonWrapper.appendChild(avatarAndNameContainer);
        buttonWrapper.appendChild(nameStatusContainer);

        // Insert buttonWrapper at the correct position
        parent.insertBefore(buttonWrapper, insertPosition);

        // Click handler - open status dialog
        buttonWrapper.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();

            if (this.app.statusDialog) {
                await this.app.statusDialog.openStatusDialog();
            }
        });

        // Hover effects - greyish background
        buttonWrapper.addEventListener('mouseenter', () => {
            buttonWrapper.style.backgroundColor = 'rgba(148, 163, 184, 0.1)'; // Slate gray with transparency
        });

        buttonWrapper.addEventListener('mouseleave', () => {
            buttonWrapper.style.backgroundColor = 'transparent';
        });

        // Active state (pressed)
        buttonWrapper.addEventListener('mousedown', () => {
            buttonWrapper.style.backgroundColor = 'rgba(148, 163, 184, 0.15)';
        });

        buttonWrapper.addEventListener('mouseup', () => {
            buttonWrapper.style.backgroundColor = 'rgba(148, 163, 184, 0.1)';
        });

        this.app?.logger?.log('✅ Avatar and name wrapped in clickable button for status dialog');
    }

    /**
     * Refresh the status display in sidebar header
     * Uses cached profile data - should only be called after status changes
     */
    async refreshSidebarStatus() {
        const statusDisplay = document.querySelector('.wv-status-display');
        if (!statusDisplay) return;

        // Get cached user profile (already fetched during initialization)
        const user = await this.app.userIdentity?.getCurrentUser();
        if (!user || !user.fullProfile) {
            this.app?.logger?.warn('⚠️ No cached profile data available');
            return;
        }

        const statusData = this.app.userIdentity?.getUserStatus(user.fullProfile);
        const statusText = this.app.userIdentity?.formatStatusDisplay(statusData);

        // Load edit icon SVG
        const editIconSvg = await this.loadEditIconSvg();

        // Show default message if no status is set
        const displayText = statusText || 'Set your status';

        statusDisplay.innerHTML = `
            <span style="overflow: hidden; text-overflow: ellipsis; ${!statusText ? 'color: #94a3b8; font-style: italic;' : ''}">${this.escapeHtml(displayText)}</span>
            ${editIconSvg}
        `;

        this.app?.logger?.log('✅ Sidebar status refreshed:', displayText);
    }

    /**
     * Display recipient status in chat header
     * @param {Object} statusData - Status data { status, expiry }
     * @param {string} userName - Recipient's name
     */
    async displayRecipientStatusInHeader(statusData, userName) {
        try {
            console.log('🎨 [STATUS] Displaying recipient status in chat header');

            // Find chat header
            const messageSection = document.querySelector('[data-testid="message-section"]');
            if (!messageSection) {
                console.log('⚠️ [STATUS] Message section not found');
                return;
            }

            const chatHeader = messageSection.querySelector('.tw-p-4.tw-border-b');
            if (!chatHeader) {
                console.log('⚠️ [STATUS] Chat header not found');
                return;
            }

            // Find the recipient name element
            const nameElement = chatHeader.querySelector('p.tw-mr-4.tw-truncate');
            if (!nameElement) {
                console.log('⚠️ [STATUS] Name element not found in chat header');
                return;
            }

            // CRITICAL: Check if this is a group chat by looking for member count next to name
            // Group chats display member count (e.g., "211") right after the name
            // Look for elements containing only digits in the name's parent/siblings
            // DO NOT modify header for group chats - it will break the layout
            const nameContainer = nameElement.parentElement;
            if (nameContainer) {
                // Check all children of the name's parent for member count indicators
                const siblings = Array.from(nameContainer.children);
                for (const sibling of siblings) {
                    const text = sibling.textContent?.trim();
                    // If we find an element with only digits (like "211", "5"), it's a group
                    if (text && /^\d+$/.test(text)) {
                        console.log('👥 [STATUS] Group chat detected (member count:', text + '), skipping header modification');
                        return;
                    }
                }
            }

            // Format status text
            const statusText = this.app.userIdentity?.formatStatusDisplay(statusData);

            console.log('📊 [STATUS] Status text to display:', statusText);

            // If no status to display, clear any existing status and return
            if (!statusText) {
                console.log('⚠️ [STATUS] No status to display, clearing...');
                this.clearRecipientStatusFromHeader();
                return;
            }

            // First, clean up any existing status displays in the entire chat header
            // This handles cases where React re-renders the header
            const existingStatuses = chatHeader.querySelectorAll('.wv-recipient-status-display');
            existingStatuses.forEach(status => status.remove());

            // Also remove any old wrappers
            const existingWrappers = chatHeader.querySelectorAll('.wv-chat-header-name-status-wrapper');
            existingWrappers.forEach(wrapper => {
                // Move name element back to parent before removing wrapper
                if (wrapper.parentElement && wrapper.querySelector('p.tw-mr-4.tw-truncate')) {
                    const name = wrapper.querySelector('p.tw-mr-4.tw-truncate');
                    wrapper.parentElement.insertBefore(name, wrapper);
                }
                wrapper.remove();
            });

            // Now create fresh wrapper structure
            const wrapper = document.createElement('div');
            wrapper.className = 'wv-chat-header-name-status-wrapper';
            wrapper.style.cssText = `
                display: flex;
                flex-direction: column;
                overflow: hidden;
                flex: 1;
            `;

            // Insert wrapper and move name into it
            const nameParent = nameElement.parentElement;
            nameParent.insertBefore(wrapper, nameElement);
            wrapper.appendChild(nameElement);

            // Remove margin from name element
            nameElement.style.marginBottom = '0';

            // Create new status display element
            const statusDisplay = document.createElement('div');
            statusDisplay.className = 'wv-recipient-status-display';
            statusDisplay.style.cssText = `
                display: flex;
                align-items: center;
                gap: 4px;
                font-size: 12px;
                color: #6b7280;
                margin-top: 2px;
                overflow: hidden;
            `;

            // Set status content
            statusDisplay.innerHTML = `
                <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${this.escapeHtml(statusText)}</span>
            `;

            // Insert status below name in wrapper
            wrapper.appendChild(statusDisplay);

            console.log('✅ [STATUS] Recipient status displayed in chat header (cleaned up duplicates)');
        } catch (error) {
            console.error('❌ [STATUS] Error displaying recipient status:', error);
        }
    }

    /**
     * Clear recipient status from chat header
     */
    clearRecipientStatusFromHeader() {
        try {
            const statusDisplay = document.querySelector('.wv-recipient-status-display');
            if (statusDisplay) {
                statusDisplay.remove();
                console.log('🗑️ [STATUS] Recipient status cleared from chat header');
            }
        } catch (error) {
            console.error('❌ [STATUS] Error clearing recipient status:', error);
        }
    }

    /**
     * Load the edit icon SVG
     */
    async loadEditIconSvg() {
        try {
            const svgUrl = chrome.runtime.getURL('noun-edit-4781137.svg');
            const response = await fetch(svgUrl);
            const svgText = await response.text();

            // Add styling to the SVG
            const styledSvg = svgText.replace('<svg', '<svg style="width: 12px; height: 12px; opacity: 0.6; flex-shrink: 0;"');

            return styledSvg;
        } catch (error) {
            this.app?.logger?.log('❌ Error loading edit icon:', error);
            return '<span style="font-size: 12px;">✏️</span>'; // Fallback emoji
        }
    }

    /**
     * Escape HTML to prevent XSS
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Setup search button override to open extension search widget instead
     */
    async setupSearchButtonOverride() {
        // Try multiple selectors to find the search button
        let searchButton = document.querySelector('button[aria-label="Search"]');

        if (!searchButton) {
            // Try alternative selectors
            searchButton = document.querySelector('button[aria-label*="Search"]');
        }

        if (!searchButton) {
            // Try finding by SVG icon or other attributes
            const buttons = document.querySelectorAll('button');
            for (const btn of buttons) {
                const ariaLabel = btn.getAttribute('aria-label');
                if (ariaLabel && ariaLabel.toLowerCase().includes('search')) {
                    searchButton = btn;
                    break;
                }
            }
        }

        if (!searchButton) {
            this.app?.logger?.warn('⚠️ Could not find search button for override');
            return;
        }

        this.app?.logger?.log('🔍 Found search button:', searchButton);

        // Check if override is enabled
        const overrideEnabled = this.app.settings.get('overrideSearchButton');

        // Remove existing override if present
        if (searchButton.dataset.wvOverrideHandler) {
            const oldHandler = searchButton.wvOverrideHandler;
            if (oldHandler) {
                searchButton.removeEventListener('click', oldHandler, true);
                delete searchButton.wvOverrideHandler;
                searchButton.dataset.wvOverrideSetup = 'false';
                this.app?.logger?.log('🧹 Removed existing search button override');
            }
        }

        // If override is disabled, just clean up and return
        if (!overrideEnabled) {
            this.app?.logger?.debug('⚙️ Search button override is disabled');
            return;
        }

        // Check if floating widget is available
        if (!this.app.floatingWidget) {
            this.app?.logger?.warn('⚠️ Cannot override search button - floating widget is not available');
            return;
        }

        this.app?.logger?.log('🔄 Setting up search button override');

        // Override the click behavior to open search widget
        const overrideHandler = (e) => {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();

            // Open extension search widget
            if (this.app.floatingWidget && typeof this.app.floatingWidget.openSearchWidget === 'function') {
                this.app.floatingWidget.openSearchWidget();
                this.app?.logger?.log('🔍 Opened extension search widget (override)');
            }

            return false;
        };

        // Store handler reference so we can remove it later
        searchButton.wvOverrideHandler = overrideHandler;

        // Add click listener with capture phase to intercept before WorkVivo's handler
        searchButton.addEventListener('click', overrideHandler, true);

        // Mark as set up
        searchButton.dataset.wvOverrideSetup = 'true';
        searchButton.dataset.wvOverrideHandler = 'true';

        this.app?.logger?.log('✅ Search button override enabled - will open search widget');
    }

    /**
     * Setup Google Meet button in message toolbar
     */
    setupGoogleMeetToolbarButton() {
        // Try to add buttons immediately (for all message inputs)
        this.addGoogleMeetToolbarButton();

        // Set up observer to re-add buttons when toolbars change
        this.meetToolbarObserver = new MutationObserver(() => {
            // Check all message-sending-options containers (main chat + thread panels)
            const allToolbars = document.querySelectorAll('[data-testid="message-sending-options"]');
            allToolbars.forEach((toolbar) => {
                // Check if this toolbar already has a Google Meet button
                const hasButton = toolbar.querySelector('.wv-google-meet-toolbar-button');
                if (!hasButton) {
                    this.app?.logger?.log('🔄 Google Meet button missing in toolbar, re-adding...');
                    this.addGoogleMeetToolbarButton();
                }
            });
        });

        // Observe the entire message section to catch both main chat and thread panels
        const messageSection = document.querySelector('[data-testid="message-section"]');
        if (messageSection) {
            this.meetToolbarObserver.observe(messageSection, {
                childList: true,
                subtree: true
            });
            this.app?.logger?.log('👁️ MutationObserver watching message-section for Google Meet buttons');
        }

        // Also retry periodically in case toolbars load later (checks all toolbars)
        this.meetToolbarRetryInterval = setInterval(() => {
            this.addGoogleMeetToolbarButton();
        }, 2000);

        this.app?.logger?.log('📹 Google Meet toolbar button setup initiated');
    }

    /**
     * Add Google Meet button to the message toolbar
     */
    async addGoogleMeetToolbarButton() {
        // Check if Google Meet integration is enabled
        const settings = WVFavs.Settings.getAll();
        if (settings.enableGoogleMeet === false) {
            // Remove any existing GMeet buttons
            const existingButtons = document.querySelectorAll('.wv-google-meet-toolbar-button');
            existingButtons.forEach(btn => btn.remove());
            return;
        }

        // Note: Button is always shown when GMeet toggle is enabled
        // Authentication check happens on click, not on button display

        // Find ALL message-sending-options containers (main chat + thread panels)
        const allMessageOptions = document.querySelectorAll('[data-testid="message-sending-options"]');

        if (allMessageOptions.length === 0) {
            this.app?.logger?.log('⚠️ No message-sending-options containers found');
            return;
        }

        // Add button to each toolbar that doesn't have one
        allMessageOptions.forEach((messageOptions) => {
            // Check if this toolbar already has a Google Meet button
            if (messageOptions.querySelector('.wv-google-meet-toolbar-button')) {
                return; // Skip, already has button
            }

            // Find the button toolbar within this message-sending-options container
            let toolbar = messageOptions.querySelector('.tw-flex.tw-items-center .tw-flex.tw-items-center');

            if (!toolbar) {
                toolbar = messageOptions.querySelector('.tw-flex.tw-items-center');
            }

            if (!toolbar) {
                this.app?.logger?.log('⚠️ Button toolbar not found in this message-sending-options');
                return;
            }

            this.app?.logger?.log('✅ Found button toolbar for Google Meet button');

        // Create the wrapper structure matching WorkVivo's button layout
        const outerWrapper = document.createElement('div');
        outerWrapper.className = 'tw-relative tw-mr-3.5 tw-flex-shrink-0 wv-google-meet-toolbar-button';

        const innerWrapper = document.createElement('div');
        innerWrapper.className = 'tw-pt-0 tw-flex';

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'tw-rounded-lg tw-relative tw-p-2 tw-bg-transparent hover:tw-bg-gray-200 tw-transition-colors tw-cursor-pointer tw-border-0';
        button.setAttribute('aria-label', 'Create Google Meet');
        button.setAttribute('title', 'Create and send Google Meet link');

        button.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 96 96" fill="none" xmlns="http://www.w3.org/2000/svg">
                <g clip-path="url(#clip0_70_5256)">
                <path d="M69 60.9759V58.6468V55.4303V40.2907V37.0742L71.4783 31.9167L83.8696 22.1009C85.5217 20.7145 88 21.8791 88 24.0419V70.9581C88 73.1209 85.4667 74.2855 83.8145 72.8991L69 60.9759Z" fill="#00AC47"/>
                <path d="M28 15L8 35H28V15Z" fill="#FE2C25"/>
                <path d="M28 35H8V61H28V35Z" fill="#2684FC"/>
                <path d="M8 61V74.3333C8 78 11 81 14.6667 81H28V61H8Z" fill="#0066DA"/>
                <path d="M71.5 21.5902C71.5 17.9656 68.5638 15 64.975 15H51.925H28V35H52.5V48L71.5 47.4016V21.5902Z" fill="#FFBA00"/>
                <path d="M52.5 61H28V81H51.925H64.975C68.5638 81 71.5 78.0387 71.5 74.4194V48H52.5V61Z" fill="#00AC47"/>
                <path d="M71.5 32V63L52.5 48L71.5 32Z" fill="#00832D"/>
                </g>
                <defs>
                <clipPath id="clip0_70_5256">
                <rect width="96" height="96" fill="white"/>
                </clipPath>
                </defs>
            </svg>
        `;

        // Add click handler
        button.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            await this.handleCreateGoogleMeet(button);
        });

        // Assemble the structure
        innerWrapper.appendChild(button);
        outerWrapper.appendChild(innerWrapper);

            // Append to the toolbar (will appear after emoji and other buttons)
            toolbar.appendChild(outerWrapper);

            this.app?.logger?.log('✅ Google Meet button added to message toolbar');

            // Track feature discovery (only once)
            if (this.app?.trackFeatureDiscovery && !this.googleMeetFeatureTracked) {
                this.app.trackFeatureDiscovery('google_meet', 'toolbar_button');
                this.googleMeetFeatureTracked = true;
            }
        }); // End forEach
    }

    /**
     * Show confirmation dialog for Google Meet creation
     * @param {string} defaultTitle - Default meeting title
     * @param {string} defaultInviteText - Default invite text
     * @param {number} defaultDuration - Default duration in minutes
     * @returns {Promise<Object|null>} Meeting details or null if cancelled
     */
    async showGoogleMeetConfirmDialog(defaultTitle, defaultInviteText, defaultDuration) {
        return new Promise((resolve) => {
            // Create overlay
            const overlay = document.createElement('div');
            overlay.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0, 0, 0, 0.5);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 999999;
                backdrop-filter: blur(4px);
            `;

            // Create dialog
            const dialog = document.createElement('div');
            dialog.style.cssText = `
                background: white;
                border-radius: 12px;
                padding: 24px;
                max-width: 480px;
                width: 90%;
                box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
                animation: slideIn 0.2s ease-out;
            `;

            // Add animation keyframes
            const style = document.createElement('style');
            style.textContent = `
                @keyframes slideIn {
                    from {
                        transform: translateY(-20px);
                        opacity: 0;
                    }
                    to {
                        transform: translateY(0);
                        opacity: 1;
                    }
                }
            `;
            document.head.appendChild(style);

            dialog.innerHTML = `
                <div style="margin-bottom: 20px;">
                    <h3 style="margin: 0 0 8px 0; font-size: 20px; font-weight: 600; color: #1f2937;">Create Google Meet</h3>
                    <p style="margin: 0; font-size: 14px; color: #6b7280;">Customize your meeting details</p>
                </div>

                <div style="margin-bottom: 16px;">
                    <label style="display: block; margin-bottom: 6px; font-size: 14px; font-weight: 500; color: #374151;">
                        Meeting Title
                    </label>
                    <input
                        type="text"
                        id="meetTitle"
                        value="${defaultTitle}"
                        style="width: 100%; padding: 10px 12px; border: 2px solid #e5e7eb; border-radius: 8px; font-size: 14px; transition: border-color 0.2s;"
                        onfocus="this.style.borderColor='#3b82f6'; this.style.outline='none';"
                        onblur="this.style.borderColor='#e5e7eb';"
                    />
                </div>

                <div style="margin-bottom: 16px;">
                    <label style="display: block; margin-bottom: 6px; font-size: 14px; font-weight: 500; color: #374151;">
                        Invite Text
                    </label>
                    <input
                        type="text"
                        id="meetInviteText"
                        value="${defaultInviteText}"
                        placeholder="Leave empty to send only the link"
                        style="width: 100%; padding: 10px 12px; border: 2px solid #e5e7eb; border-radius: 8px; font-size: 14px; transition: border-color 0.2s;"
                        onfocus="this.style.borderColor='#3b82f6'; this.style.outline='none';"
                        onblur="this.style.borderColor='#e5e7eb';"
                    />
                </div>

                <div style="margin-bottom: 24px;">
                    <label style="display: block; margin-bottom: 6px; font-size: 14px; font-weight: 500; color: #374151;">
                        Duration
                    </label>
                    <select
                        id="meetDuration"
                        style="width: 100%; padding: 10px 12px; border: 2px solid #e5e7eb; border-radius: 8px; font-size: 14px; background: white; cursor: pointer; transition: border-color 0.2s;"
                        onfocus="this.style.borderColor='#3b82f6'; this.style.outline='none';"
                        onblur="this.style.borderColor='#e5e7eb';"
                    >
                        <option value="15" ${defaultDuration === 15 ? 'selected' : ''}>15 minutes</option>
                        <option value="30" ${defaultDuration === 30 ? 'selected' : ''}>30 minutes</option>
                        <option value="45" ${defaultDuration === 45 ? 'selected' : ''}>45 minutes</option>
                        <option value="60" ${defaultDuration === 60 ? 'selected' : ''}>60 minutes</option>
                    </select>
                </div>

                <div style="display: flex; gap: 12px; justify-content: flex-end;">
                    <button
                        id="cancelBtn"
                        style="padding: 10px 20px; border: 2px solid #e5e7eb; background: white; color: #374151; border-radius: 8px; font-size: 14px; font-weight: 500; cursor: pointer; transition: all 0.2s;"
                        onmouseover="this.style.background='#f9fafb'; this.style.borderColor='#d1d5db';"
                        onmouseout="this.style.background='white'; this.style.borderColor='#e5e7eb';"
                    >
                        Cancel
                    </button>
                    <button
                        id="createBtn"
                        style="padding: 10px 20px; border: none; background: #3b82f6; color: white; border-radius: 8px; font-size: 14px; font-weight: 500; cursor: pointer; transition: all 0.2s;"
                        onmouseover="this.style.background='#2563eb';"
                        onmouseout="this.style.background='#3b82f6';"
                    >
                        Create Meeting
                    </button>
                </div>
            `;

            overlay.appendChild(dialog);
            document.body.appendChild(overlay);

            const titleInput = dialog.querySelector('#meetTitle');
            const inviteTextInput = dialog.querySelector('#meetInviteText');
            const durationSelect = dialog.querySelector('#meetDuration');
            const cancelBtn = dialog.querySelector('#cancelBtn');
            const createBtn = dialog.querySelector('#createBtn');

            // Focus the title input
            titleInput.focus();
            titleInput.select();

            // Handle close
            const close = (result) => {
                overlay.remove();
                style.remove();
                resolve(result);
            };

            // Cancel button
            cancelBtn.onclick = () => close(null);

            // Create button
            createBtn.onclick = () => {
                close({
                    title: titleInput.value.trim(),
                    inviteText: inviteTextInput.value,
                    duration: parseInt(durationSelect.value)
                });
            };

            // Keyboard shortcuts
            overlay.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    close(null);
                } else if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
                    e.preventDefault();
                    createBtn.click();
                }
            });

            // Close on overlay click
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    close(null);
                }
            });
        });
    }

    /**
     * Handle Google Meet creation
     * @param {HTMLElement} button - The Google Meet button
     */
    async handleCreateGoogleMeet(button) {
        const originalHTML = button.innerHTML;

        try {
            if (!this.app.googleMeetManager) {
                this.showSnackbar('Google Meet not initialized', 'error');
                return;
            }

            // Get settings
            const settings = await chrome.storage.sync.get(['workvivoSettings']);
            const confirmBeforeCreate = settings.workvivoSettings?.googleMeetConfirmBeforeCreate || false;
            const defaultDuration = settings.workvivoSettings?.googleMeetDuration || 30;
            const defaultInviteText = settings.workvivoSettings?.googleMeetInviteText || '';

            // Get current chat info for meeting title
            const chatInfo = window.WVFavs?.DomDataExtractor?.extractActiveSidebarChatInfo();
            let meetingTitle = chatInfo?.name ? `Meeting with ${chatInfo.name}` : 'Quick Meeting';
            let duration = defaultDuration;
            let customInviteText = defaultInviteText;

            // Show confirmation dialog if enabled
            if (confirmBeforeCreate) {
                const result = await this.showGoogleMeetConfirmDialog(
                    meetingTitle,
                    defaultInviteText,
                    defaultDuration
                );

                // User cancelled
                if (!result) {
                    this.app?.logger?.debug('📹 Meeting creation cancelled by user');
                    return;
                }

                // Use customized values
                meetingTitle = result.title || meetingTitle;
                duration = result.duration;
                customInviteText = result.inviteText;
            }

            // Show loading state
            button.disabled = true;
            button.innerHTML = `
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" class="tw-animate-spin">
                    <circle cx="12" cy="12" r="10" stroke-width="3" stroke-dasharray="32" stroke-linecap="round"/>
                </svg>
            `;
            button.title = 'Creating meeting...';

            this.showSnackbar('Creating Google Meet...', 'info');

            // Create meeting
            this.app?.logger?.debug('📹 Requesting meeting creation...');
            const { meetLink } = await this.app.googleMeetManager.createInstantMeeting(meetingTitle, duration);
            this.app?.logger?.debug('📹 Meeting created successfully:', meetLink);

            // Restore button first (before trying to insert)
            button.disabled = false;
            button.innerHTML = originalHTML;
            button.title = 'Create and send Google Meet link';

            // Insert meeting link into chat input (this has its own error handling and snackbar)
            // Pass the button so we can find the closest input to it
            // If dialog was shown, use the custom invite text from there
            try {
                await this.insertMeetLinkIntoChat(meetLink, button, confirmBeforeCreate ? customInviteText : null);
            } catch (insertError) {
                this.app?.logger?.error('Failed to insert meet link, but meeting was created:', insertError);
                // Copy to clipboard as fallback
                const clipboardText = customInviteText ? `${customInviteText}${meetLink}` : meetLink;
                await navigator.clipboard.writeText(clipboardText);
                this.showSnackbar('Meeting created! Link copied to clipboard', 'success');
            }

        } catch (error) {
            this.app?.logger?.error('Failed to create Google Meet:', error);

            // Check if error is due to insufficient permissions
            if (error.message === 'PERMISSION_DENIED') {
                this.app?.logger?.log('🔐 Insufficient permissions detected, triggering re-authentication...');

                // Show specific permission error snackbar
                this.showSnackbar('Permission not granted. Requesting calendar access...', 'info');

                try {
                    // Trigger OAuth re-authentication
                    await this.app.googleMeetManager.authenticate();

                    // Show success message
                    this.showSnackbar('Permission granted! Please try creating the meeting again.', 'success');

                    // Restore button so user can retry
                    button.disabled = false;
                    button.innerHTML = originalHTML;
                    button.title = 'Create and send Google Meet link';
                } catch (authError) {
                    this.app?.logger?.error('Re-authentication failed:', authError);

                    // Show specific error message about permissions
                    this.showSnackbar('Permission not granted. Try again and allow calendar events permission.', 'error');

                    // Restore button
                    button.disabled = false;
                    button.innerHTML = originalHTML;
                    button.title = 'Create and send Google Meet link';
                }
            } else {
                // Other error - show generic error
                this.showSnackbar(`Failed to create meeting: ${error.message}`, 'error');

                // Restore button
                button.disabled = false;
                button.innerHTML = originalHTML;
                button.title = 'Create and send Google Meet link';
            }
        }
    }

    /**
     * Insert Google Meet link into chat input
     * @param {string} meetLink - The Google Meet link to insert
     * @param {HTMLElement} button - The button that was clicked (to find closest input)
     * @param {string|null} customInviteText - Optional custom invite text (overrides settings)
     */
    async insertMeetLinkIntoChat(meetLink, button = null, customInviteText = null) {
        try {
            this.app?.logger?.debug('📹 Starting insertMeetLinkIntoChat with:', meetLink);

            // Get invite text from parameter or settings
            let inviteText;
            if (customInviteText !== null) {
                // Use provided custom invite text (from dialog)
                inviteText = customInviteText;
                this.app?.logger?.debug('📹 Using custom invite text from dialog:', inviteText);
            } else {
                // Get from settings
                const settings = await chrome.storage.sync.get(['workvivoSettings']);
                inviteText = settings.workvivoSettings?.googleMeetInviteText || '';
                this.app?.logger?.debug('📹 Using invite text from settings:', inviteText);
            }

            // Find chat input using same selectors as DraftInputMonitor
            const selectors = [
                '[contenteditable="true"][data-testid*="message"]',
                '[contenteditable="true"][placeholder*="message"]',
                '[contenteditable="true"][placeholder*="Message"]',
                'div[contenteditable="true"].ProseMirror',
                'div[contenteditable="true"][role="textbox"]',
                'textarea[placeholder*="message"]',
                'textarea[placeholder*="Message"]'
            ];

            let chatInput = null;

            // If button is provided, find the input closest to it (for thread panel support)
            if (button) {
                this.app?.logger?.debug('📹 Finding input closest to button');
                // Find the message-sending-options container that contains this button
                const messageSendingOptions = button.closest('[data-testid="message-sending-options"]');
                if (messageSendingOptions) {
                    // Look for input within this specific container
                    for (const selector of selectors) {
                        chatInput = messageSendingOptions.querySelector(selector);
                        if (chatInput) {
                            this.app?.logger?.debug('📹 Found chat input in same container using selector:', selector);
                            break;
                        }
                    }
                }
            }

            // Fallback: find any input if we didn't find one near the button
            if (!chatInput) {
                this.app?.logger?.debug('📹 Falling back to finding any chat input');
                for (const selector of selectors) {
                    chatInput = document.querySelector(selector);
                    if (chatInput) {
                        this.app?.logger?.debug('📹 Found chat input using selector:', selector);
                        break;
                    }
                }
            }

            if (!chatInput) {
                this.app?.logger?.warn('📹 Chat input not found, copying to clipboard');
                await navigator.clipboard.writeText(meetLink);
                this.showSnackbar('Meeting created! Link copied to clipboard', 'success');
                return;
            }

            this.app?.logger?.debug('📹 Input element:', {
                tagName: chatInput.tagName,
                contentEditable: chatInput.contentEditable,
                id: chatInput.id,
                className: chatInput.className
            });

            // SIMPLE APPROACH: Just use execCommand('insertText') like user typing
            // This works for both contenteditable and textarea

            // Step 1: Focus the input
            chatInput.focus();
            this.app?.logger?.debug('📹 Focused input');

            // Wait a bit for focus to settle
            await new Promise(resolve => setTimeout(resolve, 100));

            // Step 2: Move cursor to end of content
            if (chatInput.contentEditable === 'true') {
                // For contenteditable, move selection to end
                const range = document.createRange();
                const selection = window.getSelection();
                range.selectNodeContents(chatInput);
                range.collapse(false); // collapse to end
                selection.removeAllRanges();
                selection.addRange(range);
                this.app?.logger?.debug('📹 Moved cursor to end (contenteditable)');
            } else {
                // For textarea
                chatInput.selectionStart = chatInput.value.length;
                chatInput.selectionEnd = chatInput.value.length;
                this.app?.logger?.debug('📹 Moved cursor to end (textarea)');
            }

            // Step 3: Insert the link using execCommand('insertText')
            // This is like the user typing the text
            // If invite text is set, prepend it to the link; otherwise just use the link
            const textToInsert = inviteText ? `${inviteText}${meetLink}` : meetLink;
            const success = document.execCommand('insertText', false, textToInsert);

            this.app?.logger?.debug('📹 execCommand("insertText") success:', success);

            // Step 4: Wait and show success message
            await new Promise(resolve => setTimeout(resolve, 200));

            // Check if text was inserted
            const currentContent = chatInput.textContent || chatInput.value || '';
            if (currentContent.includes(meetLink)) {
                this.showSnackbar('Meeting link inserted! Press Enter to send', 'success');
                this.app?.logger?.debug('📹 Link successfully inserted into input');
            } else {
                // Insertion didn't work, copy to clipboard
                // Include invite text in clipboard if set
                const clipboardText = inviteText ? `${inviteText}${meetLink}` : meetLink;
                await navigator.clipboard.writeText(clipboardText);
                this.showSnackbar('Meeting created! Link copied to clipboard', 'info');
                this.app?.logger?.warn('📹 Link insertion failed, copied to clipboard');
            }

        } catch (error) {
            this.app?.logger?.error('📹 insertMeetLinkIntoChat error:', error);
            // Fallback: copy to clipboard
            try {
                // Get invite text again for error fallback
                const settings = await chrome.storage.sync.get(['workvivoSettings']);
                const inviteText = settings.workvivoSettings?.googleMeetInviteText || '';
                const clipboardText = inviteText ? `${inviteText}${meetLink}` : meetLink;
                await navigator.clipboard.writeText(clipboardText);
                this.showSnackbar('Meeting created! Link copied to clipboard', 'info');
            } catch (clipError) {
                this.showSnackbar('Meeting created!', 'success');
            }
        }
    }

    async openThreadPanel(options = {}) {
        // Initialize retry counter to prevent infinite loops
        const retryCount = options._retryCount || 0;
        const MAX_RETRIES = 10;

        // STEP 1: Wait for DOM to be consistent before reading
        this.app?.logger?.debug('🔍 Verifying DOM consistency before opening panel');

        const messageSection = document.querySelector('[data-testid="message-section"]');
        const chatHeader = messageSection?.querySelector('.tw-p-4.tw-border-b.tw-border-slate-200.tw-rounded-t-lg.tw-absolute.tw-top-0');
        const threadButton = chatHeader?.querySelector('.wv-favorites-thread-btn');

        if (!chatHeader) {
            this.app?.logger?.warn('⚠️ Chat header not found');
            return;
        }

        // Wait for DOM consistency (retry up to 3 times)
        let chatInfo;
        let retries = 0;
        const maxRetries = 3;

        while (retries < maxRetries) {
            chatInfo = window.WVFavs?.DomDataExtractor?.extractChatInfo(chatHeader);

            if (chatInfo && chatInfo._verification?.isConsistent) {
                break; // DOM is consistent
            }

            this.app?.logger?.debug(`⏸️ DOM not consistent, waiting... (retry ${retries + 1}/${maxRetries})`);

            // Show shimmer on button while waiting
            if (threadButton) {
                threadButton.classList.add('wv-thread-btn-loading');
                threadButton.title = 'Loading...';
            }

            await new Promise(resolve => setTimeout(resolve, 200));
            retries++;
        }

        if (!chatInfo || !chatInfo._verification?.isConsistent) {
            this.app?.logger?.warn('⚠️ DOM not consistent, cannot open panel safely');
            if (threadButton) {
                threadButton.classList.remove('wv-thread-btn-loading');
                threadButton.title = 'View threads';
            }
            return;
        }

        // STEP 2: Determine channel URL - look up from database by chat name
        let channelUrl;

        try {
            // Get all chats and find by name (most reliable identifier)
            const allChats = await this.app.smartUserDB.getAllChats();

            // Find ALL chats with matching name, then select the one WITH channel_url
            const matchingChats = allChats.filter(chat => chat.name === chatInfo.name);

            matchingChats.forEach((chat, idx) => {
            });

            const matchingChat = matchingChats.find(chat => chat.channel_url) || matchingChats[0];

            if (matchingChat && matchingChat.channel_url) {
                channelUrl = matchingChat.channel_url;
                this.app?.logger?.debug(`📋 Found channel URL from DB: ${chatInfo.name} → ${channelUrl}`);
            } else {
                this.app?.logger?.warn(`⚠️ No channel URL found for "${chatInfo.name}" in database`);
                this.app?.logger?.warn(`💡 Try navigating away and back to this chat to build the mapping`);

                // For user chats, we can try to fetch it
                if (chatInfo.userId) {
                    this.app?.logger?.debug(`📥 Attempting to fetch channel URL for user chat...`);

                    // Show loading state
                    if (threadButton) {
                        threadButton.classList.add('wv-thread-btn-loading');
                        threadButton.title = 'Fetching channel info...';
                    }

                    // Fetch channel URL
                    channelUrl = await this.app.smartUserDB.ensureChannelUrl(chatInfo.userId);

                    // Remove loading state
                    if (threadButton) {
                        threadButton.classList.remove('wv-thread-btn-loading');
                        threadButton.title = 'View threads';
                    }

                    if (!channelUrl) {
                        this.app?.logger?.error('❌ Could not fetch channel URL');
                        return;
                    }

                    this.app?.logger?.debug(`✅ Fetched channel URL: ${channelUrl}`);
                } else {
                    // Group channel - can't fetch, need to wait for navigation event
                    this.app?.logger?.error('❌ Channel URL not available yet. Please navigate away and back to build the mapping.');
                    return;
                }
            }
        } catch (err) {
            this.app?.logger?.error('Error looking up channel URL:', err);
            if (threadButton) {
                threadButton.classList.remove('wv-thread-btn-loading');
                threadButton.title = 'View threads';
            }
            return;
        }

        // STEP 3: Check if this matches ThreadManager's current channel
        const threadManagerChannel = this.app.threadManager.getCurrentChannel();

        if (channelUrl !== threadManagerChannel) {
            // Check retry limit to prevent infinite loops
            if (retryCount >= MAX_RETRIES) {
                this.app?.logger?.error(`⚠️ Channel sync failed after ${MAX_RETRIES} retries. Aborting.`);
                if (threadButton) {
                    threadButton.classList.remove('wv-thread-btn-loading');
                    threadButton.title = 'Sync failed - please refresh page';
                }
                return;
            }

            this.app?.logger?.warn(`⚠️ Channel mismatch! DOM: ${channelUrl}, ThreadManager: ${threadManagerChannel}`);
            this.app?.logger?.warn(`🔄 Dispatching channel change event and waiting for verification (retry ${retryCount + 1}/${MAX_RETRIES})`);

            // Dispatch channel change event - handleChannelChange will verify and update
            window.dispatchEvent(new CustomEvent('wv-channel-changed', {
                detail: {
                    previousChannel: threadManagerChannel,
                    currentChannel: channelUrl,
                    source: 'panel_open_verification'
                }
            }));

            // Set button to loading state
            if (threadButton) {
                threadButton.classList.add('wv-thread-btn-loading');
                threadButton.title = 'Verifying...';
            }

            // Wait briefly for handleChannelChange to process
            await new Promise(resolve => setTimeout(resolve, 300));

            // Remove loading state
            if (threadButton) {
                threadButton.classList.remove('wv-thread-btn-loading');
                threadButton.title = 'View threads';
            }

            // Retry opening panel now that channel should be updated
            return this.openThreadPanel({
                ...options,
                _retryCount: retryCount + 1
            });
        }

        // Normal flow - no channel mismatch
        const stats = this.app.threadManager.getStats();
        if (stats.messagesInCurrentChannel === 0) {
            this.app?.logger?.debug('⚠️ No messages cached, triggering scroll to load messages');
            await this.triggerMessageLoad();
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        // Get initial threads
        let threads = this.app.threadManager.getCurrentThreads(options.sortBy || 'lastReply');

        // NOTE: Automatic proactive loading disabled - causes unwanted scrolling
        // User can manually click "Load Older Threads" button if needed
        // Old code:
        // if (threads.length < 15 && !options.skipProactiveLoad) {
        //     const result = await this.loadOlderThreadsProactively(20, 8);
        //     threads = this.app.threadManager.getCurrentThreads(options.sortBy || 'lastReply');
        // }

        const updatedStats = this.app.threadManager.getStats();

        this.app?.logger?.log('🧵 Opening thread panel:', {
            threads,
            stats: updatedStats,
            currentChannel: this.app.threadManager.getCurrentChannel()
        });

        // Remove existing panel if open
        const existingPanel = document.querySelector('.wv-favorites-thread-panel');
        if (existingPanel) {
            existingPanel.remove();

            // Track panel close
            if (this.app.analytics) {
                this.app.analytics.trackEvent('thread_panel_closed', {
                    action_method: 'toggle_button',
                    thread_count: threads.length
                });
            }

            return; // Toggle behavior
        }

        // Track panel open
        if (this.app.analytics) {
            this.app.analytics.trackEvent('thread_panel_opened', {
                thread_count: threads.length,
                messages_loaded: updatedStats.messagesInCurrentChannel
            });
        }

        // Verify message section exists (already declared at top of function)
        if (!messageSection) {
            this.app?.logger?.warn('❌ Message section not found');
            return;
        }

        // Get border radius from message section
        const messageSectionStyle = window.getComputedStyle(messageSection);
        const borderRadius = messageSectionStyle.borderRadius || '8px';

        // Create panel container - floating design with full border radius and shadow
        const panel = document.createElement('div');
        panel.className = 'wv-favorites-thread-panel';
        panel.style.cssText = `
            position: absolute;
            top: 12px;
            right: 12px;
            width: 400px;
            height: calc(100% - 24px);
            background: white;
            border: 1px solid #e5e7eb;
            border-radius: ${borderRadius};
            box-shadow: 0 4px 24px rgba(0, 0, 0, 0.12), 0 0 0 1px rgba(0, 0, 0, 0.05);
            z-index: 100;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            animation: slideInRight 0.2s ease-out;
        `;

        // Header
        const header = document.createElement('div');
        header.style.cssText = `
            padding: 10px 12px;
            border-bottom: 1px solid #e5e7eb;
            background: #f9fafb;
        `;

        const unreadCount = threads.filter(t => t.isUnread).length;

        header.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <h3 style="margin: 0; font-size: 15px; font-weight: 600; color: #111827;">Threads</h3>
                <button class="wv-favorites-thread-close" style="
                    background: none;
                    border: none;
                    cursor: pointer;
                    padding: 4px;
                    color: #6b7280;
                    display: flex;
                    align-items: center;
                ">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M18 6L6 18M6 6l12 12"/>
                    </svg>
                </button>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
                <button class="wv-thread-filter-unread" data-active="false" style="
                    padding: 4px 10px;
                    border: 1px solid #d1d5db;
                    border-radius: 6px;
                    background: white;
                    cursor: pointer;
                    font-size: 11px;
                    font-weight: 500;
                    color: #374151;
                    transition: all 0.15s;
                    display: flex;
                    align-items: center;
                    gap: 4px;
                    position: relative;
                ">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                        <polyline points="22,6 12,13 2,6"/>
                    </svg>
                    Unread
                    ${unreadCount > 0 ? `<span style="
                        position: absolute;
                        top: -4px;
                        right: -4px;
                        background: #dc2626;
                        color: white;
                        border-radius: 10px;
                        padding: 1px 5px;
                        font-size: 10px;
                        font-weight: 600;
                        min-width: 16px;
                        text-align: center;
                    ">${unreadCount}</span>` : ''}
                </button>
                <div style="display: inline-flex; border: 1px solid #d1d5db; border-radius: 6px; overflow: hidden; flex: 1;">
                    <button class="wv-thread-sort-btn wv-thread-sort-reply" data-sort="lastReply" style="
                        flex: 1;
                        padding: 4px 8px;
                        border: none;
                        border-right: 1px solid #d1d5db;
                        background: #eff6ff;
                        cursor: pointer;
                        font-size: 11px;
                        font-weight: 600;
                        color: #1e40af;
                        transition: all 0.15s;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        gap: 4px;
                    " title="Sort by latest reply">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                            <polyline points="12 5 12 19"/>
                            <polyline points="19 12 12 19 5 12"/>
                        </svg>
                        Latest
                    </button>
                    <button class="wv-thread-sort-btn wv-thread-sort-start" data-sort="threadStart" style="
                        flex: 1;
                        padding: 4px 8px;
                        border: none;
                        background: white;
                        cursor: pointer;
                        font-size: 11px;
                        font-weight: 500;
                        color: #374151;
                        transition: all 0.15s;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        gap: 4px;
                    " title="Sort by thread start">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                            <circle cx="12" cy="12" r="10"/>
                            <polyline points="12 6 12 12 16 14"/>
                        </svg>
                        Started
                    </button>
                </div>
            </div>
        `;

        // Thread list container
        const threadList = document.createElement('div');
        threadList.style.cssText = `
            flex: 1;
            overflow-y: auto;
            padding: 8px;
        `;

        // Store current state
        let currentSortBy = options.sortBy || 'lastReply';

        // Store state on panel element for access from item click handlers
        panel.dataset.currentSort = currentSortBy;
        panel.dataset.showUnreadOnly = 'false';
        panel.dataset.channelUrl = this.app.threadManager.getCurrentChannel();

        // Render threads function (used by filter and sort)
        const renderThreads = async (filter = 'all', sortBy = currentSortBy) => {
            threadList.innerHTML = '';

            // Get threads with current sort - always get fresh data
            const sortedThreads = this.app.threadManager.getCurrentThreads(sortBy);

            // Fetch mentions in parallel (non-blocking)
            let mentionedThreadIds = new Set();
            if (this.app.mentionsManager) {
                try {
                    // Fetch mentions if:
                    // 1. Not loaded yet (mentions.length === 0), OR
                    // 2. We might have more mentions (hit the limit of 50 on previous fetch)
                    // BUT: Don't fetch if we just fetched within the last 2 seconds (prevent double-fetch during panel opens)
                    const timeSinceLastFetch = this.app.mentionsManager.lastFetchTime
                        ? Date.now() - this.app.mentionsManager.lastFetchTime
                        : Infinity;

                    const shouldFetchMentions =
                        (!this.app.mentionsManager.mentions ||
                        this.app.mentionsManager.mentions.length === 0 ||
                        this.app.mentionsManager.mightHaveMoreMentions) &&
                        timeSinceLastFetch > 2000; // Only fetch if last fetch was more than 2 seconds ago

                    if (shouldFetchMentions) {
                        this.app?.logger?.log('📧 Fetching mentions...', {
                            currentCount: this.app.mentionsManager.mentions?.length || 0,
                            mightHaveMore: this.app.mentionsManager.mightHaveMoreMentions
                        });
                        await this.app.mentionsManager.searchMentions(false); // false = append to existing
                    } else {
                        this.app?.logger?.log('📧 Using cached mentions (no more to fetch)', {
                            timeSinceLastFetch: timeSinceLastFetch < Infinity ? `${timeSinceLastFetch}ms` : 'never'
                        });
                    }

                    // Cross-reference mentions with threads
                    mentionedThreadIds = this.app.mentionsManager.crossReferenceWithThreads(sortedThreads);
                    this.app?.logger?.log('📧 Found mentioned threads:', mentionedThreadIds.size);
                } catch (error) {
                    this.app?.logger?.error('❌ Error fetching mentions for threads:', error);
                }
            }

            // Mark threads with mentions
            sortedThreads.forEach(thread => {
                thread.hasMention = mentionedThreadIds.has(thread.messageId);
            });

            // Apply filter
            const filteredThreads = filter === 'unread'
                ? sortedThreads.filter(t => t.isUnread)
                : sortedThreads;

            // Check if we have any threads at all
            const hasAnyThreads = sortedThreads.length > 0;

            if (filteredThreads.length === 0) {
                let message;
                if (filter === 'unread' && hasAnyThreads) {
                    message = 'No unread threads';
                } else if (!hasAnyThreads) {
                    message = 'No threads in this channel';
                } else {
                    message = 'No threads match filter';
                }

                threadList.innerHTML = `
                    <div style="
                        text-align: center;
                        padding: 40px 20px;
                        color: #6b7280;
                    ">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin: 0 auto 12px; opacity: 0.3;">
                            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                        </svg>
                        <p style="margin: 0; font-size: 14px;">${message}</p>
                    </div>
                `;
            } else {
                filteredThreads.forEach(thread => {
                    const threadItem = this.createThreadListItem(thread, renderThreads, panel);
                    threadList.appendChild(threadItem);
                });
            }
        };

        // Initial render
        renderThreads('all');

        // Footer with date range and Load Older button
        const footer = document.createElement('div');
        footer.style.cssText = `
            padding: 10px;
            border-top: 1px solid #e5e7eb;
            background: #f9fafb;
        `;

        const dateRange = this.app.threadManager.getThreadDateRange(threads);

        // Format dates more compactly
        const formatCompactDate = (timestamp) => {
            const date = new Date(timestamp);
            const day = String(date.getDate()).padStart(2, '0');
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const year = String(date.getFullYear()).slice(-2);
            return `${day}/${month}/${year}`;
        };

        const oldestDate = dateRange ? formatCompactDate(dateRange.oldestThread) : '';
        const dateRangeText = dateRange ? `Now - ${oldestDate}` : 'No threads';

        footer.innerHTML = `
            <div style="
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
                font-size: 11px;
                color: #6b7280;
            ">
                <span style="white-space: nowrap;">${threads.length} Thread${threads.length !== 1 ? 's' : ''}</span>
                <span style="white-space: nowrap;">📅 ${dateRangeText}</span>
                <button class="wv-load-older-threads-btn" style="
                    padding: 4px 10px;
                    border-radius: 4px;
                    border: 1px solid #d1d5db;
                    background: white;
                    cursor: pointer;
                    font-size: 11px;
                    font-weight: 500;
                    color: #374151;
                    transition: all 0.15s;
                    display: flex;
                    align-items: center;
                    gap: 4px;
                    white-space: nowrap;
                ">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M12 19V5M5 12l7-7 7 7"/>
                    </svg>
                    Load more
                </button>
            </div>
        `;

        const loadBtn = footer.querySelector('.wv-load-older-threads-btn');
        loadBtn.addEventListener('click', async () => {
            try {
                this.app?.logger?.debug('🔘 Load Older Threads button clicked');
                loadBtn.disabled = true;
                const originalHTML = loadBtn.innerHTML;
                loadBtn.innerHTML = `<span style="display: flex; align-items: center; gap: 6px;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation: spin 1s linear infinite;">
                        <circle cx="12" cy="12" r="10"/>
                    </svg>
                    Loading...
                </span>`;

                const beforeCount = threads.length;
                this.app?.logger?.debug('📊 Current thread count:', beforeCount);
                const result = await this.loadOlderThreadsProactively(threads.length + 15, 12);
                this.app?.logger?.debug('📊 Load result:', result);
                const afterCount = this.app.threadManager.getCurrentThreads(currentSortBy).length;
                const newThreadsLoaded = afterCount - beforeCount;
                this.app?.logger?.debug('📊 New threads loaded:', newThreadsLoaded);

                // Track load more
                if (this.app.analytics) {
                    this.app.analytics.trackEvent('thread_load_more', {
                        threads_before: beforeCount,
                        threads_loaded: newThreadsLoaded,
                        operation_status: newThreadsLoaded > 0 ? 'success' : 'no_more'
                    });
                }

                if (newThreadsLoaded > 0) {
                    loadBtn.innerHTML = `<span>✓ +${newThreadsLoaded}</span>`;

                // Refresh the thread list and footer
                setTimeout(() => {
                    const updatedThreads = this.app.threadManager.getCurrentThreads(currentSortBy);
                    const updatedDateRange = this.app.threadManager.getThreadDateRange(updatedThreads);
                    const updatedOldestDate = updatedDateRange ? formatCompactDate(updatedDateRange.oldestThread) : '';
                    const updatedDateRangeText = updatedDateRange ? `Now - ${updatedOldestDate}` : 'No threads';

                    // Update footer spans
                    const footerDiv = footer.querySelector('div');
                    footerDiv.children[0].textContent = `${updatedThreads.length} Thread${updatedThreads.length !== 1 ? 's' : ''}`;
                    footerDiv.children[1].textContent = `📅 ${updatedDateRangeText}`;

                    // Re-render thread list
                    renderThreads(showUnreadOnly ? 'unread' : 'all', currentSortBy);

                    // Reset button
                    loadBtn.innerHTML = originalHTML;
                    loadBtn.disabled = false;
                }, 800);
                } else {
                    loadBtn.innerHTML = `<span>✓ No older threads</span>`;
                    setTimeout(() => {
                        loadBtn.innerHTML = originalHTML;
                        loadBtn.disabled = false;
                    }, 2000);
                }
            } catch (error) {
                this.app?.logger?.error('❌ Load Older Threads error:', error);
                loadBtn.innerHTML = `<span>❌ Error</span>`;
                setTimeout(() => {
                    loadBtn.innerHTML = originalHTML;
                    loadBtn.disabled = false;
                }, 2000);
            }
        });

        loadBtn.addEventListener('mouseenter', () => {
            if (!loadBtn.disabled) {
                loadBtn.style.background = '#f9fafb';
                loadBtn.style.borderColor = '#9ca3af';
            }
        });
        loadBtn.addEventListener('mouseleave', () => {
            loadBtn.style.background = 'white';
            loadBtn.style.borderColor = '#d1d5db';
        });

        // Add spinner animation to document if not already present
        if (!document.querySelector('#wv-spinner-animation')) {
            const spinnerStyle = document.createElement('style');
            spinnerStyle.id = 'wv-spinner-animation';
            spinnerStyle.textContent = `
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
            `;
            document.head.appendChild(spinnerStyle);
        }

        // Assemble panel
        panel.appendChild(header);
        panel.appendChild(threadList);
        panel.appendChild(footer);

        // Unread filter toggle button
        const unreadFilterBtn = header.querySelector('.wv-thread-filter-unread');
        let showUnreadOnly = false;

        unreadFilterBtn.addEventListener('click', () => {
            showUnreadOnly = !showUnreadOnly;
            panel.dataset.showUnreadOnly = showUnreadOnly.toString();

            // Update button appearance
            if (showUnreadOnly) {
                // Contained style (active)
                unreadFilterBtn.style.cssText = `
                    padding: 4px 10px;
                    border: 1px solid #1e40af;
                    border-radius: 6px;
                    background: #1e40af;
                    cursor: pointer;
                    font-size: 11px;
                    font-weight: 600;
                    color: white;
                    transition: all 0.15s;
                    display: flex;
                    align-items: center;
                    gap: 4px;
                    position: relative;
                `;
                unreadFilterBtn.querySelector('svg').style.stroke = 'white';
            } else {
                // Outlined style (inactive)
                unreadFilterBtn.style.cssText = `
                    padding: 4px 10px;
                    border: 1px solid #d1d5db;
                    border-radius: 6px;
                    background: white;
                    cursor: pointer;
                    font-size: 11px;
                    font-weight: 500;
                    color: #374151;
                    transition: all 0.15s;
                    display: flex;
                    align-items: center;
                    gap: 4px;
                    position: relative;
                `;
                unreadFilterBtn.querySelector('svg').style.stroke = 'currentColor';
            }

            // Re-add badge if present
            const badge = unreadFilterBtn.querySelector('span:last-child');
            if (badge) {
                unreadFilterBtn.appendChild(badge);
            }

            // Track filter toggle
            if (this.app.analytics) {
                this.app.analytics.trackEvent('thread_filter_toggled', {
                    filter_type: showUnreadOnly ? 'unread_only' : 'all',
                    thread_count: threads.length
                });
            }

            // Re-render threads
            renderThreads(showUnreadOnly ? 'unread' : 'all');
        });

        // Hover effect
        unreadFilterBtn.addEventListener('mouseenter', () => {
            if (!showUnreadOnly) {
                unreadFilterBtn.style.background = '#f9fafb';
            }
        });
        unreadFilterBtn.addEventListener('mouseleave', () => {
            if (!showUnreadOnly) {
                unreadFilterBtn.style.background = 'white';
            }
        });

        // Sort button handlers
        const sortButtons = header.querySelectorAll('.wv-thread-sort-btn');

        sortButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const sortBy = btn.dataset.sort;
                currentSortBy = sortBy;
                panel.dataset.currentSort = sortBy;

                // Update button states
                sortButtons.forEach(b => {
                    const isActive = b.dataset.sort === sortBy;
                    const borderStyle = b === sortButtons[0] ? 'border-right: 1px solid #d1d5db;' : '';
                    const title = b.dataset.sort === 'lastReply' ? 'Sort by latest reply' : 'Sort by thread start';
                    b.style.cssText = `
                        flex: 1;
                        padding: 4px 8px;
                        border: none;
                        ${borderStyle}
                        background: ${isActive ? '#eff6ff' : 'white'};
                        cursor: pointer;
                        font-size: 11px;
                        font-weight: ${isActive ? '600' : '500'};
                        color: ${isActive ? '#1e40af' : '#374151'};
                        transition: all 0.15s;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        gap: 4px;
                    `;
                    b.title = title;
                });

                // Track sort change
                if (this.app.analytics) {
                    this.app.analytics.trackEvent('thread_sort_changed', {
                        sort_by: sortBy,
                        thread_count: threads.length
                    });
                }

                // Re-render threads with new sort (use showUnreadOnly instead of undefined currentFilter)
                renderThreads(showUnreadOnly ? 'unread' : 'all', sortBy);
            });

            // Hover effect
            btn.addEventListener('mouseenter', (e) => {
                if (e.target.dataset.sort !== currentSortBy) {
                    e.target.style.background = '#f3f4f6';
                }
            });
            btn.addEventListener('mouseleave', (e) => {
                if (e.target.dataset.sort !== currentSortBy) {
                    e.target.style.background = 'white';
                }
            });
        });

        // Close button handler
        header.querySelector('.wv-favorites-thread-close').addEventListener('click', () => {
            // Track panel close
            if (this.app.analytics) {
                this.app.analytics.trackEvent('thread_panel_closed', {
                    action_method: 'close_button',
                    thread_count: threads.length
                });
            }

            panel.remove();
        });

        // Store a flag on the panel to prevent auto-close during thread opening
        panel.dataset.preventClose = 'false';

        // Click outside to close
        setTimeout(() => {
            const closeOnClickOutside = (e) => {
                // Don't close if we're currently opening a thread
                if (panel.dataset.preventClose === 'true') {
                    return;
                }

                // Don't close if clicking on thread panel items or WorkVivo's thread panel
                if (panel.contains(e.target) ||
                    e.target.closest('.wv-favorites-thread-btn') ||
                    e.target.closest('[data-testid="thread-message-section"]')) {
                    return;
                }

                // Reset chat content margin
                const chatContent = messageSection.querySelector('[data-testid="chat-content"]');
                if (chatContent) {
                    chatContent.style.marginRight = '0';
                }
                panel.remove();
                document.removeEventListener('click', closeOnClickOutside);
            };
            document.addEventListener('click', closeOnClickOutside);
        }, 100);

        // Append to message section (message-section already has position: relative in inline styles)
        messageSection.appendChild(panel);

        // Add CSS animation
        if (!document.querySelector('#wv-thread-panel-animations')) {
            const style = document.createElement('style');
            style.id = 'wv-thread-panel-animations';
            style.textContent = `
                @keyframes slideInRight {
                    from {
                        transform: translateX(20px);
                        opacity: 0;
                    }
                    to {
                        transform: translateX(0);
                        opacity: 1;
                    }
                }
            `;
            document.head.appendChild(style);
        }

        // Listen for refresh events from API updates (instant updates)
        const handlePanelRefresh = (event) => {
            this.app?.logger?.debug('📬 Panel refresh event received:', {
                eventChannelUrl: event.detail.channelUrl,
                panelChannelUrl: panel.dataset.channelUrl,
                source: event.detail.source,
                match: event.detail.channelUrl === panel.dataset.channelUrl
            });

            if (event.detail.channelUrl === panel.dataset.channelUrl) {
                this.app?.logger?.debug('✅ Channel matches - re-rendering threads');
                this.app?.logger?.debug(`📬 Panel refresh event received (source: ${event.detail.source || 'unknown'})`);

                // Get fresh threads with current sort
                const currentSortBy = panel.dataset.currentSort || 'lastReply';
                const showUnreadOnly = panel.dataset.showUnreadOnly === 'true';
                const currentFilter = showUnreadOnly ? 'unread' : 'all';

                // Re-render with fresh data
                renderThreads(currentFilter, currentSortBy);

                // Update tracking variables to prevent duplicate refresh from polling
                const refreshedThreads = this.app.threadManager.getCurrentThreads(currentSortBy);
                lastThreadCount = refreshedThreads.length;
                lastMessageCount = this.app.threadManager.getStats().messagesInCurrentChannel;
            } else {
                this.app?.logger?.debug('⏸️ Channel mismatch - skipping panel refresh');
            }
        };

        // Shared variables for auto-refresh tracking (defined here so both handlers can access)
        let lastThreadCount = threads.length;
        let lastMessageCount = this.app.threadManager.getStats().messagesInCurrentChannel;

        // Listen for channel change events (immediate update - no waiting for auto-refresh)
        const handleChannelChange = (event) => {
            const { previousChannel, currentChannel, source } = event.detail;
            this.app?.logger?.debug('📍 Channel change detected:', {
                previousChannel,
                currentChannel,
                panelChannel: panel.dataset.channelUrl,
                source: source || 'unknown'
            });

            // Update panel if current channel is different from panel's channel
            if (panel.dataset.channelUrl !== currentChannel) {
                this.app?.logger?.debug('✅ Updating panel to new channel:', currentChannel);

                // Update panel's channel URL immediately
                panel.dataset.channelUrl = currentChannel;

                // Get threads for the new channel (may be empty initially)
                const currentSortBy = panel.dataset.currentSort || 'lastReply';
                const newChannelThreads = this.app.threadManager.getCurrentThreads(currentSortBy);

                // Update tracking variables for auto-refresh
                lastThreadCount = newChannelThreads.length;
                lastMessageCount = this.app.threadManager.getStats().messagesInCurrentChannel;

                // Re-render with new channel's threads
                const showUnreadOnly = panel.dataset.showUnreadOnly === 'true';
                const currentFilter = showUnreadOnly ? 'unread' : 'all';
                renderThreads(currentFilter, currentSortBy);

                // Update unread badge
                const unreadCount = newChannelThreads.filter(t => t.isUnread).length;
                const unreadBtn = panel.querySelector('.wv-thread-filter-unread');
                if (unreadBtn) {
                    let badge = unreadBtn.querySelector('span:last-child');
                    if (unreadCount > 0) {
                        if (!badge) {
                            badge = document.createElement('span');
                            badge.style.cssText = `
                                position: absolute;
                                top: -4px;
                                right: -4px;
                                background: #dc2626;
                                color: white;
                                border-radius: 10px;
                                padding: 1px 5px;
                                font-size: 10px;
                                font-weight: 600;
                                min-width: 16px;
                                text-align: center;
                            `;
                            unreadBtn.appendChild(badge);
                        }
                        badge.textContent = unreadCount;
                    } else if (badge) {
                        badge.remove();
                    }
                }

                // Update thread button in chat header
                const messageSection = document.querySelector('[data-testid="message-section"]');
                if (messageSection) {
                    const chatHeader = messageSection.querySelector('.tw-p-4.tw-border-b.tw-border-slate-200.tw-rounded-t-lg.tw-absolute.tw-top-0');
                    if (chatHeader) {
                        this.refreshThreadButton(chatHeader, currentChannel);
                    }
                }
            }
        };

        window.addEventListener('wv-thread-panel-refresh', handlePanelRefresh);
        window.addEventListener('wv-channel-changed', handleChannelChange);

        // Auto-refresh: Poll for changes while panel is open (backup for edge cases)
        const autoRefreshInterval = setInterval(() => {
            // Check if panel is still in DOM
            if (!document.body.contains(panel)) {
                clearInterval(autoRefreshInterval);
                window.removeEventListener('wv-thread-panel-refresh', handlePanelRefresh);
                window.removeEventListener('wv-channel-changed', handleChannelChange);
                this.app?.logger?.debug('🛑 Auto-refresh stopped + event listeners cleaned up');
                return;
            }

            // Check if channel has changed
            const panelChannelUrl = panel.dataset.channelUrl;
            const currentChannelUrl = this.app.threadManager.getCurrentChannel();

            if (panelChannelUrl !== currentChannelUrl) {
                this.app?.logger?.debug(`📍 Channel changed from ${panelChannelUrl} to ${currentChannelUrl} - refreshing panel`);

                // Update panel's channel URL
                panel.dataset.channelUrl = currentChannelUrl;

                // Get threads for the new channel
                const currentSortBy = panel.dataset.currentSort || 'lastReply';
                const newChannelThreads = this.app.threadManager.getCurrentThreads(currentSortBy);

                // Update counts
                lastThreadCount = newChannelThreads.length;
                lastMessageCount = this.app.threadManager.getStats().messagesInCurrentChannel;

                // Read current filter state
                const showUnreadOnly = panel.dataset.showUnreadOnly === 'true';
                const currentFilter = showUnreadOnly ? 'unread' : 'all';

                // Re-render with new channel's threads
                renderThreads(currentFilter, currentSortBy);

                // Update all badges and UI elements
                const unreadCount = newChannelThreads.filter(t => t.isUnread).length;
                const unreadBtn = panel.querySelector('.wv-thread-filter-unread');
                if (unreadBtn) {
                    let badge = unreadBtn.querySelector('span:last-child');
                    if (unreadCount > 0) {
                        if (!badge) {
                            badge = document.createElement('span');
                            badge.style.cssText = `
                                position: absolute;
                                top: -4px;
                                right: -4px;
                                background: #dc2626;
                                color: white;
                                border-radius: 10px;
                                padding: 1px 5px;
                                font-size: 10px;
                                font-weight: 600;
                                min-width: 16px;
                                text-align: center;
                            `;
                            unreadBtn.appendChild(badge);
                        }
                        badge.textContent = unreadCount;
                    } else if (badge) {
                        badge.remove();
                    }
                }

                // Update thread button in chat header
                const messageSection = document.querySelector('[data-testid="message-section"]');
                if (messageSection) {
                    const chatHeader = messageSection.querySelector('.tw-p-4.tw-border-b.tw-border-slate-200.tw-rounded-t-lg.tw-absolute.tw-top-0');
                    if (chatHeader) {
                        this.refreshThreadButton(chatHeader, currentChannelUrl);
                    }
                }

                return; // Skip the rest of this interval iteration
            }

            // Get current counts
            const currentSortBy = panel.dataset.currentSort || 'lastReply';
            const currentMessageCount = this.app.threadManager.getStats().messagesInCurrentChannel;
            const currentThreads = this.app.threadManager.getCurrentThreads(currentSortBy);
            const currentThreadCount = currentThreads.length;

            // Check if data has changed
            if (currentThreadCount !== lastThreadCount || currentMessageCount !== lastMessageCount) {
                this.app?.logger?.debug(`🔄 Auto-refresh triggered: threads ${lastThreadCount}→${currentThreadCount}, messages ${lastMessageCount}→${currentMessageCount}`);

                // Read current filter state
                const showUnreadOnly = panel.dataset.showUnreadOnly === 'true';
                const currentFilter = showUnreadOnly ? 'unread' : 'all';

                // Re-render with current filter and sort
                renderThreads(currentFilter, currentSortBy);

                // Update unread count in filter button
                const unreadCount = currentThreads.filter(t => t.isUnread).length;
                const unreadBtn = panel.querySelector('.wv-thread-filter-unread');
                if (unreadBtn) {
                    let badge = unreadBtn.querySelector('span:last-child');
                    if (unreadCount > 0) {
                        if (!badge) {
                            badge = document.createElement('span');
                            badge.style.cssText = `
                                position: absolute;
                                top: -4px;
                                right: -4px;
                                background: #dc2626;
                                color: white;
                                border-radius: 10px;
                                padding: 1px 5px;
                                font-size: 10px;
                                font-weight: 600;
                                min-width: 16px;
                                text-align: center;
                            `;
                            unreadBtn.appendChild(badge);
                        }
                        badge.textContent = unreadCount;
                    } else if (badge) {
                        badge.remove();
                    }
                }

                // Update thread button in chat header
                const messageSection = document.querySelector('[data-testid="message-section"]');
                if (messageSection) {
                    const chatHeader = messageSection.querySelector('.tw-p-4.tw-border-b.tw-border-slate-200.tw-rounded-t-lg.tw-absolute.tw-top-0');
                    if (chatHeader) {
                        // Use panel's channel URL for verification
                        this.refreshThreadButton(chatHeader, panel.dataset.channelUrl);
                    }
                }

                // Update stored counts
                lastThreadCount = currentThreadCount;
                lastMessageCount = currentMessageCount;
            }
        }, 5000); // Check every 5 seconds (backup only - API trigger is primary)

        // Store interval ID on panel for cleanup
        panel.dataset.autoRefreshIntervalId = autoRefreshInterval;

        this.app?.logger?.log('✅ Thread panel opened with auto-refresh');
    }

    renderThreadAvatar(thread) {
        // If we have a user avatar URL, use it
        if (thread.userAvatar && thread.userAvatar.startsWith('http')) {
            return `<img src="${thread.userAvatar}" alt="${thread.user}" style="width: 28px; height: 28px; border-radius: 50%; object-fit: cover;">`;
        }

        // Fall back to initials with consistent color
        const firstLetter = thread.user ? thread.user.charAt(0).toUpperCase() : '?';
        const avatarColor = this.getConsistentAvatarColor(thread.user || '');

        return `<span style="
            width: 28px;
            height: 28px;
            display: flex;
            align-items: center;
            justify-content: center;
            background-color: ${avatarColor};
            color: white;
            font-size: 12px;
            font-weight: 600;
            border-radius: 50%;
        ">${firstLetter}</span>`;
    }

    cleanThreadMessage(message, hasAttachment) {
        // Handle empty messages with attachments
        if ((!message || message.trim() === '') && hasAttachment) {
            return '📎 (attachment)';
        }

        if (!message || message.trim() === '') {
            return '(no message)';
        }

        // Remove markdown link syntax: [text](person:id) -> text
        let cleaned = message.replace(/\[([^\]]+)\]\(person:\d+\)/g, '$1');

        // Remove other markdown links: [text](url) -> text
        cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

        // Remove standalone person IDs like (person:123456)
        cleaned = cleaned.replace(/\(person:\d+\)/g, '');

        // Clean up extra whitespace
        cleaned = cleaned.replace(/\s+/g, ' ').trim();

        return cleaned || '(no message)';
    }

    createThreadListItem(thread, renderCallback, panelElement) {
        const item = document.createElement('div');
        item.className = 'wv-favorites-thread-item';
        item.style.cssText = `
            padding: 12px;
            border-radius: 8px;
            margin-bottom: 4px;
            cursor: pointer;
            transition: background 0.15s;
            border-left: 3px solid ${thread.isUnread ? '#dc2626' : 'transparent'};
            background: ${thread.isUnread ? '#fef2f2' : 'white'};
        `;

        const lastReplyAgo = this.formatTimeAgo(thread.lastRepliedAt);
        const threadStartDate = new Date(thread.createdAt).toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
            year: thread.createdAt < Date.now() - 365 * 24 * 60 * 60 * 1000 ? 'numeric' : undefined
        });

        // Clean up message text - remove markdown syntax and person IDs
        const cleanMessage = this.cleanThreadMessage(thread.message, thread.hasAttachment);

        // Render last 2 replies if available
        const renderReplies = () => {
            if (!thread.lastTwoReplies || thread.lastTwoReplies.length === 0) return '';

            return `
                <div style="
                    margin-top: 8px;
                    margin-bottom: 6px;
                    padding-left: 12px;
                    border-left: 2px solid #e5e7eb;
                ">
                    ${thread.lastTwoReplies.map(reply => {
                        const replyMsg = this.cleanThreadMessage(reply.message, false);
                        const truncatedMsg = replyMsg.length > 60 ? replyMsg.substring(0, 60) + '...' : replyMsg;
                        return `
                            <div style="
                                font-size: 11px;
                                color: #6b7280;
                                margin-bottom: 4px;
                                line-height: 1.3;
                            ">
                                <strong style="color: #4b5563;">${reply.user}:</strong> ${truncatedMsg}
                            </div>
                        `;
                    }).join('')}
                </div>
            `;
        };

        item.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 6px;">
                <div style="display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0;">
                    <div style="flex-shrink: 0; width: 28px; height: 28px; border-radius: 50%; overflow: hidden;">
                        ${this.renderThreadAvatar(thread)}
                    </div>
                    <div style="flex: 1; min-width: 0;">
                        <div style="
                            font-weight: ${thread.isUnread ? '600' : '500'};
                            font-size: 13px;
                            color: ${thread.isUnread ? '#1f2937' : '#4b5563'};
                            overflow: hidden;
                            text-overflow: ellipsis;
                            white-space: nowrap;
                        ">${thread.user}</div>
                        <div style="
                            font-size: 10px;
                            color: #9ca3af;
                            margin-top: 1px;
                        ">Started ${threadStartDate}</div>
                    </div>
                </div>
                <span style="font-size: 11px; color: #9ca3af; flex-shrink: 0; margin-left: 8px;">${lastReplyAgo}</span>
            </div>
            <div style="
                font-size: 13px;
                color: #6b7280;
                line-height: 1.4;
                margin-bottom: 6px;
                overflow: hidden;
                text-overflow: ellipsis;
                display: -webkit-box;
                -webkit-line-clamp: 4;
                -webkit-box-orient: vertical;
            ">${cleanMessage}</div>
            ${renderReplies()}
            <div style="display: flex; gap: 12px; font-size: 12px; color: #9ca3af; flex-wrap: wrap;">
                <span>💬 ${thread.replyCount} ${thread.replyCount === 1 ? 'reply' : 'replies'}</span>
                ${thread.isUnread ? '<span style="color: #dc2626; font-weight: 500;">● Unread</span>' : ''}
                ${thread.hasMention ? '<span style="background: linear-gradient(135deg, #9333ea 0%, #7c3aed 100%); color: white; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600;">@mentioned</span>' : ''}
            </div>
        `;

        // Hover effect
        item.addEventListener('mouseenter', () => {
            item.style.background = thread.isUnread ? '#fee2e2' : '#f9fafb';
        });
        item.addEventListener('mouseleave', () => {
            item.style.background = thread.isUnread ? '#fef2f2' : 'white';
        });

        // Click to open thread
        item.addEventListener('click', async () => {
            // Track thread selection
            if (this.app.analytics) {
                this.app.analytics.trackEvent('thread_selected', {
                    reply_count: thread.replyCount,
                    was_unread: thread.isUnread
                });
            }

            if (!panelElement || !renderCallback) {
                this.app?.logger?.warn('⚠️ Missing panel or render callback');
                await this.openThreadById(thread.messageId);
                return;
            }

            // Set flag to prevent panel from closing
            panelElement.dataset.preventClose = 'true';

            await this.openThreadById(thread.messageId);

            // Wait for thread to be marked as read and data to update
            setTimeout(() => {
                panelElement.dataset.preventClose = 'false';

                // Read current state from panel data attributes
                const currentSortBy = panelElement.dataset.currentSort || 'lastReply';
                const showUnreadOnly = panelElement.dataset.showUnreadOnly === 'true';
                const currentFilter = showUnreadOnly ? 'unread' : 'all';

                // Get fresh thread data
                const threads = this.app.threadManager.getCurrentThreads(currentSortBy);
                const unreadCount = threads.filter(t => t.isUnread).length;

                // Update unread count badge
                const unreadBtn = panelElement.querySelector('.wv-thread-filter-unread');
                if (unreadBtn) {
                    let badge = unreadBtn.querySelector('span:last-child');
                    if (unreadCount > 0) {
                        if (!badge) {
                            badge = document.createElement('span');
                            badge.style.cssText = `
                                position: absolute;
                                top: -4px;
                                right: -4px;
                                background: #dc2626;
                                color: white;
                                border-radius: 10px;
                                padding: 1px 5px;
                                font-size: 10px;
                                font-weight: 600;
                                min-width: 16px;
                                text-align: center;
                            `;
                            unreadBtn.appendChild(badge);
                        }
                        badge.textContent = unreadCount;
                    } else if (badge) {
                        badge.remove();
                    }
                }

                // Re-render the thread list with current filter using callback
                renderCallback(currentFilter, currentSortBy);

                // Update thread button badge in header
                const messageSection = document.querySelector('[data-testid="message-section"]');
                if (messageSection) {
                    const chatHeader = messageSection.querySelector('.tw-p-4.tw-border-b.tw-border-slate-200.tw-rounded-t-lg.tw-absolute.tw-top-0');
                    if (chatHeader) {
                        this.refreshThreadButton(chatHeader);
                    }
                }
            }, 1000);
        });

        return item;
    }

    formatTimeAgo(timestamp) {
        const seconds = Math.floor((Date.now() - timestamp) / 1000);

        if (seconds < 60) return 'just now';
        if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
        if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
        if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;

        return new Date(timestamp).toLocaleDateString();
    }

    async openThreadById(messageId) {
        this.app?.logger?.log('🎯 Opening thread:', messageId);

        try {
            // Mark thread as read immediately when user clicks it
            if (this.app.threadManager) {
                this.app.threadManager.markThreadAsRead(messageId);
            }

            // DON'T close the thread panel - keep it open
            // const panel = document.querySelector('.wv-favorites-thread-panel');
            // if (panel) panel.remove();

            // PRIMARY METHOD: Try React Fiber instant thread opening
            const currentChannelUrl = this.app.threadManager?.getCurrentChannel();

            if (currentChannelUrl && this.app.reactFiberNav) {
                this.app?.logger?.log('🧵 Trying React Fiber thread opening (PRIMARY)...');

                try {
                    const result = await this.openThreadViaReactFiber(messageId, currentChannelUrl);

                    if (result.success) {
                        this.app?.logger?.log('✅ Thread opened via React Fiber!');
                        return;
                    } else {
                        this.app?.logger?.warn('⚠️ React Fiber thread opening failed, using fallback:', result.error);
                    }
                } catch (error) {
                    this.app?.logger?.warn('⚠️ React Fiber thread opening error, using fallback:', error.message);
                }
            }

            // FALLBACK METHOD: Traditional scroll and click
            this.app?.logger?.log('📜 Using fallback method: scroll and click');

            // Find the message in the DOM by message ID
            const message = await this.findMessageByIdInDOM(messageId);

            if (message) {
                // Scroll to message
                message.scrollIntoView({ behavior: 'smooth', block: 'center' });

                // Highlight briefly
                const originalBg = message.style.background;
                message.style.background = '#fef3c7';
                message.style.transition = 'background 0.3s';
                setTimeout(() => {
                    message.style.background = originalBg;
                }, 2000);

                // Find and click the "replies" button to open thread panel
                setTimeout(() => {
                    try {
                        this.clickThreadRepliesButton(message);
                    } catch (error) {
                        this.app?.logger?.error('❌ Error clicking thread replies button:', error);
                    }
                }, 500);
            } else {
                this.app?.logger?.warn('❌ Message not found in DOM, will try to scroll and search');
                // Message not visible - need to scroll to find it
                await this.scrollToFindMessage(messageId);
            }
        } catch (error) {
            this.app?.logger?.error('❌ Error opening thread:', error);
        }
    }

    /**
     * Generic method to send requests to page-script.js and await response
     * @param {string} action - The action name (e.g., 'openOldMentionViaReactFiber')
     * @param {object} data - The data to send with the request
     * @param {number} timeout - Timeout in milliseconds (default: 10000)
     * @returns {Promise<object>} Response from page-script.js
     */
    async sendPageScriptRequest(action, data, timeout = 10000) {
        const requestId = `page-script-${action}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        this.app?.logger?.debug(`📤 [EXTENSION CONTEXT] Sending ${action} request to page context...`, {
            requestId,
            action,
            data
        });

        // Create promise that waits for response from page context
        const response = await new Promise((resolve, reject) => {
            const timeoutHandle = setTimeout(() => {
                cleanup();
                reject(new Error(`Page script request timeout (${timeout}ms): ${action}`));
            }, timeout);

            const handleResponse = (event) => {
                if (event.detail.requestId === requestId) {
                    cleanup();
                    if (event.detail.success) {
                        resolve(event.detail.data);
                    } else {
                        reject(new Error(event.detail.error || 'Unknown error'));
                    }
                }
            };

            const cleanup = () => {
                clearTimeout(timeoutHandle);
                document.removeEventListener('wv-fav-api-response', handleResponse);
            };

            document.addEventListener('wv-fav-api-response', handleResponse);

            // Send request to page context
            document.dispatchEvent(new CustomEvent('wv-fav-api-request', {
                detail: {
                    requestId,
                    action,
                    data
                }
            }));
        });

        this.app?.logger?.debug(`✅ [EXTENSION CONTEXT] ${action} response received:`, response);
        return response;
    }

    /**
     * Open thread using React Fiber navigation (via page context)
     * @param {string} messageId - The parent message ID
     * @param {string} channelUrl - The channel URL
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    async openThreadViaReactFiber(messageId, channelUrl) {
        const requestId = `react-fiber-thread-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        this.app?.logger?.debug('🧵 [EXTENSION CONTEXT] Sending thread opening request to page context...', {
            requestId,
            messageId,
            channelUrl
        });

        // Create promise that waits for response from page context
        const response = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                cleanup();
                reject(new Error('React Fiber thread navigation timeout (5s)'));
            }, 5000);

            const handleResponse = (event) => {
                if (event.detail.requestId === requestId) {
                    cleanup();
                    if (event.detail.success) {
                        resolve(event.detail.data);
                    } else {
                        reject(new Error(event.detail.error || 'Unknown error'));
                    }
                }
            };

            const cleanup = () => {
                clearTimeout(timeout);
                document.removeEventListener('wv-fav-api-response', handleResponse);
            };

            document.addEventListener('wv-fav-api-response', handleResponse);

            // Send request to page context
            document.dispatchEvent(new CustomEvent('wv-fav-api-request', {
                detail: {
                    requestId,
                    action: 'openThreadViaReactFiber',
                    data: {
                        messageId,
                        channelUrl
                    }
                }
            }));
        });

        // response already contains {success, messageId, channelUrl, error}
        if (response.success) {
            this.app?.logger?.info('✅ [EXTENSION CONTEXT] Thread opened via page context React Fiber:', response);
        } else {
            this.app?.logger?.warn('⚠️ [EXTENSION CONTEXT] Thread opening failed via page context:', response.error);
        }

        return response;
    }

    /**
     * Navigate to a mention - find the channel and message where user was mentioned
     * @param {string} channelUrl - The channel URL where the mention occurred
     * @param {string} messageId - The message ID containing the mention
     * @param {boolean} isThreadReply - Whether this mention is a thread reply
     * @param {string} replyMessageId - The reply message ID (if thread reply)
     * @param {number} createdAt - The message creation timestamp (CRITICAL for loading old messages)
     */
    async navigateToMention(channelUrl, messageId, isThreadReply = false, replyMessageId = null, createdAt = null) {
        this.app?.logger?.log('📧 Navigating to mention:', {
            channelUrl,
            messageId,
            isThreadReply,
            replyMessageId,
            createdAt
        });

        try {
            // Track mention navigation
            if (this.app.analytics) {
                this.app.analytics.trackEvent('mention_navigation_started', {
                    has_channel_url: !!channelUrl,
                    has_message_id: !!messageId,
                    is_thread_reply: isThreadReply,
                    has_reply_message_id: !!replyMessageId
                });
            }

            // Use TIER SYSTEM for ALL mention navigation
            // setHighlightedMessage works from any channel, no need to check current channel
            this.app?.logger?.log('🎯 Navigating via tier system (works for any message, any time)');

            // TIER 1: Try WebpackNavigator first (fastest, most reliable, works for ANY message from ANY time)
            if (this.app.webpackNav && this.app.webpackNav.initialized) {
                this.app?.logger?.log('⚡ Trying Webpack Navigator (Tier 1)...');

                try {
                    const result = await this.app.webpackNav.navigateToMessage({
                        message_id: isThreadReply && replyMessageId ? replyMessageId : messageId,
                        channel_url: channelUrl,
                        parent_message_id: isThreadReply ? messageId : null,
                        root_message_id: isThreadReply ? messageId : null,
                        created_at: createdAt  // CRITICAL: Pass timestamp for loading old messages
                    });

                    if (result.success) {
                        this.app?.logger?.log('✅ Navigation completed via WebpackNavigator (Tier 1)!');

                        if (this.app.analytics) {
                            this.app.analytics.trackEvent('mention_navigation_success', {
                                navigation_method: 'webpack_tier1',
                                primary_function: result.primaryFunction
                            });
                        }
                        return;
                    } else {
                        this.app?.logger?.warn('⚠️ WebpackNavigator failed, trying Tier 3:', result.error);
                    }
                } catch (error) {
                    this.app?.logger?.warn('⚠️ WebpackNavigator error, trying Tier 3:', error.message);
                }
            }

            // TIER 3: Try React Fiber instant navigation (fallback for non-threaded or if Webpack fails)
            if (this.app.reactFiberNav) {
                this.app?.logger?.log('🧭 Trying React Fiber instant channel navigation (Tier 3)...');

                try {
                    const result = await this.app.reactFiberNav.openChannelByUrl(channelUrl);

                    if (result.success) {
                        this.app?.logger?.log('✅ Channel opened via React Fiber, waiting for load...');

                        // Wait for channel to load
                        await this.waitForChannelLoad(channelUrl);

                        // Now find and highlight the message
                        // If it's a thread reply, open the thread and scroll to the reply
                        await this.findAndHighlightMessage(messageId, isThreadReply, replyMessageId);

                        if (this.app.analytics) {
                            this.app.analytics.trackEvent('mention_navigation_success', {
                                navigation_method: 'react_fiber_tier3'
                            });
                        }
                        return;
                    } else {
                        this.app?.logger?.warn('⚠️ React Fiber failed, using Tier 4:', result.error);
                    }
                } catch (error) {
                    this.app?.logger?.warn('⚠️ React Fiber error, using Tier 4:', error.message);
                }
            }

            // TIER 4: Traditional channel click method (slowest but most reliable)
            this.app?.logger?.log('📜 Using Tier 4: channel click (fallback)');

            const channelElement = await this.findChannelByUrl(channelUrl);

            if (channelElement) {
                this.app?.logger?.log('✅ Found channel element, clicking...');
                channelElement.click();

                // Wait for channel to load
                await this.waitForChannelLoad(channelUrl);

                // Now find and highlight the message
                // If it's a thread reply, open the thread and scroll to the reply
                await this.findAndHighlightMessage(messageId, isThreadReply, replyMessageId);

                if (this.app.analytics) {
                    this.app.analytics.trackEvent('mention_navigation_success', {
                        navigation_method: 'channel_click'
                    });
                }
            } else {
                this.app?.logger?.warn('⚠️ Could not find channel element, mention may be in a hidden or archived chat');

                // Show notification to user
                this.showMentionNavigationNotice('Channel not found. The mention may be in an archived or hidden chat.');

                if (this.app.analytics) {
                    this.app.analytics.trackEvent('mention_navigation_failed', {
                        reason: 'channel_not_found'
                    });
                }
            }
        } catch (error) {
            this.app?.logger?.error('❌ Error navigating to mention:', error);

            this.showMentionNavigationNotice('Unable to navigate to mention. Please try again.');

            if (this.app.analytics) {
                this.app.analytics.trackEvent('mention_navigation_failed', {
                    reason: 'error',
                    error_message: error.message
                });
            }
        }
    }

    /**
     * Find a channel element in the sidebar by its URL
     * @param {string} channelUrl - The channel URL to find
     * @returns {HTMLElement|null} The channel element or null
     */
    async findChannelByUrl(channelUrl) {
        this.app?.logger?.debug('🔍 Searching for channel in sidebar:', channelUrl);

        // Strategy 1: Find by data-channel-url attribute
        let channelElement = document.querySelector(`[data-channel-url="${channelUrl}"]`);
        if (channelElement) {
            this.app?.logger?.debug('✅ Found channel by data-channel-url');
            return channelElement;
        }

        // Strategy 2: Find by checking href containing channel ID
        const channelId = channelUrl.replace('sendbird_group_channel_', '');
        const links = document.querySelectorAll('[data-testid="channel-list"] a, [data-testid="channel-list"] button');

        for (const link of links) {
            const href = link.getAttribute('href');
            const onClick = link.getAttribute('onclick');

            if (href?.includes(channelId) || onClick?.includes(channelId)) {
                this.app?.logger?.debug('✅ Found channel by href/onclick containing channel ID');
                return link;
            }
        }

        // Strategy 3: Try clicking through channel list items to find match
        // This is a last resort and may not work reliably
        this.app?.logger?.debug('⚠️ Could not find channel element directly');
        return null;
    }

    /**
     * Wait for a channel to finish loading
     * @param {string} expectedChannelUrl - The channel URL we expect to load
     * @param {number} maxWaitMs - Maximum time to wait in milliseconds
     * @returns {Promise<boolean>} True if channel loaded successfully
     */
    async waitForChannelLoad(expectedChannelUrl, maxWaitMs = 5000) {
        this.app?.logger?.debug('⏳ Waiting for channel to load:', expectedChannelUrl);

        const startTime = Date.now();

        return new Promise((resolve) => {
            const checkInterval = setInterval(() => {
                const currentChannel = this.app.threadManager?.getCurrentChannel();

                if (currentChannel === expectedChannelUrl) {
                    this.app?.logger?.debug('✅ Channel loaded successfully');
                    clearInterval(checkInterval);
                    resolve(true);
                }

                // Timeout check
                if (Date.now() - startTime > maxWaitMs) {
                    this.app?.logger?.warn('⏱️ Channel load timeout');
                    clearInterval(checkInterval);
                    resolve(false);
                }
            }, 100);
        });
    }

    /**
     * Find and highlight a message in the current view
     * @param {string} messageId - The message ID to find
     * @param {boolean} openThread - Whether to open the thread if message has replies
     */
    async findAndHighlightMessage(messageId, openThread = false, replyMessageId = null) {
        this.app?.logger?.log('🔍 Finding message to highlight:', {
            messageId,
            openThread,
            replyMessageId
        });

        // OPTIMIZATION: If we need to open a thread, try React Fiber FIRST
        // This works even for old messages that aren't in the DOM
        if (openThread) {
            this.app?.logger?.log('🧵 Thread opening requested - trying React Fiber directly (skip DOM search)');

            const currentChannelUrl = this.app.threadManager?.getCurrentChannel();

            if (currentChannelUrl && this.app.reactFiberNav) {
                try {
                    const result = await this.openThreadViaReactFiber(messageId, currentChannelUrl);

                    if (result.success) {
                        this.app?.logger?.log('✅ Thread opened via React Fiber (fast path)!');

                        // If we have a specific reply to scroll to, wait and then scroll to it
                        if (replyMessageId) {
                            this.app?.logger?.log('📜 Scrolling to reply in thread:', replyMessageId);
                            setTimeout(async () => {
                                await this.scrollToReplyInThread(replyMessageId);
                            }, 1000); // Wait for thread panel to open
                        }

                        return;
                    } else {
                        this.app?.logger?.warn('⚠️ React Fiber fast path failed, trying DOM search:', result.error);
                    }
                } catch (error) {
                    this.app?.logger?.warn('⚠️ React Fiber fast path error, trying DOM search:', error.message);
                }
            } else {
                this.app?.logger?.warn('⚠️ React Fiber not available, trying DOM search');
            }
        }

        // Try to find message in DOM
        const message = await this.findMessageByIdInDOM(messageId);

        if (message) {
            // Scroll to message
            message.scrollIntoView({ behavior: 'smooth', block: 'center' });

            // Highlight with mention-specific color (purple accent)
            const originalBg = message.style.background;
            message.style.background = 'linear-gradient(90deg, rgba(102, 126, 234, 0.15) 0%, rgba(118, 75, 162, 0.15) 100%)';
            message.style.transition = 'background 0.3s';
            message.style.borderLeft = '4px solid #667eea';

            // Reset after delay
            setTimeout(() => {
                message.style.background = originalBg;
                message.style.borderLeft = '';
            }, 3000);

            // Open thread if requested
            if (openThread) {
                this.app?.logger?.log('🧵 Opening thread for parent message:', messageId);

                setTimeout(async () => {
                    try {
                        // Get the message ID from the message element
                        const msgId = message.getAttribute('data-message-id') || messageId;
                        this.app?.logger?.log('🧵 Extracted message ID:', msgId);

                        // PRIMARY: Try React Fiber instant thread opening
                        const currentChannelUrl = this.app.threadManager?.getCurrentChannel();

                        if (currentChannelUrl && this.app.reactFiberNav) {
                            this.app?.logger?.log('🧵 Trying React Fiber instant thread opening for channel:', currentChannelUrl);

                            try {
                                const result = await this.openThreadViaReactFiber(msgId, currentChannelUrl);

                                if (result.success) {
                                    this.app?.logger?.log('✅ Thread opened via React Fiber!');

                                    // If we have a specific reply to scroll to, wait and then scroll to it
                                    if (replyMessageId) {
                                        this.app?.logger?.log('📜 Scrolling to reply in thread:', replyMessageId);
                                        setTimeout(async () => {
                                            await this.scrollToReplyInThread(replyMessageId);
                                        }, 1000); // Wait for thread panel to open
                                    }
                                    return;
                                } else {
                                    this.app?.logger?.warn('⚠️ React Fiber thread opening failed, using fallback:', result.error);
                                }
                            } catch (error) {
                                this.app?.logger?.warn('⚠️ React Fiber error, using fallback:', error.message);
                            }
                        }

                        // FALLBACK: Traditional click method
                        this.app?.logger?.log('📜 Using fallback: click replies button');
                        this.clickThreadRepliesButton(message);

                        // If we have a specific reply to scroll to, wait and then scroll to it
                        if (replyMessageId) {
                            setTimeout(async () => {
                                await this.scrollToReplyInThread(replyMessageId);
                            }, 1000); // Wait for thread panel to open
                        }
                    } catch (error) {
                        this.app?.logger?.error('❌ Error opening thread:', error);
                    }
                }, 500);
            }

            this.app?.logger?.log('✅ Message highlighted successfully');
        } else {
            this.app?.logger?.warn('⚠️ Message not found in DOM, may need to scroll');

            // Try scrolling to find it
            await this.scrollToFindMessage(messageId);

            // After scrolling, try one more time to find and open the thread
            if (openThread) {
                const messageAfterScroll = await this.findMessageByIdInDOM(messageId);
                if (messageAfterScroll) {
                    this.app?.logger?.log('✅ Found message after scrolling, opening thread...');

                    // Scroll to it
                    messageAfterScroll.scrollIntoView({ behavior: 'smooth', block: 'center' });

                    // Highlight it
                    const originalBg = messageAfterScroll.style.background;
                    messageAfterScroll.style.background = 'linear-gradient(90deg, rgba(102, 126, 234, 0.15) 0%, rgba(118, 75, 162, 0.15) 100%)';
                    messageAfterScroll.style.transition = 'background 0.3s';
                    messageAfterScroll.style.borderLeft = '4px solid #667eea';

                    setTimeout(() => {
                        messageAfterScroll.style.background = originalBg;
                        messageAfterScroll.style.borderLeft = '';
                    }, 3000);

                    // Open the thread
                    setTimeout(async () => {
                        try {
                            const msgId = messageAfterScroll.getAttribute('data-message-id') || messageId;
                            const currentChannelUrl = this.app.threadManager?.getCurrentChannel();

                            if (currentChannelUrl && this.app.reactFiberNav) {
                                const result = await this.openThreadViaReactFiber(msgId, currentChannelUrl);

                                if (result.success) {
                                    this.app?.logger?.log('✅ Thread opened via React Fiber after scroll!');

                                    if (replyMessageId) {
                                        setTimeout(async () => {
                                            await this.scrollToReplyInThread(replyMessageId);
                                        }, 1000);
                                    }
                                    return;
                                }
                            }

                            // Fallback: click the button
                            this.clickThreadRepliesButton(messageAfterScroll);

                            if (replyMessageId) {
                                setTimeout(async () => {
                                    await this.scrollToReplyInThread(replyMessageId);
                                }, 1000);
                            }
                        } catch (error) {
                            this.app?.logger?.error('❌ Error opening thread after scroll:', error);
                        }
                    }, 500);
                } else {
                    this.app?.logger?.error('❌ Message still not found after scrolling');
                }
            }
        }
    }

    /**
     * Show a notification for mention navigation issues
     * @param {string} message - The message to display
     */
    showMentionNavigationNotice(message) {
        const notice = document.createElement('div');
        notice.style.cssText = `
            position: fixed;
            bottom: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 16px 24px;
            border-radius: 12px;
            box-shadow: 0 8px 24px rgba(102, 126, 234, 0.3);
            z-index: 10000;
            font-size: 14px;
            font-weight: 500;
            max-width: 400px;
            text-align: center;
            animation: slideUpFade 0.3s ease-out;
        `;

        notice.innerHTML = `
            <div style="display: flex; align-items: center; gap: 12px;">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="16" x2="12" y2="12"/>
                    <line x1="12" y1="8" x2="12.01" y2="8"/>
                </svg>
                <div>${message}</div>
            </div>
        `;

        document.body.appendChild(notice);

        // Add animation
        if (!document.querySelector('#wv-mention-navigation-animations')) {
            const style = document.createElement('style');
            style.id = 'wv-mention-navigation-animations';
            style.textContent = `
                @keyframes slideUpFade {
                    from {
                        transform: translateX(-50%) translateY(20px);
                        opacity: 0;
                    }
                    to {
                        transform: translateX(-50%) translateY(0);
                        opacity: 1;
                    }
                }
            `;
            document.head.appendChild(style);
        }

        // Auto-remove after 4 seconds
        setTimeout(() => {
            notice.style.opacity = '0';
            notice.style.transition = 'opacity 0.3s';
            setTimeout(() => notice.remove(), 300);
        }, 4000);
    }

    async findMessageByIdInDOM(messageId) {
        // WorkVivo messages typically have data attributes or IDs
        // Try multiple selectors

        // Strategy 1: Find by id="message-{messageId}" (most reliable!)
        let message = document.querySelector(`#message-${messageId}`);
        if (message) {
            this.app?.logger?.debug('✅ Found message by id attribute');
            return message;
        }

        // Strategy 2: Find by data-message-id
        message = document.querySelector(`[data-message-id="${messageId}"]`);
        if (message) {
            this.app?.logger?.debug('✅ Found message by data-message-id');
            return message;
        }

        // Strategy 3: Find by message container and check text content
        // Get the message text from ThreadManager cache
        const channelUrl = this.app.threadManager.getCurrentChannel();
        const messageCache = this.app.threadManager.getMessageCache(channelUrl);
        const messageData = messageCache?.get(messageId);

        if (messageData && messageData.message) {
            // Find all message containers
            const messageContainers = document.querySelectorAll('[data-testid="message-container"]');

            for (const container of messageContainers) {
                const textContent = container.textContent;
                // Match first 50 chars of message
                if (messageData.message && textContent.includes(messageData.message.substring(0, 50))) {
                    this.app?.logger?.debug('✅ Found message by text content matching');
                    return container;
                }
            }
        }

        // Strategy 3: Find by timestamp (created_at)
        if (messageData && messageData.created_at) {
            const messageContainers = document.querySelectorAll('[data-testid="message-container"]');

            for (const container of messageContainers) {
                const timeElement = container.querySelector('[data-testid="message-timestamp"], time');
                if (timeElement) {
                    const timestamp = parseInt(timeElement.getAttribute('data-timestamp') || timeElement.dateTime);
                    if (Math.abs(timestamp - messageData.created_at) < 1000) { // Within 1 second
                        this.app?.logger?.debug('✅ Found message by timestamp matching');
                        return container;
                    }
                }
            }
        }

        this.app?.logger?.warn('❌ Message not found in current view');
        return null;
    }

    async scrollToFindMessage(messageId) {
        this.app?.logger?.log('🔍 Scrolling to find message:', messageId);

        // Get message data to know if we should scroll up or down
        const channelUrl = this.app.threadManager.getCurrentChannel();
        const messageCache = this.app.threadManager.getMessageCache(channelUrl);
        const messageData = messageCache?.get(messageId);

        if (!messageData) {
            console.warn('⚠️ Message not found in cache!');
            this.showScrollNotification('Unable to locate this thread. It may not be loaded yet.', 'error');
            return;
        }

        // Find the message list scroll container
        const messageList = document.querySelector('[data-testid="message-list"]') ||
                          document.querySelector('[class*="message"][class*="list"]') ||
                          document.querySelector('[class*="chat"][class*="content"]');

        if (!messageList) {
            this.showScrollNotification('Unable to find message list container.', 'error');
            return;
        }

        const targetTimestamp = messageData.created_at;
        const targetDate = new Date(targetTimestamp).toLocaleString();

        this.app?.logger?.log(`🎯 Target message timestamp: ${targetDate}`);

        // Get current date range of loaded messages
        const dateRange = this.getLoadedMessageDateRange(messageList);

        if (dateRange) {
            this.app?.logger?.log(`📅 Currently loaded: ${dateRange.oldestDate} to ${dateRange.newestDate}`);

            // Determine scroll direction
            if (targetTimestamp < dateRange.oldestTimestamp) {
                this.app?.logger?.log('⬆️ Target is older than loaded messages, scrolling up...');
                await this.scrollProgressivelyToFind(messageList, messageId, 'up', targetDate);
            } else if (targetTimestamp > dateRange.newestTimestamp) {
                this.app?.logger?.log('⬇️ Target is newer than loaded messages, scrolling down...');
                await this.scrollProgressivelyToFind(messageList, messageId, 'down', targetDate);
            } else {
                this.app?.logger?.log('🔍 Target should be in loaded range, searching thoroughly...');
                await this.scrollProgressivelyToFind(messageList, messageId, 'up', targetDate);
            }
        } else {
            // Fallback: scroll to top
            this.app?.logger?.log('⚠️ Unable to determine date range, scrolling to top...');
            await this.scrollProgressivelyToFind(messageList, messageId, 'up', targetDate);
        }
    }

    getLoadedMessageDateRange(messageList) {
        const messageContainers = messageList.querySelectorAll('[data-testid="message-container"]');

        if (messageContainers.length === 0) {
            return null;
        }

        const channelUrl = this.app.threadManager.getCurrentChannel();
        const messageCache = this.app.threadManager.getMessageCache(channelUrl);

        if (!messageCache) {
            return null;
        }

        let oldestTimestamp = Infinity;
        let newestTimestamp = 0;

        // Try to find timestamps from message cache by matching text content
        for (const container of messageContainers) {
            const messageText = container.textContent;

            for (const [msgId, msg] of messageCache) {
                if (msg.message && messageText.includes(msg.message.substring(0, 30))) {
                    if (msg.created_at < oldestTimestamp) {
                        oldestTimestamp = msg.created_at;
                    }
                    if (msg.created_at > newestTimestamp) {
                        newestTimestamp = msg.created_at;
                    }
                    break; // Found this message, move to next container
                }
            }
        }

        if (oldestTimestamp === Infinity) {
            return null;
        }

        return {
            oldestTimestamp,
            newestTimestamp,
            oldestDate: new Date(oldestTimestamp).toLocaleString(),
            newestDate: new Date(newestTimestamp).toLocaleString()
        };
    }

    async scrollProgressivelyToFind(messageList, messageId, direction, targetDate) {
        const maxAttempts = 20;
        let attempts = 0;

        const notificationId = this.showScrollNotification(
            `Searching for message from ${targetDate}...`,
            'info',
            0 // Don't auto-hide
        );

        while (attempts < maxAttempts) {
            attempts++;

            // Update notification with progress
            this.updateScrollNotification(notificationId,
                `Searching... (attempt ${attempts}/${maxAttempts})`,
                'info'
            );

            // Check if message is now visible
            const message = await this.findMessageByIdInDOM(messageId);
            if (message) {
                this.updateScrollNotification(notificationId, 'Thread found!', 'success');
                setTimeout(() => this.hideScrollNotification(notificationId), 1500);

                // Scroll to message
                message.scrollIntoView({ behavior: 'smooth', block: 'center' });

                // Highlight briefly
                const originalBg = message.style.background;
                message.style.background = '#fef3c7';
                message.style.transition = 'background 0.3s';
                setTimeout(() => {
                    message.style.background = originalBg;
                }, 2000);

                // Click replies button
                setTimeout(() => {
                    this.clickThreadRepliesButton(message);
                }, 500);

                return;
            }

            // Scroll in the appropriate direction
            if (direction === 'up') {
                messageList.scrollTop = Math.max(0, messageList.scrollTop - 300);

                // If we're already at the top, can't scroll more
                if (messageList.scrollTop === 0) {
                    this.app?.logger?.log('📜 Reached the top of messages');
                }
            } else {
                messageList.scrollTop = Math.min(
                    messageList.scrollHeight,
                    messageList.scrollTop + 300
                );

                // If we're at the bottom, can't scroll more
                if (messageList.scrollTop + messageList.clientHeight >= messageList.scrollHeight) {
                    this.app?.logger?.log('📜 Reached the bottom of messages');
                }
            }

            // Wait for messages to load
            await new Promise(resolve => setTimeout(resolve, 800));

            // Check date range after scroll
            const dateRange = this.getLoadedMessageDateRange(messageList);
            if (dateRange) {
                this.app?.logger?.log(`📅 Now loaded: ${dateRange.oldestDate} to ${dateRange.newestDate}`);
            }
        }

        // Max attempts reached
        this.updateScrollNotification(
            notificationId,
            'Thread not found after extensive search. It may be very old or deleted.',
            'error'
        );
        setTimeout(() => this.hideScrollNotification(notificationId), 5000);
    }

    showScrollNotification(message, type = 'info', duration = 3000) {
        const id = `scroll-notif-${Date.now()}`;
        const notification = document.createElement('div');
        notification.id = id;
        notification.className = 'wv-scroll-notification';
        notification.style.cssText = `
            position: fixed;
            bottom: 80px;
            right: 20px;
            background: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#3b82f6'};
            color: white;
            padding: 12px 20px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            z-index: 10002;
            font-size: 14px;
            max-width: 300px;
            animation: slideUp 0.3s ease-out;
        `;
        notification.textContent = message;

        document.body.appendChild(notification);

        if (duration > 0) {
            setTimeout(() => this.hideScrollNotification(id), duration);
        }

        return id;
    }

    updateScrollNotification(id, message, type = 'info') {
        const notification = document.getElementById(id);
        if (notification) {
            notification.textContent = message;
            notification.style.background = type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#3b82f6';
        }
    }

    hideScrollNotification(id) {
        const notification = document.getElementById(id);
        if (notification) {
            notification.style.opacity = '0';
            notification.style.transition = 'opacity 0.3s';
            setTimeout(() => notification.remove(), 300);
        }
    }

    clickThreadRepliesButton(messageContainer) {
        // Find the "replies" button in the message
        // WorkVivo typically shows reply count as a button near the message

        this.app?.logger?.debug('🔍 Searching for replies button in message container');

        // Strategy 1: Look for aria-label with "Replies" or "reply"
        let repliesButton = messageContainer.querySelector('[aria-label*="Replies"], [aria-label*="replies"], [aria-label*="Reply"], [aria-label*="reply"]');

        if (repliesButton) {
            this.app?.logger?.log('✅ Found replies button by aria-label, clicking');
            repliesButton.click();

            // After clicking, wait a bit for thread to open, then refresh badge
            setTimeout(() => {
                this.refreshThreadButtonAfterOpen();
            }, 1500);

            return;
        }

        // Strategy 2: Look for button with specific class patterns
        repliesButton = messageContainer.querySelector('button[class*="thread"], button[class*="reply"]');

        if (repliesButton) {
            this.app?.logger?.log('✅ Found replies button by class name, clicking');
            repliesButton.click();
            setTimeout(() => this.refreshThreadButtonAfterOpen(), 1500);
            return;
        }

        // Strategy 3: Find by text content containing a number (reply count)
        const allButtons = messageContainer.querySelectorAll('button');
        for (const button of allButtons) {
            const text = button.textContent.trim();

            // Check if button text has a number (like "5" or "5 replies")
            if (/^\d+/.test(text)) {
                // Also check if it has an SVG icon (thread icon)
                const hasSvg = button.querySelector('svg');
                if (hasSvg) {
                    this.app?.logger?.log('✅ Found button with number and SVG, clicking');
                    button.click();
                    setTimeout(() => this.refreshThreadButtonAfterOpen(), 1500);
                    return;
                }
            }
        }

        // Strategy 4: Find by data-testid
        repliesButton = messageContainer.querySelector('[data-testid*="thread"], [data-testid*="reply"]');

        if (repliesButton) {
            this.app?.logger?.log('✅ Found replies button by data-testid, clicking');
            repliesButton.click();
            setTimeout(() => this.refreshThreadButtonAfterOpen(), 1500);
            return;
        }

        // Strategy 5: Look for any button near bottom of message (replies are usually there)
        const messageActions = messageContainer.querySelector('[class*="action"], [class*="footer"], [class*="bottom"]');
        if (messageActions) {
            const buttonsInActions = messageActions.querySelectorAll('button');
            for (const button of buttonsInActions) {
                if (button.textContent.match(/\d+/)) {
                    this.app?.logger?.log('✅ Found button in actions area with number, clicking');
                    button.click();
                    setTimeout(() => this.refreshThreadButtonAfterOpen(), 1500);
                    return;
                }
            }
        }

        // If still not found, log debug info
        this.app?.logger?.warn('❌ No replies button found after all strategies');
        this.app?.logger?.debug('Message container HTML:', messageContainer.innerHTML.substring(0, 500));
        this.app?.logger?.debug('All buttons found:', Array.from(allButtons).map(b => ({
            text: b.textContent.trim(),
            classes: b.className,
            ariaLabel: b.getAttribute('aria-label')
        })));

        // Show helpful message instead of alert
        this.showThreadNotFoundNotice();
    }

    /**
     * Scroll to and highlight a specific reply within an open thread panel
     * @param {string} replyMessageId - The reply message ID to scroll to
     */
    async scrollToReplyInThread(replyMessageId) {
        try {
            this.app?.logger?.log('📜 Scrolling to reply in thread:', replyMessageId);

            // Find the thread panel - it's usually on the right side
            const threadPanel = document.querySelector('[data-testid="thread-panel"], [class*="thread-panel"], [class*="ThreadPanel"]');

            if (!threadPanel) {
                this.app?.logger?.warn('⚠️ Thread panel not found');
                return;
            }

            this.app?.logger?.log('✅ Found thread panel, searching for reply...');

            // Find the specific reply message within the thread
            const replyMessage = threadPanel.querySelector(`[data-message-id="${replyMessageId}"]`);

            if (replyMessage) {
                this.app?.logger?.log('✅ Found reply message, scrolling and highlighting');

                // Scroll to the reply
                replyMessage.scrollIntoView({ behavior: 'smooth', block: 'center' });

                // Highlight the reply with mention-specific color
                const originalBg = replyMessage.style.background;
                replyMessage.style.background = 'linear-gradient(90deg, rgba(102, 126, 234, 0.15) 0%, rgba(118, 75, 162, 0.15) 100%)';
                replyMessage.style.transition = 'background 0.3s';
                replyMessage.style.borderLeft = '4px solid #667eea';

                // Reset after delay
                setTimeout(() => {
                    replyMessage.style.background = originalBg;
                    replyMessage.style.borderLeft = '';
                }, 3000);
            } else {
                this.app?.logger?.warn('⚠️ Reply message not found in thread panel');
                // The reply might not be loaded yet, try scrolling to load more
                const scrollContainer = threadPanel.querySelector('[class*="scroll"], [class*="message-list"]');
                if (scrollContainer) {
                    this.app?.logger?.log('📜 Scrolling thread panel to load more replies...');
                    scrollContainer.scrollTop = scrollContainer.scrollHeight;

                    // Wait and try again
                    setTimeout(async () => {
                        const retryReply = threadPanel.querySelector(`[data-message-id="${replyMessageId}"]`);
                        if (retryReply) {
                            retryReply.scrollIntoView({ behavior: 'smooth', block: 'center' });

                            const originalBg = retryReply.style.background;
                            retryReply.style.background = 'linear-gradient(90deg, rgba(102, 126, 234, 0.15) 0%, rgba(118, 75, 162, 0.15) 100%)';
                            retryReply.style.transition = 'background 0.3s';
                            retryReply.style.borderLeft = '4px solid #667eea';

                            setTimeout(() => {
                                retryReply.style.background = originalBg;
                                retryReply.style.borderLeft = '';
                            }, 3000);
                        } else {
                            this.app?.logger?.warn('⚠️ Reply still not found after scrolling');
                        }
                    }, 1000);
                }
            }
        } catch (error) {
            this.app?.logger?.error('❌ Error scrolling to reply in thread:', error);
        }
    }

    showThreadNotFoundNotice() {
        // Create a subtle notification instead of alert
        const notice = document.createElement('div');
        notice.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: #1f2937;
            color: white;
            padding: 12px 16px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            z-index: 10001;
            font-size: 14px;
            max-width: 300px;
            animation: slideUp 0.3s ease-out;
        `;
        notice.textContent = 'Thread found! Click the replies button below the message to open.';

        document.body.appendChild(notice);

        setTimeout(() => {
            notice.style.opacity = '0';
            notice.style.transition = 'opacity 0.3s';
            setTimeout(() => notice.remove(), 300);
        }, 4000);
    }

    refreshThreadButtonAfterOpen() {
        // Refresh ThreadManager to recalculate unread count
        if (this.app.threadManager) {
            this.app.threadManager.refreshCurrentChannel();
        }

        // Find and refresh the thread button in header
        const messageSection = document.querySelector('[data-testid="message-section"]');
        if (messageSection) {
            const chatHeader = messageSection.querySelector('.tw-p-4.tw-border-b.tw-border-slate-200.tw-rounded-t-lg.tw-absolute.tw-top-0');
            if (chatHeader) {
                this.refreshThreadButton(chatHeader);
                this.app?.logger?.debug('🔄 Refreshed thread button badge after opening thread');
            }
        }
    }

    removePinUIFromHeader(avatarContainer) {
        const existingOverlay = avatarContainer.querySelector('.wv-favorites-header-overlay');
        const existingIndicator = avatarContainer.querySelector('.wv-favorites-header-pin-indicator');

        if (existingOverlay) {
            const pinButton = existingOverlay.querySelector('.wv-favorites-header-pin-btn');
            if (pinButton) {
                pinButton.replaceWith(pinButton.cloneNode(true));
            }
            existingOverlay.remove();
        }
        if (existingIndicator) existingIndicator.remove();

        avatarContainer.removeAttribute('data-chat-id');

        this.app?.logger?.log('🧹 Cleaned up existing pin UI from header');
    }

    async refreshChatHeader(chatHeader) {
        setTimeout(async () => {
            this.app?.logger?.log('🔄 Refreshing chat header pin button...');

            const avatarContainer = chatHeader.querySelector('.tw-w-8.tw-h-8.tw-mr-3');
            if (avatarContainer) {
                this.removePinUIFromHeader(avatarContainer);
            }

            await new Promise(resolve => setTimeout(resolve, 50));

            await this.app.setupPinButtonWithStateVerification(chatHeader);
        }, 100);
    }

    addPinIndicatorToHeaderAvatar(avatarContainer) {
        if (avatarContainer.querySelector('.wv-favorites-header-pin-indicator')) {
            this.app?.logger?.log('📌 Pin indicator already exists on chat header avatar');
            return;
        }

        this.app?.logger?.log('📌 Adding pin indicator to chat header avatar');
        const indicator = document.createElement('div');
        indicator.className = 'wv-favorites-header-pin-indicator';
        indicator.innerHTML = `
            <svg width="8" height="8" viewBox="0 0 14 14" fill="white">
                <path d="M8.5 1.5L6.5 3.5L4.5 3L3 4.5L5.5 7L1.5 11L2.5 12L6.5 8L9 10.5L10.5 9L10 7L12 5L8.5 1.5Z"/>
            </svg>
        `;

        avatarContainer.appendChild(indicator);
        // Only log successful pin indicator additions in debug mode
        if (this.app.settings?.get('debugLogging')) {
            this.app?.logger?.debug('✅ Pin indicator added to chat header avatar successfully');
        }

        // Initialize debug functions on first run
        this.initializeDebugFunctions();
    }

    // Name-based matching function with 99% similarity threshold
    findBestNameMatch(headerName, pinnedChats) {
        if (!headerName || !pinnedChats || pinnedChats.length === 0) {
            return null;
        }

        const cleanHeaderName = this.cleanNameForMatching(headerName);
        let bestMatch = null;
        let bestSimilarity = 0;

        for (const pinnedChat of pinnedChats) {
            // Try matching against different name fields
            const namesToCheck = [
                pinnedChat.name,
                pinnedChat.username,
                pinnedChat.channelName,
                pinnedChat.displayName
            ].filter(Boolean);

            for (const nameToCheck of namesToCheck) {
                const cleanPinnedName = this.cleanNameForMatching(nameToCheck);

                // Calculate similarity
                const similarity = this.calculateNameSimilarity(cleanHeaderName, cleanPinnedName);

                // Only log detailed comparisons in debug mode to reduce spam
                if (this.app.settings?.get('debugLogging')) {
                    this.app?.logger?.debug(`🔍 Comparing "${cleanHeaderName}" vs "${cleanPinnedName}": ${(similarity * 100).toFixed(1)}%`);
                }

                // 99% similarity threshold
                if (similarity >= 0.99 && similarity > bestSimilarity) {
                    bestMatch = {
                        record: pinnedChat,
                        similarity: similarity,
                        matchType: nameToCheck === pinnedChat.name ? 'name' : 'alt-name'
                    };
                    bestSimilarity = similarity;
                }

                // Perfect match - return immediately
                if (similarity === 1.0) {
                    if (this.app.settings?.get('debugLogging')) {
                        this.app?.logger?.debug('✅ Perfect name match found!');
                    }
                    return bestMatch;
                }
            }
        }

        return bestMatch;
    }

    // Clean names for consistent matching
    cleanNameForMatching(name) {
        if (!name) return '';

        return name
            .toLowerCase()
            .trim()
            .replace(/\s+/g, ' ')           // Normalize whitespace
            .replace(/[^\w\s-]/g, '')       // Remove special chars except dash
            .replace(/\s*-\s*$/, '')        // Remove trailing dash
            .replace(/^\s*-\s*/, '');       // Remove leading dash
    }

    // Calculate name similarity using Levenshtein distance
    calculateNameSimilarity(str1, str2) {
        if (str1 === str2) return 1.0;
        if (!str1 || !str2) return 0.0;

        const longer = str1.length > str2.length ? str1 : str2;
        const shorter = str1.length > str2.length ? str2 : str1;

        if (longer.length === 0) return 1.0;

        const distance = this.levenshteinDistance(longer, shorter);
        return (longer.length - distance) / longer.length;
    }

    // Levenshtein distance calculation
    levenshteinDistance(str1, str2) {
        const matrix = [];

        for (let i = 0; i <= str2.length; i++) {
            matrix[i] = [i];
        }

        for (let j = 0; j <= str1.length; j++) {
            matrix[0][j] = j;
        }

        for (let i = 1; i <= str2.length; i++) {
            for (let j = 1; j <= str1.length; j++) {
                if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1, // substitution
                        matrix[i][j - 1] + 1,     // insertion
                        matrix[i - 1][j] + 1      // deletion
                    );
                }
            }
        }

        return matrix[str2.length][str1.length];
    }

    // Initialize debug functions (called once)
    initializeDebugFunctions() {
        if (!window.wvTestPinBadge) {
            const self = this;
            window.wvTestPinBadge = async () => {
                const chatHeader = document.querySelector('[data-testid="message-section"]')?.querySelector('.tw-p-4.tw-border-b.tw-border-slate-200.tw-rounded-t-lg.tw-absolute.tw-top-0');
                if (chatHeader) {
                    this.app?.logger?.debug('🧪 Testing pin badge on current chat header...');
                    await self.addAvatarHoverPinToChatHeader(chatHeader);
                } else {
                    this.app?.logger?.debug('❌ No chat header found for testing');
                }
            };

            window.wvDebugPinStatus = async () => {
                this.app?.logger?.debug('🔍 Debug: Checking current chat pin status with name-based matching...');
                const chatHeader = document.querySelector('[data-testid="message-section"]')?.querySelector('.tw-p-4.tw-border-b.tw-border-slate-200.tw-rounded-t-lg.tw-absolute.tw-top-0');
                if (chatHeader) {
                    const chatInfo = WVFavs.DomDataExtractor.extractChatInfo(chatHeader);
                    this.app?.logger?.debug('📋 Extracted chat info:', chatInfo);

                    const pinnedChats = await self.app.smartUserDB.getPinnedChats();
                    this.app?.logger?.log('📌 All pinned chats:', pinnedChats.map(c => ({name: c.name, id: c.id})));

                    this.app?.logger?.debug('🧠 Testing name-based matching...');
                    const bestMatch = self.findBestNameMatch(chatInfo.name, pinnedChats);

                    if (bestMatch) {
                        this.app?.logger?.debug('✅ Name-based match found:', {
                            headerName: chatInfo.name,
                            matchedName: bestMatch.record.name,
                            similarity: `${(bestMatch.similarity * 100).toFixed(1)}%`,
                            matchType: bestMatch.matchType,
                            isPinned: true
                        });
                    } else {
                        this.app?.logger?.debug('❌ No name-based match found for:', chatInfo.name);
                    }
                } else {
                    this.app?.logger?.debug('❌ No chat header found');
                }
            };

            this.app?.logger?.debug('🧪 Added debug functions:');
            this.app?.logger?.debug('  - window.wvTestPinBadge() - Test pin badge on current chat');
            this.app?.logger?.debug('  - window.wvDebugPinStatus() - Debug pin status detection');
        }
    }

    async refreshAllAvatarOverlays() {
        await new Promise(resolve => {
            setTimeout(async () => {
                try {
                    const messageSection = document.querySelector('[data-testid="message-section"]');
                    if (messageSection) {
                        const chatHeader = messageSection.querySelector('.tw-p-4.tw-border-b.tw-border-slate-200.tw-rounded-t-lg.tw-absolute.tw-top-0');
                        if (chatHeader) {
                            const existingOverlay = chatHeader.querySelector('.wv-favorites-header-overlay');
                            const existingIndicator = chatHeader.querySelector('.wv-favorites-header-pin-indicator');

                            if (existingOverlay) existingOverlay.remove();
                            if (existingIndicator) existingIndicator.remove();

                            await this.addAvatarHoverPinToChatHeader(chatHeader);
                        }
                    }
                } catch (error) {
                    this.app?.logger?.error('Error refreshing avatar overlays:', error);
                }
                resolve();
            }, 100);
        });
    }

    getCurrentActiveChatId() {
        const activeButton = document.querySelector('button.tw-bg-primary-50.tw-text-primary-600');
        if (activeButton) {
            return WVFavs.DomDataExtractor.generateChatId(activeButton);
        }
        return null;
    }

    determineNavigationMethod(chatData) {
        if (chatData.isNewlyCreated) return 'new_chat_creation';
        if (chatData.navigation) return 'direct_navigation';

        // Ensure chatData.id is a string before calling string methods
        const idStr = chatData.id ? String(chatData.id) : '';
        if (idStr && idStr.includes('sendbird')) return 'channel_id_lookup';
        if (idStr && idStr.startsWith('name_')) return 'name_based_fallback';

        return 'unknown_method';
    }

    trackNavigationSuccess(source, method, chatData) {
        if (this.app.logger) {
            this.app?.logger?.analytics('chat_navigation_success', {
                source: source,
                method: method,
                chat_type: chatData.isNewlyCreated ? 'new_chat' : 'existing_chat',
                has_id: !!chatData.id,
                timestamp: Date.now()
            });
        }
    }

    trackNavigationFailure(source, chatData, reason = 'unknown') {
        if (this.app.logger) {
            this.app?.logger?.analytics('chat_navigation_failure', {
                source: source,
                reason: reason,
                chat_type: chatData.isNewlyCreated ? 'new_chat' : 'existing_chat',
                has_id: !!chatData.id,
                has_navigation: !!chatData.navigation,
                timestamp: Date.now()
            });
        }
    }

    async navigateToChat(chatData, source = 'unknown') {
        if (this.app.logger) {
            this.app?.logger?.log('🚀 Navigating to chat', {
                name: chatData.name,
                id: chatData.id,
                channel_url: chatData.channel_url,
                userId: chatData.userId,
                hasNavigation: !!chatData.navigation,
                navigation: chatData.navigation,
                isNewlyCreated: !!chatData.isNewlyCreated,
                source: source
            });
        }

        // Analytics disabled per user request
        // Chat navigation tracking removed

        // Legacy tracking for backwards compatibility
        if (this.app.statsManager) {
            this.app.statsManager.recordChatClick();
        }

        // PRE-FETCH: Try to get channel_url if missing (before navigation attempts)
        if (!chatData.channel_url && chatData.userId && this.app.smartUserDB) {
            if (this.app.logger) {
                this.app?.logger?.log('🔄 No channel_url found, attempting on-demand fetch for userId:', chatData.userId);
            }

            try {
                const fetchedChannelUrl = await this.app.smartUserDB.ensureChannelUrl(chatData);
                if (fetchedChannelUrl) {
                    chatData.channel_url = fetchedChannelUrl;
                    if (this.app.logger) {
                        this.app?.logger?.log('✅ Successfully fetched channel_url:', fetchedChannelUrl);
                    }
                } else {
                    if (this.app.logger) {
                        this.app?.logger?.debug('⚠️ Could not fetch channel_url, will use fallback navigation');
                    }
                }
            } catch (error) {
                if (this.app.logger) {
                    this.app?.logger?.warn('⚠️ Error fetching channel_url, will use fallback navigation:', error);
                }
            }
        }

        // NEW: Try React Fiber navigation FIRST (PRIMARY METHOD)
        // Only if we have a channel_url and ReactFiberNavigator is available
        if (this.app.logger) {
            this.app?.logger?.debug('🔍 React Fiber check:', {
                hasChannelUrl: !!chatData.channel_url,
                channelUrl: chatData.channel_url,
                hasReactFiberNav: !!this.app.reactFiberNav,
                willTryReactFiber: !!(chatData.channel_url && this.app.reactFiberNav)
            });
        }

        if (chatData.channel_url && this.app.reactFiberNav) {
            if (this.app.logger) {
                this.app?.logger?.debug('🧭 Trying React Fiber navigation (PRIMARY)', {
                    channelUrl: chatData.channel_url,
                    source: source
                });
            }

            const result = await this.app.reactFiberNav.openChannelByUrl(chatData.channel_url);

            if (this.app.logger) {
                this.app?.logger?.debug('🧭 React Fiber result:', result);
            }

            if (result.success) {
                this.trackNavigationSuccess(source, 'react_fiber', chatData);
                setTimeout(() => {
                    this.detectCurrentChat();
                }, 1000);
                return;
            } else {
                // React Fiber failed, will fallback to SECONDARY methods
                if (this.app.logger) {
                    this.app?.logger?.warn('⚠️ React Fiber navigation failed, using fallback', {
                        reason: result.error,
                        shouldFallback: result.shouldFallback,
                        fullResult: result
                    });
                }
            }
        } else {
            if (this.app.logger) {
                this.app?.logger?.debug('⏭️ Skipping React Fiber navigation', {
                    reason: !chatData.channel_url ? 'no channel_url' : 'ReactFiberNav not available'
                });
            }
        }

        // SECONDARY METHODS (existing fallback logic)

        if (chatData.isNewlyCreated) {
            if (this.app.logger) {
                this.app?.logger?.debug('Detected newly created chat, using gentle navigation');
            }
            if (await this.navigateToNewChat(chatData)) {
                this.trackNavigationSuccess(source, 'new_chat_creation', chatData);
                setTimeout(() => {
                    this.detectCurrentChat();
                }, 1000);
                return;
            }
            if (this.app.logger) {
                this.app?.logger?.debug('Gentle navigation failed, falling back to standard method');
            }
        }

        // Try direct navigation if we have navigation data
        if (chatData.navigation && await this.tryDirectNavigation(chatData.navigation)) {
            this.trackNavigationSuccess(source, 'direct_navigation', chatData);
            setTimeout(() => {
                this.detectCurrentChat();
            }, 1000);
            return;
        }

        // Try to find the chat element using the chat ID (which might be channel_url)
        if (this.app.logger) {
            this.app?.logger?.debug('Trying to find chat by ID', { id: chatData.id });
        }
        if (chatData.id && await this.findChatByChannelUrl(chatData.id)) {
            this.trackNavigationSuccess(source, 'channel_id_lookup', chatData);
            setTimeout(() => {
                this.detectCurrentChat();
            }, 1000);
            return;
        }
        this.app?.logger?.debug('❌ Could not find chat by ID, trying fallback methods');

        // Fall back to name-based search with scrolling
        if (this.app.logger) {
            this.app?.logger?.debug('Falling back to name-based search', { name: chatData.name });
        }
        if (await this.findAndClickChatWithScrolling(chatData.name)) {
            this.trackNavigationSuccess(source, 'name_based_search', chatData);
            setTimeout(() => {
                this.detectCurrentChat();
            }, 1000);
            return;
        }

        // Final fallback to search modal
        if (this.app.logger) {
            this.app?.logger?.debug('All navigation methods failed, opening search modal');
        }
        this.trackNavigationFailure(source, chatData, 'all_methods_failed');
        this.fallbackToSearch(chatData.name);
    }

    async navigateToNewChat(chatData) {
        this.app?.logger?.log('🆕 Starting gentle navigation for new chat:', chatData.name);
        await new Promise(resolve => setTimeout(resolve, 800));
        const found = await this.findChatInVisibleArea(chatData.name);
        if (found) {
            this.app?.logger?.log('✅ Found new chat in visible area');
            return true;
        }
        await new Promise(resolve => setTimeout(resolve, 500));
        const foundAfterWait = await this.findChatInVisibleArea(chatData.name);
        if (foundAfterWait) {
            this.app?.logger?.log('✅ Found new chat after additional wait');
            return true;
        }
        this.app?.logger?.log('❌ New chat not found in visible area, will fall back to standard navigation');
        return false;
    }

    async findChatInVisibleArea(chatName) {
        this.app?.logger?.log('🔍 Searching for chat in visible area:', chatName);
        const elements = document.querySelectorAll('[data-testid="channel-list"] button.tw-block.tw-w-full.tw-p-2.tw-rounded-lg');
        const targetName = chatName.toLowerCase().trim();
        const validElements = Array.from(elements).filter(element => !element.closest('.wv-favorites-pinned-section'));
        this.app?.logger?.log('🔍 Found', validElements.length, 'chat elements to check');
        for (const element of validElements) {
            const elementText = element.textContent.toLowerCase().trim();
            this.app?.logger?.log('🔍 Checking element:', elementText);
            if (elementText === targetName) {
                this.app?.logger?.log('✅ Found exact match!');
                element.click();
                return true;
            }
        }
        const cleanedTargetName = WVFavs.Helpers.cleanChatName(chatName).toLowerCase().trim();
        this.app?.logger?.log('🔍 Trying with cleaned target name:', cleanedTargetName);
        for (const element of validElements) {
            const elementText = element.textContent.trim();
            const cleanedElementText = WVFavs.Helpers.cleanChatName(elementText).toLowerCase().trim();
            if (cleanedElementText === cleanedTargetName) {
                this.app?.logger?.log('✅ Found cleaned name match!');
                element.click();
                return true;
            }
        }
        const targetFirstLine = targetName.split('\n')[0];
        for (const element of validElements) {
            const elementFirstLine = element.textContent.toLowerCase().trim().split('\n')[0];
            if (elementFirstLine === targetFirstLine) {
                this.app?.logger?.log('✅ Found first line match!');
                element.click();
                return true;
            }
        }
        return false;
    }

    async findAndClickChat(chatName) {
        const elements = document.querySelectorAll('[data-testid="channel-list"] button.tw-block.tw-w-full.tw-p-2.tw-rounded-lg');
        const targetName = chatName.toLowerCase().trim();
        const validElements = Array.from(elements).filter(element => !element.closest('.wv-favorites-pinned-section'));
        for (const element of validElements) {
            const elementText = element.textContent.toLowerCase().trim();
            if (elementText === targetName) {
                element.click();
                return true;
            }
        }
        const cleanedTargetName = WVFavs.Helpers.cleanChatName(chatName).toLowerCase().trim();
        for (const element of validElements) {
            const elementText = element.textContent.trim();
            const cleanedElementText = WVFavs.Helpers.cleanChatName(elementText).toLowerCase().trim();
            if (cleanedElementText === cleanedTargetName) {
                element.click();
                return true;
            }
        }
        const targetFirstLine = targetName.split('\n')[0];
        for (const element of validElements) {
            const elementFirstLine = element.textContent.toLowerCase().trim().split('\n')[0];
            if (elementFirstLine === targetFirstLine) {
                element.click();
                return true;
            }
        }
        if (targetName.length >= 5) {
            for (const element of validElements) {
                const elementText = element.textContent.toLowerCase().trim();
                if (elementText.includes(targetName)) {
                    element.click();
                    return true;
                }
            }
        }
        return false;
    }

    async findAndClickChatWithScrolling(chatName) {
        // First try to find exact matches in currently loaded content
        const exactMatch = await this.findExactMatch(chatName);
        if (exactMatch) {
            return true;
        }

        // Track elements we've already seen to identify newly loaded content
        const seenElements = new Set();
        this.trackExistingElements(seenElements);

        const maxRetries = 10;
        let retryCount = 0;

        while (retryCount < maxRetries) {
            await this.scrollSidebarToLoadMore();
            await new Promise(resolve => setTimeout(resolve, 500)); // Wait for content to load

            // First check for exact matches in newly loaded content
            const newExactMatch = await this.findExactMatchInNewContent(chatName, seenElements);
            if (newExactMatch) {
                return true;
            }

            // Update our tracking of seen elements
            this.trackExistingElements(seenElements);

            retryCount++;
        }

        // As a last resort, try partial matching but only for longer names to avoid false positives
        if (chatName.length >= 8) {
            return await this.findAndClickChat(chatName);
        }

        return false;
    }

    trackExistingElements(seenElements) {
        const elements = document.querySelectorAll('[data-testid="channel-list"] button.tw-block.tw-w-full.tw-p-2.tw-rounded-lg');
        elements.forEach(element => {
            if (!element.closest('.wv-favorites-pinned-section')) {
                // Use element text and position as unique identifier
                const identifier = element.textContent.trim() + '_' + element.offsetTop;
                seenElements.add(identifier);
            }
        });
    }

    async findExactMatch(chatName) {
        const elements = document.querySelectorAll('[data-testid="channel-list"] button.tw-block.tw-w-full.tw-p-2.tw-rounded-lg');
        const targetName = chatName.toLowerCase().trim();

        const validElements = Array.from(elements).filter(element =>
            !element.closest('.wv-favorites-pinned-section')
        );

        this.app?.logger?.log('🔍 findExactMatch - Looking for:', chatName, 'Found elements:', validElements.length);
        if (validElements.length > 0 && validElements.length <= 10) {
            this.app?.logger?.log('🔍 Available chat names:', validElements.map(el => el.textContent.trim().substring(0, 50)));
        }

        // Only try exact matches (no partial matching)
        for (const element of validElements) {
            const elementText = element.textContent.toLowerCase().trim();
            if (elementText === targetName) {
                this.app?.logger?.log('✅ Exact match found:', elementText.substring(0, 50));
                element.click();
                return true;
            }
        }

        // Try exact match of cleaned names
        const cleanedTargetName = WVFavs.Helpers.cleanChatName(chatName).toLowerCase().trim();
        this.app?.logger?.log('🔍 Trying cleaned name match:', cleanedTargetName);

        for (const element of validElements) {
            const elementText = element.textContent.trim();
            const cleanedElementText = WVFavs.Helpers.cleanChatName(elementText).toLowerCase().trim();

            if (cleanedElementText === cleanedTargetName) {
                this.app?.logger?.log('✅ Cleaned name match found:', {
                    target: cleanedTargetName,
                    matched: cleanedElementText,
                    original: elementText.substring(0, 50),
                    clicking: elementText.substring(0, 50)
                });
                element.click();
                return true;
            }
        }

        this.app?.logger?.log('❌ No exact match found for:', chatName);
        return false;
    }

    async findExactMatchInNewContent(chatName, seenElements) {
        const elements = document.querySelectorAll('[data-testid="channel-list"] button.tw-block.tw-w-full.tw-p-2.tw-rounded-lg');
        const targetName = chatName.toLowerCase().trim();

        // Filter to only newly loaded elements
        const newElements = Array.from(elements).filter(element => {
            if (element.closest('.wv-favorites-pinned-section')) {
                return false;
            }
            const identifier = element.textContent.trim() + '_' + element.offsetTop;
            return !seenElements.has(identifier);
        });

        // Try exact match in new content first
        for (const element of newElements) {
            const elementText = element.textContent.toLowerCase().trim();
            if (elementText === targetName) {
                element.click();
                return true;
            }
        }

        // Try exact match of cleaned names in new content
        const cleanedTargetName = WVFavs.Helpers.cleanChatName(chatName).toLowerCase().trim();
        for (const element of newElements) {
            const elementText = element.textContent.trim();
            const cleanedElementText = WVFavs.Helpers.cleanChatName(elementText).toLowerCase().trim();
            if (cleanedElementText === cleanedTargetName) {
                element.click();
                return true;
            }
        }

        return false;
    }

    async scrollSidebarToLoadMore() {
        const sidebar = document.querySelector('[data-testid="channel-list"]');
        const scrollContainer = sidebar?.querySelector('.tw-overflow-y-scroll');

        if (scrollContainer) {
            // Scroll to bottom to trigger infinite scroll loading
            scrollContainer.scrollTop = scrollContainer.scrollHeight;

            // Also dispatch scroll event to ensure any scroll listeners are triggered
            scrollContainer.dispatchEvent(new Event('scroll', { bubbles: true }));
        }
    }

    fallbackToSearch(chatName) {
        const searchInput = document.querySelector('input[placeholder*="Search"], input[type="search"]');
        if (searchInput) {
            searchInput.focus();
            searchInput.value = chatName;

            setTimeout(() => {
                searchInput.dispatchEvent(new KeyboardEvent('keydown', {
                    key: 'Enter',
                    keyCode: 13,
                    bubbles: true
                }));
            }, 100);
        }
    }

    async findChatInVisibleArea(chatName) {
        this.app?.logger?.log('🔍 Searching for chat in visible area:', chatName);

        const elements = document.querySelectorAll('[data-testid="channel-list"] button.tw-block.tw-w-full.tw-p-2.tw-rounded-lg');
        const targetName = chatName.toLowerCase().trim();

        // Filter out elements in pinned section to avoid conflicts
        const validElements = Array.from(elements).filter(element =>
            !element.closest('.wv-favorites-pinned-section')
        );

        this.app?.logger?.log('🔍 Found', validElements.length, 'chat elements to check');

        // Strategy 1: Exact match (case-insensitive)
        for (const element of validElements) {
            const elementText = element.textContent.toLowerCase().trim();
            this.app?.logger?.log('🔍 Checking element:', elementText);

            if (elementText === targetName) {
                this.app?.logger?.log('✅ Found exact match!');
                element.click();
                return true;
            }
        }

        // Strategy 2: Exact match of cleaned names
        const cleanedTargetName = WVFavs.Helpers.cleanChatName(chatName).toLowerCase().trim();
        this.app?.logger?.log('🔍 Trying with cleaned target name:', cleanedTargetName);

        for (const element of validElements) {
            const elementText = element.textContent.trim();
            const cleanedElementText = WVFavs.Helpers.cleanChatName(elementText).toLowerCase().trim();

            if (cleanedElementText === cleanedTargetName) {
                this.app?.logger?.log('✅ Found cleaned name match!');
                element.click();
                return true;
            }
        }

        // Strategy 3: First line match (for multi-line text)
        const targetFirstLine = targetName.split('\n')[0];
        for (const element of validElements) {
            const elementFirstLine = element.textContent.toLowerCase().trim().split('\n')[0];
            if (elementFirstLine === targetFirstLine) {
                this.app?.logger?.log('✅ Found first line match!');
                element.click();
                return true;
            }
        }

        return false;
    }

    async tryDirectNavigation(navigationData) {
        this.app?.logger?.log('🔄 Trying direct navigation with data:', navigationData);

        // Try to find chat element using channel URL data attributes
        if (navigationData.channelUrl || navigationData.sendbirdChannel) {
            const selector = navigationData.channelUrl
                ? `[data-channel-url="${navigationData.channelUrl}"]`
                : `[data-sendbird-channel="${navigationData.sendbirdChannel}"]`;
            const element = document.querySelector(selector);
            if (element && element.click) {
                this.app?.logger?.log('✅ Found chat element by data attribute, clicking:', selector);
                element.click();
                return true;
            } else {
                this.app?.logger?.log('⚠️ Chat element not found by data attribute:', selector);
            }
        }

        // Try to find by chat name if provided
        if (navigationData.chatNameForSearch) {
            this.app?.logger?.log('🔍 Trying to find chat by name:', navigationData.chatNameForSearch);
            return await this.findAndClickChat(navigationData.chatNameForSearch);
        }

        this.app?.logger?.log('❌ All direct navigation methods failed');
        return false;
    }

    async findChatByChannelUrl(channelId) {
        this.app?.logger?.log('🔍 Searching for chat by channel URL/ID:', channelId);

        // Try various data attribute selectors
        const selectors = [
            `[data-channel-url="${channelId}"]`,
            `[data-sendbird-channel="${channelId}"]`,
            `[data-chat-id="${channelId}"]`
        ];

        for (const selector of selectors) {
            const element = document.querySelector(selector);

            // Only log selector searches in debug mode
            if (this.app.settings?.get('debugLogging')) {
                this.app?.logger?.debug(`🔍 Selector "${selector}":`, element);
            }

            // CRITICAL FIX: Validate exact attribute match to prevent wrong element selection
            if (element) {
                const attributeName = selector.match(/data-[\w-]+/)?.[0];
                if (attributeName) {
                    const actualValue = element.getAttribute(attributeName);

                    // Convert both to strings and trim for accurate comparison
                    const normalizedActual = String(actualValue || '').trim();
                    const normalizedExpected = String(channelId || '').trim();

                    if (normalizedActual !== normalizedExpected) {
                        if (this.app.settings?.get('debugLogging')) {
                            this.app?.logger?.warn(`❌ Selector mismatch! Expected: "${normalizedExpected}" (type: ${typeof channelId}), Found: "${normalizedActual}" (type: ${typeof actualValue}) for attribute: "${attributeName}"`);
                        }
                        continue;
                    }
                    if (this.app.settings?.get('debugLogging')) {
                        this.app?.logger?.debug(`✅ Exact match confirmed for ${attributeName}: "${normalizedActual}"`);
                    }
                }
            }

            // Skip search widget elements and pinned cards to avoid circular navigation
            if (element && element.closest('.wv-favorites-quick-search-backdrop')) {
                if (this.app.settings?.get('debugLogging')) {
                    this.app?.logger?.debug('⚠️ Skipping search widget element to avoid circular navigation');
                }
                continue;
            }

            // CRITICAL FIX: Skip pinned card elements to prevent circular navigation loop
            if (element && (element.classList.contains('wv-favorites-pinned-card') || element.closest('.wv-favorites-pinned-card'))) {
                if (this.app.settings?.get('debugLogging')) {
                    this.app?.logger?.debug('⚠️ Skipping pinned card element to avoid circular navigation loop');
                }
                continue;
            }

            if (element && element.click) {
                this.app?.logger?.log('🎯 Clicking element:', element);
                this.app?.logger?.log('✅ Found chat element by selector:', selector);
                element.click();
                return true;
            }
        }

        // If direct selectors fail, look for elements in the chat list that contain the ID
        if (this.app.settings?.get('debugLogging')) {
            this.app?.logger?.debug('🔍 Scanning chat list for ID:', channelId);
        }
        const chatElements = document.querySelectorAll('[data-testid="channel-list"] button.tw-block.tw-w-full.tw-p-2.tw-rounded-lg');
        if (this.app.settings?.get('debugLogging')) {
            this.app?.logger?.debug('🔍 Found', chatElements.length, 'chat elements to scan');
        }

        for (const element of chatElements) {
            // Skip pinned section
            if (element.closest('.wv-favorites-pinned-section')) continue;

            // Check various data attributes
            const elementChannelUrl = element.dataset.channelUrl || element.getAttribute('data-channel-url');
            const elementSendbirdChannel = element.dataset.sendbirdChannel || element.getAttribute('data-sendbird-channel');
            const elementChatId = element.dataset.chatId || element.getAttribute('data-chat-id');

            if (elementChannelUrl === channelId || elementSendbirdChannel === channelId || elementChatId === channelId) {
                this.app?.logger?.log('🎯 Found matching element, clicking:', element);
                this.app?.logger?.log('✅ Found chat element by scanning list with ID match');
                element.click();
                return true;
            }
        }

        this.app?.logger?.log('❌ No chat element found for channel URL/ID:', channelId);
        return false;
    }

    /**
     * Detects the current active chat and saves channel info to database
     * Called after successful navigation to capture channel_url
     */
    async detectCurrentChat() {
        try {
            // Get the current active chat ID from sidebar
            const currentActiveChatId = WVFavs.DomDataExtractor.getCurrentActiveChatId();

            if (!currentActiveChatId) {
                this.app?.logger?.debug('No active chat detected after navigation');
                return;
            }

            this.app?.logger?.log('🔍 Detecting chat after navigation:', currentActiveChatId);

            // Reuse existing infrastructure to extract and save channel info
            if (this.app.eventHandler && typeof this.app.eventHandler.updateChatHistoryFromNavigation === 'function') {
                await this.app.eventHandler.updateChatHistoryFromNavigation(currentActiveChatId);
                this.app?.logger?.log('✅ Chat info captured and saved to database');
            } else {
                this.app?.logger?.warn('⚠️ EventHandler.updateChatHistoryFromNavigation not available');
            }
        } catch (error) {
            this.app?.logger?.error('❌ Error in detectCurrentChat:', error);
        }
    }
})();