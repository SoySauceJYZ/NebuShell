import { Socket } from 'net'

/**
 * ssh2's default internal socket doesn't disable Nagle's algorithm. On Windows,
 * the interaction between Nagle's algorithm and delayed ACKs can coalesce/fragment
 * the very first (unencrypted) SSH packets in a way ssh2's parser mishandles,
 * surfacing as a "Bad packet length" error thrown from NullDecipher.decrypt during
 * the handshake — before any real cipher has even been negotiated. Opening the
 * socket ourselves with TCP_NODELAY set and handing it to ssh2 via the `sock`
 * option avoids that corruption.
 */
export function createNoDelaySocket(host: string, port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = new Socket()
    socket.setNoDelay(true)
    const onError = (err: Error): void => {
      socket.removeListener('connect', onConnect)
      reject(err)
    }
    const onConnect = (): void => {
      socket.removeListener('error', onError)
      resolve(socket)
    }
    socket.once('error', onError)
    socket.once('connect', onConnect)
    socket.connect(port, host)
  })
}
