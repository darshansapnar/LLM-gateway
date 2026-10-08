import { ChevronDown } from "lucide-react";

// A native <select> styled to look like a pill/chip - keeps full keyboard
// and screen-reader support instead of hand-rolling a custom dropdown.
function FilterChip({ value, onChange, options, allLabel }) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="appearance-none rounded-full border border-line bg-surface py-1.5 pl-3 pr-8 text-xs font-medium text-ink-soft outline-none hover:bg-surface-2 focus:border-accent"
      >
        <option value="">{allLabel}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      <ChevronDown size={13} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-muted" />
    </div>
  );
}

const PROVIDERS = ["groq", "gemini", "openrouter", "none"];
const STATUSES = ["success", "error", "cancelled"];
const CACHE_TYPES = ["exact", "semantic", "none"];

export default function RequestFilters({ filters, onChange }) {
  return (
    <div className="mb-3 flex flex-wrap gap-2">
      <FilterChip value={filters.provider} onChange={(v) => onChange("provider", v)} options={PROVIDERS} allLabel="All providers" />
      <FilterChip value={filters.status} onChange={(v) => onChange("status", v)} options={STATUSES} allLabel="All statuses" />
      <FilterChip value={filters.cacheType} onChange={(v) => onChange("cacheType", v)} options={CACHE_TYPES} allLabel="All cache types" />
    </div>
  );
}
