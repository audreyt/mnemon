package store

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/mnemon-dev/mnemon/internal/memory/model"
)

const WebPageCap = 100000
const WebEdgeCap = 800

// WebSearchCandidateCap bounds relevance ranking to the newest literal matches.
const WebSearchCandidateCap = 5000

var ErrWebQuery = errors.New("invalid browse query or cursor")

// WebFilter uses exact facets and a literal Unicode substring, never FTS syntax.
// Importance is a minimum. Until is an exclusive UTC boundary.
type WebFilter struct {
	Scope      string
	Query      string
	Category   string
	Entity     string
	Tag        string
	Source     string
	Importance int
	Since      string
	Until      string
	Sort       string
	Limit      int
	Cursor     string
}

type WebMemories struct {
	Items      []*model.Insight `json:"items"`
	Total      int              `json:"total"`
	NextCursor string           `json:"next_cursor"`
	Truncated  bool             `json:"truncated"`
	UpdatedAt  time.Time        `json:"updated_at"`
}

type WebEntity struct {
	Name  string `json:"name"`
	Count int    `json:"count"`
}
type WebEntities struct {
	Items      []WebEntity `json:"items"`
	Total      int         `json:"total"`
	NextCursor string      `json:"next_cursor"`
	UpdatedAt  time.Time   `json:"updated_at"`
}

type webCursor struct {
	Key    string `json:"k"`
	Offset int    `json:"o"`
}

func cursorKey(value any) string {
	b, _ := json.Marshal(value)
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

func readWebCursor(raw, key string) (int, error) {
	if raw == "" {
		return 0, nil
	}
	if len(raw) > 512 {
		return 0, ErrWebQuery
	}
	b, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return 0, ErrWebQuery
	}
	var c webCursor
	if json.Unmarshal(b, &c) != nil || c.Key != key || c.Offset < 1 || c.Offset >= WebPageCap {
		return 0, ErrWebQuery
	}
	return c.Offset, nil
}

func nextWebCursor(key string, offset, total int) string {
	if offset >= total || offset >= WebPageCap {
		return ""
	}
	b, _ := json.Marshal(webCursor{Key: key, Offset: offset})
	return base64.RawURLEncoding.EncodeToString(b)
}

func escapedSubstring(q string) string {
	return "%" + strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(q) + "%"
}

func (f WebFilter) validate() error {
	if f.Limit < 1 || f.Limit > 200 || len(f.Query) > 1024 || len(f.Entity) > 256 || len(f.Tag) > 256 || len(f.Source) > 256 || f.Importance < 0 || f.Importance > 5 {
		return ErrWebQuery
	}
	if f.Category != "" && !model.ValidCategories[model.Category(f.Category)] {
		return ErrWebQuery
	}
	switch f.Sort {
	case "", "newest", "updated", "importance", "relevance":
	default:
		return ErrWebQuery
	}
	for _, date := range []string{f.Since, f.Until} {
		if date != "" {
			if _, err := time.Parse(time.RFC3339, date); err != nil {
				return ErrWebQuery
			}
		}
	}
	if f.Since != "" && f.Until != "" && f.Since >= f.Until {
		return ErrWebQuery
	}
	return nil
}

func (f WebFilter) where() (string, []any) {
	parts := []string{"i.deleted_at IS NULL"}
	args := []any{}
	if f.Query != "" {
		parts = append(parts, `i.content LIKE ? ESCAPE '\'`)
		args = append(args, escapedSubstring(f.Query))
	}
	for _, pair := range [][2]string{{"category", f.Category}, {"source", f.Source}} {
		if pair[1] != "" {
			parts = append(parts, "i."+pair[0]+" = ?")
			args = append(args, pair[1])
		}
	}
	for _, pair := range [][2]string{{"entities", f.Entity}, {"tags", f.Tag}} {
		if pair[1] != "" {
			parts = append(parts, "EXISTS (SELECT 1 FROM json_each(i."+pair[0]+") j WHERE j.type='text' AND j.value=?)")
			args = append(args, pair[1])
		}
	}
	if f.Importance > 0 {
		parts = append(parts, "i.importance >= ?")
		args = append(args, f.Importance)
	}
	if f.Since != "" {
		parts = append(parts, "i.created_at >= ?")
		args = append(args, f.Since)
	}
	if f.Until != "" {
		parts = append(parts, "i.created_at < ?")
		args = append(args, f.Until)
	}
	return strings.Join(parts, " AND "), args
}

const webInsightColumns = `i.id,i.content,i.category,i.importance,i.tags,i.entities,i.source,i.access_count,i.created_at,i.updated_at,i.deleted_at`

func webOrder(f WebFilter) (string, []any) {
	switch f.Sort {
	case "updated":
		return "i.updated_at DESC,i.id DESC", nil
	case "importance":
		return "i.importance DESC,i.created_at DESC,i.id DESC", nil
	case "relevance":
		if f.Query != "" {
			return "instr(lower(i.content),lower(?)) ASC,length(i.content) ASC,i.importance DESC,i.id DESC", []any{f.Query}
		}
	}
	return "i.created_at DESC,i.id DESC", nil
}

func (s *WebSnapshot) insightRows(ctx context.Context, query string, args ...any) ([]*model.Insight, error) {
	rows, err := s.tx.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []*model.Insight{}
	for rows.Next() {
		var i model.Insight
		var tags, entities, created, updated string
		var deleted sql.NullString
		if err := rows.Scan(&i.ID, &i.Content, &i.Category, &i.Importance, &tags, &entities, &i.Source, &i.AccessCount, &created, &updated, &deleted); err != nil {
			return nil, err
		}
		i.ParseTags(tags)
		i.ParseEntities(entities)
		i.CreatedAt, err = time.Parse(time.RFC3339, created)
		if err != nil {
			return nil, err
		}
		i.UpdatedAt, err = time.Parse(time.RFC3339, updated)
		if err != nil {
			return nil, err
		}
		result = append(result, &i)
	}
	return result, rows.Err()
}

func (s *WebSnapshot) Memories(ctx context.Context, f WebFilter) (WebMemories, error) {
	result := WebMemories{Items: []*model.Insight{}, UpdatedAt: time.Now().UTC()}
	if err := f.validate(); err != nil {
		return result, err
	}
	identity := f
	identity.Cursor = ""
	key := cursorKey([]any{identity, WebPageCap, WebSearchCandidateCap})
	offset, err := readWebCursor(f.Cursor, key)
	if err != nil {
		return result, err
	}
	where, args := f.where()
	if err := s.tx.QueryRowContext(ctx, "SELECT count(*) FROM insights i WHERE "+where, args...).Scan(&result.Total); err != nil {
		return result, err
	}
	from := " FROM insights i WHERE " + where
	available := min(result.Total, WebPageCap)
	result.Truncated = result.Total > WebPageCap
	if f.Sort == "relevance" && f.Query != "" {
		from = " FROM (SELECT " + webInsightColumns + " FROM insights i WHERE " + where + " ORDER BY i.created_at DESC,i.id DESC LIMIT ?) i"
		args = append(args, WebSearchCandidateCap)
		available = min(available, WebSearchCandidateCap)
		result.Truncated = result.Total > WebSearchCandidateCap
	}
	order, orderArgs := webOrder(f)
	args = append(args, orderArgs...)
	limit := min(f.Limit, max(0, available-offset))
	args = append(args, limit, offset)
	result.Items, err = s.insightRows(ctx, "SELECT "+webInsightColumns+from+" ORDER BY "+order+" LIMIT ? OFFSET ?", args...)
	if err != nil {
		return result, err
	}
	result.NextCursor = nextWebCursor(key, offset+len(result.Items), available)
	return result, nil
}

func (s *WebSnapshot) entityRows(ctx context.Context, query string, args ...any) ([]WebEntity, error) {
	rows, err := s.tx.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []WebEntity{}
	for rows.Next() {
		var e WebEntity
		if err := rows.Scan(&e.Name, &e.Count); err != nil {
			return nil, err
		}
		items = append(items, e)
	}
	return items, rows.Err()
}

func (s *WebSnapshot) Entities(ctx context.Context, scope, q string, limit int, cursor string) (WebEntities, error) {
	result := WebEntities{Items: []WebEntity{}, UpdatedAt: time.Now().UTC()}
	if limit < 1 || limit > 200 || len(q) > 1024 {
		return result, ErrWebQuery
	}
	key := cursorKey([]any{"entities", scope, q, limit})
	offset, err := readWebCursor(cursor, key)
	if err != nil {
		return result, err
	}
	from := ` FROM insights i,json_each(i.entities) j WHERE i.deleted_at IS NULL AND j.type='text' AND j.value<>'' AND j.value LIKE ? ESCAPE '\'`
	arg := escapedSubstring(q)
	if err := s.tx.QueryRowContext(ctx, "SELECT count(DISTINCT j.value)"+from, arg).Scan(&result.Total); err != nil {
		return result, err
	}
	result.Items, err = s.entityRows(ctx, "SELECT j.value,count(DISTINCT i.id)"+from+" GROUP BY j.value ORDER BY count(DISTINCT i.id) DESC,j.value ASC LIMIT ? OFFSET ?", arg, min(limit, WebPageCap-offset), offset)
	if err != nil {
		return result, err
	}
	result.NextCursor = nextWebCursor(key, offset+len(result.Items), result.Total)
	return result, nil
}

func (s *WebSnapshot) webStrings(ctx context.Context, query string, args ...any) ([]string, error) {
	rows, err := s.tx.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var value string
		if err := rows.Scan(&value); err != nil {
			return nil, err
		}
		out = append(out, value)
	}
	return out, rows.Err()
}

func checkWebID(id string) error {
	if id == "" || len(id) > 256 || strings.ContainsAny(id, "/\\\x00") {
		return fmt.Errorf("%w: memory ID", ErrWebQuery)
	}
	return nil
}
