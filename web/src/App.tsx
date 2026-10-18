import { lazy, Suspense, useEffect, useState } from "react";
import {
  Activity,
  ArrowUpRight,
  BookOpen,
  ChevronRight,
  CircleHelp,
  Hash,
  LayoutDashboard,
  Menu,
  Monitor,
  Moon,
  Sun,
  Network,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { useQuery } from "./api";
import { Empty, humanize, QueryView } from "./components";
import { filtersOnly, Link, routeURL, useRouter } from "./router";
import type { Meta, Page } from "./types";
import { useTheme, type ThemeMode } from "./theme";
import {
  ActivityView,
  EntitiesView,
  LibraryView,
  OverviewView,
  ReaderView,
} from "./Views";

const GraphView = lazy(() =>
  import("./GraphView").then((module) => ({ default: module.GraphView })),
);

const navigation = [
  { page: "overview", label: "Overview", icon: LayoutDashboard },
  { page: "library", label: "Memory library", icon: BookOpen },
  { page: "graph", label: "Knowledge graph", icon: Network },
  { page: "entities", label: "Entities", icon: Hash },
  { page: "activity", label: "Activity", icon: Activity },
] as const;
export function App() {
  const meta = useQuery<Meta>("/api/meta");
  return (
    <QueryView query={meta}>{(data) => <Workspace meta={data} />}</QueryView>
  );
}
function Workspace({ meta }: { meta: Meta }) {
  const { route, navigate } = useRouter();
  const stores = useQuery<{ stores: string[] }>("/api/stores");
  const [refresh, setRefresh] = useState(0);
  const [sidebar, setSidebar] = useState(false);
  const [help, setHelp] = useState(false);
  const [search, setSearch] = useState("");
  useEffect(() => {
    if (
      !route.store &&
      route.page !== "missing" &&
      stores.data?.stores.length
    ) {
      const initial = stores.data.stores.includes(meta.initial_store)
        ? meta.initial_store
        : stores.data.stores[0];
      navigate(routeURL(initial, "overview"), true);
    }
  }, [route.store, route.page, stores.data, meta.initial_store, navigate]);
  useEffect(() => {
    setSidebar(false);
    setSearch("");
  }, [route.store, route.page, route.id]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSidebar(false);
        setHelp(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  const activePage = route.page === "memories" ? "library" : route.page;
  const label =
    navigation.find((item) => item.page === activePage)?.label || "Workspace";
  const storeList = stores.data?.stores || [];
  return (
    <div className="app-shell">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      {sidebar && (
        <button
          className="sidebar-scrim"
          aria-label="Close navigation"
          onClick={() => setSidebar(false)}
        />
      )}
      <aside
        className={`sidebar ${sidebar ? "open" : ""}`}
        aria-label="Workspace navigation"
      >
        <Link
          href={route.store ? routeURL(route.store, "overview") : "/"}
          className="brand"
        >
          <img
            className="brand-logo"
            src="/mnemon-logo.svg"
            alt=""
            width="40"
            height="40"
          />
          <span>mnemon</span>
        </Link>
        <div className="workspace-selector">
          <label htmlFor="store-selector">Workspace</label>
          <div>
            <span className="workspace-avatar">
              {(route.store || "M").slice(0, 1).toUpperCase()}
            </span>
            <select
              id="store-selector"
              aria-label="Select memory store"
              value={route.store}
              disabled={!storeList.length}
              onChange={(event) =>
                navigate(
                  routeURL(
                    event.target.value,
                    route.page === "missing" || route.page === "memories"
                      ? "overview"
                      : route.page,
                  ),
                )
              }
            >
              {!storeList.includes(route.store) && (
                <option value={route.store}>
                  {route.store || "Choose a space"}
                </option>
              )}
              {storeList.map((store) => (
                <option key={store} value={store}>
                  {store}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="nav-label">Knowledge</div>
        <nav>
          {navigation.map((item) => (
            <Link
              key={item.page}
              href={
                route.store
                  ? routeURL(
                      route.store,
                      item.page,
                      ["library", "graph"].includes(item.page)
                        ? filtersOnly(route.search).toString()
                        : "",
                    )
                  : "/"
              }
              className={`nav-link ${activePage === item.page ? "active" : ""}`}
              aria-current={activePage === item.page ? "page" : undefined}
            >
              <item.icon size={18} strokeWidth={1.7} />
              {item.label}
              {activePage === item.page && <span className="nav-active-dot" />}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <div>
              <span className="live-dot" />
              Local & private
            </div>
            <p>
              Your agents’ knowledge,
              <br />
              ready to explore.
            </p>
            <span>
              Read-only workspace <ArrowUpRight size={12} />
            </span>
          </div>
          <button className="help-button" onClick={() => setHelp(true)}>
            <CircleHelp size={17} />
            About this workspace
          </button>
          <div className="sidebar-version">
            mnemon <span>{meta.version}</span>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            aria-label="Open navigation"
            aria-expanded={sidebar}
            onClick={() => setSidebar(true)}
          >
            <Menu size={20} />
          </button>
          <div className="breadcrumbs">
            <span>{route.store || "Workspace"}</span>
            <ChevronRight size={14} />
            <span>{label}</span>
            {route.page === "memories" && (
              <>
                <ChevronRight size={14} />
                <span>Memory</span>
              </>
            )}
          </div>
          <div className="topbar-actions">
            <form
              className="global-search"
              onSubmit={(event) => {
                event.preventDefault();
                if (route.store)
                  navigate(
                    routeURL(
                      route.store,
                      "library",
                      new URLSearchParams(
                        search.trim() ? { q: search.trim() } : {},
                      ).toString(),
                    ),
                  );
              }}
            >
              <Search size={15} />
              <input
                aria-label="Search all memories in this store"
                placeholder="Find a memory…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <button type="submit" aria-label="Search this store">
                <ArrowUpRight size={14} />
              </button>
            </form>
            <button
              className="icon-button refresh-button"
              aria-label="Refresh current view"
              title="Refresh current view"
              onClick={() => {
                setRefresh((value) => value + 1);
                stores.refresh();
              }}
            >
              <RefreshCw size={16} />
            </button>
            <AppearanceControl />
            <span className="topbar-divider" />
            <span className="local-status">
              <span className="live-dot" />
              Local workspace
            </span>
          </div>
        </header>
        <main
          id="main"
          className={`main-content ${route.page === "memories" ? "reader-page" : ""}`}
          tabIndex={-1}
        >
          {stores.error && (
            <div className="notice warning" role="alert">
              Store discovery failed: {stores.error.message}
              <button onClick={stores.refresh}>Retry</button>
            </div>
          )}
          {route.page === "missing" ? (
            <Empty title="This page isn’t here">
              <p>
                Return to your <Link href="/">workspace overview</Link>.
              </p>
            </Empty>
          ) : !route.store ? (
            <QueryView query={stores}>
              {() => (
                <Empty title="A home for your memories">
                  <p>
                    No memory stores were found. Create a store with Mnemon to
                    get started, then refresh this workspace.
                  </p>
                  <button className="button" onClick={stores.refresh}>
                    <RefreshCw size={15} />
                    Refresh stores
                  </button>
                </Empty>
              )}
            </QueryView>
          ) : (
            <StoreView
              key={route.store}
              page={route.page}
              meta={meta}
              refresh={refresh}
            />
          )}
        </main>
        <footer className="app-footer">
          <span>Knowledge accumulated. Context preserved.</span>
          <span>Mnemon · Knowledge workspace</span>
        </footer>
      </div>
      {help && (
        <div className="dialog-backdrop" onClick={() => setHelp(false)}>
          <section
            className="about-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="about-title"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === "Tab") {
                event.preventDefault();
                event.currentTarget
                  .querySelector<HTMLElement>("button")
                  ?.focus();
              }
            }}
          >
            <button
              autoFocus
              className="icon-button dialog-close"
              aria-label="Close workspace information"
              onClick={() => setHelp(false)}
            >
              <X size={18} />
            </button>
            <img
              className="brand-logo"
              src="/mnemon-logo.svg"
              alt=""
              width="48"
              height="48"
            />
            <h2 id="about-title">Your memory workspace</h2>
            <p>
              Mnemon is a local, read-only window into the memories your agents
              have stored. Browsing does not change your memories or their
              access counts.
            </p>
            <p>
              Views refresh every 15 seconds while this tab is visible. You can
              refresh manually at any time. Source values reflect stored
              metadata.
            </p>
            <p>
              All application assets are bundled locally. Markdown images stay
              hidden to keep browsing private.
            </p>
            <span className="muted">Version {meta.version}</span>
          </section>
        </div>
      )}
    </div>
  );
}
function AppearanceControl() {
  const { mode, setMode } = useTheme();
  const Icon = mode === "system" ? Monitor : mode === "dark" ? Moon : Sun;
  return (
    <label className="theme-control" title="Appearance">
      <Icon size={16} aria-hidden="true" />
      <span className="sr-only">Appearance</span>
      <select
        aria-label="Appearance"
        value={mode}
        onChange={(event) => setMode(event.target.value as ThemeMode)}
      >
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </label>
  );
}
function StoreView({
  page,
  meta,
  refresh,
}: {
  page: Page;
  meta: Meta;
  refresh: number;
}) {
  useEffect(() => {
    document.title = `${humanize(page === "memories" ? "Memory" : page)} · Mnemon`;
  }, [page]);
  if (page === "overview")
    return <OverviewView meta={meta} refresh={refresh} />;
  if (page === "library") return <LibraryView meta={meta} refresh={refresh} />;
  if (page === "memories") return <ReaderView refresh={refresh} />;
  if (page === "graph")
    return (
      <Suspense
        fallback={
          <div className="loading-state" role="status">
            Opening your knowledge graph…
          </div>
        }
      >
        <GraphView meta={meta} refresh={refresh} />
      </Suspense>
    );
  if (page === "entities") return <EntitiesView refresh={refresh} />;
  if (page === "activity") return <ActivityView refresh={refresh} />;
  return null;
}
