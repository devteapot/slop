//! Helpers for binding application stores to SLOP registrations.

use std::sync::Arc;

use serde_json::Value;

use crate::server::SlopServer;

/// Function returned by a state store to stop listening for updates.
pub type StoreUnsubscribe = Box<dyn FnOnce() + Send + 'static>;

/// Minimal state store shape supported by [`expose_store`].
pub trait StateStore<S>: Send + Sync + 'static {
    fn get_state(&self) -> S;
    fn subscribe(&self, listener: Arc<dyn Fn() + Send + Sync>) -> StoreUnsubscribe;
}

/// Active binding between a state store and a SLOP registration.
///
/// Dropping the binding unsubscribes from the store and recursively unregisters
/// the exposed SLOP path.
pub struct StoreBinding {
    unsubscribe: Option<StoreUnsubscribe>,
    server: SlopServer,
    path: Option<String>,
}

impl StoreBinding {
    pub fn dispose(mut self) {
        self.cleanup();
    }

    fn cleanup(&mut self) {
        if let Some(unsubscribe) = self.unsubscribe.take() {
            unsubscribe();
        }
        if let Some(path) = self.path.take() {
            self.server.unregister_recursive(&path);
        }
    }
}

impl Drop for StoreBinding {
    fn drop(&mut self) {
        self.cleanup();
    }
}

/// Bind a generic state store to a SLOP node.
///
/// The store supplies change notifications; `project` decides what semantic
/// state and affordances to expose.
pub fn expose_store<S, T, F>(
    server: SlopServer,
    path: impl Into<String>,
    store: Arc<T>,
    project: F,
) -> StoreBinding
where
    S: Send + 'static,
    T: StateStore<S>,
    F: Fn(S) -> Value + Send + Sync + 'static,
{
    let path = path.into();
    let project = Arc::new(project);

    server.register(&path, project(store.get_state()));

    let listener_server = server.clone();
    let listener_path = path.clone();
    let listener_store = Arc::clone(&store);
    let listener_project = Arc::clone(&project);
    let listener = Arc::new(move || {
        listener_server.register(&listener_path, listener_project(listener_store.get_state()));
    });

    let unsubscribe = store.subscribe(listener);

    StoreBinding {
        unsubscribe: Some(unsubscribe),
        server,
        path: Some(path),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    use serde_json::json;

    type Listener = Arc<dyn Fn() + Send + Sync>;

    struct TestStore {
        state: Arc<Mutex<i64>>,
        listeners: Arc<Mutex<Vec<Listener>>>,
    }

    impl TestStore {
        fn new(state: i64) -> Self {
            Self {
                state: Arc::new(Mutex::new(state)),
                listeners: Arc::new(Mutex::new(Vec::new())),
            }
        }

        fn set_state(&self, state: i64) {
            *self.state.lock().unwrap() = state;
            let listeners = self.listeners.lock().unwrap().clone();
            for listener in listeners {
                listener();
            }
        }

        fn listener_count(&self) -> usize {
            self.listeners.lock().unwrap().len()
        }
    }

    impl StateStore<i64> for TestStore {
        fn get_state(&self) -> i64 {
            *self.state.lock().unwrap()
        }

        fn subscribe(&self, listener: Listener) -> StoreUnsubscribe {
            self.listeners.lock().unwrap().push(Arc::clone(&listener));
            let listeners = Arc::clone(&self.listeners);
            Box::new(move || {
                listeners
                    .lock()
                    .unwrap()
                    .retain(|candidate| !Arc::ptr_eq(candidate, &listener));
            })
        }
    }

    #[test]
    fn expose_store_registers_updates_and_cleans_up() {
        let slop = SlopServer::new("app", "App");
        let store = Arc::new(TestStore::new(1));

        let binding = expose_store(
            slop.clone(),
            "counter",
            Arc::clone(&store),
            |count| json!({"type": "status", "props": {"count": count}}),
        );

        assert_eq!(store.listener_count(), 1);
        assert_eq!(
            slop.tree().children.as_ref().unwrap()[0]
                .properties
                .as_ref()
                .unwrap()["count"],
            1
        );

        store.set_state(2);
        assert_eq!(
            slop.tree().children.as_ref().unwrap()[0]
                .properties
                .as_ref()
                .unwrap()["count"],
            2
        );

        slop.register("counter/details", json!({"type": "group"}));

        drop(binding);

        assert_eq!(store.listener_count(), 0);
        assert!(slop.tree().children.as_ref().map_or(true, |c| c.is_empty()));

        store.set_state(3);
        assert!(slop.tree().children.as_ref().map_or(true, |c| c.is_empty()));
    }
}
