# Mnemon Web workspace

Mnemon Web provides a local knowledge workspace for the memories accumulated by your agents. It reads existing memory stores while agents continue using the normal Mnemon commands.

```sh
mnemon web
# Mnemon Web: http://127.0.0.1:8484

mnemon web --port 8485 --store project-name
mnemon web --data-dir /path/to/.mnemon
```

Open the printed address in your browser. Stop the server with Ctrl+C. The server listens on IPv4 loopback. `--port 0` selects an available port and prints the resulting address.

The sidebar selects the store being inspected. This selection leaves the CLI's active-store file unchanged. The initial selection follows the normal `--store`, `MNEMON_STORE`, active-file, and default-store resolution.

## Explore knowledge

- **Overview** shows memory and relationship counts, categories, recent memories, and common entities.
- **Library** searches and filters memories, with sorting and pagination.
- **Memory pages** show full content, source metadata, tags, entities, related memories, and correction lineage. Each memory has a store-scoped deep link.
- **Graph** displays stored relationships with a bounded node set, selection, and neighborhood exploration.
- **Entities** groups memories by their stored entity metadata.
- **Activity** shows recorded operations and links to memories that remain available. Free-form historical operation details are omitted.

Browsing reads memory without updating access counts, retention weights, the operation log, or memory content. Superseded memories remain readable with correction context; deleted memories are hidden. A source value is the stored producer label.

The interface uses Mnemon’s official graphite-and-silver logo and a locally bundled Space Grotesk font, with system Chinese font fallbacks. Use **Appearance** in the top bar to select **System**, **Light**, or **Dark**. The choice persists in this browser and synchronizes across tabs. System mode follows the operating system; an explicit selection takes priority. Theme initialization runs before the application loads to prevent a mismatched first paint.

The interface refreshes while visible and supports manual refresh. Pagination observes a live database: concurrent agent writes can change page membership. Refresh restarts pagination. Large graphs and bounded search results disclose truncation. Graph responses contain at most 200 nodes and 800 stored edges. Relevance sorting ranks the newest 5,000 literal substring matches, displays the full matching count, and labels truncated results. Other list cursors allow traversal up to 100,000 rows; overview facets show up to 200 values. Search operates locally and requires no model/provider call.

Memory Markdown renders with raw HTML execution disabled. Runtime scripts, styles, and graph dependencies are bundled locally. The server serves private responses with caching disabled and rejects unrelated origins/hosts. Keep this release on the local machine; remote team access needs a separate authentication and authorization design.

## Live reads and snapshots

The web command uses a dedicated SQLite `mode=ro` connection that observes committed changes, including the write-ahead log (WAL). Live readers may use SQLite shared-memory sidecar files. They do not migrate schemas or create missing databases. Create or migrate a store through the normal CLI before opening it here.

The inherited `--readonly` flag selects immutable snapshot behavior for ordinary CLI commands. `mnemon web` rejects that flag because an immutable connection cannot safely observe a database with active writers. The web command already uses live read-only access.

## Develop and package

The React/TypeScript application lives in `web/`. The root `package.json` continues to distribute the DSH integration bundle. Use Node 22.19.0 for the pinned frontend toolchain:

```sh
npm ci --prefix web
npm run typecheck --prefix web
npm test --prefix web
npm run build --prefix web
```

The generated `web/dist/` assets are checked in and embedded in the product. Commit regenerated assets alongside frontend source changes. CI rebuilds them and checks parity. A normal source build needs only Go:

```sh
go build -o mnemon .
./mnemon web
make test
```

The deterministic suite includes read-store and API boundary tests. Browser and actual server lifecycle scenarios belong to integration verification. Check desktop and mobile navigation, search/filter/page/read flows, graph and entity navigation, store switches, Back/Forward, deep-link reload, error/empty states, and live agent writes before releasing user-visible changes.
