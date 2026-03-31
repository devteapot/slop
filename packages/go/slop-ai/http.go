package slop

import (
	"encoding/json"
	"net/http"
	"sync"

	"nhooyr.io/websocket"
)

type wsConn struct {
	ws *websocket.Conn
	mu sync.Mutex
}

func (c *wsConn) Send(msg any) error {
	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.ws.Write(nil, websocket.MessageText, data)
}

func (c *wsConn) Close() error {
	return c.ws.Close(websocket.StatusNormalClosure, "")
}

// WebSocketHandler returns an http.Handler that upgrades connections to WebSocket
// and speaks the SLOP protocol.
func (s *Server) WebSocketHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ws, err := websocket.Accept(w, r, &websocket.AcceptOptions{
			InsecureSkipVerify: true, // Allow cross-origin for dev
		})
		if err != nil {
			return
		}
		defer ws.CloseNow()

		conn := &wsConn{ws: ws}
		s.HandleConnection(conn)
		defer s.HandleDisconnect(conn)

		for {
			_, data, err := ws.Read(r.Context())
			if err != nil {
				return
			}
			var msg map[string]any
			if json.Unmarshal(data, &msg) == nil {
				s.HandleMessage(conn, msg)
			}
		}
	})
}

// DiscoveryHandler returns an http.Handler that serves the /.well-known/slop
// discovery endpoint.
func (s *Server) DiscoveryHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id":           s.id,
			"name":         s.name,
			"slop_version": "0.1",
			"transport":    map[string]any{"type": "ws", "url": "ws://" + r.Host + "/slop"},
			"capabilities": []string{"state", "patches", "affordances", "attention", "windowing", "async", "content_refs"},
		})
	})
}

// Mount adds SLOP endpoints to the given ServeMux:
//   - GET /slop — WebSocket upgrade
//   - GET /.well-known/slop — discovery
func (s *Server) Mount(mux *http.ServeMux) {
	mux.Handle("/slop", s.WebSocketHandler())
	mux.Handle("/.well-known/slop", s.DiscoveryHandler())
}
