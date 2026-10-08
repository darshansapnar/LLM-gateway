import { useEffect } from "react";
import { X } from "lucide-react";

// A small centered dialog - backdrop click, the X button, or Escape all
// close it. For a full-detail inspector, see
// pages/requests/RequestDetailPanel.jsx's slide-over instead; this is for
// short, focused forms (e.g. creating an API key).
export default function Modal({ title, onClose, children, maxWidth = "max-w-md" }) {
  useEffect(() => {
    function handleKey(event) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink/30" onClick={onClose} />

      <div className={`relative w-full ${maxWidth} rounded-2xl border border-line bg-surface p-5 shadow-xl`}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-ink-muted hover:bg-surface-2"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
