var WVFavs = WVFavs || {};

WVFavs.Helpers = {
    debugEnabled: false, // Debug logging flag

    snakeCase(text) {
        return text.replace(/\s+/g, '');
    },

    getDisplayName(chatData) {
        return chatData.nickname || chatData.name;
    },

    cleanChatName(fullText) {
        // Take the first line only
        let cleaned = fullText.split('\n')[0];

        // Store original for context analysis
        const original = cleaned;

        // Remove notification indicators and badges first
        cleaned = cleaned
            .replace(/@me/gi, '') // Remove @me indicators
            .replace(/@here/gi, '') // Remove @here indicators
            .replace(/@\w+/g, '') // Remove other @ mentions
            .replace(/^\d+/, '') // Remove leading numbers
            .trim();

        // Only remove trailing numbers if they were clearly notification counts
        // Be very conservative - only remove if we're absolutely sure it's a notification count
        if (original.match(/@\w+\d+$/)) {
            // Pattern like "@me4" or "@here2" - the number is directly attached to the indicator
            cleaned = cleaned.replace(/\d{1,2}$/, '');
            if (this.debugEnabled) {
                console.log('🧹 Removed notification count from attached indicator:', original, '→', cleaned);
            }
        } else if (original.includes('@me') || original.includes('@here')) {
            // Be extra careful - only remove single digit notification counts that are clearly separate
            // and ONLY if there's no space before the number (indicating it's likely a notification count)

            // Check the raw structure after removing indicators
            const afterIndicatorRemoval = original
                .replace(/@me/gi, '')
                .replace(/@here/gi, '')
                .replace(/@\w+/g, '');

            // Only remove if it ends with a single digit without space (like "ChatName1")
            // Do NOT remove if it has space (like "Chat Name 2" - legitimate part of name)
            if (afterIndicatorRemoval.match(/\w\d$/) && !afterIndicatorRemoval.includes(' ')) {
                cleaned = cleaned.replace(/\d$/, '');
                if (this.debugEnabled) {
                    console.log('🧹 Removed single notification digit:', original, '→', cleaned);
                }
            } else {
                if (this.debugEnabled) {
                    console.log('✅ Preserved legitimate number in chat name:', original);
                }
            }
        }

        // Clean up multiple spaces
        return cleaned.replace(/\s+/g, ' ').trim();
    },

    generateChatId(element) {
        // First check for real IDs if available
        if (element && element.dataset && element.dataset.channelUrl) {
            return element.dataset.channelUrl;
        }

        const sendbirdChannel = element ? element.getAttribute('data-sendbird-channel') : null;
        if (sendbirdChannel) {
            return sendbirdChannel;
        }

        // Use clean chat name as ID (instead of hash)
        const fullText = element ? element.textContent.trim() : '';
        const cleanName = this.cleanChatName(fullText);

        return `name_${cleanName.replace(/\s+/g, '')}`;
    },

    /**
     * Check if an ID is a Sendbird channel URL format
     * @param {string} id - The ID to check
     * @returns {boolean} - True if ID is Sendbird channel URL
     */
    isSendbirdChannelUrl(id) {
        return id && typeof id === 'string' && id.startsWith('sendbird_group_channel_');
    },

    /**
     * Extract distinct channel (1:1 DM) from channels array
     * @param {Array} channels - Array of channel objects
     * @returns {Object|null} - The distinct channel or null
     */
    extractDistinctChannel(channels) {
        if (!channels || !Array.isArray(channels)) return null;
        return channels.find(ch => ch.is_distinct === true);
    }
};
