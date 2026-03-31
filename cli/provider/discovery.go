package provider

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"syscall"
)

type TransportDesc struct {
	Type string `json:"type"`
	Path string `json:"path,omitempty"`
	URL  string `json:"url,omitempty"`
}

type Descriptor struct {
	ID           string        `json:"id"`
	Name         string        `json:"name"`
	Version      string        `json:"version,omitempty"`
	SlopVersion  string        `json:"slop_version"`
	Transport    TransportDesc `json:"transport"`
	PID          int           `json:"pid,omitempty"`
	Capabilities []string      `json:"capabilities"`
	Description  string        `json:"description,omitempty"`
}

// Discover scans provider descriptor directories and returns live providers.
func Discover() ([]Descriptor, error) {
	var dirs []string

	// ~/.slop/providers/
	if home, err := os.UserHomeDir(); err == nil {
		dirs = append(dirs, filepath.Join(home, ".slop", "providers"))
	}

	// /tmp/slop/providers/
	dirs = append(dirs, filepath.Join(os.TempDir(), "slop", "providers"))

	var providers []Descriptor
	seen := map[string]bool{}

	for _, dir := range dirs {
		entries, err := os.ReadDir(dir)
		if err != nil {
			continue
		}

		for _, entry := range entries {
			if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
				continue
			}

			data, err := os.ReadFile(filepath.Join(dir, entry.Name()))
			if err != nil {
				continue
			}

			var desc Descriptor
			if json.Unmarshal(data, &desc) != nil {
				continue
			}

			if desc.ID == "" || seen[desc.ID] {
				continue
			}

			// Validate PID liveness
			if desc.PID > 0 && !isProcessAlive(desc.PID) {
				continue
			}

			seen[desc.ID] = true
			providers = append(providers, desc)
		}
	}

	sort.Slice(providers, func(i, j int) bool {
		return providers[i].Name < providers[j].Name
	})

	return providers, nil
}

// Address returns a display-friendly address for the descriptor.
func (d Descriptor) Address() string {
	switch d.Transport.Type {
	case "unix":
		return "unix:" + d.Transport.Path
	case "ws":
		return d.Transport.URL
	default:
		return d.Transport.Type
	}
}

func isProcessAlive(pid int) bool {
	process, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	err = process.Signal(syscall.Signal(0))
	return err == nil
}
