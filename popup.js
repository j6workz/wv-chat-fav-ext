// WorkVivo Chat Favorites - Popup Script

class PopupManager {
    constructor() {
        this.statistics = {};
        this.settings = null;
        this.init();
    }
    
    async init() {
        console.log('Popup initializing...');

        // Display version number
        this.displayVersion();

        // Track popup opened event
        await this.trackEvent('popup_opened', {});

        // Load settings
        await this.loadSettings();

        // Set up event listeners
        this.setupEventListeners();

        // Load and setup toggles
        await this.loadToggles();
        this.setupToggleListeners();

        // Load statistics and status
        await this.loadStatistics();
        await this.checkExtensionStatus();

        // Update key commands display
        this.updateKeyCommandsDisplay();

        // Load Google OAuth status
        await this.loadGoogleAuthStatus();

        console.log('Popup ready');
    }

    displayVersion() {
        const versionElement = document.getElementById('version-number');
        if (versionElement) {
            versionElement.textContent = 'v' + chrome.runtime.getManifest().version;
        }
    }

    async loadSettings() {
        try {
            console.log('Loading settings...');
            const result = await chrome.storage.sync.get(['workvivoSettings']);
            this.settings = result.workvivoSettings || {};
            console.log('Settings loaded:', this.settings);
        } catch (error) {
            console.error('Error loading settings:', error);
            this.settings = {};
        }
    }

    async loadToggles() {
        const toggles = [
            'enableThreadsPanel',
            'enableMentionsPanel',
            'enableSearchPanel',
            'enableDrafts',
            'enableStatusUpdates',
            'overrideSearchButton',
            'showSnackbars',
            'autoRedirectToChat',
            'floatingWidgetEnabled',
            'enableGoogleMeet',
            'showPinnedSidebar',
            'showPinIndicator',
            'adasEnabled'
        ];

        toggles.forEach(toggleId => {
            const checkbox = document.getElementById(`toggle-${toggleId}`);
            if (checkbox) {
                // All toggles default to ON (true)
                const defaultValue = true;
                const value = this.settings[toggleId] !== undefined ? this.settings[toggleId] : defaultValue;
                checkbox.checked = value;
            }
        });
    }

    setupToggleListeners() {
        const toggles = [
            'enableThreadsPanel',
            'enableMentionsPanel',
            'enableSearchPanel',
            'enableDrafts',
            'enableStatusUpdates',
            'overrideSearchButton',
            'showSnackbars',
            'autoRedirectToChat',
            'floatingWidgetEnabled',
            'enableGoogleMeet',
            'showPinnedSidebar',
            'showPinIndicator',
            'adasEnabled'
        ];

        toggles.forEach(toggleId => {
            const checkbox = document.getElementById(`toggle-${toggleId}`);
            if (checkbox) {
                checkbox.addEventListener('change', async (e) => {
                    const isChecked = e.target.checked;

                    // Handle master/dependent relationships
                    this.handleMasterToggleChange(checkbox, isChecked);

                    await this.saveToggle(toggleId, isChecked);

                    // Special handling for Google Meet toggle
                    if (toggleId === 'enableGoogleMeet') {
                        this.updateGoogleAuthVisibility(isChecked);
                    }
                });
            }
        });

        // Initialize dependent toggle states
        this.initializeDependentToggles();

        // Initialize Google auth visibility based on current toggle state
        const gmeetCheckbox = document.getElementById('toggle-enableGoogleMeet');
        if (gmeetCheckbox) {
            this.updateGoogleAuthVisibility(gmeetCheckbox.checked);
        }
    }

    /**
     * Handle master toggle changes - disable/enable dependent toggles
     */
    handleMasterToggleChange(masterCheckbox, isChecked) {
        const masterFor = masterCheckbox.dataset.masterFor;
        if (!masterFor) return;

        // Find all dependent toggles
        const dependentCheckbox = document.getElementById(`toggle-${masterFor}`);
        if (dependentCheckbox) {
            if (!isChecked) {
                // Master is OFF - disable and uncheck dependent
                dependentCheckbox.disabled = true;
                if (dependentCheckbox.checked) {
                    dependentCheckbox.checked = false;
                    this.saveToggle(masterFor, false);
                }
            } else {
                // Master is ON - enable dependent
                dependentCheckbox.disabled = false;
            }
        }
    }

    /**
     * Initialize dependent toggle states on load
     */
    initializeDependentToggles() {
        // Find all checkboxes with data-depends-on attribute
        const dependentCheckboxes = document.querySelectorAll('[data-depends-on]');

        dependentCheckboxes.forEach(dependent => {
            const dependsOn = dependent.dataset.dependsOn;
            const masterCheckbox = document.getElementById(`toggle-${dependsOn}`);

            if (masterCheckbox) {
                // Set initial disabled state based on master
                if (!masterCheckbox.checked) {
                    dependent.disabled = true;
                }
            }
        });
    }

    /**
     * Show/hide Google auth section based on GMeet toggle
     */
    updateGoogleAuthVisibility(isEnabled) {
        const authSection = document.getElementById('google-auth-section');
        if (authSection) {
            authSection.style.display = isEnabled ? 'block' : 'none';
        }
    }

    async saveToggle(toggleId, value) {
        try {
            // Update local settings object
            this.settings[toggleId] = value;

            // Save to chrome storage
            await chrome.storage.sync.set({ workvivoSettings: this.settings });

            console.log(`✅ Saved ${toggleId} = ${value}`);

            // Notify content script of settings change
            try {
                const tabs = await chrome.tabs.query({ url: '*://*.workvivo.com/*' });
                if (tabs.length > 0) {
                    for (const tab of tabs) {
                        try {
                            await chrome.tabs.sendMessage(tab.id, {
                                action: 'settingsUpdated',
                                settings: this.settings
                            });
                        } catch (error) {
                            console.log(`Could not notify tab ${tab.id}:`, error.message);
                        }
                    }
                }
            } catch (error) {
                console.log('Could not notify content scripts:', error);
            }

        } catch (error) {
            console.error(`Error saving ${toggleId}:`, error);
        }
    }

    setupEventListeners() {
        // Settings button
        document.getElementById('settingsBtn').addEventListener('click', () => {
            this.trackEvent('popup_settings_clicked', {});
            this.openSettings();
        });

        // Google sign-in button
        const signInBtn = document.getElementById('google-sign-in-btn');
        if (signInBtn) {
            signInBtn.addEventListener('click', () => this.handleGoogleSignIn());
        }

        // Google sign-out button
        const signOutBtn = document.getElementById('google-sign-out-btn');
        if (signOutBtn) {
            signOutBtn.addEventListener('click', () => this.handleGoogleSignOut());
        }
    }
    
    async loadStatistics() {
        try {
            console.log('Popup: Loading statistics...');

            // Initialize default statistics
            const defaultStats = {
                searchWidgetOpened: 0,
                searchesPerformed: 0,
                chatClicks: 0,
                chatsPinned: 0,
                currentlyPinned: 0,
                chatSwitcherOpened: 0,
                switcherSelections: 0,
                usersInDatabase: 0,
                keywordsIndexed: 0,
                cacheHitRate: 0
            };

            let statistics = { ...defaultStats };

            // Try to get statistics from content script (IndexedDB)
            try {
                const tabs = await chrome.tabs.query({ url: '*://*.workvivo.com/*' });
                console.log('Popup: Found', tabs.length, 'WorkVivo tabs for statistics');

                if (tabs.length > 0) {
                    for (const tab of tabs) {
                        try {
                            console.log(`Popup: Requesting statistics from tab ${tab.id}`);
                            const response = await chrome.tabs.sendMessage(tab.id, { action: 'getStatistics' });
                            console.log('Popup: Statistics response from tab', tab.id, ':', response);

                            if (response && typeof response === 'object') {
                                statistics = { ...defaultStats, ...response };
                                console.log('✅ Popup loaded statistics from IndexedDB via tab', tab.id);
                                break; // Found data, stop trying other tabs
                            }
                        } catch (tabError) {
                            console.log(`❌ Tab ${tab.id} not responding for statistics:`, tabError.message);
                        }
                    }
                } else {
                    console.log('⚠️ No WorkVivo tabs found for statistics');
                }
            } catch (error) {
                console.log('❌ Popup: Error getting statistics from content script:', error);
            }

            // Fallback to chrome.storage for basic stats
            try {
                const result = await chrome.storage.sync.get(['workvivoStatistics']);
                if (result.workvivoStatistics && typeof result.workvivoStatistics === 'object') {
                    statistics = { ...statistics, ...result.workvivoStatistics };
                    console.log('📊 Loaded fallback statistics from storage');
                }
            } catch (error) {
                console.log('Could not load fallback statistics from storage');
            }

            this.statistics = statistics;
            this.updateStatisticsDisplay();

        } catch (error) {
            console.error('Error loading statistics:', error);
            this.showError('Failed to load statistics');
        }
    }

    updateStatisticsDisplay() {
        const stats = this.statistics || {};

        // Update statistics in the popup - only update elements that exist
        const currentlyPinnedEl = document.getElementById('currentlyPinned');
        const searchesPerformedEl = document.getElementById('searchesPerformed');
        const chatClicksEl = document.getElementById('chatClicks');
        const usersInDatabaseEl = document.getElementById('usersInDatabase');

        if (currentlyPinnedEl) currentlyPinnedEl.textContent = stats.currentlyPinned || 0;
        if (searchesPerformedEl) searchesPerformedEl.textContent = stats.searchesPerformed || 0;
        if (chatClicksEl) chatClicksEl.textContent = stats.chatClicks || 0;
        if (usersInDatabaseEl) usersInDatabaseEl.textContent = stats.usersInDatabase || 0;

        console.log('✅ Statistics display updated successfully');
    }

    async clearStatistics() {
        if (!confirm('Clear all usage statistics? This action cannot be undone.')) {
            return;
        }

        try {
            // Clear from chrome.storage
            await chrome.storage.sync.remove(['workvivoStatistics']);

            // Clear from content script (IndexedDB)
            try {
                const tabs = await chrome.tabs.query({ url: '*://*.workvivo.com/*' });
                if (tabs.length > 0) {
                    for (const tab of tabs) {
                        try {
                            await chrome.tabs.sendMessage(tab.id, { action: 'clearStatistics' });
                            console.log('✅ Statistics cleared on tab', tab.id);
                            break; // Only need to clear on one tab
                        } catch (tabError) {
                            console.log(`❌ Tab ${tab.id} not responding for clear:`, tabError.message);
                        }
                    }
                }
            } catch (error) {
                console.log('Could not clear statistics from content script:', error);
            }

            // Reset display
            this.statistics = {};
            this.updateStatisticsDisplay();
            this.showSuccess('Statistics cleared successfully');

        } catch (error) {
            console.error('Error clearing statistics:', error);
            this.showError('Failed to clear statistics');
        }
    }
    
    async checkExtensionStatus() {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            const statusEl = document.getElementById('status');
            
            if (!tab || !tab.url) {
                this.setStatus('inactive', 'No active tab');
                return;
            }
            
            if (tab.url.includes('workvivo.com')) {
                // Try to ping content script
                try {
                    await chrome.tabs.sendMessage(tab.id, { action: 'ping' });
                    this.setStatus('active', 'Connected to WorkVivo');
                } catch (error) {
                    this.setStatus('inactive', 'Extension not loaded on this page');
                }
            } else {
                this.setStatus('inactive', 'Navigate to WorkVivo to use this extension');
            }
        } catch (error) {
            this.setStatus('inactive', 'Error checking status');
        }
    }
    
    setStatus(type, message) {
        const statusEl = document.getElementById('status');
        statusEl.className = `status ${type}`;
        statusEl.querySelector('span').textContent = message;
    }
    
    updateUI() {
        // Update counts
        document.getElementById('pinnedCount').textContent = this.pinnedChats.length;
        
        // Update pinned list
        this.renderPinnedList();
    }
    
    renderPinnedList() {
        const listContainer = document.getElementById('pinnedList');
        
        if (this.pinnedChats.length === 0) {
            listContainer.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">📭</div>
                    <div class="empty-text">No pinned chats yet</div>
                    <div class="empty-subtext">Pin some chats in WorkVivo to see them here</div>
                </div>
            `;
            return;
        }
        
        // Sort by pin date (most recent first)
        const sortedChats = [...this.pinnedChats].sort((a, b) => {
            const dateA = new Date(a[1].pinnedAt || 0);
            const dateB = new Date(b[1].pinnedAt || 0);
            return dateB - dateA;
        });
        
        listContainer.innerHTML = sortedChats.map(([chatId, chatData]) => `
            <div class="pinned-item" data-chat-id="${chatId}">
                <div class="pinned-name" title="${chatData.name}">${chatData.name}</div>
                <div class="pinned-date">${this.formatDate(chatData.pinnedAt)}</div>
            </div>
        `).join('');
        
        // Add click handlers
        listContainer.querySelectorAll('.pinned-item').forEach(item => {
            item.addEventListener('click', () => {
                const chatId = item.getAttribute('data-chat-id');
                this.navigateToChat(chatId);
            });
        });
    }
    
    formatDate(dateString) {
        if (!dateString) return '';
        
        const date = new Date(dateString);
        const now = new Date();
        const diffMs = now - date;
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        
        if (diffDays === 0) {
            return 'Today';
        } else if (diffDays === 1) {
            return 'Yesterday';
        } else if (diffDays < 7) {
            return `${diffDays}d ago`;
        } else {
            return date.toLocaleDateString();
        }
    }
    
    async navigateToChat(chatId) {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab && tab.url && tab.url.includes('workvivo.com')) {
                // Find the chat data
                const chatData = this.pinnedChats.find(([id]) => id === chatId);
                if (chatData) {
                    // Focus the tab and send navigation message
                    await chrome.tabs.update(tab.id, { active: true });
                    await chrome.tabs.sendMessage(tab.id, { 
                        action: 'navigateToChat', 
                        chatData: chatData[1] 
                    });
                    
                    // Close popup
                    window.close();
                }
            } else {
                this.showError('Please navigate to WorkVivo first');
            }
        } catch (error) {
            console.error('Error navigating to chat:', error);
            this.showError('Failed to navigate to chat');
        }
    }
    
    async exportPinnedChats() {
        if (this.pinnedChats.length === 0) {
            this.showError('No pinned chats to export');
            return;
        }

        try {
            // Use the same export format as options page for consistency
            const exportData = {
                version: chrome.runtime.getManifest().version,
                exportDate: new Date().toISOString(),
                pinnedChats: this.pinnedChats,
                settings: this.settings || {}
            };

            const dataStr = JSON.stringify(exportData, null, 2);
            const dataBlob = new Blob([dataStr], { type: 'application/json' });

            const url = URL.createObjectURL(dataBlob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `workvivo-favorites-backup-${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);

            this.showSuccess(`Exported ${this.pinnedChats.length} pinned chats successfully`);

        } catch (error) {
            console.error('Error exporting data:', error);
            this.showError('Error exporting data');
        }
    }
    
    importPinnedChats() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        
        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            try {
                const text = await file.text();
                const importData = JSON.parse(text);

                let pinnedChatsData;
                let importCount;

                // Handle both old and new export formats
                if (Array.isArray(importData)) {
                    // Old format: direct array of pinned chats
                    pinnedChatsData = importData;
                    importCount = importData.length;
                } else if (importData.pinnedChats && Array.isArray(importData.pinnedChats)) {
                    // New format: comprehensive backup with version, settings, etc.
                    pinnedChatsData = importData.pinnedChats;
                    importCount = importData.pinnedChats.length;

                    // Optionally import settings if they exist and user wants them
                    if (importData.settings && confirm('Also import extension settings from backup?')) {
                        await chrome.storage.sync.set({ workvivoSettings: importData.settings });
                        this.settings = importData.settings;
                    }
                } else {
                    this.showError('Invalid backup file format');
                    return;
                }

                // Confirm the import if there are existing chats
                const currentCount = this.pinnedChats.length;
                if (currentCount > 0) {
                    const confirmMessage = `This will replace your ${currentCount} existing pinned chats with ${importCount} chats from the backup. Continue?`;
                    if (!confirm(confirmMessage)) {
                        return;
                    }
                }

                // Save to storage
                await chrome.storage.sync.set({ workvivoFavorites: pinnedChatsData });

                // Update content script if available
                try {
                    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                    if (tab && tab.url && tab.url.includes('workvivo.com')) {
                        await chrome.tabs.sendMessage(tab.id, {
                            action: 'importPinnedChats',
                            data: pinnedChatsData
                        });
                    }
                } catch (error) {
                    console.log('Could not update content script:', error.message);
                }

                // Reload data
                await this.loadPinnedChats();
                this.showSuccess(`Successfully imported ${importCount} pinned chats`);

            } catch (error) {
                console.error('Error importing:', error);
                if (error instanceof SyntaxError) {
                    this.showError('Invalid JSON file format');
                } else {
                    this.showError('Failed to import favorites');
                }
            }
        };
        
        input.click();
    }
    
    async clearAllPinnedChats() {
        if (this.pinnedChats.length === 0) {
            this.showError('No pinned chats to clear');
            return;
        }

        if (!confirm(`Are you sure you want to clear all ${this.pinnedChats.length} pinned chats?`)) {
            return;
        }

        try {
            // Clear from storage using modularized system
            if (typeof WVFavs !== 'undefined' && WVFavs.StorageManager) {
                await WVFavs.StorageManager.savePinnedChats(new Map());
            } else {
                console.warn('Modular StorageManager not available, using direct storage access');
                await chrome.storage.sync.remove(['workvivoFavorites']);
            }

            // Clear from content script if available
            try {
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                if (tab && tab.url && tab.url.includes('workvivo.com')) {
                    await chrome.tabs.sendMessage(tab.id, { action: 'clearAllPinned' });
                }
            } catch (error) {
                console.log('Could not update content script:', error.message);
            }

            // Reload data
            await this.loadPinnedChats();
            this.showSuccess('All favorites cleared');
        } catch (error) {
            console.error('Error clearing favorites:', error);
            this.showError('Failed to clear favorites');
        }
    }
    
    showSuccess(message) {
        this.showNotification(message, 'success');
    }
    
    showError(message) {
        this.showNotification(message, 'error');
    }
    
    openSettings() {
        // Open the extension options page
        chrome.runtime.openOptionsPage();
    }
    
    updateKeyCommandsDisplay() {
        const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
        const settings = this.settings || {};

        let searchKey, switcherKey, osName;

        if (isMac) {
            // Mac always uses Cmd
            searchKey = '⌘ /';
            switcherKey = '⌘ \\';
            osName = 'Mac';
        } else {
            // Windows uses configurable modifier key
            const modifier = settings.windowsModifierKey || 'ctrl';
            let modifierDisplay;

            switch (modifier) {
                case 'ctrl':
                    modifierDisplay = 'Ctrl';
                    break;
                case 'both':
                    modifierDisplay = 'Alt or Ctrl';
                    break;
                case 'alt':
                    modifierDisplay = 'Alt';
                    break;
                default:
                    modifierDisplay = 'Ctrl';
                    break;
            }

            searchKey = `${modifierDisplay} + /`;
            switcherKey = `${modifierDisplay} + \\`;
            osName = 'Windows';
        }

        // Helper function to create keyboard key representation
        const kbd = (key) => `<kbd class="kbd">${key}</kbd>`;

        // Build keyboard shortcuts with proper key representations
        let searchKeys, switcherKeys;

        if (isMac) {
            searchKeys = `${kbd('⌘')} ${kbd('/')}`;
            switcherKeys = `${kbd('⌘')} ${kbd('\\')}`;
        } else {
            const modifier = settings.windowsModifierKey || 'ctrl';
            let modKeys;

            switch (modifier) {
                case 'ctrl':
                    modKeys = kbd('Ctrl');
                    break;
                case 'both':
                    modKeys = `${kbd('Alt')} or ${kbd('Ctrl')}`;
                    break;
                case 'alt':
                    modKeys = kbd('Alt');
                    break;
                default:
                    modKeys = kbd('Ctrl');
                    break;
            }

            searchKeys = `${modKeys} + ${kbd('/')}`;
            switcherKeys = `${modKeys} + ${kbd('\\')}`;
        }

        // Update the key commands instructions with simplified, OS-aware tips
        const instructionsEl = document.getElementById('keyCommands');
        if (instructionsEl) {
            instructionsEl.innerHTML = `
                📌 <strong>Pin a chat:</strong> Open any chat, hover over the avatar in chat header, click pin icon<br><br>
                🔍 <strong>Quick search:</strong> Press ${searchKeys} or double-click the floating button<br><br>
                🔄 <strong>Recent chats:</strong> Hold ${isMac ? kbd('⌘') : kbd(settings.windowsModifierKey === 'ctrl' ? 'Ctrl' : 'Alt')} then press ${kbd('\\')} to cycle, release to open<br><br>
                🎯 <strong>Reorder pinned:</strong> Drag any avatar in the sidebar's pinned section<br><br>
                💬 <strong>View threads:</strong> Click the Threads icon in chat header to open threads panel
            `;
        }
    }

    showNotification(message, type) {
        // Simple notification - could be enhanced
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 10px;
            right: 10px;
            padding: 8px 12px;
            background: ${type === 'success' ? '#28a745' : '#dc3545'};
            color: white;
            border-radius: 4px;
            font-size: 12px;
            z-index: 1000;
            animation: slideIn 0.3s ease;
        `;
        notification.textContent = message;

        document.body.appendChild(notification);
        setTimeout(() => {
            notification.remove();
        }, 3000);
    }

    /**
     * Load Google OAuth authentication status
     * Now triggers automatic token refresh if needed
     */
    async loadGoogleAuthStatus() {
        try {
            // Show loading state
            this.showGoogleAuthState('loading');

            // Check token and trigger refresh if needed
            const response = await chrome.runtime.sendMessage({
                action: 'CHECK_GOOGLE_MEET_TOKEN'
            });

            if (response && response.success && response.isSignedIn) {
                // Signed in - display profile
                this.showGoogleAuthState('signed-in', response.userProfile);
            } else {
                // Not signed in or token refresh failed
                this.showGoogleAuthState('signed-out');
            }

        } catch (error) {
            console.error('Error loading Google auth status:', error);
            this.showGoogleAuthState('signed-out');
        }
    }

    /**
     * Show appropriate Google auth UI state
     */
    showGoogleAuthState(state, profile = null) {
        const signedOutEl = document.getElementById('google-signed-out');
        const signedInEl = document.getElementById('google-signed-in');
        const loadingEl = document.getElementById('google-loading');

        // Hide all states first
        signedOutEl.style.display = 'none';
        signedInEl.style.display = 'none';
        loadingEl.style.display = 'none';

        switch (state) {
            case 'loading':
                loadingEl.style.display = 'block';
                break;

            case 'signed-out':
                signedOutEl.style.display = 'block';
                break;

            case 'signed-in':
                if (profile) {
                    document.getElementById('google-profile-name').textContent = profile.name || 'User';
                    document.getElementById('google-profile-email').textContent = profile.email || '';
                    document.getElementById('google-profile-picture').src = profile.picture || 'icons/icon48.png';
                }
                signedInEl.style.display = 'block';
                break;
        }
    }

    /**
     * Handle Google sign-in button click
     */
    async handleGoogleSignIn() {
        try {
            this.showGoogleAuthState('loading');

            // Send message to background script to initiate OAuth flow
            const response = await chrome.runtime.sendMessage({ action: 'GOOGLE_MEET_AUTH' });

            if (response && response.success) {
                // Sign-in successful
                await this.trackEvent('google_signin_success', {});
                this.showGoogleAuthState('signed-in', response.userProfile);
            } else {
                throw new Error(response?.error || 'Authentication failed');
            }

        } catch (error) {
            console.error('Google sign-in error:', error);
            await this.trackEvent('google_signin_error', { error: error.message });
            this.showGoogleAuthState('signed-out');
            alert('Failed to sign in with Google. Please try again.');
        }
    }

    /**
     * Handle Google sign-out button click
     */
    async handleGoogleSignOut() {
        try {
            if (!confirm('Sign out of Google Meet integration?')) {
                return;
            }

            this.showGoogleAuthState('loading');

            // Get current auth data for token revocation
            const result = await chrome.storage.local.get('googleMeetAuth');
            const token = result.googleMeetAuth?.accessToken;

            // Send message to background script to sign out
            await chrome.runtime.sendMessage({
                action: 'GOOGLE_MEET_SIGN_OUT',
                token: token
            });

            // Track sign-out
            await this.trackEvent('google_signout_success', {});

            // Update UI
            this.showGoogleAuthState('signed-out');

        } catch (error) {
            console.error('Google sign-out error:', error);
            // Still show signed-out state even if revocation fails
            this.showGoogleAuthState('signed-out');
        }
    }

    /**
     * Track analytics events from popup
     * Device/geo data is added centrally by background script
     */
    async trackEvent(eventName, parameters = {}) {
        try {
            // Check if analytics is enabled
            const settings = await chrome.storage.sync.get(['workvivoSettings']);
            const analyticsEnabled = settings.workvivoSettings?.analyticsEnabled;

            // Don't send events if analytics is disabled
            if (analyticsEnabled === false) {
                return;
            }

            // Get persistent client_id from storage
            const result = await chrome.storage.local.get(['analytics_client_id']);
            const clientId = result.analytics_client_id || this.generateClientId();

            // Save client_id if it was just generated
            if (!result.analytics_client_id) {
                await chrome.storage.local.set({ analytics_client_id: clientId });
            }

            // Create event payload (background script will add device/geo)
            const eventPayload = {
                client_id: clientId,
                events: [{
                    name: eventName,
                    params: {
                        engagement_time_msec: 100,
                        source: 'popup',
                        ...parameters
                    }
                }]
            };

            // Send to background script (which handles device/geo centrally)
            chrome.runtime.sendMessage({
                action: 'sendGA4Event',
                eventData: eventPayload
            }).catch(() => {
                // Failed to track popup event - handled silently
            });
        } catch (error) {
            // Error tracking popup event - handled silently
        }
    }

    /**
     * Generate UUID for client ID
     */
    generateClientId() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }
}

// Initialize popup when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    new PopupManager();
});

// Add slide-in animation
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
`;
document.head.appendChild(style);
