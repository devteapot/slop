package slop

import (
	"bufio"
	"context"
	"encoding/json"
	"os"
	"sync"
)

type stdioConn struct {
	mu sync.Mutex
}

func (c *stdioConn) Send(msg any) error {
	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	data = append(data, '\n')
	c.mu.Lock()
	defer c.mu.Unlock()
	_, err = os.Stdout.Write(data)
	return err
}

func (c *stdioConn) Close() error {
	return nil
}

// ListenStdio listens on stdin/stdout using NDJSON. Single consumer.
// Blocks until stdin is closed or the context is cancelled.
func ListenStdio(ctx context.Context, s *Server) error {
	conn := &stdioConn{}
	s.HandleConnection(conn)
	defer s.HandleDisconnect(conn)

	scanner := bufio.NewScanner(os.Stdin)

	// Cancel on context done
	done := make(chan struct{})
	go func() {
		select {
		case <-ctx.Done():
			os.Stdin.Close()
		case <-done:
		}
	}()
	defer close(done)

	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			continue
		}
		var msg map[string]any
		if json.Unmarshal([]byte(line), &msg) == nil {
			s.HandleMessage(conn, msg)
		}
	}

	return scanner.Err()
}
