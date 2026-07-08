import { HostsView } from './HostsView'
import { KeychainView } from './KeychainView'
import { HistoryDocsView } from './HistoryDocsView'
import { TerminalTab } from './TerminalTab'
import { SftpPanel } from './SftpPanel'
import { ExplorerTab } from './sftp/ExplorerTab'
import { EditorTab } from './EditorTab'
import { ImagePreviewTab } from './ImagePreviewTab'
import type { Tab } from '../store/useSessionStore'

/** Renders the body of a single tab by kind. Kept mounted regardless of visibility. */
export function TabContent({ tab }: { tab: Tab }): React.ReactElement | null {
  switch (tab.kind) {
    case 'hosts':
      return <HostsView />
    case 'keychain':
      return <KeychainView />
    case 'history':
      return <HistoryDocsView />
    case 'terminal':
      return tab.hostId ? <TerminalTab sessionId={tab.id} hostId={tab.hostId} /> : null
    case 'sftp':
      return tab.hostId ? <SftpPanel sessionId={tab.id} hostId={tab.hostId} /> : null
    case 'explorer':
      return <ExplorerTab tabId={tab.id} initialHostId={tab.hostId} />
    case 'editor':
      return (
        <EditorTab
          content={tab.editorContent}
          execCommand={tab.editorExecCommand}
          sourceSessionId={tab.editorSourceSessionId}
          initialLang={tab.editorLang}
          sftpSessionId={tab.editorSftpSessionId}
          remotePath={tab.editorRemotePath}
          fileKey={tab.editorFileKey}
          fileName={tab.editorFileName}
          localPath={tab.editorLocalPath}
        />
      )
    case 'image':
      return tab.imageLocalPath ? (
        <ImagePreviewTab localPath={tab.imageLocalPath} fileName={tab.editorFileName} />
      ) : null
    default:
      return null
  }
}
