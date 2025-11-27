var WVFavs = WVFavs || {};

WVFavs.Settings = new (class Settings {
    constructor() {
        this.settings = {
            // Core Features (ALL ENABLED BY DEFAULT)
            enableThreadsPanel: true,        // Threads panel in sidebar
            enableMentionsPanel: true,       // Mentions panel in sidebar
            enableSearchPanel: true,         // Search panel in sidebar
            enableDrafts: true,              // Draft messages feature
            enableStatusUpdates: true,       // Availability status updates feature

            // Feature Options
            overrideSearchButton: true,      // Override search button (dependent on enableSearchPanel)
            adasEnabled: true,               // Accidental Deletion Assistance (dependent on enableDrafts)
            enableGoogleMeet: true,          // Google Meet instant meeting integration

            // UI Options
            showSnackbars: true,             // Show action notifications
            showScrollbar: true,             // Show scrollbar in panels
            showPinIndicator: true,          // Show pin icon on pinned chats
            showPinnedSidebar: true,         // Display pinned chats section in sidebar
            floatingWidgetEnabled: true,     // Show floating search button

            // Layout & Behavior
            pinnedChatsLayout: 'carousel',   // 'carousel', 'grid-3', 'grid-4'
            autoCollapse: true,              // Auto-collapse panels
            autoRedirectToChat: true,        // Auto-redirect to chat page when using extension outside chat
            floatingWidgetFirstClick: 'recents', // 'recents' or 'search'
            floatingButtonColor: '#007ACC',  // Floating button color

            // System
            debugLogging: false,             // Enable debug logging
            windowsModifierKey: 'ctrl'       // Modifier key for Windows
        };
    }

    async load() {
        this.settings = await WVFavs.StorageManager.loadSettings(this.settings);
    }

    get(key) {
        return this.settings[key];
    }

    getAll() {
        return { ...this.settings };
    }

    async set(newSettings) {
        this.settings = { ...this.settings, ...newSettings };
        await WVFavs.StorageManager.saveSettings(this.settings);
    }
})();