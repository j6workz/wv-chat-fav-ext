var WVFavs = WVFavs || {};

WVFavs.DomDataExtractor = new (class DomDataExtractor {
    init(app) {
        this.app = app;
    }

    extractChatInfo(chatHeader) {
        const sidebarInfo = this.extractActiveSidebarChatInfo();
        const headerChatName = this.extractChatNameFromHeader(chatHeader);
        const chatName = sidebarInfo.name || headerChatName;
        const chatId = sidebarInfo.id || this.generateChatIdFromContext(chatName, chatHeader);
        const userId = sidebarInfo.userId || null;
        const avatarElement = chatHeader.querySelector('[data-testid="channel-avatar-image"]');
        const avatarData = avatarElement ? this.extractAvatarData(avatarElement) : { type: 'character', content: '?', text: '?' };
        // Navigation field removed - it was extracting from currently active chat instead of clicked chat
        // causing data corruption. WorkVivo is a React SPA, navigation works via name-based matching.
        const verificationInfo = {
            source: sidebarInfo.name ? 'sidebar' : 'header',
            sidebarName: sidebarInfo.name,
            headerName: headerChatName,
            isConsistent: this.chatNamesMatch(headerChatName, sidebarInfo.name)
        };
        return { id: chatId, name: chatName, userId: userId, avatar: avatarData, _verification: verificationInfo };
    }

    extractActiveSidebarChatInfo() {
        // Look for the active chat button - it has primary background and text colors
        const activeButton = document.querySelector('button.tw-bg-primary-50.tw-text-primary-600');
        if (activeButton) {
            const sidebarChatName = this.extractChatNameFromSidebar(activeButton);
            const sidebarChatId = this.generateChatId(activeButton);
            const userId = activeButton.dataset.userId || null;
            return { name: sidebarChatName, id: sidebarChatId, userId: userId, element: activeButton };
        }

        // Fallback: look for any button with primary styling variations
        const fallbackSelectors = [
            'button[class*="tw-bg-primary"]',
            'button[class*="tw-text-primary"]',
            'div[data-testid="channel-list"] button:not([class*="hover"])'
        ];

        for (const selector of fallbackSelectors) {
            const button = document.querySelector(selector);
            if (button) {
                const sidebarChatName = this.extractChatNameFromSidebar(button);
                if (sidebarChatName && sidebarChatName !== 'Unknown Chat') {
                    const sidebarChatId = this.generateChatId(button);
                    const userId = button.dataset.userId || null;
                    return { name: sidebarChatName, id: sidebarChatId, userId: userId, element: button };
                }
            }
        }

        return { name: null, id: null, userId: null, element: null };
    }

    extractChatNameFromSidebar(sidebarButton) {
        // Primary method: Target the specific chat name span
        // This span contains ONLY the clean chat name, no notifications
        const chatNameSpan = sidebarButton.querySelector('span.tw-mr-1.tw-truncate');
        if (chatNameSpan && chatNameSpan.textContent.trim()) {
            this.app?.logger?.log('✅ Found clean chat name via selector:', chatNameSpan.textContent.trim());
            return chatNameSpan.textContent.trim();
        }

        // Try alternative selectors
        const altSelectors = [
            'span.tw-truncate',
            '.chat-name',
            '[data-chat-name]'
        ];

        for (const selector of altSelectors) {
            const element = sidebarButton.querySelector(selector);
            if (element && element.textContent.trim()) {
                this.app?.logger?.log('✅ Found chat name via alt selector', selector + ':', element.textContent.trim());
                return element.textContent.trim();
            }
        }

        this.app?.logger?.log('⚠️ DOM selector failed, falling back to text cleaning for:', sidebarButton.textContent.trim());
        // Fallback: If the primary selector fails, use text cleaning as last resort
        return WVFavs.Helpers.cleanChatName(sidebarButton.textContent.trim());
    }

    extractChatNameFromHeader(chatHeader) {
        let chatNameElement = chatHeader.querySelector('p.tw-mr-4.tw-truncate');
        if (chatNameElement && chatNameElement.textContent.trim()) {
            return chatNameElement.textContent.trim();
        }
        const alternativeSelectors = ['h1', 'h2', 'h3', '[data-testid*="chat-title"]', '[data-testid*="channel-title"]', '.tw-font-semibold', '.tw-font-bold', 'p:first-of-type', '[title]'];
        for (const selector of alternativeSelectors) {
            chatNameElement = chatHeader.querySelector(selector);
            if (chatNameElement && chatNameElement.textContent.trim()) {
                const text = chatNameElement.textContent.trim();
                if (text.length > 2 && !text.includes('•') && !text.match(/^\d+$/)) {
                    return text;
                }
            }
        }
        const currentUrl = window.location.href;
        const urlMatch = currentUrl.match(/\/chat\/([^\/\?]+)/);
        if (urlMatch && urlMatch[1]) {
            try {
                const decodedName = decodeURIComponent(urlMatch[1]);
                if (decodedName && decodedName.length > 2) {
                    return decodedName.replace(/_/g, ' ').replace(/-/g, ' ');
                }
            } catch (error) {
                // Failed to decode URL chat name
            }
        }
        const allTextElements = chatHeader.querySelectorAll('p, span, div');
        for (const element of allTextElements) {
            const text = element.textContent.trim();
            if (text.length > 2 && text.length < 100 && !text.includes('•') && !text.match(/^\d+$/) && !text.toLowerCase().includes('online') && !text.toLowerCase().includes('offline')) {
                return text;
            }
        }
        const pageTitle = document.title;
        if (pageTitle && !pageTitle.includes('WorkVivo') && pageTitle.length > 2) {
            const titleParts = pageTitle.split(' - ');
            if (titleParts.length > 0 && titleParts[0].trim()) {
                return titleParts[0].trim();
            }
        }
        // Could not extract chat name from header, falling back to Unknown Chat
        return 'Unknown Chat';
    }

    extractAvatarData(avatarContainer) {
        const avatarData = { type: 'character', content: '?', src: null, text: null };
        if (!avatarContainer) return avatarData;
        let img = avatarContainer.querySelector('img');
        if (!img && avatarContainer.tagName === 'IMG') img = avatarContainer;
        if (img && img.src && !img.src.includes('data:image/svg')) {
            avatarData.type = 'image';
            avatarData.src = img.src;
            avatarData.content = img.src;  // CRITICAL: Also set content field for consistency
            return avatarData;
        }
        const svg = avatarContainer.querySelector('svg');
        if (svg) {
            avatarData.type = 'icon';
            const containerClone = avatarContainer.cloneNode(true);
            this.cleanAvatarClone(containerClone);
            avatarData.content = containerClone.outerHTML;
            return avatarData;
        }
        const text = avatarContainer.textContent.trim();
        if (text && text.length > 0) {
            avatarData.type = 'character';
            avatarData.text = text;
            avatarData.content = text.charAt(0).toUpperCase();
            return avatarData;
        }
        return avatarData;
    }

    cleanAvatarClone(clone) {
        const pinOverlays = clone.querySelectorAll('.wv-favorites-pin-overlay, .wv-favorites-pin-indicator, .wv-favorites-header-overlay, .wv-favorites-header-pin-indicator');
        pinOverlays.forEach(overlay => overlay.remove());
        if (clone.style.position === 'relative') {
            clone.style.position = '';
        }

        // Remove WorkVivo's original sizing and spacing classes
        // These interfere with our own avatar styling in pinned cards
        const classesToRemove = ['tw-w-8', 'tw-h-8', 'tw-mr-3', 'tw-w-full', 'tw-h-full'];
        classesToRemove.forEach(className => {
            if (clone.classList.contains(className)) {
                clone.classList.remove(className);
            }
        });

        // Also clean nested spans (for icon avatars)
        const spans = clone.querySelectorAll('span');
        spans.forEach(span => {
            classesToRemove.forEach(className => {
                if (span.classList.contains(className)) {
                    span.classList.remove(className);
                }
            });
        });

        return clone;
    }

    // DEPRECATED: Function commented out - was causing data corruption
    // Issue: Extracted navigation data from currently active DOM state instead of clicked element
    // WorkVivo is React SPA with no URL changes, navigation works via name-based matching
    // extractNavigationDataFromContext(chatName, chatHeader) {
    //     const navigationData = {
    //         channelUrl: null,
    //         sendbirdChannel: null,
    //         href: null,
    //         cleanName: WVFavs.Helpers.cleanChatName(chatName),
    //         currentChatUrl: null,
    //         chatNameForSearch: chatName
    //     };
    //     const currentUrl = window.location.href;
    //     if (currentUrl.includes('/chat/')) {
    //         navigationData.currentChatUrl = currentUrl;
    //     }
    //     let element = chatHeader;
    //     while (element && (!navigationData.channelUrl && !navigationData.sendbirdChannel)) {
    //         if (element.dataset) {
    //             navigationData.channelUrl = navigationData.channelUrl || element.dataset.channelUrl;
    //             navigationData.sendbirdChannel = navigationData.sendbirdChannel || element.dataset.sendbirdChannel;
    //         }
    //         navigationData.sendbirdChannel = navigationData.sendbirdChannel || element.getAttribute('data-sendbird-channel');
    //         element = element.parentElement;
    //     }
    //     return navigationData;
    // }

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
        // For sidebar buttons, use targeted extraction to avoid notification indicators
        // Try multiple selectors to detect if this is a sidebar element
        const isSidebarElement = element && (
            element.closest('[data-testid="channel-list"]') ||
            element.closest('[data-testid="sidebar"]') ||
            element.closest('.sidebar') ||
            element.closest('[class*="sidebar"]') ||
            element.closest('[id*="sidebar"]') ||
            // Check if element has chat button characteristics
            (element.tagName === 'BUTTON' && element.textContent.includes('@'))
        );

        if (isSidebarElement) {
            this.app?.logger?.log('🎯 Sidebar element detected, using targeted extraction');
            const cleanName = this.extractChatNameFromSidebar(element);
            const idName = cleanName.replace(/\s+/g, ''); // Just remove whitespace, keep all other characters
            this.app?.logger?.log('🎯 DomDataExtractor.generateChatId for sidebar element:', {
                rawText: element.textContent.trim(),
                extractedCleanName: cleanName,
                finalIdName: idName,
                generatedId: `name_${idName}`,
                containsAtSymbol: cleanName.includes('@'),
                containsNumbers: /\d/.test(cleanName)
            });
            return `name_${idName}`;
        }

        // For other elements, use the general approach
        const fullText = element ? element.textContent.trim() : '';
        const cleanName = WVFavs.Helpers.cleanChatName(fullText);
        return `name_${cleanName.replace(/\s+/g, '')}`;
    }

    generateChatIdFromContext(chatName, chatHeader) {
        const sendbirdId = this.findSendbirdChannelId(chatHeader);
        if (sendbirdId) {
            return `sendbird_${sendbirdId}`;
        }
        const cleanName = WVFavs.Helpers.cleanChatName(chatName);
        const nameHash = btoa(cleanName).replace(/[^a-zA-Z0-9]/g, '').substring(0, 32);
        return `name_${nameHash}`;
    }

    findSendbirdChannelId(chatHeader) {
        const chatContainer = chatHeader.closest('[data-testid="message-section"]') || chatHeader;
        const sendbirdSelectors = ['[data-sendbird-channel]', '[data-channel-url]', '[data-channel-id]', '[data-sb-channel]', '[data-thread-id]'];
        for (const selector of sendbirdSelectors) {
            const element = chatContainer.querySelector(selector);
            if (element) {
                const id = element.getAttribute(selector.slice(1, -1));
                if (id && id.length > 5) {
                    return id;
                }
            }
        }
        const activeButton = document.querySelector('button.tw-bg-primary-50.tw-text-primary-600');
        if (activeButton) {
            const sendbirdChannel = activeButton.getAttribute('data-sendbird-channel');
            if (sendbirdChannel) {
                return sendbirdChannel;
            }
        }
        return null;
    }

    chatNamesMatch(headerName, sidebarName) {
        if (!headerName || !sidebarName) return false;
        const cleanHeader = WVFavs.Helpers.cleanChatName(headerName).toLowerCase().trim();
        const cleanSidebar = WVFavs.Helpers.cleanChatName(sidebarName).toLowerCase().trim();
        if (cleanHeader === cleanSidebar) return true;
        if (cleanHeader.length > 3 && cleanSidebar.length > 3) {
            return cleanHeader.includes(cleanSidebar) || cleanSidebar.includes(cleanHeader);
        }
        return false;
    }

    getCurrentActiveChatId() {
        const activeButton = document.querySelector('button.tw-bg-primary-50.tw-text-primary-600');
        if (activeButton) {
            return this.generateChatId(activeButton);
        }
        return null;
    }
})();