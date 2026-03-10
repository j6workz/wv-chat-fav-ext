var WVFavs = WVFavs || {};

WVFavs.ThemeManager = new (class ThemeManager {
    constructor() {
        this.listeners = [];
        this.currentMode = 'auto'; // 'auto', 'light', 'dark'
        this.darkStyleEl = null;
        this._osQuery = null;
        this._osHandler = null;
        this.app = null;
    }

    async init(app) {
        this.app = app;
        this._osQuery = window.matchMedia('(prefers-color-scheme: dark)');
        this._osHandler = () => this._applyTheme();
        this._osQuery.addEventListener('change', this._osHandler);

        // Load saved preference
        const mode = app?.settings?.get('darkTheme') || 'auto';
        this.currentMode = mode;
        this._applyTheme();
    }

    /**
     * Set dark mode preference: 'auto', 'light', or 'dark'
     * Persists to settings storage.
     */
    async setMode(mode) {
        this.currentMode = mode;
        await this.app?.settings?.set({ darkTheme: mode });
        this._applyTheme();
        this.listeners.forEach(cb => cb(this.getTheme()));
    }

    /**
     * Apply a new mode without re-persisting (used when settings are already being saved externally).
     */
    applyMode(mode) {
        this.currentMode = mode;
        this._applyTheme();
        this.listeners.forEach(cb => cb(this.getTheme()));
    }

    isDark() {
        if (this.currentMode === 'dark') return true;
        if (this.currentMode === 'light') return false;
        return this._osQuery ? this._osQuery.matches : false;
    }

    getTheme() {
        return this.isDark() ? 'dark' : 'light';
    }

    /** Register a callback invoked whenever theme changes. Returns unsubscribe fn. */
    onChange(cb) {
        this.listeners.push(cb);
        return () => {
            this.listeners = this.listeners.filter(l => l !== cb);
        };
    }

    _applyTheme() {
        const dark = this.isDark();
        if (dark) {
            document.documentElement.classList.add('wv-dark-mode');
            this._injectDarkCSS();
        } else {
            document.documentElement.classList.remove('wv-dark-mode');
            this._removeDarkCSS();
        }
    }

    _injectDarkCSS() {
        if (document.getElementById('wv-dark-theme-override')) return;
        const style = document.createElement('style');
        style.id = 'wv-dark-theme-override';
        style.textContent = this._getDarkThemeCSS();
        document.head.appendChild(style);
        this.darkStyleEl = style;
    }

    _removeDarkCSS() {
        const el = document.getElementById('wv-dark-theme-override');
        if (el) el.remove();
        this.darkStyleEl = null;
    }

    /** CSS overrides for WorkVivo app's Tailwind tw-* classes */
    _getDarkThemeCSS() {
        return `
/* ============================================================
   WorkVivo App Dark Theme — injected by WVFavs.ThemeManager
   ============================================================ */

/* ===== BASE ===== */
html.wv-dark-mode body {
    background-color: #0f172a !important;
    color: #e2e8f0 !important;
}

/* ===== SIDEBAR / NAV ===== */
html.wv-dark-mode [data-testid="sidebar"],
html.wv-dark-mode aside,
html.wv-dark-mode nav {
    background-color: #1e293b !important;
    border-color: #334155 !important;
}

html.wv-dark-mode [data-testid="channel-list"] {
    background-color: #1e293b !important;
}

html.wv-dark-mode [data-testid="channel-list"] button {
    color: #cbd5e1 !important;
}

html.wv-dark-mode [data-testid="channel-list"] button:hover {
    background-color: #334155 !important;
}

/* Active / selected sidebar item */
html.wv-dark-mode button.tw-bg-primary-50,
html.wv-dark-mode .tw-bg-primary-50 {
    background-color: #1e3a5f !important;
}

html.wv-dark-mode .tw-text-primary-600 {
    color: #60a5fa !important;
}
html.wv-dark-mode .tw-text-primary-500 {
    color: #93c5fd !important;
}
html.wv-dark-mode .tw-text-primary-700 {
    color: #3b82f6 !important;
}

/* ===== BACKGROUNDS ===== */
html.wv-dark-mode .tw-bg-white {
    background-color: #1e293b !important;
}
html.wv-dark-mode .tw-bg-gray-50,
html.wv-dark-mode .tw-bg-slate-50 {
    background-color: #0f172a !important;
}
html.wv-dark-mode .tw-bg-gray-100,
html.wv-dark-mode .tw-bg-slate-100 {
    background-color: #334155 !important;
}
html.wv-dark-mode .tw-bg-gray-200,
html.wv-dark-mode .tw-bg-slate-200 {
    background-color: #334155 !important;
}

/* ===== TEXT ===== */
html.wv-dark-mode .tw-text-gray-900,
html.wv-dark-mode .tw-text-slate-900 {
    color: #f1f5f9 !important;
}
html.wv-dark-mode .tw-text-gray-800,
html.wv-dark-mode .tw-text-slate-800 {
    color: #e2e8f0 !important;
}
html.wv-dark-mode .tw-text-gray-700,
html.wv-dark-mode .tw-text-slate-700 {
    color: #cbd5e1 !important;
}
html.wv-dark-mode .tw-text-gray-600,
html.wv-dark-mode .tw-text-slate-600 {
    color: #94a3b8 !important;
}
html.wv-dark-mode .tw-text-gray-500,
html.wv-dark-mode .tw-text-slate-500 {
    color: #64748b !important;
}

/* ===== BORDERS ===== */
html.wv-dark-mode .tw-border-gray-100,
html.wv-dark-mode .tw-border-slate-100 {
    border-color: #1e293b !important;
}
html.wv-dark-mode .tw-border-gray-200,
html.wv-dark-mode .tw-border-slate-200 {
    border-color: #334155 !important;
}
html.wv-dark-mode .tw-border-gray-300,
html.wv-dark-mode .tw-border-slate-300 {
    border-color: #475569 !important;
}

/* ===== INPUTS ===== */
html.wv-dark-mode input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"]),
html.wv-dark-mode textarea,
html.wv-dark-mode select {
    background-color: #334155 !important;
    color: #e2e8f0 !important;
    border-color: #475569 !important;
}
html.wv-dark-mode input::placeholder,
html.wv-dark-mode textarea::placeholder {
    color: #64748b !important;
}

/* ===== DIVIDERS / HR ===== */
html.wv-dark-mode hr {
    border-color: #334155 !important;
}
html.wv-dark-mode .tw-divide-gray-200 > * + *,
html.wv-dark-mode .tw-divide-slate-200 > * + * {
    border-color: #334155 !important;
}

/* ===== CHAT AREA ===== */
html.wv-dark-mode [data-testid="message-section"] {
    background-color: #1e293b !important;
}
/* Received message bubbles — slightly lighter than the section background so they're visible */
html.wv-dark-mode [data-testid="message-section"] .tw-bg-gray-100,
html.wv-dark-mode [data-testid="message-section"] .tw-bg-slate-100 {
    background-color: #334155 !important;
}
/* Message bubble tails — SVGs use fill:currentColor; only target spans that directly wrap an SVG */
/* Received tail — matches the global tw-bg-gray-100 bubble background (#334155) */
html.wv-dark-mode span.tw-text-gray-100:has(> svg) {
    color: #334155 !important;
}
/* Sent tail — undo global primary-color override only for these SVG-wrapping tail spans */
html.wv-dark-mode span.tw-text-primary-500:has(> svg),
html.wv-dark-mode span.tw-text-primary-600:has(> svg),
html.wv-dark-mode span.tw-text-primary-700:has(> svg) {
    color: #111827 !important;
}

/* ===== HEADER ===== */
html.wv-dark-mode header,
html.wv-dark-mode [data-testid="chat-header"] {
    background-color: #1e293b !important;
    border-bottom-color: #334155 !important;
}
/* Chat header uses tw-bg-white/[0.85] (Tailwind opacity modifier) — target with attribute selector */
html.wv-dark-mode [class*="tw-bg-white/"] {
    background-color: rgba(30, 41, 59, 0.85) !important;
}

/* ===== TEXT BLACK / WHITE OVERRIDES ===== */
html.wv-dark-mode .tw-text-black {
    color: #e2e8f0 !important;
}
html.wv-dark-mode .tw-text-white {
    /* keep white text white */
}

/* ===== BOOTSTRAP CARDS (link previews, OG embeds) ===== */
html.wv-dark-mode .card,
html.wv-dark-mode .card-body {
    background-color: #1e293b !important;
    border-color: #334155 !important;
    color: #e2e8f0 !important;
}
html.wv-dark-mode .card-link-large {
    background-color: transparent !important;
}
html.wv-dark-mode .activity-link-body {
    background-color: #1e293b !important;
    color: #94a3b8 !important;
}
html.wv-dark-mode .card-title,
html.wv-dark-mode .card-text {
    color: #e2e8f0 !important;
}

/* ===== BOOTSTRAP DROPDOWNS ===== */
html.wv-dark-mode .dropdown-menu {
    background-color: #1e293b !important;
    border-color: #334155 !important;
    color: #e2e8f0 !important;
}
html.wv-dark-mode .dropdown-item {
    color: #cbd5e1 !important;
}
html.wv-dark-mode .dropdown-item:hover,
html.wv-dark-mode .dropdown-item:focus {
    background-color: #334155 !important;
    color: #f1f5f9 !important;
}
html.wv-dark-mode .dropdown-divider {
    border-color: #334155 !important;
}

/* ===== EXTENSION BUTTON GROUP ===== */
html.wv-dark-mode .wv-favorites-button-group {
    background: #1e293b !important;
    border-color: #334155 !important;
}

/* ===== THREAD PANEL ===== */
html.wv-dark-mode .wv-favorites-thread-panel {
    background: #1e293b !important;
    border-color: #334155 !important;
    color: #e2e8f0 !important;
}
/* Thread panel header (inline style, no class) */
html.wv-dark-mode .wv-favorites-thread-panel > div:first-child {
    background: #162032 !important;
    border-bottom-color: #334155 !important;
}
html.wv-dark-mode .wv-favorites-thread-panel h3 {
    color: #f1f5f9 !important;
}
html.wv-dark-mode .wv-favorites-thread-close {
    color: #94a3b8 !important;
}
html.wv-dark-mode .wv-favorites-thread-close:hover {
    color: #f1f5f9 !important;
}
html.wv-dark-mode .wv-thread-filter-unread {
    background: #1e293b !important;
    border-color: #475569 !important;
    color: #94a3b8 !important;
}
html.wv-dark-mode .wv-thread-filter-unread[data-active="true"] {
    background: #1e3a5f !important;
    border-color: #3b82f6 !important;
    color: #60a5fa !important;
}
html.wv-dark-mode .wv-thread-sort-btn {
    background: #1e293b !important;
    border-color: #475569 !important;
    color: #94a3b8 !important;
}
html.wv-dark-mode .wv-thread-sort-btn[data-active="true"],
html.wv-dark-mode .wv-thread-sort-reply {
    background: #1e3a5f !important;
    border-color: #3b82f6 !important;
    color: #60a5fa !important;
}
html.wv-dark-mode .wv-favorites-thread-item {
    background: #1e293b !important;
    border-color: #334155 !important;
    color: #e2e8f0 !important;
}
html.wv-dark-mode .wv-favorites-thread-item:hover {
    background: #334155 !important;
}
/* Thread item inline text colors — override hardcoded inline styles */
html.wv-dark-mode .wv-favorites-thread-item div[style],
html.wv-dark-mode .wv-favorites-thread-item span[style] {
    color: #cbd5e1 !important;
}
html.wv-dark-mode .wv-favorites-thread-item strong[style] {
    color: #e2e8f0 !important;
}
html.wv-dark-mode .wv-favorites-thread-item div[style*="border-left"] {
    border-left-color: #334155 !important;
}
/* Thread panel footer */
html.wv-dark-mode .wv-thread-panel-footer {
    background: #162032 !important;
    border-top-color: #334155 !important;
    color: #94a3b8 !important;
}
html.wv-dark-mode .wv-thread-panel-footer span[style] {
    color: #94a3b8 !important;
}
html.wv-dark-mode .wv-load-older-threads-btn {
    background: #1e293b !important;
    border-color: #334155 !important;
    color: #94a3b8 !important;
}

/* ===== SEARCH PANEL ===== */
html.wv-dark-mode .wv-favorites-global-search-panel {
    background: #1e293b !important;
    border-color: #334155 !important;
    color: #e2e8f0 !important;
}
html.wv-dark-mode .wv-search-results-list {
    background: #1e293b !important;
    color: #e2e8f0 !important;
}
html.wv-dark-mode .wv-search-input {
    background: #334155 !important;
    border-color: #475569 !important;
    color: #e2e8f0 !important;
}
html.wv-dark-mode .wv-search-input::placeholder {
    color: #64748b !important;
}
html.wv-dark-mode .wv-global-search-btn {
    background: #334155 !important;
    border-color: #475569 !important;
    color: #cbd5e1 !important;
}
html.wv-dark-mode .wv-global-search-btn:hover {
    background: #475569 !important;
    color: #f1f5f9 !important;
}
html.wv-dark-mode .wv-search-mode-dropdown-btn {
    background: #334155 !important;
    border-color: #475569 !important;
    color: #cbd5e1 !important;
}
html.wv-dark-mode .wv-search-mode-dropdown {
    background: #1e293b !important;
    border-color: #334155 !important;
    box-shadow: 0 4px 16px rgba(0,0,0,0.5) !important;
}
html.wv-dark-mode .wv-search-mode-option {
    background: #1e293b !important;
    color: #cbd5e1 !important;
    border-color: #334155 !important;
}
html.wv-dark-mode .wv-search-mode-option:hover {
    background: #334155 !important;
}
html.wv-dark-mode .wv-search-mode-option[data-active="true"],
html.wv-dark-mode .wv-search-mode-option.active {
    background: #1e3a5f !important;
    color: #60a5fa !important;
}

/* ===== MENTIONS PANEL ===== */
html.wv-dark-mode .wv-favorites-global-mentions-panel,
html.wv-dark-mode .wv-favorites-mentions-panel {
    background: #1e293b !important;
    border-color: #334155 !important;
    color: #e2e8f0 !important;
}
/* Header (first child, no class) — also override any inline dark text */
html.wv-dark-mode .wv-favorites-global-mentions-panel > div:first-child,
html.wv-dark-mode .wv-favorites-mentions-panel > div:first-child {
    background: #162032 !important;
    border-bottom-color: #334155 !important;
    color: #f1f5f9 !important;
}
html.wv-dark-mode .wv-favorites-global-mentions-panel > div:first-child [style*="color"],
html.wv-dark-mode .wv-favorites-mentions-panel > div:first-child [style*="color"] {
    color: #f1f5f9 !important;
}
html.wv-dark-mode .wv-favorites-mentions-tabs {
    background: #162032 !important;
}
html.wv-dark-mode .wv-mentions-tab {
    background: #1e293b !important;
    color: #94a3b8 !important;
    border-color: #475569 !important;
}
html.wv-dark-mode .wv-mentions-tab-active,
html.wv-dark-mode .wv-mentions-tab.active {
    background: #1e3a5f !important;
    color: #60a5fa !important;
    border-color: #3b82f6 !important;
}
html.wv-dark-mode .wv-favorites-mention-item {
    background: #1e293b !important;
    border-color: #334155 !important;
    outline: none !important;
    box-shadow: none !important;
    color: #e2e8f0 !important;
}
html.wv-dark-mode .wv-favorites-mention-item:hover {
    background: #334155 !important;
}
/* Override ALL inline text colors within mention items */
html.wv-dark-mode .wv-favorites-mention-item [style*="color:"] {
    color: #94a3b8 !important;
}
/* Usernames / primary text — make brighter */
html.wv-dark-mode .wv-favorites-mention-item [style*="color: #1e293b"],
html.wv-dark-mode .wv-favorites-mention-item [style*="color: #111827"],
html.wv-dark-mode .wv-favorites-mention-item [style*="color: #0f172a"],
html.wv-dark-mode .wv-favorites-mention-item [style*="color: rgb(30, 41, 59)"],
html.wv-dark-mode .wv-favorites-mention-item [style*="color: rgb(17, 24, 39)"] {
    color: #f1f5f9 !important;
}
html.wv-dark-mode .wv-mention-channel-section {
    color: #64748b !important;
}
html.wv-dark-mode .wv-mention-message-text {
    color: #94a3b8 !important;
}
html.wv-dark-mode .wv-mentions-footer {
    background: #162032 !important;
    border-top-color: #334155 !important;
    color: #94a3b8 !important;
}
html.wv-dark-mode .wv-mentions-show-full-toggle {
    color: #94a3b8 !important;
}
html.wv-dark-mode .wv-favorites-mentions-load-more {
    background: #1e293b !important;
    border-color: #334155 !important;
    color: #94a3b8 !important;
}

/* ===== DRAFTS PANEL ===== */
html.wv-dark-mode .wv-favorites-global-drafts-panel {
    background: #1e293b !important;
    border-color: #334155 !important;
    color: #e2e8f0 !important;
}
/* Header (no class) */
html.wv-dark-mode .wv-favorites-global-drafts-panel > div:first-child {
    background: #162032 !important;
    border-bottom-color: #334155 !important;
}
html.wv-dark-mode .wv-favorites-global-drafts-panel h3 {
    color: #f1f5f9 !important;
}
html.wv-dark-mode .wv-favorites-drafts-list {
    background: #1e293b !important;
}
html.wv-dark-mode .wv-favorites-draft-item {
    background: #1e293b !important;
    border-color: #334155 !important;
    color: #e2e8f0 !important;
}
html.wv-dark-mode .wv-favorites-draft-item:hover {
    background: #334155 !important;
}
html.wv-dark-mode .wv-drafts-footer {
    background: #162032 !important;
    border-top-color: #334155 !important;
}
html.wv-dark-mode .wv-drafts-footer-clear-all {
    background: #3f1d1d !important;
    border-color: #7f1d1d !important;
    color: #fca5a5 !important;
}

/* ===== SEARCH PANEL (header + footer) ===== */
html.wv-dark-mode .wv-favorites-search-panel,
html.wv-dark-mode .wv-favorites-global-search-panel {
    background: #1e293b !important;
}
/* Header children (first = spacer, second = actual header with search input) */
html.wv-dark-mode .wv-favorites-search-panel > div:first-child,
html.wv-dark-mode .wv-favorites-search-panel > div:nth-child(2),
html.wv-dark-mode .wv-favorites-global-search-panel > div:first-child,
html.wv-dark-mode .wv-favorites-global-search-panel > div:nth-child(2) {
    background: #162032 !important;
    border-bottom-color: #334155 !important;
}
html.wv-dark-mode .wv-favorites-search-panel h3,
html.wv-dark-mode .wv-favorites-global-search-panel h3 {
    color: #f1f5f9 !important;
}
html.wv-dark-mode .wv-search-footer {
    background: #162032 !important;
    border-top-color: #334155 !important;
    color: #94a3b8 !important;
}
html.wv-dark-mode .wv-search-footer [style*="color:"] {
    color: #94a3b8 !important;
}
html.wv-dark-mode .wv-search-result-item {
    background: #1e293b !important;
    border-color: #334155 !important;
    outline: none !important;
    box-shadow: none !important;
    color: #e2e8f0 !important;
}
html.wv-dark-mode .wv-search-result-item:hover {
    background: #334155 !important;
}
/* Override ALL inline text colors within search result items */
html.wv-dark-mode .wv-search-result-item [style*="color:"] {
    color: #94a3b8 !important;
}
/* Usernames / primary text — make brighter */
html.wv-dark-mode .wv-search-result-item [style*="color: #1e293b"],
html.wv-dark-mode .wv-search-result-item [style*="color: #111827"],
html.wv-dark-mode .wv-search-result-item [style*="color: #0f172a"],
html.wv-dark-mode .wv-search-result-item [style*="color: rgb(30, 41, 59)"],
html.wv-dark-mode .wv-search-result-item [style*="color: rgb(17, 24, 39)"] {
    color: #f1f5f9 !important;
}
html.wv-dark-mode .wv-search-channel-section {
    color: #64748b !important;
}
html.wv-dark-mode .wv-search-load-more-btn {
    background: #334155 !important;
    border-color: #475569 !important;
    color: #94a3b8 !important;
}
html.wv-dark-mode .wv-search-all-channels-btn {
    background: #334155 !important;
    color: #cbd5e1 !important;
}

/* ===== THREAD PANEL (header + footer, no class names) ===== */
html.wv-dark-mode .wv-favorites-thread-panel > div:first-child {
    background: #162032 !important;
    border-bottom-color: #334155 !important;
}
/* Thread items with unread state */
html.wv-dark-mode .wv-favorites-thread-item[style*="#fef2f2"],
html.wv-dark-mode .wv-favorites-thread-item[style*="#fee2e2"] {
    background: #2d1515 !important;
    border-left-color: #ef4444 !important;
}

/* ===== CLOSE BUTTONS IN PANELS ===== */
html.wv-dark-mode .wv-favorites-close-global-drafts,
html.wv-dark-mode .wv-favorites-close-global-mentions,
html.wv-dark-mode .wv-favorites-search-close,
html.wv-dark-mode .wv-favorites-mentions-close,
html.wv-dark-mode .wv-favorites-drafts-close {
    background: #334155 !important;
    color: #94a3b8 !important;
    border-color: #475569 !important;
}
html.wv-dark-mode .wv-favorites-close-global-drafts:hover,
html.wv-dark-mode .wv-favorites-close-global-mentions:hover,
html.wv-dark-mode .wv-favorites-search-close:hover,
html.wv-dark-mode .wv-favorites-mentions-close:hover {
    background: #475569 !important;
    color: #f1f5f9 !important;
}

/* ===== HOVER UTILITY CLASSES ===== */
html.wv-dark-mode .hover\\:tw-bg-gray-100:hover,
html.wv-dark-mode .hover\\:tw-bg-slate-100:hover {
    background-color: #334155 !important;
}
html.wv-dark-mode .hover\\:tw-bg-gray-50:hover,
html.wv-dark-mode .hover\\:tw-bg-slate-50:hover {
    background-color: #1e293b !important;
}

/* ===== CHAT HEADER PROFILE LINK ===== */
html.wv-dark-mode .wv-header-profile-link:hover {
    background: rgba(148, 163, 184, 0.15) !important;
}

/* ===== GOOGLE MEET SCHEDULE PICKER ===== */
html.wv-dark-mode #wv-schedule-meet-picker {
    background: #1e293b !important;
    border-color: #334155 !important;
    color: #cbd5e1 !important;
    box-shadow: 0 10px 30px rgba(0,0,0,0.5) !important;
}
/* Title text */
html.wv-dark-mode #wv-schedule-meet-picker > div:first-child {
    color: #f1f5f9 !important;
}
/* Inputs & textarea */
html.wv-dark-mode #wv-schedule-meet-picker input,
html.wv-dark-mode #wv-schedule-meet-picker textarea {
    background: #0f172a !important;
    border-color: #334155 !important;
    color: #e2e8f0 !important;
}
/* Read-only datetime input (readonly attr set by JS) */
html.wv-dark-mode #wv-schedule-meet-picker input[readonly] {
    background: #162032 !important;
    color: #64748b !important;
}
/* Pill buttons (inside startPills div — all div > button) */
html.wv-dark-mode #wv-schedule-meet-picker div > button {
    background: #162032 !important;
    border-color: #334155 !important;
    color: #94a3b8 !important;
}
/* Active pill — has blue border color (#1a73e8 → rgb(26,115,232)) */
html.wv-dark-mode #wv-schedule-meet-picker div > button[style*="rgb(26, 115, 232)"],
html.wv-dark-mode #wv-schedule-meet-picker div > button[style*="#1a73e8"] {
    background: #1e3a5f !important;
    border-color: #3b82f6 !important;
    color: #60a5fa !important;
}
/* Preview text row (direct div child with background) */
html.wv-dark-mode #wv-schedule-meet-picker > div[style*="background"] {
    background: #162032 !important;
    color: #94a3b8 !important;
}
/* Create Meeting button (direct child button of picker) */
html.wv-dark-mode #wv-schedule-meet-picker > button {
    background: #1a73e8 !important;
    border: none !important;
    color: #fff !important;
}

/* ===== SCROLLBARS ===== */
html.wv-dark-mode * {
    scrollbar-color: #334155 transparent;
}
html.wv-dark-mode *::-webkit-scrollbar-track {
    background: transparent;
}
html.wv-dark-mode *::-webkit-scrollbar-thumb {
    background-color: #334155;
    border-radius: 4px;
}
html.wv-dark-mode *::-webkit-scrollbar-thumb:hover {
    background-color: #475569;
}
`;
    }
})();
