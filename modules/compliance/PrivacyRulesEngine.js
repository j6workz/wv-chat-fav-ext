/**
 * Privacy Rules Engine for WorkVivo Favorites Extension
 * Maps jurisdictions to specific privacy compliance requirements
 * Handles GA4-specific privacy rules and consent management
 */

class PrivacyRulesEngine {
    constructor() {
        this.jurisdictionDetector = null;
        this.isInitialized = false;

        // Privacy requirement tiers
        this.privacyTiers = {
            STRICT_CONSENT: 'strict_consent',
            OPT_IN_PERMISSIBLE: 'opt_in_permissible',
            MINIMAL_REQUIREMENTS: 'minimal_requirements'
        };

        // GA4-specific privacy requirements
        this.ga4Requirements = {
            processor_disclosure: true,
            google_privacy_policy: true,
            data_transfer_notice: true,
            retention_policy: true
        };

        this.init();
    }

    /**
     * Initialize the privacy rules engine
     */
    async init() {
        try {
            if (window.WVFavs && window.WVFavs.JurisdictionDetector) {
                this.jurisdictionDetector = new window.WVFavs.JurisdictionDetector();
                await this.jurisdictionDetector.init();
            }
            this.isInitialized = true;
        } catch (error) {
            console.warn('PrivacyRulesEngine initialization failed:', error);
        }
    }

    /**
     * Get privacy requirements for a jurisdiction
     */
    async getPrivacyRequirements(jurisdiction = null) {
        if (!this.isInitialized) {
            await this.init();
        }

        let targetJurisdiction = jurisdiction;
        if (!targetJurisdiction && this.jurisdictionDetector) {
            const detected = await this.jurisdictionDetector.detectJurisdiction();
            targetJurisdiction = detected.jurisdiction;
        }

        const tier = this.getPrivacyTier(targetJurisdiction);
        const requirements = this.getRequirementsByTier(tier);

        return {
            jurisdiction: targetJurisdiction,
            tier: tier,
            ...requirements,
            ga4Requirements: this.ga4Requirements,
            applicableLaws: this.getApplicableLaws(targetJurisdiction),
            userRights: this.getUserRights(tier),
            consentRequirements: this.getConsentRequirements(tier),
            defaultSettings: this.getDefaultSettings(tier)
        };
    }

    /**
     * Determine privacy tier for jurisdiction
     */
    getPrivacyTier(jurisdiction) {
        if (!jurisdiction || jurisdiction === 'unknown') {
            return this.privacyTiers.MINIMAL_REQUIREMENTS;
        }

        // EU/EEA (GDPR) - Strict consent required
        const euCountries = [
            'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU',
            'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES',
            'SE', 'IS', 'LI', 'NO', 'CH'
        ];

        if (euCountries.includes(jurisdiction)) {
            return this.privacyTiers.STRICT_CONSENT;
        }

        // US states with strict privacy laws
        const strictUSStates = [
            'CA-US', 'VA-US', 'CO-US', 'CT-US', 'UT-US', 'IA-US', 'DE-US', 'NE-US',
            'NH-US', 'NJ-US', 'TN-US', 'MN-US', 'MD-US'
        ];

        if (strictUSStates.includes(jurisdiction)) {
            return this.privacyTiers.STRICT_CONSENT;
        }

        // Countries/states with permissive privacy laws
        const permissiveJurisdictions = [
            'US', 'CA', 'AU', 'GB', 'NZ', 'JP', 'KR', 'SG', 'HK',
            // US states without strict privacy laws
            'AL-US', 'AK-US', 'AZ-US', 'AR-US', 'FL-US', 'GA-US', 'HI-US', 'ID-US',
            'IL-US', 'IN-US', 'KS-US', 'KY-US', 'LA-US', 'ME-US', 'MA-US', 'MI-US',
            'MS-US', 'MO-US', 'MT-US', 'NV-US', 'NY-US', 'NC-US', 'ND-US', 'OH-US',
            'OK-US', 'OR-US', 'PA-US', 'RI-US', 'SC-US', 'SD-US', 'TX-US', 'VT-US',
            'WA-US', 'WV-US', 'WI-US', 'WY-US', 'DC-US'
        ];

        if (permissiveJurisdictions.includes(jurisdiction)) {
            return this.privacyTiers.OPT_IN_PERMISSIBLE;
        }

        // Default to minimal requirements for other jurisdictions
        return this.privacyTiers.MINIMAL_REQUIREMENTS;
    }

    /**
     * Get requirements by privacy tier
     */
    getRequirementsByTier(tier) {
        switch (tier) {
            case this.privacyTiers.STRICT_CONSENT:
                return {
                    explicitConsent: true,
                    optInDefault: false,
                    granularConsent: true,
                    rightToWithdraw: true,
                    dataPortability: true,
                    rightToErasure: true,
                    privacyByDesign: true,
                    dataProtectionOfficer: false, // Not required for our scale
                    consentBannerRequired: true,
                    detailedPrivacyNotice: true,
                    legalBasisDisclosure: true
                };

            case this.privacyTiers.OPT_IN_PERMISSIBLE:
                return {
                    explicitConsent: false,
                    optInDefault: true,
                    granularConsent: true,
                    rightToWithdraw: true,
                    dataPortability: false,
                    rightToErasure: true,
                    privacyByDesign: true,
                    dataProtectionOfficer: false,
                    consentBannerRequired: false,
                    detailedPrivacyNotice: true,
                    legalBasisDisclosure: false
                };

            case this.privacyTiers.MINIMAL_REQUIREMENTS:
            default:
                return {
                    explicitConsent: false,
                    optInDefault: true,
                    granularConsent: false,
                    rightToWithdraw: true,
                    dataPortability: false,
                    rightToErasure: false,
                    privacyByDesign: false,
                    dataProtectionOfficer: false,
                    consentBannerRequired: false,
                    detailedPrivacyNotice: false,
                    legalBasisDisclosure: false
                };
        }
    }

    /**
     * Get default privacy settings for tier
     */
    getDefaultSettings(tier) {
        switch (tier) {
            case this.privacyTiers.STRICT_CONSENT:
                return {
                    analyticsEnabled: false,        // Require explicit opt-in
                    shareUsageData: false,         // Require explicit opt-in
                    errorReporting: true,          // Always enabled (legitimate interest)
                    showConsentPrompt: true,       // Show detailed consent dialog
                    requireExplicitConsent: true,  // Must explicitly consent
                    allowImpliedConsent: false     // No implied consent
                };

            case this.privacyTiers.OPT_IN_PERMISSIBLE:
                return {
                    analyticsEnabled: true,        // Default enabled with clear opt-out
                    shareUsageData: true,         // Default enabled with clear opt-out
                    errorReporting: true,         // Always enabled
                    showConsentPrompt: false,     // Show notice with opt-out option
                    requireExplicitConsent: false, // Opt-out model allowed
                    allowImpliedConsent: true     // Implied consent acceptable
                };

            case this.privacyTiers.MINIMAL_REQUIREMENTS:
            default:
                return {
                    analyticsEnabled: true,        // Default enabled
                    shareUsageData: true,         // Default enabled
                    errorReporting: true,         // Always enabled
                    showConsentPrompt: false,     // Show basic notice
                    requireExplicitConsent: false, // No explicit consent required
                    allowImpliedConsent: true     // Implied consent acceptable
                };
        }
    }

    /**
     * Get user rights by privacy tier
     */
    getUserRights(tier) {
        const baseRights = {
            rightToInformation: true,
            rightOfAccess: true,
            rightToWithdraw: true
        };

        switch (tier) {
            case this.privacyTiers.STRICT_CONSENT:
                return {
                    ...baseRights,
                    rightToRectification: true,
                    rightToErasure: true,
                    rightToRestrictProcessing: true,
                    rightToDataPortability: true,
                    rightToObject: true,
                    rightsRelatedToAutomatedDecisionMaking: false // We don't do automated decisions
                };

            case this.privacyTiers.OPT_IN_PERMISSIBLE:
                return {
                    ...baseRights,
                    rightToRectification: true,
                    rightToErasure: true,
                    rightToRestrictProcessing: false,
                    rightToDataPortability: false,
                    rightToObject: true,
                    rightsRelatedToAutomatedDecisionMaking: false
                };

            case this.privacyTiers.MINIMAL_REQUIREMENTS:
            default:
                return baseRights;
        }
    }

    /**
     * Get consent requirements by privacy tier
     */
    getConsentRequirements(tier) {
        switch (tier) {
            case this.privacyTiers.STRICT_CONSENT:
                return {
                    consentMustBe: {
                        freely_given: true,
                        specific: true,
                        informed: true,
                        unambiguous: true
                    },
                    consentMethod: 'explicit_opt_in',
                    withdrawalMethod: 'easy_as_giving',
                    recordKeeping: 'detailed',
                    consentBanner: 'required',
                    preTickedBoxes: 'forbidden',
                    consentWalls: 'discouraged'
                };

            case this.privacyTiers.OPT_IN_PERMISSIBLE:
                return {
                    consentMustBe: {
                        freely_given: true,
                        specific: true,
                        informed: true,
                        unambiguous: false
                    },
                    consentMethod: 'opt_out_allowed',
                    withdrawalMethod: 'reasonably_easy',
                    recordKeeping: 'basic',
                    consentBanner: 'optional',
                    preTickedBoxes: 'allowed_with_notice',
                    consentWalls: 'allowed'
                };

            case this.privacyTiers.MINIMAL_REQUIREMENTS:
            default:
                return {
                    consentMustBe: {
                        freely_given: true,
                        specific: false,
                        informed: true,
                        unambiguous: false
                    },
                    consentMethod: 'implied_consent_allowed',
                    withdrawalMethod: 'basic',
                    recordKeeping: 'minimal',
                    consentBanner: 'not_required',
                    preTickedBoxes: 'allowed',
                    consentWalls: 'allowed'
                };
        }
    }

    /**
     * Get applicable laws for jurisdiction
     */
    getApplicableLaws(jurisdiction) {
        if (!jurisdiction) return [];

        const laws = [];

        // EU/EEA
        const euCountries = [
            'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU',
            'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES',
            'SE', 'IS', 'LI', 'NO', 'CH'
        ];

        if (euCountries.includes(jurisdiction)) {
            laws.push({
                name: 'GDPR',
                fullName: 'General Data Protection Regulation',
                scope: 'EU/EEA',
                enforcer: 'Data Protection Authorities',
                maxFine: '€20M or 4% of global turnover'
            });
        }

        // US Federal
        if (jurisdiction.includes('US') || jurisdiction === 'US') {
            laws.push({
                name: 'COPPA',
                fullName: 'Children\'s Online Privacy Protection Act',
                scope: 'US Federal',
                enforcer: 'FTC',
                maxFine: '$43,792 per violation'
            });
        }

        // US State-specific
        const stateLaws = {
            'CA-US': [{
                name: 'CCPA/CPRA',
                fullName: 'California Consumer Privacy Act / California Privacy Rights Act',
                scope: 'California',
                enforcer: 'California Privacy Protection Agency',
                maxFine: '$7,500 per violation'
            }],
            'VA-US': [{
                name: 'VCDPA',
                fullName: 'Virginia Consumer Data Protection Act',
                scope: 'Virginia',
                enforcer: 'Virginia Attorney General',
                maxFine: 'Up to $7,500 per violation'
            }],
            'CO-US': [{
                name: 'CPA',
                fullName: 'Colorado Privacy Act',
                scope: 'Colorado',
                enforcer: 'Colorado Attorney General',
                maxFine: 'Up to $20,000 per violation'
            }],
            'CT-US': [{
                name: 'CTDPA',
                fullName: 'Connecticut Data Privacy Act',
                scope: 'Connecticut',
                enforcer: 'Connecticut Attorney General',
                maxFine: 'Up to $5,000 per violation'
            }]
        };

        if (stateLaws[jurisdiction]) {
            laws.push(...stateLaws[jurisdiction]);
        }

        // Other countries
        const countryLaws = {
            'CA': [{
                name: 'PIPEDA',
                fullName: 'Personal Information Protection and Electronic Documents Act',
                scope: 'Canada',
                enforcer: 'Privacy Commissioner of Canada',
                maxFine: 'Administrative penalties'
            }],
            'BR': [{
                name: 'LGPD',
                fullName: 'Lei Geral de Proteção de Dados',
                scope: 'Brazil',
                enforcer: 'ANPD',
                maxFine: 'R$50M (~$10M USD)'
            }],
            'AU': [{
                name: 'Privacy Act',
                fullName: 'Privacy Act 1988',
                scope: 'Australia',
                enforcer: 'OAIC',
                maxFine: 'AUD $2.22M'
            }],
            'GB': [{
                name: 'UK GDPR',
                fullName: 'UK General Data Protection Regulation',
                scope: 'United Kingdom',
                enforcer: 'ICO',
                maxFine: '£17.5M or 4% of turnover'
            }]
        };

        if (countryLaws[jurisdiction]) {
            laws.push(...countryLaws[jurisdiction]);
        }

        return laws;
    }

    /**
     * Get GA4-specific privacy requirements
     */
    getGA4PrivacyRequirements(tier) {
        const baseGA4Requirements = {
            processorDisclosure: {
                required: true,
                content: 'We use Google Analytics to understand how you use our extension features.'
            },
            googlePrivacyPolicy: {
                required: true,
                url: 'https://policies.google.com/privacy',
                content: 'Google\'s privacy policy applies to data processed by Google Analytics.'
            },
            dataTransferNotice: {
                required: true,
                content: 'Your usage data may be transferred to and processed in the United States by Google.'
            },
            retentionPolicy: {
                required: true,
                content: 'Analytics data is retained for the period necessary to improve our product features.'
            },
            purposeLimitation: {
                required: true,
                content: 'Data shared with Google Analytics is used solely for product improvement and feature optimization.'
            }
        };

        switch (tier) {
            case this.privacyTiers.STRICT_CONSENT:
                return {
                    ...baseGA4Requirements,
                    explicitConsentRequired: true,
                    legalBasisDisclosure: {
                        required: true,
                        content: 'Legal basis: Consent (GDPR Article 6(1)(a))'
                    },
                    dataSubjectRights: {
                        required: true,
                        content: 'You have rights regarding your data processed by Google Analytics, including access, rectification, and erasure.'
                    }
                };

            case this.privacyTiers.OPT_IN_PERMISSIBLE:
                return {
                    ...baseGA4Requirements,
                    explicitConsentRequired: false,
                    optOutMechanism: {
                        required: true,
                        content: 'You can opt out of analytics data sharing at any time in extension settings.'
                    }
                };

            case this.privacyTiers.MINIMAL_REQUIREMENTS:
            default:
                return {
                    ...baseGA4Requirements,
                    explicitConsentRequired: false,
                    basicNotice: {
                        required: true,
                        content: 'This extension uses Google Analytics to improve features.'
                    }
                };
        }
    }

    /**
     * Validate privacy compliance for jurisdiction
     */
    async validateCompliance(currentSettings, jurisdiction = null) {
        const requirements = await this.getPrivacyRequirements(jurisdiction);
        const violations = [];

        // Check default settings compliance
        if (requirements.requireExplicitConsent && currentSettings.analyticsEnabled === true) {
            violations.push({
                type: 'consent_violation',
                message: 'Analytics enabled by default in strict consent jurisdiction',
                severity: 'high'
            });
        }

        // Check consent mechanism
        if (requirements.explicitConsent && !currentSettings.hasValidConsent) {
            violations.push({
                type: 'consent_mechanism',
                message: 'Explicit consent required but not obtained',
                severity: 'high'
            });
        }

        // Check GA4 disclosures
        if (!currentSettings.hasGA4Disclosure) {
            violations.push({
                type: 'disclosure_missing',
                message: 'Google Analytics processor disclosure missing',
                severity: 'medium'
            });
        }

        return {
            compliant: violations.length === 0,
            violations: violations,
            requirements: requirements
        };
    }

    /**
     * Get privacy notice content for jurisdiction
     */
    getPrivacyNoticeContent(tier, ga4Requirements) {
        const notices = {
            [this.privacyTiers.STRICT_CONSENT]: {
                headline: 'Your Privacy Rights',
                introduction: 'We respect your privacy and require your explicit consent before collecting any usage data.',
                dataProcessing: 'We use Google Analytics to understand feature usage and improve our extension. This requires sharing usage data with Google.',
                yourRights: 'You have comprehensive rights over your data, including access, rectification, erasure, and data portability.',
                legalBasis: 'Legal basis for processing: Your explicit consent.',
                withdrawal: 'You can withdraw your consent at any time through extension settings.'
            },

            [this.privacyTiers.OPT_IN_PERMISSIBLE]: {
                headline: 'Privacy Notice',
                introduction: 'We care about your privacy and want to be transparent about our data practices.',
                dataProcessing: 'We use Google Analytics to understand how features are used, helping us improve the extension.',
                yourRights: 'You can opt out of analytics data sharing at any time in settings.',
                legalBasis: 'We process this data to improve our product based on your usage patterns.',
                withdrawal: 'You can disable analytics data sharing in extension settings.'
            },

            [this.privacyTiers.MINIMAL_REQUIREMENTS]: {
                headline: 'Privacy Information',
                introduction: 'This extension uses analytics to improve features and user experience.',
                dataProcessing: 'Google Analytics helps us understand feature usage for product improvement.',
                yourRights: 'You can disable analytics in extension settings if preferred.',
                legalBasis: 'Data is processed for product improvement purposes.',
                withdrawal: 'Analytics can be disabled in settings.'
            }
        };

        return notices[tier] || notices[this.privacyTiers.MINIMAL_REQUIREMENTS];
    }

    /**
     * Get jurisdiction-specific contact information
     */
    getContactInformation(jurisdiction) {
        // This would be customized based on your organization's legal structure
        return {
            dataController: 'WorkVivo Favorites Extension Developer',
            contactEmail: 'privacy@example.com', // Replace with actual contact
            dataProtectionOfficer: null, // If applicable
            supervisoryAuthority: this.getSupervisoryAuthority(jurisdiction)
        };
    }

    /**
     * Get supervisory authority for jurisdiction
     */
    getSupervisoryAuthority(jurisdiction) {
        const authorities = {
            'DE': { name: 'BfDI', url: 'https://www.bfdi.bund.de/' },
            'FR': { name: 'CNIL', url: 'https://www.cnil.fr/' },
            'GB': { name: 'ICO', url: 'https://ico.org.uk/' },
            'CA-US': { name: 'CPPA', url: 'https://cppa.ca.gov/' },
            'CA': { name: 'OPC', url: 'https://www.priv.gc.ca/' }
        };

        return authorities[jurisdiction] || null;
    }
}

// Make PrivacyRulesEngine available globally
if (typeof window !== 'undefined') {
    window.WVFavs = window.WVFavs || {};
    window.WVFavs.PrivacyRulesEngine = PrivacyRulesEngine;
}

// Export for Node.js environments (testing)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PrivacyRulesEngine;
}