import './assets/main.css'
import './lib/monacoSetup'

import { createRoot } from 'react-dom/client'
import App from './App'

// StrictMode intentionally omitted: it double-invokes effects in dev, which would open
// each SSH shell/terminal twice and produce duplicated prompts and output.
createRoot(document.getElementById('root')!).render(<App />)
