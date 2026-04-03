package slop

import (
	"context"
	"encoding/json"
	"sync"

	"nhooyr.io/websocket"
)

// WSClientTransport connects to a SLOP provider over WebSocket.
type WSClientTransport struct {
	URL string
}

type wsClientConn struct {
	conn         *websocket.Conn
	ctx          context.Context
	cancel       context.CancelFunc
	mu           sync.Mutex
	msgHandler   func(map[string]any)
	closeHandler func()
}

// Connect dials the WebSocket URL and returns a ClientConnection.
func (t *WSClientTransport) Connect(ctx context.Context) (ClientConnection, error) {
	c, _, err := websocket.Dial(ctx, t.URL, nil)
	if err != nil {
		return nil, err
	}
	connCtx, cancel := context.WithCancel(ctx)
	wc := &wsClientConn{conn: c, ctx: connCtx, cancel: cancel}
	go wc.readLoop()
	return wc, nil
}

func (wc *wsClientConn) Send(msg map[string]any) error {
	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	wc.mu.Lock()
	defer wc.mu.Unlock()
	return wc.conn.Write(wc.ctx, websocket.MessageText, data)
}

func (wc *wsClientConn) OnMessage(handler func(map[string]any)) {
	wc.mu.Lock()
	defer wc.mu.Unlock()
	wc.msgHandler = handler
}

func (wc *wsClientConn) OnClose(handler func()) {
	wc.mu.Lock()
	defer wc.mu.Unlock()
	wc.closeHandler = handler
}

func (wc *wsClientConn) Close() error {
	wc.cancel()
	return wc.conn.Close(websocket.StatusNormalClosure, "")
}

func (wc *wsClientConn) readLoop() {
	defer func() {
		wc.mu.Lock()
		handler := wc.closeHandler
		wc.mu.Unlock()
		if handler != nil {
			handler()
		}
	}()

	for {
		_, data, err := wc.conn.Read(wc.ctx)
		if err != nil {
			return
		}
		var msg map[string]any
		if json.Unmarshal(data, &msg) != nil {
			continue
		}
		wc.mu.Lock()
		handler := wc.msgHandler
		wc.mu.Unlock()
		if handler != nil {
			handler(msg)
		}
	}
}
