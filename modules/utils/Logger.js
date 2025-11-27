var WVFavs = WVFavs || {};

WVFavs.Logger = class Logger {
    constructor(settings) {
        this.settings = settings;
    }

    log(...args) {
        if (this.settings && this.settings.debugLogging) {
            console.log(...args);
        }
    }
}