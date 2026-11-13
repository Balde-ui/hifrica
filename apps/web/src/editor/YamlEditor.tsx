// Monaco (MIT), chargé localement : aucune ressource tierce. Cœur de l'éditeur + coloration YAML.
import { useEffect, useRef } from "react";
import * as monaco from "monaco-editor/esm/vs/editor/edcore.main.js";
import "monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution.js";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker.js?worker";
import type { Problem } from "./yamlProblems.js";

(self as unknown as { MonacoEnvironment: { getWorker: () => Worker } }).MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

// Thème accordé au design system (fond --code-bg, accent émeraude).
monaco.editor.defineTheme("hifrica-dark", {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "type", foreground: "7cc4fa" },
    { token: "string", foreground: "a5e3b8" },
    { token: "number", foreground: "f7b267" },
    { token: "keyword", foreground: "c9a2f6" },
    { token: "comment", foreground: "5e646c", fontStyle: "italic" },
  ],
  colors: {
    "editor.background": "#0b0d0f",
    "editor.foreground": "#d7dadd",
    "editorLineNumber.foreground": "#4a5058",
    "editorLineNumber.activeForeground": "#b4b8bd",
    "editor.lineHighlightBackground": "#14171a",
    "editor.lineHighlightBorder": "#14171a",
    "editor.selectionBackground": "#3ecf8e33",
    "editorCursor.foreground": "#3ecf8e",
    "editorIndentGuide.background1": "#1d2126",
    "editorIndentGuide.activeBackground1": "#343a42",
    "editorGutter.background": "#0b0d0f",
    "editorError.foreground": "#f2555a",
    "scrollbarSlider.background": "#252a3080",
    "scrollbarSlider.hoverBackground": "#343a42",
    "editorWidget.background": "#171a1e",
    "editorWidget.border": "#343a42",
    "editorHoverWidget.background": "#171a1e",
    "editorHoverWidget.border": "#343a42",
  },
});

export interface YamlEditorHandle {
  revealLine: (line: number) => void;
}

export function YamlEditor({
  value,
  onChange,
  problems,
  onReady,
  onCursor,
}: {
  value: string;
  onChange: (value: string) => void;
  problems: Problem[];
  onReady?: (handle: YamlEditorHandle) => void;
  onCursor?: (line: number, column: number) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onCursorRef = useRef(onCursor);
  onCursorRef.current = onCursor;

  useEffect(() => {
    if (!host.current) return;
    const ed = monaco.editor.create(host.current, {
      value,
      language: "yaml",
      theme: "hifrica-dark",
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 13,
      lineHeight: 21,
      fontFamily: '"JetBrains Mono", "Geist Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      lineNumbers: "on",
      tabSize: 2,
      insertSpaces: true,
      scrollBeyondLastLine: false,
      renderWhitespace: "boundary",
      wordWrap: "on",
      padding: { top: 12, bottom: 12 },
      smoothScrolling: true,
      cursorBlinking: "smooth",
      guides: { indentation: true },
      fixedOverflowWidgets: true,
    });
    editor.current = ed;
    const subs = [
      ed.onDidChangeModelContent(() => onChangeRef.current(ed.getValue())),
      ed.onDidChangeCursorPosition((e) => onCursorRef.current?.(e.position.lineNumber, e.position.column)),
    ];
    onReady?.({
      revealLine: (line) => {
        ed.revealLineInCenter(line);
        ed.setPosition({ lineNumber: line, column: 1 });
        ed.focus();
      },
    });
    return () => {
      subs.forEach((s) => s.dispose());
      ed.getModel()?.dispose();
      ed.dispose();
      editor.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Valeur remplacée de l'extérieur (fork, génération IA, modèle) : on ne touche pas au texte en cours de frappe.
  useEffect(() => {
    const ed = editor.current;
    if (ed && ed.getValue() !== value) ed.setValue(value);
  }, [value]);

  useEffect(() => {
    const model = editor.current?.getModel();
    if (!model) return;
    monaco.editor.setModelMarkers(
      model,
      "hifrica-schema",
      problems.map((p) => ({
        severity: monaco.MarkerSeverity.Error,
        startLineNumber: p.line,
        startColumn: p.column,
        endLineNumber: p.endLine,
        endColumn: p.endColumn,
        message: p.message,
      })),
    );
  }, [problems]);

  return <div ref={host} className="editor-host" />;
}
