import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
  type ReactNode,
} from "react";

export type ThemeMode = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

type Theme = {
  mode: ThemeMode;
  resolved: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
};

const storageKey = "mnemon-appearance";
const mediaQuery = "(prefers-color-scheme: dark)";
const ThemeContext = createContext<Theme | null>(null);

function parseMode(value: string | null): ThemeMode {
  return value === "light" || value === "dark" ? value : "system";
}

function readMode(): ThemeMode {
  try {
    return parseMode(window.localStorage.getItem(storageKey));
  } catch {
    return "system";
  }
}

function getMedia(): MediaQueryList | null {
  try {
    return window.matchMedia(mediaQuery);
  } catch {
    return null;
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [media] = useState(getMedia);
  const [mode, setModeState] = useState<ThemeMode>(readMode);
  const [systemDark, setSystemDark] = useState(() => media?.matches ?? false);
  const resolved: ResolvedTheme =
    mode === "system" ? (systemDark ? "dark" : "light") : mode;

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = resolved;
    document.documentElement.style.colorScheme = resolved;
  }, [resolved]);

  useEffect(() => {
    if (!media) return;
    const update = () => setSystemDark(media.matches);
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", update);
      update();
      return () => media.removeEventListener("change", update);
    }
    media.addListener?.(update);
    update();
    return () => media.removeListener?.(update);
  }, [media]);

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key !== storageKey && event.key !== null) return;
      try {
        if (event.storageArea && event.storageArea !== window.localStorage)
          return;
      } catch {
        // Storage access may be denied while event delivery remains available.
      }
      setModeState(parseMode(event.key === null ? null : event.newValue));
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    try {
      window.localStorage.setItem(storageKey, next);
    } catch {
      // Appearance still works for this tab when persistence is unavailable.
    }
  }, []);

  return (
    <ThemeContext.Provider value={{ mode, resolved, setMode }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): Theme {
  const theme = useContext(ThemeContext);
  if (!theme) throw new Error("useTheme must be used within ThemeProvider");
  return theme;
}
