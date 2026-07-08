import { useVaultStore } from '../store/useVaultStore'
import { useSessionStore } from '../store/useSessionStore'
import { RemotePane } from './sftp/RemotePane'

/**
 * Thin wrapper kept for the embedded (terminal right-panel) SFTP view. All the
 * browsing / drag-drop / download logic lives in RemotePane, so the embedded
 * panel and the full-page explorer stay in sync. The "expand" button opens the
 * multi-pane explorer tab for the same host.
 */
export function SftpPanel({
  sessionId,
  hostId
}: {
  sessionId: string
  hostId: string
}): React.ReactElement {
  const hosts = useVaultStore((s) => s.hosts)
  const openTab = useSessionStore((s) => s.openTab)

  const onExpand = (): void => {
    const host = hosts.find((h) => h.id === hostId)
    openTab({
      id: `explorer-${hostId}-${Date.now()}`,
      kind: 'explorer',
      title: `${host?.label ?? 'SFTP'} (SFTP)`,
      hostId
    })
  }

  return <RemotePane sessionId={sessionId} hostId={hostId} embedded onExpand={onExpand} />
}
