import { useRef } from "react";
import { Code2, Eraser } from "lucide-react";

// A monospace JSON textarea with a line-number gutter kept in sync via
// scroll position (not a real code editor - just enough to feel like one).
// Validation happens in the parent (Playground.jsx) on Send; `error` is
// shown inline here.
export default function JsonEditor({ value, onChange, error, onFormat, onClear }) {
  const textareaRef = useRef(null);
  const gutterRef = useRef(null);

  const lineCount = value.split("\n").length;

  function syncScroll() {
    if (gutterRef.current && textareaRef.current) {
      gutterRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  }

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <label className="text-xs font-semibold text-ink-soft">Body (JSON)</label>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onFormat}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-ink-soft hover:bg-surface-2"
          >
            <Code2 size={12} />
            Format JSON
          </button>
          <button
            type="button"
            onClick={onClear}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-ink-soft hover:bg-surface-2"
          >
            <Eraser size={12} />
            Clear
          </button>
        </div>
      </div>

      <div className={`flex overflow-hidden rounded-lg border bg-surface ${error ? "border-bad-ink" : "border-line"}`}>
        <div
          ref={gutterRef}
          className="select-none overflow-hidden bg-surface-2 px-2 py-2 text-right font-mono text-xs leading-5 text-ink-muted"
          style={{ minWidth: 34 }}
        >
          {Array.from({ length: lineCount }, (_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onScroll={syncScroll}
          spellCheck={false}
          rows={10}
          className="flex-1 resize-y bg-transparent px-2.5 py-2 font-mono text-xs leading-5 text-ink outline-none"
        />
      </div>

      {error && <p className="mt-1.5 text-xs text-bad-ink">{error}</p>}
    </div>
  );
}
