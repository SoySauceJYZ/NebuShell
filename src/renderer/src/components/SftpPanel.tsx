import { useVaultStore } from '../store/useVaultStore'
import { useSessionStore } from '../store/useSessionStore'
import { RemotePane } from './sftp/RemotePane'
import { ContainerPane } from './sftp/ContainerPane'
import { TransfersPanel } from './sftp/TransfersPanel'

/**
 * Thin wrapper kept for the embedded (terminal right-panel) SFTP view. All the
 * browsing / drag-drop / download logic lives in RemotePane, so the embedded
 * panel and the full-page explorer stay in sync. The "expand" button opens the
 * multi-pane explorer tab for the same host.
 */
export function SftpPanel({
  sessionId,
  hostId,
  ownerId
}: {
  sessionId: string
  hostId: string
  /** Tab/window that owns transfers here (scopes the records panel + close prompt). */
  ownerId: string
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

  return (
    <div className="relative h-full min-w-0">
      <RemotePane
        sessionId={sessionId}
        hostId={hostId}
        ownerId={ownerId}
        embedded
        onExpand={onExpand}
      />
      <TransfersPanel ownerId={ownerId} />
    </div>
  )
}

/**
 * 容器终端右侧的「容器文件」面板:与 SftpPanel 同构,但浏览的是容器内文件系统
 * (docker exec / docker cp),而不是宿主机 SFTP。展开按钮打开「本地 + 容器」双栏。
 */
export function ContainerFilesPanel({
  sessionId,
  hostId,
  containerId,
  containerName,
  dockerCmd,
  ownerId
}: {
  sessionId: string
  hostId: string
  containerId: string
  containerName: string
  dockerCmd: string
  ownerId: string
}): React.ReactElement {
  const openTab = useSessionStore((s) => s.openTab)

  const onExpand = (): void => {
    openTab({
      id: `explorer-cfs-${containerId.slice(0, 12)}-${Date.now()}`,
      kind: 'explorer',
      title: `${containerName} (文件)`,
      hostId,
      explorerContainerId: containerId,
      explorerContainerName: containerName,
      dockerCmd
    })
  }

  return (
    <div className="relative h-full min-w-0">
      <ContainerPane
        sessionId={sessionId}
        hostId={hostId}
        containerId={containerId}
        containerName={containerName}
        dockerCmd={dockerCmd}
        ownerId={ownerId}
        embedded
        onExpand={onExpand}
      />
      <TransfersPanel ownerId={ownerId} />
    </div>
  )
}
