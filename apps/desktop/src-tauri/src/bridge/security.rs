//! Bridge upgrade security: Origin validation and pairing-token authentication.
//!
//! Implements the `Sec-WebSocket-Protocol` bearer-token pattern from
//! spec/core/transport.md (Security considerations) specialized for the
//! bridge's one legitimate peer — the browser extension:
//!
//! - Upgrades carrying a web `Origin` (`http`/`https` scheme, or the literal
//!   `null`) are rejected with 403. Extension origins and absent Origin pass.
//! - The client offers `Sec-WebSocket-Protocol: slop.bearer, <token>`. The
//!   server verifies the token in constant time and echoes back only the
//!   non-secret `slop.bearer` label. Missing/invalid token is rejected with 401.
//! - The token is never logged.

use std::path::PathBuf;
use std::sync::RwLock;

use base64::Engine;
use serde::{Deserialize, Serialize};
use subtle::ConstantTimeEq;

/// Subprotocol label offered alongside the token; the only subprotocol the
/// server ever echoes back on a successful upgrade.
pub const BEARER_PROTOCOL: &str = "slop.bearer";

const TOKEN_FILE: &str = "bridge-pairing.json";

/// Returns `true` when an `Origin` header value identifies a web page (scheme
/// `http` or `https`) or is the opaque literal `null` — such upgrades must be
/// rejected with 403. Extension-scheme origins (`chrome-extension://...`,
/// `moz-extension://...`, `safari-web-extension://...`) pass this check; the
/// token check still applies to them.
pub fn origin_is_forbidden(origin: &str) -> bool {
    let origin = origin.trim();
    if origin.eq_ignore_ascii_case("null") {
        return true;
    }
    let scheme = origin.split(':').next().unwrap_or("");
    scheme.eq_ignore_ascii_case("http") || scheme.eq_ignore_ascii_case("https")
}

/// Extracts the bearer token from `Sec-WebSocket-Protocol` header values.
///
/// The client offers two subprotocol entries — the literal label
/// `slop.bearer` and the token value — either as one comma-separated header
/// (`Sec-WebSocket-Protocol: slop.bearer, <token>`) or as repeated headers.
/// Returns the token entry only when the `slop.bearer` label is also present.
pub fn extract_bearer_token(header_values: &[&str]) -> Option<String> {
    let mut label_seen = false;
    let mut token: Option<String> = None;

    for value in header_values {
        for entry in value.split(',') {
            let entry = entry.trim();
            if entry.is_empty() {
                continue;
            }
            if entry == BEARER_PROTOCOL {
                label_seen = true;
            } else if token.is_none() {
                token = Some(entry.to_string());
            }
        }
    }

    if label_seen {
        token
    } else {
        None
    }
}

/// Constant-time comparison of the offered token against the expected one.
/// Never matches an empty expected token (a misconfigured store must not
/// become an open door).
pub fn token_matches(offered: &str, expected: &str) -> bool {
    !expected.is_empty() && bool::from(offered.as_bytes().ct_eq(expected.as_bytes()))
}

/// Generates a 32-byte cryptographically random token, base64url-encoded
/// without padding.
pub fn generate_token() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).map_err(|e| format!("failed to gather entropy: {}", e))?;
    Ok(base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes))
}

#[derive(Serialize, Deserialize)]
struct TokenStorage {
    token: String,
}

/// Bridge pairing token, persisted in the app data directory alongside the
/// other settings files (`bridge-pairing.json`).
pub struct BridgeToken {
    token: RwLock<String>,
    path: PathBuf,
}

impl BridgeToken {
    /// Loads the persisted pairing token, generating and persisting a fresh
    /// one on first launch (or if the stored file is missing/corrupt).
    pub fn load_or_create(app_data_dir: PathBuf) -> Self {
        let path = app_data_dir.join(TOKEN_FILE);

        let existing = std::fs::read_to_string(&path)
            .ok()
            .and_then(|content| serde_json::from_str::<TokenStorage>(&content).ok())
            .map(|storage| storage.token)
            .filter(|token| !token.is_empty());

        let token = match existing {
            Some(token) => token,
            None => {
                let token = generate_token().unwrap_or_default();
                if !token.is_empty() {
                    save_token(&path, &token);
                }
                token
            }
        };

        Self {
            token: RwLock::new(token),
            path,
        }
    }

    /// Current pairing token.
    pub fn current(&self) -> String {
        self.token.read().map(|t| t.clone()).unwrap_or_default()
    }

    /// Generates, persists, and swaps in a new pairing token. Existing bridge
    /// connections must be disconnected by the caller.
    pub fn regenerate(&self) -> Result<String, String> {
        let new_token = generate_token()?;
        save_token(&self.path, &new_token);
        if let Ok(mut guard) = self.token.write() {
            *guard = new_token.clone();
        }
        Ok(new_token)
    }
}

fn save_token(path: &PathBuf, token: &str) {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let storage = TokenStorage {
        token: token.to_string(),
    };
    if let Ok(json) = serde_json::to_string_pretty(&storage) {
        let _ = std::fs::write(path, json);
        // The token file is a credential: restrict to the owner.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── Origin gate ─────────────────────────────────────────────────────

    #[test]
    fn rejects_http_and_https_origins() {
        assert!(origin_is_forbidden("http://localhost:3000"));
        assert!(origin_is_forbidden("https://evil.example.com"));
        assert!(origin_is_forbidden("HTTPS://EVIL.EXAMPLE.COM"));
        assert!(origin_is_forbidden("  http://padded.example  "));
    }

    #[test]
    fn rejects_null_origin() {
        assert!(origin_is_forbidden("null"));
        assert!(origin_is_forbidden("NULL"));
    }

    #[test]
    fn allows_extension_origins() {
        assert!(!origin_is_forbidden("chrome-extension://abcdefghijklmnop"));
        assert!(!origin_is_forbidden("moz-extension://uuid-here"));
        assert!(!origin_is_forbidden("safari-web-extension://uuid-here"));
    }

    // ── Subprotocol token extraction ────────────────────────────────────

    #[test]
    fn extracts_token_from_single_comma_separated_header() {
        let values = ["slop.bearer, my-secret-token"];
        assert_eq!(
            extract_bearer_token(&values),
            Some("my-secret-token".to_string())
        );
    }

    #[test]
    fn extracts_token_from_repeated_headers() {
        let values = ["slop.bearer", "my-secret-token"];
        assert_eq!(
            extract_bearer_token(&values),
            Some("my-secret-token".to_string())
        );
    }

    #[test]
    fn extracts_token_regardless_of_entry_order() {
        let values = ["my-secret-token, slop.bearer"];
        assert_eq!(
            extract_bearer_token(&values),
            Some("my-secret-token".to_string())
        );
    }

    #[test]
    fn no_token_without_bearer_label() {
        let values = ["my-secret-token"];
        assert_eq!(extract_bearer_token(&values), None);
    }

    #[test]
    fn no_token_with_label_only() {
        let values = ["slop.bearer"];
        assert_eq!(extract_bearer_token(&values), None);
        assert_eq!(extract_bearer_token(&[]), None);
    }

    // ── Token comparison ────────────────────────────────────────────────

    #[test]
    fn token_matches_exact_value_only() {
        assert!(token_matches("abc123", "abc123"));
        assert!(!token_matches("abc124", "abc123"));
        assert!(!token_matches("abc1234", "abc123"));
        assert!(!token_matches("", "abc123"));
    }

    #[test]
    fn empty_expected_token_never_matches() {
        assert!(!token_matches("", ""));
        assert!(!token_matches("anything", ""));
    }

    // ── Token generation & persistence ──────────────────────────────────

    #[test]
    fn generated_token_is_base64url_no_padding() {
        let token = generate_token().expect("token generation");
        // 32 bytes → 43 base64url chars, no '=' padding.
        assert_eq!(token.len(), 43);
        assert!(token
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_'));
    }

    #[test]
    fn generated_tokens_are_unique() {
        assert_ne!(generate_token().unwrap(), generate_token().unwrap());
    }

    #[test]
    fn token_persists_across_loads_and_regenerates() {
        let dir = std::env::temp_dir().join(format!("slop-bridge-token-test-{}", uuid::Uuid::new_v4()));

        let first = BridgeToken::load_or_create(dir.clone());
        let token_a = first.current();
        assert_eq!(token_a.len(), 43);

        // Second load reads the same persisted token.
        let second = BridgeToken::load_or_create(dir.clone());
        assert_eq!(second.current(), token_a);

        // Regeneration produces and persists a different token.
        let token_b = second.regenerate().expect("regenerate");
        assert_ne!(token_b, token_a);
        assert_eq!(second.current(), token_b);
        let third = BridgeToken::load_or_create(dir.clone());
        assert_eq!(third.current(), token_b);

        let _ = std::fs::remove_dir_all(&dir);
    }
}
