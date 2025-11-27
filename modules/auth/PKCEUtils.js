/**
 * PKCE (Proof Key for Code Exchange) Utilities
 *
 * Implements RFC 7636 for OAuth 2.0 security in public clients.
 *
 * PKCE prevents authorization code interception attacks by:
 * 1. Generating a random code_verifier (kept secret on client)
 * 2. Creating a code_challenge = BASE64URL(SHA256(code_verifier))
 * 3. Sending code_challenge with auth request
 * 4. Sending code_verifier with token exchange
 * 5. Server validates SHA256(code_verifier) === code_challenge
 *
 * Even if authorization code is intercepted, attacker cannot exchange it
 * without the code_verifier (which never leaves the client until token exchange).
 *
 * @see https://datatracker.ietf.org/doc/html/rfc7636
 */

var WVFavs = WVFavs || {};

WVFavs.PKCEUtils = new (class PKCEUtils {
    constructor() {
        // No initialization needed
    }

    /**
     * Generate a cryptographically random string for PKCE code_verifier
     *
     * RFC 7636 Section 4.1:
     * "code_verifier = high-entropy cryptographic random STRING using the
     * unreserved characters [A-Z] / [a-z] / [0-9] / "-" / "." / "_" / "~"
     * with a minimum length of 43 characters and a maximum length of 128 characters"
     *
     * @param {number} length - Length of verifier (43-128, default 43)
     * @returns {string} Random verifier string
     */
    generateCodeVerifier(length = 43) {
        // Validate length
        if (length < 43 || length > 128) {
            throw new Error('Code verifier length must be between 43 and 128 characters');
        }

        // Use crypto.getRandomValues for cryptographic randomness
        const array = new Uint8Array(length);
        crypto.getRandomValues(array);

        // Convert to base64url format (RFC 7636 compatible)
        return this._base64URLEncode(array);
    }

    /**
     * Generate code_challenge from code_verifier
     *
     * RFC 7636 Section 4.2:
     * code_challenge = BASE64URL(SHA256(ASCII(code_verifier)))
     *
     * @param {string} verifier - The code_verifier string
     * @returns {Promise<string>} Base64URL encoded SHA-256 hash of verifier
     */
    async generateCodeChallenge(verifier) {
        if (!verifier) {
            throw new Error('Code verifier is required');
        }

        // Convert verifier string to bytes
        const encoder = new TextEncoder();
        const data = encoder.encode(verifier);

        // Compute SHA-256 hash using Web Crypto API
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);

        // Convert hash to Uint8Array
        const hashArray = new Uint8Array(hashBuffer);

        // Encode as base64url
        return this._base64URLEncode(hashArray);
    }

    /**
     * Convert Uint8Array to base64url string
     *
     * Base64URL encoding (RFC 4648 Section 5):
     * - Replace + with -
     * - Replace / with _
     * - Remove padding (=)
     *
     * @param {Uint8Array} buffer - Byte array to encode
     * @returns {string} Base64URL encoded string
     * @private
     */
    _base64URLEncode(buffer) {
        // Convert Uint8Array to binary string
        const bytes = Array.from(buffer);
        const binaryString = String.fromCharCode(...bytes);

        // Encode to base64
        const base64 = btoa(binaryString);

        // Convert to base64url format
        return base64
            .replace(/\+/g, '-')  // Replace + with -
            .replace(/\//g, '_')  // Replace / with _
            .replace(/=+$/, '');  // Remove trailing = padding
    }

    /**
     * Generate both code_verifier and code_challenge
     * Convenience method for OAuth flow initialization
     *
     * @param {number} length - Length of verifier (43-128, default 43)
     * @returns {Promise<{verifier: string, challenge: string}>} PKCE pair
     */
    async generatePKCEPair(length = 43) {
        const verifier = this.generateCodeVerifier(length);
        const challenge = await this.generateCodeChallenge(verifier);

        return {
            verifier,   // Keep this secret until token exchange
            challenge   // Send this with authorization request
        };
    }

    /**
     * Validate code_verifier format
     *
     * Checks if string meets RFC 7636 requirements:
     * - Length between 43-128 characters
     * - Only contains unreserved characters [A-Za-z0-9-._~]
     *
     * @param {string} verifier - Code verifier to validate
     * @returns {boolean} True if valid
     */
    isValidCodeVerifier(verifier) {
        if (!verifier || typeof verifier !== 'string') {
            return false;
        }

        // Check length
        if (verifier.length < 43 || verifier.length > 128) {
            return false;
        }

        // Check characters (RFC 7636: unreserved characters only)
        const validPattern = /^[A-Za-z0-9\-._~]+$/;
        return validPattern.test(verifier);
    }

    /**
     * Generate random state parameter for CSRF protection
     *
     * State parameter prevents CSRF attacks by:
     * 1. Client generates random state
     * 2. Stores it temporarily
     * 3. Sends with authorization request
     * 4. Server echoes it back in redirect
     * 5. Client validates returned state matches stored state
     *
     * @param {number} length - Length of state string (default 32)
     * @returns {string} Random state string
     */
    generateState(length = 32) {
        const array = new Uint8Array(length);
        crypto.getRandomValues(array);
        return this._base64URLEncode(array);
    }
})();
