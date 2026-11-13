// Monaco (MIT), chargé localement : aucune ressource tierce. Cœur de l'éditeur + coloration YAML.
import { useEffect, useRef } from "react";
import * as monaco from "monaco-editor/esm/vs/editor/edcore.main.js";
import "monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution.js";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker.js?worker";
import type { Problem } from "./yamlProblems.js";

(self as unknown as { MonacoEnvironment: { getWorker: () => Worker } }).MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
};

export interface YamlEditorHandle {
  revealLine: (line: number) => void;
}

export function YamlEditor({
  value,
  onChange,
  problems,
  onReady,
}: {
  value: string;
  onChange: (value: string) => void;
  problems: Problem[];
  onReady?: (handle: YamlEditorHandle) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!host.current) return;
    const ed = monaco.editor.create(host.current, {
      value,
      language: "yaml",
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 13.5,
      lineNumbers: "on",
      tabSize: 2,
      insertSpaces: true,
      scrollBeyondLastLine: false,
      renderWhitespace: "boundary",
      wordWrap: "on",
      fixedOverflowWidgets: true,
    });
    editor.current = ed;
    const sub = ed.onDidChangeModelContent(() => onChangeRef.current(ed.getValue()));
    onReady?.({
      revealLine: (line) => {
        ed.revealLineInCenter(line);
        ed.setPosition({ lineNumber: line, column: 1 });
        ed.focus();
      },
    });
    return () => {
      sub.dispose();
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

  return <div ref={host} className="editor-host" style={{ height: "100%" }} />;
}
