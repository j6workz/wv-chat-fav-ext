/**
 * PollManager - Handles creating and managing polls via Sendbird API
 * Integrates with Sendbird Platform API v3
 */

var WVFavs = WVFavs || {};

WVFavs.PollManager = class PollManager {
    constructor(app) {
        this.app = app;
        this.polls = new Map(); // pollId -> poll object
        this.isInitialized = false;
    }

    /**
     * Initialize the manager
     */
    async init() {
        this.app?.logger?.log('📊 PollManager: Initializing...');

        // Get current user
        if (this.app.userIdentity) {
            const user = await this.app.userIdentity.getCurrentUser();
            if (user) {
                this.currentUserId = user.id;
                this.app?.logger?.log('📊 Current user ID for polls:', this.currentUserId);
            }
        }

        // Setup poll event listeners
        this.setupEventListeners();

        this.isInitialized = true;
        this.app?.logger?.log('✅ PollManager: Initialized');
    }

    /**
     * Setup event listeners for poll updates
     */
    setupEventListeners() {
        // Listen for poll created events
        window.addEventListener('wv-poll-created', (event) => {
            const { pollId, poll } = event.detail;
            this.polls.set(pollId, poll);
            this.app?.logger?.log('📊 Poll created:', pollId);
        });

        // Listen for poll voted events
        window.addEventListener('wv-poll-voted', (event) => {
            const { pollId, poll } = event.detail;
            this.polls.set(pollId, poll);
            this.app?.logger?.log('📊 Poll voted:', pollId);
        });

        // Listen for poll closed events
        window.addEventListener('wv-poll-closed', (event) => {
            const { pollId } = event.detail;
            this.app?.logger?.log('📊 Poll closed:', pollId);
        });
    }

    /**
     * Create a poll
     * @param {string} title - Poll question/title
     * @param {Array<string>} optionTexts - Array of option strings
     * @param {Object} settings - Poll settings
     * @returns {Promise<Object>} Created poll object
     */
    async createPoll(title, optionTexts, settings = {}) {
        if (!this.isInitialized) {
            throw new Error('PollManager not initialized');
        }

        // Validate inputs
        if (!title || typeof title !== 'string' || title.trim().length === 0) {
            throw new Error('Poll title is required');
        }

        if (!Array.isArray(optionTexts) || optionTexts.length < 2) {
            throw new Error('At least 2 poll options are required');
        }

        if (optionTexts.length > 100) {
            throw new Error('Maximum 100 poll options allowed');
        }

        // Validate option texts
        for (const option of optionTexts) {
            if (!option || typeof option !== 'string' || option.trim().length === 0) {
                throw new Error('All poll options must be non-empty strings');
            }
        }

        // Get current user
        if (!this.currentUserId) {
            const user = await this.app.userIdentity?.getCurrentUser();
            if (user) {
                this.currentUserId = user.id;
            } else {
                throw new Error('Cannot create poll: User ID not available');
            }
        }

        // Extract Sendbird App ID
        const sendbirdAppId = await this.extractSendbirdAppId();
        if (!sendbirdAppId) {
            throw new Error('Cannot extract Sendbird App ID');
        }

        // Build poll creation request
        const url = `https://api-${sendbirdAppId}.sendbird.com/v3/polls`;

        // Sendbird expects "options" array with objects containing "text" field
        const payload = {
            title: title.trim(),
            options: optionTexts.map(opt => ({ text: opt.trim() })),
            allow_user_suggestion: settings.allowUserSuggestion || false,
            allow_multiple_votes: settings.allowMultipleVotes || false,
            close_at: settings.closeAt || -1, // -1 = never closes
            created_by: this.currentUserId,
            data: settings.data || {}
        };

        this.app?.logger?.log('📊 Creating poll:', {
            title,
            optionsCount: optionTexts.length,
            settings
        });

        try {
            const response = await this.makePollAPIRequest(url, 'POST', payload);

            if (response && response.id) {
                // Store poll locally
                this.polls.set(response.id, response);

                // Dispatch poll created event
                window.dispatchEvent(new CustomEvent('wv-poll-created', {
                    detail: { pollId: response.id, poll: response }
                }));

                this.app?.logger?.log('✅ Poll created successfully:', response.id);
                return response;
            } else {
                throw new Error('Invalid poll creation response');
            }
        } catch (error) {
            this.app?.logger?.log('❌ Error creating poll:', error);
            throw error;
        }
    }

    /**
     * Send a poll as a message to a channel
     * @param {string} channelUrl - Channel URL to send poll to
     * @param {number} pollId - ID of the poll to send
     * @param {string} message - Optional message text (defaults to poll title)
     * @returns {Promise<Object>} Message object
     */
    async sendPollMessage(channelUrl, pollId, message = null) {
        if (!this.isInitialized) {
            throw new Error('PollManager not initialized');
        }

        if (!channelUrl) {
            throw new Error('Channel URL is required');
        }

        if (!pollId) {
            throw new Error('Poll ID is required');
        }

        // Get current user
        if (!this.currentUserId) {
            const user = await this.app.userIdentity?.getCurrentUser();
            if (user) {
                this.currentUserId = user.id;
            } else {
                throw new Error('Cannot send poll: User ID not available');
            }
        }

        // Get poll to extract title if message not provided
        const poll = this.polls.get(pollId);
        if (!message && poll) {
            message = `📊 Poll: ${poll.title}`;
        } else if (!message) {
            message = '📊 New Poll';
        }

        // Extract Sendbird App ID
        const sendbirdAppId = await this.extractSendbirdAppId();
        if (!sendbirdAppId) {
            throw new Error('Cannot extract Sendbird App ID');
        }

        // Build send message request
        const url = `https://api-${sendbirdAppId}.sendbird.com/v3/group_channels/${encodeURIComponent(channelUrl)}/messages`;

        const payload = {
            message_type: 'MESG',
            user_id: this.currentUserId,
            message: message,
            poll_id: pollId
        };

        this.app?.logger?.log('📊 Sending poll message:', {
            channelUrl,
            pollId,
            message
        });

        try {
            const response = await this.makePollAPIRequest(url, 'POST', payload);

            if (response && response.message_id) {
                this.app?.logger?.log('✅ Poll message sent successfully:', response.message_id);
                return response;
            } else {
                throw new Error('Invalid send message response');
            }
        } catch (error) {
            this.app?.logger?.log('❌ Error sending poll message:', error);
            throw error;
        }
    }

    /**
     * Vote on a poll
     * @param {number} pollId - Poll ID to vote on
     * @param {Array<number>} optionIds - Array of option IDs to vote for
     * @returns {Promise<Object>} Updated poll object
     */
    async votePoll(pollId, optionIds) {
        if (!this.isInitialized) {
            throw new Error('PollManager not initialized');
        }

        if (!pollId) {
            throw new Error('Poll ID is required');
        }

        if (!Array.isArray(optionIds) || optionIds.length === 0) {
            throw new Error('At least one option ID is required');
        }

        // Get current user
        if (!this.currentUserId) {
            const user = await this.app.userIdentity?.getCurrentUser();
            if (user) {
                this.currentUserId = user.id;
            } else {
                throw new Error('Cannot vote on poll: User ID not available');
            }
        }

        // Extract Sendbird App ID
        const sendbirdAppId = await this.extractSendbirdAppId();
        if (!sendbirdAppId) {
            throw new Error('Cannot extract Sendbird App ID');
        }

        // Build vote request
        const url = `https://api-${sendbirdAppId}.sendbird.com/v3/polls/${pollId}/vote`;

        const payload = {
            user_id: this.currentUserId,
            option_ids: optionIds
        };

        this.app?.logger?.log('📊 Voting on poll:', {
            pollId,
            optionIds
        });

        try {
            const response = await this.makePollAPIRequest(url, 'PUT', payload);

            if (response && response.id) {
                // Update stored poll
                this.polls.set(pollId, response);

                // Dispatch poll voted event
                window.dispatchEvent(new CustomEvent('wv-poll-voted', {
                    detail: { pollId, optionIds, poll: response }
                }));

                this.app?.logger?.log('✅ Voted on poll successfully:', pollId);
                return response;
            } else {
                throw new Error('Invalid vote response');
            }
        } catch (error) {
            this.app?.logger?.log('❌ Error voting on poll:', error);
            throw error;
        }
    }

    /**
     * Get poll details
     * @param {number} pollId - Poll ID to fetch
     * @param {boolean} includeVoters - Include voter details
     * @returns {Promise<Object>} Poll object
     */
    async getPoll(pollId, includeVoters = false) {
        if (!this.isInitialized) {
            throw new Error('PollManager not initialized');
        }

        if (!pollId) {
            throw new Error('Poll ID is required');
        }

        // Extract Sendbird App ID
        const sendbirdAppId = await this.extractSendbirdAppId();
        if (!sendbirdAppId) {
            throw new Error('Cannot extract Sendbird App ID');
        }

        // Build get poll request
        let url = `https://api-${sendbirdAppId}.sendbird.com/v3/polls/${pollId}`;
        if (includeVoters) {
            url += '?include_voters=true';
        }

        this.app?.logger?.log('📊 Fetching poll:', pollId);

        try {
            const response = await this.makePollAPIRequest(url, 'GET');

            if (response && response.id) {
                // Update stored poll
                this.polls.set(pollId, response);

                this.app?.logger?.log('✅ Fetched poll successfully:', pollId);
                return response;
            } else {
                throw new Error('Invalid get poll response');
            }
        } catch (error) {
            this.app?.logger?.log('❌ Error fetching poll:', error);
            throw error;
        }
    }

    /**
     * Close a poll
     * @param {number} pollId - Poll ID to close
     * @returns {Promise<Object>} Updated poll object
     */
    async closePoll(pollId) {
        if (!this.isInitialized) {
            throw new Error('PollManager not initialized');
        }

        if (!pollId) {
            throw new Error('Poll ID is required');
        }

        // Get current user
        if (!this.currentUserId) {
            const user = await this.app.userIdentity?.getCurrentUser();
            if (user) {
                this.currentUserId = user.id;
            } else {
                throw new Error('Cannot close poll: User ID not available');
            }
        }

        // Extract Sendbird App ID
        const sendbirdAppId = await this.extractSendbirdAppId();
        if (!sendbirdAppId) {
            throw new Error('Cannot extract Sendbird App ID');
        }

        // Build close poll request
        const url = `https://api-${sendbirdAppId}.sendbird.com/v3/polls/${pollId}/close`;

        const payload = {
            user_id: this.currentUserId
        };

        this.app?.logger?.log('📊 Closing poll:', pollId);

        try {
            const response = await this.makePollAPIRequest(url, 'PUT', payload);

            if (response && response.id) {
                // Update stored poll
                this.polls.set(pollId, response);

                // Dispatch poll closed event
                window.dispatchEvent(new CustomEvent('wv-poll-closed', {
                    detail: { pollId }
                }));

                this.app?.logger?.log('✅ Poll closed successfully:', pollId);
                return response;
            } else {
                throw new Error('Invalid close poll response');
            }
        } catch (error) {
            this.app?.logger?.log('❌ Error closing poll:', error);
            throw error;
        }
    }

    /**
     * Add a poll option (if allow_user_suggestion enabled)
     * @param {number} pollId - Poll ID to add option to
     * @param {string} optionText - New option text
     * @returns {Promise<Object>} Updated poll object
     */
    async addPollOption(pollId, optionText) {
        if (!this.isInitialized) {
            throw new Error('PollManager not initialized');
        }

        if (!pollId) {
            throw new Error('Poll ID is required');
        }

        if (!optionText || typeof optionText !== 'string' || optionText.trim().length === 0) {
            throw new Error('Option text is required');
        }

        // Get current user
        if (!this.currentUserId) {
            const user = await this.app.userIdentity?.getCurrentUser();
            if (user) {
                this.currentUserId = user.id;
            } else {
                throw new Error('Cannot add poll option: User ID not available');
            }
        }

        // Extract Sendbird App ID
        const sendbirdAppId = await this.extractSendbirdAppId();
        if (!sendbirdAppId) {
            throw new Error('Cannot extract Sendbird App ID');
        }

        // Build add option request
        const url = `https://api-${sendbirdAppId}.sendbird.com/v3/polls/${pollId}/options`;

        const payload = {
            text: optionText.trim(),
            created_by: this.currentUserId
        };

        this.app?.logger?.log('📊 Adding poll option:', {
            pollId,
            optionText
        });

        try {
            const response = await this.makePollAPIRequest(url, 'POST', payload);

            if (response) {
                this.app?.logger?.log('✅ Poll option added successfully');

                // Refresh poll to get updated options
                return await this.getPoll(pollId);
            } else {
                throw new Error('Invalid add option response');
            }
        } catch (error) {
            this.app?.logger?.log('❌ Error adding poll option:', error);
            throw error;
        }
    }

    /**
     * Make a poll API request via page script
     * @param {string} url - API URL
     * @param {string} method - HTTP method
     * @param {Object} payload - Request payload (optional for GET)
     * @returns {Promise<Object>} API response
     */
    async makePollAPIRequest(url, method, payload = null) {
        const requestId = `poll-${Date.now()}-${Math.random()}`;

        // Create promise to wait for response
        const responsePromise = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Poll API request timeout'));
            }, 30000); // 30 second timeout

            const handleResponse = (event) => {
                if (event.detail.requestId === requestId) {
                    clearTimeout(timeout);
                    document.removeEventListener('wv-fav-api-response', handleResponse);

                    if (event.detail.success) {
                        resolve(event.detail.data);
                    } else {
                        reject(new Error(event.detail.error || 'Unknown error'));
                    }
                }
            };

            document.addEventListener('wv-fav-api-response', handleResponse);
        });

        // Dispatch request to page script
        const action = method === 'GET' ? 'getPollAPI' :
                       method === 'POST' && url.includes('/messages') ? 'sendPollMessageAPI' :
                       method === 'POST' ? 'createPollAPI' :
                       method === 'PUT' && url.includes('/vote') ? 'votePollAPI' :
                       method === 'PUT' && url.includes('/close') ? 'closePollAPI' :
                       'pollAPI';

        const requestData = {
            url,
            method
        };

        if (payload) {
            requestData.body = JSON.stringify(payload);
        }

        document.dispatchEvent(new CustomEvent('wv-fav-api-request', {
            detail: {
                requestId,
                action,
                data: requestData
            }
        }));

        return await responsePromise;
    }

    /**
     * Extract Sendbird App ID from page or previous API calls
     * This requests the App ID from page context via event dispatch
     * @returns {Promise<string|null>} Sendbird App ID
     */
    async extractSendbirdAppId() {
        const requestId = `extract-app-id-${Date.now()}`;

        // Create promise to wait for response
        const responsePromise = new Promise((resolve) => {
            const timeout = setTimeout(() => {
                resolve(null); // Timeout - return null
            }, 1000); // 1 second timeout for extraction

            const handleResponse = (event) => {
                if (event.detail.requestId === requestId) {
                    clearTimeout(timeout);
                    document.removeEventListener('wv-fav-appid-response', handleResponse);
                    resolve(event.detail.appId);
                }
            };

            document.addEventListener('wv-fav-appid-response', handleResponse);
        });

        // Dispatch request to page script
        document.dispatchEvent(new CustomEvent('wv-fav-appid-request', {
            detail: { requestId }
        }));

        const appId = await responsePromise;

        if (!appId) {
            this.app?.logger?.warn('⚠️ Could not extract Sendbird App ID. Try sending a message first to initialize Sendbird.');
        } else {
            this.app?.logger?.log('📊 Extracted Sendbird App ID:', appId);
        }

        return appId;
    }

    /**
     * Get current channel URL from ThreadManager
     * @returns {string|null} Current channel URL
     */
    getCurrentChannel() {
        if (this.app.threadManager) {
            return this.app.threadManager.getCurrentChannel();
        }
        return null;
    }

    /**
     * Create a poll and send it to current channel
     * @param {string} title - Poll title
     * @param {Array<string>} optionTexts - Poll options
     * @param {Object} settings - Poll settings
     * @returns {Promise<Object>} Object with poll and message
     */
    async createAndSendPoll(title, optionTexts, settings = {}) {
        // Get current channel
        const channelUrl = this.getCurrentChannel();
        if (!channelUrl) {
            throw new Error('No channel selected. Please open a chat first.');
        }

        this.app?.logger?.log('📊 Creating and sending poll to channel:', channelUrl);

        try {
            // Step 1: Create poll
            const poll = await this.createPoll(title, optionTexts, settings);

            // Step 2: Send poll message to channel
            const message = await this.sendPollMessage(channelUrl, poll.id);

            this.app?.logger?.log('✅ Poll created and sent successfully');

            return {
                poll,
                message
            };
        } catch (error) {
            this.app?.logger?.log('❌ Error creating and sending poll:', error);
            throw error;
        }
    }

    /**
     * Get all cached polls
     * @returns {Array<Object>} Array of poll objects
     */
    getAllPolls() {
        return Array.from(this.polls.values());
    }

    /**
     * Clear all cached polls
     */
    clearPolls() {
        this.polls.clear();
        this.app?.logger?.log('📊 Cleared all cached polls');
    }
};

// Export to global namespace
if (typeof window !== 'undefined') {
    window.WVFavs = window.WVFavs || {};
    window.WVFavs.PollManager = WVFavs.PollManager;
}
