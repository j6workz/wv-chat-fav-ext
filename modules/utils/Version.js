/**
 * Version Manager for WorkVivo Chat Favorites Extension
 * Single source of truth for version number - reads from manifest.json
 */

class Version {
    constructor() {
        this.version = null;
        this.manifestData = null;
    }

    /**
     * Get version from manifest
     */
    async getVersion() {
        if (this.version) {
            return this.version;
        }

        try {
            // Try to get from chrome.runtime.getManifest() (works in all extension contexts)
            if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest) {
                const manifest = chrome.runtime.getManifest();
                this.version = manifest.version;
                this.manifestData = manifest;
                return this.version;
            }

            // Fallback: try to fetch manifest.json (for non-extension contexts)
            const response = await fetch(chrome.runtime.getURL('manifest.json'));
            const manifest = await response.json();
            this.version = manifest.version;
            this.manifestData = manifest;
            return this.version;

        } catch (error) {
            console.warn('Failed to get version from manifest:', error);
            // Fallback version if all else fails
            this.version = '2.5.4';
            return this.version;
        }
    }

    /**
     * Get version synchronously (must call getVersion() first)
     */
    getVersionSync() {
        return this.version || '2.5.4';
    }

    /**
     * Get full manifest data
     */
    getManifest() {
        return this.manifestData;
    }
}

// Create singleton instance
const versionManager = new Version();

// Initialize immediately
versionManager.getVersion().catch(() => {
    // Silently fail, fallback version will be used
});

// Make available globally
if (typeof window !== 'undefined') {
    window.WVFavs = window.WVFavs || {};
    window.WVFavs.Version = versionManager;
}

// Export for Node.js environments
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Version;
}
