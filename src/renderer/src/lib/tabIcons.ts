import {
  Server,
  KeyRound,
  SquareTerminal,
  FolderOpen,
  FolderTree,
  FileText,
  FileClock,
  Settings,
  Zap,
  Monitor,
  Globe,
  Image as ImageIcon
} from 'lucide-react'
import type { TabKind } from '../store/useSessionStore'

export const KIND_ICON: Record<TabKind, typeof Server> = {
  hosts: Server,
  keychain: KeyRound,
  quickCommands: Zap,
  remoteDesktop: Monitor,
  proxies: Globe,
  history: FileClock,
  settings: Settings,
  terminal: SquareTerminal,
  sftp: FolderOpen,
  explorer: FolderTree,
  editor: FileText,
  image: ImageIcon
}
