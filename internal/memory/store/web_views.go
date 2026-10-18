package store

import (
	"context"
	"database/sql"
	"strings"
	"time"

	"github.com/mnemon-dev/mnemon/internal/memory/model"
)

type WebOverview struct {
	Total      int              `json:"total"`
	EdgeCount  int              `json:"edge_count"`
	ByCategory map[string]int   `json:"by_category"`
	Entities   []WebEntity      `json:"entities"`
	Sources    []string         `json:"sources"`
	Tags       []string         `json:"tags"`
	Recent     []*model.Insight `json:"recent"`
	UpdatedAt  time.Time        `json:"updated_at"`
}

// Overview bounds facets to 200 values and recent memories to 12.
func (s *WebSnapshot) Overview(ctx context.Context) (WebOverview, error) {
	r := WebOverview{ByCategory: map[string]int{}, Entities: []WebEntity{}, Sources: []string{}, Tags: []string{}, Recent: []*model.Insight{}, UpdatedAt: time.Now().UTC()}
	categories, err := s.entityRows(ctx, `SELECT category,count(*) FROM insights WHERE deleted_at IS NULL GROUP BY category ORDER BY category LIMIT 200`)
	if err != nil {
		return r, err
	}
	for _, c := range categories {
		r.ByCategory[c.Name] = c.Count
	}
	if err := s.tx.QueryRowContext(ctx, `SELECT count(*) FROM insights WHERE deleted_at IS NULL`).Scan(&r.Total); err != nil {
		return r, err
	}
	if err := s.tx.QueryRowContext(ctx, `SELECT count(*) FROM edges e JOIN insights a ON a.id=e.source_id JOIN insights b ON b.id=e.target_id WHERE a.deleted_at IS NULL AND b.deleted_at IS NULL`).Scan(&r.EdgeCount); err != nil {
		return r, err
	}
	entities, err := s.Entities(ctx, "", "", 200, "")
	if err != nil {
		return r, err
	}
	r.Entities = entities.Items
	r.Sources, err = s.webStrings(ctx, `SELECT DISTINCT source FROM insights WHERE deleted_at IS NULL AND source<>'' ORDER BY source LIMIT 200`)
	if err != nil {
		return r, err
	}
	r.Tags, err = s.webStrings(ctx, `SELECT DISTINCT j.value FROM insights i,json_each(i.tags) j WHERE i.deleted_at IS NULL AND j.type='text' AND j.value<>'' ORDER BY j.value LIMIT 200`)
	if err != nil {
		return r, err
	}
	r.Recent, err = s.insightRows(ctx, "SELECT "+webInsightColumns+" FROM insights i WHERE i.deleted_at IS NULL ORDER BY i.created_at DESC,i.id DESC LIMIT 12")
	return r, err
}

type WebGraph struct {
	Nodes     []*model.Insight `json:"nodes"`
	Edges     []*model.Edge    `json:"edges"`
	Total     int              `json:"total"`
	Truncated bool             `json:"truncated"`
	UpdatedAt time.Time        `json:"updated_at"`
}

// Graph returns at most 200 nodes and 800 edges. Focus selects one-hop
// neighbors; all returned endpoints must also satisfy the active filters.
func (s *WebSnapshot) Graph(ctx context.Context, f WebFilter, focus, edgeType string) (WebGraph, error) {
	r := WebGraph{Nodes: []*model.Insight{}, Edges: []*model.Edge{}, UpdatedAt: time.Now().UTC()}
	if err := f.validate(); err != nil {
		return r, err
	}
	if f.Cursor != "" || (edgeType != "" && !model.ValidEdgeTypes[model.EdgeType(edgeType)]) {
		return r, ErrWebQuery
	}
	if focus != "" {
		if err := checkWebID(focus); err != nil {
			return r, err
		}
	}
	where, args := f.where()
	if focus != "" {
		var exists int
		if err := s.tx.QueryRowContext(ctx, `SELECT 1 FROM insights WHERE id=? AND deleted_at IS NULL`, focus).Scan(&exists); err != nil {
			return r, err
		}
		clause := `(i.id=? OR EXISTS (SELECT 1 FROM edges e WHERE ((e.source_id=? AND e.target_id=i.id) OR (e.target_id=? AND e.source_id=i.id))`
		args = append(args, focus, focus, focus)
		if edgeType != "" {
			clause += " AND e.edge_type=?"
			args = append(args, edgeType)
		}
		where += " AND " + clause + "))"
	}
	if err := s.tx.QueryRowContext(ctx, "SELECT count(*) FROM insights i WHERE "+where, args...).Scan(&r.Total); err != nil {
		return r, err
	}
	from := " FROM insights i WHERE " + where
	if f.Sort == "relevance" && f.Query != "" {
		candidateOrder := "i.created_at DESC,i.id DESC"
		if focus != "" {
			candidateOrder = "(i.id=?) DESC," + candidateOrder
			args = append(args, focus)
		}
		from = " FROM (SELECT " + webInsightColumns + " FROM insights i WHERE " + where + " ORDER BY " + candidateOrder + " LIMIT ?) i"
		args = append(args, WebSearchCandidateCap)
	}
	order, orderArgs := webOrder(f)
	if focus != "" {
		order = "(i.id=?) DESC," + order
		args = append(args, focus)
	}
	args = append(args, orderArgs...)
	args = append(args, f.Limit)
	var err error
	r.Nodes, err = s.insightRows(ctx, "SELECT "+webInsightColumns+from+" ORDER BY "+order+" LIMIT ?", args...)
	if err != nil {
		return r, err
	}
	ids := make([]string, 0, len(r.Nodes))
	for _, i := range r.Nodes {
		ids = append(ids, i.ID)
	}
	r.Edges, r.Truncated, err = s.edgesWithin(ctx, ids, edgeType)
	r.Truncated = r.Truncated || r.Total > len(r.Nodes)
	return r, err
}

func (s *WebSnapshot) edgesWithin(ctx context.Context, ids []string, edgeType string) ([]*model.Edge, bool, error) {
	if len(ids) == 0 {
		return []*model.Edge{}, false, nil
	}
	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(ids)), ",")
	args := make([]any, 0, 2*len(ids)+1)
	for n := 0; n < 2; n++ {
		for _, id := range ids {
			args = append(args, id)
		}
	}
	where := "e.source_id IN (" + placeholders + ") AND e.target_id IN (" + placeholders + ")"
	if edgeType != "" {
		where += " AND e.edge_type=?"
		args = append(args, edgeType)
	}
	return s.edgeRows(ctx, "SELECT e.source_id,e.target_id,e.edge_type,e.weight,e.metadata,e.created_at FROM edges e WHERE "+where+" ORDER BY e.source_id,e.target_id,e.edge_type LIMIT 801", args...)
}

func (s *WebSnapshot) edgeRows(ctx context.Context, query string, args ...any) ([]*model.Edge, bool, error) {
	rows, err := s.tx.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, false, err
	}
	defer rows.Close()
	edges := []*model.Edge{}
	for rows.Next() {
		var e model.Edge
		var metadata, created string
		if err := rows.Scan(&e.SourceID, &e.TargetID, &e.EdgeType, &e.Weight, &metadata, &created); err != nil {
			return nil, false, err
		}
		e.ParseMetadata(metadata)
		e.CreatedAt, err = time.Parse(time.RFC3339, created)
		if err != nil {
			return nil, false, err
		}
		edges = append(edges, &e)
	}
	if err := rows.Err(); err != nil {
		return nil, false, err
	}
	truncated := len(edges) > WebEdgeCap
	if truncated {
		edges = edges[:WebEdgeCap]
	}
	return edges, truncated, nil
}

type WebMemory struct {
	Memory       *model.Insight   `json:"memory"`
	Related      []*model.Insight `json:"related"`
	Edges        []*model.Edge    `json:"edges"`
	SupersededBy []string         `json:"superseded_by"`
	Replaces     []string         `json:"replaces"`
	Truncated    bool             `json:"truncated"`
	UpdatedAt    time.Time        `json:"updated_at"`
}

func (s *WebSnapshot) Memory(ctx context.Context, id string) (WebMemory, error) {
	r := WebMemory{Related: []*model.Insight{}, Edges: []*model.Edge{}, SupersededBy: []string{}, Replaces: []string{}, UpdatedAt: time.Now().UTC()}
	if err := checkWebID(id); err != nil {
		return r, err
	}
	memories, err := s.insightRows(ctx, "SELECT "+webInsightColumns+" FROM insights i WHERE i.id=? AND i.deleted_at IS NULL LIMIT 1", id)
	if err != nil {
		return r, err
	}
	if len(memories) == 0 {
		return r, sql.ErrNoRows
	}
	r.Memory = memories[0]
	r.Edges, r.Truncated, err = s.edgeRows(ctx, `SELECT e.source_id,e.target_id,e.edge_type,e.weight,e.metadata,e.created_at FROM edges e JOIN insights a ON a.id=e.source_id JOIN insights b ON b.id=e.target_id WHERE (e.source_id=? OR e.target_id=?) AND a.deleted_at IS NULL AND b.deleted_at IS NULL ORDER BY (e.edge_type='supersedes') DESC,e.source_id,e.target_id,e.edge_type LIMIT 801`, id, id)
	if err != nil {
		return r, err
	}
	seen := map[string]bool{}
	related := []any{}
	for _, e := range r.Edges {
		other := e.SourceID
		if other == id {
			other = e.TargetID
		}
		if !seen[other] && other != id {
			seen[other] = true
			related = append(related, other)
		}
		if e.EdgeType == model.EdgeSupersedes {
			if e.SourceID == id {
				r.Replaces = append(r.Replaces, e.TargetID)
			} else {
				r.SupersededBy = append(r.SupersededBy, e.SourceID)
			}
		}
	}
	if len(related) > 200 {
		r.Truncated = true
		related = related[:200]
	}
	if len(related) > 0 {
		placeholders := strings.TrimSuffix(strings.Repeat("?,", len(related)), ",")
		r.Related, err = s.insightRows(ctx, "SELECT "+webInsightColumns+" FROM insights i WHERE i.deleted_at IS NULL AND i.id IN ("+placeholders+") ORDER BY i.created_at DESC,i.id DESC LIMIT 200", related...)
	}
	return r, err
}

type WebActivityItem struct {
	ID        int    `json:"id"`
	Operation string `json:"operation"`
	InsightID string `json:"insight_id"`
	Available bool   `json:"available"`
	CreatedAt string `json:"created_at"`
}

type WebActivity struct {
	Items      []WebActivityItem `json:"items"`
	NextCursor string            `json:"next_cursor"`
	UpdatedAt  time.Time         `json:"updated_at"`
}

func (s *WebSnapshot) Activity(ctx context.Context, scope string, limit int, cursor string) (WebActivity, error) {
	r := WebActivity{Items: []WebActivityItem{}, UpdatedAt: time.Now().UTC()}
	if limit < 1 || limit > 200 {
		return r, ErrWebQuery
	}
	key := cursorKey([]any{"activity", scope, limit})
	offset, err := readWebCursor(cursor, key)
	if err != nil {
		return r, err
	}
	rows, err := s.tx.QueryContext(ctx, `SELECT o.id,o.operation,coalesce(o.insight_id,''),EXISTS(SELECT 1 FROM insights i WHERE i.id=o.insight_id AND i.deleted_at IS NULL),o.created_at FROM oplog o ORDER BY o.id DESC LIMIT ? OFFSET ?`, min(limit, WebPageCap-offset)+1, offset)
	if err != nil {
		return r, err
	}
	defer rows.Close()
	for rows.Next() {
		var item WebActivityItem
		if err := rows.Scan(&item.ID, &item.Operation, &item.InsightID, &item.Available, &item.CreatedAt); err != nil {
			return r, err
		}
		r.Items = append(r.Items, item)
	}
	if err := rows.Err(); err != nil {
		return r, err
	}
	if len(r.Items) > limit {
		r.Items = r.Items[:limit]
		r.NextCursor = nextWebCursor(key, offset+len(r.Items), offset+len(r.Items)+1)
	}
	return r, nil
}
