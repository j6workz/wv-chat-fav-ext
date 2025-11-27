// GoogleMeetManager - Handles Google Meet integration for instant meetings

(function() {
    'use strict';

    class GoogleMeetManager {
        constructor(app) {
            this.app = app;
            this.accessToken = null;
            this.tokenExpiresAt = null;
        }

        /**
         * Initialize the Google Meet Manager
         */
        async init() {
            try {
                // Check if user is already authenticated
                const storedAuth = await this.getStoredAuth();
                if (storedAuth && storedAuth.accessToken && storedAuth.expiresAt > Date.now()) {
                    this.accessToken = storedAuth.accessToken;
                    this.tokenExpiresAt = storedAuth.expiresAt;

                    if (this.app.logger) {
                        this.app?.logger?.log('✅ GoogleMeetManager initialized with existing auth');
                    }
                }
            } catch (error) {
                if (this.app.logger) {
                    this.app?.logger?.error('Failed to initialize GoogleMeetManager:', error);
                }
            }
        }

        /**
         * Check if user is authenticated
         */
        isAuthenticated() {
            return this.accessToken && this.tokenExpiresAt && this.tokenExpiresAt > Date.now();
        }

        /**
         * Authenticate with Google OAuth2
         * Uses message passing to background script since chrome.identity is not available in content scripts
         */
        async authenticate() {
            try {
                if (this.app.logger) {
                    this.app?.logger?.log('🔐 Starting Google authentication...');
                }

                // Send authentication request to background script
                return new Promise((resolve, reject) => {
                    chrome.runtime.sendMessage(
                        { action: 'GOOGLE_MEET_AUTH' },
                        (response) => {
                            if (chrome.runtime.lastError) {
                                if (this.app.logger) {
                                    this.app?.logger?.error('Auth error:', chrome.runtime.lastError);
                                }
                                reject(new Error(chrome.runtime.lastError.message));
                                return;
                            }

                            if (!response || !response.success) {
                                reject(new Error(response?.error || 'Authentication failed'));
                                return;
                            }

                            // Store token
                            this.accessToken = response.accessToken;
                            this.tokenExpiresAt = response.expiresAt;

                            if (this.app.logger) {
                                this.app?.logger?.log('✅ Google authentication successful');
                            }

                            resolve(response.accessToken);
                        }
                    );
                });
            } catch (error) {
                if (this.app.logger) {
                    this.app?.logger?.error('Authentication failed:', error);
                }
                throw error;
            }
        }

        /**
         * Sign out and revoke token
         * Uses message passing to background script since chrome.identity is not available in content scripts
         */
        async signOut() {
            try {
                if (this.accessToken) {
                    const token = this.accessToken;

                    // Send sign out request to background script
                    return new Promise((resolve, reject) => {
                        chrome.runtime.sendMessage(
                            {
                                action: 'GOOGLE_MEET_SIGN_OUT',
                                token: token
                            },
                            (response) => {
                                if (chrome.runtime.lastError) {
                                    if (this.app.logger) {
                                        this.app?.logger?.error('Sign out error:', chrome.runtime.lastError);
                                    }
                                    reject(new Error(chrome.runtime.lastError.message));
                                    return;
                                }

                                if (!response || !response.success) {
                                    reject(new Error(response?.error || 'Sign out failed'));
                                    return;
                                }

                                // Clear local state
                                this.accessToken = null;
                                this.tokenExpiresAt = null;

                                if (this.app.logger) {
                                    this.app?.logger?.log('✅ Signed out from Google');
                                }

                                resolve();
                            }
                        );
                    });
                }
            } catch (error) {
                if (this.app.logger) {
                    this.app?.logger?.error('Sign out failed:', error);
                }
                throw error;
            }
        }

        /**
         * Create an instant Google Meet meeting
         */
        async createInstantMeeting(meetingTitle = 'Quick Meeting', durationMinutes = 30) {
            try {
                // Ensure we have a valid token
                if (!this.isAuthenticated()) {
                    await this.authenticate();
                }

                if (this.app.logger) {
                    this.app?.logger?.log(`📅 Creating instant Google Meet (${durationMinutes} min)...`);
                }

                const now = new Date();
                const endTime = new Date(now.getTime() + (durationMinutes * 60 * 1000)); // Convert minutes to milliseconds

                // Create calendar event with Google Meet
                const event = {
                    summary: meetingTitle,
                    description: 'Meeting created via WorkVivo Chat Favorites extension',
                    start: {
                        dateTime: now.toISOString(),
                        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
                    },
                    end: {
                        dateTime: endTime.toISOString(),
                        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
                    },
                    conferenceData: {
                        createRequest: {
                            requestId: this.generateRequestId(),
                            conferenceSolutionKey: {
                                type: 'hangoutsMeet'
                            }
                        }
                    }
                };

                const response = await fetch(
                    'https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1',
                    {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${this.accessToken}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(event)
                    }
                );

                // Check for permission errors (403/401) - requires re-authentication
                if (response.status === 403 || response.status === 401) {
                    const error = await response.json().catch(() => ({}));

                    if (this.app.logger) {
                        this.app?.logger?.log(`🔐 Permission error (${response.status}): Insufficient calendar permissions`);
                    }

                    // Throw specific error for permission issues
                    const permError = new Error('PERMISSION_DENIED');
                    permError.status = response.status;
                    permError.details = error;
                    throw permError;
                }

                if (!response.ok) {
                    const error = await response.json();
                    throw new Error(error.error?.message || 'Failed to create meeting');
                }

                const createdEvent = await response.json();
                const meetLink = createdEvent.hangoutLink || createdEvent.conferenceData?.entryPoints?.[0]?.uri;

                if (!meetLink) {
                    throw new Error('Meeting created but no link found');
                }

                if (this.app.logger) {
                    this.app?.logger?.log('✅ Google Meet created:', meetLink);
                }

                // Track analytics
                if (this.app.logger) {
                    this.app?.logger?.analytics('google_meet_created', {
                        meeting_title: meetingTitle
                    });
                }

                return {
                    meetLink,
                    eventId: createdEvent.id,
                    htmlLink: createdEvent.htmlLink
                };
            } catch (error) {
                if (this.app.logger) {
                    this.app?.logger?.error('Failed to create Google Meet:', error);
                }
                throw error;
            }
        }

        /**
         * Generate a unique request ID for conference data
         */
        generateRequestId() {
            return `wv-meet-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        }

        /**
         * Get stored authentication data
         */
        async getStoredAuth() {
            return new Promise((resolve) => {
                chrome.storage.local.get(['googleMeetAuth'], (result) => {
                    resolve(result.googleMeetAuth || null);
                });
            });
        }

        /**
         * Save authentication data
         */
        async saveAuth(authData) {
            return new Promise((resolve) => {
                chrome.storage.local.set({ googleMeetAuth: authData }, resolve);
            });
        }

        /**
         * Clear authentication data
         */
        async clearAuth() {
            return new Promise((resolve) => {
                chrome.storage.local.remove(['googleMeetAuth'], resolve);
            });
        }
    }

    // Export to WVFavs namespace
    if (!window.WVFavs) {
        window.WVFavs = {};
    }
    window.WVFavs.GoogleMeetManager = GoogleMeetManager;
})();
