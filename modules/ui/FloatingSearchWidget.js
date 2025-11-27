class FloatingSearchWidget {
    constructor(app) {
        this.app = app;
        this.app?.logger?.log('🟢 FloatingSearchWidget constructor called with app:', !!app);
        this.isVisible = false;
        this.isDragging = false;
        this.showingModal = false;
        this.currentPosition = { x: 0, y: 0 };

        // Default position (bottom-right corner, snapped to edge)
        this.BUTTON_SIZE = 56;
        this.DEFAULT_POSITION = {
            x: window.innerWidth - this.BUTTON_SIZE, // Snapped to right edge
            y: window.innerHeight - this.BUTTON_SIZE - 20  // 20px from bottom edge
        };

        // Click-based interaction (no hover timers needed)

        // Double-click detection
        this.clickCount = 0;
        this.clickTimer = null;
        this.DOUBLE_CLICK_THRESHOLD = 300; // ms

        this.initializeFloatingWidget();
    }

    /**
     * Calculate the relative luminance of a color
     * Based on WCAG 2.0 formula: https://www.w3.org/TR/WCAG20/#relativeluminancedef
     */
    getRelativeLuminance(hexColor) {
        // Convert hex to RGB
        const hex = hexColor.replace('#', '');
        const r = parseInt(hex.substr(0, 2), 16) / 255;
        const g = parseInt(hex.substr(2, 2), 16) / 255;
        const b = parseInt(hex.substr(4, 2), 16) / 255;

        // Apply gamma correction
        const rLinear = r <= 0.03928 ? r / 12.92 : Math.pow((r + 0.055) / 1.055, 2.4);
        const gLinear = g <= 0.03928 ? g / 12.92 : Math.pow((g + 0.055) / 1.055, 2.4);
        const bLinear = b <= 0.03928 ? b / 12.92 : Math.pow((b + 0.055) / 1.055, 2.4);

        // Calculate relative luminance
        return 0.2126 * rLinear + 0.7152 * gLinear + 0.0722 * bLinear;
    }

    /**
     * Get contrasting color (white or black) for a given background color
     * Returns white for dark backgrounds, black for light backgrounds
     */
    getContrastingIconColor(backgroundColor) {
        try {
            const luminance = this.getRelativeLuminance(backgroundColor);
            // Using WCAG threshold: luminance > 0.5 is considered light
            return luminance > 0.5 ? '#000000' : '#FFFFFF';
        } catch (error) {
            this.app?.logger?.log('Error calculating contrast color:', error);
            return '#FFFFFF'; // Default to white if calculation fails
        }
    }

    getRelativePosition() {
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const relativeX = Math.round((this.currentPosition.x / viewportWidth) * 100);
        const relativeY = Math.round((this.currentPosition.y / viewportHeight) * 100);

        let position = 'center';
        if (relativeX < 33 && relativeY < 33) position = 'top-left';
        else if (relativeX > 66 && relativeY < 33) position = 'top-right';
        else if (relativeX < 33 && relativeY > 66) position = 'bottom-left';
        else if (relativeX > 66 && relativeY > 66) position = 'bottom-right';
        else if (relativeY < 33) position = 'top-center';
        else if (relativeY > 66) position = 'bottom-center';
        else if (relativeX < 33) position = 'left-center';
        else if (relativeX > 66) position = 'right-center';

        return position;
    }

    async initializeFloatingWidget() {
        try {
            this.app?.logger?.log('🟢 FloatingSearchWidget initializeFloatingWidget called');

            // Simple duplicate prevention
            const existing = document.querySelector('.wv-floating-button');
            if (existing) {
                this.app?.logger?.log('🟢 Removing existing widget');
                existing.remove();
            }

            // Check if floating widget is enabled in settings
            this.app?.logger?.log('🟢 WVFavs object:', WVFavs);
            this.app?.logger?.log('🟢 WVFavs.Settings:', WVFavs?.Settings);
            const isEnabled = WVFavs?.Settings?.get('floatingWidgetEnabled');
            this.app?.logger?.log('🟢 FloatingSearchWidget setting value:', isEnabled);

            if (isEnabled === false) {
                this.app?.logger?.log('🟢 FloatingSearchWidget explicitly disabled, exiting');
                return;
            }

            // Load saved position
            await this.loadPosition();

            // Create simple floating button
            this.createSimpleFloatingButton();

            // Update button position in case it was corrected during load
            this.updateButtonPosition();

            // Set up event listeners
            this.setupEventListeners();

            this.isVisible = true;
            this.app?.logger?.log('🟢 FloatingSearchWidget initialization completed');
            this.app?.logger?.log('🎯 Simple floating button initialized');
        } catch (error) {
            this.app?.logger?.log('🔴 ERROR in initializeFloatingWidget:', error);
            this.app?.logger?.log('🔴 ERROR stack:', error.stack);
            this.app?.logger?.log('❌ Failed to initialize floating widget:', error);
        }
    }


    async loadPosition() {
        try {
            const stored = await chrome.storage.local.get(['floatingWidgetPosition']);
            if (stored.floatingWidgetPosition) {
                this.currentPosition = stored.floatingWidgetPosition;
                this.app?.logger?.log('🟢 Loaded saved position:', this.currentPosition);

                // Apply edge snapping to correct any slight offsets
                this.snapToEdgeIfClose();
            } else {
                this.currentPosition = { ...this.DEFAULT_POSITION };
                this.app?.logger?.log('🟢 Using default position:', this.currentPosition);
            }
        } catch (error) {
            this.currentPosition = { ...this.DEFAULT_POSITION };
            this.app?.logger?.log('Failed to load floating widget position:', error);
        }
    }

    async savePosition() {
        try {
            await chrome.storage.local.set({
                floatingWidgetPosition: this.currentPosition
            });

            // Analytics disabled per user request
            // Position change tracking removed
        } catch (error) {
            this.app?.logger?.log('Failed to save floating widget position:', error);
        }
    }

    createSimpleFloatingButton() {
        this.app?.logger?.log('🟢 createSimpleFloatingButton called');
        this.app?.logger?.log('🟢 Current position:', this.currentPosition);

        // Create simple button element
        const button = document.createElement('div');
        button.className = 'wv-floating-button';

        // Use current position but fix negative coordinates
        let x = Math.max(50, this.currentPosition.x);
        let y = Math.max(50, this.currentPosition.y);

        // If coordinates are still problematic, use safe defaults
        if (x < 0 || y < 0 || x > window.innerWidth - 100 || y > window.innerHeight - 100) {
            x = window.innerWidth - 100;
            y = window.innerHeight - 100;
        }

        this.app?.logger?.log('🟢 Using button position:', { x, y });

        // Get color from settings, default to #007ACC
        const buttonColor = this.app?.settings?.get('floatingButtonColor') || '#007ACC';

        button.style.cssText = `
            position: fixed !important;
            top: ${y}px !important;
            left: ${x}px !important;
            width: ${this.BUTTON_SIZE}px !important;
            height: ${this.BUTTON_SIZE}px !important;
            background: ${buttonColor} !important;
            border-radius: 50% !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            cursor: pointer !important;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3) !important;
            z-index: 2147483647 !important;
            opacity: 1 !important;
            visibility: visible !important;
            pointer-events: auto !important;
            transition: all 0.2s ease !important;
        `;

        this.app?.logger?.log('🟢 Button styles applied:', button.style.cssText);

        // Calculate contrasting icon color
        const iconColor = this.getContrastingIconColor(buttonColor);
        this.app?.logger?.log('🟢 Using icon color:', iconColor, 'for background:', buttonColor);

        button.innerHTML = `
            <div class="wv-floating-button-icon" style="color: ${iconColor}; width: 24px; height: 24px; transition: all 0.2s ease;">
                <svg class="search-icon" viewBox="0 0 24 24" fill="currentColor" style="width: 100%; height: 100%;">
                    <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
                </svg>
                <svg class="history-icon" viewBox="0 0 24 24" fill="currentColor" style="width: 100%; height: 100%; display: none;">
                    <path d="M13,3A9,9 0 0,0 4,12H1L4.89,15.89L4.96,16.03L9,12H6A7,7 0 0,1 13,5A7,7 0 0,1 20,12A7,7 0 0,1 13,19C11.07,19 9.32,18.21 8.06,16.94L6.64,18.36C8.27,20 10.5,21 13,21A9,9 0 0,0 22,12A9,9 0 0,0 13,3Z"/>
                </svg>
            </div>
        `;

        this.app?.logger?.log('🟢 Adding button to DOM body');
        this.app?.logger?.log('🟢 document.body exists:', !!document.body);
        document.body.appendChild(button);
        this.app?.logger?.log('🟢 Button added to DOM');

        // Verify it's in the DOM
        const inDOM = document.querySelector('.wv-floating-button');
        this.app?.logger?.log('🟢 Button found in DOM after adding:', !!inDOM);
        this.app?.logger?.log('🟢 Button element:', button);
        this.app?.logger?.log('🟢 Button position in DOM:', button.getBoundingClientRect());

        this.floatingButton = button;
        this.modal = null;
        this.backdrop = null;

        // Set initial icon based on first click behavior setting
        this.setInitialIcon();

        this.app?.logger?.log('🟢 Simple button elements stored');

        // Force a style recalculation
        setTimeout(() => {
            this.app?.logger?.log('🟢 Button still in DOM after timeout:', !!document.querySelector('.wv-floating-button'));
            if (this.floatingButton) {
                this.app?.logger?.log('🟢 Button computed styles:', window.getComputedStyle(this.floatingButton));
            }
        }, 1000);
    }

    updateButtonPosition() {
        if (!this.floatingButton) {
            this.app?.logger?.log('🐛 Debug - No button to position!');
            return;
        }

        this.app?.logger?.log('🐛 Debug - Positioning button at:', this.currentPosition);
        this.floatingButton.style.left = `${this.currentPosition.x}px`;
        this.floatingButton.style.top = `${this.currentPosition.y}px`;
    }


    setupEventListeners() {
        if (!this.floatingButton) return;

        // Click handler - toggle between recent chats modal and search widget
        this.floatingButton.addEventListener('click', (e) => {
            if (this.app?.logger) {
                this.app?.logger?.debug('FloatingWidget: Button clicked', {
                    isDragging: this.isDragging,
                    showingModal: this.showingModal
                });
            }
            e.stopPropagation();

            // Ignore click if dragging
            if (this.isDragging) {
                if (this.app?.logger) {
                    this.app?.logger?.debug('FloatingWidget: Click ignored because dragging');
                }
                return;
            }

            // Get the behavior setting
            const firstClickBehavior = this.app?.settings?.get('floatingWidgetFirstClick') || 'recents';

            // If set to search mode, single click only - no double-click detection needed
            if (firstClickBehavior === 'search') {
                // Track analytics
                if (this.app?.logger) {
                    this.app?.logger?.analytics('floating_widget_click', {
                        configured_behavior: 'search',
                        action_taken: 'search_direct',
                        widget_position: this.getRelativePosition()
                    });
                }
                this.openSearchWidget();
                return;
            }

            // Recents mode: support both double-click and second click after modal

            // If modal is already showing, this is a second click - open search widget directly
            if (this.showingModal) {
                // Cancel any pending timer
                if (this.clickTimer) {
                    clearTimeout(this.clickTimer);
                }
                this.clickCount = 0;

                // Track analytics
                if (this.app?.logger) {
                    this.app?.logger?.analytics('floating_widget_second_click', {
                        configured_behavior: 'recents',
                        action_taken: 'search_after_recents',
                        widget_position: this.getRelativePosition()
                    });
                }

                // Close modal and open search widget
                this.hideModal();
                this.openSearchWidget();
                return;
            }

            // Modal not showing - detect single vs double click
            this.clickCount++;

            if (this.clickCount === 1) {
                // First click - wait to see if it's a double click
                this.clickTimer = setTimeout(() => {
                    // Single click confirmed
                    if (this.app?.logger) {
                        this.app?.logger?.analytics('floating_widget_single_click', {
                            configured_behavior: 'recents',
                            action_taken: 'recents_modal',
                            widget_position: this.getRelativePosition()
                        });
                    }
                    this.showRecentChatModal();
                    this.switchToSearchIcon();
                    this.clickCount = 0;
                }, this.DOUBLE_CLICK_THRESHOLD);
            } else if (this.clickCount === 2) {
                // Double click confirmed - cancel single click timer
                clearTimeout(this.clickTimer);
                this.clickCount = 0;

                // Track analytics
                if (this.app?.logger) {
                    this.app?.logger?.analytics('floating_widget_double_click', {
                        configured_behavior: 'recents',
                        action_taken: 'search_direct',
                        widget_position: this.getRelativePosition()
                    });
                }

                // Open search widget directly (no modal)
                this.openSearchWidget();
            }
        });

        // Note: Hover handlers removed - now using click-based interaction

        // Drag functionality
        this.setupDragHandlers();

        // Window resize handler
        window.addEventListener('resize', () => {
            // Snap to nearest edge on resize to maintain edge positioning
            this.snapToNearestEdge();
            this.savePosition();
            if (this.showingModal) {
                this.positionModal();
            }
        });
    }

    setupDragHandlers() {
        this.app?.logger?.log('🐛 Debug - Setting up drag handlers. Button exists:', !!this.floatingButton);
        if (!this.floatingButton) {
            this.app?.logger?.log('🐛 Debug - No floating button found for drag setup!');
            return;
        }

        let startX, startY, startPosX, startPosY;

        this.floatingButton.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return; // Only left mouse button

            // Prevent text selection during drag
            e.preventDefault();

            this.isDragging = false;
            startX = e.clientX;
            startY = e.clientY;
            startPosX = this.currentPosition.x;
            startPosY = this.currentPosition.y;

            const handleMouseMove = (e) => {
                const deltaX = e.clientX - startX;
                const deltaY = e.clientY - startY;

                // Consider it dragging if moved more than 5px
                if (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5) {
                    if (!this.isDragging) {
                        this.isDragging = true;
                        document.body.style.userSelect = 'none';
                        document.body.style.cursor = 'grabbing';
                        this.floatingButton.style.cursor = 'grabbing';
                        this.floatingButton.style.transform = 'scale(0.9)';
                        this.hideModal(); // Hide modal while dragging
                    }

                    this.currentPosition.x = startPosX + deltaX;
                    this.currentPosition.y = startPosY + deltaY;

                    this.constrainToViewport();
                    this.updateButtonPosition();
                }
            };

            const handleMouseUp = () => {
                document.removeEventListener('mousemove', handleMouseMove);
                document.removeEventListener('mouseup', handleMouseUp);

                // Restore cursor and text selection
                document.body.style.userSelect = '';
                document.body.style.cursor = '';
                this.floatingButton.style.cursor = 'pointer';

                if (this.isDragging) {
                    this.floatingButton.style.transform = '';

                    // Snap to nearest edge
                    this.snapToNearestEdge();
                    this.savePosition();

                    // Reset dragging flag after a short delay to prevent click handler
                    setTimeout(() => {
                        this.isDragging = false;
                    }, 100);
                }
            };

            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
        });
    }

    constrainToViewport() {
        // Keep button within viewport bounds
        const minX = 0;
        const maxX = window.innerWidth - this.BUTTON_SIZE;
        const minY = 0;
        const maxY = window.innerHeight - this.BUTTON_SIZE;

        this.currentPosition.x = Math.max(minX, Math.min(this.currentPosition.x, maxX));
        this.currentPosition.y = Math.max(minY, Math.min(this.currentPosition.y, maxY));
    }

    snapToNearestEdge() {
        const buttonCenterX = this.currentPosition.x + this.BUTTON_SIZE / 2;
        const buttonCenterY = this.currentPosition.y + this.BUTTON_SIZE / 2;

        const windowCenterX = window.innerWidth / 2;
        const windowCenterY = window.innerHeight / 2;

        // Calculate distances to each edge
        const distanceToLeft = buttonCenterX;
        const distanceToRight = window.innerWidth - buttonCenterX;
        const distanceToTop = buttonCenterY;
        const distanceToBottom = window.innerHeight - buttonCenterY;

        // Find the minimum distance
        const minDistance = Math.min(distanceToLeft, distanceToRight, distanceToTop, distanceToBottom);

        // Snap to the nearest edge (touching the edge)
        if (minDistance === distanceToLeft) {
            // Snap to left edge
            this.currentPosition.x = 0;
        } else if (minDistance === distanceToRight) {
            // Snap to right edge
            this.currentPosition.x = window.innerWidth - this.BUTTON_SIZE;
        } else if (minDistance === distanceToTop) {
            // Snap to top edge
            this.currentPosition.y = 0;
        } else {
            // Snap to bottom edge
            this.currentPosition.y = window.innerHeight - this.BUTTON_SIZE;
        }

        this.app?.logger?.log('🟢 Snapped to edge:', this.currentPosition);

        // Animate the snap
        this.floatingButton.style.transition = 'all 0.3s ease';
        this.updateButtonPosition();

        // Reset transition after animation and save position
        setTimeout(() => {
            if (this.floatingButton) {
                this.floatingButton.style.transition = 'all 0.2s ease';
            }
            this.savePosition(); // Save position after snap animation
        }, 300);
    }

    snapToEdgeIfClose() {
        const EDGE_SNAP_THRESHOLD = 30; // Snap if within 30px of edge

        // Check proximity to edges
        const leftDistance = this.currentPosition.x;
        const rightDistance = window.innerWidth - (this.currentPosition.x + this.BUTTON_SIZE);
        const topDistance = this.currentPosition.y;
        const bottomDistance = window.innerHeight - (this.currentPosition.y + this.BUTTON_SIZE);

        let snapped = false;

        // Snap to left edge if close
        if (leftDistance <= EDGE_SNAP_THRESHOLD && leftDistance < rightDistance) {
            this.currentPosition.x = 0;
            snapped = true;
            this.app?.logger?.log('🟢 Snapped to left edge from distance:', leftDistance);
        }
        // Snap to right edge if close
        else if (rightDistance <= EDGE_SNAP_THRESHOLD && rightDistance < leftDistance) {
            this.currentPosition.x = window.innerWidth - this.BUTTON_SIZE;
            snapped = true;
            this.app?.logger?.log('🟢 Snapped to right edge from distance:', rightDistance);
        }

        // Snap to top edge if close
        if (topDistance <= EDGE_SNAP_THRESHOLD && topDistance < bottomDistance) {
            this.currentPosition.y = 0;
            snapped = true;
            this.app?.logger?.log('🟢 Snapped to top edge from distance:', topDistance);
        }
        // Snap to bottom edge if close
        else if (bottomDistance <= EDGE_SNAP_THRESHOLD && bottomDistance < topDistance) {
            this.currentPosition.y = window.innerHeight - this.BUTTON_SIZE;
            snapped = true;
            this.app?.logger?.log('🟢 Snapped to bottom edge from distance:', bottomDistance);
        }

        if (snapped) {
            this.app?.logger?.log('🟢 Position corrected to:', this.currentPosition);
            this.savePosition(); // Save the corrected position
        }
    }

    // Hover-related methods removed - now using click-based interaction


    async showRecentChatModal() {
        this.app?.logger?.log('🟢 showRecentChatModal called, showingModal:', this.showingModal);
        if (this.showingModal || this.isDragging) return;

        // Guard: Check if on chat page
        if (!this.app.isOnChatPage()) {
            this.app?.logger?.log('⚠️ Not on chat page, triggering redirect/notification');
            this.app.handleNonChatPageAction('showRecentChatModal', () => this.showRecentChatModal());
            return;
        }

        try {
            // Get recent chats
            const recentChats = await this.getRecentChats();
            this.app?.logger?.log('🟢 Recent chats for modal:', recentChats);

            if (recentChats.length === 0) {
                this.app?.logger?.log('🐛 Debug - No recent chats found, not showing modal');
                return;
            }

            this.createRecentChatModal(recentChats);
            this.showingModal = true;

            this.app?.logger?.log(`🎭 Showing recent chat modal with ${recentChats.length} chats`);
        } catch (error) {
            this.app?.logger?.log('🔴 ERROR in showRecentChatModal:', error);
            this.app?.logger?.log('Failed to show recent chat modal:', error);
            this.setInitialIcon();
        }
    }

    hideModal() {
        this.app?.logger?.log('🐛 Debug - hideModal called, showingModal:', this.showingModal);
        if (!this.showingModal) return;

        // No timers to clear in click-based interaction

        // Reset to initial icon based on setting
        this.setInitialIcon();

        // Remove modal and backdrop
        if (this.modal) {
            this.modal.remove();
            this.modal = null;
        }
        if (this.backdrop) {
            this.backdrop.remove();
            this.backdrop = null;
        }


        this.showingModal = false;
        this.app?.logger?.log('🐛 Debug - Modal hidden');
    }

    switchToHistoryIcon() {
        if (!this.floatingButton) return;
        const searchIcon = this.floatingButton.querySelector('.search-icon');
        const historyIcon = this.floatingButton.querySelector('.history-icon');
        if (searchIcon && historyIcon) {
            searchIcon.style.display = 'none';
            historyIcon.style.display = 'block';
        }
    }

    switchToSearchIcon() {
        if (!this.floatingButton) return;
        const searchIcon = this.floatingButton.querySelector('.search-icon');
        const historyIcon = this.floatingButton.querySelector('.history-icon');
        if (searchIcon && historyIcon) {
            searchIcon.style.display = 'block';
            historyIcon.style.display = 'none';
        }
    }

    setInitialIcon() {
        const firstClickBehavior = this.app?.settings?.get('floatingWidgetFirstClick') || 'recents';
        this.app?.logger?.log('🟢 Setting initial icon based on behavior:', firstClickBehavior);

        if (firstClickBehavior === 'recents') {
            // If first click shows recents, start with history icon
            this.switchToHistoryIcon();
        } else {
            // If first click shows search, start with search icon
            this.switchToSearchIcon();
        }
    }

    createRecentChatModal(chats) {
        this.app?.logger?.log(`🐛 Debug - createRecentChatModal called with ${chats.length} chats`);

        // Create backdrop
        this.backdrop = document.createElement('div');
        this.backdrop.className = 'wv-modal-backdrop';
        this.backdrop.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.3);
            z-index: 9999999;
            opacity: 0;
            transition: opacity 0.2s ease;
        `;

        // Create modal
        this.modal = document.createElement('div');
        this.modal.className = 'wv-recent-chat-modal';
        this.modal.style.cssText = `
            position: fixed;
            background: white;
            border-radius: 12px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
            z-index: 10000000;
            min-width: 280px;
            max-width: 320px;
            max-height: 400px;
            overflow-y: auto;
            transform: scale(0.8);
            opacity: 0;
            transition: all 0.2s ease;
        `;

        // Create chat list
        const chatList = document.createElement('div');
        chatList.style.cssText = `padding: 12px 0;`;

        chats.slice(0, 8).forEach((chat, index) => {
            const chatItem = this.createModalChatItem(chat, index);
            chatList.appendChild(chatItem);
        });

        this.modal.appendChild(chatList);

        // Position modal near button
        this.positionModal();

        // Add event listeners
        this.setupModalEventListeners();

        // Add to DOM
        document.body.appendChild(this.backdrop);
        document.body.appendChild(this.modal);

        // Trigger animation
        setTimeout(() => {
            this.backdrop.style.opacity = '1';
            this.modal.style.transform = 'scale(1)';
            this.modal.style.opacity = '1';
        }, 10);
    }

    positionModal() {
        if (!this.modal || !this.floatingButton) return;

        const buttonRect = this.floatingButton.getBoundingClientRect();
        const modalWidth = 320; // Known modal width
        const modalHeight = Math.min(400, window.innerHeight * 0.6); // Adaptive height

        // Determine which edge the button is closest to
        const buttonCenterX = buttonRect.left + buttonRect.width / 2;
        const buttonCenterY = buttonRect.top + buttonRect.height / 2;

        const distanceToLeft = buttonCenterX;
        const distanceToRight = window.innerWidth - buttonCenterX;
        const distanceToTop = buttonCenterY;
        const distanceToBottom = window.innerHeight - buttonCenterY;

        const minDistance = Math.min(distanceToLeft, distanceToRight, distanceToTop, distanceToBottom);
        const gap = 4; // Smaller gap between button and modal

        let modalX, modalY;

        if (minDistance === distanceToLeft) {
            // Button is on left edge, modal goes to the right
            modalX = buttonRect.right + gap;
            modalY = Math.max(20, Math.min(buttonRect.top, window.innerHeight - modalHeight - 20));
        } else if (minDistance === distanceToRight) {
            // Button is on right edge, modal goes to the left
            modalX = buttonRect.left - modalWidth - gap;
            modalY = Math.max(20, Math.min(buttonRect.top, window.innerHeight - modalHeight - 20));
        } else if (minDistance === distanceToTop) {
            // Button is on top edge, modal goes below
            modalX = Math.max(20, Math.min(buttonRect.left, window.innerWidth - modalWidth - 20));
            modalY = buttonRect.bottom + gap;
        } else {
            // Button is on bottom edge, modal goes above
            modalX = Math.max(20, Math.min(buttonRect.left, window.innerWidth - modalWidth - 20));
            modalY = buttonRect.top - modalHeight - gap;
        }

        // Final safety checks to ensure modal stays on screen
        modalX = Math.max(20, Math.min(modalX, window.innerWidth - modalWidth - 20));
        modalY = Math.max(20, Math.min(modalY, window.innerHeight - modalHeight - 20));

        this.app?.logger?.log('🟢 Modal positioned at:', { modalX, modalY, buttonEdge: minDistance });

        this.modal.style.left = `${modalX}px`;
        this.modal.style.top = `${modalY}px`;
        this.modal.style.maxHeight = `${modalHeight}px`;
    }

    createModalChatItem(chat, index) {
        const item = document.createElement('div');
        item.className = 'wv-modal-chat-item';
        item.style.cssText = `
            padding: 12px 20px;
            display: flex;
            align-items: center;
            gap: 12px;
            cursor: pointer;
            transition: background-color 0.15s ease;
            border-left: 3px solid transparent;
        `;

        // Avatar
        const avatarContainer = document.createElement('div');
        avatarContainer.style.cssText = `
            width: 32px;
            height: 32px;
            border-radius: 50%;
            background: #f0f0f0;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
            overflow: hidden;
        `;

        const avatarUrl = this.getAvatarUrl(chat);
        if (avatarUrl) {
            const img = document.createElement('img');
            img.src = avatarUrl;
            img.style.cssText = 'width: 100%; height: 100%; object-fit: cover;';
            img.onerror = () => {
                avatarContainer.innerHTML = `<span style="font-size: 12px; font-weight: 600; color: #666;">${this.getInitials(chat.name)}</span>`;
            };
            avatarContainer.appendChild(img);
        } else {
            avatarContainer.innerHTML = `<span style="font-size: 12px; font-weight: 600; color: #666;">${this.getInitials(chat.name)}</span>`;
        }

        // Chat info
        const chatInfo = document.createElement('div');
        chatInfo.style.cssText = 'flex: 1; min-width: 0;';

        const chatName = document.createElement('div');
        chatName.style.cssText = `
            font-weight: 500;
            font-size: 14px;
            color: #333;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        `;
        chatName.textContent = chat.name || chat.displayName || 'Unknown Chat';

        const chatMeta = document.createElement('div');
        chatMeta.style.cssText = `
            font-size: 12px;
            color: #666;
            margin-top: 2px;
        `;
        chatMeta.textContent = chat.isPinned ? '📍 Pinned' : 'Recent';

        chatInfo.appendChild(chatName);
        chatInfo.appendChild(chatMeta);

        // Unread badge if applicable
        if (chat.unreadCount && chat.unreadCount > 0) {
            const badge = document.createElement('div');
            badge.style.cssText = `
                background: #007ACC;
                color: white;
                border-radius: 10px;
                padding: 2px 6px;
                font-size: 11px;
                font-weight: 600;
                min-width: 16px;
                text-align: center;
            `;
            badge.textContent = chat.unreadCount > 99 ? '99+' : chat.unreadCount.toString();
            item.appendChild(badge);
        }

        item.appendChild(avatarContainer);
        item.appendChild(chatInfo);

        // Hover effect
        item.addEventListener('mouseenter', () => {
            item.style.backgroundColor = '#f8f9fa';
            item.style.borderLeftColor = '#007ACC';
        });
        item.addEventListener('mouseleave', () => {
            item.style.backgroundColor = '';
            item.style.borderLeftColor = 'transparent';
        });

        // Click handler
        item.addEventListener('click', (e) => {
            if (this.app?.logger) {
                this.app?.logger?.debug('FloatingWidget: Chat item clicked', { name: chat.name });
                this.app?.logger?.analytics('floating_widget_recent_chat_clicked', {
                    chat_type: chat.type || 'unknown',
                    is_pinned: chat.isPinned || false
                });
            }
            e.stopPropagation();
            this.openChat(chat);
        });

        return item;
    }

    setupModalEventListeners() {
        if (!this.modal || !this.backdrop) return;

        // Mouse leave/enter handlers removed - modal now closes only on backdrop click or second button click

        // Handle backdrop click
        this.backdrop.addEventListener('click', () => {
            this.hideModal();
        });

        // Handle modal click (prevent backdrop click)
        this.modal.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        // Handle escape key
        const handleEscape = (e) => {
            if (e.key === 'Escape' && this.showingModal) {
                this.hideModal();
                document.removeEventListener('keydown', handleEscape);
            }
        };
        document.addEventListener('keydown', handleEscape);
    }






    getAvatarUrl(chat) {
        // DEBUG: Log avatar structure
        this.app?.logger?.log('🎨 FloatingWidget getAvatarUrl for:', chat.name, {
            hasAvatar: !!chat.avatar,
            avatarType: chat.avatar?.type,
            avatarContent: typeof chat.avatar?.content === 'string' ?
                chat.avatar.content.substring(0, 50) + '...' :
                chat.avatar?.content,
            avatarSrc: chat.avatar?.src,
            isObject: typeof chat.avatar === 'object'
        });

        // Handle WorkVivo avatar object structure
        if (chat.avatar && typeof chat.avatar === 'object') {
            // Handle URL/image type - check both url, src, and content fields
            if (chat.avatar.type === 'url' || chat.avatar.type === 'image') {
                const avatarUrl = chat.avatar.content || chat.avatar.src || chat.avatar.url;
                if (avatarUrl && typeof avatarUrl === 'string' && avatarUrl.trim().startsWith('http')) {
                    this.app?.logger?.log('✅ FloatingWidget found URL avatar:', avatarUrl.substring(0, 50) + '...');
                    return avatarUrl.trim();
                }
            }

            // Legacy: try url or content field directly
            const avatarUrl = chat.avatar.url || chat.avatar.content;
            if (avatarUrl && typeof avatarUrl === 'string' && avatarUrl.trim() !== '') {
                if (avatarUrl.startsWith('http')) {
                    this.app?.logger?.log('✅ FloatingWidget found legacy URL avatar:', avatarUrl.substring(0, 50) + '...');
                    return avatarUrl.trim();
                }
            }
        }

        // Try multiple possible avatar properties in order of preference
        const possibleAvatars = [
            chat.avatar,
            chat.avatarSrc,
            chat.profilePicture,
            chat.profile_picture,
            chat.avatarUrl,
            chat.avatar_url,
            chat.image,
            chat.profileImage,
            chat.profile_image
        ];

        for (const avatar of possibleAvatars) {
            if (avatar && typeof avatar === 'string' && avatar.trim() !== '') {
                const trimmed = avatar.trim();
                // Check if it looks like a valid URL or relative path
                if (trimmed.startsWith('http') || trimmed.startsWith('/') || trimmed.startsWith('data:')) {
                    return trimmed;
                }
            }
        }

        return null;
    }

    getInitials(name) {
        if (!name) return '?';
        return name.split(' ')
            .map(word => word.charAt(0).toUpperCase())
            .slice(0, 2)
            .join('');
    }




    async getRecentChats() {
        try {
            // Use the same method as EventHandler
            const recentChats = await this.app.smartUserDB.getRecentChats() || [];
            this.app?.logger?.log('🐛 Debug - Found recent chats:', recentChats.length);
            return recentChats.slice(0, 5);
        } catch (error) {
            this.app?.logger?.log('Failed to get recent chats:', error);
            return [];
        }
    }


    openSearchWidget() {
        this.app?.logger?.log('🟢 FloatingWidget: openSearchWidget called');
        this.app?.logger?.log('🟢 FloatingWidget: app exists:', !!this.app);
        this.app?.logger?.log('🟢 FloatingWidget: eventHandler exists:', !!this.app?.eventHandler);
        this.app?.logger?.log('🟢 FloatingWidget: showSearchUI exists:', !!this.app?.eventHandler?.showSearchUI);

        // Hide modal first
        this.hideModal();

        // Lower floating button z-index when search widget opens
        this.lowerFloatingButtonZIndex();

        // Try primary method first
        if (this.app && this.app.eventHandler && this.app.eventHandler.showSearchUI) {
            this.app?.logger?.log('🟢 FloatingWidget: Calling app.eventHandler.showSearchUI');
            this.app.eventHandler.showSearchUI('floating_button');
        }
        // Try global WVFavs method
        else if (typeof WVFavs !== 'undefined' && WVFavs.EventHandler && WVFavs.EventHandler.showSearchUI) {
            this.app?.logger?.log('🟢 FloatingWidget: Using WVFavs.EventHandler.showSearchUI');
            WVFavs.EventHandler.showSearchUI('floating_button');
        }
        // Try triggering keyboard shortcut
        else if (this.app && this.app.eventHandler && this.app.eventHandler.handleKeyboardShortcut) {
            this.app?.logger?.log('🟢 FloatingWidget: Using keyboard shortcut to open search');
            this.app.eventHandler.handleKeyboardShortcut({
                key: 'k',
                ctrlKey: true,
                preventDefault: () => {},
                stopPropagation: () => {}
            });
        }
        else {
            this.app?.logger?.log('🟢 FloatingWidget: No search method available');
            this.app?.logger?.log('Search UI not available');
            // Show button again since search didn't open
            this.showFloatingButton();
        }
    }

    openChat(chat) {
        if (this.app?.logger) {
            this.app?.logger?.debug('FloatingWidget: openChat called', { name: chat.name });

            // Track recent chat accessed analytics
            this.app?.logger?.analytics('recent_chat_accessed', {
                source: 'floating_widget',
                chat_type: chat.type || 'unknown',
                is_pinned: chat.isPinned || false,
                action_method: 'floating_widget_recent_list'
            });
        }

        // Hide modal
        this.hideModal();

        // Navigate directly with floating widget source
        this.app?.logger?.log('🔍 Recent chat data for navigation:', {
            displayName: chat.name,
            id: chat.id,
            userId: chat.userId,
            hasNavigation: !!chat.navigation
        });

        // Use DomManager.navigateToChat directly with proper source
        if (typeof WVFavs !== 'undefined' && WVFavs.DomManager && WVFavs.DomManager.navigateToChat) {
            if (this.app?.logger) {
                this.app?.logger?.debug('FloatingWidget: Using DomManager.navigateToChat with floating_widget_recent_chat source');
            }
            // Use original chat object - don't modify ID with channel_url
            WVFavs.DomManager.navigateToChat(chat, 'floating_widget_recent_chat');
        } else {
            // Fallback to original method if DomManager not available
            if (this.app && this.app.eventHandler && this.app.eventHandler.commitSearchSelection) {
                const chatItem = {
                    ...chat,
                    _resultType: chat.isPinned ? 'pinned' : 'recent'
                };
                if (this.app?.logger) {
                    this.app?.logger?.debug('FloatingWidget: Fallback to commitSearchSelection');
                }
                this.app.eventHandler.commitSearchSelection(chatItem);
            } else if (typeof WVFavs !== 'undefined' && WVFavs.EventHandler && WVFavs.EventHandler.commitSearchSelection) {
                const chatItem = {
                    ...chat,
                    _resultType: chat.isPinned ? 'pinned' : 'recent'
                };
                if (this.app?.logger) {
                    this.app?.logger?.debug('FloatingWidget: Using WVFavs.EventHandler.commitSearchSelection fallback');
                }
                WVFavs.EventHandler.commitSearchSelection(chatItem);
                return;
            }

            // Fallback: direct URL navigation if available
            if (chat.url) {
                this.app?.logger?.log('🟢 FloatingWidget: Using direct URL navigation:', chat.url);
                window.location.href = chat.url;
            } else if (chat.id && chat.name) {
                this.app?.logger?.log('🟢 FloatingWidget: Searching for chat link for:', chat.name);
                // Try to find the chat in the sidebar and click it
                const chatLinks = document.querySelectorAll('a[href*="/chat"]');
                this.app?.logger?.log('🟢 FloatingWidget: Found chat links:', chatLinks.length);
                for (const link of chatLinks) {
                    if (link.textContent.includes(chat.name)) {
                        this.app?.logger?.log('🟢 FloatingWidget: Found matching link, clicking:', link);
                        link.click();
                        return;
                    }
                }
                this.app?.logger?.log('🟢 FloatingWidget: Could not find chat link for', chat.name);
            } else {
                this.app?.logger?.log('🟢 FloatingWidget: No URL or ID available for chat:', chat);
            }
        }
    }

    // Public methods for external control
    show() {
        // Only show on chat pages
        if (!this.app?.isOnChatPage()) {
            return;
        }

        if (this.floatingButton) {
            this.floatingButton.style.display = 'flex';
            this.isVisible = true;
        }
    }

    hide() {
        if (this.floatingButton) {
            this.floatingButton.style.display = 'none';
            this.isVisible = false;
            this.hideModal();
        }
    }

    lowerFloatingButtonZIndex() {
        this.app?.logger?.log('🟢 FloatingWidget: Lowering floating button z-index for search widget');
        if (this.floatingButton) {
            // Set z-index below search widget backdrop (search widget uses up to 10001)
            this.floatingButton.style.zIndex = '9999';
        }
    }

    restoreFloatingButtonZIndex() {
        this.app?.logger?.log('🟢 FloatingWidget: Restoring floating button z-index');
        if (this.floatingButton) {
            // Restore to maximum z-index
            this.floatingButton.style.zIndex = '2147483647';
        }
    }

    hideFloatingButton() {
        this.app?.logger?.log('🟢 FloatingWidget: Hiding floating button');
        if (this.floatingButton) {
            this.floatingButton.style.display = 'none';
            this.hideModal(); // Also hide any open modal
        }
    }

    showFloatingButton() {
        this.app?.logger?.log('🟢 FloatingWidget: Showing floating button');
        if (this.floatingButton) {
            this.floatingButton.style.display = 'flex';
        }
    }

    destroy() {
        this.hideModal();
        if (this.floatingButton) {
            this.floatingButton.remove();
            this.floatingButton = null;
        }
        this.isVisible = false;
        this.showingModal = false;
    }

    // Settings integration
    async updateSettings(settings) {
        if (settings.floatingWidgetEnabled === false && this.isVisible) {
            this.hide();
        } else if (settings.floatingWidgetEnabled === true && !this.isVisible) {
            this.show();
        }

        // Update button color if it changed
        if (settings.floatingButtonColor && this.floatingButton) {
            this.updateButtonColor(settings.floatingButtonColor);
        }
    }

    updateButtonColor(color) {
        if (this.floatingButton) {
            this.floatingButton.style.background = color;

            // Update icon color for contrast
            const iconColor = this.getContrastingIconColor(color);
            const iconElement = this.floatingButton.querySelector('.wv-floating-button-icon');
            if (iconElement) {
                iconElement.style.color = iconColor;
                this.app?.logger?.log('🟢 FloatingWidget: Updated button color to', color, 'and icon color to', iconColor);
            }
        }
    }
}

// Add to WVFavs namespace
if (typeof WVFavs === 'undefined') {
    window.WVFavs = {};
}
WVFavs.FloatingSearchWidget = FloatingSearchWidget;

