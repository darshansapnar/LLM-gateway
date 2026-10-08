import { useEffect, useRef } from "react";
import { Clock } from "lucide-react";
import EmptyState from "../common/EmptyState.jsx";

// Events appended one by one, in sync with the packet, each with a
// wall-clock timestamp - e.g. "Request received → API key authenticated →
// Rate limit passed → Exact cache MISS → …".
export default function RequestTimeline({ events }) {
  const listRef = useRef(null);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [events.length]);

  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <h3 className="text-sm font-medium text-ink">Request Timeline</h3>

      {events.length === 0 ? (
        <EmptyState icon={Clock} title="No events yet" description="Run a scenario to watch it move through the gateway." />
      ) : (
        <ol ref={listRef} className="mt-3 max-h-80 space-y-2.5 overflow-y-auto pr-1">
          {events.map((event, i) => (
            <li key={event.id} className="flex gap-2.5 text-xs">
              <div className="flex flex-col items-center pt-0.5">
                <span className={`h-1.5 w-1.5 rounded-full ${i === events.length - 1 ? "bg-accent" : "bg-ink-muted"}`} />
                {i < events.length - 1 && <span className="mt-0.5 w-px flex-1 bg-line" />}
              </div>
              <div className="min-w-0 flex-1 pb-0.5">
                <div className="text-ink-soft">{event.message}</div>
                <div className="font-mono text-[10px] text-ink-muted">
                  {new Date(event.at).toLocaleTimeString(undefined, { hour12: false })}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
