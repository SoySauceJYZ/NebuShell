import { useSessionStore } from '../store/useSessionStore'
import { useTransfersStore } from '../store/useTransfersStore'

/**
 * Close a tab, but first warn (and require confirmation) if that window has a
 * transfer still running — closing it tears down the SFTP connection and aborts
 * the transfer. On close, the window's transfer records are dropped.
 */
export async function requestCloseTab(tabId: string): Promise<void> {
  const transfers = useTransfersStore.getState()
  if (transfers.hasActive(tabId)) {
    const ok = await window.api.dialog.confirm({
      message: '有正在进行的传输任务',
      detail: '关闭此页面会中断未完成的传输。确定关闭吗?',
      confirmLabel: '仍然关闭',
      cancelLabel: '取消'
    })
    if (!ok) return
  }
  useSessionStore.getState().closeTab(tabId)
  useTransfersStore.getState().clearOwner(tabId)
}
