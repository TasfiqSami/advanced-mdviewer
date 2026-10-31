import { useEffect, useRef, type MutableRefObject } from "react";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";

interface EditorProps {
  value: string;
  onChange: (value: string) => void;
  editorRef: MutableRefObject<EditorView | null>;
}

const editorTheme = EditorView.theme({
  "&": { height: "100%", color: "var(--text)", backgroundColor: "var(--editor-bg)", fontSize: "13px" },
  ".cm-content": { fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', monospace", padding: "20px 0", caretColor: "var(--accent)" },
  ".cm-gutters": { backgroundColor: "var(--editor-bg)", color: "var(--muted)", border: "none", borderRight: "1px solid var(--border)" },
  ".cm-activeLineGutter": { backgroundColor: "var(--surface-2)" },
  ".cm-activeLine": { backgroundColor: "var(--surface-2)" },
  ".cm-cursor": { borderLeftColor: "var(--accent)" },
  ".cm-selectionBackground": { background: "rgba(93, 180, 255, 0.22)" },
  ".cm-focused": { outline: "none" },
  ".cm-scroller": { overflow: "auto", fontFamily: "inherit", lineHeight: "1.8" },
  ".cm-line": { padding: "0 20px" },
}, { dark: true });

export default function Editor({ value, onChange, editorRef }: EditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!hostRef.current) return;
    const extensions: Extension[] = [
      lineNumbers(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      drawSelection(),
      history(),
      markdown(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
      editorTheme,
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) onChangeRef.current(update.state.doc.toString());
      }),
    ];
    const view = new EditorView({
      state: EditorState.create({ doc: value, extensions }),
      parent: hostRef.current,
    });
    editorRef.current = view;
    return () => {
      editorRef.current = null;
      view.destroy();
    };
  }, []);

  useEffect(() => {
    const view = editorRef.current;
    if (!view || view.state.doc.toString() === value) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
  }, [value, editorRef]);

  return <div ref={hostRef} className="editor-host" />;
}
