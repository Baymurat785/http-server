"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cutMessage = cutMessage;
exports.parseHTTPReq = parseHTTPReq;
const http_error_1 = require("./http-error");
const buffer_utils_1 = require("./buffer-utils");
const kMaxHeaderSize = 1024 * 8;
function cutMessage(buf) {
    const idx = buf.data.subarray(0, buf.length).indexOf('\r\n\r\n');
    if (idx < 0) {
        if (buf.length > kMaxHeaderSize) {
            throw new http_error_1.HTTPError(413, 'Request Entity Too Large');
        }
        return null;
    }
    const msg = parseHTTPReq(buf.data.subarray(0, idx + 4));
    (0, buffer_utils_1.bufPop)(buf, idx + 4);
    return msg;
}
function parseHTTPReq(data) {
    const lines = (0, buffer_utils_1.splitLines)(data);
    const [method, uri, version] = parseRequestLine(lines[0]);
    const headers = [];
    for (let i = 1; i < lines.length; i++) {
        const h = Buffer.from(lines[i]);
        if (!validateHeader(h)) {
            throw new http_error_1.HTTPError(400, `Bad Request: Invalid header format - ${h.toString('ascii')}`);
        }
        headers.push(h);
    }
    console.assert(lines[lines.length - 1].length === 0);
    return {
        method: method, uri: uri, version: version, headers: headers,
    };
}
function parseRequestLine(line) {
    const lineStr = line.toString('ascii');
    const parts = lineStr.split(' ');
    if (parts.length !== 3) {
        throw new http_error_1.HTTPError(400, 'Bad Request: Invalid request line format');
    }
    const [method, uri, version] = parts;
    if (!method || !uri || !version) {
        throw new http_error_1.HTTPError(400, 'Missing request line components');
    }
    const validMethods = ['GET', 'POST', 'PUT', 'DELETE', 'HEAD', 'OPTIONS', 'PATCH', 'TRACE'];
    if (!validMethods.includes(method)) {
        throw new http_error_1.HTTPError(405, `Method Not Allowed: ${method}`);
    }
    if (!uri.startsWith('/')) {
        throw new http_error_1.HTTPError(400, 'Invalid URI format');
    }
    if (!version.match(/^HTTP\/\d+\.\d+$/)) {
        throw new http_error_1.HTTPError(400, 'Invalid HTTP version');
    }
    const uriBuffer = Buffer.from(uri, 'ascii');
    return [method, uriBuffer, version];
} //Example: GET /hello HTTP/1.1\r\n
function validateHeader(header) {
    const headerStr = header.toString('ascii');
    const colonIndex = headerStr.indexOf(':');
    if (colonIndex === -1) {
        return false; // No colon = invalid
    }
    const name = headerStr.substring(0, colonIndex).trim();
    const value = headerStr.substring(colonIndex + 1).trim();
    const tokenRegex = /^[!#$%&'*+\-.0-9A-Z^_`a-z|~]+$/;
    if (!tokenRegex.test(name)) {
        return false;
    }
    const valueRegex = /^[\x09\x20-\x7E\x80-\xFF]*$/;
    if (!valueRegex.test(value)) {
        return false;
    }
    for (let i = 0; i < value.length; i++) {
        const code = value.charCodeAt(i);
        if (code < 0x20 && code !== 0x09) {
            return false;
        }
    }
    return true;
}
