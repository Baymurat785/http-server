import { HTTPReq, DynBuf } from "./types";
import { HTTPError } from "./http-error";
import { bufPop, splitLines } from "./buffer-utils";

const kMaxHeaderSize = 1024 * 8;

export function cutMessage(buf: DynBuf): null | HTTPReq {
  const idx = buf.data.subarray(0, buf.length).indexOf("\r\n\r\n");
  if (idx < 0) {
    if (buf.length > kMaxHeaderSize) {
      throw new HTTPError(413, "Request Entity Too Large");
    }
    return null;
  }
  const msg = parseHTTPReq(buf.data.subarray(0, idx + 4));
  bufPop(buf, idx + 4);
  return msg;
}

export function parseHTTPReq(data: Buffer): HTTPReq {
  const lines: Buffer[] = splitLines(data);
  const [method, uri, version] = parseRequestLine(lines[0]);
  const headers: Buffer[] = [];

  // Process headers, but stop at empty line
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];

    // Empty line indicates end of headers
    if (line.length === 0) {
      break;
    }

    if (!validateHeader(line)) {
      throw new HTTPError(
        400,
        `Bad Request: Invalid header format - ${line.toString("ascii")}`
      );
    }

    headers.push(Buffer.from(line));
  }

  return {
    method: method,
    uri: uri,
    version: version,
    headers: headers,
  };
}

function parseRequestLine(line: Buffer): [string, Buffer, string] {
  const lineStr = line.toString("ascii");
  const parts = lineStr.split(" ");

  if (parts.length !== 3) {
    throw new HTTPError(400, "Bad Request: Invalid request line format");
  }

  const [method, uri, version] = parts;

  if (!method || !uri || !version) {
    throw new HTTPError(400, "Missing request line components");
  }

  const validMethods = [
    "GET",
    "POST",
    "PUT",
    "DELETE",
    "HEAD",
    "OPTIONS",
    "PATCH",
    "TRACE",
  ];

  if (!validMethods.includes(method)) {
    throw new HTTPError(405, `Method Not Allowed: ${method}`);
  }

  if (!uri.startsWith("/")) {
    throw new HTTPError(400, "Invalid URI format");
  }

  if (!version.match(/^HTTP\/\d+\.\d+$/)) {
    throw new HTTPError(400, "Invalid HTTP version");
  }

  const uriBuffer = Buffer.from(uri, "ascii");

  return [method, uriBuffer, version];
}

function validateHeader(header: Buffer): boolean {
  const headerStr = header.toString("ascii");

  const colonIndex = headerStr.indexOf(":");
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
