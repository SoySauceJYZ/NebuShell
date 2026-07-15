/// <reference types="vite/client" />

// mammoth ships no typings, and its main entry pulls in Node's `fs`. We use the
// prebuilt browser bundle instead and declare just the bit we call.
declare module 'mammoth/mammoth.browser' {
  interface MammothResult {
    value: string
    messages: { type: string; message: string }[]
  }
  const mammoth: {
    convertToHtml(input: { arrayBuffer: ArrayBuffer }): Promise<MammothResult>
  }
  export default mammoth
}
