use std::fs;
use std::path::PathBuf;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Timer phase.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    Idle,
    Working,
    ShortBreak,
    LongBreak,
}

impl Phase {
    pub fn as_str(&self) -> &'static str {
        match self {
            Phase::Idle => "idle",
            Phase::Working => "working",
            Phase::ShortBreak => "short_break",
            Phase::LongBreak => "long_break",
        }
    }
}

/// A completed (or abandoned) pomodoro session.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    pub id: String,
    pub tag: String,
    pub category: String,
    pub started_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ended_at: Option<String>,
    pub duration_sec: u64,
    pub completed: bool,
}

/// Persisted data file structure.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionFile {
    pub sessions: Vec<Session>,
    pub settings: Settings,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub work_duration_sec: u64,
    pub short_break_sec: u64,
    pub long_break_sec: u64,
    pub long_break_interval: u32,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            work_duration_sec: 1500,
            short_break_sec: 300,
            long_break_sec: 900,
            long_break_interval: 4,
        }
    }
}

/// Snapshot of the timer state sent to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PomodoroSnapshot {
    pub phase: String,
    pub paused: bool,
    pub time_remaining_sec: u64,
    pub time_elapsed_sec: u64,
    pub current_tag: Option<String>,
    pub pomodoros_until_long_break: u32,
    pub sessions: Vec<Session>,
    pub settings: Settings,
    pub cycle_count: u32,
}

/// Full Pomodoro timer state.
pub struct PomodoroState {
    pub phase: Phase,
    pub paused: bool,
    pub time_remaining_sec: u64,
    pub time_elapsed_sec: u64,
    pub current_tag: Option<String>,
    pub cycle_count: u32, // pomodoros completed in current cycle (resets after long break)
    pub sessions: Vec<Session>,
    pub settings: Settings,
    pub data_path: PathBuf,
    /// Set when a working session starts, used to record started_at.
    pub session_started_at: Option<DateTime<Utc>>,
}

impl PomodoroState {
    pub fn new(data_path: PathBuf) -> Self {
        let (sessions, settings) = load_sessions(&data_path);
        Self {
            phase: Phase::Idle,
            paused: false,
            time_remaining_sec: 0,
            time_elapsed_sec: 0,
            current_tag: None,
            cycle_count: 0,
            sessions,
            settings,
            data_path,
            session_started_at: None,
        }
    }

    pub fn snapshot(&self) -> PomodoroSnapshot {
        let remaining_in_cycle = self.settings.long_break_interval - (self.cycle_count % self.settings.long_break_interval);
        PomodoroSnapshot {
            phase: self.phase.as_str().to_string(),
            paused: self.paused,
            time_remaining_sec: self.time_remaining_sec,
            time_elapsed_sec: self.time_elapsed_sec,
            current_tag: self.current_tag.clone(),
            pomodoros_until_long_break: remaining_in_cycle,
            sessions: self.sessions.clone(),
            settings: self.settings.clone(),
            cycle_count: self.cycle_count,
        }
    }

    /// Start a new pomodoro work session.
    pub fn start(&mut self, tag: Option<String>) {
        if self.phase != Phase::Idle {
            return;
        }
        self.phase = Phase::Working;
        self.paused = false;
        self.time_remaining_sec = self.settings.work_duration_sec;
        self.time_elapsed_sec = 0;
        self.current_tag = tag;
        self.session_started_at = Some(Utc::now());
    }

    /// Pause the timer.
    pub fn pause(&mut self) {
        if self.phase == Phase::Idle || self.paused {
            return;
        }
        self.paused = true;
    }

    /// Resume the timer.
    pub fn resume(&mut self) {
        if !self.paused {
            return;
        }
        self.paused = false;
    }

    /// Skip to next phase.
    pub fn skip(&mut self) {
        match self.phase {
            Phase::Idle => {}
            Phase::Working => {
                // Record the session as completed even on skip
                self.record_session(true);
                self.transition_after_work();
            }
            Phase::ShortBreak | Phase::LongBreak => {
                self.phase = Phase::Idle;
                self.paused = false;
                self.time_remaining_sec = 0;
                self.time_elapsed_sec = 0;
                self.current_tag = None;
            }
        }
    }

    /// Stop and return to idle (abandon current session).
    pub fn stop(&mut self) {
        if self.phase == Phase::Idle {
            return;
        }
        if self.phase == Phase::Working {
            self.record_session(false);
        }
        self.phase = Phase::Idle;
        self.paused = false;
        self.time_remaining_sec = 0;
        self.time_elapsed_sec = 0;
        self.current_tag = None;
        self.session_started_at = None;
    }

    /// Set/change the current tag.
    pub fn tag(&mut self, label: String) {
        self.current_tag = Some(label);
    }

    /// Tag a completed session by id.
    pub fn tag_session(&mut self, session_id: &str, label: String) {
        if let Some(s) = self.sessions.iter_mut().find(|s| s.id == session_id) {
            s.tag = label;
            self.save_sessions();
        }
    }

    /// Delete a session by id.
    pub fn delete_session(&mut self, session_id: &str) {
        self.sessions.retain(|s| s.id != session_id);
        self.save_sessions();
    }

    /// Tick the timer by 1 second. Returns true if a phase transition happened.
    pub fn tick(&mut self) -> bool {
        if self.phase == Phase::Idle || self.paused {
            return false;
        }

        if self.time_remaining_sec == 0 {
            return false;
        }

        self.time_remaining_sec -= 1;
        self.time_elapsed_sec += 1;

        if self.time_remaining_sec == 0 {
            match self.phase {
                Phase::Working => {
                    self.record_session(true);
                    self.transition_after_work();
                    return true;
                }
                Phase::ShortBreak | Phase::LongBreak => {
                    self.phase = Phase::Idle;
                    self.paused = false;
                    self.time_remaining_sec = 0;
                    self.time_elapsed_sec = 0;
                    self.current_tag = None;
                    return true;
                }
                Phase::Idle => {}
            }
        }

        false
    }

    fn transition_after_work(&mut self) {
        self.cycle_count += 1;
        if self.cycle_count % self.settings.long_break_interval == 0 {
            self.phase = Phase::LongBreak;
            self.time_remaining_sec = self.settings.long_break_sec;
        } else {
            self.phase = Phase::ShortBreak;
            self.time_remaining_sec = self.settings.short_break_sec;
        }
        self.time_elapsed_sec = 0;
        self.paused = false;
        self.current_tag = None;
        self.session_started_at = None;
    }

    fn record_session(&mut self, completed: bool) {
        let now = Utc::now();
        let started_at = self.session_started_at.unwrap_or(now);
        let elapsed = self.time_elapsed_sec;

        let next_id = self.next_session_id();
        let session = Session {
            id: next_id,
            tag: self.current_tag.clone().unwrap_or_else(|| "untitled".to_string()),
            category: "work".to_string(),
            started_at: started_at.to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
            ended_at: Some(now.to_rfc3339_opts(chrono::SecondsFormat::Secs, true)),
            duration_sec: elapsed,
            completed,
        };
        self.sessions.push(session);
        self.save_sessions();
    }

    fn next_session_id(&self) -> String {
        let max = self
            .sessions
            .iter()
            .filter_map(|s| s.id.strip_prefix("s-").and_then(|n| n.parse::<u32>().ok()))
            .max()
            .unwrap_or(0);
        format!("s-{}", max + 1)
    }

    fn save_sessions(&self) {
        if let Some(parent) = self.data_path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let file = SessionFile {
            sessions: self.sessions.clone(),
            settings: self.settings.clone(),
        };
        let json = serde_json::to_string_pretty(&file).expect("serialize sessions");
        let _ = fs::write(&self.data_path, json);
    }

    /// Compute today's stats.
    pub fn today_stats(&self) -> (u32, u64) {
        let today = Utc::now().date_naive();
        let mut count = 0u32;
        let mut total_sec = 0u64;
        for s in &self.sessions {
            if s.completed {
                if let Ok(dt) = DateTime::parse_from_rfc3339(&s.started_at) {
                    if dt.date_naive() == today {
                        count += 1;
                        total_sec += s.duration_sec;
                    }
                }
            }
        }
        (count, total_sec)
    }
}

fn load_sessions(path: &PathBuf) -> (Vec<Session>, Settings) {
    if !path.exists() {
        return (Vec::new(), Settings::default());
    }
    match fs::read_to_string(path) {
        Ok(data) => match serde_json::from_str::<SessionFile>(&data) {
            Ok(file) => (file.sessions, file.settings),
            Err(_) => (Vec::new(), Settings::default()),
        },
        Err(_) => (Vec::new(), Settings::default()),
    }
}

/// Seed from seed.json if data file doesn't exist.
pub fn seed_if_needed(data_path: &PathBuf, seed_path: &PathBuf) {
    if data_path.exists() {
        return;
    }
    if seed_path.exists() {
        if let Some(parent) = data_path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let _ = fs::copy(seed_path, data_path);
    }
}

/// Compute salience for a session based on how long ago it was completed.
pub fn session_salience(session: &Session) -> (f64, Option<String>) {
    let now = Utc::now();
    if let Some(ended) = &session.ended_at {
        if let Ok(dt) = DateTime::parse_from_rfc3339(ended) {
            let mins = (now - dt.with_timezone(&Utc)).num_minutes();
            if mins < 60 {
                return (0.6, Some(format!("Completed {} min ago", mins)));
            } else if mins < 180 {
                let hours = mins / 60;
                return (0.4, Some(format!("Completed {}h ago", hours)));
            } else {
                let hours = mins / 60;
                return (0.2, Some(format!("Completed {}h ago", hours)));
            }
        }
    }
    (0.2, None)
}

/// Format seconds as MM:SS.
pub fn format_time(secs: u64) -> String {
    let m = secs / 60;
    let s = secs % 60;
    format!("{:02}:{:02}", m, s)
}
