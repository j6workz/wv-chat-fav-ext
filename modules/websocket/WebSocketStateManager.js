/**
 * WebSocket State Manager
 * Manages WebSocket connection state and dispatches events to extension
 */

class WebSocketStateManager {
    constructor() {
        this.state = {
            connected: false,
            connectionId: null,
            connectedAt: null,
            lastHeartbeat: null,
            reconnectCount: 0,
            messageCount: 0,
            errorCount: 0,
            authenticationStatus: 'pending' // pending, authenticated, failed
        };

        this.eventListeners = new Map();
        this.debugEnabled = false; // Debug logging flag
        this.init();
    }

    init() {
        // Listen to WebSocket interceptor events
        window.addEventListener('wv-websocket-status', (event) => {
            this.handleStatusChange(event.detail);
        });

        window.addEventListener('wv-chat-message', (event) => {
            this.handleMessage(event.detail);
        });

        window.addEventListener('wv-chat-read', (event) => {
            this.handleReadReceipt(event.detail);
        });

        window.addEventListener('wv-chat-delivery', (event) => {
            this.handleDeliveryReceipt(event.detail);
        });

        window.addEventListener('wv-chat-typing', (event) => {
            this.handleTypingIndicator(event.detail);
        });

        if (this.debugEnabled) {
            console.log('[WebSocket Manager] Initialized');
        }
    }

    /**
     * Handle WebSocket status changes
     */
    handleStatusChange(detail) {
        const { status, connectionId, timestamp, ...rest } = detail;

        switch (status) {
            case 'connected':
                this.state.connected = true;
                this.state.connectionId = connectionId;
                this.state.connectedAt = timestamp;
                this.state.lastHeartbeat = timestamp;
                if (this.debugEnabled) {
                    console.log('[WebSocket Manager] Connected');
                }
                this.emit('status:connected', detail);

                // Notify background script to update badge
                this.notifyBackgroundScript('connected');
                break;

            case 'disconnected':
                this.state.connected = false;
                if (this.debugEnabled) {
                    console.log('[WebSocket Manager] Disconnected', rest);
                }
                this.emit('status:disconnected', detail);

                // Notify background script
                this.notifyBackgroundScript('disconnected');

                // Track in analytics if shouldReconnect
                if (rest.shouldReconnect) {
                    this.trackEvent('websocket_disconnected', {
                        setting_name: 'websocket_connection',
                        new_value: 'disconnected',
                        error_message: `close_code_${rest.code}`
                    });
                }
                break;

            case 'reconnecting':
                this.state.reconnectCount++;
                if (this.debugEnabled) {
                    console.log(`[WebSocket Manager] Reconnecting (attempt ${this.state.reconnectCount})`);
                }
                this.emit('status:reconnecting', detail);

                // Notify background script
                this.notifyBackgroundScript('reconnecting');
                break;

            case 'authenticated':
                this.state.authenticationStatus = 'authenticated';
                if (this.debugEnabled) {
                    console.log('[WebSocket Manager] Authenticated');
                }
                this.emit('status:authenticated', detail);

                // Track connection success
                this.trackEvent('websocket_status_change', {
                    setting_name: 'websocket_connection',
                    new_value: 'connected',
                    old_value: this.state.connectionId?.toString()
                });
                break;

            case 'auth_failed':
                this.state.authenticationStatus = 'failed';
                this.state.errorCount++;
                if (this.debugEnabled) {
                    console.error('[WebSocket Manager] Authentication failed:', rest);
                }
                this.emit('status:auth_failed', detail);

                // Track auth failure
                this.trackEvent('websocket_error', {
                    error_type: 'authentication_failed',
                    error_message: rest.error || 'unknown',
                    error_context: JSON.stringify({ code: rest.code })
                });
                break;

            case 'heartbeat':
                this.state.lastHeartbeat = timestamp;
                // Don't emit, too noisy
                break;

            case 'error':
                this.state.errorCount++;
                if (this.debugEnabled) {
                    console.error('[WebSocket Manager] Error:', rest);
                }
                this.emit('status:error', detail);

                // Track error
                this.trackEvent('websocket_error', {
                    error_type: 'websocket_connection_error',
                    error_message: rest.error || 'unknown',
                    error_context: JSON.stringify(detail)
                });
                break;
        }
    }

    /**
     * Handle incoming chat messages
     */
    handleMessage(detail) {
        this.state.messageCount++;

        // Calculate latency
        const receivedAt = Date.now();
        const sentAt = detail.timestamp;
        const latency = receivedAt - sentAt;

        if (this.debugEnabled) {
            console.log('[WebSocket Manager] Message received:', {
                messageId: detail.messageId,
                isThreadReply: detail.isThreadReply,
                latency: latency + 'ms'
            });
        }

        // Emit to listeners
        this.emit('message:received', detail);

        // Track real-time message delivery
        this.trackEvent('realtime_update', {
            setting_name: 'message_delivery',
            value_type: detail.isThreadReply ? 'thread_reply' : 'new_message',
            new_value: latency.toString(),
            old_value: 'websocket'
        });
    }

    /**
     * Handle read receipts
     */
    handleReadReceipt(detail) {
        if (this.debugEnabled) {
            console.log('[WebSocket Manager] Read receipt:', detail.channelUrl);
        }
        this.emit('read:receipt', detail);
    }

    /**
     * Handle delivery receipts
     */
    handleDeliveryReceipt(detail) {
        if (this.debugEnabled) {
            console.log('[WebSocket Manager] Delivery receipt:', detail.channelUrl);
        }
        this.emit('delivery:receipt', detail);
    }

    /**
     * Handle typing indicators
     */
    handleTypingIndicator(detail) {
        this.emit('typing:indicator', detail);
    }

    /**
     * Register event listener
     */
    on(eventName, callback) {
        if (!this.eventListeners.has(eventName)) {
            this.eventListeners.set(eventName, []);
        }
        this.eventListeners.get(eventName).push(callback);
    }

    /**
     * Unregister event listener
     */
    off(eventName, callback) {
        if (!this.eventListeners.has(eventName)) return;

        const listeners = this.eventListeners.get(eventName);
        const index = listeners.indexOf(callback);
        if (index > -1) {
            listeners.splice(index, 1);
        }
    }

    /**
     * Emit event to registered listeners
     */
    emit(eventName, data) {
        if (!this.eventListeners.has(eventName)) return;

        const listeners = this.eventListeners.get(eventName);
        listeners.forEach(callback => {
            try {
                callback(data);
            } catch (error) {
                if (this.debugEnabled) {
                    console.error(`[WebSocket Manager] Error in listener for ${eventName}:`, error);
                }
            }
        });
    }

    /**
     * Get current connection status
     */
    getStatus() {
        return {
            ...this.state,
            isHealthy: this.isHealthy()
        };
    }

    /**
     * Check if connection is healthy
     */
    isHealthy() {
        if (!this.state.connected) return false;
        if (!this.state.lastHeartbeat) return true; // Just connected

        const timeSinceHeartbeat = Date.now() - this.state.lastHeartbeat;
        return timeSinceHeartbeat < 90000; // 90 seconds (heartbeat every ~30s)
    }

    /**
     * Notify background script of status change
     */
    notifyBackgroundScript(status) {
        try {
            chrome.runtime.sendMessage({
                type: 'WS_STATUS_UPDATE',
                status: status,
                timestamp: Date.now()
            });
        } catch (error) {
            if (this.debugEnabled) {
                console.error('[WebSocket Manager] Failed to notify background:', error);
            }
        }
    }

    /**
     * Track analytics event
     */
    trackEvent(eventName, parameters) {
        try {
            if (window.WVFavs && window.WVFavs.AnalyticsManager) {
                const analytics = new window.WVFavs.AnalyticsManager();
                analytics.trackEvent(eventName, parameters);
            }
        } catch (error) {
            // Ignore analytics errors
        }
    }

    /**
     * Get health statistics
     */
    getHealthStats() {
        const uptime = this.state.connectedAt ?
            Math.floor((Date.now() - this.state.connectedAt) / 1000) : 0;

        const lastHeartbeatAgo = this.state.lastHeartbeat ?
            Math.floor((Date.now() - this.state.lastHeartbeat) / 1000) : null;

        return {
            connected: this.state.connected,
            uptime_seconds: uptime,
            messages_received: this.state.messageCount,
            reconnect_count: this.state.reconnectCount,
            error_count: this.state.errorCount,
            last_heartbeat_ago_seconds: lastHeartbeatAgo,
            is_healthy: this.isHealthy(),
            authentication_status: this.state.authenticationStatus
        };
    }
}

// Make available globally
if (typeof window !== 'undefined') {
    window.WVFavs = window.WVFavs || {};
    window.WVFavs.WebSocketStateManager = WebSocketStateManager;
}
