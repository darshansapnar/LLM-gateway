import { Inbox } from "lucide-react";

// Friendly placeholder for any table/list/chart that has nothing to show
// yet, instead of an unexplained blank card.
export default function EmptyState({ icon: Icon = Inbox, title, description }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
      <Icon size={28} className="text-ink-muted" strokeWidth={1.5} />
      <p className="text-sm font-medium text-ink-soft">{title}</p>
      {description && <p className="max-w-xs text-xs text-ink-muted">{description}</p>}
    </div>
  );
}
