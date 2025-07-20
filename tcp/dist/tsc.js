"use strict";
/**
 * TCP/HTTP Server Implementation
 *
 * This module implements a basic HTTP/1.1 server built on top of Node.js TCP sockets.
 * It provides low-level control over HTTP request/response handling and demonstrates
 * how to build an HTTP server from scratch using raw TCP connections.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const net = __importStar(require("net"));
const http_error_1 = require("./http-error");
const http_parser_1 = require("./http-parser");
const buffer_utils_1 = require("./buffer-utils");
// ============================================================================
// TCP Socket Wrapper Functions
// ============================================================================
/**
 * Initialize TCP Connection Wrapper
 *
 * Creates a higher-level wrapper around Node.js net.Socket to provide
 * promise-based, non-blocking I/O operations. This abstraction allows
 * for better control over reading and writing data to/from TCP connections.
 *
 * The wrapper implements a pull-based reading model where:
 * - Only one read operation can be active at a time
 * - Data events are paused until explicitly requested
 * - Errors and EOF conditions are properly handled
 *
 * @param {net.Socket} socket - The underlying Node.js TCP socket
 * @returns {TCPConn} - Wrapped connection object with promise-based operations
 */
function soInit(socket) {
    const conn = {
        socket: socket, // Reference to the underlying socket
        err: null, // Stores any connection error
        ended: false, // Flag indicating if connection has ended
        reader: null, // Active read operation promise callbacks
    };
    // Handle incoming data events
    socket.on('data', (data) => {
        console.assert(conn.reader); // Ensure there's an active read operation
        conn.socket.pause(); // Pause data flow until next read request
        conn.reader.resolve(data); // Fulfill the pending read promise
        conn.reader = null; // Clear the active reader
    });
    // Handle connection end (graceful close)
    socket.on('end', () => {
        // Mark connection as ended and fulfill any pending read with EOF
        conn.ended = true;
        if (conn.reader) {
            conn.reader.resolve(Buffer.from('')); // EOF signal (empty buffer)
            conn.reader = null;
        }
    });
    // Handle connection errors
    socket.on('error', (err) => {
        // Store error and reject any pending read operations
        conn.err = err;
        if (conn.reader) {
            conn.reader.reject(err);
            conn.reader = null;
        }
    });
    return conn;
}
/**
 * Read Data from TCP Connection
 *
 * Performs a promise-based read operation on the TCP connection.
 * This function implements a pull-based reading model where data is only
 * consumed when explicitly requested.
 *
 * Behavior:
 * - Returns immediately if connection has errors or has ended
 * - Pauses the socket data flow until a read is requested
 * - Only allows one concurrent read operation at a time
 * - Returns empty Buffer to signal EOF after connection ends
 *
 * @param {TCPConn} conn - The TCP connection wrapper to read from
 * @returns {Promise<Buffer>} - Promise that resolves with received data or empty Buffer for EOF
 */
function soRead(conn) {
    console.assert(!conn.reader); // Ensure no concurrent read operations
    return new Promise((resolve, reject) => {
        // Check for existing connection errors
        if (conn.err) {
            reject(conn.err);
            return;
        }
        // Check if connection has ended (EOF condition)
        if (conn.ended) {
            resolve(Buffer.from('')); // Return empty buffer to signal EOF
            return;
        }
        // Store promise callbacks for later resolution by event handlers
        conn.reader = { resolve: resolve, reject: reject };
        // Resume the socket data flow to trigger 'data' events
        // The 'data' event handler will resolve this promise
        conn.socket.resume();
    });
}
/**
 * Write Data to TCP Connection
 *
 * Performs a promise-based write operation on the TCP connection.
 * This function wraps the underlying socket's write method to provide
 * async/await compatibility and proper error handling.
 *
 * @param {TCPConn} conn - The TCP connection wrapper to write to
 * @param {Buffer} data - The data to write (must be non-empty)
 * @returns {Promise<void>} - Promise that resolves when write is complete
 */
function soWrite(conn, data) {
    console.assert(data.length > 0); // Ensure we have data to write
    return new Promise((resolve, reject) => {
        // Check for existing connection errors before attempting to write
        if (conn.err) {
            reject(conn.err);
            return;
        }
        // Perform the write operation with callback-based error handling
        conn.socket.write(data, (err) => {
            if (err) {
                reject(err); // Write failed, reject the promise
            }
            else {
                resolve(); // Write successful, resolve the promise
            }
        });
    });
}
// ============================================================================
// HTTP Header Utilities
// ============================================================================
/**
 * Get HTTP Header Field Value
 *
 * Searches through an array of HTTP headers to find a specific field by name.
 * The search is case-insensitive and handles proper HTTP header parsing.
 *
 * HTTP headers are in the format: "Field-Name: field-value"
 *
 * @param {Buffer[]} headers - Array of HTTP header lines as Buffer objects
 * @param {string} key - The header field name to search for (case-insensitive)
 * @returns {Buffer | null} - The header value as a Buffer, or null if not found
 */
function fieldGet(headers, key) {
    const lowerKey = key.toLowerCase(); // Convert search key to lowercase for case-insensitive comparison
    // Iterate through all header lines
    for (const header of headers) {
        const headerStr = header.toString('latin1'); // Convert to string using latin1 encoding
        const colonIndex = headerStr.indexOf(':'); // Find the separator between field name and value
        // Ensure we have a valid header format with a colon
        if (colonIndex > 0) {
            // Extract and normalize the field name (everything before the colon)
            const fieldName = headerStr.substring(0, colonIndex).trim().toLowerCase();
            // Check if this is the field we're looking for
            if (fieldName === lowerKey) {
                // Extract the field value (everything after the colon)
                const value = headerStr.substring(colonIndex + 1).trim();
                return Buffer.from(value, 'latin1'); // Return as Buffer
            }
        }
    }
    return null; // Header field not found
}
/**
 * Parse Decimal Number from String
 *
 * Simple helper function to parse decimal numbers from strings.
 * Used primarily for parsing Content-Length values from HTTP headers.
 *
 * @param {string} str - The string to parse as a decimal number
 * @returns {number} - The parsed number (or NaN if invalid)
 */
function parseDec(str) {
    return parseInt(str, 10); // Parse as base-10 (decimal) number
}
/**
 * Encode HTTP Response Headers
 *
 * Converts an HTTP response object into a properly formatted HTTP response
 * header string according to HTTP/1.1 specification.
 *
 * Format:
 * HTTP/1.1 [status_code] OK\r\n
 * [header1]\r\n
 * [header2]\r\n
 * \r\n  (empty line separating headers from body)
 *
 * @param {HTTPRes} resp - The HTTP response object to encode
 * @returns {Buffer} - The encoded HTTP response headers as a Buffer
 */
function encodeHTTPResp(resp) {
    // Start with the status line
    const lines = [`HTTP/1.1 ${resp.code} OK`];
    // Add all response headers
    for (const header of resp.headers) {
        lines.push(header.toString('latin1'));
    }
    // Add empty line to separate headers from body (required by HTTP spec)
    lines.push('');
    // Join all lines with HTTP line endings (\r\n) and convert to Buffer
    return Buffer.from(lines.join('\r\n'), 'latin1');
}
// ============================================================================
// BodyReader Implementations
// ============================================================================
/**
 * Create BodyReader from In-Memory Data
 *
 * Creates a BodyReader that serves data from a pre-loaded Buffer.
 * This is useful for serving static responses or small payloads that
 * fit entirely in memory.
 *
 * The reader follows a simple state machine:
 * - First call to read() returns the entire data buffer
 * - Subsequent calls return empty buffer (EOF signal)
 *
 * @param {Buffer} data - The data to serve through the reader
 * @returns {BodyReader} - A reader that serves the provided data
 */
function readerFromMemory(data) {
    let done = false; // Track whether data has been read
    return {
        length: data.length, // Total length of data available
        read: async () => {
            if (done) {
                return Buffer.from(''); // No more data available (EOF)
            }
            else {
                done = true; // Mark as read
                return data; // Return all data in one read
            }
        },
    };
}
/**
 * Create BodyReader from TCP Connection with Known Length
 *
 * Creates a BodyReader that reads a specific number of bytes from a TCP connection.
 * This is used when the Content-Length header is present and specifies the exact
 * number of bytes to read from the HTTP request body.
 *
 * The reader:
 * - Tracks remaining bytes to read
 * - Manages a buffer to handle partial reads from the network
 * - Ensures exact byte count is read (throws error on unexpected EOF)
 *
 * @param {TCPConn} conn - The TCP connection to read from
 * @param {DynBuf} buf - Dynamic buffer for managing partial reads
 * @param {number} remain - Number of bytes remaining to read
 * @returns {BodyReader} - A reader that reads the specified number of bytes
 */
function readerFromConnLength(conn, buf, remain) {
    return {
        length: remain, // Total bytes expected to be read
        read: async () => {
            // Check if we've read all expected bytes
            if (remain === 0) {
                return Buffer.from(''); // EOF - no more data to read
            }
            // If buffer is empty, try to read more data from the connection
            if (buf.length === 0) {
                const data = await soRead(conn);
                (0, buffer_utils_1.bufpush)(buf, data); // Add new data to buffer
                if (data.length === 0) {
                    // Connection closed but we expected more data
                    throw new Error('Unexpected EOF from HTTP body');
                }
            }
            // Consume data from the buffer (up to remaining bytes needed)
            const consume = Math.min(buf.length, remain);
            remain -= consume; // Update remaining byte count
            // Extract the data to return
            const data = Buffer.from(buf.data.subarray(0, consume));
            (0, buffer_utils_1.bufPop)(buf, consume); // Remove consumed data from buffer
            return data;
        }
    };
}
/**
 * Create BodyReader from HTTP Request
 *
 * Creates an appropriate BodyReader based on the HTTP request headers and method.
 * This function handles different HTTP body encoding methods and validates
 * whether a body is allowed for the given HTTP method.
 *
 * Supported scenarios:
 * - Content-Length header: Reads exactly the specified number of bytes
 * - No body (GET, HEAD methods): Returns empty reader
 * - Chunked encoding: Currently not implemented (returns 501 error)
 * - Read until EOF: Currently not implemented (returns 501 error)
 *
 * @param {TCPConn} conn - The TCP connection to read from
 * @param {DynBuf} buf - Dynamic buffer for managing partial reads
 * @param {HTTPReq} req - The HTTP request object containing headers and method
 * @returns {BodyReader} - A reader appropriate for the request type
 * @throws {HTTPError} - For invalid Content-Length or unsupported features
 */
function readerFromReq(conn, buf, req) {
    let bodyLen = -1; // -1 indicates unknown length
    // Check for Content-Length header
    const contentLen = fieldGet(req.headers, 'Content-Length');
    if (contentLen) {
        bodyLen = parseDec(contentLen.toString('latin1'));
        if (isNaN(bodyLen)) {
            throw new http_error_1.HTTPError(400, 'bad Content-Length.');
        }
    }
    // Determine if HTTP body is allowed for this method
    const bodyAllowed = !(req.method === 'GET' || req.method === 'HEAD');
    // Check for chunked transfer encoding
    const chunked = fieldGet(req.headers, 'Transfer-Encoding')
        ?.equals(Buffer.from('chunked')) || false;
    // Validate body presence against method restrictions
    if (!bodyAllowed && (bodyLen > 0 || chunked)) {
        throw new http_error_1.HTTPError(400, 'HTTP body not allowed.');
    }
    // Force body length to 0 for methods that don't allow bodies
    if (!bodyAllowed) {
        bodyLen = 0;
    }
    // Choose appropriate reader based on encoding method
    if (bodyLen >= 0) {
        // Content-Length header is present - read exact number of bytes
        return readerFromConnLength(conn, buf, bodyLen);
    }
    else if (chunked) {
        // Chunked transfer encoding - not yet implemented
        throw new http_error_1.HTTPError(501, 'TODO: chunked encoding');
    }
    else {
        // Read until connection closes - not yet implemented
        throw new http_error_1.HTTPError(501, 'TODO: read until EOF');
    }
}
// ============================================================================
// HTTP Request/Response Handlers
// ============================================================================
/**
 * Handle HTTP Request
 *
 * Main request handler that processes incoming HTTP requests and generates
 * appropriate responses. This is a simple demonstration handler that supports
 * basic routing based on the request URI.
 *
 * Supported routes:
 * - /echo: Returns the request body as the response body (echo server)
 * - default: Returns a simple "hello world" message
 *
 * @param {HTTPReq} req - The parsed HTTP request object
 * @param {BodyReader} body - Reader for the request body content
 * @returns {Promise<HTTPRes>} - Promise resolving to the HTTP response
 */
async function handleReq(req, body) {
    let resp;
    // Route based on the request URI
    switch (req.uri.toString('latin1')) {
        case '/echo':
            // Echo server - return the request body as response body
            resp = body;
            break;
        default:
            // Default response - simple greeting message
            resp = readerFromMemory(Buffer.from('hello world.\n'));
            break;
    }
    // Return standardized HTTP response
    return {
        code: 200, // HTTP 200 OK
        headers: [Buffer.from('Server: my_first_http_server')], // Server identification header
        body: resp, // Response body content
    };
}
/**
 * Write HTTP Response to Connection
 *
 * Sends a complete HTTP response through the TCP connection, including
 * headers and body content. This function handles the proper formatting
 * and streaming of the response data.
 *
 * Process:
 * 1. Validates that Content-Length can be determined (no chunked encoding)
 * 2. Adds Content-Length header automatically
 * 3. Writes the response headers
 * 4. Streams the response body in chunks
 *
 * @param {TCPConn} conn - The TCP connection to write the response to
 * @param {HTTPRes} resp - The HTTP response object to send
 * @returns {Promise<void>} - Promise that resolves when response is fully sent
 * @throws {Error} - If body length is unknown (chunked encoding not supported)
 */
async function writeHTTPResp(conn, resp) {
    // Ensure we can determine content length (chunked encoding not supported)
    if (resp.body.length < 0) {
        throw new Error('TODO: chunked encoding');
    }
    // Automatically add Content-Length header
    console.assert(!fieldGet(resp.headers, 'Content-Length')); // Ensure not already set
    resp.headers.push(Buffer.from(`Content-Length: ${resp.body.length}`));
    // Write the HTTP response headers
    await soWrite(conn, encodeHTTPResp(resp));
    // Stream the response body in chunks
    while (true) {
        const data = await resp.body.read();
        if (data.length === 0) {
            break; // EOF reached, stop reading
        }
        await soWrite(conn, data); // Write chunk to connection
    }
}
/**
 * Handle Individual Client Connection
 *
 * Main connection handler that processes HTTP requests from a single client.
 * This function implements the core HTTP/1.1 protocol handling, including:
 * - Request parsing and buffering
 * - HTTP/1.1 persistent connections (keep-alive)
 * - HTTP/1.0 connection closing
 * - Request body consumption
 * - Error handling
 *
 * The function runs in a loop to handle multiple requests on the same connection
 * (HTTP/1.1 persistent connections) until the connection is closed or an error occurs.
 *
 * @param {TCPConn} conn - The TCP connection wrapper for the client
 * @returns {Promise<void>} - Promise that resolves when client connection is closed
 * @throws {HTTPError} - For HTTP protocol violations or unexpected conditions
 */
async function serverClient(conn) {
    // Initialize buffer for accumulating incoming data
    const buf = { data: Buffer.alloc(0), length: 0 };
    // Main request processing loop (supports HTTP/1.1 persistent connections)
    while (true) {
        // Attempt to parse a complete HTTP request from the buffer
        const msg = (0, http_parser_1.cutMessage)(buf);
        if (!msg) {
            // Need more data to complete the request parsing
            const data = await soRead(conn);
            (0, buffer_utils_1.bufpush)(buf, data); // Add new data to buffer
            // Handle connection close scenarios
            if (data.length === 0 && conn.ended) {
                return; // Clean EOF - connection closed by client
            }
            if (data.length === 0 && conn.err) {
                throw new http_error_1.HTTPError(400, 'Unexpected EOF.');
            }
            // Got some data, try parsing again
            continue;
        }
        // Successfully parsed a complete HTTP request
        // Create body reader for the request
        const reqBody = readerFromReq(conn, buf, msg);
        // Process the request and generate response
        const resp = await handleReq(msg, reqBody);
        // Send the response back to the client
        await writeHTTPResp(conn, resp);
        // Handle connection persistence based on HTTP version
        if (msg.version === '1.0') {
            return; // HTTP/1.0 - close connection after response
        }
        // For HTTP/1.1, ensure request body is fully consumed before next request
        // This prevents buffer corruption from incomplete body reads
        while ((await reqBody.read()).length > 0) {
            // Drain any remaining body data
        }
        // Continue loop to handle next request on same connection (HTTP/1.1 keep-alive)
    }
}
// ============================================================================
// Server Setup
// ============================================================================
/**
 * Handle New Client Connection
 *
 * Callback function that's invoked whenever a new client connects to the server.
 * This function sets up the connection wrapper and starts the client handling
 * process with proper error handling.
 *
 * @param {net.Socket} socket - The raw TCP socket for the new client connection
 */
function newConn(socket) {
    // Wrap the raw socket in our connection abstraction
    const conn = soInit(socket);
    // Start handling the client connection asynchronously
    serverClient(conn).catch(err => {
        console.error('Error handling client:', err);
        socket.destroy(); // Forcefully close connection on error
    });
}
// ============================================================================
// Server Initialization
// ============================================================================
/**
 * Create and Configure HTTP Server
 *
 * Sets up the main HTTP server using Node.js net module. The server:
 * - Allows half-open connections (allowHalfOpen: true)
 * - Handles connection events by creating wrapped connections
 * - Provides error handling and logging
 * - Listens on localhost:3000
 */
// Create TCP server with half-open connections enabled
// Half-open connections allow proper HTTP/1.1 connection handling
let server = net.createServer({ allowHalfOpen: true });
// Handle server-level errors
server.on('error', (err) => {
    throw err; // Propagate server errors to crash the process
});
// Handle new client connections
server.on('connection', newConn);
// Server configuration
const PORT = 3000;
const HOST = '127.0.0.1';
// Start the server
server.listen({ host: HOST, port: PORT }, () => {
    console.log(`HTTP server listening on http://${HOST}:${PORT}`);
});
