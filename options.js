// WorkVivo Chat Favorites - Options Page Script

class OptionsManager {
    constructor() {
        this.settings = null;
        this.statistics = {};
        this.init();
    }
    
    async init() {
        console.log('📋 Options page initializing...');

        // Display version number
        this.displayVersion();

        // Track options page opened event
        await this.trackEvent('options_page_opened', {});

        try {
            // Detect platform and hide Windows-specific settings on other platforms
            this.detectPlatform();

            // Load current settings
            await this.loadSettings();

            // Set up event listeners
            this.setupEventListeners();

            // Load statistics
            await this.loadStatistics();

            // Load feature stability status
            await this.loadFeatureStabilityStatus();

            // Initialize jurisdiction-aware privacy UI
            await this.initJurisdictionAwarePrivacy();

            // Add debug utility
            window.wvOptionsDebug = {
                refreshStats: async () => {
                    console.log('🔄 Refreshing statistics...');
                    await this.loadStatistics();
                },
                clearStats: async () => {
                    console.log('🗑️ Clearing statistics...');
                    await this.clearStatistics();
                },
                showRawSettings: async () => {
                    const result = await chrome.storage.sync.get(['workvivoSettings']);
                    console.log('Raw settings data:', result);
                    return result;
                },
                checkTabs: async () => {
                    const tabs = await chrome.tabs.query({ url: '*://*.workvivo.com/*' });
                    console.log('WorkVivo tabs:', tabs.map(t => ({ id: t.id, url: t.url, title: t.title })));
                    return tabs;
                }
            };

            console.log('✅ Options page ready');
        } catch (error) {
            // Error during options page initialization - handled silently
        }
    }

    displayVersion() {
        const versionElement = document.getElementById('version-display');
        if (versionElement) {
            versionElement.textContent = 'v' + chrome.runtime.getManifest().version;
        }
    }

    detectPlatform() {
        const userAgent = navigator.userAgent.toLowerCase();
        const isMac = userAgent.indexOf('mac') >= 0;
        const isLinux = userAgent.indexOf('linux') >= 0;
        const isWindows = userAgent.indexOf('win') >= 0;

        // Add platform class to body for CSS targeting
        if (isMac) {
            document.body.classList.add('mac');
        } else if (isLinux) {
            document.body.classList.add('linux');
        } else if (isWindows) {
            document.body.classList.add('windows');
        }

        console.log('Platform detected:', { isMac, isLinux, isWindows });
    }

    async loadSettings() {
        try {
            console.log('Loading settings in options page...');
            const result = await chrome.storage.sync.get(['workvivoSettings']);
            // Use default settings
            const defaultSettings = {
                showScrollbar: true,
                showPinIndicator: true,
                showPinnedSidebar: true,
                pinnedChatsLayout: 'carousel',
                autoCollapse: true,
                debugLogging: false,
                enableDrafts: true,
                enableMentionsPanel: true,
                enableThreadsPanel: true,
                enableSearchPanel: true,
                enableStatusUpdates: true,
                overrideSearchButton: true,
                showSnackbars: true,
                windowsModifierKey: 'ctrl',
                floatingWidgetEnabled: true,
                floatingWidgetFirstClick: 'recents',
                floatingButtonColor: '#007ACC',
                autoRedirectToChat: true,
                googleMeetInviteText: 'Join the Google Meet using the link: ',
                googleMeetDuration: 30,
                googleMeetConfirmBeforeCreate: false,
                analyticsEnabled: false,
                shareUsageData: false,
                errorReporting: true
            };
            this.settings = { ...defaultSettings, ...result.workvivoSettings };
            console.log('Options settings loaded:', this.settings);

            // Update UI elements
            document.getElementById('showScrollbar').checked = this.settings.showScrollbar;
            document.getElementById('showPinIndicator').checked = this.settings.showPinIndicator;
            document.getElementById('showPinnedSidebar').checked = this.settings.showPinnedSidebar;
            document.getElementById('pinnedChatsLayout').value = this.settings.pinnedChatsLayout || 'carousel';
            document.getElementById('autoCollapse').checked = this.settings.autoCollapse;
            document.getElementById('debugLogging').checked = this.settings.debugLogging;
            document.getElementById('enableDrafts').checked = this.settings.enableDrafts !== false;
            document.getElementById('enableMentionsPanel').checked = this.settings.enableMentionsPanel !== false;
            document.getElementById('enableThreadsPanel').checked = this.settings.enableThreadsPanel !== false;
            document.getElementById('enableSearchPanel').checked = this.settings.enableSearchPanel !== false;
            document.getElementById('enableStatusUpdates').checked = this.settings.enableStatusUpdates !== false;
            document.getElementById('overrideSearchButton').checked = this.settings.overrideSearchButton || false;
            document.getElementById('showSnackbars').checked = this.settings.showSnackbars;
            document.getElementById('windowsModifierKey').value = this.settings.windowsModifierKey;
            document.getElementById('floatingWidgetEnabled').checked = this.settings.floatingWidgetEnabled;
            document.getElementById('floatingWidgetFirstClick').value = this.settings.floatingWidgetFirstClick || 'recents';
            document.getElementById('floatingButtonColor').value = this.settings.floatingButtonColor || '#007ACC';
            document.getElementById('autoRedirectToChat').checked = this.settings.autoRedirectToChat || false;

            // Google Meet settings
            const googleMeetInviteTextInput = document.getElementById('googleMeetInviteText');
            if (googleMeetInviteTextInput) {
                googleMeetInviteTextInput.value = this.settings.googleMeetInviteText || '';
            }

            const googleMeetDurationSelect = document.getElementById('googleMeetDuration');
            if (googleMeetDurationSelect) {
                googleMeetDurationSelect.value = this.settings.googleMeetDuration || 30;
            }

            const googleMeetConfirmCheckbox = document.getElementById('googleMeetConfirmBeforeCreate');
            if (googleMeetConfirmCheckbox) {
                googleMeetConfirmCheckbox.checked = this.settings.googleMeetConfirmBeforeCreate || false;
            }

            // Analytics settings
            document.getElementById('analyticsEnabled').checked = this.settings.analyticsEnabled;
            document.getElementById('shareUsageData').checked = this.settings.shareUsageData;
            document.getElementById('errorReporting').checked = this.settings.errorReporting;

            // Update dependent options visibility
            this.updateSidebarOptionsVisibility();

            // Load last chat page URL
            await this.loadLastChatPageUrl();

            console.log('Settings loaded:', this.settings);
        } catch (error) {
            // Error loading settings - handled silently
            this.showStatus('Error loading settings', 'error');
        }
    }

    async loadLastChatPageUrl() {
        try {
            const result = await chrome.storage.local.get(['lastChatPageUrl']);
            const urlInput = document.getElementById('lastChatPageUrl');

            if (urlInput) {
                if (result.lastChatPageUrl) {
                    urlInput.value = result.lastChatPageUrl;
                    urlInput.style.background = '#f0f9ff';
                } else {
                    urlInput.value = '';
                    urlInput.placeholder = 'No chat page URL saved yet. Visit a chat page to save one automatically.';
                }
            }
        } catch (error) {
            console.error('Error loading last chat page URL:', error);
        }
    }

    async editChatPageUrl() {
        const urlInput = document.getElementById('lastChatPageUrl');
        const currentUrl = urlInput.value;

        const newUrl = prompt(
            'Enter the chat page URL to use for auto-redirect:\n\n' +
            '(This should be a full WorkVivo chat URL like https://yourcompany.workvivo.com/chat)',
            currentUrl
        );

        // User cancelled
        if (newUrl === null) {
            return;
        }

        // Validate URL
        if (newUrl.trim() && !newUrl.includes('/chat')) {
            this.showStatus('⚠️ URL should contain "/chat" to be a valid chat page', 'error');
            return;
        }

        if (newUrl.trim() && !newUrl.startsWith('http')) {
            this.showStatus('⚠️ URL should start with http:// or https://', 'error');
            return;
        }

        try {
            if (newUrl.trim()) {
                // Save the new URL
                await chrome.storage.local.set({ lastChatPageUrl: newUrl.trim() });
                urlInput.value = newUrl.trim();
                urlInput.style.background = '#f0f9ff';
                this.showStatus('✅ Chat page URL updated successfully', 'success');
            } else {
                // Clear the URL
                await chrome.storage.local.remove(['lastChatPageUrl']);
                urlInput.value = '';
                urlInput.placeholder = 'No chat page URL saved yet. Visit a chat page to save one automatically.';
                this.showStatus('🗑️ Chat page URL cleared', 'success');
            }
        } catch (error) {
            console.error('Error saving chat page URL:', error);
            this.showStatus('❌ Error saving URL', 'error');
        }
    }

    async clearChatPageUrl() {
        if (!confirm('Clear the saved chat page URL?\n\nYou can save a new one by visiting any chat page.')) {
            return;
        }

        try {
            await chrome.storage.local.remove(['lastChatPageUrl']);
            const urlInput = document.getElementById('lastChatPageUrl');
            if (urlInput) {
                urlInput.value = '';
                urlInput.placeholder = 'No chat page URL saved yet. Visit a chat page to save one automatically.';
                urlInput.style.background = '#f8f9fa';
            }
            this.showStatus('🗑️ Chat page URL cleared successfully', 'success');
        } catch (error) {
            console.error('Error clearing chat page URL:', error);
            this.showStatus('❌ Error clearing URL', 'error');
        }
    }
    
    async saveSettings() {
        try {
            const oldSettings = { ...this.settings };

            const settings = {
                showScrollbar: document.getElementById('showScrollbar').checked,
                showPinIndicator: document.getElementById('showPinIndicator').checked,
                showPinnedSidebar: document.getElementById('showPinnedSidebar').checked,
                pinnedChatsLayout: document.getElementById('pinnedChatsLayout').value,
                autoCollapse: document.getElementById('autoCollapse').checked,
                debugLogging: document.getElementById('debugLogging').checked,
                enableDrafts: document.getElementById('enableDrafts').checked,
                enableMentionsPanel: document.getElementById('enableMentionsPanel').checked,
                enableThreadsPanel: document.getElementById('enableThreadsPanel').checked,
                enableSearchPanel: document.getElementById('enableSearchPanel').checked,
                enableStatusUpdates: document.getElementById('enableStatusUpdates').checked,
                overrideSearchButton: document.getElementById('overrideSearchButton').checked,
                showSnackbars: document.getElementById('showSnackbars').checked,
                windowsModifierKey: document.getElementById('windowsModifierKey').value,
                floatingWidgetEnabled: document.getElementById('floatingWidgetEnabled').checked,
                floatingWidgetFirstClick: document.getElementById('floatingWidgetFirstClick').value,
                floatingButtonColor: document.getElementById('floatingButtonColor').value,
                autoRedirectToChat: document.getElementById('autoRedirectToChat').checked,
                googleMeetInviteText: document.getElementById('googleMeetInviteText')?.value || '',
                googleMeetDuration: parseInt(document.getElementById('googleMeetDuration')?.value) || 30,
                googleMeetConfirmBeforeCreate: document.getElementById('googleMeetConfirmBeforeCreate')?.checked || false,
                analyticsEnabled: document.getElementById('analyticsEnabled').checked,
                shareUsageData: document.getElementById('shareUsageData').checked,
                errorReporting: document.getElementById('errorReporting').checked
            };

            // Track settings changes
            this.trackSettingsChanges(oldSettings, settings);

            // Save settings directly
            await chrome.storage.sync.set({ workvivoSettings: settings });
            this.settings = settings;

            // Notify content script of settings change - send to ALL WorkVivo tabs
            try {
                const tabs = await chrome.tabs.query({ url: '*://*.workvivo.com/*' });
                for (const tab of tabs) {
                    try {
                        await chrome.tabs.sendMessage(tab.id, {
                            action: 'updateSettings',
                            settings: settings
                        });
                    } catch (tabError) {
                        // Tab not ready or not responding - silent fail
                    }
                }
            } catch (error) {
                // Could not notify content script - silent fail
            }

            this.showStatus('Settings saved successfully!', 'success');
        } catch (error) {
            // Error saving settings - handled silently
            this.showStatus('Error saving settings', 'error');
        }
    }
    
    async loadStatistics() {
        try {
            console.log('Options: Loading comprehensive statistics...');

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
                console.log('Options: Found', tabs.length, 'WorkVivo tabs for statistics');

                if (tabs.length > 0) {
                    for (const tab of tabs) {
                        try {
                            console.log(`Options: Requesting statistics from tab ${tab.id}`);
                            const response = await chrome.tabs.sendMessage(tab.id, { action: 'getStatistics' });
                            console.log('Options: Statistics response from tab', tab.id, ':', response);

                            if (response && typeof response === 'object') {
                                statistics = { ...defaultStats, ...response };
                                console.log('✅ Options loaded statistics from IndexedDB via tab', tab.id);
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
                console.log('❌ Options: Error getting statistics from content script:', error);
            }

            // Fallback to chrome.storage for basic stats
            try {
                const result = await chrome.storage.local.get(['workvivoStatistics']);
                if (result.workvivoStatistics && typeof result.workvivoStatistics === 'object') {
                    statistics = { ...statistics, ...result.workvivoStatistics };
                    console.log('📊 Loaded fallback statistics from storage');
                }
            } catch (error) {
                console.log('Could not load fallback statistics from storage');
            }

            // Update all statistics displays
            this.updateStatisticsDisplay(statistics);
            this.statistics = statistics;

            console.log('✅ Options: Statistics updated successfully');

        } catch (error) {
            // Error loading statistics - handled silently
        }
    }

    updateStatisticsDisplay(stats) {
        // Update all statistic elements
        document.getElementById('searchWidgetOpened').textContent = stats.searchWidgetOpened || 0;
        document.getElementById('searchesPerformed').textContent = stats.searchesPerformed || 0;
        document.getElementById('chatClicks').textContent = stats.chatClicks || 0;
        document.getElementById('chatsPinned').textContent = stats.chatsPinned || 0;
        document.getElementById('currentlyPinned').textContent = stats.currentlyPinned || 0;
        document.getElementById('chatSwitcherOpened').textContent = stats.chatSwitcherOpened || 0;
        document.getElementById('switcherSelections').textContent = stats.switcherSelections || 0;
        document.getElementById('usersInDatabase').textContent = stats.usersInDatabase || 0;
        document.getElementById('keywordsIndexed').textContent = stats.keywordsIndexed || 0;

        // Calculate and display cache hit rate
        const hitRate = stats.cacheHitRate || 0;
        document.getElementById('cacheHitRate').textContent = `${hitRate}%`;
    }

    /**
     * Load and display feature stability status
     */
    async loadFeatureStabilityStatus() {
        const statusContent = document.getElementById('stabilityStatusContent');
        const disabledSection = document.getElementById('disabledFeaturesSection');
        const disabledList = document.getElementById('disabledFeaturesList');

        if (!statusContent) return;

        try {
            // Get cached config from storage
            const result = await chrome.storage.local.get(['wvfav_feature_stability', 'wvfav_feature_stability_timestamp']);
            const config = result.wvfav_feature_stability;
            const timestamp = result.wvfav_feature_stability_timestamp;

            // Check if feature stability is enabled
            const isEnabled = this.settings?.enableFeatureStability !== false;

            if (!isEnabled) {
                statusContent.innerHTML = `
                    <div style="color: #6b7280; font-size: 13px;">
                        <span style="color: #f59e0b;">⚠️</span> Feature stability control is disabled. All features are enabled regardless of remote status.
                    </div>
                `;
                disabledSection.style.display = 'none';
                return;
            }

            if (!config) {
                statusContent.innerHTML = `
                    <div style="color: #6b7280; font-size: 13px;">
                        <span style="color: #3b82f6;">ℹ️</span> No stability config loaded yet. Visit a WorkVivo page to fetch the latest status.
                    </div>
                `;
                disabledSection.style.display = 'none';
                return;
            }

            // Get extension version
            const extensionVersion = chrome.runtime.getManifest().version;

            // Format last updated time
            const lastUpdated = timestamp ? new Date(timestamp).toLocaleString() : 'Unknown';

            // Check for disabled features
            const disabledFeatures = [];
            if (config.features) {
                for (const [name, feature] of Object.entries(config.features)) {
                    const isFeatureEnabled = this.isFeatureEnabledInConfig(feature, extensionVersion);
                    if (!isFeatureEnabled) {
                        disabledFeatures.push({
                            name: this.formatFeatureName(name),
                            message: feature.message || 'Temporarily disabled',
                            minVersion: feature.minVersion,
                            maxVersion: feature.maxVersion
                        });
                    }
                }
            }

            // Emergency disable check
            if (config.emergencyDisable) {
                statusContent.innerHTML = `
                    <div style="color: #dc3545; font-size: 13px; font-weight: 500;">
                        🚨 Emergency Mode Active - All features disabled
                    </div>
                    <div style="color: #6b7280; font-size: 12px; margin-top: 8px;">
                        Config version: ${config.version || 'Unknown'} | Last checked: ${lastUpdated}
                    </div>
                `;
                disabledSection.style.display = 'none';
                return;
            }

            // Normal status
            const statusColor = disabledFeatures.length > 0 ? '#f59e0b' : '#22c55e';
            const statusIcon = disabledFeatures.length > 0 ? '⚠️' : '✅';
            const statusText = disabledFeatures.length > 0
                ? `${disabledFeatures.length} feature(s) disabled`
                : 'All features operational';

            statusContent.innerHTML = `
                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                    <span style="color: ${statusColor}; font-size: 16px;">${statusIcon}</span>
                    <span style="color: ${statusColor}; font-weight: 500;">${statusText}</span>
                </div>
                <div style="color: #6b7280; font-size: 12px;">
                    Extension version: ${extensionVersion} | Config version: ${config.version || 'Unknown'} | Last checked: ${lastUpdated}
                </div>
            `;

            // Show disabled features if any
            if (disabledFeatures.length > 0) {
                disabledSection.style.display = 'block';
                disabledList.innerHTML = disabledFeatures.map(f => `
                    <div style="padding: 8px 0; border-bottom: 1px solid #fecaca;">
                        <div style="font-weight: 500; color: #dc3545;">${f.name}</div>
                        <div style="font-size: 12px; color: #6b7280; margin-top: 2px;">${f.message}</div>
                        ${f.minVersion || f.maxVersion ? `
                            <div style="font-size: 11px; color: #9ca3af; margin-top: 4px;">
                                ${f.minVersion ? `Min version: ${f.minVersion}` : ''}
                                ${f.minVersion && f.maxVersion ? ' | ' : ''}
                                ${f.maxVersion ? `Max version: ${f.maxVersion}` : ''}
                            </div>
                        ` : ''}
                    </div>
                `).join('');
            } else {
                disabledSection.style.display = 'none';
            }

        } catch (error) {
            console.error('Error loading feature stability status:', error);
            statusContent.innerHTML = `
                <div style="color: #dc3545; font-size: 13px;">
                    ❌ Error loading stability status
                </div>
            `;
        }
    }

    /**
     * Check if a feature is enabled based on config and version
     */
    isFeatureEnabledInConfig(feature, extensionVersion) {
        if (!feature) return true;

        // Check if version is within the constraint range
        const meetsMinVersion = !feature.minVersion || this.isVersionGte(extensionVersion, feature.minVersion);
        const meetsMaxVersion = !feature.maxVersion || this.isVersionLte(extensionVersion, feature.maxVersion);
        const versionInRange = meetsMinVersion && meetsMaxVersion;

        // If enabled is false AND version is in range, feature is disabled
        // If enabled is false BUT version is OUTSIDE range, feature is enabled (not affected)
        if (feature.enabled === false) {
            // Only disable if version is within the affected range
            if (versionInRange) {
                return false; // Feature disabled for this version
            }
            // Version is outside the range, so this disable rule doesn't apply
            return true;
        }

        // If enabled is true but version constraints exist and aren't met, disable
        if (!versionInRange) {
            return false;
        }

        return true;
    }

    /**
     * Compare two semantic version strings: v1 >= v2
     */
    isVersionGte(v1, v2) {
        const parts1 = v1.split('.').map(Number);
        const parts2 = v2.split('.').map(Number);

        for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
            const p1 = parts1[i] || 0;
            const p2 = parts2[i] || 0;

            if (p1 > p2) return true;
            if (p1 < p2) return false;
        }

        return true;
    }

    /**
     * Compare two semantic version strings: v1 <= v2
     */
    isVersionLte(v1, v2) {
        const parts1 = v1.split('.').map(Number);
        const parts2 = v2.split('.').map(Number);

        for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
            const p1 = parts1[i] || 0;
            const p2 = parts2[i] || 0;

            if (p1 < p2) return true;
            if (p1 > p2) return false;
        }

        return true;
    }

    /**
     * Format feature name for display
     */
    formatFeatureName(name) {
        const names = {
            webpackNavigator: 'Webpack Navigator',
            reactFiberNavigator: 'React Fiber Navigator',
            threadManager: 'Threads Panel',
            mentionsManager: 'Mentions Panel',
            searchManager: 'Search Panel',
            draftManager: 'Draft Messages',
            statusManager: 'Availability Status',
            googleMeetManager: 'Google Meet Integration',
            floatingWidget: 'Floating Button',
            searchButtonOverride: 'Search Button Override'
        };
        return names[name] || name;
    }

    async clearStatistics() {
        if (!confirm('Are you sure you want to clear all usage statistics? This action cannot be undone.')) {
            return;
        }

        try {
            console.log('Clearing all statistics...');

            // Clear from chrome.storage
            await chrome.storage.local.remove(['workvivoStatistics']);

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

            // Reset display to zeros
            this.updateStatisticsDisplay({});
            this.showStatus('All statistics cleared successfully', 'success');

        } catch (error) {
            // Error clearing statistics - handled silently
            this.showStatus('Error clearing statistics', 'error');
        }
    }

    async exportSettings() {
        try {
            console.log('Exporting settings...');

            const exportData = {
                version: chrome.runtime.getManifest().version,
                exportDate: new Date().toISOString(),
                settings: this.settings || {},
                statistics: this.statistics || {}
            };

            const dataStr = JSON.stringify(exportData, null, 2);
            const dataBlob = new Blob([dataStr], { type: 'application/json' });

            const url = URL.createObjectURL(dataBlob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `workvivo-settings-backup-${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);

            this.showStatus('Settings exported successfully', 'success');

        } catch (error) {
            // Error exporting settings - handled silently
            this.showStatus('Error exporting settings', 'error');
        }
    }

    async importSettings(file) {
        if (!file) return;

        try {
            console.log('Importing settings from file:', file.name);

            const text = await file.text();
            const importData = JSON.parse(text);

            // Validate import data
            if (!importData.settings || typeof importData.settings !== 'object') {
                this.showStatus('Invalid settings file format', 'error');
                return;
            }

            // Confirm import
            const confirmMessage = `Import settings from backup?\n\nThis will replace your current extension settings.`;
            if (!confirm(confirmMessage)) {
                return;
            }

            // Save imported settings
            await chrome.storage.sync.set({ workvivoSettings: importData.settings });
            this.settings = importData.settings;

            // Optionally import statistics
            if (importData.statistics && confirm('Also import usage statistics from backup?')) {
                await chrome.storage.local.set({ workvivoStatistics: importData.statistics });
                this.statistics = importData.statistics;
                this.updateStatisticsDisplay(this.statistics);
            }

            // Reload settings UI
            await this.loadSettings();

            // Notify content script of new settings
            try {
                const tabs = await chrome.tabs.query({ url: '*://*.workvivo.com/*' });
                if (tabs.length > 0) {
                    for (const tab of tabs) {
                        try {
                            await chrome.tabs.sendMessage(tab.id, {
                                action: 'updateSettings',
                                settings: this.settings
                            });
                            break;
                        } catch (tabError) {
                            console.log(`Tab ${tab.id} not responding for settings update`);
                        }
                    }
                }
            } catch (error) {
                console.log('Could not notify content script of settings update:', error);
            }

            this.showStatus('Settings imported successfully', 'success');

        } catch (error) {
            // Error importing settings - handled silently
            if (error instanceof SyntaxError) {
                this.showStatus('Invalid JSON file format', 'error');
            } else {
                this.showStatus('Failed to import settings', 'error');
            }
        }
    }
    
    async resetSettings() {
        if (!confirm('Are you sure you want to reset all settings to defaults?')) {
            return;
        }

        try {
            // Reset to default settings
            const defaultSettings = {
                showScrollbar: true,
                showPinIndicator: true,
                showPinnedSidebar: true,
                pinnedChatsLayout: 'carousel',
                autoCollapse: true,
                debugLogging: false,
                enableDrafts: true,
                enableMentionsPanel: true,
                enableThreadsPanel: true,
                enableSearchPanel: true,
                enableStatusUpdates: true,
                overrideSearchButton: true,
                showSnackbars: true,
                windowsModifierKey: 'ctrl',
                floatingWidgetEnabled: true,
                floatingWidgetFirstClick: 'recents',
                floatingButtonColor: '#007ACC',
                autoRedirectToChat: true
            };
            await chrome.storage.sync.set({ workvivoSettings: defaultSettings });
            
            // Update UI
            await this.loadSettings();
            
            // Notify content script
            try {
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                if (tab && tab.url && tab.url.includes('workvivo.com')) {
                    await chrome.tabs.sendMessage(tab.id, { 
                        action: 'updateSettings', 
                        settings: this.defaultSettings 
                    });
                }
            } catch (error) {
                console.log('Could not notify content script:', error.message);
            }
            
            this.showStatus('Settings reset to defaults', 'success');
        } catch (error) {
            // Error resetting settings - handled silently
            this.showStatus('Error resetting settings', 'error');
        }
    }
    
    async setupGoogleMeetAuth() {
        console.log('Setting up Google Meet auth...');

        // Check if user is already signed in
        await this.checkGoogleAuthStatus();

        // Sign in button
        const signInBtn = document.getElementById('googleSignInBtn');
        if (signInBtn) {
            signInBtn.addEventListener('click', async () => {
                try {
                    signInBtn.disabled = true;
                    signInBtn.textContent = 'Signing in...';

                    await this.signInWithGoogle();

                } catch (error) {
                    console.error('Sign in error:', error);
                    this.showStatus('Failed to sign in with Google', 'error');
                } finally {
                    signInBtn.disabled = false;
                    signInBtn.innerHTML = `
                        <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor" style="margin-right: 8px;">
                            <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4"/>
                            <path d="M9.003 18c2.43 0 4.467-.806 5.956-2.18L12.05 13.56c-.806.54-1.837.86-3.047.86-2.344 0-4.328-1.584-5.036-3.711H.96v2.332C2.44 15.983 5.485 18 9.003 18z" fill="#34A853"/>
                            <path d="M3.964 10.712c-.18-.54-.282-1.117-.282-1.71 0-.593.102-1.17.282-1.71V4.96H.957C.347 6.175 0 7.55 0 9.002c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
                            <path d="M9.003 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.464.891 11.428 0 9.003 0 5.485 0 2.44 2.017.96 4.958L3.967 7.29c.708-2.127 2.692-3.71 5.036-3.71z" fill="#EA4335"/>
                        </svg>
                        Sign in with Google
                    `;
                }
            });
        }

        // Sign out button
        const signOutBtn = document.getElementById('googleSignOutBtn');
        if (signOutBtn) {
            signOutBtn.addEventListener('click', async () => {
                try {
                    await this.signOutFromGoogle();
                } catch (error) {
                    console.error('Sign out error:', error);
                    this.showStatus('Failed to sign out', 'error');
                }
            });
        }
    }

    async checkGoogleAuthStatus() {
        try {
            const authData = await chrome.storage.local.get(['googleMeetAuth']);

            if (authData.googleMeetAuth && authData.googleMeetAuth.accessToken) {
                // User is signed in
                await this.showGoogleSignedInState(authData.googleMeetAuth);
            } else {
                // User is not signed in
                this.showGoogleSignedOutState();
            }
        } catch (error) {
            console.error('Error checking Google auth status:', error);
            this.showGoogleSignedOutState();
        }
    }

    async signInWithGoogle() {
        return new Promise((resolve, reject) => {
            // Send message to background script to handle auth
            chrome.runtime.sendMessage(
                { action: 'GOOGLE_MEET_AUTH' },
                async (response) => {
                    if (chrome.runtime.lastError) {
                        reject(new Error(chrome.runtime.lastError.message));
                        return;
                    }

                    if (!response || !response.success) {
                        reject(new Error(response?.error || 'Authentication failed'));
                        return;
                    }

                    // Auth data is already stored by background script
                    // Just update UI with the response data
                    const authData = {
                        accessToken: response.accessToken,
                        expiresAt: response.expiresAt,
                        userProfile: response.userProfile
                    };

                    await this.showGoogleSignedInState(authData);
                    this.showStatus('Successfully signed in with Google', 'success');

                    // Track analytics
                    await this.trackEvent('google_meet_signed_in', {});

                    resolve();
                }
            );
        });
    }

    async signOutFromGoogle() {
        try {
            const authData = await chrome.storage.local.get(['googleMeetAuth']);

            if (authData.googleMeetAuth && authData.googleMeetAuth.accessToken) {
                // Send message to background script to handle sign out
                await new Promise((resolve, reject) => {
                    chrome.runtime.sendMessage(
                        {
                            action: 'GOOGLE_MEET_SIGN_OUT',
                            token: authData.googleMeetAuth.accessToken
                        },
                        (response) => {
                            if (chrome.runtime.lastError) {
                                reject(new Error(chrome.runtime.lastError.message));
                                return;
                            }

                            if (!response || !response.success) {
                                reject(new Error(response?.error || 'Sign out failed'));
                                return;
                            }

                            resolve();
                        }
                    );
                });
            } else {
                // No auth data, just clear storage
                await chrome.storage.local.remove(['googleMeetAuth']);
            }

            // Update UI
            this.showGoogleSignedOutState();
            this.showStatus('Signed out from Google', 'success');

            // Track analytics
            await this.trackEvent('google_meet_signed_out', {});

        } catch (error) {
            console.error('Sign out error:', error);
            throw error;
        }
    }

    showGoogleSignedInState(authData) {
        console.log('showGoogleSignedInState called with authData:', authData);

        const statusDiv = document.getElementById('googleMeetStatus');
        const signInDiv = document.getElementById('googleMeetSignIn');
        const emailSpan = document.getElementById('googleMeetEmail');
        const nameSpan = document.getElementById('googleMeetName');
        const avatarDiv = document.getElementById('googleMeetAvatar');

        if (statusDiv && signInDiv) {
            // Show status, hide sign in
            statusDiv.style.display = 'block';
            signInDiv.style.display = 'none';

            // Get profile info from either top level or nested userProfile object
            const profile = authData.userProfile || authData;
            console.log('Profile object:', profile);

            const email = profile.email || 'Connected';
            const name = profile.name || email;
            const picture = profile.picture;

            console.log('Extracted values - name:', name, 'email:', email, 'picture:', picture);

            // Set name and email
            if (nameSpan) {
                nameSpan.textContent = name;
                console.log('Set name span to:', name);
            } else {
                console.warn('googleMeetName element not found!');
            }

            if (emailSpan) {
                emailSpan.textContent = email;
                console.log('Set email span to:', email);
            } else {
                console.warn('googleMeetEmail element not found!');
            }

            // Set avatar
            if (picture && avatarDiv) {
                avatarDiv.style.backgroundImage = `url(${picture})`;
                avatarDiv.style.backgroundSize = 'cover';
                avatarDiv.style.backgroundPosition = 'center';
                avatarDiv.textContent = '';
                console.log('Set avatar with picture:', picture);
            } else if (avatarDiv) {
                // Fallback to first letter of name
                avatarDiv.style.backgroundImage = 'none';
                avatarDiv.textContent = name.charAt(0).toUpperCase();
                console.log('Set avatar fallback with letter:', name.charAt(0).toUpperCase());
            } else {
                console.warn('googleMeetAvatar element not found!');
            }
        }
    }

    showGoogleSignedOutState() {
        const statusDiv = document.getElementById('googleMeetStatus');
        const signInDiv = document.getElementById('googleMeetSignIn');

        if (statusDiv && signInDiv) {
            // Hide status, show sign in
            statusDiv.style.display = 'none';
            signInDiv.style.display = 'block';
        }
    }

    handleMasterToggleChange(masterCheckbox, isChecked) {
        const masterFor = masterCheckbox.dataset.masterFor;
        if (!masterFor) return;

        // Handle multiple dependents (comma-separated)
        const dependents = masterFor.split(',');

        dependents.forEach(dependentId => {
            const dependentCheckbox = document.getElementById(dependentId.trim());
            const dependentDropdown = document.getElementById(dependentId.trim());
            const dependentInput = document.getElementById(dependentId.trim());
            const dependent = dependentCheckbox || dependentDropdown || dependentInput;

            if (dependent) {
                if (!isChecked) {
                    // Master is OFF - disable and uncheck/clear dependent
                    dependent.disabled = true;
                    if (dependentCheckbox && dependentCheckbox.checked) {
                        dependentCheckbox.checked = false;
                    }
                } else {
                    // Master is ON - enable dependent
                    dependent.disabled = false;
                }
            }
        });
    }

    initializeDependentToggles() {
        // Find all elements with data-depends-on attribute
        const dependentElements = document.querySelectorAll('[data-depends-on]');

        dependentElements.forEach(dependent => {
            const dependsOn = dependent.dataset.dependsOn;
            const masterCheckbox = document.getElementById(dependsOn);

            if (masterCheckbox && !masterCheckbox.checked) {
                // Master is unchecked, so disable dependent
                dependent.disabled = true;
            }
        });
    }

    setupEventListeners() {
        console.log('Setting up event listeners...');

        // Set up Google Meet auth
        this.setupGoogleMeetAuth();

        // Initialize dependent toggles state on page load
        this.initializeDependentToggles();

        // Save button removed - settings now auto-save

        // Reset button
        const resetBtn = document.getElementById('resetBtn');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                this.resetSettings();
            });
        }

        // Statistics refresh button
        const refreshStatsBtn = document.getElementById('refreshStatsBtn');
        if (refreshStatsBtn) {
            refreshStatsBtn.addEventListener('click', () => {
                this.loadStatistics();
            });
        }

        // Feature stability refresh button
        const refreshStabilityBtn = document.getElementById('refreshStabilityBtn');
        if (refreshStabilityBtn) {
            refreshStabilityBtn.addEventListener('click', () => {
                this.loadFeatureStabilityStatus();
            });
        }

        // Feature stability toggle - reload status when changed
        const enableFeatureStabilityToggle = document.getElementById('enableFeatureStability');
        if (enableFeatureStabilityToggle) {
            enableFeatureStabilityToggle.addEventListener('change', () => {
                // Delay slightly to allow settings to save first
                setTimeout(() => {
                    this.loadFeatureStabilityStatus();
                }, 100);
            });
        }

        // Export settings button
        const exportSettingsBtn = document.getElementById('exportSettingsBtn');
        if (exportSettingsBtn) {
            exportSettingsBtn.addEventListener('click', () => {
                this.exportSettings();
            });
        }

        // Import settings button
        const importSettingsBtn = document.getElementById('importSettingsBtn');
        const importFileInput = document.getElementById('importFileInput');
        if (importSettingsBtn && importFileInput) {
            importSettingsBtn.addEventListener('click', () => {
                importFileInput.click();
            });
        }

        // Clear statistics button
        const clearStatsBtn = document.getElementById('clearStatsBtn');
        if (clearStatsBtn) {
            clearStatsBtn.addEventListener('click', () => {
                this.clearStatistics();
            });
        }

        // File input change
        if (importFileInput) {
            importFileInput.addEventListener('change', (e) => {
                this.importSettings(e.target.files[0]);
            });
        }

        // Privacy policy link - no event listener needed, it's a regular link

        // Auto-save on toggle changes
        const toggles = document.querySelectorAll('input[type="checkbox"]');
        toggles.forEach(toggle => {
            toggle.addEventListener('change', () => {
                // Handle master/dependent toggle relationships
                this.handleMasterToggleChange(toggle, toggle.checked);

                // Update dependent options visibility when main sidebar toggle changes
                if (toggle.id === 'showPinnedSidebar') {
                    this.updateSidebarOptionsVisibility();
                }
                this.saveSettings();
            });
        });

        // Auto-save on dropdown changes
        const dropdowns = document.querySelectorAll('select.dropdown');
        dropdowns.forEach(dropdown => {
            dropdown.addEventListener('change', () => {
                this.saveSettings();
            });
        });

        // Auto-save on color picker change
        const colorPicker = document.getElementById('floatingButtonColor');
        if (colorPicker) {
            colorPicker.addEventListener('change', () => {
                this.saveSettings();
            });
        }

        // Auto-save on Google Meet invite text change
        const googleMeetInviteTextInput = document.getElementById('googleMeetInviteText');
        if (googleMeetInviteTextInput) {
            googleMeetInviteTextInput.addEventListener('input', () => {
                this.saveSettings();
            });
        }

        // Auto-save on Google Meet duration change
        const googleMeetDurationSelect = document.getElementById('googleMeetDuration');
        if (googleMeetDurationSelect) {
            googleMeetDurationSelect.addEventListener('change', () => {
                this.saveSettings();
            });
        }

        // Auto-save on Google Meet confirm before create toggle
        const googleMeetConfirmCheckbox = document.getElementById('googleMeetConfirmBeforeCreate');
        if (googleMeetConfirmCheckbox) {
            googleMeetConfirmCheckbox.addEventListener('change', () => {
                this.saveSettings();
            });
        }

        // Edit chat page URL button
        const editChatUrlBtn = document.getElementById('editChatUrlBtn');
        if (editChatUrlBtn) {
            editChatUrlBtn.addEventListener('click', () => {
                this.editChatPageUrl();
            });
        }

        // Clear chat page URL button
        const clearChatUrlBtn = document.getElementById('clearChatUrlBtn');
        if (clearChatUrlBtn) {
            clearChatUrlBtn.addEventListener('click', () => {
                this.clearChatPageUrl();
            });
        }
    }
    
    showStatus(message, type) {
        const statusEl = document.getElementById('status');
        const statusText = document.getElementById('statusText');
        
        statusEl.className = `status ${type}`;
        statusText.textContent = message;
        statusEl.classList.remove('hidden');
        
        // Hide after 3 seconds
        setTimeout(() => {
            statusEl.classList.add('hidden');
        }, 3000);
    }
    
    async loadPinnedChats() {
        try {
            console.log('Options: Loading pinned chats...');
            let pinnedChats = [];

            // Try content script first (IndexedDB) - check ALL tabs with workvivo.com
            try {
                console.log('Options: Searching for WorkVivo tabs...');
                const tabs = await chrome.tabs.query({ url: '*://*.workvivo.com/*' });
                console.log('Options: Found', tabs.length, 'WorkVivo tabs');

                if (tabs.length > 0) {
                    // Try each tab until we get a response
                    for (const tab of tabs) {
                        try {
                            console.log(`Options: Trying tab ${tab.id} - ${tab.url}`);
                            const response = await chrome.tabs.sendMessage(tab.id, { action: 'getPinnedChats' });
                            console.log('Options: Content script response from tab', tab.id, ':', response);

                            if (response && Array.isArray(response) && response.length > 0) {
                                pinnedChats = response;
                                console.log('✅ Options loaded', pinnedChats.length, 'pinned chats from IndexedDB via tab', tab.id);
                                break; // Found data, stop trying other tabs
                            }
                        } catch (tabError) {
                            console.log(`❌ Tab ${tab.id} not responding:`, tabError.message);
                        }
                    }
                } else {
                    console.log('⚠️ No WorkVivo tabs found');
                }
            } catch (error) {
                console.log('❌ Options: Error searching for WorkVivo tabs:', error);
            }

            // Fallback to chrome.storage.local for backwards compatibility / testing
            if (pinnedChats.length === 0) {
                try {
                    const result = await chrome.storage.local.get(['workvivoFavorites']);
                    console.log('Raw storage result:', result);

                    if (result.workvivoFavorites) {
                        if (Array.isArray(result.workvivoFavorites)) {
                            // Filter out any invalid entries
                            const validChats = result.workvivoFavorites.filter(chat => {
                                return chat && Array.isArray(chat) && chat.length >= 2 && chat[1] && typeof chat[1] === 'object';
                            });

                            if (validChats.length > 0) {
                                pinnedChats = validChats;
                                console.log('📦 Options loaded', pinnedChats.length, 'valid pinned chats from storage fallback');
                            } else {
                                // Storage contained invalid chat data, using test data
                            }
                        } else {
                            // Storage data is not an array - handled silently
                        }
                    }
                } catch (error) {
                    console.error('Error loading from fallback storage:', error);
                }
            }

            // If still no data, create some test data for development
            if (pinnedChats.length === 0) {
                console.log('⚠️ No pinned chats found in IndexedDB or storage, creating test data for development...');
                console.log('💡 If you have real pinned chats, make sure you have a WorkVivo tab open and try: window.wvOptionsDebug.forceRefreshFromDB()');
                pinnedChats = [
                    ['test-chat-1', {
                        name: 'Test Chat 1',
                        avatar: { type: 'character', content: 'T' },
                        pinnedAt: new Date().toISOString(),
                        nickname: ''
                    }],
                    ['test-chat-2', {
                        name: 'Test Chat 2',
                        avatar: { type: 'character', content: 'T' },
                        pinnedAt: new Date().toISOString(),
                        nickname: 'My Nickname'
                    }]
                ];
            } else {
                console.log('✅ Successfully loaded', pinnedChats.length, 'real pinned chats');
            }

            // Cache the loaded data for use by other functions
            this.currentPinnedChats = pinnedChats;
            this.renderPinnedChats(pinnedChats);
        } catch (error) {
            console.error('Error loading pinned chats:', error);
            this.showStatus('Error loading pinned chats', 'error');
        }
    }
    
    renderPinnedChats(pinnedChats) {
        const container = document.getElementById('pinned-chats-list');
        const clearAllBtn = document.getElementById('clearAllBtn');

        console.log('renderPinnedChats called with:', pinnedChats);
        console.log('Type:', typeof pinnedChats, 'Length:', pinnedChats?.length);

        // Ensure pinnedChats is a valid array
        if (!Array.isArray(pinnedChats)) {
            console.error('pinnedChats is not an array:', pinnedChats);
            pinnedChats = [];
        }

        // Filter out any null/undefined entries
        pinnedChats = pinnedChats.filter(chat => {
            if (!chat || !Array.isArray(chat) || chat.length < 2) {
                console.warn('Invalid chat entry filtered out:', chat);
                return false;
            }
            return true;
        });

        console.log('After filtering:', pinnedChats.length, 'valid chats');

        // Show/hide clear all button based on whether there are pinned chats
        if (clearAllBtn) {
            clearAllBtn.style.display = pinnedChats.length > 0 ? 'block' : 'none';
        }

        if (pinnedChats.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">📌</div>
                    <div>No pinned chats yet</div>
                    <div style="font-size: 12px; margin-top: 4px;">Pin chats from WorkVivo to see them here</div>
                </div>
            `;
            return;
        }

        container.innerHTML = pinnedChats.map(([chatId, chatData], index) => {
            const displayName = chatData.nickname && chatData.nickname.trim() ? chatData.nickname.trim() : chatData.name;
            const hasNickname = chatData.nickname && chatData.nickname.trim();

            return `
            <div class="pinned-chat-item" data-chat-id="${chatId}" data-index="${index}" draggable="true"
                 role="listitem" aria-label="${displayName} chat" tabindex="0">
                <div class="drag-handle" title="Drag to reorder" aria-label="Drag handle">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <path d="M8 6h8M8 12h8M8 18h8"/>
                    </svg>
                </div>
                <div class="chat-avatar" style="background: ${this.getAvatarColor(chatData.avatar)}; ${this.getAvatarStyle(chatData.avatar)}"
                     aria-hidden="true">
                    ${this.getAvatarContent(chatData.avatar)}
                </div>
                <div class="chat-info">
                    <div class="chat-name" title="${displayName}">${displayName}</div>
                    ${hasNickname ? `<div class="chat-original-name" title="Original: ${chatData.name}">Original: ${chatData.name}</div>` : ''}
                    <div class="chat-id" title="${chatId}">${chatId}</div>
                </div>
                <div class="chat-actions" role="group" aria-label="Chat actions">
                    <button class="action-btn edit" title="Edit nickname for ${displayName}"
                            data-chat-id="${chatId}" aria-label="Edit nickname">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                            <path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
                        </svg>
                    </button>
                    <button class="action-btn danger" title="Unpin ${displayName}"
                            data-chat-id="${chatId}" aria-label="Unpin chat">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                            <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                        </svg>
                    </button>
                </div>
            </div>
            `;
        }).join('');

        // Add event listeners for action buttons
        const actionButtons = container.querySelectorAll('.action-btn[data-chat-id]');
        console.log('Setting up event listeners for', actionButtons.length, 'action buttons');

        if (actionButtons.length === 0) {
            console.warn('⚠️ No action buttons found! Container HTML:', container.innerHTML.substring(0, 500));
        }

        actionButtons.forEach((button, index) => {
            console.log(`Setting up listener for button ${index}:`, button.classList.toString(), 'chatId:', button.dataset.chatId);

            button.addEventListener('click', (e) => {
                console.log('🖱️ Action button clicked:', button.classList.toString(), 'chatId:', button.dataset.chatId);
                e.stopPropagation();
                const chatId = button.dataset.chatId;

                if (button.classList.contains('edit')) {
                    console.log('✏️ Edit button clicked for chatId:', chatId);
                    this.showNicknameEditor(chatId);
                } else if (button.classList.contains('danger')) {
                    console.log('🗑️ Delete button clicked for chatId:', chatId);
                    this.unpinChat(chatId);
                }
            });
        });

        // Add keyboard navigation for pinned chat items
        container.querySelectorAll('.pinned-chat-item').forEach(item => {
            item.addEventListener('keydown', (e) => {
                const editBtn = item.querySelector('.action-btn.edit');
                const deleteBtn = item.querySelector('.action-btn.danger');

                switch (e.key) {
                    case 'Enter':
                    case ' ':
                        e.preventDefault();
                        if (e.target === item) {
                            editBtn.click();
                        }
                        break;
                    case 'Delete':
                    case 'Backspace':
                        e.preventDefault();
                        deleteBtn.click();
                        break;
                    case 'e':
                    case 'E':
                        e.preventDefault();
                        editBtn.click();
                        break;
                    case 'ArrowDown':
                        e.preventDefault();
                        const nextItem = item.nextElementSibling;
                        if (nextItem && nextItem.classList.contains('pinned-chat-item')) {
                            nextItem.focus();
                        }
                        break;
                    case 'ArrowUp':
                        e.preventDefault();
                        const prevItem = item.previousElementSibling;
                        if (prevItem && prevItem.classList.contains('pinned-chat-item')) {
                            prevItem.focus();
                        }
                        break;
                }
            });
        });
    }
    
    getAvatarColor(avatarData) {
        if (avatarData.type === 'image') return '#6b7280';
        if (avatarData.type === 'character') {
            // Generate consistent color based on character
            const colors = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899'];
            const charCode = avatarData.content.charCodeAt(0);
            return colors[charCode % colors.length];
        }
        return '#6b7280';
    }
    
    getAvatarContent(avatarData) {
        if (avatarData.type === 'image') return '📷';
        if (avatarData.type === 'character') return avatarData.content.toUpperCase();
        return '?';
    }
    
    getAvatarStyle(avatarData) {
        if (avatarData.type === 'image' && avatarData.src) {
            return `background-image: url('${avatarData.src}'); background-size: cover; background-position: center;`;
        }
        return '';
    }
    
    async unpinChat(chatId) {
        if (!confirm('Are you sure you want to unpin this chat?')) {
            return;
        }
        
        try {
            const result = await chrome.storage.local.get(['workvivoFavorites']);
            const pinnedChats = result.workvivoFavorites || [];

            // Remove the chat
            const updatedChats = pinnedChats.filter(([id]) => id !== chatId);

            await chrome.storage.local.set({ workvivoFavorites: updatedChats });
            
            // Reload the list
            await this.loadPinnedChats();
            await this.loadStatistics();
            
            // Notify content script
            try {
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                if (tab && tab.url && tab.url.includes('workvivo.com')) {
                    await chrome.tabs.sendMessage(tab.id, { 
                        action: 'refreshPinnedChats'
                    });
                }
            } catch (error) {
                console.log('Could not notify content script:', error.message);
            }
            
            this.showStatus('Chat unpinned successfully', 'success');
        } catch (error) {
            console.error('Error unpinning chat:', error);
            this.showStatus('Error unpinning chat', 'error');
        }
    }

    async clearAllPinnedChats() {
        if (!confirm('Are you sure you want to clear all pinned chats? This action cannot be undone.')) {
            return;
        }

        try {
            // Clear all pinned chats from storage
            await chrome.storage.local.set({ workvivoFavorites: [] });

            // Reload the list and statistics
            await this.loadPinnedChats();
            await this.loadStatistics();

            // Notify content script
            try {
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                if (tab && tab.url && tab.url.includes('workvivo.com')) {
                    await chrome.tabs.sendMessage(tab.id, {
                        action: 'clearAllPinned'
                    });
                }
            } catch (error) {
                console.log('Could not notify content script:', error.message);
            }

            this.showStatus('All pinned chats cleared successfully', 'success');
        } catch (error) {
            console.error('Error clearing pinned chats:', error);
            this.showStatus('Error clearing pinned chats', 'error');
        }
    }

    setupDragAndDrop() {
        const container = document.getElementById('pinned-chats-list');
        if (!container) return;

        let draggedElement = null;
        let draggedIndex = null;
        let placeholder = null;
        let lastDragOverTime = 0;
        const dragOverThrottle = 50; // ms - limit dragover to 20 times per second max

        container.addEventListener('dragstart', (e) => {
            if (e.target.classList.contains('pinned-chat-item') || e.target.closest('.pinned-chat-item')) {
                draggedElement = e.target.classList.contains('pinned-chat-item') ? e.target : e.target.closest('.pinned-chat-item');
                draggedIndex = parseInt(draggedElement.dataset.index);

                // Create placeholder
                placeholder = draggedElement.cloneNode(true);
                placeholder.classList.add('drag-placeholder');
                placeholder.classList.remove('dragging');
                placeholder.style.opacity = '0.4';
                placeholder.style.border = '2px dashed rgba(0, 122, 204, 0.5)';

                draggedElement.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/html', draggedElement.outerHTML);
            }
        });
        
        container.addEventListener('dragend', (e) => {
            if (draggedElement) {
                draggedElement.classList.remove('dragging');
                draggedElement = null;
                draggedIndex = null;
            }
            if (placeholder && placeholder.parentNode) {
                placeholder.remove();
                placeholder = null;
            }
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

            const afterElement = this.getDragAfterElement(container, e.clientY);

            // Check if placeholder needs to move
            const needsMove = afterElement == null
                ? placeholder.nextElementSibling !== null
                : placeholder.nextElementSibling !== afterElement;

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

            if (draggedElement && placeholder) {
                // Move dragged element to placeholder position
                const nextSibling = placeholder.nextElementSibling;
                if (nextSibling) {
                    container.insertBefore(draggedElement, nextSibling);
                } else {
                    container.appendChild(draggedElement);
                }

                // Get new index
                const newIndex = Array.from(container.querySelectorAll('.pinned-chat-item:not(.drag-placeholder)')).indexOf(draggedElement);

                if (newIndex !== draggedIndex && newIndex !== -1) {
                    await this.reorderPinnedChats(draggedIndex, newIndex);
                }
            }

            // Clean up
            if (placeholder && placeholder.parentNode) {
                placeholder.remove();
                placeholder = null;
            }
        });
    }
    
    getDragAfterElement(container, y) {
        const draggableElements = [...container.querySelectorAll('.pinned-chat-item:not(.dragging):not(.drag-placeholder)')];

        let closestElement = null;
        let closestDistance = Number.POSITIVE_INFINITY;

        draggableElements.forEach(child => {
            const box = child.getBoundingClientRect();
            const childCenterY = box.top + box.height / 2;

            // Only consider elements below the mouse
            if (childCenterY > y) {
                const distance = childCenterY - y;
                if (distance < closestDistance) {
                    closestDistance = distance;
                    closestElement = child;
                }
            }
        });

        // If no element found (mouse is after all elements), return null to append at end
        return closestElement;
    }
    
    async reorderPinnedChats(fromIndex, toIndex) {
        try {
            // Load current pinned chats
            const result = await chrome.storage.local.get(['workvivoFavorites']);
            const pinnedChats = result.workvivoFavorites || [];

            // Reorder the array
            const [movedItem] = pinnedChats.splice(fromIndex, 1);
            pinnedChats.splice(toIndex, 0, movedItem);

            // Save the reordered chats
            await chrome.storage.local.set({ workvivoFavorites: pinnedChats });
            
            // Reload the list
            await this.loadPinnedChats();
            
            // Notify content script
            try {
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                if (tab && tab.url && tab.url.includes('workvivo.com')) {
                    await chrome.tabs.sendMessage(tab.id, { 
                        action: 'refreshPinnedChats'
                    });
                }
            } catch (error) {
                console.log('Could not notify content script:', error.message);
            }
            
            this.showStatus('Chat order updated', 'success');
        } catch (error) {
            console.error('Error reordering chats:', error);
            this.showStatus('Error reordering chats', 'error');
        }
    }

    async showNicknameEditor(chatId) {
        try {
            console.log('showNicknameEditor called with chatId:', chatId);

            // Use cached data from the currently loaded pinned chats
            const pinnedChats = this.currentPinnedChats || [];
            console.log('Using cached pinned chats for editing:', pinnedChats.length, 'chats');

            const chatEntry = pinnedChats.find(([id]) => id === chatId);
            console.log('Found chat entry:', chatEntry);
            if (!chatEntry) {
                console.error('Chat not found with ID:', chatId);
                this.showStatus('Chat not found', 'error');
                return;
            }

            const [, chatData] = chatEntry;
            const currentNickname = chatData.nickname || '';
            const originalName = chatData.name;

            const newNickname = prompt(
                `Edit nickname for "${originalName}":\n\n(Leave empty to use original name)`,
                currentNickname
            );

            // User cancelled the dialog
            if (newNickname === null) {
                return;
            }

            // Update the nickname
            await this.updateChatNickname(chatId, newNickname.trim());

        } catch (error) {
            console.error('Error showing nickname editor:', error);
            this.showStatus('Error opening nickname editor', 'error');
        }
    }

    async updateChatNickname(chatId, nickname) {
        try {
            console.log('Updating nickname for chatId:', chatId, 'to:', nickname);

            // Get current data (same logic as other methods)
            let pinnedChats = [];
            const result = await chrome.storage.local.get(['workvivoFavorites']);

            if (result.workvivoFavorites && Array.isArray(result.workvivoFavorites)) {
                pinnedChats = result.workvivoFavorites;
            } else {
                // Use test data if no storage data - but we need to save changes to storage
                pinnedChats = [
                    ['test-chat-1', {
                        name: 'Test Chat 1',
                        avatar: { type: 'character', content: 'T' },
                        pinnedAt: new Date().toISOString(),
                        nickname: ''
                    }],
                    ['test-chat-2', {
                        name: 'Test Chat 2',
                        avatar: { type: 'character', content: 'T' },
                        pinnedAt: new Date().toISOString(),
                        nickname: 'My Nickname'
                    }]
                ];
                console.log('Using test data for nickname update');
            }

            // Find and update the chat
            const chatIndex = pinnedChats.findIndex(([id]) => id === chatId);
            if (chatIndex === -1) {
                console.error('Chat not found for nickname update:', chatId);
                this.showStatus('Chat not found', 'error');
                return;
            }

            const [id, chatData] = pinnedChats[chatIndex];
            chatData.nickname = nickname || null; // Set to null if empty string
            pinnedChats[chatIndex] = [id, chatData];

            console.log('Updated chat data:', pinnedChats[chatIndex]);

            // Save to storage (this will persist the test data too)
            await chrome.storage.local.set({ workvivoFavorites: pinnedChats });

            // Reload the list
            await this.loadPinnedChats();

            // Notify content script
            try {
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                if (tab && tab.url && tab.url.includes('workvivo.com')) {
                    await chrome.tabs.sendMessage(tab.id, {
                        action: 'refreshPinnedChats'
                    });
                }
            } catch (error) {
                console.log('Could not notify content script:', error.message);
            }

            const statusMessage = nickname ?
                `Nickname "${nickname}" set successfully` :
                'Nickname cleared - using original name';
            this.showStatus(statusMessage, 'success');

        } catch (error) {
            console.error('Error updating nickname:', error);
            this.showStatus('Error updating nickname', 'error');
        }
    }

    async filterPinnedChats(query) {
        try {
            console.log('Filtering chats with query:', query);

            // Use cached data from the currently loaded pinned chats
            const allPinnedChats = this.currentPinnedChats || [];
            console.log('Using cached pinned chats for search:', allPinnedChats.length, 'chats');

            if (!query.trim()) {
                // Show all chats if no search query
                console.log('Empty query, showing all chats');
                this.renderPinnedChats(allPinnedChats);
                return;
            }

            const filteredChats = allPinnedChats.filter(([chatId, chatData]) => {
                const displayName = chatData.nickname && chatData.nickname.trim() ?
                    chatData.nickname.trim() : chatData.name;

                const matches = displayName.toLowerCase().includes(query.toLowerCase()) ||
                       chatData.name.toLowerCase().includes(query.toLowerCase()) ||
                       chatId.toLowerCase().includes(query.toLowerCase());

                console.log(`Chat "${displayName}" matches "${query}":`, matches);
                return matches;
            });

            console.log('Filtered chats:', filteredChats.length, 'of', allPinnedChats.length);
            this.renderPinnedChats(filteredChats);
        } catch (error) {
            console.error('Error filtering pinned chats:', error);
        }
    }

    async exportPinnedChats() {
        try {
            const favoritesResult = await chrome.storage.local.get(['workvivoFavorites']);
            const settingsResult = await chrome.storage.sync.get(['workvivoSettings']);

            const exportData = {
                version: chrome.runtime.getManifest().version,
                exportDate: new Date().toISOString(),
                pinnedChats: favoritesResult.workvivoFavorites || [],
                settings: settingsResult.workvivoSettings || this.defaultSettings
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

            this.showStatus(`Exported ${exportData.pinnedChats.length} pinned chats successfully`, 'success');

        } catch (error) {
            console.error('Error exporting data:', error);
            this.showStatus('Error exporting data', 'error');
        }
    }

    async importPinnedChats(file) {
        if (!file) return;

        try {
            const text = await file.text();
            const importData = JSON.parse(text);

            // Validate the import data structure
            if (!importData.pinnedChats || !Array.isArray(importData.pinnedChats)) {
                this.showStatus('Invalid backup file format', 'error');
                return;
            }

            // Confirm the import
            const currentCount = (await chrome.storage.local.get(['workvivoFavorites'])).workvivoFavorites?.length || 0;
            const importCount = importData.pinnedChats.length;

            const confirmMessage = currentCount > 0 ?
                `This will replace your ${currentCount} existing pinned chats with ${importCount} chats from the backup. Continue?` :
                `Import ${importCount} pinned chats from backup?`;

            if (!confirm(confirmMessage)) {
                return;
            }

            // Import the data
            await chrome.storage.local.set({ workvivoFavorites: importData.pinnedChats });

            // Optionally import settings if they exist and user wants them
            if (importData.settings && confirm('Also import extension settings from backup?')) {
                await chrome.storage.sync.set({ workvivoSettings: importData.settings });
                await this.loadSettings();
            }

            // Refresh the display
            await this.loadPinnedChats();
            await this.loadStatistics();

            // Notify content script
            try {
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                if (tab && tab.url && tab.url.includes('workvivo.com')) {
                    await chrome.tabs.sendMessage(tab.id, {
                        action: 'refreshPinnedChats'
                    });
                }
            } catch (error) {
                console.log('Could not notify content script:', error.message);
            }

            // Clear the file input
            document.getElementById('importFileInput').value = '';

            this.showStatus(`Successfully imported ${importCount} pinned chats`, 'success');

        } catch (error) {
            console.error('Error importing data:', error);
            if (error instanceof SyntaxError) {
                this.showStatus('Invalid JSON file format', 'error');
            } else {
                this.showStatus('Error importing data', 'error');
            }
        }
    }

    // Analytics and Privacy Methods - removed, users can email j6workz@gmail.com for data requests

    updateSidebarOptionsVisibility() {
        const showSidebar = document.getElementById('showPinnedSidebar').checked;
        const sidebarOptions = document.getElementById('sidebarDependentOptions');

        if (sidebarOptions) {
            sidebarOptions.style.display = showSidebar ? 'block' : 'none';
        }
    }

    /**
     * Track analytics events from options page
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
                        source: 'options',
                        ...parameters
                    }
                }]
            };

            // Send to background script (which handles device/geo centrally)
            chrome.runtime.sendMessage({
                action: 'sendGA4Event',
                eventData: eventPayload
            }).catch(() => {
                // Failed to track options event - handled silently
            });
        } catch (error) {
            // Error tracking options event - handled silently
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

    /**
     * Track settings changes with detailed analytics
     */
    trackSettingsChanges(oldSettings, newSettings) {
        const changedSettings = [];

        // Compare all settings
        for (const [key, newValue] of Object.entries(newSettings)) {
            const oldValue = oldSettings[key];
            if (oldValue !== newValue) {
                changedSettings.push({
                    setting: key,
                    old_value: String(oldValue),
                    new_value: String(newValue),
                    value_type: typeof newValue
                });

                // Track individual setting change
                this.trackEvent('setting_changed', {
                    setting_name: key,
                    old_value: String(oldValue),
                    new_value: String(newValue),
                    value_type: typeof newValue
                });

                // Track specific floating widget setting changes
                if (key === 'floatingWidgetEnabled' || key === 'floatingWidgetFirstClick') {
                    this.trackEvent('floating_widget_setting_changed', {
                        setting_name: key,
                        old_value: String(oldValue),
                        new_value: String(newValue)
                    });
                }
            }
        }

        // Track overall settings save event
        this.trackEvent('settings_saved', {
            changed_settings_count: changedSettings.length,
            changed_settings: changedSettings.map(s => s.setting)
        });
    }

    // Jurisdiction-Aware Privacy Methods

    /**
     * Initialize jurisdiction-aware privacy UI
     */
    async initJurisdictionAwarePrivacy() {
        try {
            // Detect jurisdiction using the JurisdictionDetector
            const jurisdiction = await this.detectJurisdiction();
            console.log('Options: Detected jurisdiction:', jurisdiction);

            // Update UI based on jurisdiction
            this.updateJurisdictionUI(jurisdiction);

            // Show jurisdiction-aware privacy notices
            this.showJurisdictionPrivacyNotices(jurisdiction);

            // Track jurisdiction detection
            this.trackEvent('jurisdiction_detected_options', {
                jurisdiction: jurisdiction.jurisdiction,
                country: jurisdiction.country,
                privacy_tier: jurisdiction.privacyTier
            });

        } catch (error) {
            console.warn('Options: Jurisdiction detection failed:', error);
            // Fall back to conservative defaults
            this.updateJurisdictionUI({
                jurisdiction: 'unknown',
                country: 'Unknown',
                privacyTier: 'strict_consent',
                requiresExplicitConsent: true
            });
        }
    }

    /**
     * Detect user's jurisdiction
     */
    async detectJurisdiction() {
        // Use multiple detection methods
        const detectionMethods = {
            chromeI18n: await this.detectViaChromeI18n(),
            navigatorLanguage: this.detectViaNavigatorLanguage(),
            timezone: this.detectViaTimezone()
        };

        console.log('Options: Detection methods results:', detectionMethods);

        // Prioritize timezone over language for geographic accuracy
        const country = detectionMethods.timezone ||
                       detectionMethods.chromeI18n ||
                       detectionMethods.navigatorLanguage || 'US';

        // Determine privacy tier based on jurisdiction
        const privacyTier = this.getPrivacyTier(country);

        return {
            jurisdiction: country,
            country: country,
            privacyTier: privacyTier,
            requiresExplicitConsent: privacyTier === 'strict_consent',
            detectionMethods: detectionMethods
        };
    }

    /**
     * Detect country via Chrome i18n API
     */
    async detectViaChromeI18n() {
        try {
            if (chrome.i18n && chrome.i18n.getUILanguage) {
                const uiLanguage = chrome.i18n.getUILanguage();
                if (uiLanguage.includes('-')) {
                    return uiLanguage.split('-')[1].toUpperCase();
                }
            }
        } catch (error) {
            console.log('Chrome i18n detection failed:', error);
        }
        return null;
    }

    /**
     * Detect country via navigator language
     */
    detectViaNavigatorLanguage() {
        try {
            const language = navigator.language || navigator.languages[0];
            if (language && language.includes('-')) {
                return language.split('-')[1].toUpperCase();
            }
        } catch (error) {
            console.log('Navigator language detection failed:', error);
        }
        return null;
    }

    /**
     * Detect country via timezone
     */
    detectViaTimezone() {
        try {
            const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
            const timezoneToCountry = {
                'America/New_York': 'US',
                'America/Chicago': 'US',
                'America/Denver': 'US',
                'America/Los_Angeles': 'US',
                'Europe/London': 'GB',
                'Europe/Paris': 'FR',
                'Europe/Berlin': 'DE',
                'Europe/Rome': 'IT',
                'Europe/Madrid': 'ES',
                'Asia/Tokyo': 'JP',
                'Asia/Shanghai': 'CN',
                'Asia/Kuala_Lumpur': 'MY',
                'Asia/Singapore': 'SG',
                'Asia/Bangkok': 'TH',
                'Asia/Jakarta': 'ID',
                'Asia/Manila': 'PH',
                'Asia/Taipei': 'TW',
                'Asia/Seoul': 'KR',
                'Asia/Hong_Kong': 'HK',
                'Australia/Sydney': 'AU',
                'Australia/Melbourne': 'AU'
            };
            return timezoneToCountry[timezone] || null;
        } catch (error) {
            console.log('Timezone detection failed:', error);
        }
        return null;
    }

    /**
     * Get privacy tier for jurisdiction
     */
    getPrivacyTier(country) {
        const strictConsentCountries = ['DE', 'FR', 'IT', 'ES', 'NL', 'BE', 'AT', 'PL', 'SE', 'DK', 'FI', 'NO', 'IE', 'PT', 'GR', 'CZ', 'HU', 'SK', 'SI', 'EE', 'LV', 'LT', 'BG', 'RO', 'HR', 'MT', 'CY', 'LU'];
        const strictConsentStates = ['CA']; // California and other US states with strict laws

        if (strictConsentCountries.includes(country)) {
            return 'strict_consent';
        }

        if (country === 'US') {
            // For now, treat all US as opt-in permissible
            // In a real implementation, you'd detect the specific state
            return 'opt_in_permissible';
        }

        const optInPermissibleCountries = ['CA', 'AU', 'GB', 'NZ', 'MY', 'SG', 'TH', 'ID', 'PH', 'TW', 'KR', 'HK', 'JP'];
        if (optInPermissibleCountries.includes(country)) {
            return 'opt_in_permissible';
        }

        // Default to minimal requirements for other countries
        return 'minimal_requirements';
    }

    /**
     * Update UI based on jurisdiction
     */
    updateJurisdictionUI(jurisdiction) {
        const notice = document.getElementById('jurisdictionNotice');
        const flag = document.getElementById('jurisdictionFlag');
        const text = document.getElementById('jurisdictionText');
        const description = document.getElementById('jurisdictionDescription');

        if (!notice) return;

        // Show the notice
        notice.style.display = 'block';
        notice.className = `jurisdiction-notice ${jurisdiction.privacyTier}`;

        // Set flag and text
        const countryFlags = {
            'US': '🇺🇸', 'CA': '🇨🇦', 'GB': '🇬🇧', 'DE': '🇩🇪',
            'FR': '🇫🇷', 'IT': '🇮🇹', 'ES': '🇪🇸', 'AU': '🇦🇺',
            'JP': '🇯🇵', 'CN': '🇨🇳'
        };

        flag.textContent = countryFlags[jurisdiction.country] || '🌍';
        text.textContent = `Detected Location: ${jurisdiction.country}`;

        // Set description based on privacy tier
        const descriptions = {
            'strict_consent': `Strong privacy protections detected. Your explicit consent is required before any analytics data collection.`,
            'opt_in_permissible': `Privacy-friendly defaults applied. Analytics enabled by default with easy opt-out available.`,
            'minimal_requirements': `Basic privacy protections applied with clear opt-out mechanisms available.`
        };

        description.textContent = descriptions[jurisdiction.privacyTier];

        // Update analytics description
        this.updateAnalyticsDescription(jurisdiction);
    }

    /**
     * Update analytics description based on jurisdiction
     */
    updateAnalyticsDescription(jurisdiction) {
        const analyticsDesc = document.getElementById('analyticsDescription');
        const ga4Notice = document.getElementById('ga4Notice');

        if (!analyticsDesc) return;

        const descriptions = {
            'strict_consent': `Your explicit consent is required before collecting any analytics data. We use Google Analytics 4 to process anonymous usage data for product improvement only.`,
            'opt_in_permissible': `Help us improve the extension! Analytics are enabled by default with easy opt-out. Data is processed anonymously via Google Analytics 4.`,
            'minimal_requirements': `Anonymous usage analytics help us make the extension better. Data is processed securely via Google Analytics 4.`
        };

        analyticsDesc.innerHTML = descriptions[jurisdiction.privacyTier];

        // Show GA4 notice
        if (ga4Notice) {
            ga4Notice.style.display = 'block';
            const ga4Messages = {
                'strict_consent': '📊 <strong>Google Analytics 4:</strong> Google acts as a data processor under our instructions. No personal data is shared with Google beyond what is necessary for analytics processing.',
                'opt_in_permissible': '📊 <strong>Google Analytics 4:</strong> Anonymous usage data is processed via GA4 for product improvement only. No personal data is shared.',
                'minimal_requirements': '📊 <strong>Google Analytics 4:</strong> Data is anonymized and used solely to enhance extension features.'
            };
            ga4Notice.innerHTML = ga4Messages[jurisdiction.privacyTier];
        }
    }

    /**
     * Show jurisdiction-specific privacy notices
     */
    showJurisdictionPrivacyNotices(jurisdiction) {
        // Update the default checkbox states based on jurisdiction
        const analyticsCheckbox = document.getElementById('analyticsEnabled');
        const deviceCheckbox = document.getElementById('shareUsageData');

        if (jurisdiction.privacyTier === 'strict_consent') {
            // For strict consent jurisdictions, defaults should be false
            if (analyticsCheckbox && !this.settings.analyticsEnabled) {
                analyticsCheckbox.checked = false;
            }
            if (deviceCheckbox && !this.settings.shareUsageData) {
                deviceCheckbox.checked = false;
            }
        } else if (jurisdiction.privacyTier === 'opt_in_permissible' || jurisdiction.privacyTier === 'minimal_requirements') {
            // For permissive jurisdictions, defaults can be true if not explicitly set to false
            if (analyticsCheckbox && this.settings.analyticsEnabled !== false) {
                analyticsCheckbox.checked = true;
            }
            if (deviceCheckbox && this.settings.shareUsageData !== false) {
                deviceCheckbox.checked = true;
            }
        }
    }
}

// Make optionsManager globally available for onclick handlers
let optionsManager;

// Initialize options page when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    optionsManager = new OptionsManager();
});
