import {
  Server,
  KeyRound,
  SquareTerminal,
  FolderOpen,
  FolderTree,
  FileText,
  FileClock,
  Settings,
  Image as ImageIcon
} from 'lucide-react'
import type { TabKind } from '../store/useSessionStore'

export const KIND_ICON: Record<TabKind, typeof Server> = {
  hosts: Server,
  keychain: KeyRound,
  history: FileClock,
  settings: Settings,
  terminal: SquareTerminal,
  sftp: FolderOpen,
  explorer: FolderTree,
  editor: FileText,
  image: ImageIcon
}
