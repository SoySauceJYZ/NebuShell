import { useEffect } from 'react'
import { VaultGate } from './components/VaultGate'
import { Sidebar } from './components/Sidebar'
import { TabBar } from './components/TabBar'
import { SplitLayout } from './components/SplitLayout'

function Shell(): React.ReactElement {
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
