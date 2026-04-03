use thiserror::Error;

#[derive(Error, Debug)]
pub enum SlopError {
    #[error("serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("no handler for action '{action}' at path '{path}'")]
    HandlerNotFound { path: String, action: String },

    #[error("action failed: {message}")]
    ActionFailed { code: String, message: String },

    #[error("transport error: {0}")]
    Transport(String),

    #[error("connection closed")]
    ConnectionClosed,
}

pub type Result<T> = std::result::Result<T, SlopError>;
