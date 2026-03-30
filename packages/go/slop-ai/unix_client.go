package slop

import (
	"bufio"
	"context"
	"encoding/json"
	"net"
	"sync"
)

// UnixClientTransport connects to a SLOP provider over a Unix domain socket using NDJSON.
type UnixClientTransport struct {
	Path string
}

type unixClientConn struct {
	conn         net.Conn
	mu           sync.Mutex
	msgHandler   func(map[string]any)
	closeHandler func()
}

// Connect dials the Unix socket and returns a ClientConnection.
func (t *UnixClientTransport) Connect(_ context.Context) (ClientConnection, error) {
	conn, err := net.Dial("unix", t.Path)
	if err != nil {
		return nil, err
	}
	uc := &unixClientConn{conn: conn}
	go uc.readLoop()
	return uc, nil
}

func (uc *unixClientConn) Send(msg map[string]any) error {
	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	data = append(data, '\n')
	uc.mu.Lock()
	defer uc.mu.Unlock()
	_, err = uc.conn.Write(data)
	return err
}

func (uc *unixClientConn) OnMessage(handler func(map[string]any)) {
	uc.mu.Lock()
	defer uc.mu.Unlock()
	uc.msgHandler = handler
}

func (uc *unixClientConn) OnClose(handler func()) {
	uc.mu.Lock()
	defer uc.mu.Unlock()
	uc.closeHandler = handler
}

func (uc *unixClientConn) Close() error {
	return uc.conn.Close()
}

func (uc *unixClientConn) readLoop() {
	defer func() {
		uc.mu.Lock()
		handler := uc.closeHandler
		uc.mu.Unlock()
		if handler != nil {
			handler()
		}
	}()

	scanner := bufio.NewScanner(uc.conn)
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" {
			continue
		}
		var msg map[string]any
		if json.Unmarshal([]byte(line), &msg) != nil {
			continue
		}
		uc.mu.Lock()
		handler := uc.msgHandler
		uc.mu.Unlock()
		if handler != nil {
			handler(msg)
		}
	}
}
