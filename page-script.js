// WorkVivo Favorites - Page Context Script
// This script runs in the page context to make authenticated API calls

(function() {
    'use strict';

    // Debug logging flag - controlled by extension settings
    let WV_FAV_DEBUG = false;

    // Helper for debug logging
    const debugLog = (...args) => {
        if (WV_FAV_DEBUG) {
            console.log(...args);
        }
    };

    // Listen for debug settings updates from content script
    document.addEventListener('wv-fav-debug-settings', (event) => {
        WV_FAV_DEBUG = event.detail.debugLogging || false;
    });

    // Track active requests for cancellation
    const activeRequests = new Map(); // requestId -> AbortController

    // Listen for API requests from content script
    document.addEventListener('wv-fav-api-request', async (event) => {
        const { requestId, action, data } = event.detail;
        // API request received (verbose logging removed for performance)

        // Debug logging for status fetch
        if (action === 'fetchUserProfile') {
            debugLog('🔍 [PAGE SCRIPT] fetchUserProfile request received:', {
                requestId,
                action,
                data
            });
        }

        // Create AbortController for this request
        const abortController = new AbortController();
        activeRequests.set(requestId, abortController);

        try {
            let response;

            switch (action) {
                case 'searchAPI':
                    response = await makeAPIRequest(data.url, {
                        method: 'GET',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        signal: abortController.signal
                    });
                    break;

                case 'createChatAPI':
                    response = await makeAPIRequest(data.url, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: data.body,
                        signal: abortController.signal
                    });
                    break;

                case 'quickSearchAPI':
                    response = await makeAPIRequest(data.url, {
                        method: 'GET',
                        headers: {
                            'Content-Type': 'application/json',
                            'Accept': 'application/json, text/plain, */*'
                        },
                        signal: abortController.signal
                    });
                    break;

                case 'advancedSearchAPI':
                    response = await makeAPIRequest(data.url, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Accept': 'application/json, text/plain, */*'
                        },
                        body: data.body,
                        signal: abortController.signal
                    });
                    break;

                case 'mentionsSearchAPI':
                    // Sendbird API call - uses different authentication
                    response = await makeSendbirdAPIRequest(data.url, {
                        method: 'GET',
                        signal: abortController.signal
                    });
                    break;

                case 'sendbirdChannelAPI':
                    // Sendbird channel info API call
                    response = await makeSendbirdAPIRequest(data.url, {
                        method: 'GET',
                        signal: abortController.signal
                    });
                    break;

                case 'workvivoMentionsSearchAPI':
                    // WorkVivo API call for mentions search
                    response = await makeAPIRequest(data.url, {
                        method: 'GET',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        signal: abortController.signal
                    });
                    break;

                case 'fetchUserProfile':
                    // Fetch user profile from /api/people endpoint
                    response = await makeAPIRequest(data.url, {
                        method: 'GET',
                        headers: {
                            'Content-Type': 'application/json',
                            'Accept': 'application/json'
                        },
                        signal: abortController.signal
                    });
                    break;

                case 'updateProfileInfo':
                    // Update user profile via /api/people endpoint
                    debugLog('💾 [PAGE SCRIPT] updateProfileInfo request received:', {
                        requestId,
                        url: data.url,
                        payload: data.payload
                    });
                    response = await makeAPIRequest(data.url, {
                        method: 'PUT',
                        headers: {
                            'Content-Type': 'application/json',
                            'Accept': 'application/json'
                        },
                        body: JSON.stringify(data.payload),
                        signal: abortController.signal
                    });
                    debugLog('✅ [PAGE SCRIPT] updateProfileInfo response:', response);
                    break;

                case 'openChannelViaReactFiber':
                    response = await openChannelViaReactFiber(data.channelUrl);
                    break;

                case 'openThreadViaReactFiber':
                    response = await openThreadViaReactFiber(data.messageId, data.channelUrl);
                    break;

                case 'openOldMentionViaReactFiber':
                    response = await openOldMentionViaReactFiber(data.messageId, data.parentMessageId, data.channelUrl);
                    break;

                case 'searchWebpackModules':
                    // Tier 1: Search webpack modules for navigation functions
                    response = searchWebpackModules(data.keywords);
                    break;

                case 'navigateViaWebpack':
                    // Tier 1: Navigate using webpack-discovered functions
                    response = await navigateViaWebpackFunctions(data);
                    break;

                case 'getLexicalEditorState':
                    // Get current Lexical editor state
                    response = getLexicalEditorState();
                    break;

                case 'setLexicalEditorState':
                    // Set Lexical editor state
                    response = setLexicalEditorState(data.editorState);
                    break;

                case 'getMessageFromReactTree':
                    // Get message data directly from React tree
                    response = getMessageFromReactTree(data.channelUrl, data.messageId);
                    break;

                case 'getCurrentThreadState':
                    // Get current thread state from React hooks
                    response = getCurrentThreadState();
                    break;

                default:
                    throw new Error(`Unknown action: ${action}`);
            }

            // Clean up completed request
            activeRequests.delete(requestId);

            // Debug logging for status fetch response
            if (action === 'fetchUserProfile') {
                debugLog('✅ [PAGE SCRIPT] fetchUserProfile response ready:', {
                    requestId,
                    responseKeys: response ? Object.keys(response).slice(0, 10) : []
                });
            }

            // Send success response
            document.dispatchEvent(new CustomEvent('wv-fav-api-response', {
                detail: {
                    requestId,
                    success: true,
                    data: response
                }
            }));

            // Confirm dispatch
            if (action === 'fetchUserProfile') {
                debugLog('📤 [PAGE SCRIPT] fetchUserProfile response dispatched');
            }

        } catch (error) {
            // Clean up failed/cancelled request
            activeRequests.delete(requestId);

            // Check if this was a cancellation
            const wasCancelled = error.name === 'AbortError';
            if (wasCancelled) {
                debugLog(`🚫 Request ${requestId} was cancelled`);
                // Send cancellation response
                document.dispatchEvent(new CustomEvent('wv-fav-api-response', {
                    detail: {
                        requestId,
                        success: false,
                        cancelled: true,
                        error: 'Request cancelled'
                    }
                }));
            } else {
                console.error('❌ Page script API error:', error);
                // Send error response
                document.dispatchEvent(new CustomEvent('wv-fav-api-response', {
                    detail: {
                        requestId,
                        success: false,
                        error: error.message
                    }
                }));
            }
        }
    });

    // Listen for request cancellation from content script
    document.addEventListener('wv-fav-cancel-request', (event) => {
        const { requestId, searchId, reason } = event.detail;

        const abortController = activeRequests.get(requestId);
        if (abortController) {
            debugLog(`🚫 Cancelling request ${requestId} (searchId: ${searchId}, reason: ${reason})`);
            abortController.abort(reason);
            activeRequests.delete(requestId);

            // Send cancellation confirmation
            document.dispatchEvent(new CustomEvent('wv-fav-request-cancelled', {
                detail: {
                    requestId,
                    searchId,
                    reason
                }
            }));
        }
    });

    // Listen for bulk cancellation requests (cancel all requests for a searchId)
    document.addEventListener('wv-fav-cancel-search', (event) => {
        const { searchId, reason } = event.detail;

        debugLog(`🚫 Bulk cancelling all requests for searchId: ${searchId} (reason: ${reason})`);

        // Find and cancel all requests for this searchId
        // Note: requestIds include searchId, so we can filter by prefix
        const cancelledRequestIds = [];

        for (const [requestId, abortController] of activeRequests.entries()) {
            if (requestId.includes(searchId)) {
                abortController.abort(reason);
                activeRequests.delete(requestId);
                cancelledRequestIds.push(requestId);
            }
        }

        debugLog(`🚫 Cancelled ${cancelledRequestIds.length} requests for searchId: ${searchId}`);

        // Send bulk cancellation confirmation
        document.dispatchEvent(new CustomEvent('wv-fav-search-cancelled', {
            detail: {
                searchId,
                cancelledRequestIds,
                reason
            }
        }));
    });

    // Extract CSRF tokens from the page
    function getCSRFTokens() {
        // Get CSRF token from meta tag
        const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');

        // Get XSRF token from cookie
        let xsrfToken = null;
        const xsrfCookie = document.cookie.split('; ').find(row => row.startsWith('XSRF-TOKEN='));
        if (xsrfCookie) {
            xsrfToken = decodeURIComponent(xsrfCookie.split('=')[1]);
        }

        return { csrfToken, xsrfToken };
    }

    // Make authenticated API request using page context
    async function makeAPIRequest(url, options = {}) {
        try {
            const { csrfToken, xsrfToken } = getCSRFTokens();

            // Build headers with CSRF tokens
            const headers = {
                'Content-Type': 'application/json',
                'X-Requested-With': 'XMLHttpRequest',
                ...options.headers
            };

            // Add CSRF tokens if available
            if (csrfToken) {
                headers['X-CSRF-TOKEN'] = csrfToken;
            }
            if (xsrfToken) {
                headers['X-XSRF-TOKEN'] = xsrfToken;
            }

            // Making authenticated request (verbose logging removed for performance)

            const response = await fetch(url, {
                ...options,
                credentials: 'include', // Include cookies for authentication
                headers
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            // API request successful (verbose logging removed for performance)
            return data;

        } catch (error) {
            console.error('❌ API request failed:', url, error);
            throw error;
        }
    }

    // Extract Sendbird App ID from page context
    function extractSendbirdAppId() {
        // Try multiple methods to extract Sendbird App ID

        // Method 1: Check window object for Sendbird instance
        if (window.SendBird && window.SendBird.getInstance) {
            try {
                const sb = window.SendBird.getInstance();
                if (sb && sb.appId) {
                    debugLog('📧 Found Sendbird App ID from instance:', sb.appId);
                    return sb.appId;
                }
            } catch (e) {
                debugLog('⚠️ Could not get Sendbird instance:', e);
            }
        }

        // Method 2: Check for Sendbird headers captured by interceptor
        if (window.__wvSendbirdHeaders && window.__wvSendbirdHeaders['sb-app-id']) {
            debugLog('📧 Found Sendbird App ID from headers:', window.__wvSendbirdHeaders['sb-app-id']);
            return window.__wvSendbirdHeaders['sb-app-id'];
        }

        // Method 3: Search script tags for SENDBIRD_APP_ID
        const scripts = document.querySelectorAll('script');
        for (const script of scripts) {
            const content = script.textContent || script.innerText;
            const match = content.match(/SENDBIRD_APP_ID["\s:]+["']([^"']+)["']/);
            if (match) {
                debugLog('📧 Found Sendbird App ID from script:', match[1]);
                return match[1];
            }
        }

        // Method 4: Try to extract from any Sendbird API URL in the page
        const apiUrlMatch = document.body.innerHTML.match(/api-([a-zA-Z0-9-]+)\.sendbird\.com/);
        if (apiUrlMatch) {
            debugLog('📧 Found Sendbird App ID from API URL:', apiUrlMatch[1]);
            return apiUrlMatch[1];
        }

        console.warn('⚠️ Could not extract Sendbird App ID from page context');
        return null;
    }

    // Make authenticated Sendbird API request using page context
    async function makeSendbirdAPIRequest(url, options = {}) {
        try {
            debugLog('📧 Making Sendbird API request:', url);

            // Use captured Sendbird headers from interceptor if available
            const sendbirdHeaders = window.__wvSendbirdHeaders || {};

            // Build headers - must include session-key, access-token, and app-id
            const headers = {
                'accept': '*/*',
                'accept-language': 'en-US,en;q=0.9',
                'content-type': 'application/json; charset=utf-8',
                'origin': window.location.origin,
                'referer': window.location.origin + '/',
                ...sendbirdHeaders,
                ...options.headers
            };

            // Update request-sent-timestamp to current time
            headers['request-sent-timestamp'] = Date.now().toString();

            debugLog('📧 Using Sendbird headers:', Object.keys(headers));

            // IMPORTANT: Do NOT use credentials: 'include' - Sendbird API doesn't support it
            // Use header-based authentication instead
            const response = await fetch(url, {
                ...options,
                mode: 'cors',
                headers
            });

            debugLog('📧 Sendbird API response status:', response.status);

            if (!response.ok) {
                const errorText = await response.text();
                console.error('❌ Sendbird API error response:', errorText);
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            debugLog('✅ Sendbird API request successful, results:', data.results?.length || 0);
            return data;

        } catch (error) {
            console.error('❌ Sendbird API request failed:', url, error);
            throw error;
        }
    }

    /**
     * Open a channel using React Fiber hooks
     * Based on ReactFiberNavigator.js logic
     */
    async function openChannelViaReactFiber(channelUrl) {
        debugLog('🧭 [PAGE CONTEXT] Opening channel via React Fiber:', channelUrl);

        try {
            // Step 1: Find an element with React Fiber
            const activeBtn = findActiveButton();
            if (!activeBtn) {
                throw new Error('No active button found with React Fiber');
            }

            // Step 2: Find React Fiber key
            const fiberKey = findReactFiberKey(activeBtn);
            if (!fiberKey) {
                throw new Error('React Fiber key not found');
            }

            // Step 3: Traverse fiber tree to find hooks
            const fiber = activeBtn[fiberKey];
            const { dispatchChannelUrl, dispatchChannel, sdk } = await findReactHooks(fiber);

            if (!dispatchChannelUrl || !dispatchChannel) {
                throw new Error('React hooks not found');
            }

            debugLog('✅ Found React hooks for channel navigation');

            // Step 4: Fetch channel object using SendBird SDK
            if (!sdk) {
                throw new Error('SendBird SDK not found');
            }

            debugLog('📡 Fetching channel from SendBird...');
            debugLog('📡 SDK object keys:', Object.keys(sdk));
            debugLog('📡 SDK type:', typeof sdk);

            // Try different SDK API patterns (v3 callback-based vs v4 Promise-based)
            let channel = null;

            if (sdk.groupChannel && sdk.groupChannel.getChannel) {
                // SendBird SDK v4 (Promise-based, camelCase)
                debugLog('📡 Using SDK v4 API (groupChannel) - Promise-based');
                try {
                    channel = await sdk.groupChannel.getChannel(channelUrl);
                } catch (error) {
                    console.error('❌ SDK v4 getChannel failed:', error);
                    throw error;
                }
            } else if (sdk.GroupChannel && sdk.GroupChannel.getChannel) {
                // SendBird SDK v3 (Callback-based, PascalCase)
                debugLog('📡 Using SDK v3 API (GroupChannel) - Callback-based');
                channel = await new Promise((resolve, reject) => {
                    sdk.GroupChannel.getChannel(channelUrl, (channel, error) => {
                        if (error) {
                            reject(error);
                        } else {
                            resolve(channel);
                        }
                    });
                });
            } else if (sdk.getChannel) {
                // Direct method (try Promise first, then callback)
                debugLog('📡 Using direct getChannel method');
                try {
                    const result = sdk.getChannel(channelUrl);
                    if (result && typeof result.then === 'function') {
                        // It's a Promise
                        channel = await result;
                    } else {
                        // Might be callback-based
                        channel = await new Promise((resolve, reject) => {
                            sdk.getChannel(channelUrl, (channel, error) => {
                                if (error) reject(error);
                                else resolve(channel);
                            });
                        });
                    }
                } catch (error) {
                    console.error('❌ Direct getChannel failed:', error);
                    throw error;
                }
            } else {
                throw new Error('No getChannel method found on SDK object. Available keys: ' + Object.keys(sdk).join(', '));
            }

            debugLog('✅ Got channel:', channel.name);

            // Step 5: Dispatch to React hooks to navigate
            debugLog('🎯 Dispatching channel navigation...');

            // Dispatch channel URL first
            dispatchChannelUrl(channelUrl);

            // Then dispatch channel object
            dispatchChannel(channel);

            debugLog('✅ Channel navigation dispatched successfully');

            return {
                success: true,
                channelName: channel.name,
                channelUrl: channelUrl
            };

        } catch (error) {
            console.error('❌ Error opening channel via React Fiber:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Open a thread using Replies button onClick handler
     * Based on the discovered mechanism from THREAD_OPENING_MECHANISM_DISCOVERED.md
     */
    async function openThreadViaReactFiber(messageId, channelUrl) {
        debugLog('🧵 [PAGE CONTEXT] Opening thread via React Fiber:', messageId);

        try {
            // Convert to number if it's a string
            const targetMessageId = typeof messageId === 'string' ? parseInt(messageId, 10) : messageId;

            debugLog('🔍 Looking for message ID:', targetMessageId);

            // Find all Replies buttons
            const allButtons = Array.from(document.querySelectorAll('button'));
            const repliesButtons = allButtons.filter(btn => {
                const text = btn.textContent;
                return text.includes('replies') || text.includes('Replies') || text.includes('reply');
            });

            debugLog(`📋 Found ${repliesButtons.length} Replies buttons total`);

            // For each Replies button, check if it belongs to our target message
            for (const button of repliesButtons) {
                const fiberKey = findReactFiberKey(button);
                if (!fiberKey) continue;

                const fiber = button[fiberKey];
                let current = fiber;
                let depth = 0;

                while (current && depth < 20) {
                    const props = current.memoizedProps;

                    if (props && props.message && props.message.messageId) {
                        const messageId = props.message.messageId;

                        if (messageId === targetMessageId) {
                            debugLog('✅ Found matching message! messageId:', messageId);
                            debugLog('📍 Button text:', button.textContent);
                            debugLog('📦 Thread info:', props.message.threadInfo);

                            // Try button.click() first (most reliable)
                            debugLog('🎯 Attempting button.click()...');
                            try {
                                button.click();
                                debugLog('✅ button.click() succeeded');

                                return {
                                    success: true,
                                    messageId: messageId,
                                    replyCount: props.message.threadInfo?.replyCount || 0,
                                    method: 'click'
                                };
                            } catch (clickError) {
                                console.warn('⚠️ button.click() failed:', clickError.message);

                                // Fallback: Try onClick handler
                                const onClick = fiber.memoizedProps?.onClick;
                                if (onClick) {
                                    debugLog('🎯 Fallback: Calling onClick handler directly...');
                                    try {
                                        // Try with fake event object
                                        onClick.call(button, { preventDefault: () => {}, stopPropagation: () => {} });
                                        debugLog('✅ onClick() with event succeeded');

                                        return {
                                            success: true,
                                            messageId: messageId,
                                            replyCount: props.message.threadInfo?.replyCount || 0,
                                            method: 'onClick'
                                        };
                                    } catch (onClickError) {
                                        console.warn('⚠️ onClick() failed:', onClickError.message);
                                    }
                                } else {
                                    console.warn('⚠️ No onClick handler found on Replies button');
                                }
                            }
                        }
                    }

                    current = current.return;
                    depth++;
                }
            }

            // Message not found - might not be in view
            console.warn('⚠️ Message not found in current view');
            return {
                success: false,
                error: 'Message not found in current view - it may be too old or need scrolling'
            };

        } catch (error) {
            console.error('❌ Error opening thread via React Fiber:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Open old threaded mentions using SendBird SDK + React Fiber
     * Handles messages that are not loaded in DOM (e.g., from weeks/months ago)
     *
     * Based on discovered WorkVivo search mechanism:
     * - Uses SendBird SDK to fetch messages by ID (bypasses DOM)
     * - Navigates to channel via React Fiber state dispatch
     * - Finds and clicks Replies button after navigation
     *
     * @param {number} messageId - The reply message ID
     * @param {number} parentMessageId - The parent message ID (thread root)
     * @param {string} channelUrl - SendBird channel URL
     */
    async function openOldMentionViaReactFiber(messageId, parentMessageId, channelUrl) {
        debugLog('🚀 [PAGE CONTEXT] Opening old mention via React Fiber + SendBird SDK');
        debugLog('📧 Reply ID:', messageId);
        debugLog('🔗 Parent ID:', parentMessageId);
        debugLog('📍 Channel:', channelUrl);

        try {
            // STEP 1: Find SendBird SDK via React Fiber
            debugLog('\n🔍 STEP 1: Finding SendBird SDK...');

            const buttons = Array.from(document.querySelectorAll('button'));
            let sdk = null;

            for (const button of buttons) {
                const fiberKey = findReactFiberKey(button);
                if (!fiberKey) continue;

                let fiber = button[fiberKey];
                let depth = 0;

                while (fiber && depth < 30) {
                    if (fiber.memoizedProps?.value?.sb) {
                        sdk = fiber.memoizedProps.value.sb;
                        debugLog(`✅ Found SendBird SDK at depth ${depth}`);
                        break;
                    }
                    fiber = fiber.return;
                    depth++;
                }

                if (sdk) break;
            }

            if (!sdk) {
                throw new Error('SendBird SDK not found');
            }

            // STEP 2: Get channel using SendBird SDK
            debugLog('\n📡 STEP 2: Fetching channel...');
            let channel;

            if (sdk.groupChannel && typeof sdk.groupChannel.getChannel === 'function') {
                // SDK v4 (Promise-based)
                debugLog('Using SDK v4 (Promise-based)');
                channel = await sdk.groupChannel.getChannel(channelUrl);
            } else if (sdk.GroupChannel && typeof sdk.GroupChannel.getChannel === 'function') {
                // SDK v3 (callback-based)
                debugLog('Using SDK v3 (callback-based)');
                channel = await new Promise((resolve, reject) => {
                    sdk.GroupChannel.getChannel(channelUrl, (ch, error) => {
                        if (error) reject(error);
                        else resolve(ch);
                    });
                });
            } else {
                throw new Error('Unsupported SDK version');
            }

            debugLog('✅ Channel retrieved:', channel.name);

            // STEP 3: Navigate to channel using React Fiber state dispatch
            debugLog('\n🧭 STEP 3: Navigating to channel via React Fiber...');

            // Find any button with React Fiber for traversal
            let dispatchChannelUrl = null;
            let dispatchChannel = null;

            // Try to find active button first, fallback to any button
            let buttonForTraversal = findActiveButton();
            if (!buttonForTraversal) {
                buttonForTraversal = buttons.find(btn => findReactFiberKey(btn));
            }

            if (!buttonForTraversal) {
                throw new Error('No button with React Fiber found for navigation');
            }

            const fiberKey = findReactFiberKey(buttonForTraversal);
            let fiber = buttonForTraversal[fiberKey];
            let depth = 0;

            // Traverse up to find React hooks for channel navigation
            while (fiber && depth < 30) {
                if (fiber.memoizedState) {
                    let hook = fiber.memoizedState;

                    while (hook) {
                        if (hook.queue?.dispatch) {
                            const state = hook.memoizedState;

                            // Look for channelUrl state (string containing sendbird_group_channel)
                            if (typeof state === 'string' && state.includes('sendbird_group_channel')) {
                                dispatchChannelUrl = hook.queue.dispatch;
                                debugLog(`🔍 Found dispatchChannelUrl at depth ${depth}`);
                            }

                            // Look for channel object state
                            if (state && typeof state === 'object' && state._url) {
                                dispatchChannel = hook.queue.dispatch;
                                debugLog(`🔍 Found dispatchChannel at depth ${depth}`);
                            }
                        }

                        hook = hook.next;
                    }
                }

                fiber = fiber.return;
                depth++;
            }

            if (!dispatchChannelUrl || !dispatchChannel) {
                console.warn('⚠️ React state dispatchers not found, channel may already be active');
                // Continue anyway - might already be on the right channel
            } else {
                // Dispatch channel navigation
                debugLog('🎯 Dispatching channel navigation...');
                dispatchChannelUrl(channelUrl);
                dispatchChannel(channel);

                // Wait for navigation to complete
                await new Promise(r => setTimeout(r, 2000));
                debugLog('✅ Navigated to channel!');
            }

            // STEP 4: Fetch parent message using SendBird SDK
            debugLog('\n📥 STEP 4: Fetching parent message...');
            const params = { prevResultSize: 0, nextResultSize: 0, isInclusive: true };
            const messages = await channel.getMessagesByMessageId(parentMessageId, params);
            const parentMessage = messages[0];

            if (!parentMessage) {
                throw new Error(`Parent message ${parentMessageId} not found`);
            }

            debugLog('✅ Parent message found:', parentMessage.message.substring(0, 80));
            debugLog('📅 Message timestamp:', parentMessage.createdAt);

            // STEP 4.5: Load messages around parent message timestamp to make it visible in DOM
            debugLog('\n📜 STEP 4.5: Loading messages around parent timestamp...');

            try {
                // Use SendBird SDK to fetch messages around the parent message timestamp
                // This forces the channel to load messages from that time period
                const timestampParams = {
                    prevResultSize: 20,
                    nextResultSize: 20,
                    reverse: false,
                    isInclusive: true
                };

                debugLog(`📡 Fetching messages around timestamp ${parentMessage.createdAt}...`);
                const messagesAroundParent = await channel.getMessagesByTimestamp(
                    parentMessage.createdAt,
                    timestampParams
                );

                debugLog(`✅ Loaded ${messagesAroundParent.length} messages around parent message`);

                // Now use React Fiber to update the message list state if possible
                // This helps ensure the UI actually displays these messages
                await new Promise(r => setTimeout(r, 1500));

                // Check if parent message is now in DOM
                const allMessages = Array.from(document.querySelectorAll('[data-message-id]'));
                const parentInDom = allMessages.find(el => {
                    const id = el.getAttribute('data-message-id');
                    return id === String(parentMessageId);
                });

                if (parentInDom) {
                    debugLog('✅ Parent message now visible in DOM!');
                    parentInDom.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    await new Promise(r => setTimeout(r, 500));
                } else {
                    console.warn('⚠️ Parent message fetched but not yet in DOM, will proceed anyway...');
                }
            } catch (error) {
                console.warn('⚠️ Could not load messages at timestamp:', error.message);
                debugLog('Will try to find Replies button anyway...');
            }

            // STEP 5: Find and click Replies button
            debugLog('\n🎯 STEP 5: Looking for Replies button...');

            const allBtns = Array.from(document.querySelectorAll('button'));
            const repliesBtns = allBtns.filter(btn => {
                const text = btn.textContent;
                return text.includes('replies') || text.includes('Replies') || text.includes('reply');
            });

            debugLog(`📋 Found ${repliesBtns.length} Replies buttons`);

            for (const button of repliesBtns) {
                const key = findReactFiberKey(button);
                if (!key) continue;

                let f = button[key];
                let d = 0;

                while (f && d < 20) {
                    if (f.memoizedProps?.message?.messageId === parentMessageId) {
                        debugLog('✅ Found Replies button for parent message!');
                        debugLog('🖱️ Clicking...');

                        button.click();
                        await new Promise(r => setTimeout(r, 500));

                        debugLog('\n🎉 ========== SUCCESS! ==========');

                        return {
                            success: true,
                            channel: channel.name,
                            parentMessageId: parentMessageId,
                            replyMessageId: messageId,
                            method: 'react_fiber_with_sendbird'
                        };
                    }

                    f = f.return;
                    d++;
                }
            }

            // STEP 5.5: If Replies button not found, use WorkVivo's search widget approach
            // Based on research: WorkVivo uses two dispatch functions:
            // 1. v(channel_url) - sets active channel
            // 2. m(message_data) - opens thread/message
            debugLog('\n🔧 STEP 5.5: Replies button not in DOM, using WorkVivo search widget approach...');
            debugLog('Research: WorkVivo onClick = function(){var t=e.channel_url;v(t),m(e),n&&w&&h(),o()}');
            debugLog('Looking for channel dispatch and thread dispatch functions...');

            // Find dispatch functions by traversing React Fiber from active elements
            // Reuse variables from above instead of redeclaring
            dispatchChannel = null;
            let dispatchThread = null;

            // Try to find from channel list or active channel element
            const channelElements = Array.from(document.querySelectorAll('[class*="channel"], [class*="conversation"], [role="listitem"]'));

            for (const element of channelElements.slice(0, 10)) {  // Check first 10 elements
                const fiberKey = findReactFiberKey(element);
                if (!fiberKey) continue;

                let fiber = element[fiberKey];
                let depth = 0;

                while (fiber && depth < 40) {
                    if (fiber.memoizedState) {
                        let hook = fiber.memoizedState;
                        let hookIndex = 0;

                        while (hook) {
                            if (hook.queue?.dispatch) {
                                const state = hook.memoizedState;

                                // Look for channel dispatch (string state with channel URL pattern)
                                if (!dispatchChannel && typeof state === 'string' &&
                                    (state.includes('sendbird') || state.includes('group_channel'))) {
                                    dispatchChannel = hook.queue.dispatch;
                                    debugLog(`🔍 Found potential dispatchChannel at depth ${depth}, hook ${hookIndex}`);
                                    debugLog(`   Current state: ${state.substring(0, 80)}...`);
                                }

                                // Look for thread/message dispatch (null/object/number state)
                                if (!dispatchThread && (state === null || typeof state === 'object' || typeof state === 'number')) {
                                    // Store as potential thread dispatch
                                    if (depth >= 5 && depth <= 30) {  // Reasonable depth range
                                        dispatchThread = hook.queue.dispatch;
                                        debugLog(`🔍 Found potential dispatchThread at depth ${depth}, hook ${hookIndex}`);
                                        debugLog(`   Current state type: ${typeof state}`);
                                    }
                                }
                            }

                            hook = hook.next;
                            hookIndex++;
                        }
                    }

                    if (dispatchChannel && dispatchThread) {
                        debugLog('✅ Found both dispatch functions, stopping search');
                        break;
                    }

                    fiber = fiber.return;
                    depth++;
                }

                if (dispatchChannel && dispatchThread) {
                    break;
                }
            }

            // Attempt to open thread using WorkVivo's approach
            if (dispatchChannel && dispatchThread) {
                debugLog('🎯 Attempting to open thread using WorkVivo search widget approach...');
                debugLog(`   Step 1: Set active channel to ${channel.url}`);
                debugLog(`   Step 2: Open thread for parent message ${parentMessageId}`);

                try {
                    // Step 1: Set active channel (like v(channel_url))
                    dispatchChannel(channel.url);
                    await new Promise(r => setTimeout(r, 300));

                    // Step 2: Open thread (like m(message_data))
                    // Try with parent message ID first
                    dispatchThread(parentMessageId);
                    await new Promise(r => setTimeout(r, 500));

                    debugLog('✅ Thread dispatched via WorkVivo search widget approach!');
                    return {
                        success: true,
                        channel: channel.name,
                        parentMessageId: parentMessageId,
                        replyMessageId: messageId,
                        method: 'workvivo_search_widget_approach'
                    };
                } catch (hookError) {
                    console.warn('⚠️ WorkVivo search widget approach failed:', hookError.message);
                }
            } else {
                console.warn(`⚠️ Could not find dispatch functions (channel: ${!!dispatchChannel}, thread: ${!!dispatchThread})`);
            }

            // If all else fails, throw error
            throw new Error('Replies button not found - parent message may be too old or deleted');

        } catch (error) {
            console.error('❌ Error opening old mention:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Find an active button with React Fiber attached
     * Based on ReactFiberNavigator.findActiveButton()
     */
    function findActiveButton() {
        // Helper to check if element has React Fiber
        const hasReactFiber = (el) => {
            const keys = Object.keys(el);
            return keys.some(k => k.startsWith('__reactFiber'));
        };

        // Strategy 1: Find button with tw-bg-primary class (active channel)
        const activeButtons = Array.from(document.querySelectorAll('button')).filter(btn =>
            btn.className.includes('tw-bg-primary') && hasReactFiber(btn)
        );

        if (activeButtons.length > 0) {
            debugLog('🔍 Found active button with tw-bg-primary');
            return activeButtons[0];
        }

        // Strategy 2: Find any button with Fiber
        const allButtons = Array.from(document.querySelectorAll('button'));
        const buttonWithFiber = allButtons.find(btn => hasReactFiber(btn));

        if (buttonWithFiber) {
            debugLog('🔍 Found button with React Fiber');
            return buttonWithFiber;
        }

        console.warn('⚠️ No buttons with React Fiber found');
        return null;
    }

    /**
     * Find React Fiber key on element
     * Based on ReactFiberNavigator.findReactFiberKey()
     */
    function findReactFiberKey(element) {
        if (!element) return null;

        const keys = Object.keys(element);
        const patterns = ['__reactFiber$', '__reactFiber', '_reactFiber'];

        for (const pattern of patterns) {
            const fiberKey = keys.find(k => k.startsWith(pattern));
            if (fiberKey) {
                return fiberKey;
            }
        }

        return null;
    }

    /**
     * Traverse React Fiber tree to find hooks and SDK
     * Based on ReactFiberNavigator.findReactHooks()
     */
    async function findReactHooks(startFiber) {
        let dispatchChannelUrl = null;
        let dispatchChannel = null;
        let sdk = null;

        let fiber = startFiber;
        let depth = 0;
        const maxDepth = 30;

        // Traverse up the Fiber tree
        while (fiber && depth < maxDepth) {
            // Search for SendBird SDK (typically at depth 14-18)
            if (depth >= 14 && depth <= 18) {
                if (fiber.memoizedProps?.value?.sb) {
                    sdk = fiber.memoizedProps.value.sb;
                    debugLog(`🔍 Found SendBird SDK at depth ${depth}`);
                }
            }

            // Search for React hooks
            if (fiber.memoizedState) {
                let hook = fiber.memoizedState;
                let hookIndex = 0;

                while (hook && hookIndex < 20) {
                    if (hook.queue?.dispatch) {
                        const state = hook.memoizedState;

                        // Hook for channel URL (string)
                        if (typeof state === 'string' && state.includes('sendbird_group_channel')) {
                            dispatchChannelUrl = hook.queue.dispatch;
                            debugLog(`🔍 Found dispatchChannelUrl at depth ${depth}, hook ${hookIndex}`);
                        }

                        // Hook for channel object
                        if (state && typeof state === 'object' && state._url) {
                            dispatchChannel = hook.queue.dispatch;
                            debugLog(`🔍 Found dispatchChannel at depth ${depth}, hook ${hookIndex}`);
                        }
                    }

                    hook = hook.next;
                    hookIndex++;
                }
            }

            // Early exit if we found everything
            if (sdk && dispatchChannelUrl && dispatchChannel) {
                debugLog(`✅ Found all required hooks at depth ${depth}`);
                break;
            }

            fiber = fiber.return;
            depth++;
        }

        return { sdk, dispatchChannelUrl, dispatchChannel, depth };
    }

    // ============================================================================
    // WEBPACK MODULE DISCOVERY (Tier 1 Navigation)
    // ============================================================================

    /**
     * Find webpack chunks in the page
     * Tries multiple global variable names
     */
    function findWebpackChunks() {
        debugLog('🔍 [PAGE CONTEXT] Searching for webpack chunks...');

        const webpackGlobals = [
            'webpackChunkspark',       // Workvivo's webpack global
            'webpackChunk',            // Standard webpack
            'webpackJsonp',            // Webpack 3/4
            '__webpack_modules__'      // Direct module access
        ];

        for (const globalName of webpackGlobals) {
            if (window[globalName]) {
                debugLog(`✅ [PAGE CONTEXT] Found webpack chunks: window.${globalName}`);
                return { name: globalName, chunks: window[globalName] };
            }
        }

        console.warn('⚠️  [PAGE CONTEXT] No webpack chunks found. Tried:', webpackGlobals);
        return null;
    }

    /**
     * Search webpack modules for navigation function keywords
     */
    function searchWebpackModules(keywords) {
        debugLog('🔍 [PAGE CONTEXT] Searching webpack modules for keywords:', keywords);

        const webpackData = findWebpackChunks();
        if (!webpackData) {
            throw new Error('Webpack chunks not found');
        }

        const chunks = webpackData.chunks;

        // Extract all modules from webpack chunks
        // Webpack chunk structure: [[chunkId, {moduleId: moduleFunction, ...}, ...], ...]
        const allModules = {};

        if (Array.isArray(chunks)) {
            debugLog(`📦 [PAGE CONTEXT] Processing ${chunks.length} webpack chunks...`);
            chunks.forEach((chunk, chunkIndex) => {
                if (Array.isArray(chunk) && chunk[1] && typeof chunk[1] === 'object') {
                    // chunk[1] is the modules object
                    Object.entries(chunk[1]).forEach(([id, module]) => {
                        allModules[id] = module;
                    });
                }
            });
        }

        const moduleCount = Object.keys(allModules).length;
        debugLog(`📦 [PAGE CONTEXT] Extracted ${moduleCount} modules from chunks`);

        if (moduleCount === 0) {
            throw new Error('No modules extracted! Webpack structure may be different.');
        }

        // Search modules for keywords
        const foundFunctions = new Set();
        let searchedModules = 0;

        Object.values(allModules).forEach((module) => {
            if (!module || typeof module !== 'function') return;
            searchedModules++;

            try {
                const moduleStr = module.toString();
                keywords.forEach(keyword => {
                    if (moduleStr.includes(keyword)) {
                        foundFunctions.add(keyword);
                    }
                });
            } catch (e) {
                // Skip modules that can't be stringified
            }
        });

        debugLog(`✅ [PAGE CONTEXT] Searched ${searchedModules} modules`);
        debugLog(`✅ [PAGE CONTEXT] Found functions:`, Array.from(foundFunctions));

        return {
            functions: Array.from(foundFunctions),
            modulesSearched: searchedModules,
            modulesTotal: moduleCount
        };
    }

    /**
     * Extract ChatContext from React Fiber tree
     * The context contains navigation functions we discovered in webpack modules
     */
    function extractChatContext(requiredFunctions = []) {
        debugLog('🔍 [PAGE CONTEXT] Extracting ChatContext from React Fiber...');
        debugLog('   Required functions:', requiredFunctions);

        const app = document.getElementById('app');
        if (!app || !app.children) {
            throw new Error('App element not found');
        }

        // Try each child of app
        for (let i = 0; i < app.children.length; i++) {
            const child = app.children[i];
            const fiberKey = findReactFiberKey(child);

            if (!fiberKey) continue;

            let fiber = child[fiberKey];
            let depth = 0;

            // Traverse fiber tree to find context
            while (fiber && depth < 3000) {
                if (fiber.memoizedProps && fiber.memoizedProps.value) {
                    const ctx = fiber.memoizedProps.value;

                    // Check if this looks like ChatContext
                    // It should have setCurrentChannelId at minimum
                    if (typeof ctx === 'object' && ctx !== null &&
                        typeof ctx.setCurrentChannelId === 'function') {

                        // If requiredFunctions specified, verify they exist
                        if (requiredFunctions.length > 0) {
                            const allExist = requiredFunctions.every(fn => typeof ctx[fn] === 'function');
                            if (!allExist) {
                                // Keep looking
                                depth++;
                                fiber = fiber.child || fiber.sibling || getNextFiber(fiber);
                                continue;
                            }
                        }

                        debugLog('✅ [PAGE CONTEXT] Found ChatContext at depth', depth);

                        // Log available functions
                        const availableFunctions = Object.keys(ctx).filter(key => typeof ctx[key] === 'function');
                        debugLog('   Available functions:', availableFunctions.slice(0, 20));

                        return ctx;
                    }
                }

                // Traverse to next node
                if (fiber.child) {
                    fiber = fiber.child;
                } else if (fiber.sibling) {
                    fiber = fiber.sibling;
                } else {
                    fiber = getNextFiber(fiber);
                }

                depth++;
            }
        }

        throw new Error('ChatContext not found in React Fiber tree');
    }

    /**
     * Extract ChatChannelContext from React Fiber tree
     * This context contains disposeCollection() method for clearing message cache
     */
    function extractChatChannelContext() {
        debugLog('🔍 [PAGE CONTEXT] Extracting ChatChannelContext from React Fiber...');

        const app = document.getElementById('app');
        if (!app || !app.children) {
            throw new Error('App element not found');
        }

        // Try each child of app
        for (let i = 0; i < app.children.length; i++) {
            const child = app.children[i];
            const fiberKey = findReactFiberKey(child);

            if (!fiberKey) continue;

            let fiber = child[fiberKey];
            let depth = 0;

            // Traverse fiber tree to find ChatChannel context
            while (fiber && depth < 3000) {
                if (fiber.memoizedProps && fiber.memoizedProps.value) {
                    const ctx = fiber.memoizedProps.value;

                    // Check if this looks like ChatChannelContext
                    // It should have disposeCollection, sendMessage, and deleteMessage
                    if (typeof ctx === 'object' && ctx !== null &&
                        typeof ctx.disposeCollection === 'function' &&
                        typeof ctx.sendMessage === 'function' &&
                        typeof ctx.deleteMessage === 'function') {

                        debugLog('✅ [PAGE CONTEXT] Found ChatChannelContext at depth', depth);

                        // Log available functions
                        const availableFunctions = Object.keys(ctx).filter(key => typeof ctx[key] === 'function');
                        debugLog('   Available functions:', availableFunctions.slice(0, 20));

                        return ctx;
                    }
                }

                // Traverse to next node
                if (fiber.child) {
                    fiber = fiber.child;
                } else if (fiber.sibling) {
                    fiber = fiber.sibling;
                } else {
                    fiber = getNextFiber(fiber);
                }

                depth++;
            }
        }

        throw new Error('ChatChannelContext not found in React Fiber tree');
    }

    /**
     * Helper to get next fiber node during traversal
     */
    function getNextFiber(fiber) {
        let parent = fiber.return;
        while (parent) {
            if (parent.sibling) {
                return parent.sibling;
            }
            parent = parent.return;
        }
        return null;
    }

    /**
     * Get message data from React tree
     * Messages are stored as Fragments with messageId as key under channel Fragment
     */
    function getMessageFromReactTree(channelUrl, messageId) {
        debugLog('📬 [PAGE CONTEXT] Getting message from React tree:', { channelUrl: channelUrl.substring(0, 40), messageId });

        const app = document.getElementById('app');
        if (!app || !app.children) {
            throw new Error('App element not found');
        }

        // Find React Fiber key
        const child = app.children[0];
        const fiberKey = findReactFiberKey(child);
        if (!fiberKey) {
            throw new Error('React Fiber key not found');
        }

        let fiber = child[fiberKey];
        let depth = 0;

        // Traverse fiber tree to find channel Fragment
        while (fiber && depth < 3000) {
            // Look for Fragment with key matching channelUrl
            if (fiber.key === channelUrl && fiber.type && fiber.type.toString() === 'Symbol(react.fragment)') {
                debugLog(`✅ Found channel Fragment at depth ${depth}`);

                // Now search children for message Fragment
                let messageFiber = fiber.child;
                let messageDepth = 0;

                while (messageFiber && messageDepth < 500) {
                    // Look for Fragment with key matching messageId
                    if (messageFiber.key === messageId && messageFiber.type && messageFiber.type.toString() === 'Symbol(react.fragment)') {
                        debugLog(`✅ Found message Fragment at depth ${messageDepth}`);

                        // Get message data from props
                        if (messageFiber.memoizedProps && messageFiber.memoizedProps.message) {
                            const messageData = messageFiber.memoizedProps.message;
                            debugLog('📬 Message data retrieved:', {
                                messageId: messageData.messageId,
                                createdAt: messageData.createdAt,
                                messageType: messageData.messageType
                            });

                            return {
                                success: true,
                                message: messageData
                            };
                        }
                    }

                    // Traverse message-level tree
                    if (messageFiber.child) {
                        messageFiber = messageFiber.child;
                    } else if (messageFiber.sibling) {
                        messageFiber = messageFiber.sibling;
                    } else {
                        messageFiber = getNextFiber(messageFiber);
                    }

                    messageDepth++;
                }

                console.warn('⚠️ Message Fragment not found under channel');
                return {
                    success: false,
                    error: 'Message not found in React tree'
                };
            }

            // Traverse fiber tree
            if (fiber.child) {
                fiber = fiber.child;
            } else if (fiber.sibling) {
                fiber = fiber.sibling;
            } else {
                fiber = getNextFiber(fiber);
            }

            depth++;
        }

        console.warn('⚠️ Channel Fragment not found');
        return {
            success: false,
            error: 'Channel not found in React tree'
        };
    }

    /**
     * Get current thread state from React hooks
     * Reads currentThreadParentMessageId from WorkVivo's React state
     */
    function getCurrentThreadState() {
        const app = document.getElementById('app');
        if (!app || !app.children) {
            throw new Error('App element not found');
        }

        // Find React Fiber key
        const child = app.children[0];
        const fiberKey = findReactFiberKey(child);
        if (!fiberKey) {
            throw new Error('React Fiber key not found');
        }

        let fiber = child[fiberKey];
        let depth = 0;

        // Traverse fiber tree looking for component with thread state hooks
        while (fiber && depth < 3000) {
            // Look for component with memoizedState (hooks)
            if (fiber.memoizedState) {
                let hook = fiber.memoizedState;
                let hookIndex = 0;

                // Track what we find
                let foundChannelId = null;
                let foundThreadId = undefined; // Use undefined to distinguish from null (which is valid for main chat)
                let channelHookIndex = -1;

                // Collect all hooks for debugging
                const allHooks = [];

                while (hook && hookIndex < 30) { // Increased from 25 to 30
                    if (hook.memoizedState !== undefined) {
                        const state = hook.memoizedState;
                        allHooks.push({ index: hookIndex, type: typeof state, value: state });

                        // Look for currentChannelId (string with sendbird_group_channel)
                        if (typeof state === 'string' && state.includes('sendbird_group_channel')) {
                            foundChannelId = state;
                            channelHookIndex = hookIndex;
                        }

                        // Look for currentThreadParentMessageId AFTER finding channel
                        // Must be a number or explicitly null, and must come after channel hook
                        if (foundChannelId && hookIndex > channelHookIndex && foundThreadId === undefined) {
                            if (typeof state === 'number' && state > 0) {
                                // Found a positive number - this is likely the thread ID
                                foundThreadId = state;
                            } else if (state === null && hookIndex === channelHookIndex + 1) {
                                // Found null immediately after channel - this indicates main chat
                                foundThreadId = null;
                            }
                        }
                    }

                    hook = hook.next;
                    hookIndex++;
                }

                // If we found channel ID, return the result
                if (foundChannelId !== null) {
                    // If we didn't find a thread ID, default to null (main chat)
                    if (foundThreadId === undefined) {
                        foundThreadId = null;
                    }

                    return {
                        success: true,
                        channelId: foundChannelId,
                        threadId: foundThreadId,  // null = main chat, number = thread ID
                        isThread: foundThreadId !== null && foundThreadId !== 0
                    };
                }
            }

            // Traverse fiber tree
            if (fiber.child) {
                fiber = fiber.child;
            } else if (fiber.sibling) {
                fiber = fiber.sibling;
            } else {
                fiber = getNextFiber(fiber);
            }

            depth++;
        }

        return {
            success: false,
            error: 'Thread state not found in React tree'
        };
    }

    /**
     * Navigate to message using webpack-discovered functions
     * This is called from page context with direct access to React and webpack
     */
    async function navigateViaWebpackFunctions(data) {
        debugLog('🧭 [PAGE CONTEXT] Navigating via webpack-discovered functions...');
        debugLog('   Message:', data.message.message_id);
        debugLog('   Primary function:', data.primaryFunction);
        debugLog('   Discovered functions:', data.discoveredFunctions);

        try {
            // Step 1: Extract ChatContext
            const context = extractChatContext(data.discoveredFunctions);

            // Verify primary function exists
            if (!context[data.primaryFunction]) {
                throw new Error(`Primary function ${data.primaryFunction} not found in context`);
            }

            debugLog('✅ [PAGE CONTEXT] Context and function validated');

            // Step 2: Close thread panel if open
            if (context.threadPanelOpen) {
                debugLog('🔄 [PAGE CONTEXT] Closing thread panel first...');
                context.toggleThreadPanel();
                await new Promise(r => setTimeout(r, 300));
            }

            // Step 3: Navigate using primary function
            const message = data.message;
            debugLog(`🎯 [PAGE CONTEXT] Calling ${data.primaryFunction}...`);

            // If no message_id, just open the channel (used by navigateToChat)
            if (!message.message_id && message.channel_url) {
                debugLog('📂 [PAGE CONTEXT] No message_id provided, just opening channel...');
                context.setCurrentChannelId(message.channel_url);
                await new Promise(r => setTimeout(r, 500));
                debugLog('✅ [PAGE CONTEXT] Channel opened (no message navigation)');
                return {
                    success: true,
                    method: 'webpack',
                    primaryFunction: 'setCurrentChannelId',
                    channelUrl: message.channel_url
                };
            }

            if (data.primaryFunction === 'setHighlightedMessage') {
                // SMART NAVIGATION: Check if we can use fast path (message in DOM AND in correct channel)
                const currentChannelId = context.currentChannelId || context.currentChannel?.channel_url;
                const isInCorrectChannel = currentChannelId === message.channel_url;
                const existingElement = document.getElementById(`message-${message.message_id}`);

                debugLog('🔍 [PAGE CONTEXT] Smart navigation check:', {
                    currentChannel: currentChannelId,
                    targetChannel: message.channel_url,
                    isInCorrectChannel,
                    messageInDOM: !!existingElement
                });

                if (existingElement && isInCorrectChannel) {
                    // Message already loaded AND we're in the correct channel - just scroll to it (fast path)
                    debugLog('✅ [PAGE CONTEXT] Message in DOM and in correct channel, scrolling to it...');
                    existingElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    debugLog('✅ [PAGE CONTEXT] Navigation completed (scroll-only)');
                } else {
                    // Message not in DOM OR not in correct channel - use two-step navigation pattern
                    if (!isInCorrectChannel) {
                        debugLog('📦 [PAGE CONTEXT] Different channel detected, using two-step navigation...');
                    } else {
                        debugLog('📦 [PAGE CONTEXT] Message not in DOM, using two-step navigation...');
                    }

                    // Step 3a: Extract ChatChannelContext (for disposeCollection)
                    let channelContext = null;
                    try {
                        channelContext = extractChatChannelContext();
                    } catch (error) {
                        console.warn('⚠️ [PAGE CONTEXT] ChatChannelContext not found, skipping dispose:', error.message);
                    }

                    // Step 3b: Dispose collection to clear message cache (if available)
                    if (channelContext && typeof channelContext.disposeCollection === 'function') {
                        debugLog('📦 [PAGE CONTEXT] Disposing message collection for channel:', message.channel_url);
                        channelContext.disposeCollection(message.channel_url);

                        // Wait for collection to be disposed (CRITICAL for loading old messages)
                        await new Promise(r => setTimeout(r, 500));
                        debugLog('✅ [PAGE CONTEXT] Collection disposed');
                    } else {
                        console.warn('⚠️ [PAGE CONTEXT] ChatChannelContext or disposeCollection not available!');
                        console.warn('   channelContext:', !!channelContext);
                        console.warn('   disposeCollection:', channelContext ? typeof channelContext.disposeCollection : 'N/A');
                    }

                    // Step 3c: Set highlighted message (loads messages around timestamp)
                    debugLog('🎯 [PAGE CONTEXT] Setting highlighted message with data:');
                    debugLog('   message_id:', message.message_id);
                    debugLog('   channel_url:', message.channel_url);
                    debugLog('   created_at:', message.created_at, '(timestamp)');
                    debugLog('   created_at date:', message.created_at ? new Date(message.created_at).toISOString() : 'N/A');
                    debugLog('   parent_message_id:', message.parent_message_id || 0);

                    const highlightData = {
                        message_id: message.message_id,
                        channel_url: message.channel_url,
                        created_at: message.created_at,
                        parent_message_id: message.parent_message_id || 0,
                        root_message_id: message.root_message_id || null
                    };

                    debugLog('   Full highlight data:', highlightData);
                    context.setHighlightedMessage(highlightData);

                    // Step 3d: Wait for messages to load (CRITICAL timing)
                    debugLog('⏳ [PAGE CONTEXT] Waiting for messages to load...');
                    await new Promise(r => setTimeout(r, 2000));

                    // Step 3e: Verify message loaded and scroll into view
                    const loadedElement = document.getElementById(`message-${message.message_id}`);
                    if (loadedElement) {
                        debugLog('✅ [PAGE CONTEXT] Message loaded in DOM, scrolling to it...');
                        loadedElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        debugLog('✅ [PAGE CONTEXT] Navigation completed (dispose+highlight)');
                    } else {
                        console.warn('⚠️ [PAGE CONTEXT] Message not found in DOM after navigation');
                    }
                }

            } else if (data.primaryFunction === 'setCurrentChannelId') {
                // Multi-step fallback
                context.setCurrentChannelId(message.channel_url);

                await new Promise(r => setTimeout(r, 1000));

                if (message.parent_message_id && context.setCurrentThreadParentMessageId) {
                    debugLog('🔄 [PAGE CONTEXT] Opening thread...');
                    context.setCurrentThreadParentMessageId(message.parent_message_id);

                    await new Promise(r => setTimeout(r, 500));

                    if (!context.threadPanelOpen && context.toggleThreadPanel) {
                        context.toggleThreadPanel();
                    }
                }

                debugLog('✅ [PAGE CONTEXT] Navigation completed (setCurrentChannelId)');

            } else {
                // Generic: Just call the function with message data
                context[data.primaryFunction](message);
                debugLog(`✅ [PAGE CONTEXT] Navigation completed (${data.primaryFunction})`);
            }

            return {
                success: true,
                method: 'webpack',
                primaryFunction: data.primaryFunction,
                messageId: message.message_id,
                channelUrl: message.channel_url
            };

        } catch (error) {
            console.error('❌ [PAGE CONTEXT] Webpack navigation failed:', error);
            throw error;
        }
    }

    /**
     * Get Lexical editor instance from page context
     * This can access React Fiber properties that are not available in extension context
     */
    function getLexicalEditor() {
        try {
            // IMPORTANT: Find the ACTIVE editor (the one user is typing in)
            // Don't just check which context exists - both can exist simultaneously!
            const threadPanel = document.querySelector('[data-testid="thread-message-section"]');
            const mainChat = document.querySelector('[data-testid="message-section"]');

            let searchContext = document;
            let contextName = 'document';

            // Strategy: Check which editor has focus or most recently had content
            // If thread panel exists, check if its editor is focused or has content
            if (threadPanel) {
                const threadEditor = threadPanel.querySelector('div[contenteditable="true"][role="textbox"]');
                const mainEditor = mainChat?.querySelector('div[contenteditable="true"][role="textbox"]');

                // Priority 1: Focused editor
                if (threadEditor === document.activeElement) {
                    searchContext = threadPanel;
                    contextName = 'thread panel (focused)';
                } else if (mainEditor === document.activeElement) {
                    searchContext = mainChat || document;
                    contextName = 'main chat (focused)';
                } else {
                    // Priority 2: If no focus, use thread panel if it exists
                    // (This handles the restore case)
                    searchContext = threadPanel;
                    contextName = 'thread panel (default)';
                }
            } else {
                // No thread panel, use main chat
                searchContext = mainChat || document;
                contextName = mainChat ? 'main chat' : 'document';
            }

            // Try multiple selectors to find the message input editor
            const selectors = [
                'div[contenteditable="true"][role="textbox"]',
                'div[contenteditable="true"][placeholder*="message"]',
                'div[contenteditable="true"][placeholder*="Message"]',
                'div[contenteditable="true"][data-lexical-editor="true"]',
                '.ContentEditable__root'
            ];

            let editorDiv = null;
            let matchedSelector = null;
            for (const selector of selectors) {
                editorDiv = searchContext.querySelector(selector);
                if (editorDiv) {
                    matchedSelector = selector;
                    break;
                }
            }

            if (!editorDiv) {
                console.warn('⚠️ [page-script] Lexical editor div not found in DOM');
                return null;
            }

            // Get editor instance from React Fiber
            const fiberKey = Object.keys(editorDiv).find(k => k.startsWith('__reactFiber'));
            if (!fiberKey) {
                console.warn('⚠️ [page-script] React Fiber key not found on editor element');
                return null;
            }

            let fiber = editorDiv[fiberKey];
            let depth = 0;

            // Search for LexicalEditor instance
            while (fiber && depth < 20) {
                if (fiber.memoizedProps?.editor) {
                    const editor = fiber.memoizedProps.editor;
                    if (editor && typeof editor.getEditorState === 'function') {
                        debugLog('✅ [page-script] Lexical editor found:', {
                            context: contextName,
                            selector: matchedSelector,
                            depth: depth
                        });
                        return editor;
                    }
                }
                fiber = fiber.return;
                depth++;
            }

            console.warn('⚠️ [page-script] Lexical editor instance not found in Fiber tree (depth:', depth, ')');
            return null;
        } catch (error) {
            console.error('❌ [page-script] Error getting Lexical editor:', error);
            return null;
        }
    }

    /**
     * Get current Lexical editor state
     */
    function getLexicalEditorState() {
        try {
            const editor = getLexicalEditor();
            if (!editor) {
                return {
                    success: false,
                    error: 'Lexical editor not found'
                };
            }

            // Determine context: check if the focused editor is in thread panel or main chat
            const threadPanel = document.querySelector('[data-testid="thread-message-section"]');
            const mainChat = document.querySelector('[data-testid="message-section"]');
            const activeElement = document.activeElement;

            let isThreadContext = false;
            if (threadPanel) {
                const threadEditor = threadPanel.querySelector('div[contenteditable="true"][role="textbox"]');
                isThreadContext = (threadEditor === activeElement);
            }

            // Get editor state
            const editorState = editor.getEditorState();
            const jsonState = editorState.toJSON();

            // Get text content
            const textContent = editorState.read(() => {
                const root = editorState._nodeMap.get('root');
                return root ? root.getTextContent() : '';
            });

            debugLog('📚 [page-script] Editor state retrieved:', {
                context: isThreadContext ? 'thread' : 'main',
                textLength: textContent.length,
                preview: textContent.substring(0, 30)
            });

            return {
                success: true,
                lexicalState: jsonState,
                textContent: textContent,
                timestamp: Date.now(),
                isThreadContext: isThreadContext  // NEW: return which context
            };
        } catch (error) {
            console.error('❌ [page-script] Error getting editor state:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Set Lexical editor state
     */
    function setLexicalEditorState(editorStateJson) {
        try {
            const editor = getLexicalEditor();
            if (!editor) {
                return {
                    success: false,
                    error: 'Lexical editor not found'
                };
            }

            debugLog('⚙️ [page-script] Setting editor state...');

            // Parse and set editor state
            const stateToRestore = editor.parseEditorState(JSON.stringify(editorStateJson));
            editor.setEditorState(stateToRestore);

            // Focus editor and move cursor to end
            // IMPORTANT: Use same context detection as getLexicalEditor()
            const threadPanel = document.querySelector('[data-testid="thread-message-section"]');
            const mainChat = document.querySelector('[data-testid="message-section"]');
            const searchContext = threadPanel || mainChat || document;

            const selectors = [
                'div[contenteditable="true"][role="textbox"]',
                'div[contenteditable="true"][placeholder*="message"]',
                'div[contenteditable="true"][placeholder*="Message"]',
                '.ContentEditable__root'
            ];

            let input = null;
            for (const selector of selectors) {
                input = searchContext.querySelector(selector);
                if (input) break;
            }

            if (input) {
                input.focus();
                editor.update(() => {
                    const root = editor.getEditorState()._nodeMap.get('root');
                    if (root) {
                        root.selectEnd();
                    }
                });
            }

            debugLog('✅ [page-script] Editor state set successfully');

            return {
                success: true
            };
        } catch (error) {
            console.error('❌ [page-script] Error setting editor state:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

})();
