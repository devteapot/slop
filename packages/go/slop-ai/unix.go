package slop

import (
	"bufio"
	"context"
	"encoding/json"
	"net"
	"os"
	"path/filepath"
	"sync"
)

type ndjsonConn struct {
	conn net.Conn
	mu   sync.Mutex
}

func (c *ndjsonConn) Send(msg any) error {
	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	data = append(data, '\n')
	c.mu.Lock()
	defer c.mu.Unlock()
	_, err = c.conn.Write(data)
	return err
}

func (c *ndjsonConn) Close() error {
	return c.conn.Close()
}

// UnixOption configures ListenUnix behavior.
type UnixOption func(*unixOpts)

type unixOpts struct {
	discovery bool
}

// WithDiscovery enables writing a discovery descriptor to ~/.slop/providers/.
func WithDiscovery(v bool) UnixOption {
	return func(o *unixOpts) { o.discovery = v }
}

// ListenUnix listens for SLOP consumers on a Unix domain socket using NDJSON.
// It blocks until the context is cancelled.
func ListenUnix(ctx context.Context, s *Server, socketPath string, opts ...UnixOption) error {
	cfg := &unixOpts{}
	for _, o := range opts {
		o(cfg)
	}

	// Clean up stale socket
	_ = os.Remove(socketPath)
	if err := os.MkdirAll(filepath.Dir(socketPath), 0o755); err != nil {
		return err
	}

	listener, err := net.Listen("unix", socketPath)
	if err != nil {
		return err
	}
	defer listener.Close()
	defer os.Remove(socketPath)

	// Restrictive permissions
	_ = os.Chmod(socketPath, 0o600)

	if cfg.discovery {
		_ = RegisterProvider(s.id, s.name, socketPath)
		defer UnregisterProvider(s.id)
	}

	// Close listener when context is done
	go func() {
		<-ctx.Done()
		listener.Close()
	}()

	for {
		conn, err := listener.Accept()
		if err != nil {
			if ctx.Err() != nil {
				return nil // context cancelled
			}
			return err
		}
		go handleNdjsonConn(ctx, s, conn)
	}
}

func handleNdjsonConn(ctx context.Context, s *Server, rawConn net.Conn) {
	conn := &ndjsonConn{conn: rawConn}
	s.HandleConnection(conn)
	defer s.HandleDisconnect(conn)

	scanner := bufio.NewScanner(rawConn)
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			continue
		}
		var msg map[string]any
		if json.Unmarshal([]byte(line), &msg) == nil {
			s.HandleMessage(ctx, conn, msg)
		}
	}
}

// RegisterProvider writes a discovery descriptor to ~/.slop/providers/.
func RegisterProvider(id, name, socketPath string) error {
	dir := filepath.Join(homeDir(), ".slop", "providers")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	descriptor := map[string]any{
		"id":           id,
		"name":         name,
		"slop_version": "0.1",
		"transport":    map[string]any{"type": "unix", "path": socketPath},
		"pid":          os.Getpid(),
		"capabilities": []string{"state", "patches", "affordances", "attention", "windowing", "async", "content_refs"},
	}
	data, err := json.MarshalIndent(descriptor, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, id+".json"), data, 0o644)
}

// UnregisterProvider removes a discovery descriptor from ~/.slop/providers/.
func UnregisterProvider(id string) {
	path := filepath.Join(homeDir(), ".slop", "providers", id+".json")
	_ = os.Remove(path)
}

func homeDir() string {
	if h := os.Getenv("HOME"); h != "" {
		return h
	}
	return "/tmp"
}
