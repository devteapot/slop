package slop

import (
	"sync"
	"time"
)

// StoreUnsubscribe stops a store subscription or SLOP store binding.
type StoreUnsubscribe func()

// StateStore is the minimal store shape supported by ExposeStore.
type StateStore[S any] interface {
	GetState() S
	Subscribe(listener func()) StoreUnsubscribe
}

// StoreTarget is the minimal SLOP registration target supported by ExposeStore.
type StoreTarget interface {
	Register(path string, node Node)
	Unregister(path string, opts ...UnregisterOption)
}

type exposeStoreOptions[S any] struct {
	pathFunc   func(S) string
	equals     func(S, S) bool
	debounceMs time.Duration
}

// ExposeStoreOption configures ExposeStore.
type ExposeStoreOption[S any] func(*exposeStoreOptions[S])

// WithStorePath computes the SLOP path from the current store state.
func WithStorePath[S any](fn func(S) string) ExposeStoreOption[S] {
	return func(opts *exposeStoreOptions[S]) {
		opts.pathFunc = fn
	}
}

// WithStoreEquals skips projection work when store emissions do not affect the SLOP projection.
func WithStoreEquals[S any](fn func(previous, next S) bool) ExposeStoreOption[S] {
	return func(opts *exposeStoreOptions[S]) {
		opts.equals = fn
	}
}

// WithStoreDebounce debounces store emissions before recomputing the descriptor.
func WithStoreDebounce[S any](duration time.Duration) ExposeStoreOption[S] {
	return func(opts *exposeStoreOptions[S]) {
		opts.debounceMs = duration
	}
}

// ExposeStore binds a generic state store to a SLOP node.
//
// The store supplies change notifications; project decides what semantic state
// and affordances to expose.
func ExposeStore[S any](
	target StoreTarget,
	path string,
	store StateStore[S],
	project func(S) Node,
	options ...ExposeStoreOption[S],
) StoreUnsubscribe {
	opts := exposeStoreOptions[S]{
		pathFunc: func(S) string { return path },
	}
	for _, option := range options {
		option(&opts)
	}

	var mu sync.Mutex
	var currentPath string
	var previousState S
	var hasPreviousState bool
	var disposed bool
	var timer *time.Timer

	update := func() {
		mu.Lock()
		defer mu.Unlock()

		if disposed {
			return
		}

		state := store.GetState()
		if hasPreviousState && opts.equals != nil && opts.equals(previousState, state) {
			return
		}

		nextPath := opts.pathFunc(state)
		if currentPath != "" && currentPath != nextPath {
			target.Unregister(currentPath, WithRecursiveUnregister())
		}

		target.Register(nextPath, project(state))
		currentPath = nextPath
		previousState = state
		hasPreviousState = true
	}

	scheduleUpdate := func() {
		mu.Lock()
		if disposed {
			mu.Unlock()
			return
		}
		if opts.debounceMs <= 0 {
			mu.Unlock()
			update()
			return
		}
		if timer != nil {
			timer.Stop()
		}
		timer = time.AfterFunc(opts.debounceMs, update)
		mu.Unlock()
	}

	update()
	unsubscribe := store.Subscribe(scheduleUpdate)

	return func() {
		mu.Lock()
		disposed = true
		if timer != nil {
			timer.Stop()
			timer = nil
		}
		pathToRemove := currentPath
		currentPath = ""
		mu.Unlock()

		unsubscribe()
		if pathToRemove != "" {
			target.Unregister(pathToRemove, WithRecursiveUnregister())
		}
	}
}
