package slop

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
)

type subscription struct {
	id              string
	path            string
	depth           int
	filterTypes     []string
	filterMinSal    *float64
	connection      Connection
	lastTree        *WireNode
}

// Server is a SLOP provider that manages state registrations, connections,
// and message routing. It is safe for concurrent use.
type Server struct {
	id   string
	name string

	mu              sync.RWMutex
	staticRegs      map[string]Node
	dynamicRegs     map[string]func() Node
	actionHandlers  map[string]Handler
	actionMeta      map[string]map[string]ActionOpts // path → action → opts
	currentTree     WireNode
	currentHandlers map[string]Handler
	version         uint64
	subscriptions   []subscription
	connections     []Connection
	changeListeners []func()
	eventListeners  []Connection // all connections that receive events
}

// NewServer creates a new SLOP server with the given provider ID and name.
func NewServer(id, name string) *Server {
	return &Server{
		id:             id,
		name:           name,
		staticRegs:     map[string]Node{},
		dynamicRegs:    map[string]func() Node{},
		actionHandlers: map[string]Handler{},
		actionMeta:     map[string]map[string]ActionOpts{},
		currentTree:    WireNode{ID: id, Type: "root"},
	}
}

// Tree returns the current state tree.
func (s *Server) Tree() WireNode {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.currentTree
}

// Version returns the current tree version number.
func (s *Server) Version() uint64 {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.version
}

// Register adds a static node descriptor at the given path.
func (s *Server) Register(path string, node Node) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.dynamicRegs, path)
	// Merge action metadata from Handle/HandleWith calls
	node = s.mergeActionMeta(path, node)
	s.staticRegs[path] = node
	s.rebuild()
}

// RegisterFunc adds a dynamic descriptor function that is re-evaluated on every Refresh.
func (s *Server) RegisterFunc(path string, fn func() Node) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.staticRegs, path)
	s.dynamicRegs[path] = fn
	s.rebuild()
}

// Handle registers an action handler at path/action.
func (s *Server) Handle(path, action string, h Handler) {
	s.HandleWith(path, action, h, ActionOpts{})
}

// HandleWith registers an action handler with metadata at path/action.
func (s *Server) HandleWith(path, action string, h Handler, opts ActionOpts) {
	s.mu.Lock()
	defer s.mu.Unlock()

	key := action
	if path != "" {
		key = path + "/" + action
	}
	s.actionHandlers[key] = h

	if s.actionMeta[path] == nil {
		s.actionMeta[path] = map[string]ActionOpts{}
	}
	s.actionMeta[path][action] = opts

	// Re-merge if statically registered
	if node, ok := s.staticRegs[path]; ok {
		s.staticRegs[path] = s.mergeActionMeta(path, node)
		s.rebuild()
	}
}

// Unregister removes the registration at path.
func (s *Server) Unregister(path string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.staticRegs, path)
	delete(s.dynamicRegs, path)
	s.rebuild()
}

// Scope returns a ScopedServer that prefixes all paths.
func (s *Server) Scope(prefix string) *ScopedServer {
	return &ScopedServer{server: s, prefix: prefix}
}

// Refresh re-evaluates all dynamic registrations, diffs, and broadcasts patches.
func (s *Server) Refresh() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.rebuild()
}

// OnChange registers a callback fired after each tree change.
// Returns an unsubscribe function.
func (s *Server) OnChange(fn func()) func() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.changeListeners = append(s.changeListeners, fn)
	idx := len(s.changeListeners) - 1
	return func() {
		s.mu.Lock()
		defer s.mu.Unlock()
		if idx < len(s.changeListeners) {
			s.changeListeners = append(s.changeListeners[:idx], s.changeListeners[idx+1:]...)
		}
	}
}

// Stop closes all connections and cleans up.
func (s *Server) Stop() {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, conn := range s.connections {
		_ = conn.Close()
	}
	s.connections = nil
	s.subscriptions = nil
}

// --- Connection lifecycle (used by transports) ---

// HandleConnection registers a new consumer connection and sends the hello message.
func (s *Server) HandleConnection(conn Connection) {
	s.mu.RLock()
	hello := map[string]any{
		"type": "hello",
		"provider": map[string]any{
			"id":           s.id,
			"name":         s.name,
			"slop_version": "0.1",
			"capabilities": []string{"state", "patches", "affordances", "attention", "windowing", "async", "content_refs"},
		},
	}
	s.mu.RUnlock()

	_ = conn.Send(hello)

	s.mu.Lock()
	s.connections = append(s.connections, conn)
	s.mu.Unlock()
}

// HandleMessage processes an incoming SLOP message from a consumer.
func (s *Server) HandleMessage(conn Connection, msg map[string]any) {
	msgType, _ := msg["type"].(string)

	switch msgType {
	case "subscribe":
		subID, _ := msg["id"].(string)
		path, _ := msg["path"].(string)
		if path == "" {
			path = "/"
		}
		depth := -1
		if d, ok := msg["depth"].(float64); ok {
			depth = int(d)
		}

		// Parse filter
		var filterTypes []string
		var filterMinSal *float64
		if filterMap, ok := msg["filter"].(map[string]any); ok {
			if types, ok := filterMap["types"].([]any); ok {
				for _, t := range types {
					if s, ok := t.(string); ok {
						filterTypes = append(filterTypes, s)
					}
				}
			}
			if ms, ok := filterMap["min_salience"].(float64); ok {
				filterMinSal = &ms
			}
		}

		s.mu.RLock()
		outTree := s.getOutputTree(path, depth, filterTypes, filterMinSal)
		ver := s.version
		s.mu.RUnlock()

		if outTree == nil {
			_ = conn.Send(map[string]any{
				"type": "error",
				"id":   subID,
				"error": map[string]any{
					"code":    "not_found",
					"message": "Path " + path + " does not exist in the state tree",
				},
			})
			return
		}

		_ = conn.Send(map[string]any{
			"type":    "snapshot",
			"id":      subID,
			"version": ver,
			"tree":    wireNodeToMap(*outTree),
		})

		s.mu.Lock()
		initTree := cloneWireNode(*outTree)
		s.subscriptions = append(s.subscriptions, subscription{
			id: subID, path: path, depth: depth, connection: conn,
			filterTypes:  filterTypes,
			filterMinSal: filterMinSal,
			lastTree:     &initTree,
		})
		s.mu.Unlock()

	case "unsubscribe":
		subID, _ := msg["id"].(string)
		s.mu.Lock()
		filtered := s.subscriptions[:0]
		for _, sub := range s.subscriptions {
			if sub.id != subID {
				filtered = append(filtered, sub)
			}
		}
		s.subscriptions = filtered
		s.mu.Unlock()

	case "query":
		qID, _ := msg["id"].(string)
		qPath, _ := msg["path"].(string)
		if qPath == "" {
			qPath = "/"
		}
		qDepth := -1
		if d, ok := msg["depth"].(float64); ok {
			qDepth = int(d)
		}

		s.mu.RLock()
		outTree := s.getOutputTree(qPath, qDepth, nil, nil)
		ver := s.version
		s.mu.RUnlock()

		if outTree == nil {
			_ = conn.Send(map[string]any{
				"type": "error",
				"id":   qID,
				"error": map[string]any{
					"code":    "not_found",
					"message": "Path " + qPath + " does not exist in the state tree",
				},
			})
			return
		}

		// Apply window [offset, count] to children
		if w, ok := msg["window"].([]any); ok && len(w) == 2 {
			offset := jsonIntFromAny(w[0])
			count := jsonIntFromAny(w[1])
			if offset < len(outTree.Children) {
				end := offset + count
				if end > len(outTree.Children) {
					end = len(outTree.Children)
				}
				outTree.Children = outTree.Children[offset:end]
			} else {
				outTree.Children = nil
			}
		}

		_ = conn.Send(map[string]any{
			"type":    "snapshot",
			"id":      qID,
			"version": ver,
			"tree":    wireNodeToMap(*outTree),
		})

	case "invoke":
		s.handleInvoke(conn, msg)

	default:
		msgID, _ := msg["id"].(string)
		errMsg := map[string]any{
			"type": "error",
			"error": map[string]any{
				"code":    "bad_request",
				"message": "Unknown message type: " + msgType,
			},
		}
		if msgID != "" {
			errMsg["id"] = msgID
		}
		_ = conn.Send(errMsg)
	}
}

// HandleDisconnect removes a consumer connection and its subscriptions.
func (s *Server) HandleDisconnect(conn Connection) {
	s.mu.Lock()
	defer s.mu.Unlock()

	// Remove connection
	filtered := s.connections[:0]
	for _, c := range s.connections {
		if c != conn {
			filtered = append(filtered, c)
		}
	}
	s.connections = filtered

	// Remove subscriptions
	filteredSubs := s.subscriptions[:0]
	for _, sub := range s.subscriptions {
		if sub.connection != conn {
			filteredSubs = append(filteredSubs, sub)
		}
	}
	s.subscriptions = filteredSubs
}

// EmitEvent sends an event message to all connected consumers.
func (s *Server) EmitEvent(name string, data any) {
	s.mu.RLock()
	conns := make([]Connection, len(s.connections))
	copy(conns, s.connections)
	s.mu.RUnlock()

	msg := map[string]any{
		"type": "event",
		"name": name,
		"data": data,
	}
	for _, conn := range conns {
		_ = conn.Send(msg)
	}
}

// getOutputTree returns a filtered/depth-limited subtree for output.
// Returns nil if the path doesn't exist in the tree.
func (s *Server) getOutputTree(path string, depth int, filterTypes []string, filterMinSalience *float64) *WireNode {
	tree := cloneWireNode(s.currentTree)
	var target *WireNode
	if path == "/" || path == "" {
		target = &tree
	} else {
		target = GetSubtree(&tree, path)
		if target == nil {
			return nil
		}
		// Clone the subtree out so we own it
		clone := cloneWireNode(*target)
		target = &clone
	}

	opts := OutputTreeOptions{
		MinSalience: filterMinSalience,
		Types:       filterTypes,
	}
	if depth >= 0 {
		opts.MaxDepth = &depth
	}
	result := PrepareTree(*target, opts)
	return &result
}

// --- Internal ---

func (s *Server) handleInvoke(conn Connection, msg map[string]any) {
	path, _ := msg["path"].(string)
	action, _ := msg["action"].(string)
	msgID, _ := msg["id"].(string)
	params, _ := msg["params"].(map[string]any)
	if params == nil {
		params = map[string]any{}
	}

	// Resolve handler key
	handlerKey := s.resolveHandlerKey(path, action)

	// Find handler — clone reference out of lock
	s.mu.RLock()
	handler, ok := s.currentHandlers[handlerKey]
	if !ok {
		handler, ok = s.actionHandlers[handlerKey]
	}
	s.mu.RUnlock()

	if !ok {
		_ = conn.Send(map[string]any{
			"type":   "result",
			"id":     msgID,
			"status": "error",
			"error": map[string]any{
				"code":    "not_found",
				"message": fmt.Sprintf("No handler for %s at %s", action, path),
			},
		})
		return
	}

	result, err := handler.HandleAction(context.Background(), Params(params))
	if err != nil {
		_ = conn.Send(map[string]any{
			"type":   "result",
			"id":     msgID,
			"status": "error",
			"error":  map[string]any{"code": "internal", "message": err.Error()},
		})
		return
	}

	status := "ok"
	if m, ok := result.(map[string]any); ok {
		if async, _ := m["__async"].(bool); async {
			status = "accepted"
		}
	}

	resp := map[string]any{
		"type":   "result",
		"id":     msgID,
		"status": status,
	}
	if result != nil {
		if m, ok := result.(map[string]any); ok {
			filtered := map[string]any{}
			for k, v := range m {
				if k != "__async" {
					filtered[k] = v
				}
			}
			if len(filtered) > 0 {
				resp["data"] = filtered
			}
		} else {
			resp["data"] = result
		}
	}
	_ = conn.Send(resp)

	// Auto-refresh after invoke
	s.Refresh()
}

func (s *Server) resolveHandlerKey(path, action string) string {
	rootPrefix := "/" + s.id + "/"
	clean := path
	if strings.HasPrefix(clean, rootPrefix) {
		clean = clean[len(rootPrefix):]
	} else if strings.HasPrefix(clean, "/") {
		clean = clean[1:]
	}
	if clean == "" {
		return action
	}
	return clean + "/" + action
}

func (s *Server) rebuild() {
	allDescs := map[string]Node{}

	// Evaluate dynamic registrations
	for path, fn := range s.dynamicRegs {
		node := fn()
		node = s.mergeActionMeta(path, node)
		allDescs[path] = node
	}

	// Static registrations
	for path, node := range s.staticRegs {
		allDescs[path] = node
	}

	tree, handlers := assembleTree(allDescs, s.id, s.name)
	ops := diffNodes(&s.currentTree, &tree, "")
	s.currentHandlers = handlers

	if len(ops) > 0 {
		s.currentTree = tree
		s.version++
		s.broadcastPatches()
		for _, fn := range s.changeListeners {
			fn()
		}
	} else if s.version == 0 {
		s.currentTree = tree
		s.version = 1
	}
}

func (s *Server) broadcastPatches() {
	for i := range s.subscriptions {
		sub := &s.subscriptions[i]
		outTree := s.getOutputTree(sub.path, sub.depth, sub.filterTypes, sub.filterMinSal)
		if outTree == nil {
			continue
		}
		ops := diffNodes(sub.lastTree, outTree, "")
		if len(ops) == 0 {
			continue
		}
		_ = sub.connection.Send(map[string]any{
			"type":         "patch",
			"subscription": sub.id,
			"version":      s.version,
			"ops":          ops,
		})
		updated := cloneWireNode(*outTree)
		sub.lastTree = &updated
	}
}

func (s *Server) mergeActionMeta(path string, node Node) Node {
	meta, ok := s.actionMeta[path]
	if !ok || len(meta) == 0 {
		return node
	}

	if node.Actions == nil {
		node.Actions = Actions{}
	}
	for actionName, opts := range meta {
		if _, exists := node.Actions[actionName]; !exists {
			// Create a placeholder handler that delegates to actionHandlers
			key := actionName
			if path != "" {
				key = path + "/" + actionName
			}
			if h, ok := s.actionHandlers[key]; ok {
				if opts.Label != "" || opts.Description != "" || opts.Dangerous || opts.Idempotent || opts.Estimate != "" || opts.Params != nil {
					node.Actions[actionName] = WithOpts(h, opts)
				} else {
					node.Actions[actionName] = h
				}
			}
		}
	}
	return node
}

// jsonIntFromAny extracts an int from float64/int/json.Number.
func jsonIntFromAny(v any) int {
	switch n := v.(type) {
	case float64:
		return int(n)
	case int:
		return n
	case int64:
		return int(n)
	}
	return 0
}

// wireNodeToMap converts a WireNode to a map for JSON serialization
// through the Connection.Send interface.
func wireNodeToMap(wn WireNode) map[string]any {
	data, _ := json.Marshal(wn)
	var m map[string]any
	_ = json.Unmarshal(data, &m)
	return m
}

// ScopedServer prefixes all paths with a given prefix.
type ScopedServer struct {
	server *Server
	prefix string
}

// Register adds a static node under the scoped prefix.
func (ss *ScopedServer) Register(path string, node Node) {
	ss.server.Register(ss.prefix+"/"+path, node)
}

// RegisterFunc adds a dynamic descriptor under the scoped prefix.
func (ss *ScopedServer) RegisterFunc(path string, fn func() Node) {
	ss.server.RegisterFunc(ss.prefix+"/"+path, fn)
}

// Handle registers an action handler under the scoped prefix.
func (ss *ScopedServer) Handle(path, action string, h Handler) {
	ss.server.Handle(ss.prefix+"/"+path, action, h)
}

// HandleWith registers an action handler with opts under the scoped prefix.
func (ss *ScopedServer) HandleWith(path, action string, h Handler, opts ActionOpts) {
	ss.server.HandleWith(ss.prefix+"/"+path, action, h, opts)
}

// Unregister removes the registration under the scoped prefix.
func (ss *ScopedServer) Unregister(path string) {
	ss.server.Unregister(ss.prefix + "/" + path)
}

// Scope creates a nested scope.
func (ss *ScopedServer) Scope(sub string) *ScopedServer {
	return ss.server.Scope(ss.prefix + "/" + sub)
}

// Refresh delegates to the parent server.
func (ss *ScopedServer) Refresh() {
	ss.server.Refresh()
}
