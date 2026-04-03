package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Task represents a single task in the store.
type Task struct {
	ID          string   `json:"id"`
	Title       string   `json:"title"`
	Done        bool     `json:"done"`
	Due         string   `json:"due,omitempty"`
	Tags        []string `json:"tags"`
	Notes       string   `json:"notes"`
	Created     string   `json:"created"`
	CompletedAt string   `json:"completed_at,omitempty"`
}

type taskFile struct {
	Tasks []Task `json:"tasks"`
}

// Store manages task persistence and provides query methods.
type Store struct {
	mu   sync.Mutex
	path string
}

// NewStore creates a store backed by the given file path.
// If the file does not exist, it initialises from seedPath (if non-empty).
func NewStore(path, seedPath string) (*Store, error) {
	s := &Store{path: path}

	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("create data dir: %w", err)
	}

	if _, err := os.Stat(path); os.IsNotExist(err) && seedPath != "" {
		data, err := os.ReadFile(seedPath)
		if err != nil {
			return nil, fmt.Errorf("read seed: %w", err)
		}
		if err := os.WriteFile(path, data, 0o644); err != nil {
			return nil, fmt.Errorf("write seed data: %w", err)
		}
	}

	// Ensure the file exists.
	if _, err := os.Stat(path); os.IsNotExist(err) {
		if err := os.WriteFile(path, []byte(`{"tasks":[]}`), 0o644); err != nil {
			return nil, fmt.Errorf("init data file: %w", err)
		}
	}

	return s, nil
}

func (s *Store) load() ([]Task, error) {
	data, err := os.ReadFile(s.path)
	if err != nil {
		return nil, err
	}
	var f taskFile
	if err := json.Unmarshal(data, &f); err != nil {
		return nil, err
	}
	return f.Tasks, nil
}

func (s *Store) save(tasks []Task) error {
	data, err := json.MarshalIndent(taskFile{Tasks: tasks}, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.path, data, 0o644)
}

// All returns all tasks.
func (s *Store) All() ([]Task, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.load()
}

// Add creates a new task and returns it.
func (s *Store) Add(title, due, tags string) (Task, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	tasks, err := s.load()
	if err != nil {
		return Task{}, err
	}

	id := s.nextID(tasks)
	t := Task{
		ID:      id,
		Title:   title,
		Done:    false,
		Due:     normalizeDue(due),
		Tags:    parseTags(tags),
		Notes:   "",
		Created: time.Now().UTC().Format(time.RFC3339),
	}
	tasks = append(tasks, t)
	return t, s.save(tasks)
}

// Done marks a task as completed.
func (s *Store) Done(id string) (*Task, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.updateTask(id, func(t *Task) {
		t.Done = true
		t.CompletedAt = time.Now().UTC().Format(time.RFC3339)
	})
}

// Undo marks a completed task as incomplete.
func (s *Store) Undo(id string) (*Task, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.updateTask(id, func(t *Task) {
		t.Done = false
		t.CompletedAt = ""
	})
}

// Edit modifies a task's title, due date, or tags.
func (s *Store) Edit(id, title, due, tags string) (*Task, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.updateTask(id, func(t *Task) {
		if title != "" {
			t.Title = title
		}
		if due != "" {
			t.Due = normalizeDue(due)
		}
		if tags != "" {
			t.Tags = parseTags(tags)
		}
	})
}

// Delete removes a task.
func (s *Store) Delete(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	tasks, err := s.load()
	if err != nil {
		return err
	}
	filtered := tasks[:0]
	for _, t := range tasks {
		if t.ID != id {
			filtered = append(filtered, t)
		}
	}
	if len(filtered) == len(tasks) {
		return fmt.Errorf("task %s not found", id)
	}
	return s.save(filtered)
}

// SetNotes sets the notes for a task.
func (s *Store) SetNotes(id, content string) (*Task, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.updateTask(id, func(t *Task) {
		t.Notes = content
	})
}

// ClearDone removes all completed tasks.
func (s *Store) ClearDone() (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	tasks, err := s.load()
	if err != nil {
		return 0, err
	}
	filtered := tasks[:0]
	count := 0
	for _, t := range tasks {
		if t.Done {
			count++
		} else {
			filtered = append(filtered, t)
		}
	}
	return count, s.save(filtered)
}

// Search returns tasks matching the query in title or tags.
func (s *Store) Search(query string) ([]Task, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	tasks, err := s.load()
	if err != nil {
		return nil, err
	}
	q := strings.ToLower(query)
	var results []Task
	for _, t := range tasks {
		if strings.Contains(strings.ToLower(t.Title), q) {
			results = append(results, t)
			continue
		}
		for _, tag := range t.Tags {
			if strings.Contains(strings.ToLower(tag), q) {
				results = append(results, t)
				break
			}
		}
	}
	return results, nil
}

// Find returns a single task by ID.
func (s *Store) Find(id string) (*Task, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	tasks, err := s.load()
	if err != nil {
		return nil, err
	}
	for i := range tasks {
		if tasks[i].ID == id {
			return &tasks[i], nil
		}
	}
	return nil, fmt.Errorf("task %s not found", id)
}

// SortedBySalience returns tasks sorted by salience (overdue first, completed last).
func (s *Store) SortedBySalience() ([]Task, error) {
	tasks, err := s.All()
	if err != nil {
		return nil, err
	}
	now := today()
	sort.SliceStable(tasks, func(i, j int) bool {
		return taskSalience(tasks[i], now) > taskSalience(tasks[j], now)
	})
	return tasks, nil
}

// Stats returns aggregate stats: total, done, pending, overdue.
func (s *Store) Stats() (total, done, pending, overdue int, err error) {
	tasks, err := s.All()
	if err != nil {
		return
	}
	now := today()
	for _, t := range tasks {
		total++
		if t.Done {
			done++
		} else {
			pending++
			if t.Due != "" && parseDate(t.Due).Before(now) {
				overdue++
			}
		}
	}
	return
}

func (s *Store) updateTask(id string, fn func(*Task)) (*Task, error) {
	tasks, err := s.load()
	if err != nil {
		return nil, err
	}
	for i := range tasks {
		if tasks[i].ID == id {
			fn(&tasks[i])
			if err := s.save(tasks); err != nil {
				return nil, err
			}
			return &tasks[i], nil
		}
	}
	return nil, fmt.Errorf("task %s not found", id)
}

func (s *Store) nextID(tasks []Task) string {
	max := 0
	for _, t := range tasks {
		parts := strings.Split(t.ID, "-")
		if len(parts) == 2 {
			if n, err := strconv.Atoi(parts[1]); err == nil && n > max {
				max = n
			}
		}
	}
	return fmt.Sprintf("t-%d", max+1)
}

// --- helpers ---

func today() time.Time {
	y, m, d := time.Now().Date()
	return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
}

func parseDate(s string) time.Time {
	t, err := time.Parse("2006-01-02", s)
	if err != nil {
		return time.Time{}
	}
	return t
}

func normalizeDue(s string) string {
	if s == "" {
		return ""
	}
	now := today()
	switch strings.ToLower(s) {
	case "today":
		return now.Format("2006-01-02")
	case "tomorrow":
		return now.AddDate(0, 0, 1).Format("2006-01-02")
	default:
		// Try parsing as ISO date; if it works, return it
		if _, err := time.Parse("2006-01-02", s); err == nil {
			return s
		}
		return s
	}
}

func parseTags(s string) []string {
	if s == "" {
		return nil
	}
	var tags []string
	for _, t := range strings.Split(s, ",") {
		t = strings.TrimSpace(t)
		if t != "" {
			tags = append(tags, t)
		}
	}
	return tags
}

func taskSalience(t Task, now time.Time) float64 {
	if t.Done {
		return 0.2
	}
	if t.Due == "" {
		return 0.4
	}
	due := parseDate(t.Due)
	if due.Before(now) {
		return 1.0
	}
	if due.Equal(now) {
		return 0.9
	}
	weekLater := now.AddDate(0, 0, 7)
	if due.Before(weekLater) {
		return 0.7
	}
	return 0.5
}

func taskUrgency(t Task, now time.Time) string {
	if t.Done {
		return ""
	}
	if t.Due == "" {
		return ""
	}
	due := parseDate(t.Due)
	if due.Before(now) {
		return "high"
	}
	if due.Equal(now) {
		return "medium"
	}
	return "low"
}

func taskReason(t Task, now time.Time) string {
	if t.Done || t.Due == "" {
		return ""
	}
	due := parseDate(t.Due)
	if due.Before(now) {
		days := int(now.Sub(due).Hours() / 24)
		if days == 1 {
			return "1 day overdue"
		}
		return fmt.Sprintf("%d days overdue", days)
	}
	if due.Equal(now) {
		return "due today"
	}
	return ""
}

// Export formats tasks for export.
func (s *Store) Export(format string) (string, error) {
	tasks, err := s.All()
	if err != nil {
		return "", err
	}

	switch format {
	case "json":
		data, err := json.MarshalIndent(taskFile{Tasks: tasks}, "", "  ")
		if err != nil {
			return "", err
		}
		return string(data), nil

	case "csv":
		var b strings.Builder
		b.WriteString("id,title,done,due,tags,notes\n")
		for _, t := range tasks {
			b.WriteString(fmt.Sprintf("%s,%q,%v,%s,%q,%q\n",
				t.ID, t.Title, t.Done, t.Due,
				strings.Join(t.Tags, ";"), t.Notes))
		}
		return b.String(), nil

	case "markdown":
		var b strings.Builder
		b.WriteString("# Tasks\n\n")
		for _, t := range tasks {
			check := " "
			if t.Done {
				check = "x"
			}
			b.WriteString(fmt.Sprintf("- [%s] %s", check, t.Title))
			if t.Due != "" {
				b.WriteString(fmt.Sprintf("  (due: %s)", t.Due))
			}
			if len(t.Tags) > 0 {
				b.WriteString(fmt.Sprintf("  [%s]", strings.Join(t.Tags, ", ")))
			}
			b.WriteString("\n")
		}
		return b.String(), nil

	default:
		return "", fmt.Errorf("unsupported format: %s", format)
	}
}
