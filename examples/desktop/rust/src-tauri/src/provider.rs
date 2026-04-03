use std::fs;
use std::sync::{Arc, Mutex};

use serde_json::{json, Value};

use slop_ai::SlopServer;

use crate::pomodoro::{format_time, session_salience, Phase, PomodoroState};

/// Set up the SLOP provider with all tree nodes and action handlers.
pub fn setup_provider(state: Arc<Mutex<PomodoroState>>) -> SlopServer {
    let slop = SlopServer::new("pomodoro", "Pomodoro Timer");

    // --- Dynamic: timer node ---
    {
        let s = state.clone();
        slop.register_fn("timer", move || {
            let st = s.lock().unwrap();
            build_timer_descriptor(&st)
        });
    }

    // --- Dynamic: sessions collection ---
    {
        let s = state.clone();
        slop.register_fn("sessions", move || {
            let st = s.lock().unwrap();
            build_sessions_descriptor(&st)
        });
    }

    // --- Dynamic: stats context ---
    {
        let s = state.clone();
        slop.register_fn("stats", move || {
            let st = s.lock().unwrap();
            build_stats_descriptor(&st)
        });
    }

    // Timer action handlers are NOT registered via action()/action_with() because
    // those APIs add to action_metadata, and merge_action_metadata would add ALL
    // actions to the tree regardless of phase. Instead, we register each handler
    // at a sub-path (timer/<action>) so they don't pollute the timer node's metadata.
    register_timer_actions(&slop, state.clone());

    // Register session item actions
    register_session_actions(&slop, state.clone());

    slop
}

fn build_timer_descriptor(st: &PomodoroState) -> Value {
    let remaining_in_cycle =
        st.settings.long_break_interval - (st.cycle_count % st.settings.long_break_interval);

    let mut props = json!({
        "phase": st.phase.as_str(),
        "paused": st.paused,
        "time_remaining_sec": st.time_remaining_sec,
        "time_elapsed_sec": st.time_elapsed_sec,
        "current_tag": st.current_tag.as_deref().unwrap_or_default(),
        "pomodoros_until_long_break": remaining_in_cycle,
    });
    // Use null for current_tag when not set
    if st.current_tag.is_none() {
        props["current_tag"] = Value::Null;
    }

    let (salience, urgency, focus, reason) = match st.phase {
        Phase::Idle => (0.3, None, false, "Timer is idle".to_string()),
        Phase::Working if st.paused => (
            0.8,
            Some("low"),
            false,
            format!("Paused at {}", format_time(st.time_remaining_sec)),
        ),
        Phase::Working => (
            1.0,
            Some("low"),
            true,
            format!("Working: {} remaining", format_time(st.time_remaining_sec)),
        ),
        Phase::ShortBreak if st.paused => (
            0.8,
            Some("low"),
            false,
            format!("Paused at {}", format_time(st.time_remaining_sec)),
        ),
        Phase::ShortBreak => (
            0.9,
            Some("medium"),
            false,
            format!(
                "Short break: {} remaining — take a break!",
                format_time(st.time_remaining_sec)
            ),
        ),
        Phase::LongBreak if st.paused => (
            0.8,
            Some("low"),
            false,
            format!("Paused at {}", format_time(st.time_remaining_sec)),
        ),
        Phase::LongBreak => (
            0.9,
            Some("medium"),
            false,
            format!(
                "Long break: {} remaining — stretch and rest!",
                format_time(st.time_remaining_sec)
            ),
        ),
    };

    let mut meta = json!({
        "salience": salience,
        "reason": reason,
    });
    if let Some(u) = urgency {
        meta["urgency"] = json!(u);
    }
    if focus {
        meta["focus"] = json!(true);
    }

    // Build affordances based on current state (metadata only — handlers are in register_timer_actions)
    let actions = build_timer_actions(st);

    json!({
        "type": "context",
        "props": props,
        "meta": meta,
        "actions": actions,
    })
}

fn build_timer_actions(st: &PomodoroState) -> Value {
    let mut actions = json!({});

    match st.phase {
        Phase::Idle => {
            actions["start"] = json!({
                "label": "Start pomodoro",
                "description": "Start a 25-minute work session",
                "estimate": "instant",
                "params": {
                    "type": "object",
                    "properties": {
                        "tag": {
                            "type": "string",
                            "description": "What you're working on"
                        }
                    }
                }
            });
        }
        Phase::Working if !st.paused => {
            actions["pause"] = json!({ "label": "Pause timer", "estimate": "instant" });
            actions["skip"] = json!({ "label": "Skip to next phase", "estimate": "instant" });
            actions["stop"] = json!({ "label": "Stop timer", "dangerous": true, "estimate": "instant" });
            actions["tag"] = json!({
                "label": "Tag session", "estimate": "instant",
                "params": { "type": "object", "properties": { "label": { "type": "string" } }, "required": ["label"] }
            });
        }
        Phase::Working => {
            actions["resume"] = json!({ "label": "Resume timer", "estimate": "instant" });
            actions["stop"] = json!({ "label": "Stop timer", "dangerous": true, "estimate": "instant" });
            actions["tag"] = json!({
                "label": "Tag session", "estimate": "instant",
                "params": { "type": "object", "properties": { "label": { "type": "string" } }, "required": ["label"] }
            });
        }
        Phase::ShortBreak | Phase::LongBreak if st.paused => {
            actions["resume"] = json!({ "label": "Resume timer", "estimate": "instant" });
            actions["stop"] = json!({ "label": "Stop timer", "dangerous": true, "estimate": "instant" });
        }
        Phase::ShortBreak | Phase::LongBreak => {
            actions["skip"] = json!({ "label": "Skip to next phase", "estimate": "instant" });
            actions["stop"] = json!({ "label": "Stop timer", "dangerous": true, "estimate": "instant" });
        }
    }

    actions
}

fn build_sessions_descriptor(st: &PomodoroState) -> Value {
    let today = chrono::Utc::now().date_naive();
    let today_count = st
        .sessions
        .iter()
        .filter(|s| {
            s.completed
                && chrono::DateTime::parse_from_rfc3339(&s.started_at)
                    .map(|dt| dt.date_naive() == today)
                    .unwrap_or(false)
        })
        .count();

    let total = st.sessions.len();

    // Build session items (most recent first)
    let mut sorted_sessions: Vec<&crate::pomodoro::Session> = st.sessions.iter().collect();
    sorted_sessions.sort_by(|a, b| b.started_at.cmp(&a.started_at));

    let items: Vec<Value> = sorted_sessions
        .iter()
        .map(|s| {
            let (salience, reason) = session_salience(s);
            let mut meta = json!({ "salience": salience });
            if let Some(r) = &reason {
                meta["reason"] = json!(r);
            }

            json!({
                "id": &s.id,
                "props": {
                    "tag": &s.tag,
                    "category": &s.category,
                    "started_at": &s.started_at,
                    "ended_at": &s.ended_at,
                    "duration_sec": s.duration_sec,
                    "completed": s.completed,
                },
                "meta": meta,
                "actions": {
                    "tag": {
                        "label": "Re-tag session",
                        "estimate": "instant",
                        "params": {
                            "type": "object",
                            "properties": { "label": { "type": "string" } },
                            "required": ["label"]
                        }
                    },
                    "delete": {
                        "label": "Delete session",
                        "dangerous": true,
                        "estimate": "instant"
                    }
                },
            })
        })
        .collect();

    json!({
        "type": "collection",
        "props": {
            "count": total,
            "today_count": today_count,
        },
        "meta": {
            "summary": format!("{} pomodoros completed today", today_count),
            "total_children": total,
        },
        "window": {
            "items": items,
            "total": total,
            "offset": 0,
        },
    })
}

fn build_stats_descriptor(st: &PomodoroState) -> Value {
    let (today_completed, today_total_sec) = st.today_stats();
    let today_total_focus_min = today_total_sec / 60;

    // Simple streak calculation: count consecutive days with completed sessions
    let today = chrono::Utc::now().date_naive();
    let mut days_with_sessions: Vec<chrono::NaiveDate> = st
        .sessions
        .iter()
        .filter(|s| s.completed)
        .filter_map(|s| {
            chrono::DateTime::parse_from_rfc3339(&s.started_at)
                .ok()
                .map(|dt| dt.date_naive())
        })
        .collect();
    days_with_sessions.sort();
    days_with_sessions.dedup();

    let mut streak = 0u32;
    let mut check_date = today;
    for _ in 0..365 {
        if days_with_sessions.contains(&check_date) {
            streak += 1;
            check_date -= chrono::Duration::days(1);
        } else {
            break;
        }
    }

    // Best streak (simple scan)
    let mut best_streak = 0u32;
    let mut current_streak = 0u32;
    let mut prev_date: Option<chrono::NaiveDate> = None;
    for d in &days_with_sessions {
        if let Some(prev) = prev_date {
            if (*d - prev).num_days() == 1 {
                current_streak += 1;
            } else {
                current_streak = 1;
            }
        } else {
            current_streak = 1;
        }
        if current_streak > best_streak {
            best_streak = current_streak;
        }
        prev_date = Some(*d);
    }

    json!({
        "type": "context",
        "props": {
            "today_completed": today_completed,
            "today_total_focus_min": today_total_focus_min,
            "streak_days": streak,
            "best_streak_days": best_streak,
        },
        "meta": {
            "summary": format!(
                "{} pomodoros today ({} min focus), {}-day streak",
                today_completed, today_total_focus_min, streak
            ),
        },
    })
}

fn register_timer_actions(slop: &SlopServer, state: Arc<Mutex<PomodoroState>>) {
    // start
    {
        let s = state.clone();
        slop.action("timer", "start", move |params: &Value| {
            let tag = params["tag"].as_str().map(|s| s.to_string());
            let mut st = s.lock().unwrap();
            st.start(tag);
            Ok(Some(json!({ "phase": st.phase.as_str() })))
        });
    }
    // pause
    {
        let s = state.clone();
        slop.action("timer", "pause", move |_params: &Value| {
            let mut st = s.lock().unwrap();
            st.pause();
            Ok(Some(json!({ "paused": true })))
        });
    }
    // resume
    {
        let s = state.clone();
        slop.action("timer", "resume", move |_params: &Value| {
            let mut st = s.lock().unwrap();
            st.resume();
            Ok(Some(json!({ "paused": false })))
        });
    }
    // skip
    {
        let s = state.clone();
        slop.action("timer", "skip", move |_params: &Value| {
            let mut st = s.lock().unwrap();
            st.skip();
            Ok(Some(json!({ "phase": st.phase.as_str() })))
        });
    }
    // stop
    {
        let s = state.clone();
        slop.action("timer", "stop", move |_params: &Value| {
            let mut st = s.lock().unwrap();
            st.stop();
            Ok(Some(json!({ "phase": "idle" })))
        });
    }
    // tag
    {
        let s = state.clone();
        slop.action("timer", "tag", move |params: &Value| {
            let label = params["label"]
                .as_str()
                .ok_or_else(|| slop_ai::SlopError::ActionFailed {
                    code: "invalid_params".into(),
                    message: "label is required".into(),
                })?;
            let mut st = s.lock().unwrap();
            st.tag(label.to_string());
            Ok(Some(json!({ "tag": label })))
        });
    }
}

fn register_session_actions(slop: &SlopServer, state: Arc<Mutex<PomodoroState>>) {
    // Pre-register for existing sessions and a generous range of future ones
    let max_id = {
        let st = state.lock().unwrap();
        st.sessions
            .iter()
            .filter_map(|s| s.id.strip_prefix("s-").and_then(|n| n.parse::<u32>().ok()))
            .max()
            .unwrap_or(0)
    };

    for i in 1..=(max_id + 100) {
        let sid = format!("s-{i}");
        let session_path = format!("sessions/{}", sid);

        // tag
        {
            let s = state.clone();
            let id = sid.clone();
            slop.action(&session_path, "tag", move |params: &Value| {
                let label = params["label"]
                    .as_str()
                    .ok_or_else(|| slop_ai::SlopError::ActionFailed {
                        code: "invalid_params".into(),
                        message: "label is required".into(),
                    })?;
                let mut st = s.lock().unwrap();
                st.tag_session(&id, label.to_string());
                Ok(Some(json!({ "id": &id, "tag": label })))
            });
        }

        // delete
        {
            let s = state.clone();
            let id = sid.clone();
            slop.action(&session_path, "delete", move |_params: &Value| {
                let mut st = s.lock().unwrap();
                st.delete_session(&id);
                Ok(Some(json!({ "id": &id })))
            });
        }
    }
}

/// Write the discovery file.
pub fn write_discovery(state: &Arc<Mutex<PomodoroState>>, socket_path: &str) {
    let home = match dirs::home_dir() {
        Some(h) => h,
        None => return,
    };
    let dir = home.join(".slop").join("providers");
    let _ = fs::create_dir_all(&dir);
    let path = dir.join("pomodoro.json");

    let st = state.lock().unwrap();
    let (today_count, _) = st.today_stats();
    let description = match st.phase {
        Phase::Idle => format!("Pomodoro timer: idle, {} sessions today", today_count),
        Phase::Working if st.paused => format!(
            "Paused at {} on '{}'",
            format_time(st.time_remaining_sec),
            st.current_tag.as_deref().unwrap_or("untitled")
        ),
        Phase::Working => format!(
            "Working: {} remaining on '{}'",
            format_time(st.time_remaining_sec),
            st.current_tag.as_deref().unwrap_or("untitled")
        ),
        Phase::ShortBreak => format!(
            "Short break: {} remaining",
            format_time(st.time_remaining_sec)
        ),
        Phase::LongBreak => format!(
            "Long break: {} remaining",
            format_time(st.time_remaining_sec)
        ),
    };

    let desc = json!({
        "id": "pomodoro",
        "name": "Pomodoro Timer",
        "version": "0.1.0",
        "slop_version": "0.1",
        "transport": { "type": "unix", "path": socket_path },
        "pid": std::process::id(),
        "capabilities": ["state", "patches", "affordances", "attention"],
        "description": description
    });

    let _ = fs::write(&path, serde_json::to_string_pretty(&desc).unwrap());
}

/// Remove the discovery file.
pub fn remove_discovery() {
    let home = match dirs::home_dir() {
        Some(h) => h,
        None => return,
    };
    let path = home.join(".slop").join("providers").join("pomodoro.json");
    let _ = fs::remove_file(path);
}
