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
  Image as ImageIcon
} from 'lucide-react'
import type { TabKind } from '../store/useSessionStore'

export const KIND_ICON: Record<TabKind, typeof Server> = {
  hosts: Server,
  keychain: KeyRound,
  quickCommands: Zap,
  history: FileClock,
  settings: Settings,
  terminal: SquareTerminal,
  sftp: FolderOpen,
  explorer: FolderTree,
  editor: FileText,
  image: ImageIcon
}
