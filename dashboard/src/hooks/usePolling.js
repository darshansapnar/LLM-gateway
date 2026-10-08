import { useState, useEffect, useCallback, useRef } from "react";

// Runs `fetcher` immediately, then every `intervalMs`, until the component
// unmounts or something in `deps` changes (which restarts polling fresh -
// e.g. the selected time range). `loading` is only true for the FIRST
// fetch in a given `deps` set, so a background auto-refresh updates the
// numbers in place instead of flashing the whole section back to a spinner.
export function usePolling(fetcher, deps = [], intervalMs = 10000) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  // Always call the LATEST fetcher, without that being a dependency itself -
  // otherwise a new inline fetcher function every render would restart polling.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const load = useCallback(async (isFirstLoad) => {
    try {
      const result = await fetcherRef.current();
      setData(result);
      setError(null);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err.message);
    } finally {
      if (isFirstLoad) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    load(true);
    const interval = setInterval(() => load(false), intervalMs);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading, error, lastUpdated, reload: () => load(false) };
}
