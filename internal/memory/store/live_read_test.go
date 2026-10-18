package store

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestLiveReadOnlyWALAndSnapshotOwnership(t *testing.T) {
	root := t.TempDir()
	writer, err := Open(StoreDir(root, "default"))
	if err != nil {
		t.Fatal(err)
	}
	defer writer.Close()
	if _, err := writer.conn.Exec(`PRAGMA wal_autocheckpoint=0`); err != nil {
		t.Fatal(err)
	}
	if err := writer.InsertInsight(makeInsight("before", "中文 live WAL", 3)); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(writer.Path() + "-wal")
	if err != nil || info.Size() == 0 {
		t.Fatalf("missing uncheckpointed WAL: %v", err)
	}
	reader, err := OpenLiveReadOnly(context.Background(), root, "default")
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	if !reader.IsReadOnly() {
		t.Fatal("not readonly")
	}
	if _, err := reader.conn.Exec(`UPDATE insights SET access_count=99`); err == nil {
		t.Fatal("readonly connection allowed write")
	}
	if _, err := reader.conn.Exec(`CREATE TABLE forbidden (id TEXT)`); err == nil {
		t.Fatal("readonly connection allowed DDL")
	}
	first, err := reader.BeginWebSnapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	page, err := first.Memories(context.Background(), WebFilter{Limit: 24})
	if err != nil || page.Total != 1 {
		t.Fatalf("WAL seed: %+v %v", page, err)
	}
	if err := writer.InsertInsight(makeInsight("after", "later commit", 3)); err != nil {
		t.Fatal(err)
	}
	stable, err := first.Memories(context.Background(), WebFilter{Limit: 24})
	if err != nil || stable.Total != 1 {
		t.Fatalf("request snapshot changed: %+v %v", stable, err)
	}
	first.Close()
	second, err := reader.BeginWebSnapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	live, err := second.Memories(context.Background(), WebFilter{Limit: 24})
	if err != nil || live.Total != 2 {
		t.Fatalf("later WAL commit invisible: %+v %v", live, err)
	}
	if reader.tx != nil {
		t.Fatal("request snapshot used mutable DB.tx")
	}
}

func TestLiveOpenerMissingCanceledAndSchema(t *testing.T) {
	root := t.TempDir()
	if _, err := OpenLiveReadOnly(context.Background(), root, "missing"); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("missing: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, "data")); !os.IsNotExist(err) {
		t.Fatal("opener created data")
	}
	writer, err := Open(StoreDir(root, "default"))
	if err != nil {
		t.Fatal(err)
	}
	defer writer.Close()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := OpenLiveReadOnly(ctx, root, "default"); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled opener: %v", err)
	}
	reader, err := OpenLiveReadOnly(context.Background(), root, "default")
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	snapshot, err := reader.BeginWebSnapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := snapshot.Memories(ctx, WebFilter{Limit: 24}); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled query: %v", err)
	}
	snapshot.Close()
	if _, err := writer.conn.Exec(`DROP TABLE oplog`); err != nil {
		t.Fatal(err)
	}
	if _, err := OpenLiveReadOnly(context.Background(), root, "default"); !errors.Is(err, ErrWebSchema) {
		t.Fatalf("schema: %v", err)
	}
	var n int
	if err := writer.conn.QueryRow(`SELECT count(*) FROM sqlite_master WHERE name='oplog'`).Scan(&n); err != nil || n != 0 {
		t.Fatal("readonly opener migrated schema")
	}
}

func TestLiveStorePathRejectsSymlinkComponents(t *testing.T) {
	for _, component := range []string{"data", "default", "mnemon.db", "mnemon.db-wal", "mnemon.db-shm", "mnemon.db-journal"} {
		t.Run(component, func(t *testing.T) {
			root := t.TempDir()
			dir := StoreDir(root, "default")
			if err := os.MkdirAll(dir, 0700); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(dir, "mnemon.db"), nil, 0600); err != nil {
				t.Fatal(err)
			}
			target := filepath.Join(dir, component)
			if component == "data" {
				target = filepath.Join(root, "data")
			}
			if component == "default" {
				target = dir
			}
			if err := os.RemoveAll(target); err != nil {
				t.Fatal(err)
			}
			if err := os.Symlink(t.TempDir(), target); err != nil {
				t.Fatal(err)
			}
			if _, err := LiveStorePath(root, "default"); err == nil {
				t.Fatal("symlink accepted")
			}
		})
	}
	for _, name := range []string{"../default", "a/b", "a\\b", "", ".", "a?mode=rw"} {
		if _, err := LiveStorePath(t.TempDir(), name); err == nil {
			t.Fatalf("invalid name accepted: %q", name)
		}
	}
}

func TestWebCursorCapAndIdentity(t *testing.T) {
	key := cursorKey("scope-filter-sort-limit")
	for _, offset := range []int{-1, 0, WebPageCap, WebPageCap + 1} {
		raw := nextWebCursor(key, offset, WebPageCap+2)
		if offset >= WebPageCap {
			if raw != "" {
				t.Fatal("cursor beyond cap")
			}
			continue
		}
		if _, err := readWebCursor(raw, key); err == nil {
			t.Fatalf("invalid offset %d accepted", offset)
		}
	}
	raw := nextWebCursor(key, 24, 100)
	if offset, err := readWebCursor(raw, key); err != nil || offset != 24 {
		t.Fatalf("cursor: %d %v", offset, err)
	}
	if _, err := readWebCursor(raw, cursorKey("other-store")); !errors.Is(err, ErrWebQuery) {
		t.Fatalf("cursor identity: %v", err)
	}
}

func TestLiveReadOnlyURIPathEscaping(t *testing.T) {
	parent := t.TempDir()
	original := filepath.Join(parent, "original")
	writer, err := Open(StoreDir(original, "default"))
	if err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	root := filepath.Join(parent, "space ? # 中文")
	if err := os.Rename(original, root); err != nil {
		t.Fatal(err)
	}
	reader, err := OpenLiveReadOnly(context.Background(), root, "default")
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := reader.conn.PingContext(ctx); err != nil {
		t.Fatal(err)
	}
}
