package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"

	slop "github.com/slop-ai/slop-go"
)

func floatPtr(f float64) *float64 { return &f }
func intPtr(i int) *int           { return &i }
func boolPtr(b bool) *bool        { return &b }

func setupProvider(timer *PomodoroTimer) *slop.Server {
	server := slop.NewServer("pomodoro", "Pomodoro Timer")

	// --- dynamic timer node ---
	server.RegisterFunc("timer", func() slop.Node {
		timer.mu.Lock()
		defer timer.mu.Unlock()
		return buildTimerNode(timer)
	})

	// --- dynamic sessions collection ---
	server.RegisterFunc("sessions", func() slop.Node {
		timer.mu.Lock()
		defer timer.mu.Unlock()
		return buildSessionsNode(timer)
	})

	// --- dynamic stats context ---
	server.RegisterFunc("stats", func() slop.Node {
		timer.mu.Lock()
		defer timer.mu.Unlock()
		return buildStatsNode(timer)
	})

	// --- timer actions (registered separately so they're available) ---
	registerTimerActions(server, timer)

	// --- session actions ---
	registerSessionActions(server, timer)

	return server
}

func buildTimerNode(timer *PomodoroTimer) slop.Node {
	var currentTag any = nil
	if timer.CurrentTag != "" {
		currentTag = timer.CurrentTag
	}

	props := slop.Props{
		"phase":                      string(timer.Phase),
		"paused":                     timer.Paused,
		"time_remaining_sec":         timer.TimeRemaining,
		"time_elapsed_sec":           timer.TimeElapsed,
		"current_tag":                currentTag,
		"pomodoros_until_long_break": timer.PomodorosUntilLongBreak(),
	}

	// Build state-dependent actions
	actions := slop.Actions{}

	switch {
	case timer.Phase == PhaseIdle:
		actions["start"] = slop.WithOpts(
			slop.HandlerFunc(func(ctx context.Context, p slop.Params) (any, error) {
				tag := p.String("tag")
				timer.mu.Lock()
				defer timer.mu.Unlock()
				timer.Start(tag)
				_ = timer.Save()
				return map[string]any{"ok": true}, nil
			}),
			slop.ActionOpts{
				Label:       "Start pomodoro",
				Description: "Start a 25-minute work session",
				Estimate:    "instant",
				Params: map[string]any{
					"tag": map[string]any{
						"type":        "string",
						"description": "What you're working on (e.g. 'Code review', 'Write docs')",
					},
				},
			},
		)

	case timer.Phase == PhaseWorking && !timer.Paused:
		actions["pause"] = slop.WithOpts(
			slop.HandlerFunc(func(ctx context.Context, p slop.Params) (any, error) {
				timer.mu.Lock()
				defer timer.mu.Unlock()
				timer.Pause()
				return map[string]any{"ok": true}, nil
			}),
			slop.ActionOpts{Label: "Pause timer", Estimate: "instant"},
		)
		actions["skip"] = slop.WithOpts(
			slop.HandlerFunc(func(ctx context.Context, p slop.Params) (any, error) {
				timer.mu.Lock()
				defer timer.mu.Unlock()
				timer.Skip()
				_ = timer.Save()
				return map[string]any{"ok": true}, nil
			}),
			slop.ActionOpts{
				Label:       "Skip to next phase",
				Description: "Skip the current timer and advance to the next phase (work -> break, break -> idle)",
				Estimate:    "instant",
			},
		)
		actions["stop"] = slop.WithOpts(
			slop.HandlerFunc(func(ctx context.Context, p slop.Params) (any, error) {
				timer.mu.Lock()
				defer timer.mu.Unlock()
				timer.Stop()
				_ = timer.Save()
				return map[string]any{"ok": true}, nil
			}),
			slop.ActionOpts{
				Label:       "Stop timer",
				Description: "Abandon the current session and return to idle",
				Dangerous:   true,
				Estimate:    "instant",
			},
		)
		actions["tag"] = slop.WithOpts(
			slop.HandlerFunc(func(ctx context.Context, p slop.Params) (any, error) {
				label := p.String("label")
				timer.mu.Lock()
				defer timer.mu.Unlock()
				timer.Tag(label)
				return map[string]any{"ok": true}, nil
			}),
			slop.ActionOpts{
				Label:       "Tag session",
				Description: "Set or change the tag on the current session",
				Estimate:    "instant",
				Params:      map[string]any{"label": "string"},
			},
		)

	case timer.Paused:
		actions["resume"] = slop.WithOpts(
			slop.HandlerFunc(func(ctx context.Context, p slop.Params) (any, error) {
				timer.mu.Lock()
				defer timer.mu.Unlock()
				timer.Resume()
				return map[string]any{"ok": true}, nil
			}),
			slop.ActionOpts{Label: "Resume timer", Estimate: "instant"},
		)
		actions["stop"] = slop.WithOpts(
			slop.HandlerFunc(func(ctx context.Context, p slop.Params) (any, error) {
				timer.mu.Lock()
				defer timer.mu.Unlock()
				timer.Stop()
				_ = timer.Save()
				return map[string]any{"ok": true}, nil
			}),
			slop.ActionOpts{
				Label:       "Stop timer",
				Description: "Abandon the current session and return to idle",
				Dangerous:   true,
				Estimate:    "instant",
			},
		)
		if timer.Phase == PhaseWorking {
			actions["tag"] = slop.WithOpts(
				slop.HandlerFunc(func(ctx context.Context, p slop.Params) (any, error) {
					label := p.String("label")
					timer.mu.Lock()
					defer timer.mu.Unlock()
					timer.Tag(label)
					return map[string]any{"ok": true}, nil
				}),
				slop.ActionOpts{
					Label:       "Tag session",
					Description: "Set or change the tag on the current session",
					Estimate:    "instant",
					Params:      map[string]any{"label": "string"},
				},
			)
		}

	case timer.Phase == PhaseShortBreak || timer.Phase == PhaseLongBreak:
		actions["skip"] = slop.WithOpts(
			slop.HandlerFunc(func(ctx context.Context, p slop.Params) (any, error) {
				timer.mu.Lock()
				defer timer.mu.Unlock()
				timer.Skip()
				_ = timer.Save()
				return map[string]any{"ok": true}, nil
			}),
			slop.ActionOpts{
				Label:       "Skip to next phase",
				Description: "Skip the current timer and advance to the next phase",
				Estimate:    "instant",
			},
		)
		actions["stop"] = slop.WithOpts(
			slop.HandlerFunc(func(ctx context.Context, p slop.Params) (any, error) {
				timer.mu.Lock()
				defer timer.mu.Unlock()
				timer.Stop()
				_ = timer.Save()
				return map[string]any{"ok": true}, nil
			}),
			slop.ActionOpts{
				Label:       "Stop timer",
				Description: "Abandon the current session and return to idle",
				Dangerous:   true,
				Estimate:    "instant",
			},
		)
	}

	// Build meta with salience/urgency
	meta := buildTimerMeta(timer)

	return slop.Node{
		Type:    "context",
		Props:   props,
		Actions: actions,
		Meta:    meta,
	}
}

func buildTimerMeta(timer *PomodoroTimer) *slop.Meta {
	remaining := formatTime(timer.TimeRemaining)

	switch {
	case timer.Phase == PhaseIdle:
		return &slop.Meta{
			Salience: floatPtr(0.3),
			Reason:   "Timer is idle",
		}
	case timer.Phase == PhaseWorking && !timer.Paused:
		return &slop.Meta{
			Salience: floatPtr(1.0),
			Urgency:  "low",
			Focus:    boolPtr(true),
			Reason:   fmt.Sprintf("Working: %s remaining", remaining),
		}
	case timer.Phase == PhaseWorking && timer.Paused:
		return &slop.Meta{
			Salience: floatPtr(0.8),
			Urgency:  "low",
			Reason:   fmt.Sprintf("Paused at %s", remaining),
		}
	case timer.Phase == PhaseShortBreak:
		return &slop.Meta{
			Salience: floatPtr(0.9),
			Urgency:  "medium",
			Reason:   fmt.Sprintf("Short break: %s remaining — take a break!", remaining),
		}
	case timer.Phase == PhaseLongBreak:
		return &slop.Meta{
			Salience: floatPtr(0.9),
			Urgency:  "medium",
			Reason:   fmt.Sprintf("Long break: %s remaining — stretch and rest!", remaining),
		}
	}
	return nil
}

func buildSessionsNode(timer *PomodoroTimer) slop.Node {
	count := len(timer.Sessions)
	todayCount := timer.TodayCount()

	// Build items in reverse order (most recent first)
	sessions := make([]Session, len(timer.Sessions))
	copy(sessions, timer.Sessions)
	sort.Slice(sessions, func(i, j int) bool {
		return sessions[i].StartedAt > sessions[j].StartedAt
	})

	items := make([]slop.Item, len(sessions))
	for i, s := range sessions {
		sal := SessionSalience(s)
		reason := SessionReason(s)

		sessionID := s.ID
		items[i] = slop.Item{
			ID: s.ID,
			Props: slop.Props{
				"tag":          s.Tag,
				"category":     s.Category,
				"started_at":   s.StartedAt,
				"ended_at":     s.EndedAt,
				"duration_sec": s.DurationSec,
				"completed":    s.Completed,
			},
			Actions: slop.Actions{
				"tag": slop.WithOpts(
					slop.HandlerFunc(func(ctx context.Context, p slop.Params) (any, error) {
						label := p.String("label")
						timer.mu.Lock()
						defer timer.mu.Unlock()
						timer.TagSession(sessionID, label)
						_ = timer.Save()
						return map[string]any{"ok": true}, nil
					}),
					slop.ActionOpts{
						Label:    "Re-tag session",
						Estimate: "instant",
						Params:   map[string]any{"label": "string"},
					},
				),
				"delete": slop.WithOpts(
					slop.HandlerFunc(func(ctx context.Context, p slop.Params) (any, error) {
						timer.mu.Lock()
						defer timer.mu.Unlock()
						timer.DeleteSession(sessionID)
						_ = timer.Save()
						return map[string]any{"ok": true}, nil
					}),
					slop.ActionOpts{
						Label:     "Delete session",
						Dangerous: true,
						Estimate:  "instant",
					},
				),
			},
			Meta: &slop.Meta{
				Salience: floatPtr(sal),
				Reason:   reason,
			},
		}
	}

	return slop.Node{
		Type: "collection",
		Props: slop.Props{
			"count":       count,
			"today_count": todayCount,
		},
		Items: items,
		Meta: &slop.Meta{
			Summary:       fmt.Sprintf("%d pomodoros completed today", todayCount),
			TotalChildren: intPtr(count),
		},
	}
}

func buildStatsNode(timer *PomodoroTimer) slop.Node {
	todayCompleted := timer.TodayCount()
	todayFocusMin := timer.TodayFocusMin()
	streakDays := timer.StreakDays()
	bestStreak := timer.BestStreakDays()

	return slop.Node{
		Type: "context",
		Props: slop.Props{
			"today_completed":      todayCompleted,
			"today_total_focus_min": todayFocusMin,
			"streak_days":          streakDays,
			"best_streak_days":     bestStreak,
		},
		Meta: &slop.Meta{
			Summary: fmt.Sprintf("%d pomodoros today (%d min focus), %d-day streak", todayCompleted, todayFocusMin, streakDays),
		},
	}
}

func registerTimerActions(server *slop.Server, timer *PomodoroTimer) {
	server.HandleWith("timer", "start", slop.HandlerFunc(func(ctx context.Context, p slop.Params) (any, error) {
		tag := p.String("tag")
		timer.mu.Lock()
		defer timer.mu.Unlock()
		timer.Start(tag)
		_ = timer.Save()
		return map[string]any{"ok": true}, nil
	}), slop.ActionOpts{
		Label:       "Start pomodoro",
		Description: "Start a 25-minute work session",
		Estimate:    "instant",
		Params: map[string]any{
			"tag": map[string]any{
				"type":        "string",
				"description": "What you're working on (e.g. 'Code review', 'Write docs')",
			},
		},
	})

	server.HandleWith("timer", "pause", slop.HandlerFunc(func(ctx context.Context, p slop.Params) (any, error) {
		timer.mu.Lock()
		defer timer.mu.Unlock()
		timer.Pause()
		return map[string]any{"ok": true}, nil
	}), slop.ActionOpts{Label: "Pause timer", Estimate: "instant"})

	server.HandleWith("timer", "resume", slop.HandlerFunc(func(ctx context.Context, p slop.Params) (any, error) {
		timer.mu.Lock()
		defer timer.mu.Unlock()
		timer.Resume()
		return map[string]any{"ok": true}, nil
	}), slop.ActionOpts{Label: "Resume timer", Estimate: "instant"})

	server.HandleWith("timer", "skip", slop.HandlerFunc(func(ctx context.Context, p slop.Params) (any, error) {
		timer.mu.Lock()
		defer timer.mu.Unlock()
		timer.Skip()
		_ = timer.Save()
		return map[string]any{"ok": true}, nil
	}), slop.ActionOpts{
		Label:       "Skip to next phase",
		Description: "Skip the current timer and advance to the next phase",
		Estimate:    "instant",
	})

	server.HandleWith("timer", "stop", slop.HandlerFunc(func(ctx context.Context, p slop.Params) (any, error) {
		timer.mu.Lock()
		defer timer.mu.Unlock()
		timer.Stop()
		_ = timer.Save()
		return map[string]any{"ok": true}, nil
	}), slop.ActionOpts{
		Label:       "Stop timer",
		Description: "Abandon the current session and return to idle",
		Dangerous:   true,
		Estimate:    "instant",
	})

	server.HandleWith("timer", "tag", slop.HandlerFunc(func(ctx context.Context, p slop.Params) (any, error) {
		label := p.String("label")
		timer.mu.Lock()
		defer timer.mu.Unlock()
		timer.Tag(label)
		return map[string]any{"ok": true}, nil
	}), slop.ActionOpts{
		Label:       "Tag session",
		Description: "Set or change the tag on the current session",
		Estimate:    "instant",
		Params:      map[string]any{"label": "string"},
	})
}

func registerSessionActions(server *slop.Server, timer *PomodoroTimer) {
	// These are registered at the collection level but the dynamic node
	// handles per-item actions via inline actions in buildSessionsNode.
}

func formatTime(seconds int) string {
	if seconds < 0 {
		seconds = 0
	}
	m := seconds / 60
	s := seconds % 60
	return fmt.Sprintf("%02d:%02d", m, s)
}

func writeDiscovery(timer *PomodoroTimer, sockPath string) {
	home, err := os.UserHomeDir()
	if err != nil {
		return
	}

	dir := filepath.Join(home, ".slop", "providers")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return
	}

	timer.mu.Lock()
	description := buildDiscoveryDescription(timer)
	timer.mu.Unlock()

	desc := map[string]any{
		"id":           "pomodoro",
		"name":         "Pomodoro Timer",
		"version":      "0.1.0",
		"slop_version": "0.1",
		"transport": map[string]any{
			"type": "unix",
			"path": sockPath,
		},
		"pid":          os.Getpid(),
		"capabilities": []string{"state", "patches", "affordances", "attention"},
		"description":  description,
	}

	data, err := json.MarshalIndent(desc, "", "  ")
	if err != nil {
		return
	}

	_ = os.WriteFile(filepath.Join(dir, "pomodoro.json"), data, 0o644)
}

func updateDiscovery(timer *PomodoroTimer, sockPath string) {
	writeDiscovery(timer, sockPath)
}

func removeDiscovery() {
	home, err := os.UserHomeDir()
	if err != nil {
		return
	}
	_ = os.Remove(filepath.Join(home, ".slop", "providers", "pomodoro.json"))
}

func buildDiscoveryDescription(timer *PomodoroTimer) string {
	switch timer.Phase {
	case PhaseIdle:
		todayCount := timer.TodayCount()
		return fmt.Sprintf("Pomodoro timer: idle, %d sessions today", todayCount)
	case PhaseWorking:
		remaining := formatTime(timer.TimeRemaining)
		tag := timer.CurrentTag
		if tag == "" {
			tag = "untitled"
		}
		if timer.Paused {
			return fmt.Sprintf("Paused at %s on '%s'", remaining, tag)
		}
		return fmt.Sprintf("Working: %s remaining on '%s'", remaining, tag)
	case PhaseShortBreak:
		return fmt.Sprintf("Short break: %s remaining", formatTime(timer.TimeRemaining))
	case PhaseLongBreak:
		return fmt.Sprintf("Long break: %s remaining", formatTime(timer.TimeRemaining))
	}
	return "Pomodoro timer"
}
