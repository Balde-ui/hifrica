/// <reference types="vite/client" />

// Cœur de Monaco (éditeur + contributions, sans les langues ni les services lourds) : mêmes types que l'API.
declare module "monaco-editor/esm/vs/editor/edcore.main.js" {
  export * from "monaco-editor/esm/vs/editor/editor.api";
}
