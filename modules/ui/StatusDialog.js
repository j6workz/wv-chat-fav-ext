/**
 * StatusDialog - UI component for updating user status
 * Displays a dialog with preset status options and custom input
 * Allows setting expiry datetime for automatic status clearing
 */

var WVFavs = WVFavs || {};

WVFavs.StatusDialog = class StatusDialog {
    constructor(app) {
        this.app = app;
        this.currentDialog = null;
        this.isLoading = false;

        // Preset status options
        this.statusPresets = [
            { emoji: '🟢', text: 'Available', value: '🟢 Available' },
            { emoji: '🔴', text: 'Busy', value: '🔴 Busy' },
            { emoji: '🌙', text: 'Away', value: '🌙 Away' },
            { emoji: '🏖️', text: 'On vacation', value: '🏖️ On vacation' },
            { emoji: '🏝️', text: 'On leave', value: '🏝️ On leave' },
            { emoji: '🤒', text: 'Sick', value: '🤒 Sick' },
            { emoji: '🏠', text: 'Working from home', value: '🏠 Working from home' },
            { emoji: '🚀', text: 'In a meeting', value: '🚀 In a meeting' }
        ];
    }

    /**
     * Open the status dialog
     */
    async openStatusDialog() {
        this.app?.logger?.log('📝 Opening status dialog...');

        // Check if dialog is already open
        const existingDialog = document.querySelector('.wv-favorites-status-dialog');
        if (existingDialog) {
            this.app?.logger?.log('📝 Status dialog already open');
            return;
        }

        // Get current user with full profile (including status)
        const user = await this.app.userIdentity?.getCurrentUser();

        // Fetch full profile to get current status
        let profileData = null;
        if (user && user.fullProfile) {
            profileData = user.fullProfile;
        } else if (user && user.id) {
            // If no cached profile, fetch it
            try {
                profileData = await this.app.userIdentity?.fetchCurrentUserProfile();
            } catch (error) {
                this.app?.logger?.log('❌ Error fetching profile for dialog:', error);
            }
        }

        const currentStatus = this.app.userIdentity?.getUserStatus(profileData);

        this.app?.logger?.log('📝 Current status:', currentStatus);

        // Track dialog open
        if (this.app.analytics) {
            this.app.analytics.trackEvent('status_dialog_opened', {
                has_current_status: !!currentStatus?.status,
                user_detected: !!user
            });
        }

        // Create dialog
        const dialog = this.createDialogElement(currentStatus);
        this.currentDialog = dialog;

        // Append to body
        document.body.appendChild(dialog);

        // Set up event listeners
        this.setupDialogEventListeners(dialog, currentStatus);

        this.app?.logger?.log('✅ Status dialog opened');
    }

    /**
     * Create the dialog DOM element
     */
    createDialogElement(currentStatus) {
        const overlay = document.createElement('div');
        overlay.className = 'wv-favorites-status-dialog';
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.4);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
            animation: fadeIn 0.2s ease-out;
        `;

        const dialog = document.createElement('div');
        dialog.className = 'wv-favorites-status-dialog-content';
        dialog.style.cssText = `
            background: white;
            border-radius: 12px;
            width: 420px;
            max-width: 90vw;
            max-height: 90vh;
            overflow: hidden;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
            display: flex;
            flex-direction: column;
            animation: slideInUp 0.3s ease-out;
        `;

        // Create header
        const header = this.createDialogHeader();
        dialog.appendChild(header);

        // Create body
        const body = this.createDialogBody(currentStatus);
        dialog.appendChild(body);

        // Create footer
        const footer = this.createDialogFooter();
        dialog.appendChild(footer);

        overlay.appendChild(dialog);
        return overlay;
    }

    /**
     * Create dialog header
     */
    createDialogHeader() {
        const header = document.createElement('div');
        header.style.cssText = `
            padding: 16px 20px;
            background: #f9fafb;
            flex-shrink: 0;
            border-bottom: 1px solid #e5e7eb;
        `;

        header.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: space-between;">
                <h3 style="margin: 0; font-size: 15px; font-weight: 600; color: #111827;">Set your status</h3>
                <button class="wv-status-close-btn" style="
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
                    font-size: 20px;
                " onmouseover="this.style.background='#e5e7eb'" onmouseout="this.style.background='transparent'">
                    ×
                </button>
            </div>
        `;

        return header;
    }

    /**
     * Create dialog body
     */
    createDialogBody(currentStatus) {
        const body = document.createElement('div');
        body.style.cssText = `
            padding: 20px;
            overflow-y: auto;
            flex: 1;
        `;

        const statusText = currentStatus?.status || '';
        const expiryTimestamp = currentStatus?.expiry || null;

        body.innerHTML = `
            <div style="margin-bottom: 16px;">
                <label style="display: block; font-size: 13px; font-weight: 500; color: #6b7280; margin-bottom: 8px;">
                    Choose a status
                </label>
                <div class="wv-status-presets" style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px;">
                    ${this.statusPresets.map(preset => `
                        <button class="wv-status-preset-btn" data-status="${this.escapeHtml(preset.value)}" style="
                            padding: 8px 12px;
                            border: 1px solid #e5e7eb;
                            background: ${statusText === preset.value ? '#f3f4f6' : 'white'};
                            border-radius: 6px;
                            cursor: pointer;
                            display: flex;
                            align-items: center;
                            gap: 8px;
                            font-size: 13px;
                            color: #374151;
                            transition: all 0.1s;
                            font-weight: ${statusText === preset.value ? '500' : '400'};
                        " onmouseover="if('${statusText}' !== '${preset.value}') { this.style.background='#f9fafb'; }" onmouseout="if('${statusText}' !== '${preset.value}') { this.style.background='white'; }">
                            <span style="font-size: 16px;">${preset.emoji}</span>
                            <span>${preset.text}</span>
                        </button>
                    `).join('')}
                </div>
            </div>

            <div style="margin-bottom: 16px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                    <label style="font-size: 13px; font-weight: 500; color: #6b7280;">
                        Custom status
                    </label>
                    <span class="wv-status-char-counter" style="font-size: 12px; color: #9ca3af;">
                        ${statusText.length}/60
                    </span>
                </div>
                <input type="text" class="wv-status-custom-input" placeholder="e.g., In a meeting until 3pm" value="${this.escapeHtml(statusText)}" maxlength="60" style="
                    width: 100%;
                    padding: 9px 12px;
                    border: 1px solid #d1d5db;
                    border-radius: 6px;
                    font-size: 14px;
                    color: #111827;
                    outline: none;
                    transition: border-color 0.15s, box-shadow 0.15s;
                    box-sizing: border-box;
                " onfocus="this.style.borderColor='#9ca3af'; this.style.boxShadow='0 0 0 3px rgba(156, 163, 175, 0.1)';" onblur="this.style.borderColor='#d1d5db'; this.style.boxShadow='none';">
            </div>

            <div style="margin-bottom: 0;">
                <label style="display: block; font-size: 13px; font-weight: 500; color: #6b7280; margin-bottom: 8px;">
                    Until (optional)
                </label>
                <div style="display: flex; gap: 6px; margin-bottom: 10px;">
                    <button class="wv-status-quick-time" data-hours="1" style="
                        padding: 7px 10px;
                        border: 1px solid #e5e7eb;
                        background: white;
                        border-radius: 6px;
                        cursor: pointer;
                        font-size: 12px;
                        color: #6b7280;
                        transition: all 0.1s;
                        flex: 1;
                    " onmouseover="this.style.background='#f9fafb';" onmouseout="this.style.background='white';">
                        1 hour
                    </button>
                    <button class="wv-status-quick-time" data-hours="4" style="
                        padding: 7px 10px;
                        border: 1px solid #e5e7eb;
                        background: white;
                        border-radius: 6px;
                        cursor: pointer;
                        font-size: 12px;
                        color: #6b7280;
                        transition: all 0.1s;
                        flex: 1;
                    " onmouseover="this.style.background='#f9fafb';" onmouseout="this.style.background='white';">
                        4 hours
                    </button>
                    <button class="wv-status-quick-time" data-hours="24" style="
                        padding: 7px 10px;
                        border: 1px solid #e5e7eb;
                        background: white;
                        border-radius: 6px;
                        cursor: pointer;
                        font-size: 12px;
                        color: #6b7280;
                        transition: all 0.1s;
                        flex: 1;
                    " onmouseover="this.style.background='#f9fafb';" onmouseout="this.style.background='white';">
                        Today
                    </button>
                </div>
                <div style="display: flex; gap: 6px; align-items: center;">
                    <input type="datetime-local" class="wv-status-datetime-input" value="${expiryTimestamp ? this.timestampToDatetimeLocal(expiryTimestamp) : ''}" style="
                        flex: 1;
                        padding: 9px 12px;
                        border: 1px solid #d1d5db;
                        border-radius: 6px;
                        font-size: 13px;
                        color: #111827;
                        outline: none;
                        transition: border-color 0.15s, box-shadow 0.15s;
                        box-sizing: border-box;
                    " onfocus="this.style.borderColor='#9ca3af'; this.style.boxShadow='0 0 0 3px rgba(156, 163, 175, 0.1)';" onblur="this.style.borderColor='#d1d5db'; this.style.boxShadow='none';">
                    <button class="wv-status-clear-datetime-btn" title="Clear expiry time" style="
                        padding: 9px 12px;
                        border: 1px solid #e5e7eb;
                        background: white;
                        border-radius: 6px;
                        cursor: pointer;
                        font-size: 13px;
                        color: #6b7280;
                        transition: all 0.1s;
                        font-weight: 500;
                    " onmouseover="this.style.background='#f9fafb'; this.style.color='#374151';" onmouseout="this.style.background='white'; this.style.color='#6b7280';">
                        Clear
                    </button>
                </div>
            </div>

            <div class="wv-status-preview" style="
                margin-top: 16px;
                padding: 12px;
                background: #f9fafb;
                border-radius: 6px;
                border: 1px solid #e5e7eb;
                display: ${statusText ? 'block' : 'none'};
            ">
                <div style="font-size: 11px; font-weight: 600; color: #9ca3af; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px;">
                    Preview
                </div>
                <div class="wv-status-preview-content" style="font-size: 13px; color: #374151;">
                    ${this.escapeHtml(statusText)}${expiryTimestamp ? ` <span style="color: #9ca3af;">(until ${this.formatPreviewExpiry(expiryTimestamp)})</span>` : ''}
                </div>
            </div>
        `;

        return body;
    }

    /**
     * Create dialog footer
     */
    createDialogFooter() {
        const footer = document.createElement('div');
        footer.style.cssText = `
            padding: 16px 20px;
            border-top: 1px solid #e5e7eb;
            display: flex;
            gap: 8px;
            justify-content: flex-end;
            flex-shrink: 0;
            background: #f9fafb;
        `;

        footer.innerHTML = `
            <button class="wv-status-clear-btn" style="
                padding: 7px 14px;
                border: 1px solid #e5e7eb;
                background: white;
                color: #dc2626;
                border-radius: 6px;
                cursor: pointer;
                font-size: 13px;
                font-weight: 500;
                transition: all 0.15s;
                margin-right: auto;
            " onmouseover="this.style.background='#fef2f2';" onmouseout="this.style.background='white';">
                Clear Status
            </button>
            <button class="wv-status-cancel-btn" style="
                padding: 7px 14px;
                border: 1px solid #d1d5db;
                background: white;
                color: #6b7280;
                border-radius: 6px;
                cursor: pointer;
                font-size: 13px;
                font-weight: 500;
                transition: all 0.15s;
            " onmouseover="this.style.background='#f9fafb'; this.style.borderColor='#9ca3af';" onmouseout="this.style.background='white'; this.style.borderColor='#d1d5db';">
                Cancel
            </button>
            <button class="wv-status-save-btn" style="
                padding: 7px 16px;
                border: 1px solid #1f2937;
                background: #1f2937;
                color: white;
                border-radius: 6px;
                cursor: pointer;
                font-size: 13px;
                font-weight: 500;
                transition: all 0.15s;
            " onmouseover="this.style.background='#111827'; this.style.borderColor='#111827';" onmouseout="this.style.background='#1f2937'; this.style.borderColor='#1f2937';">
                Save
            </button>
        `;

        return footer;
    }

    /**
     * Update status preview
     */
    updateStatusPreview(dialog, statusText, datetimeValue) {
        const previewContainer = dialog.querySelector('.wv-status-preview');
        const previewContent = dialog.querySelector('.wv-status-preview-content');

        if (!previewContainer || !previewContent) return;

        if (!statusText || statusText.trim() === '') {
            previewContainer.style.display = 'none';
            return;
        }

        previewContainer.style.display = 'block';

        let previewHtml = this.escapeHtml(statusText);

        if (datetimeValue) {
            const date = new Date(datetimeValue);
            const timestamp = Math.floor(date.getTime() / 1000);
            const expiryStr = this.formatPreviewExpiry(timestamp);
            previewHtml += ` <span style="color: #9ca3af;">(until ${expiryStr})</span>`;
        }

        previewContent.innerHTML = previewHtml;
    }

    /**
     * Set up event listeners for the dialog
     */
    setupDialogEventListeners(dialog, currentStatus) {
        const customInput = dialog.querySelector('.wv-status-custom-input');
        const datetimeInput = dialog.querySelector('.wv-status-datetime-input');
        const charCounter = dialog.querySelector('.wv-status-char-counter');

        // Update preview and character counter on input change
        const updatePreview = () => {
            this.updateStatusPreview(dialog, customInput.value, datetimeInput.value);

            // Update character counter
            if (charCounter) {
                const currentLength = customInput.value.length;
                charCounter.textContent = `${currentLength}/60`;

                // Change color when near limit
                if (currentLength >= 55) {
                    charCounter.style.color = '#ef4444'; // Red
                } else if (currentLength >= 45) {
                    charCounter.style.color = '#f59e0b'; // Orange
                } else {
                    charCounter.style.color = '#9ca3af'; // Gray
                }
            }
        };

        customInput.addEventListener('input', updatePreview);
        datetimeInput.addEventListener('change', updatePreview);

        // Close button
        const closeBtn = dialog.querySelector('.wv-status-close-btn');
        closeBtn.addEventListener('click', () => this.closeDialog());

        // Cancel button
        const cancelBtn = dialog.querySelector('.wv-status-cancel-btn');
        cancelBtn.addEventListener('click', () => this.closeDialog());

        // Preset buttons
        const presetBtns = dialog.querySelectorAll('.wv-status-preset-btn');
        presetBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const status = btn.dataset.status;
                customInput.value = status;

                // Update visual selection
                presetBtns.forEach(b => {
                    b.style.background = 'white';
                    b.style.fontWeight = '400';
                });
                btn.style.background = '#f3f4f6';
                btn.style.fontWeight = '500';

                // Update preview
                updatePreview();
            });
        });

        // Quick time buttons
        const quickTimeBtns = dialog.querySelectorAll('.wv-status-quick-time');
        quickTimeBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const hours = parseInt(btn.dataset.hours);
                let targetDate;

                if (hours === 24) {
                    // "Today" button - set to end of day (23:59)
                    targetDate = this.getEndOfDay();
                } else {
                    // Round to next 15-min interval
                    targetDate = this.roundToNext15Min(hours);
                }

                datetimeInput.value = this.timestampToDatetimeLocal(Math.floor(targetDate.getTime() / 1000));

                // Update preview
                updatePreview();
            });
        });

        // Clear datetime button
        const clearDatetimeBtn = dialog.querySelector('.wv-status-clear-datetime-btn');
        if (clearDatetimeBtn) {
            clearDatetimeBtn.addEventListener('click', () => {
                datetimeInput.value = '';
                console.log('🗑️ [WV STATUS] Datetime cleared');

                // Update preview
                updatePreview();
            });
        }

        // Clear button
        const clearBtn = dialog.querySelector('.wv-status-clear-btn');
        clearBtn.addEventListener('click', async () => {
            // clearStatus will handle closing the dialog on success
            await this.clearStatus();
        });

        // Save button
        const saveBtn = dialog.querySelector('.wv-status-save-btn');
        saveBtn.addEventListener('click', async () => {
            const status = customInput.value.trim();
            const datetimeValue = datetimeInput.value;

            let expiry = null;
            if (datetimeValue) {
                const date = new Date(datetimeValue);
                expiry = Math.floor(date.getTime() / 1000);
            }

            // saveStatus will handle closing the dialog on success
            await this.saveStatus(status, expiry);
        });

        // Close on overlay click (only if not loading)
        dialog.addEventListener('click', (e) => {
            if (e.target === dialog && !this.isLoading) {
                this.closeDialog();
            }
        });

        // Close on Escape key (only if not loading)
        const escapeHandler = (e) => {
            if (e.key === 'Escape') {
                if (!this.isLoading) {
                    this.closeDialog();
                    document.removeEventListener('keydown', escapeHandler);
                } else {
                    console.log('⚠️ [WV STATUS] Cannot close dialog while loading');
                }
            }
        };
        document.addEventListener('keydown', escapeHandler);
    }

    /**
     * Save status
     */
    async saveStatus(status, expiry) {
        if (!status) {
            this.app?.logger?.log('⚠️ No status text provided');
            this.showToast('Please enter a status', 'error');
            return;
        }

        if (this.isLoading) return;

        this.app?.logger?.log('💾 Saving status:', { status, expiry });

        // Set loading state
        this.setLoadingState(true, 'Saving...');

        try {
            await this.app.userIdentity?.updateUserStatus(status, expiry);

            // Track event
            if (this.app.analytics) {
                this.app.analytics.trackEvent('status_updated', {
                    has_expiry: !!expiry,
                    is_preset: this.statusPresets.some(p => p.value === status)
                });
            }

            // Force refresh profile from server to get updated status
            console.log('🔄 [WV STATUS] Refreshing profile after status update...');
            await this.app.userIdentity?.fetchCurrentUserProfile(true); // forceRefresh = true
            console.log('✅ [WV STATUS] Profile refreshed from server');

            // Refresh the sidebar UI to show new status
            console.log('🔄 [WV STATUS] Refreshing sidebar UI...');
            await WVFavs.DomManager?.refreshSidebarStatus();
            console.log('✅ [WV STATUS] Sidebar UI refreshed');

            this.app?.logger?.log('✅ Status saved successfully');

            // Remove loading state before showing toast and closing
            this.setLoadingState(false);

            this.showToast('Status updated successfully', 'success');

            // Close dialog after successful save
            setTimeout(() => this.closeDialog(), 500);
        } catch (error) {
            this.app?.logger?.log('❌ Error saving status:', error);
            console.error('❌ [WV STATUS] Error saving status:', error);
            this.showToast('Failed to save status. Please try again.', 'error');

            // Remove loading state on error
            this.setLoadingState(false);
        }
    }

    /**
     * Clear status
     */
    async clearStatus() {
        if (this.isLoading) return;

        this.app?.logger?.log('🗑️ Clearing status...');

        // Set loading state
        this.setLoadingState(true, 'Clearing...');

        try {
            await this.app.userIdentity?.clearUserStatus();

            // Track event
            if (this.app.analytics) {
                this.app.analytics.trackEvent('status_cleared');
            }

            // Force refresh profile from server to get cleared status
            console.log('🔄 [WV STATUS] Refreshing profile after status clear...');
            await this.app.userIdentity?.fetchCurrentUserProfile(true); // forceRefresh = true
            console.log('✅ [WV STATUS] Profile refreshed from server');

            // Refresh the sidebar UI to show cleared status
            console.log('🔄 [WV STATUS] Refreshing sidebar UI...');
            await WVFavs.DomManager?.refreshSidebarStatus();
            console.log('✅ [WV STATUS] Sidebar UI refreshed');

            this.app?.logger?.log('✅ Status cleared successfully');

            // Remove loading state before showing toast and closing
            this.setLoadingState(false);

            this.showToast('Status cleared', 'success');

            // Close dialog after successful clear
            setTimeout(() => this.closeDialog(), 500);
        } catch (error) {
            this.app?.logger?.log('❌ Error clearing status:', error);
            console.error('❌ [WV STATUS] Error clearing status:', error);
            this.showToast('Failed to clear status. Please try again.', 'error');

            // Remove loading state on error
            this.setLoadingState(false);
        }
    }

    /**
     * Set loading state for the dialog
     */
    setLoadingState(loading, message = 'Loading...') {
        if (!this.currentDialog) return;

        this.isLoading = loading;

        // Get all interactive elements
        const presetBtns = this.currentDialog.querySelectorAll('.wv-status-preset-btn');
        const customInput = this.currentDialog.querySelector('.wv-status-custom-input');
        const datetimeInput = this.currentDialog.querySelector('.wv-status-datetime-input');
        const quickTimeBtns = this.currentDialog.querySelectorAll('.wv-status-quick-time');
        const clearBtn = this.currentDialog.querySelector('.wv-status-clear-btn');
        const cancelBtn = this.currentDialog.querySelector('.wv-status-cancel-btn');
        const saveBtn = this.currentDialog.querySelector('.wv-status-save-btn');
        const closeBtn = this.currentDialog.querySelector('.wv-status-close-btn');

        if (loading) {
            // Disable all inputs
            presetBtns.forEach(btn => {
                btn.disabled = true;
                btn.style.opacity = '0.5';
                btn.style.cursor = 'not-allowed';
                btn.style.pointerEvents = 'none';
            });

            if (customInput) {
                customInput.disabled = true;
                customInput.style.opacity = '0.5';
                customInput.style.cursor = 'not-allowed';
            }

            if (datetimeInput) {
                datetimeInput.disabled = true;
                datetimeInput.style.opacity = '0.5';
                datetimeInput.style.cursor = 'not-allowed';
            }

            quickTimeBtns.forEach(btn => {
                btn.disabled = true;
                btn.style.opacity = '0.5';
                btn.style.cursor = 'not-allowed';
                btn.style.pointerEvents = 'none';
            });

            // Disable buttons
            if (clearBtn) {
                clearBtn.disabled = true;
                clearBtn.style.opacity = '0.5';
                clearBtn.style.cursor = 'not-allowed';
            }

            if (cancelBtn) {
                cancelBtn.disabled = true;
                cancelBtn.style.opacity = '0.5';
                cancelBtn.style.cursor = 'not-allowed';
            }

            if (closeBtn) {
                closeBtn.disabled = true;
                closeBtn.style.opacity = '0.5';
                closeBtn.style.cursor = 'not-allowed';
                closeBtn.style.pointerEvents = 'none';
            }

            // Update save button with loading indicator
            if (saveBtn) {
                saveBtn.disabled = true;
                saveBtn.style.opacity = '0.7';
                saveBtn.innerHTML = `
                    <div style="display: flex; align-items: center; gap: 8px; justify-content: center;">
                        <div style="
                            width: 12px;
                            height: 12px;
                            border: 2px solid rgba(255, 255, 255, 0.3);
                            border-top-color: white;
                            border-radius: 50%;
                            animation: spin 0.6s linear infinite;
                        "></div>
                        <span>${message}</span>
                    </div>
                `;
            }

            // Add spin animation if not already added
            if (!document.querySelector('#wv-status-loading-animation')) {
                const style = document.createElement('style');
                style.id = 'wv-status-loading-animation';
                style.textContent = `
                    @keyframes spin {
                        from { transform: rotate(0deg); }
                        to { transform: rotate(360deg); }
                    }
                `;
                document.head.appendChild(style);
            }

        } else {
            // Re-enable all inputs
            presetBtns.forEach(btn => {
                btn.disabled = false;
                btn.style.opacity = '1';
                btn.style.cursor = 'pointer';
                btn.style.pointerEvents = 'auto';
            });

            if (customInput) {
                customInput.disabled = false;
                customInput.style.opacity = '1';
                customInput.style.cursor = 'text';
            }

            if (datetimeInput) {
                datetimeInput.disabled = false;
                datetimeInput.style.opacity = '1';
                datetimeInput.style.cursor = 'text';
            }

            quickTimeBtns.forEach(btn => {
                btn.disabled = false;
                btn.style.opacity = '1';
                btn.style.cursor = 'pointer';
                btn.style.pointerEvents = 'auto';
            });

            // Re-enable buttons
            if (clearBtn) {
                clearBtn.disabled = false;
                clearBtn.style.opacity = '1';
                clearBtn.style.cursor = 'pointer';
            }

            if (cancelBtn) {
                cancelBtn.disabled = false;
                cancelBtn.style.opacity = '1';
                cancelBtn.style.cursor = 'pointer';
            }

            if (closeBtn) {
                closeBtn.disabled = false;
                closeBtn.style.opacity = '1';
                closeBtn.style.cursor = 'pointer';
                closeBtn.style.pointerEvents = 'auto';
            }

            // Reset save button
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.style.opacity = '1';
                saveBtn.innerHTML = 'Save';
            }
        }
    }

    /**
     * Show toast notification
     */
    showToast(message, type = 'info') {
        // Remove any existing toast
        const existingToast = document.querySelector('.wv-status-toast');
        if (existingToast) {
            existingToast.remove();
        }

        // Create toast
        const toast = document.createElement('div');
        toast.className = 'wv-status-toast';

        const bgColor = type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#3b82f6';

        toast.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: ${bgColor};
            color: white;
            padding: 12px 20px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            z-index: 10001;
            font-size: 14px;
            font-weight: 500;
            animation: slideInRight 0.3s ease-out;
        `;

        toast.textContent = message;
        document.body.appendChild(toast);

        // Auto remove after 3 seconds
        setTimeout(() => {
            toast.style.animation = 'fadeOut 0.3s ease-out';
            setTimeout(() => {
                if (toast.parentNode) {
                    toast.parentNode.removeChild(toast);
                }
            }, 300);
        }, 3000);
    }

    /**
     * Close the dialog
     */
    closeDialog() {
        // Prevent closing if loading
        if (this.isLoading) {
            console.log('⚠️ [WV STATUS] Cannot close dialog while loading');
            return;
        }

        if (this.currentDialog) {
            this.currentDialog.style.animation = 'fadeOut 0.2s ease-out';
            setTimeout(() => {
                if (this.currentDialog && this.currentDialog.parentNode) {
                    this.currentDialog.parentNode.removeChild(this.currentDialog);
                }
                this.currentDialog = null;
                this.isLoading = false;
            }, 200);
        }
    }

    /**
     * Format expiry timestamp for preview display
     */
    formatPreviewExpiry(timestamp) {
        const date = new Date(timestamp * 1000);
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const targetDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());

        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        const timeStr = `${hours}:${minutes}`;

        // Check if same day
        if (targetDay.getTime() === today.getTime()) {
            return timeStr;
        }

        // Check if tomorrow
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        if (targetDay.getTime() === tomorrow.getTime()) {
            return `tomorrow ${timeStr}`;
        }

        // Otherwise show date
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${month}/${day} ${timeStr}`;
    }

    /**
     * Round current time + hours to next 15-minute interval
     * Example: 15:49 + 1 hour = 17:00 (not 16:49)
     */
    roundToNext15Min(hoursToAdd) {
        const now = new Date();
        now.setHours(now.getHours() + hoursToAdd);

        const minutes = now.getMinutes();
        const roundedMinutes = Math.ceil(minutes / 15) * 15;

        if (roundedMinutes === 60) {
            now.setHours(now.getHours() + 1);
            now.setMinutes(0);
        } else {
            now.setMinutes(roundedMinutes);
        }

        now.setSeconds(0);
        now.setMilliseconds(0);
        return now;
    }

    /**
     * Get end of current day (23:59)
     */
    getEndOfDay() {
        const now = new Date();
        now.setHours(23);
        now.setMinutes(59);
        now.setSeconds(0);
        now.setMilliseconds(0);
        return now;
    }

    /**
     * Convert Unix timestamp to datetime-local input format
     */
    timestampToDatetimeLocal(timestamp) {
        const date = new Date(timestamp * 1000);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return `${year}-${month}-${day}T${hours}:${minutes}`;
    }

    /**
     * Escape HTML to prevent XSS
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
};
