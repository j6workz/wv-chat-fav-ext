/**
 * SearchPanel - UI component for channel-scoped message search
 * Opens as right-side overlay panel (similar to ThreadsPanel)
 * Navigation works like MentionsPanel - direct load without DOM checks
 */

var WVFavs = WVFavs || {};

WVFavs.SearchPanel = class SearchPanel {
    constructor(app) {
        this.app = app;
        this.currentPanel = null;
        this.currentChannelUrl = null;
        this.currentChannelName = null;
        this.isGlobalPanel = false; // Track if current panel is global or channel-specific
        // Load search mode from localStorage: 'fuzzy' (default), 'exact', or 'advanced'
        this.searchMode = localStorage.getItem('wv-search-mode') || 'fuzzy';
        // Load show full message setting from localStorage: true or false (default)
        this.showFullMessage = localStorage.getItem('wv-search-show-full-message') === 'true';
        // Cache for channel names in global search
        this.channelNamesCache = {};
    }

    /**
     * Open the search panel for current channel
     */
    async openSearchPanel() {
        // Mark UI operation start to prevent cleanup during DOM stabilization
        this.app.smartUserDatabase?.markUIOperationStart();

        // Get current channel URL and name
        this.currentChannelUrl = this.app.threadManager?.getCurrentChannel();

        if (!this.currentChannelUrl) {
            this.app?.logger?.warn('❌ No channel URL found for search');
            this.app.smartUserDatabase?.markUIOperationEnd();
            return;
        }

        // Get channel name
        this.currentChannelName = await this.getChannelName();

        this.app?.logger?.log('🔍 Opening search panel for channel:', {
            channelUrl: this.currentChannelUrl.substring(0, 40) + '...',
            channelName: this.currentChannelName
        });

        // Check if panel is already open
        const existingPanel = document.querySelector('.wv-favorites-search-panel');
        if (existingPanel) {
            this.app?.logger?.log('🔍 Search panel already open');
            this.app.smartUserDatabase?.markUIOperationEnd();
            return;
        }

        // Disable all search buttons
        this.disableSearchButtons();

        // Find the message section to attach the panel
        const messageSection = document.querySelector('[data-testid="message-section"]');
        if (!messageSection) {
            this.app?.logger?.log('❌ Could not find message section for search panel');
            this.app.smartUserDatabase?.markUIOperationEnd();
            return;
        }

        // Get border radius from message section (forces browser to compute styles before panel creation)
        const messageSectionStyle = window.getComputedStyle(messageSection);
        const borderRadius = messageSectionStyle.borderRadius || '8px';

        // Create panel (message-section already has position: relative in inline styles)
        const panel = this.createPanelElement(borderRadius);
        this.currentPanel = panel;

        // Store current channel URL for change detection
        panel.dataset.channelUrl = this.currentChannelUrl;

        // Append panel to DOM
        messageSection.appendChild(panel);

        // Add CSS animations
        this.addPanelAnimations();

        // Listen for channel changes and close panel when channel switches
        const handleChannelChange = (event) => {
            const { currentChannel } = event.detail;
            if (panel.dataset.channelUrl !== currentChannel) {
                this.app?.logger?.log('🔄 Channel changed, closing search panel');
                this.closePanel();
            }
        };

        window.addEventListener('wv-channel-changed', handleChannelChange);

        // Store cleanup function for later
        panel._cleanupChannelListener = () => {
            window.removeEventListener('wv-channel-changed', handleChannelChange);
        };

        // Focus search input
        setTimeout(() => {
            const searchInput = panel.querySelector('.wv-search-input');
            if (searchInput) {
                searchInput.focus();
            }
        }, 100);

        this.app?.logger?.log('✅ Search panel opened');

        // Mark UI operation complete - cleanup can resume
        this.app.smartUserDatabase?.markUIOperationEnd();
    }

    /**
     * Get channel name from various sources
     */
    async getChannelName() {
        // Try to get from SmartUserDatabase
        if (this.app.smartUserDB && this.currentChannelUrl) {
            try {
                const chat = await this.app.smartUserDB.getChat(this.currentChannelUrl);
                if (chat && chat.name) {
                    return chat.name;
                }
            } catch (error) {
                this.app?.logger?.warn('⚠️ Could not get channel name from DB:', error);
            }
        }

        // Fallback: get from DOM
        const chatHeader = document.querySelector('[data-testid="chat-header"]');
        if (chatHeader) {
            const titleElement = chatHeader.querySelector('h2, h3, .tw-font-semibold');
            if (titleElement) {
                return titleElement.textContent.trim();
            }
        }

        return 'this channel';
    }

    /**
     * Create the panel DOM element
     */
    createPanelElement(borderRadius = '8px') {
        const panel = document.createElement('div');
        panel.className = 'wv-favorites-search-panel';
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

        // Create header
        const header = this.createHeader();
        panel.appendChild(header);

        // Create search input section
        const searchSection = this.createSearchSection();
        panel.appendChild(searchSection);

        // Create results list
        const resultsList = this.createResultsList();
        panel.appendChild(resultsList);

        // Create footer
        const footer = this.createFooter();
        panel.appendChild(footer);

        return panel;
    }

    /**
     * Create panel header
     */
    createHeader() {
        const header = document.createElement('div');

        // Different header styles for global vs channel panels
        if (this.isGlobalPanel) {
            // Global panel: White background like channel panel, similar typography
            header.style.cssText = `
                padding: 10px 12px;
                background: #f9fafb;
                flex-shrink: 0;
            `;

            header.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div style="display: flex; align-items: baseline; gap: 6px; overflow: hidden; flex: 1; min-width: 0;">
                        <h3 style="margin: 0; font-size: 15px; font-weight: 600; color: #111827; flex-shrink: 0;">Search</h3>
                        <span style="font-size: 13px; color: #9ca3af; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">in all channels</span>
                    </div>
                    <button class="wv-favorites-search-close" style="
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
        } else {
            // Channel panel: Original style with improved typography
            header.style.cssText = `
                background: white;
                flex-shrink: 0;
            `;

            header.innerHTML = `
                <div style="padding: 16px 16px 10px 16px; display: flex; align-items: center; justify-content: space-between; gap: 8px;">
                    <div style="
                        display: flex;
                        align-items: baseline;
                        gap: 6px;
                        overflow: hidden;
                        flex: 1;
                        min-width: 0;
                    ">
                        <h3 style="margin: 0; font-size: 15px; font-weight: 600; color: #111827; flex-shrink: 0;">Search</h3>
                        <span style="
                            font-size: 13px;
                            color: #9ca3af;
                            white-space: nowrap;
                            overflow: hidden;
                            text-overflow: ellipsis;
                        ">in ${this.escapeHtml(this.currentChannelName)}</span>
                    </div>
                    <button class="wv-favorites-search-close" style="
                        background: transparent;
                        border: none;
                        color: #6b7280;
                    width: 28px;
                    height: 28px;
                    border-radius: 6px;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: background 0.15s;
                    padding: 0;
                    flex-shrink: 0;
                ">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M18 6L6 18M6 6l12 12"/>
                    </svg>
                </button>
            </div>
        `;
        }

        // Add close button handler
        const closeBtn = header.querySelector('.wv-favorites-search-close');
        closeBtn.addEventListener('click', () => this.closePanel());

        // Add hover effect for close button
        closeBtn.addEventListener('mouseenter', () => {
            closeBtn.style.background = '#f3f4f6';
        });
        closeBtn.addEventListener('mouseleave', () => {
            closeBtn.style.background = 'transparent';
        });

        return header;
    }

    /**
     * Create search input section
     */
    createSearchSection() {
        const section = document.createElement('div');
        section.style.cssText = `
            padding: 0 16px 16px 16px;
            border-bottom: 1px solid #e5e7eb;
            background: #f9fafb;
            flex-shrink: 0;
            padding-left: 12px;
        `;

        section.innerHTML = `
            <div style="display: flex; gap: 8px; align-items: center;">
                <input
                    type="text"
                    class="wv-search-input"
                    placeholder="Search messages..."
                    autocomplete="off"
                    spellcheck="false"
                    style="
                        flex: 1;
                        padding: 0 10px;
                        border: 2px solid #d1d5db;
                        border-radius: 6px;
                        font-size: 13px;
                        outline: none;
                        transition: border-color 0.15s;
                        background: white;
                        height: 36px;
                    "
                />
                <button class="wv-search-btn" style="
                    padding: 8px;
                    background: #3b82f6;
                    color: white;
                    border: none;
                    border-radius: 6px;
                    cursor: pointer;
                    transition: background 0.15s;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    width: 36px;
                    height: 36px;
                    flex-shrink: 0;
                ">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="11" cy="11" r="8"/>
                        <path d="m21 21-4.35-4.35"/>
                    </svg>
                </button>
            </div>
        `;

        // Add event listeners
        const input = section.querySelector('.wv-search-input');
        const searchBtn = section.querySelector('.wv-search-btn');

        // Focus border highlight
        input.addEventListener('focus', () => {
            input.style.borderColor = '#3b82f6';
        });
        input.addEventListener('blur', () => {
            input.style.borderColor = '#d1d5db';
        });

        // Search on button click
        searchBtn.addEventListener('click', () => this.performSearch());

        // Search on Enter key
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.performSearch();
            }
        });

        // Button hover effect
        searchBtn.addEventListener('mouseenter', () => {
            searchBtn.style.background = '#2563eb';
        });
        searchBtn.addEventListener('mouseleave', () => {
            searchBtn.style.background = '#3b82f6';
        });

        return section;
    }

    /**
     * Create results list container
     */
    createResultsList() {
        const list = document.createElement('div');
        list.className = 'wv-search-results-list';
        list.style.cssText = `
            flex: 1;
            overflow-y: auto;
            padding: 8px 12px;
            background: white;
        `;

        // Show empty state initially
        list.innerHTML = `
            <div style="
                text-align: center;
                padding: 32px 16px;
                color: #6b7280;
            ">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin: 0 auto 10px; opacity: 0.3;">
                    <circle cx="11" cy="11" r="8"/>
                    <path d="m21 21-4.35-4.35"/>
                </svg>
                <p style="margin: 0; font-size: 13px; font-weight: 500;">Search messages</p>
                <p style="margin: 4px 0 0 0; font-size: 11px; color: #9ca3af;">Enter a search term to find messages</p>
            </div>
        `;

        return list;
    }

    /**
     * Create search mode dropdown HTML
     */
    createSearchModeDropdownHTML() {
        return `
            <div class="wv-search-mode-dropdown" style="
                display: none;
                position: fixed;
                background: white;
                border: 1px solid #d1d5db;
                border-radius: 6px;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
                z-index: 10001;
                min-width: 160px;
            ">
                <div class="wv-search-mode-option" data-mode="fuzzy" style="
                    padding: 8px 12px;
                    cursor: pointer;
                    font-size: 11px;
                    color: #374151;
                    background: ${this.searchMode === 'fuzzy' ? '#eff6ff' : 'white'};
                    font-weight: ${this.searchMode === 'fuzzy' ? '600' : '400'};
                    border-bottom: 1px solid #f3f4f6;
                ">
                    <div style="font-weight: 500; margin-bottom: 2px;">Fuzzy</div>
                    <div style="font-size: 10px; color: #6b7280;">Partial matches</div>
                </div>
                <div class="wv-search-mode-option" data-mode="exact" style="
                    padding: 8px 12px;
                    cursor: pointer;
                    font-size: 11px;
                    color: #374151;
                    background: ${this.searchMode === 'exact' ? '#eff6ff' : 'white'};
                    font-weight: ${this.searchMode === 'exact' ? '600' : '400'};
                    border-bottom: 1px solid #f3f4f6;
                ">
                    <div style="font-weight: 500; margin-bottom: 2px;">Exact</div>
                    <div style="font-size: 10px; color: #6b7280;">Exact matches only</div>
                </div>
                <div class="wv-search-mode-option" data-mode="advanced" style="
                    padding: 8px 12px;
                    cursor: pointer;
                    font-size: 11px;
                    color: #374151;
                    background: ${this.searchMode === 'advanced' ? '#eff6ff' : 'white'};
                    font-weight: ${this.searchMode === 'advanced' ? '600' : '400'};
                ">
                    <div style="font-weight: 500; margin-bottom: 2px;">Advanced</div>
                    <div style="font-size: 10px; color: #6b7280;">AND (,) / OR (|)</div>
                </div>
            </div>
        `;
    }

    /**
     * Create footer with Global Search button (channel panel) or just dropdown (global panel)
     */
    createFooter() {
        const footer = document.createElement('div');
        footer.className = 'wv-search-footer';
        footer.style.cssText = `
            padding: 10px;
            border-top: 1px solid rgb(229, 231, 235);
            background: rgb(249, 250, 251);
            flex-shrink: 0;
        `;

        const searchModeLabel = this.searchMode === 'fuzzy' ? 'Fuzzy' :
                               this.searchMode === 'exact' ? 'Exact' : 'Advanced';

        // Different footer layouts for channel vs global panels
        if (this.isGlobalPanel) {
            // Global panel: Advanced dropdown + Show full message toggle
            footer.innerHTML = `
                <div style="
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 12px;
                    font-size: 11px;
                    color: #6b7280;
                ">
                    <label style="
                        display: flex;
                        align-items: center;
                        gap: 6px;
                        cursor: pointer;
                        font-size: 11px;
                        color: #6b7280;
                        user-select: none;
                        margin-bottom: 0;
                    ">
                        <input type="checkbox" class="wv-search-show-full-toggle" ${this.showFullMessage ? 'checked' : ''} style="
                            width: 14px;
                            height: 14px;
                            cursor: pointer;
                        ">
                        <span>Show full message</span>
                    </label>
                    <div style="position: relative;">
                        <button class="wv-search-mode-dropdown-btn" style="
                            display: flex;
                            align-items: center;
                            gap: 6px;
                            padding: 6px 12px;
                            border: 1px solid #d1d5db;
                            border-radius: 6px;
                            background: white;
                            cursor: pointer;
                            font-size: 12px;
                            color: #374151;
                            transition: all 0.15s;
                            font-weight: 500;
                        ">
                            <span class="wv-search-mode-label">${searchModeLabel}</span>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="6 9 12 15 18 9"/>
                            </svg>
                        </button>
                        ${this.createSearchModeDropdownHTML()}
                    </div>
                </div>
            `;
        } else {
            // Channel panel: Global Search button + Advanced dropdown + Show full message toggle
            footer.innerHTML = `
                <div style="
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 12px;
                    font-size: 11px;
                    color: #6b7280;
                ">
                    <button class="wv-global-search-btn" style="
                        display: flex;
                        align-items: center;
                        gap: 6px;
                        padding: 6px 14px;
                        border: 1px solid #d1d5db;
                        border-radius: 6px;
                        background: white;
                        cursor: pointer;
                        font-size: 12px;
                        color: #374151;
                        transition: all 0.15s;
                        font-weight: 500;
                        flex-shrink: 0;
                    ">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="10"/>
                            <line x1="2" y1="12" x2="22" y2="12"/>
                            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
                        </svg>
                        <span>Global Search</span>
                    </button>
                    <label style="
                        display: flex;
                        align-items: center;
                        gap: 6px;
                        cursor: pointer;
                        font-size: 11px;
                        color: #6b7280;
                        user-select: none;
                        flex-shrink: 0;
                        margin-bottom: 0;
                    ">
                        <input type="checkbox" class="wv-search-show-full-toggle" ${this.showFullMessage ? 'checked' : ''} style="
                            width: 14px;
                            height: 14px;
                            cursor: pointer;
                        ">
                        <span>Show full message</span>
                    </label>
                    <div style="position: relative; flex-shrink: 0;">
                        <button class="wv-search-mode-dropdown-btn" style="
                            display: flex;
                            align-items: center;
                            gap: 6px;
                            padding: 6px 12px;
                            border: 1px solid #d1d5db;
                            border-radius: 6px;
                            background: white;
                            cursor: pointer;
                            font-size: 12px;
                            color: #374151;
                            transition: all 0.15s;
                            font-weight: 500;
                        ">
                            <span class="wv-search-mode-label">${searchModeLabel}</span>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="6 9 12 15 18 9"/>
                            </svg>
                        </button>
                        ${this.createSearchModeDropdownHTML()}
                    </div>
                </div>
            `;
        }

        // Add Global Search button handler (only for channel panel)
        if (!this.isGlobalPanel) {
            const globalSearchBtn = footer.querySelector('.wv-global-search-btn');
            globalSearchBtn.addEventListener('click', () => this.openGlobalSearchWithContext());

            globalSearchBtn.addEventListener('mouseenter', () => {
                globalSearchBtn.style.background = '#f9fafb';
                globalSearchBtn.style.borderColor = '#9ca3af';
            });
            globalSearchBtn.addEventListener('mouseleave', () => {
                globalSearchBtn.style.background = 'white';
                globalSearchBtn.style.borderColor = '#d1d5db';
            });
        }

        // Add dropdown handlers
        const dropdownBtn = footer.querySelector('.wv-search-mode-dropdown-btn');
        const dropdown = footer.querySelector('.wv-search-mode-dropdown');
        const dropdownOptions = footer.querySelectorAll('.wv-search-mode-option');

        // Toggle dropdown
        dropdownBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isVisible = dropdown.style.display === 'block';

            if (isVisible) {
                dropdown.style.display = 'none';
            } else {
                // Calculate position relative to button
                const btnRect = dropdownBtn.getBoundingClientRect();

                // Show dropdown temporarily to get its height
                dropdown.style.display = 'block';
                dropdown.style.visibility = 'hidden';
                const dropdownHeight = dropdown.offsetHeight;
                dropdown.style.visibility = 'visible';

                // Calculate if there's space above the button
                const spaceAbove = btnRect.top;
                const spaceBelow = window.innerHeight - btnRect.bottom;

                // Position dropdown above or below based on available space
                if (spaceAbove >= dropdownHeight + 8) {
                    // Position above button
                    dropdown.style.bottom = `${window.innerHeight - btnRect.top + 4}px`;
                    dropdown.style.top = 'auto';
                } else {
                    // Position below button
                    dropdown.style.top = `${btnRect.bottom + 4}px`;
                    dropdown.style.bottom = 'auto';
                }

                // Ensure dropdown doesn't overflow right edge
                const dropdownWidth = 160; // min-width from CSS
                const leftPosition = Math.min(btnRect.left, window.innerWidth - dropdownWidth - 8);
                dropdown.style.left = `${leftPosition}px`;
            }
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!dropdown.contains(e.target) && e.target !== dropdownBtn) {
                dropdown.style.display = 'none';
            }
        });

        // Handle option selection with auto-retrigger
        dropdownOptions.forEach(option => {
            option.addEventListener('click', (e) => {
                const mode = option.dataset.mode;
                this.searchMode = mode;

                // Update button label
                const modeLabel = mode === 'fuzzy' ? 'Fuzzy' :
                                 mode === 'exact' ? 'Exact' : 'Advanced';
                footer.querySelector('.wv-search-mode-label').textContent = modeLabel;

                // Update option styles
                dropdownOptions.forEach(opt => {
                    const isSelected = opt.dataset.mode === mode;
                    opt.style.background = isSelected ? '#eff6ff' : 'white';
                    opt.style.fontWeight = isSelected ? '600' : '400';
                });

                // Persist to localStorage
                localStorage.setItem('wv-search-mode', mode);
                this.app?.logger?.log(`🔍 Search mode changed to: ${mode}`);

                // Close dropdown
                dropdown.style.display = 'none';

                // AUTO-RETRIGGER: If there's an active search, re-run it with new mode
                const query = this.currentPanel.querySelector('.wv-search-input').value.trim();
                if (query) {
                    this.app?.logger?.log(`🔄 Auto-retriggering search with new mode: ${mode}`);
                    this.performSearch();
                }
            });

            // Hover effects
            option.addEventListener('mouseenter', () => {
                if (option.dataset.mode !== this.searchMode) {
                    option.style.background = '#f9fafb';
                }
            });
            option.addEventListener('mouseleave', () => {
                if (option.dataset.mode !== this.searchMode) {
                    option.style.background = 'white';
                }
            });
        });

        // Dropdown button hover effect
        dropdownBtn.addEventListener('mouseenter', () => {
            dropdownBtn.style.background = '#f9fafb';
            dropdownBtn.style.borderColor = '#9ca3af';
        });
        dropdownBtn.addEventListener('mouseleave', () => {
            dropdownBtn.style.background = 'white';
            dropdownBtn.style.borderColor = '#d1d5db';
        });

        // Add "Show full message" toggle handler
        const showFullToggle = footer.querySelector('.wv-search-show-full-toggle');
        if (showFullToggle) {
            showFullToggle.addEventListener('change', (e) => {
                this.showFullMessage = e.target.checked;
                localStorage.setItem('wv-search-show-full-message', this.showFullMessage.toString());
                this.app?.logger?.log(`💬 Show full message: ${this.showFullMessage}`);

                // Re-render results with new setting
                const resultsList = this.currentPanel.querySelector('.wv-search-results-list');
                if (resultsList && this.app.searchManager.getCurrentResults().length > 0) {
                    // Get current results from search manager
                    const results = this.app.searchManager.getCurrentResults();

                    // Re-render all results
                    resultsList.innerHTML = '';
                    results.forEach(result => {
                        // Get channel name if in global mode
                        const channelName = this.isGlobalPanel && result.channelUrl ?
                            this.getChannelNameFromCache(result.channelUrl) : null;
                        const resultItem = this.createResultItem(result, channelName);
                        resultsList.appendChild(resultItem);
                    });

                    // Re-add Load More button if needed
                    if (this.app.searchManager.hasMoreResults()) {
                        const loadMoreBtn = this.createLoadMoreButton();
                        resultsList.appendChild(loadMoreBtn);
                    }
                }
            });
        }

        return footer;
    }

    /**
     * Open global search panel with context from current channel search
     */
    openGlobalSearchWithContext() {
        // Capture current context
        const query = this.currentPanel.querySelector('.wv-search-input').value.trim();
        const searchMode = this.searchMode;

        this.app?.logger?.log('🌐 Opening global search with context:', { query, searchMode });

        // Close current panel WITHOUT resetting isGlobalPanel flag
        const wasGlobalPanel = this.isGlobalPanel;
        this.isGlobalPanel = false; // Temporarily set to false for proper closing animation

        if (this.currentPanel) {
            // Cleanup channel change listener (channel panel only)
            if (this.currentPanel._cleanupChannelListener) {
                this.currentPanel._cleanupChannelListener();
            }

            // Animate panel out
            this.currentPanel.style.animation = 'slideOutRight 0.2s ease-out';

            const panelToRemove = this.currentPanel;
            setTimeout(() => {
                if (panelToRemove) {
                    panelToRemove.remove();
                }
            }, 200);

            this.currentPanel = null;
        }

        // Open global panel with context after a brief delay
        setTimeout(() => {
            this.openGlobalSearchPanel(query, searchMode);
        }, 250);
    }

    /**
     * Open global search panel in sidebar (like MentionsPanel/DraftsPanel)
     * @param {string} query - Pre-filled search query
     * @param {string} searchMode - Search mode (fuzzy/exact/advanced)
     */
    async openGlobalSearchPanel(query = '', searchMode = null) {
        // Close any existing panels
        const existingChannelPanel = document.querySelector('.wv-favorites-search-panel');
        const existingGlobalPanel = document.querySelector('.wv-favorites-global-search-panel');
        if (existingChannelPanel) {
            existingChannelPanel.remove();
        }
        if (existingGlobalPanel) {
            this.app?.logger?.log('🔍 Global search panel already open');
            return;
        }

        // Disable all search buttons
        this.disableSearchButtons();

        // Set search mode if provided
        if (searchMode) {
            this.searchMode = searchMode;
        }

        // Set global panel flag
        this.isGlobalPanel = true;
        this.currentChannelName = 'all channels';

        this.app?.logger?.log('🌐 Opening global search panel', { query, searchMode: this.searchMode });

        // Get sidebar dimensions to match position/size
        const sidebar = document.querySelector('[data-testid="channel-list"]');
        if (!sidebar) {
            this.app?.logger?.error('❌ Could not find sidebar for global search panel');
            return;
        }

        const sidebarRect = sidebar.getBoundingClientRect();
        const sidebarStyles = window.getComputedStyle(sidebar);
        const borderRadius = sidebarStyles.borderRadius || '0px';

        // Create panel (position: fixed, attach to body)
        const panel = this.createPanelElement();
        this.currentPanel = panel;

        // Override positioning for sidebar (fixed to body, not absolute to message-section)
        // Match MentionsPanel design EXACTLY
        panel.className = 'wv-favorites-global-search-panel';
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

        // Append to body (not message-section)
        document.body.appendChild(panel);

        // Add slide-in animation
        this.addPanelAnimations();

        // Pre-fill search input if query provided
        const searchInput = panel.querySelector('.wv-search-input');
        if (searchInput && query) {
            searchInput.value = query;
        }

        // Add window resize listener to keep panel synchronized with sidebar
        const resizeHandler = () => {
            if (this.currentPanel && this.isGlobalPanel) {
                const sidebar = document.querySelector('[data-testid="channel-list"]');
                if (sidebar) {
                    const rect = sidebar.getBoundingClientRect();
                    this.currentPanel.style.top = `${rect.top}px`;
                    this.currentPanel.style.left = `${rect.left}px`;
                    this.currentPanel.style.width = `${rect.width}px`;
                    this.currentPanel.style.height = `${rect.height}px`;
                }
            }
        };
        window.addEventListener('resize', resizeHandler);

        // Store cleanup function
        panel._cleanupResizeListener = () => {
            window.removeEventListener('resize', resizeHandler);
        };

        // Focus search input
        setTimeout(() => {
            if (searchInput) {
                searchInput.focus();
            }
        }, 100);

        // Auto-execute search if query provided
        if (query) {
            setTimeout(() => {
                this.app?.logger?.log('🔄 Auto-executing global search with query:', query);
                this.performSearch();
            }, 150);
        }

        this.app?.logger?.log('✅ Global search panel opened');
    }

    /**
     * Perform search
     */
    async performSearch() {
        if (!this.currentPanel) {
            console.warn('⚠️ [SearchPanel] Cannot perform search: currentPanel is null');
            return;
        }

        const input = this.currentPanel.querySelector('.wv-search-input');
        if (!input) {
            console.warn('⚠️ [SearchPanel] Cannot perform search: input element not found');
            return;
        }

        const query = input.value.trim();

        if (!query || query.length === 0) {
            this.app?.logger?.log('⚠️ Empty search query');
            return;
        }

        this.app?.logger?.log('🔍 Performing search:', query, {
            searchMode: this.searchMode,
            isGlobalPanel: this.isGlobalPanel
        });

        // Show loading state
        this.showLoadingState();

        try {
            // Reset previous search
            this.app.searchManager.resetSearch();

            // Process query based on search mode
            let apiQuery = query;
            let advancedQuery = false;
            let exactMatch = false;

            if (this.searchMode === 'advanced') {
                apiQuery = this.convertToSendbirdQuery(query);
                advancedQuery = true;
                this.app?.logger?.log('🔍 Converted to Sendbird query:', apiQuery);
            } else if (this.searchMode === 'exact') {
                exactMatch = true;
            }
            // fuzzy mode: use query as-is

            // Perform search using API
            // Pass null for channelUrl in global mode (uses user_id instead)
            const channelUrl = this.isGlobalPanel ? null : this.currentChannelUrl;
            const results = await this.app.searchManager.searchMessages(
                channelUrl,
                apiQuery,
                {
                    advancedQuery,
                    exactMatch
                }
            );

            this.app?.logger?.log('✅ Search results from API:', results);

            // Render results immediately (progressive rendering with loading skeletons)
            await this.renderResults(results);

        } catch (error) {
            this.app?.logger?.error('❌ Search failed:', error);
            this.showErrorState(error.message);
        }
    }

    /**
     * Convert user-friendly query syntax to Sendbird advanced search syntax
     * User syntax: comma (,) = AND, pipe (|) = OR
     * Sendbird syntax: uppercase AND, uppercase OR, with parentheses
     * Example: "hello, world | foo" → "hello AND (world OR foo)"
     * @param {string} query - Search query with comma/pipe operators
     * @returns {string} Sendbird-formatted advanced search query
     */
    convertToSendbirdQuery(query) {
        // Split by comma for AND groups
        const andGroups = query.split(',').map(group => group.trim()).filter(g => g.length > 0);

        // Convert each AND group
        const convertedGroups = andGroups.map(group => {
            // Split by pipe for OR terms within this group
            const orTerms = group.split('|').map(term => term.trim()).filter(t => t.length > 0);

            if (orTerms.length === 0) {
                return '';
            } else if (orTerms.length === 1) {
                // Single term, no OR needed
                return orTerms[0];
            } else {
                // Multiple terms, wrap in parentheses with OR
                return '(' + orTerms.join(' OR ') + ')';
            }
        }).filter(g => g.length > 0);

        if (convertedGroups.length === 0) {
            return query; // Return original if parsing failed
        } else if (convertedGroups.length === 1) {
            return convertedGroups[0];
        } else {
            // Join with AND
            return convertedGroups.join(' AND ');
        }
    }

    /**
     * Load more results (pagination)
     */
    async loadMoreResults() {
        const loadMoreBtn = this.currentPanel.querySelector('.wv-search-load-more-btn');

        if (!this.app.searchManager.hasMoreResults()) {
            return;
        }

        // Show loading on button
        const originalText = loadMoreBtn.innerHTML;
        loadMoreBtn.disabled = true;
        loadMoreBtn.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation: spin 1s linear infinite;">
                <circle cx="12" cy="12" r="10"/>
            </svg>
            Loading...
        `;

        try {
            const results = await this.app.searchManager.loadMore();
            this.appendResults(results);
        } catch (error) {
            this.app?.logger?.error('❌ Load more failed:', error);
        } finally {
            loadMoreBtn.disabled = false;
            loadMoreBtn.innerHTML = originalText;
        }
    }

    /**
     * Show loading state
     */
    showLoadingState() {
        const resultsList = this.currentPanel.querySelector('.wv-search-results-list');
        resultsList.innerHTML = `
            <div style="padding: 24px 16px; text-align: center;">
                <div style="
                    width: 28px;
                    height: 28px;
                    border: 2.5px solid #f3f4f6;
                    border-top-color: #3b82f6;
                    border-radius: 50%;
                    margin: 0 auto 10px;
                    animation: spin 1s linear infinite;
                "></div>
                <p style="margin: 0; font-size: 11px; color: #9ca3af;">Searching...</p>
            </div>
        `;

        // Add spin animation if not exists
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

    /**
     * Show processing state (after search completes, while rendering results)
     */
    showProcessingState(resultCount) {
        const resultsList = this.currentPanel.querySelector('.wv-search-results-list');
        resultsList.innerHTML = `
            <div style="padding: 24px 16px; text-align: center;">
                <div style="
                    width: 28px;
                    height: 28px;
                    border: 2.5px solid #f3f4f6;
                    border-top-color: #10b981;
                    border-radius: 50%;
                    margin: 0 auto 10px;
                    animation: spin 1s linear infinite;
                "></div>
                <p style="margin: 0; font-size: 11px; color: #9ca3af;">Processing ${resultCount} result${resultCount !== 1 ? 's' : ''}...</p>
            </div>
        `;

        // Ensure spin animation exists
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

    /**
     * Create shimmer animation for loading skeletons
     */
    createShimmerAnimation() {
        if (!document.querySelector('style[data-wv-shimmer-animation]')) {
            const style = document.createElement('style');
            style.setAttribute('data-wv-shimmer-animation', 'true');
            style.textContent = `
                @keyframes shimmer {
                    0% {
                        background-position: -200px 0;
                    }
                    100% {
                        background-position: 200px 0;
                    }
                }
            `;
            document.head.appendChild(style);
        }
    }

    /**
     * Create loading skeleton for channel name
     */
    createChannelLoadingSkeleton() {
        return `
            <div class="wv-search-channel-skeleton" style="
                height: 18px;
                width: 120px;
                background: linear-gradient(90deg, #f3f4f6 25%, #e5e7eb 50%, #f3f4f6 75%);
                background-size: 200px 100%;
                animation: shimmer 1.5s ease-in-out infinite;
                border-radius: 4px;
                margin-bottom: 6px;
            "></div>
        `;
    }

    /**
     * Show error state
     */
    showErrorState(errorMessage) {
        const resultsList = this.currentPanel.querySelector('.wv-search-results-list');
        resultsList.innerHTML = `
            <div style="text-align: center; padding: 24px 16px; color: #ef4444;">
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin: 0 auto 10px; opacity: 0.5;">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="8" x2="12" y2="12"/>
                    <line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                <p style="margin: 0; font-size: 12px; font-weight: 500;">Search failed</p>
                <p style="margin: 4px 0 0 0; font-size: 11px; color: #9ca3af;">${this.escapeHtml(errorMessage)}</p>
            </div>
        `;
    }

    /**
     * Update channel names in DOM for all results with matching channelUrl
     */
    updateChannelNameInDOM(channelUrl, channelName, resultsList) {
        const items = resultsList.querySelectorAll(`[data-channel-url="${channelUrl}"]`);

        items.forEach(item => {
            // Find the skeleton or existing channel section
            const skeleton = item.querySelector('.wv-search-channel-skeleton');
            const existingSection = item.querySelector('.wv-search-channel-section');

            if (skeleton) {
                // Replace skeleton with actual channel name
                if (channelName && channelName !== 'Unknown Channel') {
                    const channelSection = document.createElement('div');
                    channelSection.className = 'wv-search-channel-section';
                    channelSection.style.cssText = 'font-size: 12px; color: #64748b; margin-bottom: 6px; display: flex; align-items: center; gap: 4px;';
                    channelSection.innerHTML = `
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink: 0;">
                            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                        </svg>
                        <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0;">${this.escapeHtml(channelName)}</span>
                    `;
                    skeleton.replaceWith(channelSection);
                } else {
                    // Channel name not found, remove skeleton
                    skeleton.remove();
                }
            }
        });
    }

    /**
     * Fetch channel name and update DOM progressively
     */
    async fetchAndUpdateChannelName(channelUrl, resultsList) {
        // Check cache first (instant)
        if (this.channelNamesCache[channelUrl] !== undefined) {
            this.updateChannelNameInDOM(channelUrl, this.channelNamesCache[channelUrl], resultsList);
            return;
        }

        // Fetch from APIManager (which checks CacheManager and IndexedDB first)
        try {
            if (!WVFavs.APIManager) {
                this.app?.logger?.warn('⚠️ APIManager not available');
                this.channelNamesCache[channelUrl] = null;
                this.updateChannelNameInDOM(channelUrl, null, resultsList);
                return;
            }

            const channelInfo = await WVFavs.APIManager.getChannelInfo(channelUrl);

            if (channelInfo && channelInfo.name) {
                this.channelNamesCache[channelUrl] = channelInfo.name;
                this.updateChannelNameInDOM(channelUrl, channelInfo.name, resultsList);
                this.app?.logger?.log('✅ Fetched channel name:', channelInfo.name);
            } else {
                this.channelNamesCache[channelUrl] = null;
                this.updateChannelNameInDOM(channelUrl, null, resultsList);
                this.app?.logger?.warn('⚠️ Channel not found:', channelUrl.substring(0, 20));
            }
        } catch (error) {
            this.app?.logger?.error('❌ Error fetching channel:', error);
            this.channelNamesCache[channelUrl] = null;
            this.updateChannelNameInDOM(channelUrl, null, resultsList);
        }
    }

    /**
     * Render search results
     */
    async renderResults(results) {
        const resultsList = this.currentPanel.querySelector('.wv-search-results-list');

        if (!results.results || results.results.length === 0) {
            resultsList.innerHTML = `
                <div style="text-align: center; padding: 24px 16px; color: #6b7280;">
                    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin: 0 auto 10px; opacity: 0.3;">
                        <circle cx="11" cy="11" r="8"/>
                        <path d="m21 21-4.35-4.35"/>
                    </svg>
                    <p style="margin: 0; font-size: 12px; font-weight: 500;">No results found</p>
                    <p style="margin: 4px 0 0 0; font-size: 11px; color: #9ca3af;">Try different search terms</p>
                    ${!this.isGlobalPanel ? `
                        <button class="wv-search-all-channels-btn" style="
                            margin-top: 16px;
                            padding: 8px 16px;
                            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                            color: white;
                            border: none;
                            border-radius: 8px;
                            font-size: 12px;
                            font-weight: 600;
                            cursor: pointer;
                            display: inline-flex;
                            align-items: center;
                            gap: 6px;
                            transition: transform 0.2s, box-shadow 0.2s;
                            box-shadow: 0 2px 4px rgba(102, 126, 234, 0.3);
                        " onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 4px 8px rgba(102, 126, 234, 0.4)';"
                           onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 2px 4px rgba(102, 126, 234, 0.3)';">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="11" cy="11" r="8"/>
                                <path d="m21 21-4.35-4.35"/>
                            </svg>
                            Search in All Channels
                        </button>
                    ` : ''}
                </div>
            `;

            // Add event listener for "Search in All Channels" button
            if (!this.isGlobalPanel) {
                const searchAllBtn = resultsList.querySelector('.wv-search-all-channels-btn');
                if (searchAllBtn) {
                    searchAllBtn.addEventListener('click', () => {
                        // Use the same method as the footer's Global Search button
                        this.openGlobalSearchWithContext();
                    });
                }
            }

            return;
        }

        // Clear list
        resultsList.innerHTML = '';

        // STEP 1: Render ALL results immediately with loading skeletons (no channel names yet)
        results.results.forEach(result => {
            const resultItem = this.createResultItem(result, null); // null = show loading skeleton
            resultsList.appendChild(resultItem);
        });

        // Add Load More button at end of results if there are more
        if (results.hasMore) {
            const loadMoreBtn = this.createLoadMoreButton();
            resultsList.appendChild(loadMoreBtn);
        }

        // STEP 2: Fetch channel names in PARALLEL (global search only)
        if (this.isGlobalPanel) {
            // Extract unique channel URLs (e.g., 4 unique channels from 20 results)
            const uniqueChannelUrls = [...new Set(
                results.results
                    .map(r => r.channelUrl)
                    .filter(url => url) // Remove null/undefined
            )];

            this.app?.logger?.log(`🔄 Fetching ${uniqueChannelUrls.length} unique channels in parallel`);

            // Fetch ALL unique channels in parallel (Promise.all)
            const fetchPromises = uniqueChannelUrls.map(channelUrl =>
                this.fetchAndUpdateChannelName(channelUrl, resultsList)
            );

            // Don't await - let them update progressively in the background
            Promise.all(fetchPromises).then(() => {
                this.app?.logger?.log('✅ All channel names loaded');
            }).catch(error => {
                this.app?.logger?.error('❌ Error loading channel names:', error);
            });
        }
    }

    /**
     * Append more results (pagination)
     */
    async appendResults(results) {
        const resultsList = this.currentPanel.querySelector('.wv-search-results-list');

        // Remove old Load More button if it exists
        const oldLoadMoreBtn = resultsList.querySelector('.wv-search-load-more-btn');
        if (oldLoadMoreBtn) {
            oldLoadMoreBtn.remove();
        }

        // STEP 1: Append ALL new results immediately with loading skeletons
        results.results.forEach(result => {
            const resultItem = this.createResultItem(result, null); // null = show skeleton
            resultsList.appendChild(resultItem);
        });

        // STEP 2: Fetch channel names in PARALLEL (global search only)
        if (this.isGlobalPanel) {
            // Extract unique channel URLs from NEW results only
            const uniqueChannelUrls = [...new Set(
                results.results
                    .map(r => r.channelUrl)
                    .filter(url => url)
            )];

            this.app?.logger?.log(`🔄 [Load More] Fetching ${uniqueChannelUrls.length} unique channels in parallel`);

            // Fetch ALL unique channels in parallel
            const fetchPromises = uniqueChannelUrls.map(channelUrl =>
                this.fetchAndUpdateChannelName(channelUrl, resultsList)
            );

            // Don't await - let them update progressively in background
            Promise.all(fetchPromises).then(() => {
                this.app?.logger?.log('✅ [Load More] All channel names loaded');
            }).catch(error => {
                this.app?.logger?.error('❌ [Load More] Error loading channel names:', error);
            });
        }

        // Add Load More button at end if there are more results
        if (results.hasMore) {
            const loadMoreBtn = this.createLoadMoreButton();
            resultsList.appendChild(loadMoreBtn);
        }
    }

    /**
     * Create Load More button that appears at end of results
     */
    createLoadMoreButton() {
        const button = document.createElement('button');
        button.className = 'wv-search-load-more-btn';
        button.style.cssText = `
            width: 100%;
            padding: 12px;
            margin: 8px 0;
            border: 1px solid #d1d5db;
            border-radius: 6px;
            background: white;
            cursor: pointer;
            font-size: 12px;
            font-weight: 500;
            color: #374151;
            transition: all 0.15s;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
        `;

        button.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 19V5M5 12l7-7 7 7"></path>
            </svg>
            <span>Load more</span>
        `;

        button.addEventListener('click', () => this.loadMoreResults());

        button.addEventListener('mouseenter', () => {
            button.style.background = '#f9fafb';
            button.style.borderColor = '#9ca3af';
        });
        button.addEventListener('mouseleave', () => {
            button.style.background = 'white';
            button.style.borderColor = '#d1d5db';
        });

        return button;
    }

    /**
     * Create a single result item (matching Mentions panel design)
     * @param {Object} result - Search result
     * @param {string|null} channelName - Channel name (null for single-channel search)
     */
    createResultItem(result, channelName = null) {
        const item = document.createElement('div');
        item.className = 'wv-search-result-item';
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

        // Add data attribute for later channel name updates (global search only)
        if (this.isGlobalPanel && result.channelUrl) {
            item.dataset.channelUrl = result.channelUrl;
        }

        // Format timestamp
        const timestamp = this.formatTimestamp(result.createdAt);

        // Get user initials
        const initials = this.getInitials(result.user.nickname);

        // Clean message text (format mentions properly)
        const cleanedMessage = this.cleanMessageText(result.message);

        // Avatar HTML - 40px to match Mentions panel
        const avatarHtml = result.user.profileUrl ? `
            <img src="${this.escapeHtml(result.user.profileUrl)}"
                 alt="${this.escapeHtml(result.user.nickname)}"
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
                ${initials}
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
                ${initials}
            </div>
        `;

        // Thread icon (inline with message text)
        const threadIcon = result.isThread ? '<span style="color: #64748b; margin-right: 4px;">↪</span>' : '';

        // Channel section
        let channelSection = '';
        if (this.isGlobalPanel) {
            if (channelName && channelName !== 'Unknown Channel') {
                // Show actual channel name
                channelSection = `
                    <div class="wv-search-channel-section" style="font-size: 12px; color: #64748b; margin-bottom: 6px; display: flex; align-items: center; gap: 4px;">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink: 0;">
                            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                        </svg>
                        <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-width: 0;">${this.escapeHtml(channelName)}</span>
                    </div>
                `;
            } else if (channelName === null) {
                // Show loading skeleton (channelName not loaded yet)
                this.createShimmerAnimation(); // Ensure animation exists
                channelSection = this.createChannelLoadingSkeleton();
            }
            // If channelName === 'Unknown Channel' or empty, show nothing
        }

        item.innerHTML = `
            <div style="display: flex; gap: 12px;">
                ${avatarHtml}
                <div style="flex: 1; min-width: 0;">
                    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
                        <div style="font-weight: 600; color: #1e293b; font-size: 13px;">
                            ${this.escapeHtml(result.user.nickname)}
                        </div>
                        <div style="font-size: 11px; color: #94a3b8; flex-shrink: 0;">
                            ${timestamp}
                        </div>
                    </div>
                    ${channelSection}
                    <div style="
                        font-size: 13px;
                        color: #334155;
                        line-height: 1.5;
                        word-break: break-word;
                        ${this.showFullMessage ? '' : `
                        overflow: hidden;
                        display: -webkit-box;
                        -webkit-line-clamp: 2;
                        -webkit-box-orient: vertical;
                        `}
                    ">
                        ${threadIcon}${this.escapeHtml(cleanedMessage)}
                    </div>
                </div>
            </div>
        `;

        // Hover effects (matching Mentions panel)
        item.addEventListener('mouseenter', () => {
            item.style.transform = 'translateX(-4px)';
            item.style.boxShadow = '0 4px 12px rgba(102, 126, 234, 0.2)';
        });

        item.addEventListener('mouseleave', () => {
            item.style.transform = 'translateX(0)';
            item.style.boxShadow = '0 1px 3px rgba(0, 0, 0, 0.1)';
        });

        // Click handler - navigate to message
        item.addEventListener('click', () => this.navigateToResult(result));

        return item;
    }

    /**
     * Navigate to search result (like MentionsPanel - direct load using tier system)
     */
    async navigateToResult(result) {
        this.app?.logger?.log('🔍 Navigating to search result:', {
            messageId: result.messageId,
            channelUrl: result.channelUrl,
            isThread: result.isThread,
            parentMessageId: result.parentMessageId,
            createdAt: result.createdAt
        });

        try {
            // Use DomManager.navigateToMention (same as MentionsPanel)
            if (WVFavs.DomManager && WVFavs.DomManager.navigateToMention) {
                // For thread replies: navigate to parent thread and open the reply
                // For main messages: navigate directly to the message
                const isThreadReply = result.isThread && result.parentMessageId;
                const messageId = isThreadReply ? result.parentMessageId : result.messageId;
                const replyMessageId = isThreadReply ? result.messageId : null;

                // Use result's channel URL (important for all-channel search)
                const channelUrl = result.channelUrl || this.currentChannelUrl;

                this.app?.logger?.log('🔍 Navigation details:', {
                    originalMessageId: result.messageId,
                    messageId,
                    channelUrl: channelUrl.substring(0, 40) + '...',
                    isThreadReply,
                    replyMessageId,
                    createdAt: result.createdAt
                });

                // Navigate using tier system (WebpackNavigator or ReactFiberNavigator)
                // This handles old messages properly by using the timestamp
                await WVFavs.DomManager.navigateToMention(
                    channelUrl,
                    messageId,
                    isThreadReply,
                    replyMessageId,
                    result.createdAt  // CRITICAL: timestamp for loading old messages
                );

                this.app?.logger?.log('✅ Navigation completed');
            } else {
                this.app?.logger?.warn('⚠️ navigateToMention not available in DomManager');
            }

        } catch (error) {
            this.app?.logger?.error('❌ Navigation failed:', error);
        }
    }

    /**
     * Format timestamp with relative dates (Today, Yesterday, then dates)
     */
    formatTimestamp(timestamp) {
        const date = new Date(timestamp);
        const now = new Date();

        // Reset time to midnight for date comparison
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const messageDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

        const diffTime = today.getTime() - messageDate.getTime();
        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays === 0) {
            return 'Today';
        } else if (diffDays === 1) {
            return 'Yesterday';
        } else {
            // Format as DD/MM/YYYY
            const day = String(date.getDate()).padStart(2, '0');
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const year = date.getFullYear();
            return `${day}/${month}/${year}`;
        }
    }

    /**
     * Clean message text - format mentions like @[Name](person:id) -> @Name
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
     * Get initials from name
     */
    getInitials(name) {
        if (!name) return '?';
        const parts = name.trim().split(' ');
        if (parts.length >= 2) {
            return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
        }
        return name.substring(0, 2).toUpperCase();
    }

    /**
     * Escape HTML
     */
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Add panel animations
     */
    addPanelAnimations() {
        if (document.querySelector('#wv-favorites-search-animations')) {
            return;
        }

        const style = document.createElement('style');
        style.id = 'wv-favorites-search-animations';
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
            @keyframes slideOutRight {
                from {
                    transform: translateX(0);
                    opacity: 1;
                }
                to {
                    transform: translateX(100%);
                    opacity: 0;
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
        `;
        document.head.appendChild(style);
    }

    /**
     * Close the panel
     */
    closePanel() {
        if (!this.currentPanel) return;

        // Re-enable all search buttons
        this.enableSearchButtons();

        // Cleanup channel change listener (channel panel only)
        if (this.currentPanel._cleanupChannelListener) {
            this.currentPanel._cleanupChannelListener();
        }

        // Cleanup resize listener (global panel only)
        if (this.currentPanel._cleanupResizeListener) {
            this.currentPanel._cleanupResizeListener();
        }

        // Animate panel out (different animations for channel vs global)
        const animation = this.isGlobalPanel ? 'slideOutLeft 0.2s ease-out' : 'slideOutRight 0.2s ease-out';
        this.currentPanel.style.animation = animation;

        setTimeout(() => {
            if (this.currentPanel) {
                this.currentPanel.remove();
                this.currentPanel = null;
            }
        }, 200);

        // Reset global panel flag
        this.isGlobalPanel = false;

        this.app?.logger?.log('✅ Search panel closed');
    }

    /**
     * Disable all search buttons on page
     */
    disableSearchButtons() {
        const buttons = document.querySelectorAll('.wv-favorites-search-btn');
        buttons.forEach(btn => {
            btn.disabled = true;
            btn.style.opacity = '0.5';
            btn.style.cursor = 'not-allowed';
            btn.style.pointerEvents = 'none';
        });
        this.app?.logger?.log('🔒 Search buttons disabled');
    }

    /**
     * Re-enable all search buttons on page
     */
    enableSearchButtons() {
        const buttons = document.querySelectorAll('.wv-favorites-search-btn');
        buttons.forEach(btn => {
            btn.disabled = false;
            btn.style.opacity = '1';
            btn.style.cursor = 'pointer';
            btn.style.pointerEvents = 'auto';
        });
        this.app?.logger?.log('🔓 Search buttons enabled');
    }

    /**
     * Get channel name from cache (used when re-rendering results)
     * @param {string} channelUrl - Channel URL
     * @returns {string|null} Channel name or null
     */
    getChannelNameFromCache(channelUrl) {
        return this.channelNamesCache[channelUrl] || null;
    }
};
