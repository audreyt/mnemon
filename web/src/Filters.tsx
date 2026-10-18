import { useEffect, useState } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { filtersOnly, routeURL, useRouter } from "./router";
import type { Meta, Overview } from "./types";
import { humanize } from "./components";

export function Filters({
  meta,
  facets,
  graph = false,
}: {
  meta: Meta;
  facets?: Overview;
  graph?: boolean;
}) {
  const { route, navigate } = useRouter();
  const params = new URLSearchParams(route.search);
  const [search, setSearch] = useState(params.get("q") || "");
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    setSearch(new URLSearchParams(route.search).get("q") || "");
  }, [route.search]);
  function update(key: string, value: string) {
    const next = new URLSearchParams(route.search);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("cursor");
    navigate(routeURL(route.store, route.page, next.toString()));
  }
  const active = [...filtersOnly(route.search)].filter(
    ([key]) => key !== "sort" && key !== "q",
  );
  return (
    <div className="filters">
      <div className="filter-main">
        <form
          className="search-field"
          onSubmit={(event) => {
            event.preventDefault();
            update("q", search.trim());
          }}
        >
          <Search size={18} />
          <input
            aria-label="Search memories"
            placeholder="Search your memories…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <button
            type="submit"
            className="search-submit"
            aria-label="Submit search"
          >
            Search
          </button>
        </form>
        <label className="select-field">
          <span className="sr-only">Category</span>
          <select
            aria-label="Category"
            value={params.get("category") || ""}
            onChange={(event) => update("category", event.target.value)}
          >
            <option value="">All categories</option>
            {meta.categories.map((category) => (
              <option key={category} value={category}>
                {humanize(category)}
              </option>
            ))}
          </select>
        </label>
        {!graph && (
          <label className="select-field">
            <span className="sr-only">Sort memories</span>
            <select
              aria-label="Sort memories"
              value={params.get("sort") || "newest"}
              onChange={(event) => update("sort", event.target.value)}
            >
              <option value="newest">Newest first</option>
              <option value="updated">Recently updated</option>
              <option value="importance">Importance</option>
              <option value="relevance">Relevance</option>
            </select>
          </label>
        )}
        <button
          className={`button filter-toggle ${expanded ? "selected" : ""}`}
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          <SlidersHorizontal size={16} />
          Filters
          {active.length > 0 && (
            <span className="count-badge">{active.length}</span>
          )}
        </button>
      </div>
      {expanded && (
        <div className="filter-expanded">
          <label>
            Entity
            <input
              value={params.get("entity") || ""}
              onChange={(event) => update("entity", event.target.value)}
              placeholder="Entity name"
              list="entity-options"
            />
            <datalist id="entity-options">
              {facets?.entities?.map((entity) => (
                <option key={entity.name} value={entity.name} />
              ))}
            </datalist>
          </label>
          <label>
            Tag
            <input
              value={params.get("tag") || ""}
              onChange={(event) => update("tag", event.target.value)}
              placeholder="Any tag"
              list="tag-options"
            />
            <datalist id="tag-options">
              {facets?.tags?.map((tag) => (
                <option key={tag} value={tag} />
              ))}
            </datalist>
          </label>
          <label>
            Source
            <input
              value={params.get("source") || ""}
              onChange={(event) => update("source", event.target.value)}
              placeholder="Any source"
              list="source-options"
            />
            <datalist id="source-options">
              {facets?.sources?.map((source) => (
                <option key={source} value={source} />
              ))}
            </datalist>
          </label>
          <label>
            Importance
            <select
              value={params.get("importance") || ""}
              onChange={(event) => update("importance", event.target.value)}
            >
              <option value="">Any importance</option>
              {[1, 2, 3, 4, 5].map((number) => (
                <option key={number} value={number}>
                  {number} / 5
                </option>
              ))}
            </select>
          </label>
          <label>
            Since
            <input
              type="date"
              value={params.get("since") || ""}
              onChange={(event) => update("since", event.target.value)}
            />
          </label>
          <label>
            Until
            <input
              type="date"
              min={params.get("since") || undefined}
              value={params.get("until") || ""}
              onChange={(event) => update("until", event.target.value)}
            />
          </label>
        </div>
      )}
      {(active.length > 0 || params.get("q")) && (
        <div className="active-filters">
          {params.get("q") && (
            <button onClick={() => update("q", "")}>
              Search: {params.get("q")}
              <X size={12} />
            </button>
          )}
          {active.map(([key, value]) => (
            <button key={key} onClick={() => update(key, "")}>
              {humanize(key)}: {value}
              <X size={12} />
            </button>
          ))}
          <button
            className="clear-filters"
            onClick={() => {
              const next = new URLSearchParams(route.search);
              for (const key of filtersOnly(route.search).keys())
                next.delete(key);
              navigate(routeURL(route.store, route.page, next.toString()));
            }}
          >
            Clear filters
          </button>
        </div>
      )}
    </div>
  );
}
