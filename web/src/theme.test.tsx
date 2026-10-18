import { StrictMode } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import bootstrap from "../public/appearance.js?raw";
import indexHTML from "../index.html?raw";
import { ThemeProvider, useTheme, type ThemeMode } from "./theme";

const storageKey = "mnemon-appearance";
const mediaQuery = "(prefers-color-scheme: dark)";

function mockMedia(dark: boolean, legacy = false) {
  const listeners = new Set<() => void>();
  const media = {
    matches: dark,
    media: mediaQuery,
    addEventListener: legacy
      ? undefined
      : vi.fn((_type: string, listener: () => void) => listeners.add(listener)),
    removeEventListener: legacy
      ? undefined
      : vi.fn((_type: string, listener: () => void) =>
          listeners.delete(listener),
        ),
    addListener: vi.fn((listener: () => void) => listeners.add(listener)),
    removeListener: vi.fn((listener: () => void) => listeners.delete(listener)),
  };
  const matchMedia = vi.fn(() => media);
  vi.stubGlobal("matchMedia", matchMedia);
  return {
    media,
    matchMedia,
    listeners,
    change(next: boolean) {
      act(() => {
        media.matches = next;
        listeners.forEach((listener) => listener());
      });
    },
  };
}

function Consumer() {
  const { mode, resolved, setMode } = useTheme();
  return (
    <>
      <output data-testid="mode">{mode}</output>
      <output data-testid="resolved">{resolved}</output>
      {(["system", "light", "dark"] as ThemeMode[]).map((value) => (
        <button key={value} onClick={() => setMode(value)}>
          {value}
        </button>
      ))}
    </>
  );
}

function mount() {
  return render(
    <StrictMode>
      <ThemeProvider>
        <Consumer />
      </ThemeProvider>
    </StrictMode>,
  );
}

function expectTheme(mode: ThemeMode, resolved: "light" | "dark") {
  expect(screen.getByTestId("mode")).toHaveTextContent(mode);
  expect(screen.getByTestId("resolved")).toHaveTextContent(resolved);
  expect(document.documentElement.dataset.theme).toBe(resolved);
  expect(document.documentElement.style.colorScheme).toBe(resolved);
}

function storageEvent(key: string | null, newValue: string | null) {
  act(() => {
    window.dispatchEvent(new StorageEvent("storage", { key, newValue }));
  });
}

function runBootstrap() {
  // Executing the shipped script here also checks that it is valid classic JS.
  window.eval(bootstrap);
}

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    removeItem: vi.fn((key: string) => values.delete(key)),
    clear: vi.fn(() => values.clear()),
  });
  delete document.documentElement.dataset.theme;
  document.documentElement.style.colorScheme = "";
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("theme provider", () => {
  it("follows system changes only while system mode is selected", () => {
    const media = mockMedia(true);
    mount();
    expectTheme("system", "dark");
    expect(media.matchMedia).toHaveBeenCalledWith(mediaQuery);
    media.change(false);
    expectTheme("system", "light");
    fireEvent.click(screen.getByRole("button", { name: "dark" }));
    media.change(true);
    media.change(false);
    expectTheme("dark", "dark");
    fireEvent.click(screen.getByRole("button", { name: "system" }));
    expectTheme("system", "light");
    expect(localStorage.getItem(storageKey)).toBe("system");
    media.change(true);
    expectTheme("system", "dark");
  });

  it.each(["light", "dark"] as const)(
    "persists an explicit %s selection across remounts",
    (mode) => {
      mockMedia(mode === "light");
      const first = mount();
      fireEvent.click(screen.getByRole("button", { name: mode }));
      expectTheme(mode, mode);
      expect(localStorage.getItem(storageKey)).toBe(mode);
      first.unmount();
      mount();
      expectTheme(mode, mode);
    },
  );

  it("syncs other tabs, deletion, invalid values, and clear without writing back", () => {
    const media = mockMedia(true);
    const persist = vi.spyOn(window.localStorage, "setItem");
    mount();
    storageEvent(storageKey, "light");
    expectTheme("light", "light");
    storageEvent("unrelated", "dark");
    expectTheme("light", "light");
    storageEvent(storageKey, null);
    expectTheme("system", "dark");
    storageEvent(storageKey, "dark");
    storageEvent(null, null);
    expectTheme("system", "dark");
    storageEvent(storageKey, "LIGHT");
    media.change(false);
    expectTheme("system", "light");
    expect(persist).not.toHaveBeenCalled();
  });

  it("ignores session storage events", () => {
    mockMedia(true);
    mount();
    act(() => {
      const event = new StorageEvent("storage", {
        key: storageKey,
        newValue: "light",
      });
      Object.defineProperty(event, "storageArea", { value: {} });
      window.dispatchEvent(event);
    });
    expectTheme("system", "dark");
  });

  it("can toggle when storage access is denied", () => {
    mockMedia(true);
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("Denied", "SecurityError");
      },
    });
    runBootstrap();
    expect(document.documentElement.dataset.theme).toBe("dark");
    mount();
    expectTheme("system", "dark");
    fireEvent.click(screen.getByRole("button", { name: "light" }));
    expectTheme("light", "light");
    storageEvent(storageKey, "dark");
    expectTheme("dark", "dark");
  });

  it("keeps manual mode when storage writes fail", () => {
    mockMedia(false);
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("Full", "QuotaExceededError");
    });
    mount();
    fireEvent.click(screen.getByRole("button", { name: "dark" }));
    expectTheme("dark", "dark");
  });

  it.each([false, true])(
    "cleans up %s legacy media listeners and storage listeners in StrictMode",
    (legacy) => {
      const media = mockMedia(false, legacy);
      const add = vi.spyOn(window, "addEventListener");
      const remove = vi.spyOn(window, "removeEventListener");
      const view = mount();
      expect(media.listeners.size).toBe(1);
      media.change(true);
      expectTheme("system", "dark");
      view.unmount();
      expect(media.listeners.size).toBe(0);
      for (const [type, listener] of add.mock.calls) {
        if (type === "storage")
          expect(remove).toHaveBeenCalledWith("storage", listener);
      }
      if (legacy) expect(media.media.removeListener).toHaveBeenCalled();
      else expect(media.media.removeEventListener).toHaveBeenCalled();
    },
  );

  it("requires a provider", () => {
    expect(() => render(<Consumer />)).toThrow(
      "useTheme must be used within ThemeProvider",
    );
  });
});

describe("early appearance bootstrap parity", () => {
  const storedModes = [
    null,
    "system",
    "light",
    "dark",
    "Dark",
    " light ",
    "",
    "{}",
  ];
  it.each(
    storedModes.flatMap((stored) =>
      [false, true].map((dark) => ({ stored, dark })),
    ),
  )(
    "matches provider initialization for $stored with dark system $dark",
    ({ stored, dark }) => {
      mockMedia(dark);
      if (stored !== null) localStorage.setItem(storageKey, stored);
      const expectedMode =
        stored === "light" || stored === "dark" ? stored : "system";
      const expectedResolved =
        expectedMode === "system" ? (dark ? "dark" : "light") : expectedMode;
      runBootstrap();
      expect(document.documentElement.dataset.theme).toBe(expectedResolved);
      expect(document.documentElement.style.colorScheme).toBe(expectedResolved);
      mount();
      expectTheme(expectedMode, expectedResolved);
    },
  );

  it.each(["unavailable", "throwing"])(
    "falls back safely when matchMedia is %s",
    (state) => {
      vi.stubGlobal(
        "matchMedia",
        state === "unavailable"
          ? undefined
          : () => {
              throw new Error("Unavailable");
            },
      );
      runBootstrap();
      expect(document.documentElement.dataset.theme).toBe("light");
      mount();
      expectTheme("system", "light");
      fireEvent.click(screen.getByRole("button", { name: "dark" }));
      expectTheme("dark", "dark");
    },
  );

  it("loads an external blocking script in head before app assets without inline scripts", () => {
    const page = new DOMParser().parseFromString(indexHTML, "text/html");
    const script = page.head.querySelector('script[src="/appearance.js"]');
    expect(script).not.toBeNull();
    expect(script?.hasAttribute("async")).toBe(false);
    expect(script?.hasAttribute("defer")).toBe(false);
    expect(script?.getAttribute("type")).not.toBe("module");
    expect(page.querySelector("script:not([src])")).toBeNull();
    expect(indexHTML.indexOf("/appearance.js")).toBeLessThan(
      indexHTML.indexOf("/src/main.tsx"),
    );
    for (const asset of page.head.querySelectorAll(
      'link[rel="stylesheet"], style, script[type="module"]',
    )) {
      expect(
        script!.compareDocumentPosition(asset) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });
});
