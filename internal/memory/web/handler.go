// Package web serves the local, read-only memory workspace. Store reads are
// request-owned; lifecycle and listener ownership belong to the command.
package web

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io/fs"
	"mime"
	"net"
	"net/http"
	"net/url"
	"os"
	"path"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/mnemon-dev/mnemon/internal/memory/model"
	"github.com/mnemon-dev/mnemon/internal/memory/store"
)

type handler struct {
	dataDir, initialStore, version string
	assets                         fs.FS
}

// NewHandler serves assets rooted at index.html and private GET-only APIs.
// Query deadlines are five seconds; pages default to 24 (memories), 50
// (entities/activity), or 200 (graph), with maxima 100/200/200 respectively.
// Relevance ranks the newest 5,000 literal matches and reports truncation;
// overview facets contain at most 200 values. Cursors cap traversal at 100,000.
func NewHandler(dataDir, initialStore, version string, assets fs.FS) http.Handler {
	return &handler{dataDir: dataDir, initialStore: initialStore, version: version, assets: assets}
}

func (h *handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'")
	if !safeRequest(r) {
		writeError(w, http.StatusForbidden, "request must use a loopback host and the same origin")
		return
	}
	api := r.URL.Path == "/api" || strings.HasPrefix(r.URL.Path, "/api/")
	if r.Method != http.MethodGet && (api || r.Method != http.MethodHead) {
		allow := "GET, HEAD"
		if api {
			allow = "GET"
		}
		w.Header().Set("Allow", allow)
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if len(r.URL.RawQuery) > 8192 {
		writeError(w, http.StatusBadRequest, "query too long")
		return
	}
	if api {
		h.api(w, r)
		return
	}
	h.asset(w, r)
}

func loopbackHost(authority string) bool {
	host := authority
	if strings.ContainsAny(host, "/@?#\\") {
		return false
	}
	if strings.Contains(host, ":") {
		var port string
		var err error
		host, port, err = net.SplitHostPort(authority)
		if err != nil {
			return false
		}
		n, err := strconv.Atoi(port)
		if err != nil || n < 1 || n > 65535 {
			return false
		}
	}
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func safeRequest(r *http.Request) bool {
	if !loopbackHost(r.Host) {
		return false
	}
	if site := r.Header.Get("Sec-Fetch-Site"); site != "" && site != "same-origin" && site != "none" {
		return false
	}
	origins := r.Header.Values("Origin")
	if len(origins) > 1 {
		return false
	}
	if len(origins) == 0 {
		return true
	}
	origin, err := url.Parse(origins[0])
	if err != nil {
		return false
	}
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	return origin.Scheme == scheme && strings.EqualFold(origin.Host, r.Host) && origin.User == nil && origin.Path == "" && origin.RawQuery == "" && origin.Fragment == "" && origin.Opaque == ""
}

func writeError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": message})
}

func writeJSON(w http.ResponseWriter, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(value)
}

func apiError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, store.ErrWebQuery):
		writeError(w, 400, "invalid query or cursor; restart from the first page")
	case errors.Is(err, sql.ErrNoRows), errors.Is(err, os.ErrNotExist):
		writeError(w, 404, "store or memory not found")
	case errors.Is(err, store.ErrWebSchema):
		writeError(w, 409, store.ErrWebSchema.Error())
	case errors.Is(err, context.Canceled), errors.Is(err, context.DeadlineExceeded):
		writeError(w, 503, "read canceled or timed out")
	default:
		writeError(w, 503, "memory store unavailable")
	}
}

func (h *handler) api(w http.ResponseWriter, r *http.Request) {
	switch r.URL.Path {
	case "/api/meta":
		categories := make([]string, 0, len(model.ValidCategories))
		for c := range model.ValidCategories {
			categories = append(categories, string(c))
		}
		sort.Strings(categories)
		writeJSON(w, struct {
			Version      string   `json:"version"`
			InitialStore string   `json:"initial_store"`
			Categories   []string `json:"categories"`
			EdgeTypes    []string `json:"edge_types"`
		}{h.version, h.initialStore, categories, model.EdgeTypeNames()})
		return
	case "/api/stores":
		names, err := store.ListLiveStores(h.dataDir)
		if err != nil {
			apiError(w, err)
			return
		}
		writeJSON(w, struct {
			Stores []string `json:"stores"`
		}{names})
		return
	}
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/"), "/")
	if len(parts) < 4 || len(parts) > 5 || parts[0] != "api" || parts[1] != "stores" {
		writeError(w, 404, "endpoint not found")
		return
	}
	if !store.ValidStoreName(parts[2]) || len(parts[2]) > 128 {
		writeError(w, 400, "invalid store name")
		return
	}
	if len(parts) == 5 && parts[3] != "memories" {
		writeError(w, 404, "endpoint not found")
		return
	}
	if !knownEndpoint(parts[3]) {
		writeError(w, 404, "endpoint not found")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	db, err := store.OpenLiveReadOnly(ctx, h.dataDir, parts[2])
	if err != nil {
		apiError(w, err)
		return
	}
	defer db.Close()
	snapshot, err := db.BeginWebSnapshot(ctx)
	if err != nil {
		apiError(w, err)
		return
	}
	defer snapshot.Close()
	query, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil {
		apiError(w, store.ErrWebQuery)
		return
	}
	value, err := readEndpoint(ctx, snapshot, parts, query)
	if err != nil {
		apiError(w, err)
		return
	}
	writeJSON(w, value)
}

func knownEndpoint(endpoint string) bool {
	switch endpoint {
	case "overview", "memories", "graph", "entities", "activity":
		return true
	}
	return false
}

func (h *handler) asset(w http.ResponseWriter, r *http.Request) {
	name := strings.TrimPrefix(r.URL.Path, "/")
	if name == "" {
		name = "index.html"
	}
	if !fs.ValidPath(name) || strings.ContainsAny(name, "\\\x00") || h.assets == nil {
		writeError(w, 404, "asset not found")
		return
	}
	file, err := h.assets.Open(name)
	if err != nil && errors.Is(err, fs.ErrNotExist) && path.Ext(name) == "" {
		name = "index.html"
		file, err = h.assets.Open(name)
	}
	if err != nil {
		writeError(w, 404, "asset not found")
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || info.IsDir() {
		writeError(w, 404, "asset not found")
		return
	}
	content, err := fs.ReadFile(h.assets, name)
	if err != nil {
		writeError(w, 404, "asset not found")
		return
	}
	contentType := mime.TypeByExtension(path.Ext(name))
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Length", strconv.Itoa(len(content)))
	w.WriteHeader(http.StatusOK)
	if r.Method == http.MethodGet {
		_, _ = w.Write(content)
	}
}
