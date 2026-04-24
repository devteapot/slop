package slop

import (
	"encoding/json"
	"net"
	"net/http"
	"sync"

	"nhooyr.io/websocket"
)

// WebSocketHandlerOptions configures the WebSocket upgrade handler.
//
// Per spec/core/transport.md §Security considerations, non-loopback connections
// MUST be authenticated; servers MUST validate Origin for browser clients.
type WebSocketHandlerOptions struct {
	// Authenticate is called with every upgrade request before acceptance.
	// Return nil to accept. Return a non-nil error to reject with 401.
	// If nil, non-loopback upgrades are rejected by default.
	Authenticate func(r *http.Request) error
	// AllowedOrigins is the list of acceptable Origin values for browser
	// connections. Leave nil to skip Origin checks for non-browser clients,
	// but note the default-reject rule below applies when empty.
	AllowedOrigins []string
	// InsecureAllowAllOrigins disables origin checking. Opt-in only; intended
	// for local development. Logs a warning on first use.
	InsecureAllowAllOrigins bool
}

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

// WebSocketHandler returns an http.Handler that upgrades connections to
// WebSocket and speaks the SLOP protocol, with secure defaults.
//
// Without options, the handler authenticates only loopback connections and
// enforces same-origin WebSocket upgrades. Use WebSocketHandlerWithOptions for
// production auth hooks and explicit origin allowlists.
func (s *Server) WebSocketHandler() http.Handler {
	return s.WebSocketHandlerWithOptions(WebSocketHandlerOptions{})
}

// WebSocketHandlerWithOptions returns a WebSocket handler with the supplied
// authentication and origin-check configuration.
func (s *Server) WebSocketHandlerWithOptions(opts WebSocketHandlerOptions) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := s.authorizeUpgrade(r, opts); err != nil {
			http.Error(w, err.Error(), http.StatusUnauthorized)
			return
		}

		accept := &websocket.AcceptOptions{}
		if opts.InsecureAllowAllOrigins {
			accept.InsecureSkipVerify = true
		} else if len(opts.AllowedOrigins) > 0 {
			accept.OriginPatterns = opts.AllowedOrigins
		}

		ws, err := websocket.Accept(w, r, accept)
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
				s.HandleMessage(r.Context(), conn, msg)
			}
		}
	})
}

func (s *Server) authorizeUpgrade(r *http.Request, opts WebSocketHandlerOptions) error {
	if opts.Authenticate != nil {
		return opts.Authenticate(r)
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	ip := net.ParseIP(host)
	if ip != nil && ip.IsLoopback() {
		return nil
	}
	return errUnauthorized
}

var errUnauthorized = unauthorizedErr("unauthorized")

type unauthorizedErr string

func (e unauthorizedErr) Error() string { return string(e) }

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
