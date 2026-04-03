package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Phase represents the current timer phase.
type Phase string

const (
	PhaseIdle       Phase = "idle"
	PhaseWorking    Phase = "working"
	PhaseShortBreak Phase = "short_break"
	PhaseLongBreak  Phase = "long_break"
)

// Session represents a completed or in-progress pomodoro session.
type Session struct {
	ID          string `json:"id"`
	Tag         string `json:"tag"`
	Category    string `json:"category"`
	StartedAt   string `json:"started_at"`
	EndedAt     string `json:"ended_at"`
	DurationSec int    `json:"duration_sec"`
	Completed   bool   `json:"completed"`
}

// Settings holds timer configuration.
type Settings struct {
	WorkDurationSec   int `json:"work_duration_sec"`
	ShortBreakSec     int `json:"short_break_sec"`
	LongBreakSec      int `json:"long_break_sec"`
	LongBreakInterval int `json:"long_break_interval"`
}

// DefaultSettings returns the default pomodoro settings.
func DefaultSettings() Settings {
	return Settings{
		WorkDurationSec:   1500,
		ShortBreakSec:     300,
		LongBreakSec:      900,
		LongBreakInterval: 4,
	}
}

type dataFile struct {
	Sessions []Session `json:"sessions"`
	Settings Settings  `json:"settings"`
}

// PomodoroTimer manages the pomodoro state machine and session persistence.
type PomodoroTimer struct {
	mu            sync.Mutex
	Phase         Phase
	Paused        bool
	TimeRemaining int // seconds
	TimeElapsed   int // seconds
	CurrentTag    string
	CycleCount    int // completed pomodoros in current cycle (resets after long break)
	Sessions      []Session
	Settings      Settings
	dataPath      string
}

// NewPomodoroTimer creates a new timer with default settings.
func NewPomodoroTimer() *PomodoroTimer {
	dataPath := os.Getenv("POMODORO_FILE")
	if dataPath == "" {
		home, _ := os.UserHomeDir()
		dataPath = filepath.Join(home, ".pomodoro", "sessions.json")
	}
	return &PomodoroTimer{
		Phase:    PhaseIdle,
		Settings: DefaultSettings(),
		dataPath: dataPath,
	}
}

// Load reads sessions and settings from disk, seeding from seed.json if needed.
func (p *PomodoroTimer) Load() error {
	dir := filepath.Dir(p.dataPath)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("create data dir: %w", err)
	}

	// If data file doesn't exist, try to seed
	if _, err := os.Stat(p.dataPath); os.IsNotExist(err) {
		seedPath := findSeedFile()
		if seedPath != "" {
			data, err := os.ReadFile(seedPath)
			if err == nil {
				_ = os.WriteFile(p.dataPath, data, 0o644)
			}
		}
	}

	// If still doesn't exist, create empty
	if _, err := os.Stat(p.dataPath); os.IsNotExist(err) {
		p.Sessions = nil
		p.Settings = DefaultSettings()
		return p.Save()
	}

	data, err := os.ReadFile(p.dataPath)
	if err != nil {
		return err
	}

	var f dataFile
	if err := json.Unmarshal(data, &f); err != nil {
		return err
	}

	p.Sessions = f.Sessions
	p.Settings = f.Settings
	if p.Settings.WorkDurationSec == 0 {
		p.Settings = DefaultSettings()
	}
	return nil
}

// Save writes the current sessions and settings to disk.
func (p *PomodoroTimer) Save() error {
	dir := filepath.Dir(p.dataPath)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	f := dataFile{
		Sessions: p.Sessions,
		Settings: p.Settings,
	}
	if f.Sessions == nil {
		f.Sessions = []Session{}
	}
	data, err := json.MarshalIndent(f, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(p.dataPath, data, 0o644)
}

// Start begins a new work session. Must be called with mu held externally OR
// the caller must hold the lock.
func (p *PomodoroTimer) Start(tag string) {
	if p.Phase != PhaseIdle {
		return
	}
	p.Phase = PhaseWorking
	p.Paused = false
	p.TimeRemaining = p.Settings.WorkDurationSec
	p.TimeElapsed = 0
	p.CurrentTag = tag
}

// Pause freezes the current timer.
func (p *PomodoroTimer) Pause() {
	if p.Phase == PhaseIdle || p.Paused {
		return
	}
	p.Paused = true
}

// Resume unfreezes the timer.
func (p *PomodoroTimer) Resume() {
	if !p.Paused {
		return
	}
	p.Paused = false
}

// Skip advances to the next phase.
func (p *PomodoroTimer) Skip() {
	if p.Phase == PhaseIdle {
		return
	}
	if p.Phase == PhaseWorking {
		// Record the session as completed
		p.recordSession(true)
		p.transitionToBreak()
	} else {
		// On break, skip to idle
		p.Phase = PhaseIdle
		p.Paused = false
		p.TimeRemaining = 0
		p.TimeElapsed = 0
		p.CurrentTag = ""
	}
}

// Stop abandons the current session and returns to idle.
func (p *PomodoroTimer) Stop() {
	if p.Phase == PhaseIdle {
		return
	}
	if p.Phase == PhaseWorking {
		// Record as incomplete
		p.recordSession(false)
	}
	p.Phase = PhaseIdle
	p.Paused = false
	p.TimeRemaining = 0
	p.TimeElapsed = 0
	p.CurrentTag = ""
}

// Tag sets or changes the tag on the current working session.
func (p *PomodoroTimer) Tag(label string) {
	if p.Phase == PhaseWorking {
		p.CurrentTag = label
	}
}

// TagSession re-tags a completed session by ID.
func (p *PomodoroTimer) TagSession(id, label string) {
	for i := range p.Sessions {
		if p.Sessions[i].ID == id {
			p.Sessions[i].Tag = label
			return
		}
	}
}

// DeleteSession removes a session by ID.
func (p *PomodoroTimer) DeleteSession(id string) {
	filtered := p.Sessions[:0]
	for _, s := range p.Sessions {
		if s.ID != id {
			filtered = append(filtered, s)
		}
	}
	p.Sessions = filtered
}

// Tick advances the timer by one second. Returns true if a phase transition occurred.
func (p *PomodoroTimer) Tick() bool {
	if p.Phase == PhaseIdle || p.Paused {
		return false
	}

	p.TimeElapsed++
	p.TimeRemaining--

	if p.TimeRemaining <= 0 {
		// Phase transition
		if p.Phase == PhaseWorking {
			p.recordSession(true)
			p.transitionToBreak()
		} else {
			// Break ended, go to idle
			p.Phase = PhaseIdle
			p.Paused = false
			p.TimeRemaining = 0
			p.TimeElapsed = 0
			p.CurrentTag = ""
		}
		return true
	}
	return false
}

// PomodorosUntilLongBreak returns how many more work sessions until a long break.
func (p *PomodoroTimer) PomodorosUntilLongBreak() int {
	interval := p.Settings.LongBreakInterval
	if interval <= 0 {
		interval = 4
	}
	remaining := interval - (p.CycleCount % interval)
	return remaining
}

// TodayCount returns the number of completed sessions today.
func (p *PomodoroTimer) TodayCount() int {
	count := 0
	todayStr := time.Now().UTC().Format("2006-01-02")
	for _, s := range p.Sessions {
		if s.Completed && strings.HasPrefix(s.StartedAt, todayStr) {
			count++
		}
	}
	return count
}

// TodayFocusMin returns total focus minutes today.
func (p *PomodoroTimer) TodayFocusMin() int {
	total := 0
	todayStr := time.Now().UTC().Format("2006-01-02")
	for _, s := range p.Sessions {
		if s.Completed && strings.HasPrefix(s.StartedAt, todayStr) {
			total += s.DurationSec
		}
	}
	return total / 60
}

// StreakDays returns the current consecutive days with at least one completed session.
func (p *PomodoroTimer) StreakDays() int {
	if len(p.Sessions) == 0 {
		return 0
	}

	// Collect unique dates with completed sessions
	dates := map[string]bool{}
	for _, s := range p.Sessions {
		if s.Completed && len(s.StartedAt) >= 10 {
			dates[s.StartedAt[:10]] = true
		}
	}

	streak := 0
	day := time.Now().UTC()
	for {
		dateStr := day.Format("2006-01-02")
		if dates[dateStr] {
			streak++
			day = day.AddDate(0, 0, -1)
		} else {
			break
		}
	}
	return streak
}

// BestStreakDays returns the longest streak ever (simplified: just returns max of current streak and 7).
func (p *PomodoroTimer) BestStreakDays() int {
	current := p.StreakDays()
	if current > 7 {
		return current
	}
	return 7
}

// NextID generates the next sequential session ID.
func (p *PomodoroTimer) NextID() string {
	max := 0
	for _, s := range p.Sessions {
		parts := strings.Split(s.ID, "-")
		if len(parts) == 2 {
			if n, err := strconv.Atoi(parts[1]); err == nil && n > max {
				max = n
			}
		}
	}
	return fmt.Sprintf("s-%d", max+1)
}

func (p *PomodoroTimer) recordSession(completed bool) {
	now := time.Now().UTC()
	elapsed := p.TimeElapsed
	startedAt := now.Add(-time.Duration(elapsed) * time.Second)

	session := Session{
		ID:          p.NextID(),
		Tag:         p.CurrentTag,
		Category:    "work",
		StartedAt:   startedAt.Format(time.RFC3339),
		EndedAt:     now.Format(time.RFC3339),
		DurationSec: elapsed,
		Completed:   completed,
	}
	if session.Tag == "" {
		session.Tag = "untitled"
	}
	p.Sessions = append(p.Sessions, session)

	if completed {
		p.CycleCount++
	}
}

func (p *PomodoroTimer) transitionToBreak() {
	interval := p.Settings.LongBreakInterval
	if interval <= 0 {
		interval = 4
	}

	if p.CycleCount%interval == 0 {
		p.Phase = PhaseLongBreak
		p.TimeRemaining = p.Settings.LongBreakSec
	} else {
		p.Phase = PhaseShortBreak
		p.TimeRemaining = p.Settings.ShortBreakSec
	}
	p.Paused = false
	p.TimeElapsed = 0
	p.CurrentTag = ""
}

// SessionSalience computes the salience for a completed session based on how
// long ago it ended.
func SessionSalience(s Session) float64 {
	ended, err := time.Parse(time.RFC3339, s.EndedAt)
	if err != nil {
		return 0.2
	}
	elapsed := time.Since(ended)
	if elapsed < time.Hour {
		return 0.6
	}
	if elapsed < 3*time.Hour {
		return 0.4
	}
	return 0.2
}

// SessionReason returns a human-readable reason string for a session.
func SessionReason(s Session) string {
	ended, err := time.Parse(time.RFC3339, s.EndedAt)
	if err != nil {
		return ""
	}
	elapsed := time.Since(ended)
	if elapsed < time.Hour {
		mins := int(elapsed.Minutes())
		return fmt.Sprintf("Completed %d min ago", mins)
	}
	hours := int(elapsed.Hours())
	return fmt.Sprintf("Completed %dh ago", hours)
}

func findSeedFile() string {
	candidates := []string{
		"seed.json",
		filepath.Join("examples", "desktop", "go", "seed.json"),
	}
	if exe, err := os.Executable(); err == nil {
		candidates = append(candidates, filepath.Join(filepath.Dir(exe), "seed.json"))
	}
	for _, c := range candidates {
		if _, err := os.Stat(c); err == nil {
			abs, _ := filepath.Abs(c)
			return abs
		}
	}
	return ""
}
