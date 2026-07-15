import { useEffect } from 'react'
import { VaultGate } from './components/VaultGate'
import { Sidebar } from './components/Sidebar'
import { TabBar } from './components/TabBar'
import { SplitLayout } from './components/SplitLayout'
import { useSessionStore, type Tab } from './store/useSessionStore'

function Shell(): React.ReactElement {
  const adoptTab = useSessionStore((s) => s.adoptTab)

  // Prevent a stray file drop outside a drop zone from navigating the whole app
  // to a file:// URL (which would blow away the renderer).
  useEffect(() => {
    const prevent = (e: DragEvent): void => {
      e.preventDefault()
    }
    window.addEventListener('dragover', prevent)
    window.addEventListener('drop', prevent)
    return () => {
      window.removeEventListener('dragover', prevent)
      window.removeEventListener('drop', prevent)
    }
  }, [])

  // Adopt a tab torn off from another window: on load (this window was created for it),
  // and live (a tab dropped onto this existing window). The session is already alive in
  // main, so the tab's component will replay/reuse it rather than reconnect.
  useEffect(() => {
    void window.api.window.takePendingAdopt().then((payload) => {
      if (payload) adoptTab(payload.tab as unknown as Tab)
    })
    return window.api.window.onAdoptTab((payload) => adoptTab(payload.tab as unknown as Tab))
  }, [adoptTab])

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden">
      <TabBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <div className="relative min-w-0 flex-1">
          <SplitLayout />
        </div>
      </div>
    </div>
  )
}

function App(): React.JSX.Element {
  return (
    <VaultGate>
      <Shell />
    </VaultGate>
  )
}

export default App
