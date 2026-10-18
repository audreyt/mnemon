package memory

import (
	"context"
	"io"
	"strings"
	"testing"
)

func TestWebRejectsInvalidOptionsBeforeOpeningStore(t *testing.T) {
	oldDir, oldName, oldMode := dataDir, storeName, readOnly
	t.Cleanup(func() { dataDir, storeName, readOnly = oldDir, oldName, oldMode })
	dataDir = t.TempDir()
	storeName = "default"
	for _, tc := range []struct {
		name     string
		readonly bool
		store    string
		port     string
		want     string
	}{
		{"snapshot flag", true, "default", "8484", "immutable CLI snapshot"},
		{"invalid store", false, "../escape", "8484", "invalid store name"},
		{"negative port", false, "default", "-1", "--port"},
		{"large port", false, "default", "65536", "--port"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			readOnly, storeName = tc.readonly, tc.store
			command := webCommand()
			command.SetContext(context.Background())
			if err := command.Flags().Set("port", tc.port); err != nil {
				t.Fatal(err)
			}
			if err := runWeb(command, nil); err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("error = %v, want %q", err, tc.want)
			}
		})
	}
}

func TestServeWebHonorsCanceledContext(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := serveWeb(ctx, 0, nil, io.Discard); err != context.Canceled {
		t.Fatalf("error = %v", err)
	}
}
