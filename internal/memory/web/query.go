package web

import (
	"context"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/mnemon-dev/mnemon/internal/memory/store"
)

func pageLimit(q url.Values, def, max int) (int, error) {
	raw := q.Get("limit")
	if raw == "" {
		return def, nil
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < 1 || n > max {
		return 0, store.ErrWebQuery
	}
	return n, nil
}

func validateParams(q url.Values, allowed string) error {
	keys := map[string]bool{}
	for _, key := range strings.Fields(allowed) {
		keys[key] = true
	}
	for key, values := range q {
		if !keys[key] || len(values) != 1 || !utf8.ValidString(values[0]) {
			return store.ErrWebQuery
		}
	}
	if len(q.Get("cursor")) > 512 {
		return store.ErrWebQuery
	}
	return nil
}

func parseFilter(q url.Values, scope string, graph bool) (store.WebFilter, error) {
	f := store.WebFilter{Scope: scope, Query: q.Get("q"), Category: q.Get("category"), Entity: q.Get("entity"), Tag: q.Get("tag"), Source: q.Get("source"), Sort: q.Get("sort"), Cursor: q.Get("cursor")}
	if f.Sort == "" {
		f.Sort = "newest"
	}
	def, max := 24, 100
	if graph {
		def, max = 200, 200
	}
	var err error
	f.Limit, err = pageLimit(q, def, max)
	if err != nil {
		return f, err
	}
	if raw := q.Get("importance"); raw != "" {
		f.Importance, err = strconv.Atoi(raw)
		if err != nil || f.Importance < 1 || f.Importance > 5 {
			return f, store.ErrWebQuery
		}
	}
	for _, item := range []struct {
		key  string
		dest *string
	}{{"since", &f.Since}, {"until", &f.Until}} {
		if raw := q.Get(item.key); raw != "" {
			date, err := time.Parse("2006-01-02", raw)
			if err != nil {
				return f, store.ErrWebQuery
			}
			if item.key == "until" {
				date = date.AddDate(0, 0, 1)
			}
			*item.dest = date.Format(time.RFC3339)
		}
	}
	return f, nil
}

func readEndpoint(ctx context.Context, s *store.WebSnapshot, parts []string, q url.Values) (any, error) {
	scope := parts[2]
	endpoint := parts[3]
	if len(parts) == 5 {
		if err := validateParams(q, ""); err != nil {
			return nil, err
		}
		return s.Memory(ctx, parts[4])
	}
	switch endpoint {
	case "overview":
		if err := validateParams(q, ""); err != nil {
			return nil, err
		}
		return s.Overview(ctx)
	case "memories", "graph":
		allowed := "q category entity tag source importance since until sort limit cursor"
		if endpoint == "graph" {
			allowed = "q category entity tag source importance since until sort limit focus edge_type"
		}
		if err := validateParams(q, allowed); err != nil {
			return nil, err
		}
		f, err := parseFilter(q, scope, endpoint == "graph")
		if err != nil {
			return nil, err
		}
		if endpoint == "graph" {
			return s.Graph(ctx, f, q.Get("focus"), q.Get("edge_type"))
		}
		return s.Memories(ctx, f)
	case "entities":
		if err := validateParams(q, "q limit cursor"); err != nil {
			return nil, err
		}
		limit, err := pageLimit(q, 50, 200)
		if err != nil {
			return nil, err
		}
		return s.Entities(ctx, scope, q.Get("q"), limit, q.Get("cursor"))
	case "activity":
		if err := validateParams(q, "limit cursor"); err != nil {
			return nil, err
		}
		limit, err := pageLimit(q, 50, 200)
		if err != nil {
			return nil, err
		}
		return s.Activity(ctx, scope, limit, q.Get("cursor"))
	}
	return nil, store.ErrWebQuery
}
