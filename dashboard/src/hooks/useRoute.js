import { useCallback, useEffect, useState } from "react";

// A deliberately tiny client-side router - just enough for the Playground
// page to link to "/request-flow?scenario=X" and have that page read it
// back, and for every page to have a real address-bar URL. The dashboard
// has no routing library; this maps a small fixed set of paths to the
// existing tab-based page system rather than introducing one.
const TAB_TO_PATH = {
  Overview: "/overview",
  Requests: "/requests",
  Providers: "/providers",
  Cache: "/cache",
  "API Keys": "/api-keys",
  "Request Flow": "/request-flow",
  Playground: "/playground",
};

const PATH_TO_TAB = { "/": "Overview" };
for (const [tab, path] of Object.entries(TAB_TO_PATH)) {
  PATH_TO_TAB[path] = tab;
}

function tabForPath(pathname) {
  return PATH_TO_TAB[pathname] || "Overview";
}

export function useRoute() {
  const [tab, setTab] = useState(() => tabForPath(window.location.pathname));

  useEffect(() => {
    function onPopState() {
      setTab(tabForPath(window.location.pathname));
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // Accepts either a bare tab name (e.g. "Overview", from the sidebar) or a
  // real path with an optional query string (e.g.
  // "/request-flow?scenario=fallback", from Playground's "View Full
  // Request Flow" link) - both update the address bar via pushState (no
  // full page reload) and the active tab.
  const navigate = useCallback((target) => {
    const path = target.startsWith("/") ? target : TAB_TO_PATH[target] || "/overview";
    window.history.pushState({}, "", path);
    setTab(tabForPath(path.split("?")[0]));
  }, []);

  return { tab, navigate };
}
