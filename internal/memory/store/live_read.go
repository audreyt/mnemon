package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
)

// ErrWebSchema requires an explicit writable Mnemon open before browsing.
var ErrWebSchema = errors.New("incompatible memory schema; open this store with a normal Mnemon command to migrate it")

// LiveStorePath confines existing stores and SQLite sidecars to the data root.
// Symlinks below the configured root are rejected, including WAL/SHM links.
func LiveStorePath(baseDir, name string) (string, error) {
	if !ValidStoreName(name) || len(name) > 128 {
		return "", fmt.Errorf("invalid store name")
	}
	root, err := filepath.Abs(baseDir)
	if err != nil {
		return "", err
	}
	root, err = filepath.EvalSymlinks(root)
	if err != nil {
		return "", err
	}
	current := root
	for _, part := range []string{"data", name, "mnemon.db"} {
		current = filepath.Join(current, part)
		info, err := os.Lstat(current)
		if err != nil {
			return "", err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return "", fmt.Errorf("store symlinks are not allowed")
		}
		if part == "mnemon.db" {
			if !info.Mode().IsRegular() {
				return "", fmt.Errorf("database must be a regular file")
			}
		} else if !info.IsDir() {
			return "", fmt.Errorf("store path must be a directory")
		}
	}
	for _, suffix := range []string{"-wal", "-shm", "-journal"} {
		info, err := os.Lstat(current + suffix)
		if err != nil && !os.IsNotExist(err) {
			return "", err
		}
		if err == nil && !info.Mode().IsRegular() {
			return "", fmt.Errorf("invalid SQLite sidecar")
		}
	}
	return current, nil
}

// ListLiveStores discovers only existing, confined databases without creating state.
func ListLiveStores(baseDir string) ([]string, error) {
	names := []string{}
	entries, err := os.ReadDir(filepath.Join(baseDir, "data"))
	if os.IsNotExist(err) {
		return names, nil
	}
	if err != nil {
		return nil, err
	}
	for _, entry := range entries {
		if _, err := LiveStorePath(baseDir, entry.Name()); err == nil {
			names = append(names, entry.Name())
		}
	}
	return names, nil
}

// OpenLiveReadOnly reads a live WAL database. Unlike OpenReadOnly it never uses
// immutable mode; SQLite may maintain shared-memory sidecars for WAL readers.
// The caller owns the handle and must close it. No migrations run here.
func OpenLiveReadOnly(ctx context.Context, baseDir, name string) (*DB, error) {
	path, err := LiveStorePath(baseDir, name)
	if err != nil {
		return nil, err
	}
	uriPath := filepath.ToSlash(path)
	// Keep Windows drive letters in the URI path, as OpenReadOnly does.
	if !strings.HasPrefix(uriPath, "/") {
		uriPath = "/" + uriPath
	}
	uri := &url.URL{Scheme: "file", Path: uriPath}
	q := uri.Query()
	q.Set("mode", "ro")
	q.Add("_pragma", "query_only(1)")
	q.Add("_pragma", "busy_timeout(250)")
	uri.RawQuery = q.Encode()
	conn, err := sql.Open("sqlite", uri.String())
	if err != nil {
		return nil, err
	}
	conn.SetMaxOpenConns(1)
	db := &DB{conn: conn, path: path, readOnly: true}
	if err := conn.PingContext(ctx); err != nil {
		conn.Close()
		return nil, err
	}
	if err := validateLiveSchema(ctx, conn); err != nil {
		conn.Close()
		return nil, err
	}
	return db, nil
}

func validateLiveSchema(ctx context.Context, conn *sql.DB) error {
	for _, query := range []string{
		`SELECT id,content,category,importance,tags,entities,source,access_count,created_at,updated_at,deleted_at FROM insights LIMIT 0`,
		`SELECT source_id,target_id,edge_type,weight,metadata,created_at FROM edges LIMIT 0`,
		`SELECT id,operation,insight_id,created_at FROM oplog LIMIT 0`,
	} {
		rows, err := conn.QueryContext(ctx, query)
		if err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			return ErrWebSchema
		}
		rows.Close()
	}
	var schema string
	if err := conn.QueryRowContext(ctx, `SELECT sql FROM sqlite_master WHERE type='table' AND name='edges'`).Scan(&schema); err != nil {
		return err
	}
	if !strings.Contains(schema, "'supersedes'") {
		return ErrWebSchema
	}
	return nil
}

// WebSnapshot is a request-owned consistent read view, independent of DB.tx.
type WebSnapshot struct{ tx *sql.Tx }

func (db *DB) BeginWebSnapshot(ctx context.Context) (*WebSnapshot, error) {
	tx, err := db.conn.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, err
	}
	return &WebSnapshot{tx: tx}, nil
}

func (s *WebSnapshot) Close() error { return s.tx.Rollback() }
