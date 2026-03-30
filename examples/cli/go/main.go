package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	slop "github.com/slop-ai/slop-go"
)

func main() {
	args := os.Args[1:]

	// Parse global flags
	dataFile := os.Getenv("TSK_FILE")
	slopMode := false
	var filtered []string

	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--slop":
			slopMode = true
		case "--file":
			if i+1 < len(args) {
				dataFile = args[i+1]
				i++
			}
		default:
			filtered = append(filtered, args[i])
		}
	}

	if dataFile == "" {
		home, _ := os.UserHomeDir()
		dataFile = filepath.Join(home, ".tsk", "tasks.json")
	}

	// Resolve seed.json relative to executable
	seedPath := findSeed()

	store, err := NewStore(dataFile, seedPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(1)
	}

	if slopMode {
		runSLOP(store)
	} else {
		runCLI(store, filtered)
	}
}

func runSLOP(store *Store) {
	server := setupProvider(store)

	// Write discovery descriptor
	writeDiscovery(store)
	defer removeDiscovery()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Handle signals for clean shutdown
	sigs := make(chan os.Signal, 1)
	signal.Notify(sigs, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sigs
		removeDiscovery()
		cancel()
		os.Exit(0)
	}()

	if err := slop.ListenStdio(ctx, server); err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(1)
	}
}

func writeDiscovery(store *Store) {
	home, err := os.UserHomeDir()
	if err != nil {
		return
	}

	dir := filepath.Join(home, ".slop", "providers")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return
	}

	total, _, pending, overdue, _ := store.Stats()

	desc := map[string]any{
		"id":           "tsk",
		"name":         "tsk",
		"version":      "0.1.0",
		"slop_version": "0.1",
		"transport": map[string]any{
			"type":    "stdio",
			"command": []string{"tsk", "--slop"},
		},
		"pid":          os.Getpid(),
		"capabilities": []string{"state", "patches", "affordances", "attention"},
		"description":  fmt.Sprintf("Task manager with %d tasks (%d pending, %d overdue)", total, pending, overdue),
	}

	data, err := json.MarshalIndent(desc, "", "  ")
	if err != nil {
		return
	}

	_ = os.WriteFile(filepath.Join(dir, "tsk.json"), data, 0o644)
}

func removeDiscovery() {
	home, err := os.UserHomeDir()
	if err != nil {
		return
	}
	_ = os.Remove(filepath.Join(home, ".slop", "providers", "tsk.json"))
}

func findSeed() string {
	// Try relative to the working directory first
	candidates := []string{
		"seed.json",
		filepath.Join("examples", "cli", "go", "seed.json"),
	}

	// Try relative to the executable
	if exe, err := os.Executable(); err == nil {
		candidates = append(candidates, filepath.Join(filepath.Dir(exe), "seed.json"))
	}

	for _, c := range candidates {
		if _, err := os.Stat(c); err == nil {
			abs, _ := filepath.Abs(c)
			return abs
		}
	}
	return ""
}

