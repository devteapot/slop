package main

import (
	"fmt"
	"os"
	"strings"
	"time"
)

// ANSI escape codes
const (
	reset  = "\033[0m"
	bold   = "\033[1m"
	dim    = "\033[2m"
	red    = "\033[31m"
	green  = "\033[32m"
	yellow = "\033[33m"
	cyan   = "\033[36m"
	gray   = "\033[90m"
)

func runCLI(store *Store, args []string) {
	if len(args) == 0 {
		cmdList(store, false, "")
		return
	}

	switch args[0] {
	case "list":
		all := flagVal(args, "--all") != ""
		tag := flagVal(args, "--tag")
		cmdList(store, all, tag)

	case "add":
		if len(args) < 2 {
			fmt.Fprintln(os.Stderr, "Usage: tsk add <title> [--due <date>] [--tag <tag>]")
			os.Exit(1)
		}
		title := args[1]
		due := flagVal(args, "--due")
		tag := flagVal(args, "--tag")
		cmdAdd(store, title, due, tag)

	case "done":
		if len(args) < 2 {
			fmt.Fprintln(os.Stderr, "Usage: tsk done <id>")
			os.Exit(1)
		}
		cmdDone(store, normalizeID(args[1]))

	case "undo":
		if len(args) < 2 {
			fmt.Fprintln(os.Stderr, "Usage: tsk undo <id>")
			os.Exit(1)
		}
		cmdUndo(store, normalizeID(args[1]))

	case "edit":
		if len(args) < 2 {
			fmt.Fprintln(os.Stderr, "Usage: tsk edit <id> [--title <t>] [--due <d>] [--tag <t>]")
			os.Exit(1)
		}
		id := normalizeID(args[1])
		title := flagVal(args, "--title")
		due := flagVal(args, "--due")
		tag := flagVal(args, "--tag")
		cmdEdit(store, id, title, due, tag)

	case "delete":
		if len(args) < 2 {
			fmt.Fprintln(os.Stderr, "Usage: tsk delete <id>")
			os.Exit(1)
		}
		cmdDelete(store, normalizeID(args[1]))

	case "notes":
		if len(args) < 2 {
			fmt.Fprintln(os.Stderr, "Usage: tsk notes <id> [--set <text>]")
			os.Exit(1)
		}
		id := normalizeID(args[1])
		setText := flagVal(args, "--set")
		if setText != "" {
			cmdSetNotes(store, id, setText)
		} else {
			cmdNotes(store, id)
		}

	case "search":
		if len(args) < 2 {
			fmt.Fprintln(os.Stderr, "Usage: tsk search <query>")
			os.Exit(1)
		}
		cmdSearch(store, args[1])

	case "export":
		if len(args) < 2 {
			fmt.Fprintln(os.Stderr, "Usage: tsk export <json|csv|markdown>")
			os.Exit(1)
		}
		cmdExport(store, args[1])

	default:
		fmt.Fprintf(os.Stderr, "Unknown command: %s\n", args[0])
		os.Exit(1)
	}
}

func cmdList(store *Store, showAll bool, filterTag string) {
	tasks, err := store.SortedBySalience()
	if err != nil {
		fatal(err)
	}

	now := today()
	for _, t := range tasks {
		if !showAll && t.Done {
			continue
		}
		if filterTag != "" {
			found := false
			for _, tag := range t.Tags {
				if strings.EqualFold(tag, filterTag) {
					found = true
					break
				}
			}
			if !found {
				continue
			}
		}
		printTask(t, now)
	}
}

func cmdAdd(store *Store, title, due, tag string) {
	t, err := store.Add(title, due, tag)
	if err != nil {
		fatal(err)
	}
	fmt.Printf("%sCreated task %s%s\n", green, t.ID, reset)
}

func cmdDone(store *Store, id string) {
	t, err := store.Done(id)
	if err != nil {
		fatal(err)
	}
	fmt.Printf("%sCompleted: %s%s\n", green, t.Title, reset)
}

func cmdUndo(store *Store, id string) {
	t, err := store.Undo(id)
	if err != nil {
		fatal(err)
	}
	fmt.Printf("%sReopened: %s%s\n", yellow, t.Title, reset)
}

func cmdEdit(store *Store, id, title, due, tag string) {
	t, err := store.Edit(id, title, due, tag)
	if err != nil {
		fatal(err)
	}
	fmt.Printf("%sUpdated: %s%s\n", green, t.Title, reset)
}

func cmdDelete(store *Store, id string) {
	if err := store.Delete(id); err != nil {
		fatal(err)
	}
	fmt.Printf("%sDeleted task %s%s\n", red, id, reset)
}

func cmdNotes(store *Store, id string) {
	t, err := store.Find(id)
	if err != nil {
		fatal(err)
	}
	if t.Notes == "" {
		fmt.Printf("%sNo notes for %s%s\n", dim, id, reset)
		return
	}
	fmt.Println(t.Notes)
}

func cmdSetNotes(store *Store, id, text string) {
	_, err := store.SetNotes(id, text)
	if err != nil {
		fatal(err)
	}
	fmt.Printf("%sNotes updated for %s%s\n", green, id, reset)
}

func cmdSearch(store *Store, query string) {
	tasks, err := store.Search(query)
	if err != nil {
		fatal(err)
	}
	if len(tasks) == 0 {
		fmt.Printf("%sNo tasks matching %q%s\n", dim, query, reset)
		return
	}
	now := today()
	for _, t := range tasks {
		printTask(t, now)
	}
}

func cmdExport(store *Store, format string) {
	out, err := store.Export(format)
	if err != nil {
		fatal(err)
	}
	fmt.Print(out)
}

func printTask(t Task, now time.Time) {
	num := strings.TrimPrefix(t.ID, "t-")

	check := "[ ]"
	titleColor := ""
	if t.Done {
		check = fmt.Sprintf("%s[x]%s", green, reset)
		titleColor = dim
	}

	var extra string
	if t.Done && t.CompletedAt != "" {
		ct, _ := time.Parse(time.RFC3339, t.CompletedAt)
		extra = fmt.Sprintf("%sdone: %s%s", gray, relativeTime(ct), reset)
	} else if t.Due != "" {
		due := parseDate(t.Due)
		if due.Before(now) {
			extra = fmt.Sprintf("%s%sdue: overdue!%s", bold, red, reset)
		} else if due.Equal(now) {
			extra = fmt.Sprintf("%sdue: today%s", yellow, reset)
		} else if due.Equal(now.AddDate(0, 0, 1)) {
			extra = fmt.Sprintf("due: tomorrow")
		} else {
			extra = fmt.Sprintf("due: %s", t.Due)
		}
	}

	var tags string
	if len(t.Tags) > 0 {
		tagStrs := make([]string, len(t.Tags))
		for i, tag := range t.Tags {
			tagStrs[i] = fmt.Sprintf("%s#%s%s", cyan, tag, reset)
		}
		tags = strings.Join(tagStrs, " ")
	}

	fmt.Printf("  %s%s.%s %s %s%-24s%s  %-16s %s\n",
		bold, num, reset, check, titleColor, t.Title, reset, extra, tags)
}

func relativeTime(t time.Time) string {
	d := time.Since(t)
	switch {
	case d < time.Minute:
		return "just now"
	case d < time.Hour:
		return fmt.Sprintf("%dm ago", int(d.Minutes()))
	case d < 24*time.Hour:
		return fmt.Sprintf("%dh ago", int(d.Hours()))
	default:
		return fmt.Sprintf("%dd ago", int(d.Hours()/24))
	}
}

// normalizeID allows the user to pass "1" or "t-1".
func normalizeID(s string) string {
	if !strings.HasPrefix(s, "t-") {
		return "t-" + s
	}
	return s
}

func flagVal(args []string, flag string) string {
	for i, a := range args {
		if a == flag && i+1 < len(args) {
			return args[i+1]
		}
		// --all is a boolean flag
		if a == flag && flag == "--all" {
			return "true"
		}
	}
	return ""
}

func fatal(err error) {
	fmt.Fprintf(os.Stderr, "%serror: %v%s\n", red, err, reset)
	os.Exit(1)
}
