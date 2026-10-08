import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { usePolling } from "../hooks/usePolling.js";
import { getLogs } from "../api.js";
import PageHeader from "../components/layout/PageHeader.jsx";
import ErrorBanner from "../components/common/ErrorBanner.jsx";
import RequestFilters from "./requests/RequestFilters.jsx";
import RequestsTable from "./requests/RequestsTable.jsx";
import RequestDetailPanel from "./requests/RequestDetailPanel.jsx";

// A paginated, filterable table of RequestLog entries. Clicking a row opens
// RequestDetailPanel with the full prompt/response/attempts for that one request.
export default function RequestsPage({ adminKey, onOpenMobileNav }) {
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({ provider: "", status: "", cacheType: "" });
  const [selected, setSelected] = useState(null);

  const { data, loading, error, lastUpdated, reload } = usePolling(
    () => getLogs(adminKey, { page, limit: 20, ...filters }),
    [adminKey, page, filters.provider, filters.status, filters.cacheType]
  );

  function updateFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1); // a changed filter invalidates whatever page we were on
  }

  return (
    <section>
      <PageHeader title="Requests" lastUpdated={lastUpdated} onRefresh={reload} onOpenMobileNav={onOpenMobileNav} />

      {error && <ErrorBanner message={error} onRetry={reload} />}

      {!error && (
        <>
          <RequestFilters filters={filters} onChange={updateFilter} />
          <RequestsTable logs={data?.logs ?? []} loading={loading} onSelect={setSelected} />

          {data && (
            <div className="mt-3 flex items-center justify-between text-sm text-ink-soft">
              <span>
                Page {data.page} of {data.totalPages} · {data.total} total
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                  className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ChevronLeft size={14} /> Previous
                </button>
                <button
                  type="button"
                  disabled={page >= data.totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Next <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {selected && <RequestDetailPanel log={selected} onClose={() => setSelected(null)} />}
    </section>
  );
}
