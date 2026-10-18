import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Clock3,
  Hash,
  Layers3,
  Network,
  Search,
  Shapes,
} from "lucide-react";
import { storeAPI, useQuery } from "./api";
import {
  Category,
  CopyButton,
  date,
  Empty,
  Importance,
  LastUpdated,
  Markdown,
  MemoryCard,
  PageHeading,
  QueryView,
  ReaderLink,
  SectionTitle,
  title,
} from "./components";
import { Filters } from "./Filters";
import { filtersOnly, Link, routeURL, useRouter } from "./router";
import type {
  ActivityPage,
  EntityPage,
  MemoryDetail,
  MemoryPage,
  Meta,
  Overview,
} from "./types";

export function OverviewView({
  meta,
  refresh,
}: {
  meta: Meta;
  refresh: number;
}) {
  const { route } = useRouter();
  const query = useQuery<Overview>(storeAPI(route.store, "overview"), refresh);
  return (
    <>
      <PageHeading
        eyebrow="YOUR KNOWLEDGE, CONNECTED"
        title="A little more clarity."
        description="A home for everything your agents have learned along the way."
        action={
          <Link
            className="button primary"
            href={routeURL(route.store, "library")}
          >
            <BookOpen size={16} />
            Explore memories
            <ArrowRight size={15} />
          </Link>
        }
      />
      <QueryView query={query}>
        {(data) => (
          <>
            <div className="overview-banner">
              <div className="banner-mark">
                <Layers3 size={28} />
              </div>
              <div>
                <span className="eyebrow">THE BIGGER PICTURE</span>
                <h2>Small memories. Lasting knowledge.</h2>
                <p>
                  Your decisions, discoveries, and context — gathered in one
                  quiet place.
                </p>
              </div>
              <div className="banner-orbit" aria-hidden="true">
                <span />
                <span />
                <span />
                <i />
                <i />
                <i />
              </div>
            </div>
            <div className="stats-row">
              <div className="stat-card">
                <span>
                  <BookOpen size={16} />
                  Memories
                </span>
                <strong>{data.total.toLocaleString()}</strong>
                <small>Pieces of durable knowledge</small>
              </div>
              <div className="stat-card">
                <span>
                  <Network size={16} />
                  Connections
                </span>
                <strong>{data.edge_count.toLocaleString()}</strong>
                <small>Relationships between memories</small>
              </div>
              <div className="stat-card">
                <span>
                  <Shapes size={16} />
                  Categories
                </span>
                <strong>
                  {
                    Object.values(data.by_category || {}).filter(
                      (count) => count > 0,
                    ).length
                  }
                </strong>
                <small>Different ways of knowing</small>
              </div>
            </div>
            <SectionTitle>By category</SectionTitle>
            <div className="category-grid">
              {[
                ...new Set([
                  ...meta.categories,
                  ...Object.keys(data.by_category || {}),
                ]),
              ].map((category) => (
                <Link
                  className="category-tile"
                  key={category}
                  href={routeURL(
                    route.store,
                    "library",
                    new URLSearchParams({ category }).toString(),
                  )}
                >
                  <Category value={category} />
                  <strong>
                    {(data.by_category?.[category] || 0).toLocaleString()}
                  </strong>
                  <ArrowRight size={15} />
                </Link>
              ))}
            </div>
            <div className="overview-columns">
              <section>
                <SectionTitle href={routeURL(route.store, "library")}>
                  Recently remembered
                </SectionTitle>
                {data.recent?.length ? (
                  <div className="recent-list">
                    {data.recent.slice(0, 6).map((memory) => (
                      <MemoryCard key={memory.id} memory={memory} compact />
                    ))}
                  </div>
                ) : (
                  <Empty title="A fresh start">
                    <p>Memories added by your agents will appear here.</p>
                  </Empty>
                )}
              </section>
              <aside>
                <SectionTitle href={routeURL(route.store, "entities")}>
                  Connected entities
                </SectionTitle>
                <div className="entity-panel">
                  {data.entities?.length ? (
                    data.entities.slice(0, 8).map((entity) => (
                      <Link
                        key={entity.name}
                        href={routeURL(
                          route.store,
                          "library",
                          new URLSearchParams({
                            entity: entity.name,
                          }).toString(),
                        )}
                      >
                        <span className="entity-avatar">
                          <Hash size={15} />
                        </span>
                        <span>{entity.name}</span>
                        <span className="entity-count">{entity.count}</span>
                        <ArrowRight size={14} />
                      </Link>
                    ))
                  ) : (
                    <p className="muted">No entities recorded yet.</p>
                  )}
                  <div className="panel-note">
                    <Network size={19} />
                    <p>
                      Follow the connections.
                      <br />
                      <Link href={routeURL(route.store, "graph")}>
                        See your knowledge graph <ArrowRight size={12} />
                      </Link>
                    </p>
                  </div>
                </div>
              </aside>
            </div>
            <OverviewActivity refresh={refresh} />
            <footer className="view-footer">
              <LastUpdated value={data.updated_at} loading={query.loading} />
              <span>Read-only · Your memories stay yours</span>
            </footer>
          </>
        )}
      </QueryView>
    </>
  );
}
function OverviewActivity({ refresh }: { refresh: number }) {
  const { route } = useRouter();
  const query = useQuery<ActivityPage>(
    storeAPI(route.store, "activity", new URLSearchParams({ limit: "5" })),
    refresh,
  );
  return (
    <section className="overview-activity">
      <SectionTitle href={routeURL(route.store, "activity")}>
        Recent activity
      </SectionTitle>
      <QueryView query={query}>
        {(data) =>
          data.items?.length ? (
            <div className="activity-list">
              {data.items.map((item) => (
                <article key={item.id} className="activity-item">
                  <div className="activity-icon">
                    <Clock3 size={15} />
                  </div>
                  <div>
                    <strong>{item.operation}</strong>
                    {item.available ? (
                      <ReaderLink id={item.insight_id} />
                    ) : (
                      <span className="unavailable">
                        Memory unavailable · {item.insight_id}
                      </span>
                    )}
                  </div>
                  <time dateTime={item.created_at}>
                    {date(item.created_at, true)}
                  </time>
                </article>
              ))}
            </div>
          ) : (
            <p className="muted">No activity recorded yet.</p>
          )
        }
      </QueryView>
    </section>
  );
}
export function LibraryView({
  meta,
  refresh,
}: {
  meta: Meta;
  refresh: number;
}) {
  const { route } = useRouter();
  const params = filtersOnly(route.search);
  params.set("limit", "24");
  const query = useQuery<MemoryPage>(
    storeAPI(route.store, "memories", params),
    refresh,
    true,
  );
  const facets = useQuery<Overview>(storeAPI(route.store, "overview"), refresh);
  return (
    <>
      <PageHeading
        eyebrow="YOUR COLLECTION"
        title="Memory library"
        description="Find the thought you need. Follow it somewhere new."
      />
      <Filters meta={meta} facets={facets.data} />
      <QueryView query={query}>
        {(data) => (
          <>
            <div className="results-line">
              <span>
                <strong>{data.total.toLocaleString()}</strong>{" "}
                {data.total === 1 ? "memory" : "memories"}
                {filtersOnly(route.search).size > 0
                  ? " matching this view"
                  : " in this space"}
              </span>
              <LastUpdated value={data.updated_at} loading={query.loading} />
            </div>
            {data.truncated && (
              <p className="notice">
                This search uses a bounded candidate set. Narrow your filters to
                explore more precisely.
              </p>
            )}
            {data.items?.length ? (
              <div className="memory-grid">
                {data.items.map((memory) => (
                  <MemoryCard key={memory.id} memory={memory} />
                ))}
              </div>
            ) : (
              <Empty
                title={
                  filtersOnly(route.search).size
                    ? "No matching memories"
                    : "Your library is ready"
                }
                icon={filtersOnly(route.search).size ? "search" : "empty"}
              >
                <p>
                  {filtersOnly(route.search).size
                    ? "Try a different search or clear a filter to open things up."
                    : "When your agents remember something, you’ll find it here."}
                </p>
              </Empty>
            )}
            {data.next_cursor && (
              <div className="pagination">
                <button
                  className="button"
                  onClick={query.loadMore}
                  disabled={query.loading || query.loadingMore}
                >
                  {query.loadingMore ? "Loading…" : "Load more memories"}
                  <ArrowRight size={15} />
                </button>
                <span>
                  Showing {data.items.length} of {data.total} · Live results may
                  change
                </span>
              </div>
            )}
          </>
        )}
      </QueryView>
    </>
  );
}
export function ReaderView({ refresh }: { refresh: number }) {
  const { route } = useRouter();
  const query = useQuery<MemoryDetail>(
    storeAPI(route.store, `memories/${encodeURIComponent(route.id)}`),
    refresh,
  );
  return (
    <>
      <Link
        className="back-link"
        href={routeURL(
          route.store,
          "library",
          filtersOnly(route.search).toString(),
        )}
      >
        <ArrowLeft size={15} />
        Back to library
      </Link>
      <QueryView query={query} unavailable>
        {(data) => (
          <div className="reader-layout">
            <article className="reader">
              <div className="reader-kicker">
                <Category value={data.memory.category} />
                <span>MEMORY</span>
              </div>
              <h1>{title(data.memory.content)}</h1>
              <div className="reader-meta">
                <span>
                  <Clock3 size={14} />
                  {date(data.memory.created_at)}
                </span>
                <span>{data.memory.source || "No source recorded"}</span>
                <Importance value={data.memory.importance} />
              </div>
              {!!data.superseded_by?.length && (
                <div className="notice warning">
                  <div>
                    <strong>This memory has been replaced.</strong>
                    <p>Read the newer memory for the current information.</p>
                    {data.superseded_by.map((id) => (
                      <ReaderLink key={id} id={id} />
                    ))}
                  </div>
                </div>
              )}
              <Markdown content={data.memory.content} />
              <div className="reader-actions">
                <CopyButton value={data.memory.content} label="Copy content" />
                <CopyButton value={data.memory.id} label="Copy ID" />
              </div>
              <SectionTitle>Related memories</SectionTitle>
              {data.related?.length ? (
                <div className="related-grid">
                  {data.related.map((memory) => (
                    <MemoryCard key={memory.id} memory={memory} compact />
                  ))}
                </div>
              ) : (
                <p className="muted">No related memories recorded.</p>
              )}
              {data.truncated && (
                <p className="notice">
                  The related memory list is bounded. Explore the graph for more
                  context.
                </p>
              )}
            </article>
            <aside className="reader-sidebar">
              <h2>Memory details</h2>
              <dl>
                <dt>Category</dt>
                <dd>
                  <Category value={data.memory.category} />
                </dd>
                <dt>Source</dt>
                <dd>{data.memory.source || "Not recorded"}</dd>
                <dt>Importance</dt>
                <dd>
                  <Importance value={data.memory.importance} />{" "}
                  {data.memory.importance} / 5
                </dd>
                <dt>Created</dt>
                <dd>{date(data.memory.created_at, true)}</dd>
                <dt>Updated</dt>
                <dd>{date(data.memory.updated_at, true)}</dd>
                <dt>Access count</dt>
                <dd>{data.memory.access_count}</dd>
                <dt>Memory ID</dt>
                <dd className="mono">{data.memory.id}</dd>
              </dl>
              <h2>Entities</h2>
              <div className="chip-list">
                {data.memory.entities?.length ? (
                  data.memory.entities.map((entity) => (
                    <Link
                      key={entity}
                      href={routeURL(
                        route.store,
                        "library",
                        new URLSearchParams({ entity }).toString(),
                      )}
                    >
                      <Hash size={12} />
                      {entity}
                    </Link>
                  ))
                ) : (
                  <span className="muted">None recorded</span>
                )}
              </div>
              <h2>Tags</h2>
              <div className="chip-list">
                {data.memory.tags?.length ? (
                  data.memory.tags.map((tag) => (
                    <Link
                      key={tag}
                      href={routeURL(
                        route.store,
                        "library",
                        new URLSearchParams({ tag }).toString(),
                      )}
                    >
                      {tag}
                    </Link>
                  ))
                ) : (
                  <span className="muted">None recorded</span>
                )}
              </div>
              {!!data.replaces?.length && (
                <>
                  <h2>Replaces</h2>
                  <p className="muted small">
                    This memory corrects or supersedes:
                  </p>
                  <div className="lineage">
                    {data.replaces.map((id) => (
                      <ReaderLink key={id} id={id} />
                    ))}
                  </div>
                </>
              )}
              {!!data.superseded_by?.length && (
                <>
                  <h2>Replaced by</h2>
                  <div className="lineage">
                    {data.superseded_by.map((id) => (
                      <ReaderLink key={id} id={id} />
                    ))}
                  </div>
                </>
              )}
              <Link
                className="button"
                href={routeURL(
                  route.store,
                  "graph",
                  new URLSearchParams({ focus: data.memory.id }).toString(),
                )}
              >
                <Network size={15} />
                Explore neighborhood
              </Link>
              {!!data.edges?.length && (
                <>
                  <h2>Stored relationships</h2>
                  <div className="edge-details">
                    {data.edges.map((edge, index) => (
                      <div key={index}>
                        <strong>{edge.edge_type}</strong>
                        <span className="mono">
                          {edge.source_id} → {edge.target_id}
                        </span>
                        <span>Weight: {edge.weight}</span>
                        {Object.entries(edge.metadata || {}).map(
                          ([key, value]) => (
                            <span key={key}>
                              {key}: {value}
                            </span>
                          ),
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </aside>
          </div>
        )}
      </QueryView>
    </>
  );
}
export function EntitiesView({ refresh }: { refresh: number }) {
  const { route, navigate } = useRouter();
  const params = new URLSearchParams({ limit: "50" });
  const term = new URLSearchParams(route.search).get("q") || "";
  if (term) params.set("q", term);
  const [search, setSearch] = useState(term);
  useEffect(() => setSearch(term), [term]);
  const query = useQuery<EntityPage>(
    storeAPI(route.store, "entities", params),
    refresh,
    true,
  );
  return (
    <>
      <PageHeading
        eyebrow="THE THREADS BETWEEN IDEAS"
        title="Entities"
        description="People, projects, and concepts that bring your memories together."
      />
      <form
        className="search-field entity-search"
        onSubmit={(event) => {
          event.preventDefault();
          navigate(
            routeURL(
              route.store,
              "entities",
              new URLSearchParams(
                search.trim() ? { q: search.trim() } : {},
              ).toString(),
            ),
          );
        }}
      >
        <Search size={18} />
        <input
          aria-label="Search entities"
          placeholder="Find a person, project, or concept…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <button type="submit" className="search-submit">
          Search
        </button>
      </form>
      <QueryView query={query}>
        {(data) => (
          <>
            <div className="results-line">
              <span>
                <strong>{data.total}</strong> entities
              </span>
              <LastUpdated value={data.updated_at} loading={query.loading} />
            </div>
            {data.items?.length ? (
              <div className="entities-grid">
                {data.items.map((entity) => (
                  <article key={entity.name} className="entity-card">
                    <div className="entity-avatar">
                      <Hash size={20} />
                    </div>
                    <h2>{entity.name}</h2>
                    <p>
                      {entity.count}{" "}
                      {entity.count === 1 ? "memory" : "memories"}
                    </p>
                    <div>
                      <Link
                        href={routeURL(
                          route.store,
                          "library",
                          new URLSearchParams({
                            entity: entity.name,
                          }).toString(),
                        )}
                      >
                        View memories
                        <ArrowRight size={13} />
                      </Link>
                      <Link
                        aria-label={`Explore ${entity.name} in graph`}
                        href={routeURL(
                          route.store,
                          "graph",
                          new URLSearchParams({
                            entity: entity.name,
                          }).toString(),
                        )}
                      >
                        <Network size={17} />
                      </Link>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <Empty
                title={term ? "No matching entities" : "Connections start here"}
                icon={term ? "search" : "empty"}
              >
                <p>
                  {term
                    ? "Try another name or concept."
                    : "Entities attached to your memories will appear here."}
                </p>
              </Empty>
            )}
            {data.next_cursor && (
              <div className="pagination">
                <button
                  className="button"
                  disabled={query.loading || query.loadingMore}
                  onClick={query.loadMore}
                >
                  {query.loadingMore ? "Loading…" : "Load more entities"}
                </button>
              </div>
            )}
          </>
        )}
      </QueryView>
    </>
  );
}
export function ActivityView({ refresh }: { refresh: number }) {
  const { route } = useRouter();
  const query = useQuery<ActivityPage>(
    storeAPI(route.store, "activity", new URLSearchParams({ limit: "50" })),
    refresh,
    true,
  );
  return (
    <>
      <PageHeading
        eyebrow="A GROWING BODY OF KNOWLEDGE"
        title="Activity"
        description="The recorded operations in this space, as they happened."
      />
      <QueryView query={query}>
        {(data) => (
          <>
            <div className="results-line">
              <span>Operation log</span>
              <LastUpdated value={data.updated_at} loading={query.loading} />
            </div>
            {data.items?.length ? (
              <div className="activity-list">
                {data.items.map((item) => (
                  <article key={item.id} className="activity-item">
                    <div className="activity-icon">
                      <Clock3 size={16} />
                    </div>
                    <div>
                      <strong>{item.operation}</strong>
                      {item.available ? (
                        <ReaderLink id={item.insight_id} />
                      ) : (
                        <span className="unavailable">
                          Memory unavailable <code>{item.insight_id}</code>
                        </span>
                      )}
                    </div>
                    <time dateTime={item.created_at}>
                      {date(item.created_at, true)}
                    </time>
                  </article>
                ))}
              </div>
            ) : (
              <Empty title="A quiet moment">
                <p>No operations have been recorded in this space yet.</p>
              </Empty>
            )}
            {data.next_cursor && (
              <div className="pagination">
                <button
                  className="button"
                  disabled={query.loading || query.loadingMore}
                  onClick={query.loadMore}
                >
                  {query.loadingMore ? "Loading…" : "Load earlier activity"}
                </button>
              </div>
            )}
          </>
        )}
      </QueryView>
    </>
  );
}
