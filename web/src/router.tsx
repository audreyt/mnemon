import {
  createContext,
  useContext,
  useEffect,
  useState,
  type AnchorHTMLAttributes,
  type ReactNode,
} from "react";
import type { Page, Route } from "./types";

export const filterKeys = [
  "q",
  "category",
  "entity",
  "tag",
  "source",
  "importance",
  "since",
  "until",
  "sort",
] as const;
const pages = new Set([
  "overview",
  "library",
  "graph",
  "entities",
  "activity",
  "memories",
]);
export function parseRoute(pathname: string, search = ""): Route {
  const parts = pathname.split("/").filter(Boolean);
  try {
    if (parts.length === 0)
      return { store: "", page: "overview", id: "", search };
    const page = parts[2] as Page;
    if (
      parts[0] !== "s" ||
      !parts[1] ||
      !pages.has(page) ||
      (page === "memories" ? parts.length !== 4 : parts.length !== 3)
    ) {
      return { store: "", page: "missing", id: "", search };
    }
    return {
      store: decodeURIComponent(parts[1]),
      page,
      id: decodeURIComponent(parts[3] || ""),
      search,
    };
  } catch {
    return { store: "", page: "missing", id: "", search };
  }
}
export function routeURL(
  store: string,
  page: Page,
  search = "",
  id = "",
): string {
  return `/s/${encodeURIComponent(store)}/${page}${id ? `/${encodeURIComponent(id)}` : ""}${search ? `?${search.replace(/^\?/, "")}` : ""}`;
}
export function filtersOnly(search: string): URLSearchParams {
  const params = new URLSearchParams(search);
  return new URLSearchParams(
    filterKeys.flatMap((key) =>
      params.get(key) ? [[key, params.get(key)!]] : [],
    ),
  );
}
interface Navigation {
  route: Route;
  navigate: (url: string, replace?: boolean) => void;
}
const RouterContext = createContext<Navigation | null>(null);
export function Router({ children }: { children: ReactNode }) {
  const read = () =>
    parseRoute(window.location.pathname, window.location.search);
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const onPop = () => setRoute(read());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const navigate = (url: string, replace = false) => {
    if (url === window.location.pathname + window.location.search) return;
    const previousPath = window.location.pathname;
    window.history[replace ? "replaceState" : "pushState"](null, "", url);
    setRoute(read());
    if (previousPath !== window.location.pathname) {
      window.scrollTo?.({ top: 0, behavior: "instant" });
    }
  };
  return (
    <RouterContext.Provider value={{ route, navigate }}>
      {children}
    </RouterContext.Provider>
  );
}
export function useRouter() {
  const value = useContext(RouterContext);
  if (!value) throw new Error("Router is required");
  return value;
}
export function Link({
  href,
  onClick,
  children,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const { navigate } = useRouter();
  return (
    <a
      {...props}
      href={href}
      onClick={(event) => {
        onClick?.(event);
        if (
          !event.defaultPrevented &&
          href?.startsWith("/") &&
          event.button === 0 &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.shiftKey &&
          !event.altKey &&
          props.target !== "_blank"
        ) {
          event.preventDefault();
          navigate(href);
        }
      }}
    >
      {children}
    </a>
  );
}
