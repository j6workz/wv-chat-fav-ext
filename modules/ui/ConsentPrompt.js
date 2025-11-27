/**
 * Consent Prompt UI for WorkVivo Favorites Extension
 * Shows consent dialog for strict jurisdiction users on first use
 */

class ConsentPrompt {
    constructor() {
        this.consentManager = null;
        this.isVisible = false;
        this.promptElement = null;
    }

    /**
     * Initialize consent prompt
     */
    async init() {
        // Initialize consent manager
        if (window.WVFavs && window.WVFavs.ConsentManager) {
            this.consentManager = new window.WVFavs.ConsentManager();
            await this.consentManager.init();
        } else {
            console.error('ConsentManager not available');
            return;
        }

        // Check if prompt is needed
        const needsPrompt = await this.consentManager.needsConsentPrompt();

        if (needsPrompt.needsPrompt) {
            // Show prompt after a short delay to not interrupt page load
            setTimeout(() => this.showPrompt(needsPrompt.jurisdiction), 2000);
        }
    }

    /**
     * Show consent prompt
     */
    async showPrompt(jurisdiction) {
        if (this.isVisible) return;

        // Create prompt UI
        this.promptElement = this.createPromptUI(jurisdiction);
        document.body.appendChild(this.promptElement);

        this.isVisible = true;

        // Animate in
        setTimeout(() => {
            this.promptElement.classList.add('wv-consent-prompt-visible');
        }, 100);
    }

    /**
     * Create prompt UI element
     */
    createPromptUI(jurisdiction) {
        const overlay = document.createElement('div');
        overlay.className = 'wv-consent-prompt-overlay';
        overlay.innerHTML = `
            <div class="wv-consent-prompt">
                <div class="wv-consent-header">
                    <h2>🔒 Privacy & Analytics</h2>
                    <button class="wv-consent-close" aria-label="Close" title="Decline and close">×</button>
                </div>

                <div class="wv-consent-body">
                    <div class="wv-jurisdiction-info">
                        <span class="wv-flag">📍</span>
                        <span class="wv-location">Detected location: <strong>${this.escapeHtml(jurisdiction.displayName)}</strong></span>
                    </div>

                    <p class="wv-consent-intro">
                        WorkVivo Chat Favorites collects anonymous usage analytics to improve the extension.
                        Your privacy is important to us.
                    </p>

                    <div class="wv-consent-options">
                        <label class="wv-consent-option">
                            <input type="checkbox" id="wv-consent-analytics" checked>
                            <div class="wv-option-details">
                                <strong>Usage Analytics</strong>
                                <p>Share anonymous usage data (features used, clicks, searches)</p>
                            </div>
                        </label>

                        <label class="wv-consent-option">
                            <input type="checkbox" id="wv-consent-device">
                            <div class="wv-option-details">
                                <strong>Device & Location Data</strong>
                                <p>Share device type and country (from browser language)</p>
                            </div>
                        </label>

                        <div class="wv-consent-option wv-consent-always-on">
                            <input type="checkbox" checked disabled>
                            <div class="wv-option-details">
                                <strong>Error Reporting</strong>
                                <p>Automatically send crash reports and errors (always enabled for bug fixes)</p>
                            </div>
                        </div>
                    </div>

                    <div class="wv-consent-notice">
                        <p>
                            <strong>🛡️ Your data is protected:</strong> All data is anonymized.
                            No personal information or chat content is ever collected.
                            You can change these settings anytime in the extension options page.
                        </p>
                        <p class="wv-laws">
                            ${jurisdiction.applicableLaws && jurisdiction.applicableLaws.length > 0
                                ? `Applicable privacy laws: ${jurisdiction.applicableLaws.join(', ')}`
                                : ''}
                        </p>
                    </div>
                </div>

                <div class="wv-consent-footer">
                    <button class="wv-consent-btn wv-consent-btn-secondary" id="wv-consent-decline">
                        Decline All
                    </button>
                    <button class="wv-consent-btn wv-consent-btn-primary" id="wv-consent-accept">
                        Save Preferences
                    </button>
                </div>

                <div class="wv-consent-links">
                    <a href="https://j6.studio/workvivo-chat-favorites-extension/privacy-policy.html" target="_blank" rel="noopener noreferrer">
                        Privacy Policy
                    </a>
                </div>
            </div>
        `;

        // Add event listeners
        this.attachEventListeners(overlay);

        // Add styles
        this.injectStyles();

        return overlay;
    }

    /**
     * Attach event listeners to prompt
     */
    attachEventListeners(overlay) {
        const closeBtn = overlay.querySelector('.wv-consent-close');
        const declineBtn = overlay.querySelector('#wv-consent-decline');
        const acceptBtn = overlay.querySelector('#wv-consent-accept');

        closeBtn.addEventListener('click', () => this.handleDecline());
        declineBtn.addEventListener('click', () => this.handleDecline());
        acceptBtn.addEventListener('click', () => this.handleAccept());

        // Close on overlay click (but not on prompt click)
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                this.handleDecline();
            }
        });

        // Escape key to close
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isVisible) {
                this.handleDecline();
            }
        });
    }

    /**
     * Handle accept button click
     */
    async handleAccept() {
        const analyticsEnabled = document.getElementById('wv-consent-analytics').checked;
        const shareUsageData = document.getElementById('wv-consent-device').checked;

        await this.consentManager.recordConsent({
            analyticsEnabled,
            shareUsageData,
            errorReporting: true
        });

        this.closePrompt();

        // Show confirmation
        this.showNotification('✅ Preferences saved. You can change these anytime in settings.');
    }

    /**
     * Handle decline button click
     */
    async handleDecline() {
        await this.consentManager.recordConsent({
            analyticsEnabled: false,
            shareUsageData: false,
            errorReporting: true
        });

        this.closePrompt();

        this.showNotification('Analytics disabled. You can enable it anytime in extension settings.');
    }

    /**
     * Close the prompt
     */
    closePrompt() {
        if (!this.isVisible || !this.promptElement) return;

        this.promptElement.classList.remove('wv-consent-prompt-visible');

        setTimeout(() => {
            if (this.promptElement && this.promptElement.parentNode) {
                this.promptElement.parentNode.removeChild(this.promptElement);
            }
            this.promptElement = null;
            this.isVisible = false;
        }, 300);
    }

    /**
     * Show notification
     */
    showNotification(message) {
        const notification = document.createElement('div');
        notification.className = 'wv-consent-notification';
        notification.textContent = message;
        document.body.appendChild(notification);

        setTimeout(() => notification.classList.add('wv-consent-notification-visible'), 100);

        setTimeout(() => {
            notification.classList.remove('wv-consent-notification-visible');
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 300);
        }, 4000);
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
     * Inject CSS styles
     */
    injectStyles() {
        if (document.getElementById('wv-consent-prompt-styles')) return;

        const style = document.createElement('style');
        style.id = 'wv-consent-prompt-styles';
        style.textContent = `
            .wv-consent-prompt-overlay {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0, 0, 0, 0.7);
                backdrop-filter: blur(4px);
                z-index: 999999;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 20px;
                opacity: 0;
                transition: opacity 0.3s ease;
            }

            .wv-consent-prompt-overlay.wv-consent-prompt-visible {
                opacity: 1;
            }

            .wv-consent-prompt {
                background: white;
                border-radius: 16px;
                max-width: 600px;
                width: 100%;
                box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
                transform: scale(0.9);
                transition: transform 0.3s ease;
                max-height: 90vh;
                overflow: hidden;
                display: flex;
                flex-direction: column;
            }

            .wv-consent-prompt-visible .wv-consent-prompt {
                transform: scale(1);
            }

            .wv-consent-header {
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                padding: 24px;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }

            .wv-consent-header h2 {
                margin: 0;
                font-size: 24px;
                font-weight: 600;
            }

            .wv-consent-close {
                background: rgba(255, 255, 255, 0.2);
                border: none;
                color: white;
                width: 32px;
                height: 32px;
                border-radius: 50%;
                font-size: 24px;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: background 0.2s;
            }

            .wv-consent-close:hover {
                background: rgba(255, 255, 255, 0.3);
            }

            .wv-consent-body {
                padding: 24px;
                overflow-y: auto;
                flex: 1;
            }

            .wv-jurisdiction-info {
                background: #f8f9fa;
                border: 1px solid #e9ecef;
                border-radius: 8px;
                padding: 12px 16px;
                margin-bottom: 20px;
                display: flex;
                align-items: center;
                gap: 8px;
                font-size: 14px;
            }

            .wv-flag {
                font-size: 18px;
            }

            .wv-consent-intro {
                font-size: 15px;
                line-height: 1.6;
                color: #374151;
                margin-bottom: 20px;
            }

            .wv-consent-options {
                margin-bottom: 20px;
            }

            .wv-consent-option {
                display: flex;
                align-items: flex-start;
                gap: 12px;
                padding: 16px;
                background: #f8f9fa;
                border: 2px solid #e9ecef;
                border-radius: 8px;
                margin-bottom: 12px;
                cursor: pointer;
                transition: all 0.2s;
            }

            .wv-consent-option:hover {
                border-color: #667eea;
                background: #f0f4ff;
            }

            .wv-consent-option.wv-consent-always-on {
                opacity: 0.7;
                cursor: default;
            }

            .wv-consent-option.wv-consent-always-on:hover {
                border-color: #e9ecef;
                background: #f8f9fa;
            }

            .wv-consent-option input[type="checkbox"] {
                margin-top: 2px;
                width: 18px;
                height: 18px;
                cursor: pointer;
                flex-shrink: 0;
            }

            .wv-option-details {
                flex: 1;
            }

            .wv-option-details strong {
                display: block;
                margin-bottom: 4px;
                color: #1f2937;
                font-size: 15px;
            }

            .wv-option-details p {
                margin: 0;
                font-size: 13px;
                color: #6b7280;
                line-height: 1.4;
            }

            .wv-consent-notice {
                background: #e0f2fe;
                border: 1px solid #bae6fd;
                border-radius: 8px;
                padding: 16px;
                font-size: 13px;
                color: #0c4a6e;
                line-height: 1.5;
            }

            .wv-consent-notice p {
                margin: 0 0 8px 0;
            }

            .wv-consent-notice p:last-child {
                margin-bottom: 0;
            }

            .wv-laws {
                font-size: 12px;
                font-style: italic;
                color: #0369a1;
            }

            .wv-consent-footer {
                padding: 20px 24px;
                border-top: 1px solid #e9ecef;
                display: flex;
                gap: 12px;
                justify-content: flex-end;
            }

            .wv-consent-btn {
                padding: 12px 24px;
                border: none;
                border-radius: 8px;
                font-weight: 600;
                font-size: 14px;
                cursor: pointer;
                transition: all 0.2s;
            }

            .wv-consent-btn-primary {
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
            }

            .wv-consent-btn-primary:hover {
                transform: translateY(-2px);
                box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
            }

            .wv-consent-btn-secondary {
                background: #f3f4f6;
                color: #374151;
            }

            .wv-consent-btn-secondary:hover {
                background: #e5e7eb;
            }

            .wv-consent-links {
                padding: 12px 24px;
                text-align: center;
                background: #f8f9fa;
                font-size: 13px;
            }

            .wv-consent-links a {
                color: #667eea;
                text-decoration: none;
            }

            .wv-consent-links a:hover {
                text-decoration: underline;
            }

            .wv-consent-notification {
                position: fixed;
                bottom: 20px;
                right: 20px;
                background: #1f2937;
                color: white;
                padding: 16px 24px;
                border-radius: 8px;
                box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
                z-index: 1000000;
                max-width: 400px;
                opacity: 0;
                transform: translateY(20px);
                transition: all 0.3s ease;
            }

            .wv-consent-notification.wv-consent-notification-visible {
                opacity: 1;
                transform: translateY(0);
            }

            @media (max-width: 640px) {
                .wv-consent-prompt {
                    max-width: 100%;
                    margin: 10px;
                }

                .wv-consent-header h2 {
                    font-size: 20px;
                }

                .wv-consent-footer {
                    flex-direction: column;
                }

                .wv-consent-btn {
                    width: 100%;
                }
            }
        `;
        document.head.appendChild(style);
    }
}

// Make ConsentPrompt available globally
if (typeof window !== 'undefined') {
    window.WVFavs = window.WVFavs || {};
    window.WVFavs.ConsentPrompt = ConsentPrompt;
}

// Export for Node.js environments (testing)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ConsentPrompt;
}
