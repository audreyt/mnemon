package main

import (
	"encoding/json"
	"io/fs"
	"os"
	"regexp"
	"strings"
	"testing"

	"github.com/mnemon-dev/mnemon/internal/memory/model"
	webassets "github.com/mnemon-dev/mnemon/web"
)

// Keep the JSON properties consumed by the browser tied to actual Go models.
// Frontend discriminators remain strings supplied by /api/meta.
func TestWebModelJSONContract(t *testing.T) {
	types, err := os.ReadFile("web/src/types.ts")
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name   string
		value  any
		fields []string
	}{
		{"insight", model.Insight{}, []string{"id", "content", "category", "importance", "tags", "entities", "source", "access_count", "created_at", "updated_at"}},
		{"edge", model.Edge{}, []string{"source_id", "target_id", "edge_type", "weight", "metadata", "created_at"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			raw, err := json.Marshal(tc.value)
			if err != nil {
				t.Fatal(err)
			}
			var object map[string]json.RawMessage
			if err := json.Unmarshal(raw, &object); err != nil {
				t.Fatal(err)
			}
			name := strings.ToUpper(tc.name[:1]) + tc.name[1:]
			declaration := regexp.MustCompile(`(?s)export interface ` + name + ` \{(.*?)\n\}`).FindSubmatch(types)
			if len(declaration) != 2 {
				t.Fatalf("missing frontend type %s", name)
			}
			for _, field := range tc.fields {
				if _, ok := object[field]; !ok {
					t.Errorf("missing browser property %s", field)
				}
				if !regexp.MustCompile(`\b` + field + `\s*:`).Match(declaration[1]) {
					t.Errorf("frontend %s missing %s", name, field)
				}
			}
		})
	}
}

func TestEmbeddedWebAssetsAreLocallyResolvable(t *testing.T) {
	assets := webassets.Assets()
	index, err := fs.ReadFile(assets, "index.html")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(index), "https://") || strings.Contains(string(index), "http://") {
		t.Fatal("index depends on an external asset")
	}
	for _, match := range regexp.MustCompile(`(?:src|href)="/([^"?#]+)"`).FindAllSubmatch(index, -1) {
		name := string(match[1])
		if _, err := fs.Stat(assets, name); err != nil {
			t.Errorf("missing embedded asset %s: %v", name, err)
		}
	}
	logo, err := fs.ReadFile(assets, "mnemon-logo.svg")
	if err != nil {
		t.Fatal(err)
	}
	official, err := os.ReadFile("docs/logo/logo.svg")
	if err != nil {
		t.Fatal(err)
	}
	if string(logo) != string(official) {
		t.Fatal("embedded logo differs from official artwork")
	}
}
