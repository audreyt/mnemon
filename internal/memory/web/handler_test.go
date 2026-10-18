package web

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"testing/fstest"
	"time"

	"github.com/mnemon-dev/mnemon/internal/memory/model"
	"github.com/mnemon-dev/mnemon/internal/memory/store"
)

func fixture(t testing.TB) (string, *store.DB, http.Handler) {
	t.Helper()
	root := t.TempDir()
	db, err := store.Open(store.StoreDir(root, "default"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	assets := fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte("<!doctype html><div id=app></div><script src=/app.js></script>")}, "app.js": &fstest.MapFile{Data: []byte("console.log('local')")}}
	return root, db, NewHandler(root, "default", "test-version", assets)
}

func insight(id, content string) *model.Insight {
	now := time.Date(2026, 10, 18, 12, 0, 0, 0, time.UTC)
	return &model.Insight{ID: id, Content: content, Category: model.CategoryFact, Importance: 3, Tags: []string{"tag"}, Entities: []string{"Go", "中文"}, Source: "agent", CreatedAt: now, UpdatedAt: now}
}

func insert(t testing.TB, db *store.DB, i *model.Insight) {
	t.Helper()
	if err := db.InsertInsight(i); err != nil {
		t.Fatal(err)
	}
}
func edge(t testing.TB, db *store.DB, a, b string, kind model.EdgeType) {
	t.Helper()
	if err := db.InsertEdge(&model.Edge{SourceID: a, TargetID: b, EdgeType: kind, Weight: 1, CreatedAt: time.Now().UTC()}); err != nil {
		t.Fatal(err)
	}
}

func request(h http.Handler, target string) *httptest.ResponseRecorder {
	r := httptest.NewRequest("GET", "http://127.0.0.1:8484"+target, nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func decode[T any](t testing.TB, w *httptest.ResponseRecorder) T {
	t.Helper()
	if w.Code != 200 {
		t.Fatalf("HTTP %d: %s", w.Code, w.Body.String())
	}
	var result T
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	return result
}

func TestAPIReadOnlyLiveAndDeleted(t *testing.T) {
	root, db, h := fixture(t)
	insert(t, db, insight("old", "original"))
	insert(t, db, insight("new", "中文 literal 100%_\\ value"))
	deleted := insight("deleted", "private removed content")
	deleted.Entities = []string{"deleted-only"}
	deleted.Tags = []string{"deleted-tag"}
	deleted.Source = "deleted-source"
	insert(t, db, deleted)
	edge(t, db, "new", "old", model.EdgeSupersedes)
	edge(t, db, "old", "deleted", model.EdgeEntity)
	// Keep an edge touching a deleted row to prove the reader filters both endpoints.
	if _, err := db.Conn().Exec(`UPDATE insights SET deleted_at='2026-10-18T13:00:00Z' WHERE id='deleted'`); err != nil {
		t.Fatal(err)
	}
	if err := db.RecordOp("forget", "deleted", "private removed content"); err != nil {
		t.Fatal(err)
	}
	if err := db.RecordOp("remember", "new", "raw historical content"); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(store.ActiveFile(root), []byte("other\n"), 0600); err != nil {
		t.Fatal(err)
	}
	before := databaseState(t, db)
	meta := decode[struct {
		Version      string
		InitialStore string `json:"initial_store"`
		Categories   []string
		EdgeTypes    []string `json:"edge_types"`
	}](t, request(h, "/api/meta"))
	if meta.Version != "test-version" || meta.InitialStore != "default" || len(meta.Categories) != len(model.ValidCategories) || len(meta.EdgeTypes) != len(model.EdgeTypeNames()) {
		t.Fatalf("metadata: %+v", meta)
	}
	stores := decode[struct{ Stores []string }](t, request(h, "/api/stores"))
	if len(stores.Stores) != 1 || stores.Stores[0] != "default" {
		t.Fatalf("stores: %+v", stores)
	}
	overview := decode[store.WebOverview](t, request(h, "/api/stores/default/overview"))
	if overview.Total != 2 || overview.EdgeCount != 1 || overview.ByCategory["fact"] != 2 || len(overview.Entities) != 2 || len(overview.Sources) != 1 || len(overview.Tags) != 1 {
		t.Fatalf("overview: %+v", overview)
	}
	old := decode[store.WebMemory](t, request(h, "/api/stores/default/memories/old"))
	if len(old.SupersededBy) != 1 || old.SupersededBy[0] != "new" || len(old.Replaces) != 0 || len(old.Related) != 1 || len(old.Edges) != 1 {
		t.Fatalf("old lineage: %+v", old)
	}
	newMemory := decode[store.WebMemory](t, request(h, "/api/stores/default/memories/new"))
	if len(newMemory.Replaces) != 1 || newMemory.Replaces[0] != "old" {
		t.Fatalf("new lineage: %+v", newMemory)
	}
	if w := request(h, "/api/stores/default/memories/deleted"); w.Code != 404 {
		t.Fatalf("deleted memory: %d", w.Code)
	}
	graph := decode[store.WebGraph](t, request(h, "/api/stores/default/graph"))
	if len(graph.Nodes) != 2 || len(graph.Edges) != 1 || graph.Total != 2 {
		t.Fatalf("graph: %+v", graph)
	}
	entities := decode[store.WebEntities](t, request(h, "/api/stores/default/entities"))
	if entities.Total != 2 || entities.Items[0].Count != 2 {
		t.Fatalf("entities: %+v", entities)
	}
	activityResponse := request(h, "/api/stores/default/activity")
	activity := decode[store.WebActivity](t, activityResponse)
	if len(activity.Items) != 2 || !activity.Items[0].Available || activity.Items[1].Available || strings.Contains(activityResponse.Body.String(), "detail") || strings.Contains(activityResponse.Body.String(), "private") {
		t.Fatalf("activity: %s", activityResponse.Body.String())
	}
	if after := databaseState(t, db); before != after {
		t.Fatalf("read changed database\nbefore %s\nafter %s", before, after)
	}
	active, err := os.ReadFile(store.ActiveFile(root))
	if err != nil || string(active) != "other\n" {
		t.Fatalf("active changed: %q %v", active, err)
	}
	// The writer stays open and commits only to WAL; the next request must see it.
	insert(t, db, insight("live", "committed after requests"))
	page := decode[store.WebMemories](t, request(h, "/api/stores/default/memories"))
	if page.Total != 3 {
		t.Fatalf("live commit invisible: %+v", page)
	}
}

func databaseState(t testing.TB, db *store.DB) string {
	t.Helper()
	var state string
	err := db.Conn().QueryRow(`SELECT json_object('insights',(SELECT json_group_array(json_object('id',id,'content',content,'access',access_count,'updated',updated_at,'deleted',deleted_at,'last_access',last_accessed_at,'weight',effective_importance)) FROM (SELECT * FROM insights ORDER BY id)),'edges',(SELECT json_group_array(json_object('source',source_id,'target',target_id,'type',edge_type,'weight',weight)) FROM edges),'ops',(SELECT json_group_array(json_object('id',id,'operation',operation,'detail',detail)) FROM oplog),'schema',(SELECT json_group_array(sql) FROM sqlite_master),'version',(SELECT user_version FROM pragma_user_version))`).Scan(&state)
	if err != nil {
		t.Fatal(err)
	}
	return state
}

func TestLiteralFiltersAndCursors(t *testing.T) {
	_, db, h := fixture(t)
	for _, id := range []string{"a", "b", "c", "d"} {
		insert(t, db, insight(id, "中文 100%_\\ ABC"))
	}
	insert(t, db, insight("x", "100wildcardXX"))
	for _, q := range []string{"中文", "100%_\\", "abc"} {
		page := decode[store.WebMemories](t, request(h, "/api/stores/default/memories?q="+url.QueryEscape(q)))
		if page.Total != 4 || len(page.Items) != 4 {
			t.Fatalf("literal %q: %+v", q, page)
		}
	}
	query := "/api/stores/default/memories?limit=2&entity=Go&tag=tag&source=agent&category=fact&importance=3&since=2026-10-18&until=2026-10-18&sort=importance"
	first := decode[store.WebMemories](t, request(h, query))
	if first.Total != 5 || len(first.Items) != 2 || first.Items[0].ID != "x" || first.NextCursor == "" {
		t.Fatalf("first page: %+v", first)
	}
	second := decode[store.WebMemories](t, request(h, query+"&cursor="+first.NextCursor))
	if len(second.Items) != 2 || second.Items[0].ID != "c" || first.Items[1].ID == second.Items[0].ID {
		t.Fatalf("second page: %+v", second)
	}
	if w := request(h, strings.Replace(query, "importance=3", "importance=4", 1)+"&cursor="+first.NextCursor); w.Code != 400 {
		t.Fatalf("filter-bound cursor: %d", w.Code)
	}
	if w := request(h, "/api/stores/default/entities?cursor="+first.NextCursor); w.Code != 400 {
		t.Fatalf("endpoint-bound cursor: %d", w.Code)
	}
	for _, suffix := range []string{"?limit=201", "?limit=0", "?sort=bad", "?importance=0", "?importance=6", "?since=2026-99-99", "?since=2026-10-19&until=2026-10-18", "?category=bad", "?cursor=garbage", "?q=a&q=b", "?unknown=x", "?q=" + strings.Repeat("x", 1025)} {
		if w := request(h, "/api/stores/default/memories"+suffix); w.Code != 400 {
			t.Errorf("%s: %d %s", suffix, w.Code, w.Body.String())
		}
	}
	// Deterministic relevance favors an earlier literal occurrence.
	insert(t, db, insight("best", "中文"))
	relevant := decode[store.WebMemories](t, request(h, "/api/stores/default/memories?q="+url.QueryEscape("中文")+"&sort=relevance"))
	if relevant.Items[0].ID != "best" {
		t.Fatalf("relevance: %+v", relevant)
	}
}

func TestHostOriginMethodsAndAssets(t *testing.T) {
	_, _, h := fixture(t)
	cases := []struct {
		host, origin, site, method, target string
		want                               int
	}{
		{"127.0.0.1:49123", "http://127.0.0.1:49123", "same-origin", "GET", "/api/meta", 200},
		{"localhost:49123", "http://localhost:49123", "", "GET", "/api/meta", 200},
		{"[::1]:49123", "http://[::1]:49123", "", "GET", "/api/meta", 200},
		{"evil.test:8484", "", "", "GET", "/api/meta", 403},
		{"127.0.0.1:8484", "https://evil.test", "", "GET", "/api/meta", 403},
		{"127.0.0.1:8484", "http://127.0.0.1:9999", "", "GET", "/api/meta", 403},
		{"127.0.0.1:8484", "null", "", "GET", "/api/meta", 403},
		{"127.0.0.1:8484", "", "cross-site", "GET", "/api/meta", 403},
		{"127.0.0.1:8484", "", "same-site", "GET", "/api/meta", 403},
		{"127.0.0.1:8484", "", "", "HEAD", "/api/meta", 405},
		{"127.0.0.1:8484", "", "", "POST", "/api/meta", 405},
		{"127.0.0.1:8484", "", "", "OPTIONS", "/api/meta", 405},
		{"127.0.0.1:8484", "", "", "POST", "/", 405},
		{"127.0.0.1:8484", "", "", "HEAD", "/app.js", 200},
		{"127.0.0.1:8484", "", "", "GET", "/s/default/memories/one", 200},
		{"127.0.0.1:8484", "", "", "GET", "/missing.js", 404},
		{"127.0.0.1:8484", "", "", "GET", "/../index.html", 404},
		{"127.0.0.1:8484", "", "", "GET", "/api/unknown", 404},
	}
	for _, tc := range cases {
		t.Run(fmt.Sprintf("%s_%s_%s_%s", tc.method, tc.host, tc.target, tc.origin), func(t *testing.T) {
			r := httptest.NewRequest(tc.method, "http://127.0.0.1:8484"+tc.target, nil)
			r.Host = tc.host
			if tc.origin != "" {
				r.Header.Set("Origin", tc.origin)
			}
			if tc.site != "" {
				r.Header.Set("Sec-Fetch-Site", tc.site)
			}
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			if w.Code != tc.want {
				t.Fatalf("got %d want %d: %s", w.Code, tc.want, w.Body.String())
			}
			if w.Header().Get("Cache-Control") != "no-store" || w.Header().Get("Access-Control-Allow-Origin") != "" {
				t.Fatal("private response headers")
			}
			csp := w.Header().Get("Content-Security-Policy")
			if !strings.Contains(csp, "style-src 'self' 'unsafe-inline'") || !strings.Contains(csp, "script-src 'self';") {
				t.Fatalf("CSP: %s", csp)
			}
			if tc.want >= 400 {
				var e map[string]string
				if err := json.Unmarshal(w.Body.Bytes(), &e); err != nil || len(e) != 1 || e["error"] == "" {
					t.Fatalf("error shape: %s", w.Body.String())
				}
			}
		})
	}
	r := httptest.NewRequest("GET", "http://127.0.0.1:8484/api/meta", nil)
	r.Header.Add("Origin", "http://127.0.0.1:8484")
	r.Header.Add("Origin", "http://127.0.0.1:8484")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatalf("multiple origins accepted: %d", w.Code)
	}
}

func TestMissingEmptyAndSymlinkStores(t *testing.T) {
	root, _, h := fixture(t)
	for _, endpoint := range []string{"overview", "memories", "graph", "entities", "activity"} {
		w := request(h, "/api/stores/default/"+endpoint)
		if w.Code != 200 || strings.Contains(w.Body.String(), ":null") {
			t.Fatalf("empty %s: %d %s", endpoint, w.Code, w.Body.String())
		}
	}
	if w := request(h, "/api/stores/missing/memories"); w.Code != 404 {
		t.Fatalf("missing store: %d", w.Code)
	}
	if _, err := os.Stat(store.StoreDir(root, "missing")); !os.IsNotExist(err) {
		t.Fatal("read created a store")
	}
	if err := os.Symlink(store.StoreDir(root, "default"), store.StoreDir(root, "linked")); err != nil {
		t.Fatal(err)
	}
	if w := request(h, "/api/stores/linked/memories"); w.Code != 503 {
		t.Fatalf("symlink store: %d", w.Code)
	}
	outside := t.TempDir()
	if err := os.MkdirAll(store.StoreDir(root, "escaped"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(outside, "mnemon.db"), []byte("outside"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(outside, "mnemon.db"), filepath.Join(store.StoreDir(root, "escaped"), "mnemon.db")); err != nil {
		t.Fatal(err)
	}
	if w := request(h, "/api/stores/escaped/memories"); w.Code != 503 {
		t.Fatalf("database symlink: %d", w.Code)
	}
	stores := decode[struct{ Stores []string }](t, request(h, "/api/stores"))
	if len(stores.Stores) != 1 {
		t.Fatalf("unsafe store discovery: %+v", stores)
	}
	emptyRoot := t.TempDir()
	emptyHandler := NewHandler(emptyRoot, "default", "test", fstest.MapFS{})
	w := request(emptyHandler, "/api/stores")
	if strings.TrimSpace(w.Body.String()) != "{\"stores\":[]}" {
		t.Fatalf("empty stores: %s", w.Body.String())
	}
	if _, err := fs.Stat(os.DirFS(emptyRoot), "data"); !os.IsNotExist(err) {
		t.Fatal("discovery created state")
	}
}

func TestGraphBoundsFocusAndDeleted(t *testing.T) {
	_, db, h := fixture(t)
	if err := db.InTransaction(func() error {
		for n := 0; n < 205; n++ {
			if err := db.InsertInsight(insight(fmt.Sprintf("n%03d", n), "node")); err != nil {
				return err
			}
		}
		for n := 0; n < 205; n++ {
			for j := 1; j <= 5; j++ {
				if err := db.InsertEdge(&model.Edge{SourceID: fmt.Sprintf("n%03d", n), TargetID: fmt.Sprintf("n%03d", (n+j)%205), EdgeType: model.EdgeEntity, Weight: 1, CreatedAt: time.Now().UTC()}); err != nil {
					return err
				}
			}
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	graph := decode[store.WebGraph](t, request(h, "/api/stores/default/graph"))
	if len(graph.Nodes) != 200 || len(graph.Edges) != 800 || graph.Total != 205 || !graph.Truncated {
		t.Fatalf("bounds: nodes %d edges %d total %d truncated %v", len(graph.Nodes), len(graph.Edges), graph.Total, graph.Truncated)
	}
	nodes := map[string]bool{}
	for _, n := range graph.Nodes {
		nodes[n.ID] = true
	}
	for _, e := range graph.Edges {
		if !nodes[e.SourceID] || !nodes[e.TargetID] {
			t.Fatal("edge endpoint missing")
		}
	}
	focused := decode[store.WebGraph](t, request(h, "/api/stores/default/graph?focus=n000&edge_type=entity&limit=3"))
	if focused.Total != 11 || len(focused.Nodes) != 3 || focused.Nodes[0].ID != "n000" || !focused.Truncated {
		t.Fatalf("focused graph: %+v", focused)
	}
	noEdges := decode[store.WebGraph](t, request(h, "/api/stores/default/graph?focus=n000&edge_type=supersedes"))
	if noEdges.Total != 1 || len(noEdges.Edges) != 0 {
		t.Fatalf("edge type focus: %+v", noEdges)
	}
	for _, query := range []string{"?limit=201", "?focus=missing", "?edge_type=unknown", "?cursor=abc"} {
		w := request(h, "/api/stores/default/graph"+query)
		if w.Code != 400 && w.Code != 404 {
			t.Fatalf("graph validation %s: %d", query, w.Code)
		}
	}
}

func BenchmarkBrowse10k(b *testing.B) {
	_, db, h := fixture(b)
	if err := db.InTransaction(func() error {
		for n := 0; n < 10000; n++ {
			i := insight(fmt.Sprintf("m%05d", n), fmt.Sprintf("memory %d 中文 content", n))
			if err := db.InsertInsight(i); err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		b.Fatal(err)
	}
	for _, endpoint := range []string{"memories", "memories?q=" + url.QueryEscape("中文") + "&sort=relevance", "graph", "entities", "overview"} {
		b.Run(endpoint, func(b *testing.B) {
			b.ReportAllocs()
			for n := 0; n < b.N; n++ {
				w := request(h, "/api/stores/default/"+endpoint)
				if w.Code != 200 {
					b.Fatal(w.Body.String())
				}
			}
		})
	}
}

func TestConcurrentRequestsAndWriter(t *testing.T) {
	_, db, h := fixture(t)
	insert(t, db, insight("seed", "concurrent"))
	var workers sync.WaitGroup
	errs := make(chan error, 9)
	for n := 0; n < 8; n++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for j := 0; j < 8; j++ {
				endpoint := []string{"overview", "memories", "graph", "entities", "activity"}[j%5]
				w := request(h, "/api/stores/default/"+endpoint)
				if w.Code != 200 {
					errs <- fmt.Errorf("concurrent %s: %d %s", endpoint, w.Code, w.Body.String())
					return
				}
			}
		}()
	}
	workers.Add(1)
	go func() {
		defer workers.Done()
		for n := 0; n < 20; n++ {
			if err := db.InsertInsight(insight(fmt.Sprintf("live-%d", n), "writer")); err != nil {
				errs <- err
				return
			}
		}
	}()
	workers.Wait()
	close(errs)
	for err := range errs {
		t.Error(err)
	}
	page := decode[store.WebMemories](t, request(h, "/api/stores/default/memories"))
	if page.Total != 21 {
		t.Fatalf("concurrent final count: %d", page.Total)
	}
}

func TestRelevanceBudgetAndPagedEntitiesActivity(t *testing.T) {
	_, db, h := fixture(t)
	if _, err := db.Conn().Exec(`WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<5001) INSERT INTO insights(id,content,category,importance,tags,entities,source,access_count,created_at,updated_at) SELECT printf('id%05d',x),'中文 candidate','fact',3,'[]','["one","one","two","three"]','test',0,'2026-10-18T00:00:00Z','2026-10-18T00:00:00Z' FROM n`); err != nil {
		t.Fatal(err)
	}
	page := decode[store.WebMemories](t, request(h, "/api/stores/default/memories?q="+url.QueryEscape("中文")+"&sort=relevance&limit=100"))
	if page.Total != 5001 || len(page.Items) != 100 || !page.Truncated || page.NextCursor == "" {
		t.Fatalf("candidate budget: %+v", page)
	}
	next := decode[store.WebMemories](t, request(h, "/api/stores/default/memories?q="+url.QueryEscape("中文")+"&sort=relevance&limit=100&cursor="+page.NextCursor))
	if len(next.Items) != 100 || next.Items[0].ID == page.Items[0].ID {
		t.Fatalf("second candidate page: %+v", next)
	}
	// Exercise the terminal boundary directly; cursor validation permits bounded
	// offsets, and replaying every intermediate page adds no independent oracle.
	raw, err := base64.RawURLEncoding.DecodeString(page.NextCursor)
	if err != nil {
		t.Fatal(err)
	}
	var terminal map[string]any
	if err := json.Unmarshal(raw, &terminal); err != nil {
		t.Fatal(err)
	}
	terminal["o"] = store.WebSearchCandidateCap - 100
	raw, err = json.Marshal(terminal)
	if err != nil {
		t.Fatal(err)
	}
	// Test deep ranking at the store boundary: race-instrumented SQLite sorting
	// can exceed the HTTP deadline, which is tested with normal page requests.
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	snapshot, err := db.BeginWebSnapshot(ctx)
	if err != nil {
		t.Fatal(err)
	}
	last, err := snapshot.Memories(ctx, store.WebFilter{Scope: "default", Query: "中文", Sort: "relevance", Limit: 100, Cursor: base64.RawURLEncoding.EncodeToString(raw)})
	_ = snapshot.Close()
	if err != nil {
		t.Fatal(err)
	}
	if len(last.Items) != 100 || last.NextCursor != "" || !last.Truncated || last.Total != 5001 {
		t.Fatalf("terminal candidate page: %+v", last)
	}
	entities := decode[store.WebEntities](t, request(h, "/api/stores/default/entities?limit=2"))
	if entities.Total != 3 || len(entities.Items) != 2 || entities.Items[0].Count != 5001 || entities.NextCursor == "" {
		t.Fatalf("entity counts: %+v", entities)
	}
	nextEntities := decode[store.WebEntities](t, request(h, "/api/stores/default/entities?limit=2&cursor="+entities.NextCursor))
	if len(nextEntities.Items) != 1 || nextEntities.NextCursor != "" || nextEntities.Items[0].Name == entities.Items[0].Name {
		t.Fatalf("entity cursor: %+v", nextEntities)
	}
	for n := 0; n < 3; n++ {
		if err := db.RecordOp("remember", fmt.Sprintf("id%05d", n+1), "excluded detail"); err != nil {
			t.Fatal(err)
		}
	}
	activity := decode[store.WebActivity](t, request(h, "/api/stores/default/activity?limit=2"))
	if len(activity.Items) != 2 || activity.NextCursor == "" {
		t.Fatalf("activity page: %+v", activity)
	}
	nextActivity := decode[store.WebActivity](t, request(h, "/api/stores/default/activity?limit=2&cursor="+activity.NextCursor))
	if len(nextActivity.Items) != 1 || nextActivity.NextCursor != "" || nextActivity.Items[0].ID >= activity.Items[1].ID {
		t.Fatalf("activity cursor: %+v", nextActivity)
	}
	if _, err := db.Conn().Exec(`DROP TABLE oplog`); err != nil {
		t.Fatal(err)
	}
	if w := request(h, "/api/stores/default/memories"); w.Code != 409 || !strings.Contains(w.Body.String(), "migrate") {
		t.Fatalf("schema error: %d %s", w.Code, w.Body.String())
	}
}
