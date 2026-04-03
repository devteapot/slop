use std::sync::Arc;

use slop_ai::{SlopConsumer, SlopNode};
use tokio::sync::Mutex;

/// An active connection to a SLOP provider.
pub struct ActiveConnection {
    pub consumer: Arc<SlopConsumer>,
    #[allow(dead_code)]
    pub subscription_id: String,
    pub current_tree: Arc<Mutex<SlopNode>>,
}

impl ActiveConnection {
    pub fn new(consumer: Arc<SlopConsumer>, subscription_id: String, tree: SlopNode) -> Self {
        Self {
            consumer,
            subscription_id,
            current_tree: Arc::new(Mutex::new(tree)),
        }
    }

    pub async fn tree(&self) -> SlopNode {
        self.current_tree.lock().await.clone()
    }
}
