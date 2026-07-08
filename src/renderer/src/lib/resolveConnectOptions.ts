import type { Host, Credential, SshConnectOptions } from '@shared/types'

export function resolveConnectOptions(
  sessionId: string,
  host: Host,
  credentials: Credential[]
): SshConnectOptions {
  const base: SshConnectOptions = {
    sessionId,
    host: host.address,
    port: host.port,
    username: host.username
  }

  if (host.authType === 'password') {
    return { ...base, password: host.password }
  }
  if (host.authType === 'key') {
    return { ...base, privateKey: host.privateKey, passphrase: host.passphrase }
  }
  if (host.authType === 'credential' && host.credentialId) {
    const cred = credentials.find((c) => c.id === host.credentialId)
    if (cred?.type === 'password') {
      return { ...base, password: cred.password }
    }
    if (cred?.type === 'key') {
      return { ...base, privateKey: cred.privateKey, passphrase: cred.passphrase }
    }
  }
  return base
}
