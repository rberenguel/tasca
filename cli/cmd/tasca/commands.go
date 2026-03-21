package main

import (
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"strings"
)

// ── Core list/next ────────────────────────────────────────────────────────────

func cmdNext(store *Store, state *State, args []string, opts Options) error {
	limit := 10
	if len(args) > 0 {
		if n, err := strconv.Atoi(args[0]); err == nil && n > 0 {
			limit = n
			args = args[1:]
		}
	}
	return runList(store, state, withContext(state, args), limit, opts)
}

func cmdList(store *Store, state *State, args []string, opts Options) error {
	return runList(store, state, withContext(state, args), 0, opts)
}

// withContext prepends state.Context to args, deduplicating identical tokens.
func withContext(state *State, args []string) []string {
	if len(state.Context) == 0 {
		return args
	}
	if len(args) == 0 {
		return state.Context
	}
	// Prepend context, then extra args (extra args can narrow further)
	return append(append([]string(nil), state.Context...), args...)
}

// contextDefaults extracts project and real tags from context args for use in add.
func contextDefaults(ctx []string) (project string, tags []string) {
	for _, token := range ctx {
		lo := strings.ToLower(token)
		if strings.HasPrefix(lo, "pro:") || strings.HasPrefix(lo, "p:") ||
			strings.HasPrefix(lo, "proj:") || strings.HasPrefix(lo, "project:") {
			idx := strings.Index(token, ":") + 1
			project = token[idx:]
		} else if strings.HasPrefix(token, "!") {
			tag := token[1:]
			// Skip virtual tags — only inherit real user tags
			switch tag {
			case "today", "overdue", "waiting", "scheduled", "blocked", "done",
				"active", "recurring", "someday", "routine", "modified", "checklist",
				"t", "o", "w", "s", "b", "d", "a", "r", "sd", "rt", "m", "cl":
				// virtual — skip
			default:
				tags = append(tags, tag)
			}
		}
	}
	return
}

// refreshView re-renders using the last view stored in state.Context.
// Used by mutation commands (done, mod, skip, etc.) to stay in context.
func refreshView(store *Store, state *State, opts Options) error {
	if len(state.Context) == 0 {
		return runList(store, state, nil, 10, opts)
	}
	return runList(store, state, state.Context, 0, opts)
}

func printContextBanner(ctx []string, opts Options) {
	if len(ctx) == 0 {
		return
	}
	label := strings.Join(ctx, " ")
	if opts.Markdown {
		fmt.Printf("_Context: %s_\n\n", label)
	} else {
		termWidth := 100
		if w := os.Getenv("COLUMNS"); w != "" {
			fmt.Sscanf(w, "%d", &termWidth)
		}
		line := "context: " + label
		pad := termWidth - len(line) - 2
		if pad < 0 {
			pad = 0
		}
		fmt.Printf("%s\n", col(ansiDim, "─ "+line+" "+strings.Repeat("─", pad)))
	}
}

func runList(store *Store, state *State, args []string, limit int, opts Options) error {
	all := store.Tasks
	projects := store.Projects

	printContextBanner(state.Context, opts)

	f := parseFilters(args)

	// If search terms present in raw args (non-modifier tokens), include waiting
	for _, token := range args {
		lo := strings.ToLower(token)
		if !strings.HasPrefix(token, "!") &&
			!strings.HasPrefix(lo, "sort:") && !strings.HasPrefix(lo, "s:") &&
			!strings.HasPrefix(lo, "pro:") && !strings.HasPrefix(lo, "p:") &&
			!strings.HasPrefix(lo, "proj:") && !strings.HasPrefix(lo, "project:") &&
			!strings.HasPrefix(lo, "end:") && !strings.HasPrefix(lo, "lim:") &&
			token != "" {
			f.ShowWaiting = true
			break
		}
	}

	tasks := applyFilters(all, f, all, projects)

	// Calculate urgency
	for _, t := range tasks {
		t.Urgency = calcUrgency(t, all, projects)
	}

	// Sort
	if len(f.SortFields) > 0 {
		sortTasksBy(tasks, f.SortFields)
	} else if f.IsToday {
		sortTodayTasks(tasks)
	} else {
		sortTasks(tasks)
	}

	// In next view (limit > 0), hide negative urgency tasks
	if limit > 0 {
		todayStr := formatDateOnly(nowMs())
		var filtered []*Task
		for _, t := range tasks {
			if t.Urgency >= 0 {
				filtered = append(filtered, t)
			} else if f.IsToday && t.Due != nil && formatDateOnly(*t.Due) == todayStr {
				filtered = append(filtered, t)
			}
		}
		tasks = filtered
	}

	if limit > 0 && len(tasks) > limit {
		tasks = tasks[:limit]
	}

	rOpts := RenderOpts{
		Markdown:       opts.Markdown,
		IsToday:        f.IsToday,
		IsNext:         limit > 0 && !f.IsToday,
		SuppressFooter: f.IsToday,
	}

	dm := renderList(tasks, all, projects, rOpts)

	// Today sections (started/overdue/ready)
	if f.IsToday && !f.ShowDone {
		extra := renderTodaySections(all, projects, f.Project, f.Search, dm, rOpts)
		dm = append(dm, extra...)
	}

	state.DisplayMap = dm
	return nil
}

// ── Add ───────────────────────────────────────────────────────────────────────

func cmdAdd(store *Store, state *State, args []string, opts Options) error {
	ta := parseTaskArgs(args, state.DisplayMap)
	if ta.Desc == "" {
		return fmt.Errorf("no description")
	}

	// Inherit project and tags from active context (explicit args take precedence)
	ctxProj, ctxTags := contextDefaults(state.Context)
	if ta.Project == "" && ctxProj != "" {
		ta.Project = ctxProj
	}
	for _, tag := range ctxTags {
		if !hasTag(&Task{Tags: ta.Tags}, tag) {
			ta.Tags = append(ta.Tags, tag)
		}
	}

	if ta.Target != "" {
		for _, t := range store.Tasks {
			if t.Status == "pending" && t.Target == ta.Target {
				return fmt.Errorf("target x:%s already exists", ta.Target)
			}
		}
	}

	task := &Task{
		UUID:        newUUID(),
		Description: ta.Desc,
		Project:     ta.Project,
		Priority:    ta.Priority,
		Order:       ta.Order,
		Tags:        ta.Tags,
		Depends:     ta.Depends,
		Due:         ta.Due,
		Wait:        ta.Wait,
		WaitTime:    ta.WaitTime,
		Sched:       ta.Sched,
		Recur:       ta.Recur,
		URL:         ta.URL,
		Icon:        ta.Icon,
		Color:       ta.Color,
		Target:      ta.Target,
		OnDone:      ta.OnDone,
		Annotations: []Annotation{},
		Status:      "pending",
		Entry:       uniqueTimestamp(),
	}

	store.Tasks = append(store.Tasks, task)

	if opts.Markdown {
		fmt.Printf("_Added: %s_\n\n", task.Description)
	} else {
		fmt.Printf("%s %s\n", col(ansiGreen, "Added:"), task.Description)
	}
	return refreshView(store, state, opts)
}

// ── Done ──────────────────────────────────────────────────────────────────────

func cmdDone(store *Store, state *State, args []string, opts Options) error {
	if len(args) == 0 {
		return fmt.Errorf("usage: done <ID[s]>")
	}
	uuids := resolveIDs(args[0], state.DisplayMap, store)
	if len(uuids) == 0 {
		return fmt.Errorf("invalid ID: %s", args[0])
	}

	recurCount := 0
	for _, uuid := range uuids {
		t := findTask(store, uuid)
		if t == nil {
			continue
		}
		now := nowMs()
		t.Status = "completed"
		t.End = &now

		rec := calcNextRecurrence(t)
		if rec != nil {
			newTask := cloneTask(t)
			newTask.UUID = newUUID()
			newTask.Status = "pending"
			newTask.Due = &rec.NextDue
			newTask.Wait = rec.NextWait
			newTask.WaitTime = rec.WaitTime
			newTask.Sched = rec.NextSched
			entry := uniqueTimestamp()
			newTask.Entry = entry
			newTask.Annotations = []Annotation{}
			newTask.Depends = nil
			newTask.End = nil
			newTask.Start = nil
			store.Tasks = append(store.Tasks, newTask)
			recurCount++
		}
	}

	if recurCount > 0 {
		fmt.Println(col(ansiGreen, fmt.Sprintf("Completed %d task(s). %d recurring task(s) created.", len(uuids), recurCount)))
	} else if len(uuids) > 1 {
		fmt.Println(col(ansiGreen, fmt.Sprintf("Completed %d tasks.", len(uuids))))
	}

	return refreshView(store, state, opts)
}

// ── Delete ────────────────────────────────────────────────────────────────────

func cmdDelete(store *Store, state *State, args []string, opts Options) error {
	if len(args) == 0 {
		return fmt.Errorf("usage: delete <ID[s]>")
	}
	uuids := resolveIDs(args[0], state.DisplayMap, store)
	if len(uuids) == 0 {
		return fmt.Errorf("invalid ID: %s", args[0])
	}

	uuidSet := map[string]bool{}
	for _, u := range uuids {
		uuidSet[u] = true
	}

	var remaining []*Task
	deleted := 0
	for _, t := range store.Tasks {
		if uuidSet[t.UUID] {
			deleted++
		} else {
			remaining = append(remaining, t)
		}
	}
	store.Tasks = remaining

	if deleted > 1 {
		fmt.Println(col(ansiGreen, fmt.Sprintf("Deleted %d tasks.", deleted)))
	}
	return refreshView(store, state, opts)
}

// ── Skip ──────────────────────────────────────────────────────────────────────

func cmdSkip(store *Store, state *State, args []string, opts Options) error {
	if len(args) == 0 {
		return fmt.Errorf("usage: skip <ID[s]> [until:DATE]")
	}
	uuids := resolveIDs(args[0], state.DisplayMap, store)
	if len(uuids) == 0 {
		return fmt.Errorf("invalid ID: %s", args[0])
	}

	var untilDate *int64
	for _, token := range args[1:] {
		lo := strings.ToLower(token)
		if strings.HasPrefix(lo, "until:") || strings.HasPrefix(lo, "u:") {
			dateStr := token[strings.Index(token, ":")+1:]
			untilDate = parseDate(dateStr)
			if untilDate == nil {
				return fmt.Errorf("invalid until date: %s", dateStr)
			}
		}
	}

	recurCount := 0
	cancelCount := 0

	for _, uuid := range uuids {
		t := findTask(store, uuid)
		if t == nil {
			continue
		}
		now := nowMs()
		t.Status = "skipped"
		t.End = &now

		if t.Recur != "" && t.Due != nil {
			rec := calcNextRecurrence(t)
			if rec != nil {
				skipped := 1
				if untilDate != nil {
					cur := cloneTask(t)
					for rec != nil && rec.NextDue < *untilDate {
						skipped++
						cur.Due = &rec.NextDue
						cur.Wait = rec.NextWait
						cur.WaitTime = rec.WaitTime
						cur.Sched = rec.NextSched
						rec = calcNextRecurrence(cur)
					}
				}
				if rec != nil {
					newTask := cloneTask(t)
					newTask.UUID = newUUID()
					newTask.Status = "pending"
					newTask.Due = &rec.NextDue
					newTask.Wait = rec.NextWait
					newTask.WaitTime = rec.WaitTime
					newTask.Sched = rec.NextSched
					entry := uniqueTimestamp()
					newTask.Entry = entry
					newTask.Annotations = []Annotation{}
					newTask.Depends = nil
					newTask.End = nil
					newTask.Start = nil
					store.Tasks = append(store.Tasks, newTask)
					recurCount++

					if untilDate != nil && skipped > 1 {
						fmt.Println(col(ansiGreen, fmt.Sprintf("Skipped %d occurrences. Next: %s", skipped, formatDate(rec.NextDue))))
					}
				}
			}
		} else {
			cancelCount++
		}
	}

	if cancelCount > 0 && recurCount == 0 {
		fmt.Println(col(ansiGreen, "Cancelled."))
	} else if recurCount > 0 && untilDate == nil {
		fmt.Println(col(ansiGreen, "Skipped. Next occurrence created."))
	}

	return refreshView(store, state, opts)
}

// ── Modify ────────────────────────────────────────────────────────────────────

func cmdMod(store *Store, state *State, args []string, opts Options) error {
	if len(args) < 1 {
		return fmt.Errorf("usage: mod <ID[s]> [changes]")
	}
	uuids := resolveIDs(args[0], state.DisplayMap, store)
	if len(uuids) == 0 {
		return fmt.Errorf("invalid ID: %s", args[0])
	}
	ta := parseTaskArgs(args[1:], state.DisplayMap)

	for _, uuid := range uuids {
		t := findTask(store, uuid)
		if t == nil {
			continue
		}
		if ta.Desc != "" {
			t.Description = ta.Desc
		}
		if ta.Project != "" {
			t.Project = ta.Project
		}
		if ta.Priority != nil {
			t.Priority = ta.Priority
		}
		if ta.Order != nil {
			t.Order = ta.Order
		}
		if ta.ClearOrder {
			t.Order = nil
		}
		if ta.Due != nil {
			t.Due = ta.Due
		}
		if ta.Wait != nil {
			t.Wait = ta.Wait
			t.WaitTime = ta.WaitTime
		}
		if ta.Sched != nil {
			t.Sched = ta.Sched
		}
		if ta.Recur != "" {
			t.Recur = ta.Recur
		}
		if ta.URL != "" {
			t.URL = ta.URL
		}
		if ta.Icon != "" {
			t.Icon = ta.Icon
		}
		if ta.Color != nil {
			t.Color = ta.Color
		}
		if ta.Target != "" {
			t.Target = ta.Target
		}
		if ta.OnDone != "" {
			t.OnDone = ta.OnDone
		}
		// Toggle tags
		for _, tag := range ta.Tags {
			found := false
			for i, tg := range t.Tags {
				if strEqFold(tg, tag) {
					t.Tags = append(t.Tags[:i], t.Tags[i+1:]...)
					found = true
					break
				}
			}
			if !found {
				t.Tags = append(t.Tags, tag)
			}
		}
		// Toggle depends
		for _, depUUID := range ta.Depends {
			found := false
			for i, d := range t.Depends {
				if d == depUUID {
					t.Depends = append(t.Depends[:i], t.Depends[i+1:]...)
					found = true
					break
				}
			}
			if !found {
				t.Depends = append(t.Depends, depUUID)
			}
		}
		t.Modified = nowMs()
	}

	return refreshView(store, state, opts)
}

// ── Start ─────────────────────────────────────────────────────────────────────

func cmdStart(store *Store, state *State, args []string, opts Options) error {
	if len(args) == 0 {
		return fmt.Errorf("usage: start <ID>")
	}
	uuids := resolveIDs(args[0], state.DisplayMap, store)
	if len(uuids) == 0 {
		return fmt.Errorf("invalid ID: %s", args[0])
	}
	for _, uuid := range uuids {
		t := findTask(store, uuid)
		if t == nil {
			continue
		}
		now := nowMs()
		t.Start = &now
		t.Modified = now
	}
	fmt.Println(col(ansiGreen, "Started."))
	return refreshView(store, state, opts)
}

// ── Stop ──────────────────────────────────────────────────────────────────────

func cmdStop(store *Store, state *State, args []string, opts Options) error {
	if len(args) == 0 {
		return fmt.Errorf("usage: stop <ID>")
	}
	uuids := resolveIDs(args[0], state.DisplayMap, store)
	if len(uuids) == 0 {
		return fmt.Errorf("invalid ID: %s", args[0])
	}
	now := nowMs()
	for _, uuid := range uuids {
		t := findTask(store, uuid)
		if t == nil {
			continue
		}
		if t.Start == nil {
			continue
		}
		t.Start = nil
		t.Touches++
		t.Modified = now
	}
	fmt.Println(col(ansiGreen, "Stopped."))
	return refreshView(store, state, opts)
}

// ── Info ──────────────────────────────────────────────────────────────────────

func cmdInfo(store *Store, state *State, args []string, opts Options) error {
	if len(args) == 0 {
		return fmt.Errorf("usage: info <ID|pro:Name>")
	}
	idStr := args[0]

	// Project info
	lo := strings.ToLower(idStr)
	if strings.HasPrefix(lo, "pro:") || strings.HasPrefix(lo, "p:") || strings.HasPrefix(lo, "proj:") {
		projName := idStr[strings.Index(idStr, ":")+1:]
		p := findProject(store, projName)
		printProjectInfo(p, projName, store, opts.Markdown)
		return nil
	}

	var uuid string
	var displayID int

	if strings.HasPrefix(idStr, "x:") {
		name := idStr[2:]
		for _, t := range store.Tasks {
			if t.Status == "pending" && t.Target == name {
				uuid = t.UUID
				break
			}
		}
	} else {
		id, err := strconv.Atoi(idStr)
		if err != nil || id < 1 || id > len(state.DisplayMap) {
			return fmt.Errorf("invalid ID: %s (run 'next' or 'list' first)", idStr)
		}
		displayID = id
		uuid = state.DisplayMap[id-1]
	}

	if uuid == "" {
		return fmt.Errorf("task not found: %s", idStr)
	}
	t := findTask(store, uuid)
	if t == nil {
		return fmt.Errorf("task not found: %s", uuid)
	}
	if displayID == 0 {
		for i, u := range state.DisplayMap {
			if u == uuid {
				displayID = i + 1
				break
			}
		}
	}

	printInfo(t, displayID, store.Tasks, store.Projects, opts.Markdown)
	return nil
}

// ── Annotate ──────────────────────────────────────────────────────────────────

func cmdAnnotate(store *Store, state *State, args []string, opts Options) error {
	if len(args) < 2 {
		return fmt.Errorf("usage: annotate <ID|pro:Name> <note|-N|-N text>")
	}
	idStr := args[0]

	// Project annotation
	lo := strings.ToLower(idStr)
	if strings.HasPrefix(lo, "pro:") || strings.HasPrefix(lo, "p:") || strings.HasPrefix(lo, "proj:") {
		projName := idStr[strings.Index(idStr, ":")+1:]
		return annotateProject(store, projName, strings.Join(args[1:], " "), opts)
	}

	var uuid string
	if strings.HasPrefix(idStr, "x:") {
		name := idStr[2:]
		for _, t := range store.Tasks {
			if t.Status == "pending" && t.Target == name {
				uuid = t.UUID
				break
			}
		}
	} else {
		id, err := strconv.Atoi(idStr)
		if err != nil || id < 1 || id > len(state.DisplayMap) {
			return fmt.Errorf("invalid ID: %s", idStr)
		}
		uuid = state.DisplayMap[id-1]
	}

	if uuid == "" {
		return fmt.Errorf("task not found: %s", idStr)
	}
	t := findTask(store, uuid)
	if t == nil {
		return fmt.Errorf("task not found")
	}

	note := strings.Join(args[1:], " ")
	return applyAnnotation(&t.Annotations, &t.Modified, note)
}

// annotateProject adds/removes/edits an annotation on a project.
func annotateProject(store *Store, projName string, note string, opts Options) error {
	p := findProject(store, projName)
	if p == nil {
		p = &Project{Name: projName}
		store.Projects = append(store.Projects, p)
	}
	modified := p.Modified
	err := applyAnnotation(&p.Annotations, &modified, note)
	p.Modified = modified
	return err
}

// applyAnnotation mutates annotations: add, remove (-N), or edit (-N text).
func applyAnnotation(annotations *[]Annotation, modified *int64, note string) error {
	if strings.HasPrefix(note, "-") {
		rest := note[1:]
		spaceIdx := strings.Index(rest, " ")
		numStr := rest
		editText := ""
		if spaceIdx >= 0 {
			numStr = rest[:spaceIdx]
			editText = strings.TrimSpace(rest[spaceIdx+1:])
		}
		n, err := strconv.Atoi(numStr)
		if err != nil {
			return fmt.Errorf("invalid annotation index: -%s", numStr)
		}
		if n < 1 || n > len(*annotations) {
			return fmt.Errorf("annotation index out of range (has %d)", len(*annotations))
		}
		if editText != "" {
			(*annotations)[n-1].Description = editText
			fmt.Println(col(ansiGreen, fmt.Sprintf("Annotation %d updated.", n)))
		} else {
			*annotations = append((*annotations)[:n-1], (*annotations)[n:]...)
			fmt.Println(col(ansiGreen, fmt.Sprintf("Annotation %d removed.", n)))
		}
		*modified = nowMs()
		return nil
	}

	if *annotations == nil {
		*annotations = []Annotation{}
	}
	*annotations = append(*annotations, Annotation{
		Entry:       nowMs(),
		Description: note,
	})
	*modified = nowMs()
	fmt.Println(col(ansiGreen, "Annotation added."))
	return nil
}

// ── Chain ─────────────────────────────────────────────────────────────────────

func cmdChain(store *Store, state *State, args []string, opts Options) error {
	if len(args) == 0 {
		return fmt.Errorf("usage: chain <ID>")
	}
	id, err := strconv.Atoi(args[0])
	if err != nil || id < 1 || id > len(state.DisplayMap) {
		return fmt.Errorf("invalid ID: %s", args[0])
	}
	uuid := state.DisplayMap[id-1]
	t := findTask(store, uuid)
	if t == nil {
		return fmt.Errorf("task not found")
	}
	printChain(t, store.Tasks, state.DisplayMap, opts.Markdown)
	return nil
}

// ── Projects ──────────────────────────────────────────────────────────────────

func cmdProjects(store *Store, state *State, args []string, opts Options) error {
	printProjects(store, opts.Markdown)
	return nil
}

// ── Context ───────────────────────────────────────────────────────────────────

func cmdContext(store *Store, state *State, args []string, opts Options) error {
	if len(args) == 0 {
		// Clear context
		state.Context = nil
		if opts.Markdown {
			fmt.Println("_Context cleared._")
		} else {
			fmt.Println(col(ansiDim, "Context cleared."))
		}
		return runList(store, state, nil, 10, opts)
	}
	state.Context = args
	return runList(store, state, args, 0, opts)
}

// ── Today ─────────────────────────────────────────────────────────────────────

func cmdToday(store *Store, state *State, args []string, opts Options) error {
	listArgs := append([]string{"!today"}, args...)
	state.Context = listArgs
	return runList(store, state, listArgs, 0, opts)
}

// ── Calendar ──────────────────────────────────────────────────────────────────

func cmdCalendar(store *Store, state *State, args []string, opts Options) error {
	days := 14
	fProj := ""

	for _, token := range args {
		lo := strings.ToLower(token)
		if strings.HasPrefix(lo, "lim:") || strings.HasPrefix(lo, "l:") {
			if n, err := strconv.Atoi(token[strings.Index(token, ":")+1:]); err == nil {
				days = n
			}
		} else if strings.HasPrefix(lo, "pro:") || strings.HasPrefix(lo, "p:") {
			fProj = token[strings.Index(token, ":")+1:]
		}
	}

	f := Filter{Project: fProj, ShowWaiting: true}
	tasks := applyFilters(store.Tasks, f, store.Tasks, store.Projects)

	dm := printCalendar(tasks, store.Tasks, store.Projects, days, opts.Markdown)
	state.DisplayMap = dm
	return nil
}

// ── Report ────────────────────────────────────────────────────────────────────

func cmdReport(store *Store, state *State, args []string, opts Options) error {
	if len(args) == 0 {
		return fmt.Errorf("usage: report <stale|rot [N]|done [period] [by:project|by:tag]>")
	}

	switch strings.ToLower(args[0]) {
	case "stale":
		reportStale(store, opts.Markdown)

	case "rot":
		n := 10
		if len(args) > 1 {
			if v, err := strconv.Atoi(args[1]); err == nil {
				n = v
			}
		}
		reportRot(store, n, opts.Markdown)

	case "done":
		period := "1w"
		groupBy := "project"
		for _, a := range args[1:] {
			lo := strings.ToLower(a)
			switch lo {
			case "by:project":
				groupBy = "project"
			case "by:tag":
				groupBy = "tag"
			default:
				period = lo
			}
		}
		reportDone(store, period, groupBy, opts.Markdown)

	default:
		return fmt.Errorf("unknown report subcommand: %s", args[0])
	}
	return nil
}

// ── Export ────────────────────────────────────────────────────────────────────

func cmdExport(store *Store, state *State, args []string, opts Options) error {
	tasks := store.Tasks

	if len(args) > 0 {
		f := parseFilters(args)
		tasks = applyFilters(store.Tasks, f, store.Tasks, store.Projects)
	}

	out := Store{
		Tasks:    tasks,
		Projects: store.Projects,
		SavedAt:  nowMs(),
	}

	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	return enc.Encode(out)
}

// ── Import ────────────────────────────────────────────────────────────────────

func cmdImport(store *Store, state *State, args []string, opts Options) error {
	var incoming Store
	if err := json.NewDecoder(os.Stdin).Decode(&incoming); err != nil {
		return fmt.Errorf("decode: %w", err)
	}

	taskIdx := map[string]int{}
	for i, t := range store.Tasks {
		taskIdx[t.UUID] = i
	}
	imported := 0
	for _, t := range incoming.Tasks {
		if t.UUID == "" {
			continue
		}
		if i, ok := taskIdx[t.UUID]; ok {
			store.Tasks[i] = t
		} else {
			store.Tasks = append(store.Tasks, t)
		}
		imported++
	}

	projIdx := map[string]int{}
	for i, p := range store.Projects {
		projIdx[p.Name] = i
	}
	importedProj := 0
	for _, p := range incoming.Projects {
		if p.Name == "" {
			continue
		}
		if i, ok := projIdx[p.Name]; ok {
			store.Projects[i] = p
		} else {
			store.Projects = append(store.Projects, p)
		}
		importedProj++
	}

	fmt.Printf("%s\n", col(ansiGreen, fmt.Sprintf("Imported %d tasks, %d projects.", imported, importedProj)))
	return nil
}

// ── Help ──────────────────────────────────────────────────────────────────────

func cmdHelp(args []string) {
	if len(args) > 0 {
		printCommandHelp(args[0])
		return
	}
	fmt.Print(`Commands:
  next [N]              Top N tasks by urgency (default 10)
  list [filters]        List tasks with filters
  add <desc> [opts]     Add task
  done <IDs>            Mark complete (recurrence handled)
  delete <IDs>          Delete tasks
  skip <IDs> [until:]   Skip/cancel task
  mod <IDs> [opts]      Modify tasks
  start <ID>            Mark started (active)
  stop <ID>             Clear active state, increment touches counter
  info <ID>             Show task details
  annotate <ID> <note>  Add annotation  (-N to remove)
  chain <ID>            Show dependency tree
  projects              List all projects
  today / day           Today view with sections
  calendar [opts]       Agenda view (lim:N pro:X)
  report stale          Projects by staleness
  report rot [N]        Oldest N pending tasks
  report done [period]  Completed tasks by project/tag
  export [filters]      Export JSON to stdout
  import                Import JSON from stdin
  help [cmd]            This help

Filters:  pro:X  !tag  !today  !overdue  !done  text  sort:field  end:1w
Options:  pro:X  pri:N  due:DATE  wait:DATE  sched:DATE  recur:1d  !tag  dep:N  url:URL  order:N
Dates:    today  tomorrow  3d  2w  1m  mon  20260315  18:00  today@18:00

Flags:
  -f <path>     Tasca JSON file (or TASCA_FILE env var)
  --markdown    Markdown output for LLMs
  --no-color    Disable ANSI colors
`)
}

func printCommandHelp(cmd string) {
	helps := map[string]string{
		"next":     "next [N]\n  Top N tasks by urgency. Default N=10.\n  Hides tasks with negative urgency (blocked, someday, reference).",
		"list":     "list [filters]\n  List pending tasks.\n  Filters: pro:X  !tag  !today  text  sort:field  end:1w",
		"add":      "add <desc> [opts]\n  Add a task.\n  Options: pro:X  pri:N  due:DATE  wait:DATE  sched:DATE  recur:Nd  !tag  dep:N  url:URL",
		"done":     "done <IDs>\n  Mark tasks complete. Creates next occurrence for recurring tasks.\n  Multi-ID: done 1,3,5  done 1-3",
		"delete":   "delete <IDs>\n  Delete tasks permanently. Multi-ID: delete 1,3  delete 2-5",
		"skip":     "skip <IDs> [until:DATE]\n  Skip recurring task → creates next occurrence.\n  Non-recurring: marks as skipped (cancelled).\n  until: skips multiple occurrences at once.",
		"mod":      "mod <IDs> [opts]\n  Modify. Tags and deps toggle. Clear: order:  pri:  url:\n  Multi-ID: mod 1,3-5 !tag",
		"start":    "start <ID>\n  Mark task started (active).",
		"stop":     "stop <ID>\n  Clear active state. Increments touches counter — tracks how many times\n  the task has been picked up and put back down without completing.",
		"info":     "info <ID>\n  Full task details: annotations, tracking, checklist, urgency.",
		"annotate": "annotate <ID> <note>\n  Add annotation.\n  annotate <ID> -N  Remove annotation by 1-based index.",
		"chain":    "chain <ID>\n  Dependency tree: what this blocks and what blocks it.",
		"projects": "projects\n  List projects with pending task counts and tags.",
		"today":    "today / day\n  Tasks due today + started / overdue / ready sections.",
		"calendar": "calendar [lim:N] [pro:X]\n  Agenda view of dated tasks. Default 14 days.",
		"report":   "report stale|rot [N]|done [period] [by:project|by:tag]\n  GTD review reports.",
		"export":   "export [filters]\n  JSON to stdout. Same filters as list.",
		"import":   "import\n  JSON from stdin. Upserts by UUID.",
	}
	if h, ok := helps[cmd]; ok {
		fmt.Println(h)
	} else {
		fmt.Printf("No help for '%s'\n", cmd)
	}
}
