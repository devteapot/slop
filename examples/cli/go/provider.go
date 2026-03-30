package main

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	slop "github.com/slop-ai/slop-go"
)

const windowSize = 25

func floatPtr(f float64) *float64 { return &f }
func intPtr(i int) *int           { return &i }

func setupProvider(store *Store) *slop.Server {
	server := slop.NewServer("tsk", "tsk")

	// --- search affordance on tasks collection ---
	server.HandleWith("tasks", "search", slop.HandlerFunc(func(ctx context.Context, p slop.Params) (any, error) {
		query := p.String("query")
		results, err := store.Search(query)
		if err != nil {
			return nil, err
		}
		items := make([]map[string]any, len(results))
		for i, t := range results {
			items[i] = map[string]any{
				"id":    t.ID,
				"title": t.Title,
				"done":  t.Done,
				"due":   t.Due,
				"tags":  t.Tags,
			}
		}
		return map[string]any{"results": items, "count": len(items)}, nil
	}), slop.ActionOpts{
		Label:       "Search tasks",
		Description: "Search tasks by title or tag",
		Idempotent:  true,
		Estimate:    "instant",
		Params:      map[string]string{"query": "string"},
	})

	// --- static user context ---
	server.RegisterFunc("user", func() slop.Node {
		total, done, _, _, _ := store.Stats()
		return slop.Node{
			Type: "context",
			Props: slop.Props{
				"file":        store.path,
				"total_tasks": total,
				"total_done":  done,
			},
		}
	})

	// --- dynamic tasks collection ---
	server.RegisterFunc("tasks", func() slop.Node {
		return buildTasksNode(store)
	})

	// --- collection-level actions registered separately ---
	server.HandleWith("tasks", "add", slop.HandlerFunc(func(ctx context.Context, p slop.Params) (any, error) {
		title := p.String("title")
		if title == "" {
			return nil, fmt.Errorf("title is required")
		}
		due := p.String("due")
		tags := p.String("tags")
		t, err := store.Add(title, due, tags)
		if err != nil {
			return nil, err
		}
		return map[string]any{"id": t.ID}, nil
	}), slop.ActionOpts{
		Label:    "Add task",
		Estimate: "instant",
		Params:   map[string]string{"title": "string", "due": "string", "tags": "string"},
	})

	server.HandleWith("tasks", "clear_done", slop.HandlerFunc(func(ctx context.Context, p slop.Params) (any, error) {
		count, err := store.ClearDone()
		if err != nil {
			return nil, err
		}
		return map[string]any{"cleared": count}, nil
	}), slop.ActionOpts{
		Label:       "Clear completed",
		Description: "Remove all completed tasks",
		Dangerous:   true,
		Estimate:    "instant",
	})

	server.HandleWith("tasks", "export", slop.HandlerFunc(func(ctx context.Context, p slop.Params) (any, error) {
		format := p.String("format")
		if format == "" {
			format = "json"
		}
		// Simulate async: return accepted, then do the work.
		go func() {
			time.Sleep(500 * time.Millisecond)
			_, _ = store.Export(format)
			server.Refresh()
		}()
		return map[string]any{"__async": true, "status": "accepted"}, nil
	}), slop.ActionOpts{
		Label:       "Export tasks",
		Description: "Export tasks to a file",
		Estimate:    "slow",
		Params:      map[string]string{"format": "string"},
	})

	// --- tags collection ---
	server.RegisterFunc("tags", func() slop.Node {
		return buildTagsNode(store)
	})

	server.HandleWith("tags", "rename", slop.HandlerFunc(func(ctx context.Context, p slop.Params) (any, error) {
		oldName := p.String("old")
		newName := p.String("new")
		if oldName == "" || newName == "" {
			return nil, fmt.Errorf("old and new are required")
		}
		tasks, err := store.All()
		if err != nil {
			return nil, err
		}
		count := 0
		for _, t := range tasks {
			for i, tag := range t.Tags {
				if tag == oldName {
					t.Tags[i] = newName
					count++
					if _, err := store.Edit(t.ID, "", "", strings.Join(t.Tags, ",")); err != nil {
						return nil, err
					}
					break
				}
			}
		}
		return map[string]any{"renamed": count}, nil
	}), slop.ActionOpts{
		Label:    "Rename tag",
		Estimate: "instant",
		Params:   map[string]string{"old": "string", "new": "string"},
	})

	return server
}

func buildTasksNode(store *Store) slop.Node {
	tasks, err := store.SortedBySalience()
	if err != nil {
		return slop.Node{Type: "collection", Summary: "error loading tasks"}
	}

	total, done, pending, overdue, _ := store.Stats()
	now := today()

	// Window the tasks
	windowEnd := windowSize
	if windowEnd > len(tasks) {
		windowEnd = len(tasks)
	}
	windowed := tasks[:windowEnd]

	items := make([]slop.Item, len(windowed))
	for i, t := range windowed {
		items[i] = buildTaskItem(store, t, now)
	}

	node := slop.Node{
		Type: "collection",
		Props: slop.Props{
			"count":   total,
			"pending": pending,
			"overdue": overdue,
		},
		Summary: fmt.Sprintf("%d tasks: %d pending, %d done, %d overdue", total, pending, done, overdue),
		Items:   items,
		Meta: &slop.Meta{
			TotalChildren: intPtr(total),
			Window:        &[2]int{0, windowEnd},
		},
	}

	return node
}

func buildTaskItem(store *Store, t Task, now time.Time) slop.Item {
	sal := taskSalience(t, now)
	urg := taskUrgency(t, now)
	reason := taskReason(t, now)

	props := slop.Props{
		"title": t.Title,
		"done":  t.Done,
	}
	if t.Due != "" {
		props["due"] = t.Due
	}
	if len(t.Tags) > 0 {
		props["tags"] = t.Tags
	}
	if t.Done && t.CompletedAt != "" {
		props["completed_at"] = t.CompletedAt
	}

	// Content ref for notes
	contentRef := map[string]any{
		"type": "text",
		"mime": "text/plain",
	}
	if t.Notes != "" {
		contentRef["summary"] = fmt.Sprintf("%d lines of notes", strings.Count(t.Notes, "\n")+1)
		size := len(t.Notes)
		contentRef["size"] = size
		preview := t.Notes
		if len(preview) > 100 {
			preview = preview[:97] + "..."
		}
		contentRef["preview"] = preview
	} else {
		contentRef["summary"] = "No notes"
	}
	props["content_ref"] = contentRef

	// Actions depend on done state
	actions := slop.Actions{}
	taskID := t.ID

	if t.Done {
		actions["undo"] = slop.WithOpts(
			slop.HandlerFunc(func(ctx context.Context, p slop.Params) (any, error) {
				_, err := store.Undo(taskID)
				return nil, err
			}),
			slop.ActionOpts{Label: "Mark incomplete", Estimate: "instant"},
		)
	} else {
		actions["done"] = slop.WithOpts(
			slop.HandlerFunc(func(ctx context.Context, p slop.Params) (any, error) {
				_, err := store.Done(taskID)
				return nil, err
			}),
			slop.ActionOpts{Label: "Complete task", Estimate: "instant"},
		)
		actions["edit"] = slop.WithOpts(
			slop.HandlerFunc(func(ctx context.Context, p slop.Params) (any, error) {
				title := p.String("title")
				due := p.String("due")
				tags := p.String("tags")
				_, err := store.Edit(taskID, title, due, tags)
				return nil, err
			}),
			slop.ActionOpts{
				Label:    "Edit task",
				Estimate: "instant",
				Params:   map[string]string{"title": "string", "due": "string", "tags": "string"},
			},
		)
	}

	actions["delete"] = slop.WithOpts(
		slop.HandlerFunc(func(ctx context.Context, p slop.Params) (any, error) {
			return nil, store.Delete(taskID)
		}),
		slop.ActionOpts{Label: "Delete task", Dangerous: true, Estimate: "instant"},
	)

	actions["read_notes"] = slop.WithOpts(
		slop.HandlerFunc(func(ctx context.Context, p slop.Params) (any, error) {
			found, err := store.Find(taskID)
			if err != nil {
				return nil, err
			}
			return map[string]any{"content": found.Notes}, nil
		}),
		slop.ActionOpts{
			Label:       "Read full notes",
			Description: "Fetch the complete notes for this task",
			Idempotent:  true,
			Estimate:    "instant",
		},
	)

	actions["write_notes"] = slop.WithOpts(
		slop.HandlerFunc(func(ctx context.Context, p slop.Params) (any, error) {
			content := p.String("content")
			_, err := store.SetNotes(taskID, content)
			return nil, err
		}),
		slop.ActionOpts{
			Label:    "Write notes",
			Estimate: "instant",
			Params:   map[string]string{"content": "string"},
		},
	)

	meta := &slop.Meta{
		Salience: floatPtr(sal),
	}
	if urg != "" {
		meta.Urgency = urg
	}
	if reason != "" {
		meta.Reason = reason
	}

	return slop.Item{
		ID:      t.ID,
		Props:   props,
		Actions: actions,
		Meta:    meta,
	}
}

func buildTagsNode(store *Store) slop.Node {
	tasks, err := store.All()
	if err != nil {
		return slop.Node{Type: "collection", Summary: "error loading tags"}
	}

	tagCounts := map[string]int{}
	for _, t := range tasks {
		for _, tag := range t.Tags {
			tagCounts[tag]++
		}
	}

	// Build summary
	type tagCount struct {
		name  string
		count int
	}
	sorted := make([]tagCount, 0, len(tagCounts))
	for name, count := range tagCounts {
		sorted = append(sorted, tagCount{name, count})
	}
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].count > sorted[j].count })

	parts := make([]string, len(sorted))
	for i, tc := range sorted {
		parts[i] = fmt.Sprintf("%s (%d)", tc.name, tc.count)
	}

	return slop.Node{
		Type:    "collection",
		Props:   slop.Props{"count": len(tagCounts)},
		Summary: fmt.Sprintf("%d tags: %s", len(tagCounts), strings.Join(parts, ", ")),
	}
}
