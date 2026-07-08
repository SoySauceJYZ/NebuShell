import type { ConnectConfig } from 'ssh2'

/**
 * chacha20-poly1305@openssh.com encrypts the packet-length field itself (unlike the
 * AES-GCM/CTR ciphers), and the `ssh2` npm library has long-standing decoding bugs with
 * it against modern OpenSSH servers (surfaces as a client 'error' event with message
 * "Bad packet length" that desyncs the transport after the fact). Excluding it forces
 * negotiation onto aes256-gcm/aes128-ctr, which ssh2 handles reliably.
 */
export const SAFE_ALGORITHMS: ConnectConfig['algorithms'] = {
  cipher: [
    'aes128-gcm@openssh.com',
    'aes256-gcm@openssh.com',
    'aes128-ctr',
    'aes192-ctr',
    'aes256-ctr'
  ],
  serverHostKey: ['ssh-ed25519', 'ecdsa-sha2-nistp256', 'rsa-sha2-512', 'rsa-sha2-256']
}

/**
 * A keepalive-triggered rekey is a plausible interaction point for the same transport
 * desync, so keepalives are disabled entirely for these short-lived interactive sessions.
 */
export const SAFE_KEEPALIVE_INTERVAL = 0
