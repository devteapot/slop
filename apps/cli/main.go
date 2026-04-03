package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/slop-ai/slop-cli/bridge"
	"github.com/slop-ai/slop-cli/tui"
)

var Version = "dev"

func main() {
	connect := flag.String("connect", "", "connect directly to a provider address (ws:// or unix socket path)")
	bridgeEnabled := flag.Bool("bridge", true, "enable extension bridge (server or client)")
	bridgePort := flag.Int("bridge-port", bridge.DefaultPort, "bridge server port")
	showVersion := flag.Bool("version", false, "print version and exit")
	flag.Parse()

	if *showVersion {
		fmt.Println("slop-cli", Version)
		return
	}

	var b bridge.Bridge
	if *bridgeEnabled {
		b = startBridge(*bridgePort)
	}

	app := tui.NewApp(*connect, b)

	p := tea.NewProgram(app, tea.WithAltScreen())

	// If --connect was provided, send the connect message after start
	if *connect != "" {
		go func() {
			p.Send(tui.ConnectRequestMsg{Address: *connect})
		}()
	}

	if _, err := p.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}

// startBridge tries to connect as a client to an existing bridge (e.g., the
// Desktop app). Only if no bridge is running does it start its own server.
// This avoids stealing the port from the Desktop app.
func startBridge(port int) bridge.Bridge {
	// Try client first — prefer piggybacking on an existing bridge
	client := bridge.NewClient(port)
	if err := client.Connect(context.Background()); err == nil {
		return client
	}

	// No existing bridge — start our own server
	srv := bridge.NewServer(port)
	started := make(chan error, 1)

	go func() {
		err := srv.Start(context.Background())
		started <- err
	}()

	// Give the server a moment to bind or fail
	select {
	case err := <-started:
		if err != nil {
			fmt.Fprintf(os.Stderr, "Bridge: %v (bridge disabled)\n", err)
			return nil
		}
		return srv
	case <-time.After(100 * time.Millisecond):
		// Server is running
		return srv
	}
}
