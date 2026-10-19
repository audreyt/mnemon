package setup

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/mnemon-dev/mnemon/internal/memory/setup/assets"
)

// PiGlobalDir follows Pi's user-level directory override, including ~/ paths.
func PiGlobalDir() string {
	home := HomeDir()
	if dir := os.Getenv("PI_CODING_AGENT_DIR"); dir != "" {
		if dir == "~" {
			return home
		}
		if strings.HasPrefix(dir, "~/") || (runtime.GOOS == "windows" && strings.HasPrefix(dir, `~\`)) {
			return filepath.Join(home, dir[2:])
		}
		return dir
	}
	return filepath.Join(home, ".pi", "agent")
}

// PiWritePromptFiles keeps Pi's direct memory workflow separate from the
// shared Claude guide, so setting up either host cannot replace the other.
func PiWritePromptFiles() (string, error) {
	dir, err := promptDir()
	if err != nil {
		return "", err
	}
	return writePromptFiles(filepath.Join(dir, "pi"), assets.PiGuide, assets.PiSkill)
}

// PiWriteSkill writes the mnemon skill to the Pi skills directory.
func PiWriteSkill(configDir string) (string, error) {
	skillDir := filepath.Join(configDir, "skills", "mnemon")
	if err := os.MkdirAll(skillDir, 0755); err != nil {
		return "", err
	}
	skillPath := filepath.Join(skillDir, "SKILL.md")
	if err := os.WriteFile(skillPath, assets.PiSkill, 0644); err != nil {
		return "", err
	}
	return skillPath, nil
}

// PiWriteExtension writes the Mnemon lifecycle extension to Pi.
func PiWriteExtension(configDir string) (string, error) {
	extDir := filepath.Join(configDir, "extensions")
	if err := os.MkdirAll(extDir, 0755); err != nil {
		return "", err
	}
	extPath := filepath.Join(extDir, "mnemon.ts")
	if err := os.WriteFile(extPath, assets.PiExtension, 0644); err != nil {
		return "", err
	}
	return extPath, nil
}

// PiEject removes mnemon skill and extension from the given Pi config dir.
func PiEject(configDir string) []error {
	var errs []error

	fmt.Printf("\nRemoving Pi integration (%s)...\n", configDir)

	targets := []struct {
		label string
		path  string
	}{
		{"Extension", filepath.Join(configDir, "extensions", "mnemon.ts")},
		{"Skill", filepath.Join(configDir, "skills", "mnemon")},
	}

	for i, target := range targets {
		if err := os.RemoveAll(target.path); err != nil {
			StatusError(i+1, len(targets), target.label, err)
			errs = append(errs, err)
		} else {
			StatusOK(i+1, len(targets), target.label, target.path+" removed")
		}
	}

	removeIfEmpty(filepath.Join(configDir, "extensions"))
	removeIfEmpty(filepath.Join(configDir, "skills"))
	removeIfEmpty(configDir)

	return errs
}
