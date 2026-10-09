"use client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type Theme = "dark" | "light";
const ThemeContext = createContext({ theme: "light" as Theme, toggle: () => {} });
const preferenceKey = "sr-color-theme";

export function PublicTheme({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>("light");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(preferenceKey);
      if (saved === "dark" || saved === "light") queueMicrotask(() => setTheme(saved));
    } catch { /* Theme switching still works when browser storage is unavailable. */ }
  }, []);
  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    try { localStorage.setItem(preferenceKey, next); } catch { /* Keep the current in-memory choice. */ }
  }
  return <ThemeContext.Provider value={{ theme, toggle }}><div className="public-site" data-theme={theme}>{children}</div></ThemeContext.Provider>;
}

export function ThemeToggle() {
  const { theme, toggle } = useContext(ThemeContext);
  const label = `Switch to ${theme === "dark" ? "light" : "dark"} theme`;
  return <div className="theme-control"><span className="theme-label">Appearance</span>
    <button className="theme-toggle secondary" onClick={toggle} aria-label={label} title={label} aria-pressed={theme === "light"}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        {theme === "dark" ? <path d="M20.9 13.3A9 9 0 0 1 10.7 3.1a9 9 0 1 0 10.2 10.2Z" /> : <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5" /></>}
      </svg><span className="theme-value">{theme === "dark" ? "Dark" : "Light"}</span>
    </button>
  </div>;
}
