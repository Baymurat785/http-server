"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HTTPError = void 0;
class HTTPError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
        this.name = 'HTTPError';
    }
}
exports.HTTPError = HTTPError;
