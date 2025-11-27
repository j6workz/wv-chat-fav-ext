/**
 * Fetch Interceptor - Injected into page context
 * This runs BEFORE WorkVivo loads, so we can intercept SendBird API calls
 */

(function() {
    'use strict';


    // Store intercepted data in window for ThreadManager to access
    window.__wvThreadData = {
        messages: new Map(), // channelUrl -> messages[]
        changelogs: new Map(), // channelUrl -> changelog data
        currentChannel: null
    };

    // Store current user data for UserIdentityManager
    window.__wvCurrentUser = null;

    // Store Sendbird API headers for authenticated requests
    window.__wvSendbirdHeaders = null;

    // Store Sendbird API base URL (dynamically captured from network requests)
    window.__wvSendbirdBaseUrl = null;

    /**
     * Try to extract user ID from Sendbird API calls
     */
    function extractUserFromURL(url, headers) {
        try {
            // Method 1: Check for /users/{user_id} pattern in URL
            const userIdMatch = url.match(/\/users\/([^\/\?]+)/);
            if (userIdMatch && userIdMatch[1] && userIdMatch[1].length > 5) {
                return { id: userIdMatch[1], source: 'url_pattern' };
            }

            // Method 2: Check for session_key or user_id in query params
            if (url.includes('session_key=') || url.includes('user_id=')) {
                const urlObj = new URL(url);
                const userId = urlObj.searchParams.get('user_id');
                if (userId) {
                    return { id: userId, source: 'query_param' };
                }
            }

            // Method 3: Check authorization headers
            if (headers && headers['Sendbird-User-Id']) {
                return { id: headers['Sendbird-User-Id'], source: 'header' };
            }
        } catch (error) {
            console.error('Error extracting user from URL:', error);
        }
        return null;
    }

    /**
     * Try to extract user from response data
     */
    function extractUserFromResponse(data) {
        try {
            // Check if response contains current user info
            // Look for patterns in channel members where one member might be current user
            if (data.members && Array.isArray(data.members)) {
                // The first member is often the current user in DM channels
                for (const member of data.members) {
                    if (member.user_id && member.is_online !== undefined) {
                        // This might be current user - store as potential candidate
                        return {
                            id: member.user_id,
                            name: member.nickname,
                            profile_url: member.profile_url,
                            source: 'channel_member'
                        };
                    }
                }
            }

            // Check messages for user patterns
            if (data.messages && Array.isArray(data.messages)) {
                for (const msg of data.messages) {
                    if (msg.user && msg.user.user_id) {
                        // Store as potential current user (will be refined by UserIdentityManager)
                        return {
                            id: msg.user.user_id,
                            name: msg.user.nickname,
                            profile_url: msg.user.profile_url,
                            source: 'message_user'
                        };
                    }
                }
            }
        } catch (error) {
            console.error('Error extracting user from response:', error);
        }
        return null;
    }

    /**
     * Store and dispatch user identification
     */
    function identifyUser(userData) {
        if (!userData || !userData.id) return;

        // Don't overwrite if we already have a user (unless this is from a more reliable source)
        if (window.__wvCurrentUser) {
            const currentSource = window.__wvCurrentUser.source;
            const newSource = userData.source;

            // Priority: header > url_pattern > query_param > channel_member > message_user
            const sourcePriority = {
                'header': 5,
                'url_pattern': 4,
                'query_param': 3,
                'channel_member': 2,
                'message_user': 1
            };

            if (sourcePriority[newSource] <= sourcePriority[currentSource]) {
                return; // Keep existing user
            }
        }

        // Store user data
        window.__wvCurrentUser = userData;

        // Dispatch event for UserIdentityManager
        window.dispatchEvent(new CustomEvent('wv-user-identified', {
            detail: userData
        }));
    }

    const originalFetch = window.fetch;

    window.fetch = function(...args) {
        let url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
        const options = typeof args[0] === 'object' ? args[0] : args[1];


        // Check for Sendbird API calls to extract user info
        if (url && url.includes('sendbird.com/v3/')) {
            // Capture Sendbird base URL on first API call (for verification endpoints)
            if (!window.__wvSendbirdBaseUrl) {
                const match = url.match(/(https:\/\/api-[^\/]+\.sendbird\.com)/);
                if (match) {
                    window.__wvSendbirdBaseUrl = match[1];
                    console.log('✅ [WV-Interceptor] Captured Sendbird Base URL:', match[1]);
                }
            }

            // Try to extract user from URL and headers
            const headers = options?.headers || {};
            const userFromURL = extractUserFromURL(url, headers);
            if (userFromURL) {
                identifyUser(userFromURL);
            }

            // Capture Sendbird headers for authenticated API calls
            if (headers && Object.keys(headers).length > 0) {
                // Store relevant authentication headers
                const authHeaders = {};

                // Copy specific Sendbird authentication headers
                const sendbirdHeaderKeys = [
                    'session-key',
                    'access-token',
                    'app-id',
                    'sendbird',
                    'sb-user-agent',
                    'sb-sdk-user-agent',
                    'request-sent-timestamp',
                    'content-type'
                ];

                for (const [key, value] of Object.entries(headers)) {
                    const lowerKey = key.toLowerCase();
                    if (sendbirdHeaderKeys.includes(lowerKey)) {
                        authHeaders[key] = value;
                    }
                }

                if (Object.keys(authHeaders).length > 0) {
                    window.__wvSendbirdHeaders = authHeaders;
                }
            }
        }

        // Check if this is a SendBird API call
        if (url && url.includes('sendbird.com/v3/group_channels/')) {
            // Force include_thread_info=true on ALL /messages calls
            if (url.includes('/messages?') && !url.includes('include_thread_info=')) {
                const separator = url.includes('?') ? '&' : '?';
                url = url + separator + 'include_thread_info=true';

                // Update the args with modified URL
                if (typeof args[0] === 'string') {
                    args[0] = url;
                } else if (args[0]?.url) {
                    args[0] = { ...args[0], url: url };
                }

            }
            // Extract channel URL
            const channelMatch = url.match(/group_channels\/(sendbird_group_channel_[^\/\?]+)/);
            const channelUrl = channelMatch ? channelMatch[1] : null;

            if (channelUrl) {
                window.__wvThreadData.currentChannel = channelUrl;

                // Intercept /messages endpoint (both with and without thread_info)
                if (url.includes('/messages?')) {
                    return originalFetch.apply(this, args).then(response => {
                        const clonedResponse = response.clone();

                        clonedResponse.json().then(data => {
                            if (data && data.messages) {
                                // Try to extract user from response
                                const userFromResponse = extractUserFromResponse(data);
                                if (userFromResponse) {
                                    identifyUser(userFromResponse);
                                }

                                // Store messages
                                if (!window.__wvThreadData.messages.has(channelUrl)) {
                                    window.__wvThreadData.messages.set(channelUrl, []);
                                }

                                // Merge with existing messages (for scroll loads)
                                const existingMessages = window.__wvThreadData.messages.get(channelUrl) || [];
                                const existingIds = new Set(existingMessages.map(m => m.message_id));
                                const newMessages = data.messages.filter(m => !existingIds.has(m.message_id));

                                if (newMessages.length > 0) {
                                    window.__wvThreadData.messages.set(channelUrl, [...existingMessages, ...newMessages]);
                                } else {
                                }

                                // Dispatch custom event for ThreadManager to listen
                                window.dispatchEvent(new CustomEvent('wv-thread-messages', {
                                    detail: {
                                        channelUrl,
                                        messages: window.__wvThreadData.messages.get(channelUrl)
                                    }
                                }));
                            }
                        }).catch(err => {
                            console.error('❌ WV Favorites: Error processing messages:', err);
                        });

                        return response;
                    });
                }

                // Intercept /messages/changelogs endpoint
                if (url.includes('/messages/changelogs')) {
                    return originalFetch.apply(this, args).then(response => {
                        const clonedResponse = response.clone();

                        clonedResponse.json().then(data => {
                            if (data) {
                                // Store changelogs
                                window.__wvThreadData.changelogs.set(channelUrl, data);


                                // Dispatch custom event
                                window.dispatchEvent(new CustomEvent('wv-thread-changelogs', {
                                    detail: { channelUrl, data }
                                }));

                                // FALLBACK: Also dispatch channel change event if navigation observer missed it
                                const currentChannel = window.WVFavs?.ThreadManager?.getCurrentChannel?.();
                                if (currentChannel !== channelUrl) {
                                    window.dispatchEvent(new CustomEvent('wv-channel-changed', {
                                        detail: {
                                            previousChannel: currentChannel,
                                            currentChannel: channelUrl,
                                            source: 'fetch_interceptor_fallback'
                                        }
                                    }));
                                }
                            }
                        }).catch(err => {
                            console.error('❌ WV Favorites: Error processing changelogs:', err);
                        });

                        return response;
                    });
                }

                // Intercept thread messages endpoint (replies)
                if (url.includes('/messages?') && url.includes('parent_message_id=')) {
                    return originalFetch.apply(this, args).then(response => {
                        const clonedResponse = response.clone();

                        clonedResponse.json().then(data => {
                            if (data && data.messages) {
                                // Extract parent_message_id from URL
                                const parentMatch = url.match(/parent_message_id=(\d+)/);
                                const parentId = parentMatch ? parentMatch[1] : null;

                                if (parentId) {

                                    // Dispatch custom event with thread replies
                                    window.dispatchEvent(new CustomEvent('wv-thread-replies', {
                                        detail: {
                                            channelUrl,
                                            parentMessageId: parentId,
                                            replies: data.messages
                                        }
                                    }));
                                }
                            }
                        }).catch(err => {
                            console.error('❌ WV Favorites: Error processing thread replies:', err);
                        });

                        return response;
                    });
                }

                // CRITICAL FIX: Intercept channel details endpoint to capture metadata
                // This prevents race conditions where DOM name doesn't match API channel_url
                // Pattern: /v3/group_channels/{channel_url}?show_member=true...
                const isChannelDetailsEndpoint = url.match(/group_channels\/(sendbird_group_channel_[^\/\?]+)(\?|$)/);
                if (isChannelDetailsEndpoint && !url.includes('/messages')) {
                    return originalFetch.apply(this, args).then(response => {
                        const clonedResponse = response.clone();

                        clonedResponse.json().then(channelData => {
                            if (channelData && channelData.channel_url) {
                                console.log('✅ [WV-Interceptor] Channel details captured:', channelData.name || channelData.channel_url);

                                // Extract metadata from API response
                                const metadata = {
                                    channel_url: channelData.channel_url,
                                    name: channelData.name,
                                    is_distinct: channelData.is_distinct,
                                    member_count: channelData.member_count,
                                    custom_type: channelData.custom_type,
                                    members: channelData.members || [],
                                    cover_url: channelData.cover_url
                                };

                                // For 1:1 DMs, extract the OTHER user's data
                                if (channelData.is_distinct === true && channelData.members?.length > 0) {
                                    const currentUserId = window.WVFavsExtension?.userIdentity?.currentUser?.id;
                                    const otherMember = channelData.members.find(m =>
                                        m.user_id !== currentUserId && m.user_id !== null
                                    );

                                    if (otherMember) {
                                        metadata.userId = otherMember.user_id;
                                        metadata.name = otherMember.nickname || otherMember.name || metadata.name;
                                        metadata.avatar = otherMember.profile_url;
                                    }
                                }

                                // Dispatch channel change event with complete metadata from API
                                window.dispatchEvent(new CustomEvent('wv-channel-changed', {
                                    detail: {
                                        previousChannel: window.__wvThreadData.currentChannel,
                                        currentChannel: channelData.channel_url,
                                        channelData: metadata, // CRITICAL: Include API metadata to prevent race conditions
                                        source: 'fetch_interceptor_channel_details'
                                    }
                                }));
                            }
                        }).catch(err => {
                            console.error('❌ WV Favorites: Error processing channel details:', err);
                        });

                        return response;
                    });
                }
            }
        }

        // Detect message send via sanitise endpoint (happens BEFORE send)
        if (url && url.includes('/api/chat/message/sanitise') && options?.method === 'POST') {
            const body = options?.body;
            let messageText = null;
            if (body) {
                try {
                    const bodyData = typeof body === 'string' ? JSON.parse(body) : body;
                    messageText = bodyData.message;
                } catch (e) {
                    console.warn('Could not parse sanitise message body:', e);
                }
            }
            window.dispatchEvent(new CustomEvent('wv-message-sanitise-called', {
                detail: { messageText }
            }));
        }

        // Detect message send with files/attachments
        if (url && url.includes('/api/chat/message/files') && options?.method === 'POST') {
            const body = options?.body;
            let messageText = null;
            if (body) {
                try {
                    const bodyData = typeof body === 'string' ? JSON.parse(body) : body;
                    messageText = bodyData.message;
                } catch (e) {
                    console.warn('Could not parse files message body:', e);
                }
            }
            window.dispatchEvent(new CustomEvent('wv-message-files-sent', {
                detail: { messageText }
            }));
        }

        // Detect message send via notify endpoint (happens AFTER send)
        if (url && url.includes('/api/chat/channel/notify') && options?.method === 'POST') {
            const body = options?.body;
            if (body) {
                try {
                    const bodyData = typeof body === 'string' ? JSON.parse(body) : body;
                    window.dispatchEvent(new CustomEvent('wv-message-notify-called', {
                        detail: {
                            channelUrl: bodyData.channel_url,
                            messageId: bodyData.message_id
                        }
                    }));
                } catch (e) {
                    // Ignore parsing errors
                }
            }
        }

        // Intercept POST /api/chat/channel (new DM creation)
        if (url && url.includes('/api/chat/channel') && options?.method === 'POST') {
            return originalFetch.apply(this, args).then(response => {
                const clonedResponse = response.clone();

                clonedResponse.json().then(data => {
                    if (data && data.channel_url) {
                        console.log('✅ [WV-Interceptor] New DM created:', data.channel_url);

                        // Dispatch custom event for EventHandler to capture
                        window.dispatchEvent(new CustomEvent('wv-dm-created', {
                            detail: {
                                channel_url: data.channel_url,
                                members: data.members || [],
                                created_at: data.created_at,
                                is_distinct: data.is_distinct
                            }
                        }));
                    }
                }).catch(err => {
                    console.error('❌ WV Favorites: Error processing DM creation:', err);
                });

                return response;
            });
        }

        return originalFetch.apply(this, args);
    };

})();
