package pi_test

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

// JavaScript callbacks and real child processes belong to the opt-in
// integration tier. The Windows workflow runs the same tests in native Node.
func TestPiRuntime(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("Pi extension integration tests require Node.js 24 or newer")
	}
	bin := os.Getenv("MNEMON_TEST_BIN")
	if bin == "" {
		name := "mnemon"
		if runtime.GOOS == "windows" {
			name += ".exe"
		}
		bin = filepath.Join(t.TempDir(), name)
		ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, "go", "build", "-o", bin, ".")
		cmd.Dir = "../../.."
		cmd.WaitDelay = 5 * time.Second
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("build product: %v\n%s", err, out)
		}
	}
	bin, err = filepath.Abs(bin)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, node, "--experimental-test-module-mocks", "--test", "extension.test.mjs", "installed.test.mjs", "process.test.mjs")
	cmd.Env = append(os.Environ(), "MNEMON_TEST_BIN="+bin)
	cmd.WaitDelay = 5 * time.Second
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("Pi extension runtime: %v\n%s", err, out)
	} else {
		t.Logf("%s", out)
	}
}
