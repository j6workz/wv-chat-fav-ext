// Welcome page animations and platform detection
document.addEventListener('DOMContentLoaded', async function() {
    // Display version number in all places
    const version = 'v' + chrome.runtime.getManifest().version;
    const versionElements = ['version-number', 'version-number-2', 'version-number-3', 'version-number-4'];
    versionElements.forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            element.textContent = version;
        }
    });

    // Detect platform for hotkey display
    const isMac = navigator.userAgent.toUpperCase().indexOf('MAC') >= 0;

    // Update platform-specific hotkey displays
    const platformSpecificElements = document.querySelectorAll('.platform-specific');
    platformSpecificElements.forEach(element => {
        const macText = element.getAttribute('data-mac');
        const winText = element.getAttribute('data-win');

        if (macText && winText) {
            element.textContent = isMac ? macText : winText;
        }
    });

    // Add animation to features
    const features = document.querySelectorAll('.feature');
    features.forEach((feature, index) => {
        feature.style.animationDelay = (index * 0.1) + 's';
        feature.classList.add('fade-in');
    });

    // Add animation to steps
    const steps = document.querySelectorAll('.step');
    steps.forEach((step, index) => {
        step.style.animationDelay = (0.3 + index * 0.1) + 's';
        step.classList.add('fade-in');
    });

    // Add animation to hotkeys
    const hotkeys = document.querySelectorAll('.hotkey');
    hotkeys.forEach((hotkey, index) => {
        hotkey.style.animationDelay = (0.6 + index * 0.1) + 's';
        hotkey.classList.add('fade-in');
    });

    // Initialize jurisdiction-aware privacy messaging
    await initializePrivacyMessage();
});

/**
 * Initialize jurisdiction-aware privacy messaging
 */
async function initializePrivacyMessage() {
    try {
        // Initialize consent manager
        const consentManager = new window.WVFavs.ConsentManager();
        await consentManager.init();

        // Get jurisdiction info
        const summary = await consentManager.getConsentSummary();
        const jurisdiction = summary.jurisdiction;

        // Apply default settings based on jurisdiction
        await consentManager.applyDefaultSettings(jurisdiction);

        // Update UI with jurisdiction-specific messaging
        displayJurisdictionMessage(jurisdiction, summary.consent);

    } catch (error) {
        console.error('Failed to initialize privacy message:', error);
        // Fallback to generic message
        displayFallbackMessage();
    }
}

/**
 * Display jurisdiction-specific privacy message
 */
function displayJurisdictionMessage(jurisdiction, consentStatus) {
    const messageEl = document.getElementById('jurisdictionMessage');
    const analyticsInfoEl = document.getElementById('analyticsInfo');

    if (!messageEl || !analyticsInfoEl) return;

    const privacyReq = jurisdiction.privacyRequirement;

    let icon = '📍';
    let title = '';
    let description = '';
    let analyticsMessage = '';

    if (privacyReq === 'strict_consent') {
        // Strict consent jurisdictions (GDPR, etc.)
        icon = '🔒';
        title = `Privacy-first for ${jurisdiction.displayName}`;
        description = `
            Based on your location (${jurisdiction.displayName}), we respect strict privacy laws
            (${jurisdiction.applicableLaws.join(', ')}). <strong>Analytics are disabled by default.</strong>
        `;
        analyticsMessage = `
            <div style="background: #fef3c7; border: 1px solid #fde68a; border-radius: 8px; padding: 12px; margin-top: 12px;">
                <p style="margin: 0; font-size: 13px; color: #92400e;">
                    <strong>⚠️ Your explicit consent is required:</strong> When you start using the extension,
                    you'll be asked once whether you want to enable analytics. You're in full control.
                </p>
            </div>
        `;
    } else if (privacyReq === 'opt_in_permissible') {
        // Permissive opt-in jurisdictions
        icon = '✅';
        title = `Analytics enabled for ${jurisdiction.displayName}`;
        description = `
            Based on your location (${jurisdiction.displayName}), <strong>anonymous usage analytics are enabled by default</strong>
            to help us improve the extension. This is common practice and fully compliant with local privacy laws.
        `;
        analyticsMessage = `
            <div style="background: #e0f2fe; border: 1px solid #bae6fd; border-radius: 8px; padding: 12px; margin-top: 12px;">
                <p style="margin: 0; font-size: 13px; color: #0c4a6e;">
                    <strong>ℹ️ You have full control:</strong> You can disable analytics anytime in the extension
                    options page. We only collect anonymous usage data - no personal information or chat content.
                </p>
            </div>
        `;
    } else {
        // Minimal requirements
        icon = '🌍';
        title = `Analytics enabled for ${jurisdiction.displayName}`;
        description = `
            <strong>Anonymous usage analytics are enabled</strong> to help us improve the extension.
            No personal information or chat content is collected.
        `;
        analyticsMessage = `
            <div style="background: #e0f2fe; border: 1px solid #bae6fd; border-radius: 8px; padding: 12px; margin-top: 12px;">
                <p style="margin: 0; font-size: 13px; color: #0c4a6e;">
                    <strong>ℹ️ Manage in settings:</strong> You can change analytics preferences anytime
                    in the extension options page.
                </p>
            </div>
        `;
    }

    messageEl.innerHTML = `
        <div style="display: flex; align-items: flex-start; gap: 12px;">
            <span style="font-size: 24px; flex-shrink: 0;">${icon}</span>
            <div style="flex: 1;">
                <p style="margin: 0 0 8px 0; font-weight: 600; color: #1f2937; font-size: 15px;">
                    ${title}
                </p>
                <p style="margin: 0; color: #374151; line-height: 1.6; font-size: 14px;">
                    ${description}
                </p>
            </div>
        </div>
    `;

    analyticsInfoEl.innerHTML = analyticsMessage;
    analyticsInfoEl.style.display = 'block';
}

/**
 * Display fallback message if jurisdiction detection fails
 */
function displayFallbackMessage() {
    const messageEl = document.getElementById('jurisdictionMessage');
    const analyticsInfoEl = document.getElementById('analyticsInfo');

    if (!messageEl || !analyticsInfoEl) return;

    messageEl.innerHTML = `
        <p style="margin: 0; color: #374151; line-height: 1.6; font-size: 14px;">
            <strong>Privacy-first approach:</strong> We respect your privacy and comply with global privacy laws.
            Analytics preferences can be managed in the extension options.
        </p>
    `;

    analyticsInfoEl.innerHTML = `
        <div style="background: #e0f2fe; border: 1px solid #bae6fd; border-radius: 8px; padding: 12px; margin-top: 12px;">
            <p style="margin: 0; font-size: 13px; color: #0c4a6e;">
                <strong>ℹ️ Default settings applied:</strong> Analytics will be enabled with conservative defaults.
                You can change this anytime in settings.
            </p>
        </div>
    `;

    analyticsInfoEl.style.display = 'block';
}