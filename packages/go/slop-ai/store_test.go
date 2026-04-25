package slop

import (
	"sync"
	"testing"
)

type testStoreState struct {
	Board   string
	Count   int
	Ignored string
}

type testStore struct {
	mu        sync.Mutex
	state     testStoreState
	listeners map[int]func()
	nextID    int
}

func newTestStore(state testStoreState) *testStore {
	return &testStore{state: state, listeners: map[int]func(){}}
}

func (s *testStore) GetState() testStoreState {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.state
}

func (s *testStore) Subscribe(listener func()) StoreUnsubscribe {
	s.mu.Lock()
	defer s.mu.Unlock()

	id := s.nextID
	s.nextID++
	s.listeners[id] = listener

	return func() {
		s.mu.Lock()
		defer s.mu.Unlock()
		delete(s.listeners, id)
	}
}

func (s *testStore) SetState(state testStoreState) {
	s.mu.Lock()
	s.state = state
	listeners := make([]func(), 0, len(s.listeners))
	for _, listener := range s.listeners {
		listeners = append(listeners, listener)
	}
	s.mu.Unlock()

	for _, listener := range listeners {
		listener()
	}
}

func (s *testStore) ListenerCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.listeners)
}

func TestExposeStoreRegistersAndUpdates(t *testing.T) {
	server := NewServer("app", "App")
	store := newTestStore(testStoreState{Count: 1})

	ExposeStore(server, "counter", store, func(state testStoreState) Node {
		return Node{Type: "status", Props: Props{"count": state.Count}}
	})

	tree := server.Tree()
	if got := tree.Children[0].Properties["count"]; got != 1 {
		t.Fatalf("expected count 1, got %v", got)
	}

	store.SetState(testStoreState{Count: 2})

	tree = server.Tree()
	if got := tree.Children[0].Properties["count"]; got != 2 {
		t.Fatalf("expected count 2, got %v", got)
	}
}

func TestExposeStoreCleanupUnsubscribesAndUnregistersRecursively(t *testing.T) {
	server := NewServer("app", "App")
	store := newTestStore(testStoreState{Count: 1})
	server.Register("counter/details", Node{Type: "group"})

	dispose := ExposeStore(server, "counter", store, func(state testStoreState) Node {
		return Node{Type: "status", Props: Props{"count": state.Count}}
	})

	if got := store.ListenerCount(); got != 1 {
		t.Fatalf("expected one listener, got %d", got)
	}

	dispose()

	if got := store.ListenerCount(); got != 0 {
		t.Fatalf("expected no listeners, got %d", got)
	}
	if len(server.Tree().Children) != 0 {
		t.Fatalf("expected empty tree after cleanup")
	}

	store.SetState(testStoreState{Count: 2})
	if len(server.Tree().Children) != 0 {
		t.Fatalf("expected cleanup to prevent later updates")
	}
}

func TestExposeStoreDynamicPathAndEquals(t *testing.T) {
	server := NewServer("app", "App")
	store := newTestStore(testStoreState{Board: "one", Count: 1, Ignored: "a"})
	projectCount := 0

	ExposeStore(
		server,
		"boards/one",
		store,
		func(state testStoreState) Node {
			projectCount++
			return Node{Type: "view", Props: Props{"count": state.Count}}
		},
		WithStorePath(func(state testStoreState) string {
			return "boards/" + state.Board
		}),
		WithStoreEquals(func(previous, next testStoreState) bool {
			return previous.Board == next.Board && previous.Count == next.Count
		}),
	)

	store.SetState(testStoreState{Board: "one", Count: 1, Ignored: "b"})
	if projectCount != 1 {
		t.Fatalf("expected equality skip to avoid projection, got %d projections", projectCount)
	}

	store.SetState(testStoreState{Board: "two", Count: 3, Ignored: "b"})

	tree := server.Tree()
	boards := tree.Children[0]
	if boards.ID != "boards" || boards.Children[0].ID != "two" {
		t.Fatalf("expected boards/two path, got %#v", boards)
	}
	if got := boards.Children[0].Properties["count"]; got != 3 {
		t.Fatalf("expected count 3, got %v", got)
	}
}
