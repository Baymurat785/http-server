import { DynBuf } from './types';

export function bufPop(buf: DynBuf, len: number): void {
    buf.data.copyWithin(0, len, buf.length);
    buf.length -= len;
}

export function bufpush(buf: DynBuf, data: Buffer): void {
    buf.data = Buffer.concat([buf.data, data]);
    buf.length = buf.data.length;
}


export function splitLines(data: Buffer): Buffer[] {
    const lines: Buffer[] = [];
    let start = 0;
    
    for (let i = 0; i < data.length; i++) {
        if (data[i] === 0x0A) {
            let end = i;
            if (i > 0 && data[i - 1] === 0x0D) {
                end = i - 1;
            }
            lines.push(data.slice(start, end));
            start = i + 1;
        }
    }
    
    if (start < data.length) {
        lines.push(data.slice(start));
    }
    
    return lines;
}