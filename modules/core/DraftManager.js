/**
 * DraftManager - Manages draft messages for channels
 *
 * This module automatically saves and restores draft messages when switching
 * between channels. It uses Lexical editor's native JSON state to preserve
 * rich text formatting including @mentions.
 *
 * Features:
 * - Auto-save on input (debounced 500ms)
 * - Auto-restore on channel change
 * - Preserves @mentions with proper highlighting
 * - Clear draft after successful send
 *
 * Storage: localStorage with key 'wv_draft_lexical'
 *
 * @version 1.0.0
 */

var WVFavs = WVFavs || {};

WVFavs.DraftManager = class DraftManager {
    constructor(app) {
        this.app = app;
        this.logger = app?.logger || { debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, analytics: () => {} };

        // State management
        this.currentChannelUrl = null;
        this.currentThreadId = null; // Current thread parent message ID (null = main chat)
        this.saveDebounceTimer = null;
        this.pendingSaveContext = null; // Store context (channelUrl, threadId) for pending save
        this.currentDraftContent = null; // In-memory cache of current draft
        this.isRestoringDraft = false; // Flag to prevent input events during restore
        this.restoreDebounceTimer = null; // Timer for debouncing restore operations
        this.editorCheckInterval = null; // Interval for checking new editors
        this.isChangingChannel = false; // Flag to prevent clearing drafts during channel switch

        // Two-stage send detection: Stage 1 (ARM) when editor empty, Stage 2 (FIRE) on send signal
        this.sendDetector = {
            armed: false,          // Stage 1: Editor became empty
            armedTime: 0,          // Timestamp when armed
            timeoutTimer: null,    // Auto-disarm after 3 seconds
            justSent: false,       // Flag to prevent saves immediately after send
            justSentTimer: null    // Timer to clear justSent flag
        };

        // Track last channel switch time to prevent false pending deletions
        this.lastChannelSwitchTime = 0;

        // Processing state management for two-phase draft processing
        this.processingDrafts = new Map(); // key: draftKey (channelUrl or channelUrl::thread::threadId)
        // value: { content, timestamp, timeoutTimer, channelUrl, threadId }
        this.lastUserInputTime = 0; // Track last time user typed
        this.idleCheckInterval = null; // Interval to check for idle state

        // Configuration
        this.config = {
            storageKey: 'wv_draft_lexical',
            saveDebounceMs: 500,
            restoreDelayMs: 300 // Delay before restoring draft after channel change
        };

        this.logger.info('📝 DraftManager initialized');
    }

    /**
     * Initialize the draft manager
     */
    async init() {
        try {
            this.logger.info('📝 Starting DraftManager initialization...');

            // Channel will be set by wv-channel-changed event from ThreadManager
            this.logger.debug('⏳ Waiting for wv-channel-changed event...');

            // Setup event listeners
            this.setupChannelMonitoring();

            // Setup input event listeners
            this.setupInputListeners();

            // Setup two-stage send detection
            this.setupSendDetection();

            // Setup cleanup interval for pending deletion drafts
            this.setupPendingDeletionCleanup();

            // Setup idle detection for processing drafts
            this.setupIdleDetection();

            this.logger.info('✅ DraftManager initialized successfully');

            // Track initialization
            if (this.logger.analytics) {
                this.logger.analytics('draft_manager_initialized', {
                    initial_channel: !!this.currentChannelUrl
                });
            }
        } catch (error) {
            console.error('❌ WV Favorites: [DraftManager] Initialization failed:', error);
            console.error('❌ WV Favorites: [DraftManager] Error details:', { message: error.message, stack: error.stack });
            this.logger.error('❌ DraftManager initialization failed', { error: error.message, stack: error.stack });
            throw error; // Re-throw so content.js can catch it
        }
    }

    /**
     * Setup channel change monitoring
     * Listens to events from ThreadManager (which gets data from API calls)
     */
    setupChannelMonitoring() {
        // Listen for channel change events from ThreadManager
        window.addEventListener('wv-channel-changed', (event) => {
            const { currentChannel, previousChannel } = event.detail;
            this.logger.debug('📍 Channel changed:', { from: previousChannel, to: currentChannel });
            this.handleChannelChange(currentChannel, previousChannel, null);
        });

        // Also listen for thread messages (backup for initial channel detection)
        window.addEventListener('wv-thread-messages', (event) => {
            const { channelUrl } = event.detail;

            // If we don't have a channel yet, use this as the initial channel
            if (channelUrl && !this.currentChannelUrl) {
                this.logger.debug('📍 Initial channel detected from API:', channelUrl);
                this.handleChannelChange(channelUrl, null, null);
            }
        });

        // Listen for thread context switches
        this.setupThreadPanelMonitoring();

        this.logger.debug('✅ Channel monitoring setup complete');
    }

    /**
     * Monitor thread panel opening/closing
     * Detects when user switches between main chat and thread panel
     */
    setupThreadPanelMonitoring() {
        // Track whether thread panel currently exists
        let threadPanelExists = !!document.querySelector('[data-testid="thread-message-section"]');
        console.log(`🔍 [DraftManager] Initial thread panel state: ${threadPanelExists ? 'exists' : 'not found'}`);

        // Debounce timer to prevent infinite loops when threads panel renders
        let debounceTimer = null;
        let isProcessing = false;

        // Use MutationObserver to detect thread panel appearance/disappearance
        const observer = new MutationObserver(async (mutations) => {
            // Skip if already processing to prevent cascading calls
            if (isProcessing) {
                return;
            }

            // Clear previous debounce timer
            if (debounceTimer) {
                clearTimeout(debounceTimer);
            }

            // Debounce to prevent rapid-fire mutations (e.g., when threads modal renders)
            debounceTimer = setTimeout(async () => {
                // Check current state
                const threadPanel = document.querySelector('[data-testid="thread-message-section"]');
                const currentState = !!threadPanel;

                // Only call React API if state actually changed
                if (currentState !== threadPanelExists) {
                    threadPanelExists = currentState;
                    console.log(`🔄 [DraftManager] Thread panel ${currentState ? 'appeared' : 'disappeared'} - checking React state`);

                    isProcessing = true;
                    try {
                        await this.detectThreadContext();
                    } finally {
                        isProcessing = false;
                    }
                }
            }, 300); // 300ms debounce to wait for DOM to settle
        });

        // Observe changes to document.body with broader scope to catch all thread panel mutations
        // The thread panel is dynamically inserted and may not be a child of message-section
        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true, // Also watch for attribute changes (like data-testid being added)
            attributeFilter: ['data-testid'] // Only care about data-testid changes
        });

        console.log('✅ [DraftManager] Thread panel MutationObserver attached to document.body (with debouncing)');

        // Initial check only
        this.detectThreadContext();

        this.logger.debug('✅ Thread panel monitoring setup complete (efficient mode with debouncing)');
    }

    /**
     * Detect if we're currently in main chat or thread panel
     * Updates currentThreadId accordingly
     * Uses React hooks to reliably detect thread state
     */
    async detectThreadContext() {
        try {
            // Use ReactFiberNavigator to get current thread state from React hooks
            if (!this.app.reactFiberNav) {
                this.logger.warn('⚠️ ReactFiberNavigator not available');
                return;
            }

            const threadState = await this.app.reactFiberNav.getCurrentThreadId();

            if (!threadState.success) {
                this.logger.debug('⚠️ Could not get thread state from React hooks');
                return;
            }

            // threadState.threadId is null for main chat, or a number for thread
            const newThreadId = threadState.threadId ? String(threadState.threadId) : null;

            // Only trigger change if thread ID actually changed
            if (this.currentThreadId !== newThreadId) {
                const previousThreadId = this.currentThreadId;
                this.currentThreadId = newThreadId;

                console.log('🧵 [DraftManager] Thread context changed (from React hooks):', {
                    from: previousThreadId || 'main chat',
                    to: newThreadId || 'main chat',
                    isThread: threadState.isThread
                });

                this.logger.debug('🧵 Thread context changed (from React hooks):', {
                    from: previousThreadId || 'main chat',
                    to: newThreadId || 'main chat',
                    isThread: threadState.isThread
                });

                // Save current draft before switching
                this.handleContextChange(previousThreadId, newThreadId);
            }
        } catch (error) {
            console.error('❌ [DraftManager] Error detecting thread context:', error);
            this.logger.error('❌ Error detecting thread context:', error);
        }
    }

    /**
     * Setup input event listeners for auto-save
     */
    setupInputListeners() {
        // Handler for input events
        const handleInputEvent = (e) => {
            // Check if input is from the message editor (use multiple selectors as fallback)
            const editor = e.target.closest(
                'div[contenteditable="true"][role="textbox"], ' +
                'div[contenteditable="true"][placeholder*="message"], ' +
                'div[contenteditable="true"][placeholder*="Message"]'
            );
            if (editor) {
                // Log when we detect input from the editor (only once per session)
                if (!this._inputDetected) {
                    console.log('🎯 [DraftManager] Editor input detected - draft auto-save is now active');
                    this._inputDetected = true;
                }
                console.log('⌨️ [DraftManager] Input event:', e.type, 'inputType:', e.inputType);
                this.handleInput();
            }
        };

        // Listen to multiple event types to catch all text changes
        document.addEventListener('input', handleInputEvent, true);
        document.addEventListener('beforeinput', handleInputEvent, true);

        // IMPORTANT: Lexical editor doesn't always fire input events for deletions
        // Use MutationObserver to catch ALL content changes
        const observeEditor = (editorElement) => {
            if (editorElement._draftObserver) return; // Already observing

            let mutationTimeout = null;
            let lastMutationTime = 0;
            const MUTATION_THROTTLE_MS = 150; // Throttle mutations to max once per 150ms

            const observer = new MutationObserver((mutations) => {
                // Filter out mutations that aren't actual content changes
                const hasContentChange = mutations.some(m =>
                    m.type === 'characterData' ||
                    m.type === 'childList'
                );

                if (!hasContentChange) return;

                // Throttle: Ignore mutations that happen too quickly
                const now = Date.now();
                if (now - lastMutationTime < MUTATION_THROTTLE_MS) {
                    // Clear previous timeout and set new one
                    if (mutationTimeout) clearTimeout(mutationTimeout);
                    mutationTimeout = setTimeout(() => {
                        console.log('👁️ [DraftManager] Content changed via MutationObserver (throttled)');
                        console.log('🔥🔥🔥 [DraftManager] About to call this.handleInput() from throttled mutation');
                        this.handleInput();
                        console.log('🔥🔥🔥 [DraftManager] Finished calling this.handleInput() from throttled mutation');
                        lastMutationTime = Date.now();
                    }, MUTATION_THROTTLE_MS);
                    return;
                }

                console.log('👁️ [DraftManager] Content changed via MutationObserver');
                console.log('🔥🔥🔥 [DraftManager] About to call this.handleInput() from mutation');
                this.handleInput();
                console.log('🔥🔥🔥 [DraftManager] Finished calling this.handleInput() from mutation');
                lastMutationTime = now;
            });

            observer.observe(editorElement, {
                characterData: true,
                childList: true,
                subtree: true
            });

            editorElement._draftObserver = observer;
            console.log('👁️ [DraftManager] MutationObserver attached to editor');
        };

        // Find and observe existing editors
        const findAndObserveEditors = () => {
            const selectors = [
                'div[contenteditable="true"][role="textbox"]',
                'div[contenteditable="true"][placeholder*="message"]'
            ];

            selectors.forEach(selector => {
                document.querySelectorAll(selector).forEach(observeEditor);
            });
        };

        // Observe editors on init and periodically check for new ones (less frequently)
        findAndObserveEditors();
        this.editorCheckInterval = setInterval(findAndObserveEditors, 5000); // Check every 5 seconds

        console.log('✅ [DraftManager] Input event listeners and MutationObserver attached');
        this.logger.debug('✅ Input listeners setup complete');
    }

    /**
     * ARM the send detector (Stage 1: called when editor becomes empty)
     */
    armSendDetector() {
        console.log('🔫 [DraftManager] Send detector ARMED - waiting for send signals');

        this.sendDetector.armed = true;
        this.sendDetector.armedTime = Date.now();

        // Auto-disarm after 3 seconds (user probably just deleted text manually)
        if (this.sendDetector.timeoutTimer) {
            clearTimeout(this.sendDetector.timeoutTimer);
        }

        this.sendDetector.timeoutTimer = setTimeout(() => {
            if (this.sendDetector.armed) {
                console.log('⏰ [DraftManager] Send detector timeout - disarming (no signals received)');
                this.disarmSendDetector();
            }
        }, 3000);
    }

    /**
     * DISARM the send detector
     */
    disarmSendDetector() {
        this.sendDetector.armed = false;
        this.sendDetector.armedTime = 0;

        if (this.sendDetector.timeoutTimer) {
            clearTimeout(this.sendDetector.timeoutTimer);
            this.sendDetector.timeoutTimer = null;
        }
    }

    /**
     * Calculate similarity between two strings (0-100%)
     * Uses Levenshtein distance for fuzzy matching
     */
    calculateSimilarity(str1, str2) {
        if (!str1 || !str2) return 0;

        // Normalize strings
        const normalize = (s) => s.trim().toLowerCase().replace(/\s+/g, ' ');
        const s1 = normalize(str1);
        const s2 = normalize(str2);

        if (s1 === s2) return 100;
        if (s1.length === 0 || s2.length === 0) return 0;

        // Use Levenshtein distance
        const matrix = [];
        for (let i = 0; i <= s1.length; i++) {
            matrix[i] = [i];
        }
        for (let j = 0; j <= s2.length; j++) {
            matrix[0][j] = j;
        }

        for (let i = 1; i <= s1.length; i++) {
            for (let j = 1; j <= s2.length; j++) {
                if (s1[i - 1] === s2[j - 1]) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1, // substitution
                        matrix[i][j - 1] + 1,     // insertion
                        matrix[i - 1][j] + 1      // deletion
                    );
                }
            }
        }

        const distance = matrix[s1.length][s2.length];
        const maxLength = Math.max(s1.length, s2.length);
        const similarity = ((maxLength - distance) / maxLength) * 100;

        return Math.round(similarity);
    }

    /**
     * Two-stage send detection:
     * Stage 1: Editor empty → ARM detector
     * Stage 2: Send signal → FIRE (clear draft without rechecking editor)
     */
    setupSendDetection() {
        const clearDraftOnSend = (sentMessageText = null) => {
            console.log('🎯 [DraftManager] Send signal received');

            // Get current draft text
            const draftText = this.currentDraftContent?.textContent || '';

            // If we have sent message text, verify similarity
            if (sentMessageText && draftText) {
                const similarity = this.calculateSimilarity(draftText, sentMessageText);
                console.log(`📊 [DraftManager] Draft similarity: ${similarity}% (threshold: 60%)`);
                console.log(`   Draft: "${draftText.substring(0, 50)}..."`);
                console.log(`   Sent: "${sentMessageText.substring(0, 50)}..."`);

                if (similarity < 60) {
                    console.log('⏭️ [DraftManager] Similarity too low - keeping draft');
                    return; // Do not clear draft - texts do not match
                }

                console.log('✅ [DraftManager] Similarity sufficient - clearing draft');
            }

            // ALWAYS set flag to prevent any draft saves for next 500ms
            // Don't require arming - just trust the send signal
            this.sendDetector.justSent = true;
            if (this.sendDetector.justSentTimer) {
                clearTimeout(this.sendDetector.justSentTimer);
            }
            this.sendDetector.justSentTimer = setTimeout(() => {
                this.sendDetector.justSent = false;
                console.log('✅ [DraftManager] Draft capture re-enabled after send');
            }, 500); // Prevent saves for 500ms after send

            // Clear memory cache
            this.currentDraftContent = null;

            // Clear localStorage
            this.clearDraft(this.currentChannelUrl, this.currentThreadId);

            // Cancel pending saves
            if (this.saveDebounceTimer) {
                clearTimeout(this.saveDebounceTimer);
                this.saveDebounceTimer = null;
            }

            // Disarm detector if it was armed
            if (this.sendDetector.armed) {
                this.disarmSendDetector();
            }
        };

        // Listen for WebSocket message sent
        window.addEventListener('wv-websocket-message-sent', (e) => {
            console.log('📡 [DraftManager] WebSocket send signal');
            clearDraftOnSend();
        });

        // Listen for sanitise API (has message text)
        window.addEventListener('wv-message-sanitise-called', (e) => {
            const messageText = e.detail?.messageText;
            console.log('🧼 [DraftManager] Sanitise API signal', messageText ? `(${messageText.length} chars)` : '(no text)');
            clearDraftOnSend(messageText);
        });

        // Listen for notify API
        window.addEventListener('wv-message-notify-called', (e) => {
            console.log('📬 [DraftManager] Notify API signal');
            clearDraftOnSend();
        });

        // Listen for file message send (messages with attachments)
        window.addEventListener('wv-message-files-sent', (e) => {
            const messageText = e.detail?.messageText;
            console.log('📎 [DraftManager] File message sent signal', messageText ? `(${messageText.length} chars)` : '(no text)');
            clearDraftOnSend(messageText);
        });

        // Listen for WebSocket MESG confirmation (message successfully received by server)
        window.addEventListener('wv-websocket-message-confirmed', (e) => {
            console.log('✅ [DraftManager] WebSocket confirmed message sent');
            clearDraftOnSend();
        });

        this.logger.debug('✅ Two-stage send detection setup complete');
    }

    /**
     * Handle input events (debounced auto-save)
     */
    async handleInput() {
        console.log('🎯 [DraftManager] handleInput() called');

        // Ignore input events if we're currently restoring a draft
        if (this.isRestoringDraft) {
            console.log('⏭️ [DraftManager] Input ignored - currently restoring draft');
            return;
        }

        console.log('🎯 [DraftManager] Proceeding to requestAnimationFrame');

        // Wait for next frame to ensure Lexical editor has updated its state
        // This fixes the issue where the last character was missing
        requestAnimationFrame(async () => {
            console.log('🎯 [DraftManager] Inside requestAnimationFrame, about to call captureDraftToMemory()');
            // Capture draft content to memory after editor state updates
            await this.captureDraftToMemory();

            // Stage 1: Editor is empty → ARM send detector (wait for send signals)
            // Don't clear immediately - wait for Stage 2 confirmation signals
            if (!this.isChangingChannel && this.currentDraftContent &&
                (!this.currentDraftContent.textContent || !this.currentDraftContent.textContent.trim())) {

                console.log('📭 [DraftManager] Editor empty - arming send detector');

                // ARM the detector to listen for send signals
                this.armSendDetector();

                // Don't clear yet - wait for Stage 2 signals
                // (Prevents clearing on manual delete or channel switch)

                return;
            }
        });

        // IMPORTANT: If there's a pending save, flush it immediately before starting a new timer
        // This prevents losing drafts when quickly switching contexts (main chat -> thread panel)
        if (this.saveDebounceTimer) {
            console.log('⚡ [DraftManager] Flushing pending save before starting new timer');
            clearTimeout(this.saveDebounceTimer);
            this.saveDebounceTimer = null;

            // Immediately save the pending draft from previous context using the stored context
            // Use saveDraftFromMemory() to preserve the correct channelUrl and threadId
            // BUT skip if we just sent a message (prevents saving cleared draft)
            if (this.currentDraftContent && !this.sendDetector.justSent) {
                console.log('💾 [DraftManager] Saving previous context draft:', {
                    thread: this.currentDraftContent.threadId ? 'thread' : 'main',
                    textLength: this.currentDraftContent.textContent?.length
                });
                await this.saveDraftFromMemory(this.currentDraftContent);
            } else if (this.sendDetector.justSent) {
                console.log('🚫 [DraftManager] Skipping flush - message was just sent');
            }
        }

        // Debounce write to localStorage (for performance)
        this.saveDebounceTimer = setTimeout(async () => {
            console.log('⏰ [DraftManager] Save debounce complete, calling saveDraft()...');
            await this.saveDraft();
        }, this.config.saveDebounceMs);
    }

    /**
     * Capture current draft content to memory immediately
     * This is called on every input event (no debounce) to ensure we never lose data
     */
    async captureDraftToMemory() {
        console.log('🎯🎯🎯 [DraftManager] captureDraftToMemory() CALLED');
        try {
            // Skip if we just sent a message (prevents capturing cleared editor content)
            if (this.sendDetector.justSent) {
                console.log('🚫 [DraftManager] Skipping draft capture - message was just sent');
                return;
            }

            // CRITICAL: Skip ALL draft captures during channel switches to prevent race conditions
            // This prevents capturing empty/transitional editor content with wrong channel URL
            if (this.isChangingChannel) {
                console.log('🚫 [DraftManager] Skipping draft capture - channel switch in progress');
                return;
            }

            if (!this.currentChannelUrl) {
                console.warn('⚠️ [DraftManager] Cannot capture draft - waiting for wv-channel-changed event');
                return;
            }

            // TWO-PHASE PROCESSING: Check if user is typing in same chat with processing draft
            // If yes, discard the processing draft (user typing again in same chat)
            // If different chat, keep processing draft for finalization
            const tentativeDraftKey = this.getDraftKey(this.currentChannelUrl, this.currentThreadId);
            const processingDraft = this.processingDrafts.get(tentativeDraftKey);
            if (processingDraft) {
                console.log('🔄 [DraftManager] User typing in same chat - discarding processing draft');
                if (processingDraft.timeoutTimer) {
                    clearTimeout(processingDraft.timeoutTimer);
                }
                this.processingDrafts.delete(tentativeDraftKey);
            }

            console.log('🎯 [DraftManager] About to call getLexicalEditorStateFromPageContext()');
            // Request editor state from page context (via page-script.js)
            const result = await this.getLexicalEditorStateFromPageContext();
            console.log('🎯 [DraftManager] getLexicalEditorStateFromPageContext() returned:', result?.success);
            if (!result || !result.success) {
                console.log('🎯 [DraftManager] Exiting early - result failed');
                return;
            }

            // CRITICAL: Always get FRESH thread ID from React, don't rely on cached this.currentThreadId
            // This prevents thread ID from being stale when switching between threads in same channel
            let actualThreadId = null;
            if (result.isThreadContext) {
                // User is typing in thread panel - get current thread ID from React
                const threadState = await this.app.reactFiberNav.getCurrentThreadId();
                if (threadState.success && threadState.threadId) {
                    actualThreadId = String(threadState.threadId);
                    console.log('🔍 [DraftManager] Got fresh thread ID from React:', actualThreadId);

                    // Update cached value
                    if (this.currentThreadId !== actualThreadId) {
                        console.log('🔄 [DraftManager] Thread ID changed from React:', {
                            old: this.currentThreadId,
                            new: actualThreadId
                        });
                        this.currentThreadId = actualThreadId;
                    }
                } else {
                    console.warn('⚠️ [DraftManager] Thread context detected but could not get thread ID from React');
                }
            }

            // CRITICAL: Don't overwrite existing content with empty content during channel switches!
            // This prevents race condition where editor is cleared during channel switch
            // BEFORE handleChannelChange() has saved the draft.
            const newTextContent = result.textContent || '';
            const hasExistingContent = this.currentDraftContent && this.currentDraftContent.textContent && this.currentDraftContent.textContent.trim();
            const newContentIsEmpty = !newTextContent.trim();

            // DEBUG: Always log this to understand what's happening
            console.log('🔍 [DraftManager] captureDraftToMemory state check:', {
                newContentIsEmpty,
                hasExistingContent: !!hasExistingContent,
                existingTextLength: this.currentDraftContent?.textContent?.length || 0,
                existingTextPreview: this.currentDraftContent?.textContent?.substring(0, 20) || 'none',
                isChangingChannel: this.isChangingChannel,
                currentChannelUrl: this.currentChannelUrl?.substring(0, 40) || 'none'
            });

            if (hasExistingContent && newContentIsEmpty && this.isChangingChannel) {
                console.log('⚠️ [DraftManager] Skipping empty capture during channel switch - would overwrite existing draft:', {
                    existing: this.currentDraftContent.textContent.substring(0, 30),
                    existingLength: this.currentDraftContent.textContent.length
                });
                // Don't overwrite - keep existing content for handleChannelChange() to save
                return;
            }

            // TWO-PHASE DRAFT PROCESSING: Input became empty - mark as processing
            // Don't make immediate decisions - let marker monitoring system finalize later
            if (hasExistingContent && newContentIsEmpty) {
                console.log('⏸️ [DraftManager] Input became empty - marking draft as PROCESSING');

                // CRITICAL: Clear any pending debounced save to prevent interference
                if (this.saveDebounceTimer) {
                    clearTimeout(this.saveDebounceTimer);
                    this.saveDebounceTimer = null;
                    console.log('⏸️ [DraftManager] Cleared pending save timer for processing draft');
                }

                // Mark this draft as processing
                const draftKey = this.getDraftKey(this.currentChannelUrl, actualThreadId);
                await this.markDraftAsProcessing(draftKey, this.currentDraftContent, this.currentChannelUrl, actualThreadId);

                // Clear memory since editor is now empty
                this.currentDraftContent = null;
                return;
            }

            // Store in memory with current channel and ACTUAL thread context
            this.currentDraftContent = {
                channelUrl: this.currentChannelUrl,
                threadId: actualThreadId,
                lexicalState: result.lexicalState,
                textContent: newTextContent,
                timestamp: result.timestamp
            };

            // Track user input time for idle detection
            this.lastUserInputTime = Date.now();

            console.log('📝 [DraftManager] Draft captured to memory:', {
                channel: this.currentChannelUrl?.substring(0, 40) + '...',
                currentThreadId: this.currentThreadId,
                actualThreadId: actualThreadId,
                thread: actualThreadId ? actualThreadId.substring(0, 20) : 'main',
                editorContext: result.isThreadContext ? 'thread' : 'main',
                textLength: newTextContent.length,
                preview: newTextContent.substring(0, 30)
            });
        } catch (error) {
            console.error('❌ [DraftManager] Error capturing draft:', error);
            this.logger.error('❌ Error capturing draft to memory:', error);
        }
    }

    /**
     * Handle context change (main chat <-> thread panel)
     * Similar to channel change but for switching between main and thread
     */
    async handleContextChange(previousThreadId, newThreadId) {
        // IMPORTANT: Set flag to prevent clearing drafts during context transition
        this.isChangingChannel = true;

        this.logger.debug('🔄 Context changed:', {
            from: previousThreadId || 'main',
            to: newThreadId || 'main',
            channel: this.currentChannelUrl
        });

        // Save current draft with previous context
        if (this.currentDraftContent && this.currentChannelUrl) {
            await this.saveDraftFromMemory(this.currentDraftContent);
            this.currentDraftContent = null;
        }

        // Restore draft for new context
        if (this.currentChannelUrl) {
            setTimeout(async () => {
                // Double-check context still matches (handles rapid thread switches)
                if (this.currentThreadId !== newThreadId) {
                    this.logger.debug('⏭️ Skipping restore - thread context changed again');
                    this.isChangingChannel = false; // Clear flag
                    return;
                }

                await this.restoreDraft(this.currentChannelUrl, newThreadId);

                // Clear the flag after a brief delay to let editor settle
                // 200ms is enough to skip restore mutations but quick enough for user typing
                setTimeout(() => {
                    this.isChangingChannel = false;
                    console.log('✅ [DraftManager] Context change complete, draft clearing re-enabled');
                }, 200);
            }, this.config.restoreDelayMs);
        } else {
            this.isChangingChannel = false;
        }
    }

    /**
     * Handle channel change event
     *
     * Strategy:
     * 1. Save the in-memory draft (captured from last input event) to localStorage
     * 2. Clear pending save timers
     * 3. Update to new channel
     * 4. Restore the new channel's draft from localStorage
     *
     * This avoids the race condition because we use the draft content that was
     * captured in memory during the last input event, rather than trying to read
     * the editor which might have already switched to the new channel.
     */
    async handleChannelChange(newChannel, previousChannel, threadId = null) {
        // Skip if channel hasn't actually changed (deduplication)
        if (newChannel === previousChannel) {
            return;
        }

        // IMPORTANT: Set flag to prevent clearing drafts during channel transition
        this.isChangingChannel = true;
        this.lastChannelSwitchTime = Date.now(); // Track when this switch happened

        console.log('🔄 [DraftManager] Channel changed:', {
            from: previousChannel?.substring(0, 40),
            to: newChannel?.substring(0, 40)
        });
        this.logger.debug('📍 Channel changed:', { from: previousChannel, to: newChannel });

        // Clear any pending debounced save
        if (this.saveDebounceTimer) {
            clearTimeout(this.saveDebounceTimer);
            this.saveDebounceTimer = null;
        }

        // Save the in-memory draft (if any) to localStorage immediately
        // This draft was captured from the last input event, so it's for the OLD channel
        // BUT skip if we just sent a message (prevents restoring cleared draft)
        if (this.currentDraftContent && this.currentDraftContent.channelUrl && !this.sendDetector.justSent) {
            this.logger.debug('💾 Saving in-memory draft before channel switch:', this.currentDraftContent.channelUrl);
            await this.saveDraftFromMemory(this.currentDraftContent);
            this.currentDraftContent = null; // Clear after saving
        } else if (this.sendDetector.justSent) {
            console.log('🚫 [DraftManager] Skipping draft save on channel change - message was just sent');
            this.currentDraftContent = null; // Clear memory cache
        }

        // CRITICAL: Update current channel FIRST before any restore operations
        const previousChannelUrl = this.currentChannelUrl;
        this.currentChannelUrl = newChannel;
        this.currentThreadId = threadId;

        // Clear justSent flag when changing channels (user is moving to new context)
        if (this.sendDetector.justSent) {
            console.log('🔄 [DraftManager] Clearing justSent flag due to channel change');
            this.sendDetector.justSent = false;
            if (this.sendDetector.justSentTimer) {
                clearTimeout(this.sendDetector.justSentTimer);
                this.sendDetector.justSentTimer = null;
            }
        }

        // Clear any pending restore
        if (this.restoreDebounceTimer) {
            clearTimeout(this.restoreDebounceTimer);
            this.restoreDebounceTimer = null;
        }

        // Restore draft for new channel (with delay to let DOM settle)
        if (newChannel) {
            this.restoreDebounceTimer = setTimeout(async () => {
                // Double-check channel still matches before restore (handles rapid switches)
                if (this.currentChannelUrl !== newChannel) {
                    this.logger.debug('⏭️ Skipping restore - channel changed again:', {
                        expected: newChannel.substring(0, 40),
                        current: this.currentChannelUrl?.substring(0, 40)
                    });
                    this.isChangingChannel = false; // Clear flag
                    return;
                }

                this.logger.debug('📂 Restoring draft for new channel:', newChannel);
                await this.restoreDraft(newChannel, threadId);
                this.restoreDebounceTimer = null;

                // Clear the channel change flag after a brief delay to let editor settle
                // 200ms is enough to skip restore mutations but quick enough for user typing
                setTimeout(() => {
                    this.isChangingChannel = false;
                    console.log('✅ [DraftManager] Channel change complete, draft clearing re-enabled');
                }, 200);
            }, this.config.restoreDelayMs);
        } else {
            // No new channel to restore, clear flag immediately
            this.isChangingChannel = false;
        }
    }

    /**
     * Generate draft storage key
     * Format: channelUrl or channelUrl::threadId
     */
    getDraftKey(channelUrl, threadId = null) {
        if (threadId) {
            return `${channelUrl}::thread::${threadId}`;
        }
        return channelUrl;
    }

    /**
     * Save draft from memory to localStorage
     * Used when switching channels to immediately save the cached draft
     */
    async saveDraftFromMemory(draftContent) {
        try {
            // Skip if we just sent a message (prevents saving cleared draft)
            if (this.sendDetector.justSent) {
                console.log('🚫 [DraftManager] Skipping draft save from memory - message was just sent');
                return;
            }

            const channelUrl = draftContent.channelUrl;
            const threadId = draftContent.threadId;
            const textContent = draftContent.textContent;

            if (!textContent || !textContent.trim()) {
                this.logger.debug('⏭️ Skipping save - draft is empty (not clearing existing draft)');
                // Don't call clearDraft() - just skip saving
                // This prevents deleting drafts when editor is cleared during channel switch
                return;
            }

            // Load all drafts
            const drafts = this.getAllDrafts();

            // Generate storage key based on context
            const draftKey = this.getDraftKey(channelUrl, threadId);

            // For thread drafts, get parent message timestamp for reliable navigation
            let parentMessageCreatedAt = null;
            if (threadId) {
                parentMessageCreatedAt = await this.getParentMessageTimestamp(threadId);
                if (parentMessageCreatedAt) {
                    console.log(`✅ [DraftManager] Got parent message timestamp: ${parentMessageCreatedAt} for thread ${threadId}`);
                } else {
                    console.warn(`⚠️ [DraftManager] Could not get parent message timestamp for thread ${threadId}`);
                }
            }

            // Save draft
            drafts[draftKey] = {
                lexicalState: draftContent.lexicalState,
                textContent: textContent,
                timestamp: draftContent.timestamp,
                threadId: threadId, // Store thread ID for reference
                parentMessageCreatedAt: parentMessageCreatedAt // Store parent timestamp for thread drafts
            };

            // Write to localStorage
            localStorage.setItem(this.config.storageKey, JSON.stringify(drafts));

            // Dispatch event for real-time panel updates
            document.dispatchEvent(new CustomEvent('wv-draft-updated'));

            // Update drafts button badge count
            this.updateDraftsButtonBadge();

            console.log('💾 [DraftManager] Draft saved to localStorage:', {
                channel: channelUrl.substring(0, 40) + '...',
                thread: threadId ? threadId.substring(0, 20) : 'main chat',
                textLength: textContent.length,
                preview: textContent.substring(0, 30)
            });

            this.logger.debug('✅ Draft saved from memory:', {
                channel: channelUrl,
                threadId: threadId,
                textLength: textContent.length,
                preview: textContent.substring(0, 50)
            });
        } catch (error) {
            console.error('❌ [DraftManager] Error saving draft:', error);
            this.logger.error('❌ Error saving draft from memory:', error);
        }
    }


    /**
     * Save draft with pending deletion timestamp (Accidental Delete Assistance)
     * Used when user clears text - saves draft for 60 seconds before permanent deletion
     */
    async saveDraftWithPendingDeletion(channelUrl, threadId, draftContent, pendingDeletion) {
        try {
            const textContent = draftContent.textContent;

            if (!textContent || !textContent.trim()) {
                this.logger.debug('⏭️ Skipping pending deletion save - draft is empty');
                return;
            }

            // Load all drafts
            const drafts = this.getAllDrafts();

            // Generate storage key based on context
            const draftKey = this.getDraftKey(channelUrl, threadId);

            // For thread drafts, get parent message timestamp for reliable navigation
            let parentMessageCreatedAt = null;
            if (threadId) {
                parentMessageCreatedAt = await this.getParentMessageTimestamp(threadId);
                if (parentMessageCreatedAt) {
                    console.log(`✅ [DraftManager] Got parent message timestamp: ${parentMessageCreatedAt} for thread ${threadId}`);
                } else {
                    console.warn(`⚠️ [DraftManager] Could not get parent message timestamp for thread ${threadId}`);
                }
            }

            // Save draft with pendingDeletion flag
            drafts[draftKey] = {
                lexicalState: draftContent.lexicalState,
                textContent: textContent,
                timestamp: draftContent.timestamp,
                threadId: threadId,
                parentMessageCreatedAt: parentMessageCreatedAt,
                pendingDeletion: pendingDeletion // Timestamp when this draft should be deleted
            };

            // Write to localStorage
            localStorage.setItem(this.config.storageKey, JSON.stringify(drafts));

            // Dispatch event for real-time panel updates
            document.dispatchEvent(new CustomEvent('wv-draft-updated'));

            // Update drafts button badge count
            this.updateDraftsButtonBadge();

            console.log('🕐 [DraftManager] Draft saved with pending deletion:', {
                channel: channelUrl.substring(0, 40) + '...',
                thread: threadId ? threadId.substring(0, 20) : 'main chat',
                textLength: textContent.length,
                deletesAt: new Date(pendingDeletion).toLocaleTimeString(),
                preview: textContent.substring(0, 30)
            });

            this.logger.debug('✅ Draft saved with pending deletion:', {
                channel: channelUrl,
                threadId: threadId,
                textLength: textContent.length,
                pendingDeletion: pendingDeletion
            });
        } catch (error) {
            console.error('❌ [DraftManager] Error saving draft with pending deletion:', error);
            this.logger.error('❌ Error saving draft with pending deletion:', error);
        }
    }

    /**
     * Setup cleanup interval for drafts with pending deletion
     * Runs every 10 seconds to check for and delete expired drafts
     */
    setupPendingDeletionCleanup() {
        // Clean up expired drafts every 10 seconds
        this.pendingDeletionCleanupInterval = setInterval(() => {
            this.cleanupExpiredDrafts();
        }, 10000); // 10 seconds

        this.logger.debug('✅ Pending deletion cleanup interval started (10s)');
    }

    /**
     * Clean up drafts that have expired pending deletion
     * Removes drafts where Date.now() >= pendingDeletion timestamp
     */
    cleanupExpiredDrafts() {
        try {
            const drafts = this.getAllDrafts();
            const now = Date.now();
            let deletedCount = 0;

            // Find and delete expired drafts
            for (const [key, draft] of Object.entries(drafts)) {
                if (draft.pendingDeletion && now >= draft.pendingDeletion) {
                    console.log('🗑️ [DraftManager] Deleting expired draft:', {
                        key: key.substring(0, 40),
                        expiredAt: new Date(draft.pendingDeletion).toLocaleTimeString(),
                        preview: draft.textContent?.substring(0, 30)
                    });

                    delete drafts[key];
                    deletedCount++;
                }
            }

            // If any drafts were deleted, update storage and UI
            if (deletedCount > 0) {
                localStorage.setItem(this.config.storageKey, JSON.stringify(drafts));
                document.dispatchEvent(new CustomEvent('wv-draft-updated'));
                this.updateDraftsButtonBadge();

                this.logger.debug(`🗑️ Cleaned up ${deletedCount} expired drafts`);
            }
        } catch (error) {
            console.error('❌ [DraftManager] Error cleaning up expired drafts:', error);
            this.logger.error('❌ Error cleaning up expired drafts:', error);
        }
    }

    /**
     * TWO-PHASE PROCESSING: Mark draft as processing (Phase 1)
     * Sets 3-second timeout for marker monitoring to finalize decision (Phase 2)
     */
    async markDraftAsProcessing(draftKey, draftContent, channelUrl, threadId) {
        console.log('⏸️ [DraftManager] Marking draft as PROCESSING:', {
            key: draftKey.substring(0, 40),
            preview: draftContent.textContent?.substring(0, 30)
        });

        // Clear any existing timeout for this draft
        const existing = this.processingDrafts.get(draftKey);
        if (existing?.timeoutTimer) {
            clearTimeout(existing.timeoutTimer);
        }

        // Set 3-second timeout to finalize this draft
        const timeoutTimer = setTimeout(() => {
            this.finalizeDraft(draftKey);
        }, 3000);

        // Store in processing map
        this.processingDrafts.set(draftKey, {
            content: draftContent,
            timestamp: Date.now(),
            timeoutTimer: timeoutTimer,
            channelUrl: channelUrl,
            threadId: threadId
        });

        console.log('✅ [DraftManager] Draft marked as processing with 3s timeout');
    }

    /**
     * TWO-PHASE PROCESSING: Setup idle detection interval
     * Checks every 500ms if user is idle in same channel without typing
     */
    setupIdleDetection() {
        this.idleCheckInterval = setInterval(() => {
            this.checkIdleState();
        }, 500); // Check every 500ms

        this.logger.debug('✅ Idle detection interval started (500ms)');
    }

    /**
     * TWO-PHASE PROCESSING: Check if user is idle
     * If user stayed in same channel >1s without typing AFTER draft was marked as processing, finalize it
     */
    checkIdleState() {
        const now = Date.now();

        // Check each processing draft
        for (const [draftKey, processingDraft] of this.processingDrafts.entries()) {
            const timeSinceProcessing = now - processingDraft.timestamp;

            // If user stayed in same channel >1s AFTER draft was marked as processing
            // AND the draft is for the current channel (user didn't switch)
            const isCurrentChannel = processingDraft.channelUrl === this.currentChannelUrl;

            if (timeSinceProcessing > 1000 && isCurrentChannel) {
                console.log('⏱️ [DraftManager] User idle >1s in same channel since draft processing - finalizing draft');
                // Clear the timeout since we're finalizing now
                if (processingDraft.timeoutTimer) {
                    clearTimeout(processingDraft.timeoutTimer);
                }
                this.finalizeDraft(draftKey, 'idle');
            }
        }
    }

    /**
     * TWO-PHASE PROCESSING: Finalize draft decision (Phase 2)
     * Apply decision logic based on markers detected
     */
    async finalizeDraft(draftKey, marker = 'timeout') {
        const processingDraft = this.processingDrafts.get(draftKey);
        if (!processingDraft) {
            return; // Already finalized
        }

        console.log('🎯 [DraftManager] Finalizing draft:', {
            key: draftKey.substring(0, 40),
            marker: marker,
            channelUrl: processingDraft.channelUrl?.substring(0, 40)
        });

        // Remove from processing map
        this.processingDrafts.delete(draftKey);
        if (processingDraft.timeoutTimer) {
            clearTimeout(processingDraft.timeoutTimer);
        }

        // Apply decision logic based on markers
        if (this.sendDetector.justSent) {
            // Marker: Message was sent → Permanent delete
            console.log('✉️ [DraftManager] Marker: Message sent → Deleting draft');
            await this.clearDraft(processingDraft.channelUrl, processingDraft.threadId);

        } else if (marker === 'manual_delete') {
            // Marker: User manually deleted from drafts panel → Already deleted
            console.log('🗑️ [DraftManager] Marker: Manual delete → Already deleted');

        } else if (this.isChangingChannel || processingDraft.channelUrl !== this.currentChannelUrl) {
            // Marker: Channel switched → Save as normal draft
            console.log('🔄 [DraftManager] Marker: Channel switched → Saving as normal draft');
            await this.saveDraftFromMemory(processingDraft.content);

        } else {
            // Default: Same channel + user deleted text
            // This includes idle marker (user stayed >1s in same channel without typing)
            // Check ADAS (Accidental Deletion Assistance) setting
            const adasEnabled = WVFavs.Settings?.get('adasEnabled') ?? true; // Default to true if not set

            if (adasEnabled) {
                // ADAS ON: Save with auto-delete (pending deletion with 60s countdown)
                console.log('🛡️ [DraftManager] ADAS ON: Saving with auto-delete (60s)', { marker });
                const pendingDeletion = Date.now() + 60000; // 60 seconds from now
                await this.saveDraftWithPendingDeletion(
                    processingDraft.channelUrl,
                    processingDraft.threadId,
                    processingDraft.content,
                    pendingDeletion
                );
            } else {
                // ADAS OFF: Permanent delete
                console.log('🚫 [DraftManager] ADAS OFF: Deleting draft permanently', { marker });
                await this.clearDraft(processingDraft.channelUrl, processingDraft.threadId);
            }
        }
    }

    /**
     * Get Lexical editor state from page context
     * Uses page-script.js to access React Fiber properties
     */
    async getLexicalEditorStateFromPageContext() {
        return new Promise((resolve) => {
            const requestId = `draft-get-state-${Date.now()}-${Math.random()}`;

            // Set up response listener
            const responseHandler = (event) => {
                if (event.detail.requestId === requestId) {
                    document.removeEventListener('wv-fav-api-response', responseHandler);
                    resolve(event.detail.data);
                }
            };

            document.addEventListener('wv-fav-api-response', responseHandler);

            // Send request to page context
            document.dispatchEvent(new CustomEvent('wv-fav-api-request', {
                detail: {
                    requestId,
                    action: 'getLexicalEditorState',
                    data: {}
                }
            }));

            // Timeout after 2 seconds
            setTimeout(() => {
                document.removeEventListener('wv-fav-api-response', responseHandler);
                resolve({ success: false, error: 'Timeout' });
            }, 2000);
        });
    }

    /**
     * Set Lexical editor state in page context
     * Uses page-script.js to access React Fiber properties
     */
    async setLexicalEditorStateInPageContext(editorState) {
        return new Promise((resolve) => {
            const requestId = `draft-set-state-${Date.now()}-${Math.random()}`;

            // Set up response listener
            const responseHandler = (event) => {
                if (event.detail.requestId === requestId) {
                    document.removeEventListener('wv-fav-api-response', responseHandler);
                    resolve(event.detail.data);
                }
            };

            document.addEventListener('wv-fav-api-response', responseHandler);

            // Send request to page context
            document.dispatchEvent(new CustomEvent('wv-fav-api-request', {
                detail: {
                    requestId,
                    action: 'setLexicalEditorState',
                    data: { editorState }
                }
            }));

            // Timeout after 2 seconds
            setTimeout(() => {
                document.removeEventListener('wv-fav-api-response', responseHandler);
                resolve({ success: false, error: 'Timeout' });
            }, 2000);
        });
    }

    /**
     * Save draft for current or specified channel and thread context
     */
    async saveDraft(channelUrl = null, threadId = undefined) {
        try {
            // Skip if we just sent a message (prevents saving cleared draft)
            if (this.sendDetector.justSent) {
                console.log('🚫 [DraftManager] Skipping draft save - message was just sent');
                return;
            }

            const targetChannel = channelUrl || this.currentChannelUrl;

            if (!targetChannel) {
                console.warn('⚠️ [DraftManager] Cannot save draft - waiting for wv-channel-changed event');
                this.logger.debug('   Current channel URL:', this.currentChannelUrl);
                this.logger.debug('   Provided channel URL:', channelUrl);
                return;
            }

            // Get editor state from page context
            const result = await this.getLexicalEditorStateFromPageContext();
            if (!result || !result.success) {
                this.logger.debug('⚠️ Cannot save draft - Lexical editor not found');
                return;
            }

            const { lexicalState, textContent, isThreadContext } = result;

            // IMPORTANT: Determine correct threadId based on which editor is focused
            // If threadId was explicitly provided, use it. Otherwise, detect from editor context.
            const targetThreadId = threadId !== undefined
                ? threadId
                : (isThreadContext ? this.currentThreadId : null);

            if (!textContent.trim()) {
                this.logger.debug('⏭️ Skipping save - draft is empty');
                // TWO-PHASE PROCESSING handles empty input in captureDraftToMemory()
                // Don't take any action here - let the processing system handle it
                return;
            }

            // Load all drafts
            const drafts = this.getAllDrafts();

            // Generate storage key based on context
            const draftKey = this.getDraftKey(targetChannel, targetThreadId);

            // For thread drafts, try to get the parent message timestamp
            let parentMessageCreatedAt = null;
            if (targetThreadId) {
                parentMessageCreatedAt = await this.getParentMessageTimestamp(targetThreadId);
            }

            // Save draft with metadata
            drafts[draftKey] = {
                lexicalState: lexicalState,
                textContent: textContent,
                timestamp: Date.now(),
                threadId: targetThreadId,
                parentMessageCreatedAt: parentMessageCreatedAt  // Store parent message timestamp
            };

            // Save to localStorage
            localStorage.setItem(this.config.storageKey, JSON.stringify(drafts));

            // Dispatch event for real-time panel updates
            document.dispatchEvent(new CustomEvent('wv-draft-updated'));

            // Update drafts button badge count
            this.updateDraftsButtonBadge();

            console.log('💾 [DraftManager] Draft saved to localStorage:', {
                key: draftKey.substring(0, 60) + (draftKey.length > 60 ? '...' : ''),
                context: isThreadContext ? 'thread' : 'main',
                threadId: targetThreadId ? targetThreadId.substring(0, 20) : 'null',
                textLength: textContent.length,
                preview: textContent.substring(0, 30),
                totalDrafts: Object.keys(drafts).length
            });

            this.logger.debug('✅ Draft saved:', {
                channel: targetChannel,
                textLength: textContent.length,
                preview: textContent.substring(0, 50)
            });

            // Analytics disabled per user request
            // Draft saved tracking removed
        } catch (error) {
            this.logger.error('❌ Error saving draft:', error);
        }
    }

    /**
     * Restore draft for specified channel and thread context
     */
    async restoreDraft(channelUrl, threadId = undefined) {
        try {
            // CRITICAL: Get FRESH thread ID from React if not specified
            let targetThreadId = threadId;
            if (targetThreadId === undefined) {
                // Check current thread state from React
                const threadState = await this.app.reactFiberNav.getCurrentThreadId();
                if (threadState.success) {
                    targetThreadId = threadState.threadId ? String(threadState.threadId) : null;
                    console.log('🔍 [DraftManager] Fresh thread ID for restore:', targetThreadId);
                } else {
                    targetThreadId = this.currentThreadId;
                    console.warn('⚠️ [DraftManager] Could not get fresh thread ID, using cached:', targetThreadId);
                }
            }

            if (!channelUrl) {
                this.logger.debug('⚠️ Cannot restore draft - no channel URL provided');
                return;
            }

            // CRITICAL: Strict channel matching - MUST match exactly
            if (channelUrl !== this.currentChannelUrl) {
                this.logger.warn('⚠️ Restore cancelled - channel mismatch:', {
                    requested: channelUrl.substring(0, 50),
                    current: this.currentChannelUrl?.substring(0, 50) || 'null'
                });
                return;
            }

            // No thread context validation - we trust the fresh thread ID from React

            // CRITICAL: Check if editor already has content
            const currentState = await this.getLexicalEditorStateFromPageContext();
            if (currentState && currentState.success && currentState.textContent && currentState.textContent.trim().length > 0) {
                this.logger.debug('⏭️ Restore cancelled - editor already has content:', {
                    textLength: currentState.textContent.length,
                    preview: currentState.textContent.substring(0, 30)
                });
                return;
            }

            // Get draft for this channel and context
            const drafts = this.getAllDrafts();
            const draftKey = this.getDraftKey(channelUrl, targetThreadId);
            const draft = drafts[draftKey];

            if (!draft || !draft.lexicalState) {
                this.logger.debug(`⏭️ No draft to restore for channel: ${channelUrl}`);
                this.logger.debug(`   Available drafts: ${Object.keys(drafts).length}`);
                return;
            }

            // ACCIDENTAL DELETE ASSISTANCE: Skip auto-restore for drafts with pending deletion
            // User must manually restore these from Drafts panel
            if (draft.pendingDeletion) {
                const remainingSeconds = Math.ceil((draft.pendingDeletion - Date.now()) / 1000);
                console.log('⏭️ [DraftManager] Skipping auto-restore for draft with pending deletion:', {
                    channel: channelUrl.substring(0, 40),
                    deletesIn: `${remainingSeconds}s`,
                    preview: draft.textContent?.substring(0, 30)
                });
                this.logger.debug('⏭️ Draft has pending deletion - not auto-restoring');
                return;
            }

            this.logger.debug('📂 Restoring draft:', {
                channel: channelUrl.substring(0, 50),
                threadId: targetThreadId || 'main',
                textPreview: draft.textContent.substring(0, 30),
                currentChannel: this.currentChannelUrl?.substring(0, 50)
            });

            // Set flag to prevent input events from triggering during restore
            this.isRestoringDraft = true;

            // Set editor state via page context
            const result = await this.setLexicalEditorStateInPageContext(draft.lexicalState);
            if (!result.success) {
                this.logger.debug('⚠️ Cannot restore draft - Lexical editor not found');
                this.isRestoringDraft = false;
                return;
            }

            // Keep flag set for a brief moment to ignore any delayed input events
            setTimeout(async () => {
                this.isRestoringDraft = false;

                // CRITICAL: Capture the restored draft to memory
                // This ensures if user switches channels/threads without typing,
                // the restored content is still saved
                await this.captureDraftToMemory();
                console.log('📸 [DraftManager] Captured restored draft to memory');
            }, 150);

            console.log('📥 [DraftManager] Draft restored successfully:', {
                channel: channelUrl.substring(0, 40) + '...',
                thread: targetThreadId ? targetThreadId.substring(0, 20) : 'main chat',
                textLength: draft.textContent.length,
                preview: draft.textContent.substring(0, 30),
                ageSeconds: Math.round((Date.now() - draft.timestamp) / 1000)
            });

            this.logger.info('✅ Draft restored:', {
                channel: channelUrl,
                textLength: draft.textContent.length,
                preview: draft.textContent.substring(0, 50),
                age: Date.now() - draft.timestamp
            });

            // Track restore
            if (this.logger.analytics) {
                this.logger.analytics('draft_restored', {
                    text_length: draft.textContent.length,
                    age_ms: Date.now() - draft.timestamp
                });
            }
        } catch (error) {
            console.error('❌ [DraftManager] Error restoring draft:', error);
            this.logger.error('❌ Error restoring draft:', error);
            this.isRestoringDraft = false;
        }
    }

    /**
     * Clear draft for specified channel and thread context
     */
    clearDraft(channelUrl, threadId = undefined) {
        try {
            const targetThreadId = threadId === undefined ? this.currentThreadId : threadId;

            if (!channelUrl) {
                this.logger.debug('⚠️ No channel URL to clear draft for');
                return;
            }

            const draftKey = this.getDraftKey(channelUrl, targetThreadId);

            // TWO-PHASE PROCESSING: Check if this draft is in processing state
            // If yes, finalize it with 'manual_delete' marker
            const processingDraft = this.processingDrafts.get(draftKey);
            if (processingDraft) {
                console.log('🗑️ [DraftManager] Manual delete detected - finalizing processing draft');
                this.finalizeDraft(draftKey, 'manual_delete');
                return;
            }

            const drafts = this.getAllDrafts();
            
            if (drafts[draftKey]) {
                delete drafts[draftKey];
                localStorage.setItem(this.config.storageKey, JSON.stringify(drafts));

                // Dispatch event for real-time panel updates
                document.dispatchEvent(new CustomEvent('wv-draft-updated'));

                // Update drafts button badge count
                this.updateDraftsButtonBadge();

                console.log('🗑️ [DraftManager] Draft cleared:', {
                    channel: channelUrl.substring(0, 40),
                    thread: targetThreadId ? targetThreadId.substring(0, 20) : 'main'
                });
                this.logger.debug('🗑️ Draft cleared for channel and thread:', channelUrl, targetThreadId);

                // Analytics disabled per user request
                // Draft cleared tracking removed
            }
        } catch (error) {
            this.logger.error('❌ Error clearing draft:', error);
        }
    }

    /**
     * Get all drafts from localStorage
     */
    getAllDrafts() {
        try {
            const data = localStorage.getItem(this.config.storageKey);
            return data ? JSON.parse(data) : {};
        } catch (error) {
            this.logger.error('❌ Error loading drafts from localStorage:', error);
            return {};
        }
    }

    /**
     * Get draft for specific channel and thread context (for debugging)
     */
    getDraft(channelUrl, threadId = null) {
        const drafts = this.getAllDrafts();
        const draftKey = this.getDraftKey(channelUrl, threadId);
        return drafts[draftKey] || null;
    }

    /**
     * Get parent message timestamp (for thread drafts)
     * This helps navigateToMention load the correct message history
     * Uses React Fiber tree for reliable instant access to message data
     */
    async getParentMessageTimestamp(messageId) {
        try {
            // PRIMARY METHOD: Use ReactFiberNavigator to get message data from React tree (most reliable!)
            if (this.app.reactFiberNav && this.currentChannelUrl) {
                const result = await this.app.reactFiberNav.getMessageData(this.currentChannelUrl, messageId);

                if (result.success && result.message && result.message.createdAt) {
                    console.log(`✅ [DraftManager] Found parent message timestamp from React tree: ${result.message.createdAt}`);
                    return result.message.createdAt;
                }
            }

            // FALLBACK 1: Try ThreadManager cache
            if (this.app.threadManager && this.currentChannelUrl) {
                const messageCache = this.app.threadManager.getMessageCache(this.currentChannelUrl);
                if (messageCache) {
                    const message = messageCache.get(messageId);

                    if (message && message.created_at) {
                        console.log(`✅ [DraftManager] Found parent message timestamp from ThreadManager cache: ${message.created_at}`);
                        return message.created_at;
                    }
                }
            }

            // FALLBACK 2: Try to find the parent message in the DOM
            const messageElement = document.querySelector(`[id*="message-${messageId}"], [data-message-id="${messageId}"]`);

            if (messageElement) {
                // Try to get timestamp from data attribute
                const timestamp = messageElement.getAttribute('data-created-at') ||
                                messageElement.getAttribute('data-timestamp');

                if (timestamp) {
                    console.log(`✅ [DraftManager] Found parent message timestamp from DOM: ${timestamp}`);
                    return parseInt(timestamp, 10);
                }
            }

            // FALLBACK 3: Try to get from thread panel header
            const threadPanel = document.querySelector('[data-testid="thread-message-section"]');
            if (threadPanel) {
                // Look for the first message in thread panel (parent message)
                const firstMessage = threadPanel.querySelector('[id*="message-"]');
                if (firstMessage) {
                    const timestamp = firstMessage.getAttribute('data-created-at') ||
                                    firstMessage.getAttribute('data-timestamp');
                    if (timestamp) {
                        console.log(`✅ [DraftManager] Found parent message timestamp from thread panel: ${timestamp}`);
                        return parseInt(timestamp, 10);
                    }
                }
            }

            console.warn(`⚠️ [DraftManager] Could not find timestamp for parent message: ${messageId}`);
            return null;
        } catch (error) {
            console.error('❌ [DraftManager] Error getting parent message timestamp:', error);
            return null;
        }
    }

    /**
     * Update the drafts button badge with current draft count
     */
    updateDraftsButtonBadge() {
        try {
            const drafts = this.getAllDrafts();
            const count = Object.keys(drafts).length;

            // Call DomManager to update the UI badge
            if (this.app.domManager && this.app.domManager.updateDraftsButtonBadge) {
                this.app.domManager.updateDraftsButtonBadge(count);
            }

            this.logger.debug('📝 Drafts badge updated:', count);
        } catch (error) {
            this.logger.error('❌ Error updating drafts badge:', error);
        }
    }

    /**
     * Clear all drafts (for debugging)
     */
    clearAllDrafts() {
        try {
            localStorage.removeItem(this.config.storageKey);
            this.logger.info('🗑️ All drafts cleared');
        } catch (error) {
            this.logger.error('❌ Error clearing all drafts:', error);
        }
    }

    /**
     * Get stats for debugging
     */
    getStats() {
        const drafts = this.getAllDrafts();
        return {
            currentChannel: this.currentChannelUrl,
            currentThreadId: this.currentThreadId,
            context: this.currentThreadId ? 'thread' : 'main chat',
            totalDrafts: Object.keys(drafts).length,
            drafts: Object.keys(drafts).map(draftKey => {
                const draft = drafts[draftKey];
                const isThread = draftKey.includes('::thread::');
                return {
                    key: draftKey,
                    isThread: isThread,
                    textLength: draft.textContent?.length || 0,
                    preview: draft.textContent?.substring(0, 50) || '',
                    age: Date.now() - (draft.timestamp || 0)
                };
            })
        };
    }

    /**
     * Test editor access (for debugging)
     */
    async testEditorAccess() {
        this.logger.info('🧪 Testing editor access...');
        const result = await this.getLexicalEditorStateFromPageContext();
        if (result && result.success) {
            this.logger.info('✅ Editor access successful:', {
                textLength: result.textContent?.length || 0,
                preview: result.textContent?.substring(0, 50) || ''
            });
        } else {
            this.logger.error('❌ Editor access failed:', result?.error || 'Unknown error');
        }
        return result;
    }


    /**
     * Cleanup
     */
    destroy() {
        // Clear all timers
        if (this.saveDebounceTimer) {
            clearTimeout(this.saveDebounceTimer);
            this.saveDebounceTimer = null;
        }

        if (this.restoreDebounceTimer) {
            clearTimeout(this.restoreDebounceTimer);
            this.restoreDebounceTimer = null;
        }

        // Clear editor check interval
        if (this.editorCheckInterval) {
            clearInterval(this.editorCheckInterval);
            this.editorCheckInterval = null;
        }

        // Clear pending deletion cleanup interval
        if (this.pendingDeletionCleanupInterval) {
            clearInterval(this.pendingDeletionCleanupInterval);
            this.pendingDeletionCleanupInterval = null;
        }

        // Clear idle check interval
        if (this.idleCheckInterval) {
            clearInterval(this.idleCheckInterval);
            this.idleCheckInterval = null;
        }

        // Clear all processing draft timers
        this.processingDrafts.forEach((draft, key) => {
            if (draft.timeoutTimer) {
                clearTimeout(draft.timeoutTimer);
            }
        });
        this.processingDrafts.clear();

        // Cleanup send detector
        this.disarmSendDetector();

        // Disconnect all MutationObservers
        const selectors = [
            'div[contenteditable="true"][role="textbox"]',
            'div[contenteditable="true"][placeholder*="message"]'
        ];
        selectors.forEach(selector => {
            document.querySelectorAll(selector).forEach(editor => {
                if (editor._draftObserver) {
                    editor._draftObserver.disconnect();
                    delete editor._draftObserver;
                }
            });
        });

        // Reset flags
        this.isRestoringDraft = false;

        this.logger.info('🧹 DraftManager destroyed');
    }
};

// Expose for debugging
if (typeof window !== 'undefined') {
    window.wvDraftManager = null; // Will be set when initialized
}
