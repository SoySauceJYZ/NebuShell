import * as monaco from 'monaco-editor'
import { loader } from '@monaco-editor/react'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'

// Bundle Monaco locally (no CDN) so the editor works offline in the packaged app.
// Only the base editor worker is wired up — enough for syntax highlighting, find,
// and multi-cursor across shell/plaintext/log/json/yaml, without the heavier
// language-service workers (TS/JSON) we don't need for a scratch buffer.
self.MonacoEnvironment = {
  getWorker: () => new EditorWorker()
}

loader.config({ monaco })
