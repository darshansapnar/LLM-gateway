import { Plus, Trash2 } from "lucide-react";
import { maskSecret } from "../../lib/playground/mask.js";

// A Key/Value table of request headers, with add/remove. The Authorization
// row is special-cased for display only: its value always mirrors the
// current API key (masked), rather than being independently typed - the
// real key is swapped in at send time (see Playground.jsx's buildHeaderList).
export default function HeadersEditor({ headers, onChange, apiKey }) {
  function updateRow(id, field, value) {
    onChange(headers.map((row) => (row.id === id ? { ...row, [field]: value } : row)));
  }

  function removeRow(id) {
    onChange(headers.filter((row) => row.id !== id));
  }

  function addRow() {
    onChange([...headers, { id: crypto.randomUUID(), key: "", value: "" }]);
  }

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <label className="text-xs font-semibold text-ink-soft">Headers</label>
        <button
          type="button"
          onClick={addRow}
          className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:text-accent-strong"
        >
          <Plus size={13} />
          Add header
        </button>
      </div>

      <div className="overflow-hidden rounded-lg border border-line">
        <table className="w-full text-sm">
          <tbody className="divide-y divide-line">
            {headers.map((row) => {
              const isAuth = row.key.trim().toLowerCase() === "authorization";
              return (
                <tr key={row.id}>
                  <td className="w-2/5 border-r border-line p-0 align-top">
                    <input
                      value={row.key}
                      onChange={(event) => updateRow(row.id, "key", event.target.value)}
                      placeholder="Header"
                      spellCheck={false}
                      className="w-full bg-transparent px-2.5 py-1.5 font-mono text-xs text-ink outline-none placeholder:text-ink-muted"
                    />
                  </td>
                  <td className="p-0 align-top">
                    {isAuth ? (
                      <div className="px-2.5 py-1.5 font-mono text-xs text-ink-muted" title="Set in the Gateway API Key field above">
                        {apiKey ? `Bearer ${maskSecret(apiKey)}` : "Bearer (not set)"}
                      </div>
                    ) : (
                      <input
                        value={row.value}
                        onChange={(event) => updateRow(row.id, "value", event.target.value)}
                        placeholder="Value"
                        spellCheck={false}
                        className="w-full bg-transparent px-2.5 py-1.5 font-mono text-xs text-ink outline-none placeholder:text-ink-muted"
                      />
                    )}
                  </td>
                  <td className="w-8 p-0 text-center align-top">
                    <button
                      type="button"
                      onClick={() => removeRow(row.id)}
                      className="p-1.5 text-ink-muted hover:text-bad-ink"
                      aria-label="Remove header"
                    >
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
