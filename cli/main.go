package main

import (
	"flag"
	"fmt"
	"os"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/slop-ai/slop-cli/tui"
)

func main() {
	connect := flag.String("connect", "", "connect directly to a provider address (ws:// or unix socket path)")
	flag.Parse()

	app := tui.NewApp(*connect)

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
