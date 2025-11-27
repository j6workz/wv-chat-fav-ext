// WebSocket Interceptor for Workvivo Extension
// This script MUST run before page scripts (manifest: run_at: "document_start")
// Hooks into Sendbird WebSocket to listen for real-time chat events

(function() {
  'use strict';

  const DEBUG = false; // Set to true for console logging
  const log = DEBUG ? console.log.bind(console, '[WS Interceptor]') : () => {};

  const OriginalWebSocket = window.WebSocket;
  let connectionId = 0;

  // Track connection state
  const state = {
    connected: false,
    connectionCount: 0,
    lastHeartbeat: null,
    reconnecting: false
  };

  window.WebSocket = function(...args) {
    const url = args[0];
    const ws = new OriginalWebSocket(...args);

    // Only hook Sendbird WebSocket
    if (!url.includes('sendbird.com')) {
      return ws;
    }

    connectionId++;
    const currentConnectionId = connectionId;
    state.connectionCount++;

    log('Sendbird WebSocket created, connection #' + currentConnectionId);

    // Dispatch status event
    function dispatchStatus(status, details = {}) {
      window.dispatchEvent(new CustomEvent('wv-websocket-status', {
        detail: {
          status,
          connectionId: currentConnectionId,
          timestamp: Date.now(),
          ...details
        }
      }));
    }

    // Parse Sendbird message format: "COMMAND{json}"
    function parseSendbirdMessage(rawData) {
      try {
        const data = rawData.trim();
        const match = data.match(/^([A-Z]+)(.+)$/s);

        if (match && match[2].startsWith('{')) {
          const command = match[1];
          const jsonPart = match[2];
          const parsed = JSON.parse(jsonPart);
          parsed.command = command;
          return parsed;
        } else {
          return JSON.parse(data);
        }
      } catch (e) {
        return null;
      }
    }

    // CONNECTION OPEN
    ws.addEventListener('open', () => {
      log('Connection opened');
      state.connected = true;
      state.reconnecting = false;
      dispatchStatus('connected');
    });

    // MESSAGE RECEIVED
    ws.addEventListener('message', (event) => {
      const data = parseSendbirdMessage(event.data);
      if (!data) return;

      const command = data.command || data.cat;

      // Handle different message types
      switch (command) {
        case 'LOGI':
          // Authentication response
          if (data.error) {
            log('Auth failed:', data.message);
            dispatchStatus('auth_failed', { error: data.message, code: data.code });
          } else {
            log('Authenticated successfully');
            dispatchStatus('authenticated', { sessionId: data.session_id });
          }
          break;

        case 'MESG':
          // New message or thread reply
          log('New message:', data.msg_id);

          window.dispatchEvent(new CustomEvent('wv-chat-message', {
            detail: {
              messageId: data.msg_id,
              channelUrl: data.channel_url,
              message: data.message,
              messageType: data.type,
              customType: data.custom_type,
              user: {
                userId: data.user?.user_id,
                nickname: data.user?.nickname,
                profileUrl: data.user?.profile_url
              },
              timestamp: data.ts || data.created_at,
              silent: data.silent || false,

              // Thread information
              isThreadReply: !!data.parent_message_id,
              parentMessageId: data.parent_message_id,
              threadInfo: data.thread_info ? {
                replyCount: data.thread_info.reply_count,
                lastRepliedAt: data.thread_info.last_replied_at,
                updatedAt: data.thread_info.updated_at,
                memberCount: data.thread_info.member_count
              } : null,

              // Additional metadata
              mentions: data.mentioned_users || [],
              reactions: data.reactions_summary || []
            }
          }));

          // Dispatch message confirmation event for draft clearing
          // This fires when a message is successfully received (including our own sent messages)
          window.dispatchEvent(new CustomEvent('wv-websocket-message-confirmed', {
            detail: {
              messageId: data.msg_id,
              channelUrl: data.channel_url,
              message: data.message
            }
          }));
          break;

        case 'READ':
          // Message read receipt
          log('Read receipt:', data.channel_url);

          window.dispatchEvent(new CustomEvent('wv-chat-read', {
            detail: {
              channelUrl: data.channel_url,
              userId: data.user?.user_id,
              timestamp: data.ts
            }
          }));
          break;

        case 'DLVR':
          // Delivery receipt
          log('Delivery receipt:', data.channel_url);

          window.dispatchEvent(new CustomEvent('wv-chat-delivery', {
            detail: {
              channelUrl: data.channel_url,
              delivered: data.updated,
              timestamp: Date.now()
            }
          }));
          break;

        case 'TPNG':
          // Typing indicator
          window.dispatchEvent(new CustomEvent('wv-chat-typing', {
            detail: {
              channelUrl: data.channel_url,
              userId: data.user?.user_id,
              nickname: data.user?.nickname,
              isTyping: data.start
            }
          }));
          break;

        case 'PING':
          // Heartbeat from server
          state.lastHeartbeat = Date.now();
          log('Heartbeat');
          dispatchStatus('heartbeat');
          break;

        case 'PONG':
          // Heartbeat acknowledgement
          state.lastHeartbeat = Date.now();
          break;

        case 'BRDCST':
          // Broadcast event (channel updates)
          log('Broadcast event:', data.event);
          window.dispatchEvent(new CustomEvent('wv-chat-broadcast', {
            detail: data
          }));
          break;

        case 'MTHD':
          // Thread info update (reply count changed, etc)
          log('Thread info update:', data.root_message_id);

          window.dispatchEvent(new CustomEvent('wv-chat-message', {
            detail: {
              messageId: data.root_message_id,
              channelUrl: data.channel_url,
              message: null,
              messageType: 'MTHD',
              timestamp: data.ts || Date.now(),
              isThreadReply: false,
              parentMessageId: null,
              threadInfo: data.thread_info ? {
                replyCount: data.thread_info.reply_count,
                lastRepliedAt: data.thread_info.last_replied_at,
                updatedAt: data.thread_info.updated_at,
                memberCount: data.thread_info.member_count
              } : null
            }
          }));
          break;

        case 'UPDT':
          // Update event (message edited, etc)
          log('Update event');
          window.dispatchEvent(new CustomEvent('wv-chat-update', {
            detail: data
          }));
          break;

        case 'SYEV':
          // System event
          log('System event:', data.type);
          break;

        default:
          // Unknown command
          if (command !== 'MACK') { // Ignore message acknowledgements
            log('Unknown command:', command, data);
          }
      }
    });

    // CONNECTION CLOSE
    ws.addEventListener('close', (event) => {
      log('Connection closed:', event.code, event.reason);
      state.connected = false;

      const shouldReconnect = event.code === 1006 || // Abnormal closure
                              event.code === 1001 || // Going away (might be network issue)
                              event.code === 1011;   // Server error

      dispatchStatus('disconnected', {
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean,
        shouldReconnect
      });

      if (shouldReconnect) {
        state.reconnecting = true;
        dispatchStatus('reconnecting');
      }
    });

    // CONNECTION ERROR
    ws.addEventListener('error', (event) => {
      log('Connection error:', event);
      dispatchStatus('error', { error: event.toString() });
    });

    // Track recently sent message IDs to detect confirmations
    const recentlySentMessages = new Map(); // req_id -> { channelUrl, timestamp }
    const SENT_MESSAGE_TTL = 5000; // Keep track for 5 seconds

    // INTERCEPT OUTGOING MESSAGES (to detect message sends)
    const originalSend = ws.send.bind(ws);
    ws.send = function(data) {
      // Try to parse outgoing message to detect MESG commands
      try {
        const parsed = parseSendbirdMessage(data);
        if (parsed && parsed.command === 'MESG') {
          log('Outgoing message detected:', parsed.channel_url);

          // Track this message ID for confirmation matching
          if (parsed.req_id) {
            recentlySentMessages.set(parsed.req_id, {
              channelUrl: parsed.channel_url,
              timestamp: Date.now()
            });

            // Clean up old entries after TTL
            setTimeout(() => {
              recentlySentMessages.delete(parsed.req_id);
            }, SENT_MESSAGE_TTL);
          }

          // Dispatch event for DraftManager
          window.dispatchEvent(new CustomEvent('wv-websocket-message-sent', {
            detail: {
              channelUrl: parsed.channel_url,
              messageId: parsed.req_id
            }
          }));
        }
      } catch (e) {
        // Ignore parsing errors for outgoing messages
      }

      // Call original send
      return originalSend(data);
    };

    return ws;
  };

  // Preserve WebSocket properties and constants
  Object.assign(window.WebSocket, OriginalWebSocket);
  window.WebSocket.CONNECTING = OriginalWebSocket.CONNECTING;
  window.WebSocket.OPEN = OriginalWebSocket.OPEN;
  window.WebSocket.CLOSING = OriginalWebSocket.CLOSING;
  window.WebSocket.CLOSED = OriginalWebSocket.CLOSED;

  // Expose state for debugging (in debug mode only)
  if (DEBUG) {
    window.__wsInterceptorState = state;
  }

  log('WebSocket interceptor installed');

})();
