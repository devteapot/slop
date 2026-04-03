package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	slop "github.com/devteapot/slop/packages/go/slop-ai"
)

func main() {
	args := os.Args[1:]

	// Parse global flags
	dataFile := os.Getenv("TSK_FILE")
	sockPath := os.Getenv("TSK_SOCK")
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
		case "--sock":
			if i+1 < len(args) {
				sockPath = args[i+1]
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
		if sockPath == "" {
			sockPath = "/tmp/slop/tsk.sock"
		}
		runSLOP(store, sockPath)
	} else {
		runCLI(store, filtered)
	}
}

func runSLOP(store *Store, sockPath string) {
	server := setupProvider(store)

	// Write discovery descriptor
	writeDiscovery(store, sockPath)
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

	// Print status to stdout
	total, _, pending, overdue, _ := store.Stats()
	fmt.Printf("tsk: listening on %s\n", sockPath)
	fmt.Printf("tsk: %d tasks loaded (%d pending, %d overdue)\n", total, pending, overdue)

	// Interactive stdin loop (only when stdin is a terminal)
	if isTerminal() {
		go runInteractiveLoop(store, server)
	}

	if err := slop.ListenUnix(ctx, server, sockPath); err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(1)
	}
}

func isTerminal() bool {
	fi, err := os.Stdin.Stat()
	if err != nil {
		return false
	}
	return fi.Mode()&os.ModeCharDevice != 0
}

func runInteractiveLoop(store *Store, server *slop.Server) {
	scanner := bufio.NewScanner(os.Stdin)
	fmt.Print("tsk> ")
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			fmt.Print("tsk> ")
			continue
		}
		args := splitArgs(line)
		if len(args) == 0 {
			fmt.Print("tsk> ")
			continue
		}
		runCLI(store, args)
		server.Refresh()
		fmt.Print("tsk> ")
	}
}

func splitArgs(line string) []string {
	var args []string
	var current []byte
	inQuote := false
	var quoteChar byte

	for i := 0; i < len(line); i++ {
		ch := line[i]
		if inQuote {
			if ch == quoteChar {
				inQuote = false
			} else {
				current = append(current, ch)
			}
		} else if ch == '"' || ch == '\'' {
			inQuote = true
			quoteChar = ch
		} else if ch == ' ' || ch == '\t' {
			if len(current) > 0 {
				args = append(args, string(current))
				current = current[:0]
			}
		} else {
			current = append(current, ch)
		}
	}
	if len(current) > 0 {
		args = append(args, string(current))
	}
	return args
}

func writeDiscovery(store *Store, sockPath string) {
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
			"type": "unix",
			"path": sockPath,
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
