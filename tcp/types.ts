import * as net from "net";

export type HTTPReq = {
    method: string;
    uri: Buffer;
    version: string;
    headers: Buffer[];
}

export type HTTPRes = {
    code: number;
    headers: Buffer[];
    body: BodyReader;
}

export type BodyReader = {
    length: number;
    read: () => Promise<Buffer>;
}

// A promise-based API for TCP sockets.
export type TCPConn = {
    // the JS socket object
    socket: net.Socket;
    // from the 'error' event
    err: null|Error;
    // EOF, from the 'end' event
    ended: boolean;
    // the callbacks of the promise of the current read
    reader: null|{
        resolve: (value: Buffer) => void,
        reject: (reason: Error) => void,
    };
};

export type DynBuf = {
    data: Buffer,
    length: number,
};