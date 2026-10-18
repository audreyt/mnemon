// Package web_test exercises the real loopback server outside deterministic CI.
package web_test

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/mnemon-dev/mnemon/cmd"
	"github.com/mnemon-dev/mnemon/internal/memory/model"
	"github.com/mnemon-dev/mnemon/internal/memory/store"
)

func TestWorkspaceServerLifecycleAndLiveWrites(t *testing.T) {
	base := t.TempDir()
	writer, err := store.Open(store.StoreDir(base, "default"))
	if err != nil {
		t.Fatal(err)
	}
	defer writer.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	reader, output := io.Pipe()
	defer reader.Close()
	finished := make(chan int, 1)
	go func() {
		finished <- cmd.Execute(ctx, []string{"--data-dir", base, "web", "--port", "0"}, strings.NewReader(""), output, io.Discard)
		_ = output.Close()
	}()
	address := make(chan string, 1)
	go func() {
		scanner := bufio.NewScanner(reader)
		for scanner.Scan() {
			if line := scanner.Text(); strings.HasPrefix(line, "Mnemon Web: ") {
				address <- strings.TrimPrefix(line, "Mnemon Web: ")
			}
		}
		close(address)
	}()
	var url string
	select {
	case url = <-address:
	case <-ctx.Done():
		t.Fatal("server did not become ready")
	}
	if url == "" {
		t.Fatal("server exited before printing its address")
	}
	client := &http.Client{Timeout: 3 * time.Second}
	read := func(path string, target any) {
		t.Helper()
		response, err := client.Get(url + path)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		if response.StatusCode != http.StatusOK {
			t.Fatalf("%s status %d", path, response.StatusCode)
		}
		if target != nil {
			if err := json.NewDecoder(response.Body).Decode(target); err != nil {
				t.Fatal(err)
			}
		}
	}
	read("/s/default/library", nil)
	now := time.Now().UTC()
	if err := writer.InsertInsight(&model.Insight{ID: "live-memory", Content: "Live agent knowledge", Category: model.CategoryFact, Importance: 3, Tags: []string{}, Entities: []string{}, Source: "integration-agent", CreatedAt: now, UpdatedAt: now}); err != nil {
		t.Fatal(err)
	}
	var detail struct {
		Memory model.Insight `json:"memory"`
	}
	read("/api/stores/default/memories/live-memory", &detail)
	if detail.Memory.Content != "Live agent knowledge" {
		t.Fatalf("live content = %q", detail.Memory.Content)
	}
	stored, err := writer.GetInsightByID("live-memory")
	if err != nil || stored.AccessCount != 0 {
		t.Fatalf("browsing changed memory: %#v, %v", stored, err)
	}
	cancel()
	select {
	case code := <-finished:
		if code != 0 {
			t.Fatalf("server exited %d", code)
		}
	case <-time.After(7 * time.Second):
		t.Fatal("server did not shut down")
	}
	// Closing the output lets the scanner terminate before test teardown.
	for range address {
	}
	if response, err := client.Get(url + "/api/meta"); err == nil {
		response.Body.Close()
		t.Fatal("listener remained open after command completion")
	}
}
