import { Blob } from 'node:buffer'
import { webcrypto } from 'node:crypto'
import { ReadableStream } from 'node:stream/web'
import { fetch, File, FormData, Headers, Request, Response } from 'undici'

// Electron 22 embeds Node 16. Install matching Fetch classes for HTTP clients and MCP.
if (!globalThis.Headers?.prototype.getSetCookie) {
  Object.assign(globalThis, { fetch, File, FormData, Headers, Request, Response })
}

Object.assign(globalThis, {
  Blob: globalThis.Blob ?? Blob,
  crypto: globalThis.crypto ?? webcrypto,
  ReadableStream: globalThis.ReadableStream ?? ReadableStream
})
