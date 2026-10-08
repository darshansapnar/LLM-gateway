import { useState } from "react";
import Login from "./components/Login.jsx";
import Sidebar from "./components/layout/Sidebar.jsx";
import Overview from "./pages/Overview.jsx";
import RequestsPage from "./pages/RequestsPage.jsx";
import ProvidersPage from "./pages/ProvidersPage.jsx";
import CachePage from "./pages/CachePage.jsx";
import ApiKeysPage from "./pages/ApiKeysPage.jsx";
import RequestFlow from "./pages/RequestFlow.jsx";
import Playground from "./pages/Playground.jsx";
import { useTheme } from "./hooks/useTheme.js";
import { useRoute } from "./hooks/useRoute.js";

const PAGES = {
  Overview,
  Requests: RequestsPage,
  Providers: ProvidersPage,
  Cache: CachePage,
  "API Keys": ApiKeysPage,
  "Request Flow": RequestFlow,
  Playground,
};

export default function App() {
  // The admin key lives ONLY in this piece of React state - never written
  // to localStorage/sessionStorage, so a page reload logs the dashboard out.
  const [adminKey, setAdminKey] = useState(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();
  // A minimal client-side router (see hooks/useRoute.js) - gives every page
  // a real URL and lets Playground deep-link into Request Flow with a
  // ?scenario= query param, without pulling in a routing library.
  const { tab: activeTab, navigate } = useRoute();
  // A one-shot, in-memory-only handoff for ApiKeysPage's "Use in Playground"
  // button: the freshly-created key never touches the URL or any storage -
  // it's just React state here, read once by Playground.jsx on mount and
  // immediately cleared (see onPrefillConsumed) so revisiting the tab later
  // doesn't silently re-inject a stale key over whatever's typed there.
  const [playgroundPrefillKey, setPlaygroundPrefillKey] = useState(null);

  if (!adminKey) {
    return <Login onLogin={setAdminKey} />;
  }

  const ActivePage = PAGES[activeTab];

  function handleUseKeyInPlayground(key) {
    setPlaygroundPrefillKey(key);
    navigate("Playground");
  }

  return (
    <div className="flex min-h-screen bg-bg">
      <Sidebar
        activeTab={activeTab}
        onSelect={navigate}
        theme={theme}
        onToggleTheme={toggleTheme}
        onLogout={() => setAdminKey(null)}
        mobileOpen={mobileNavOpen}
        onCloseMobile={() => setMobileNavOpen(false)}
      />

      <main className="min-w-0 flex-1 px-4 py-5 sm:px-6 lg:px-8">
        <ActivePage
          adminKey={adminKey}
          onOpenMobileNav={() => setMobileNavOpen(true)}
          onNavigate={navigate}
          onUseKeyInPlayground={handleUseKeyInPlayground}
          playgroundPrefillKey={playgroundPrefillKey}
          onPrefillConsumed={() => setPlaygroundPrefillKey(null)}
        />
      </main>
    </div>
  );
}
