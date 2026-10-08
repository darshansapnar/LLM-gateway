import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "llm-gateway-dashboard-theme";

function readStoredTheme() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "dark" || stored === "light" ? stored : "light";
  } catch {
    // Private browsing / blocked storage - fall back to the default theme.
    return "light";
  }
}

// Light is the default design; dark is an opt-in toggle persisted per
// browser (not per viewer data, just a convenience, so localStorage is fine
// here). Applies the theme as a `data-theme` attribute on <html>, which is
// what every CSS variable override in index.css keys off.
export function useTheme() {
  const [theme, setTheme] = useState(readStoredTheme);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Ignore - theme just won't persist across reloads.
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === "dark" ? "light" : "dark"));
  }, []);

  return { theme, toggleTheme };
}
