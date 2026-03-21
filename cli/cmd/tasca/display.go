package main

import (
	"fmt"
	"math"
	"os"
	"strings"
	"time"
)

// ── Color / style ─────────────────────────────────────────────────────────────

var noColor bool

const (
	ansiReset   = "\x1b[0m"
	ansiBold    = "\x1b[1m"
	ansiDim     = "\x1b[2m"
	ansiRed     = "\x1b[31m"
	ansiGreen   = "\x1b[32m"
	ansiYellow  = "\x1b[33m"
	ansiBlue    = "\x1b[34m"
	ansiMagenta = "\x1b[35m"
	ansiCyan    = "\x1b[36m"
	ansiOrange  = "\x1b[38;5;166m"
	ansiViolet  = "\x1b[38;5;135m"
)

// Depth colors for project hierarchy (matches web UI CSS classes)
var projDepthColors = []string{
	ansiYellow, ansiOrange, ansiRed, ansiMagenta, ansiViolet, ansiBlue,
}

func col(code, s string) string {
	if noColor || s == "" {
		return s
	}
	return code + s + ansiReset
}

func initColor() {
	if os.Getenv("NO_COLOR") != "" {
		noColor = true
	}
}

// ── Options ───────────────────────────────────────────────────────────────────

type Options struct {
	Markdown bool
	File     string
	NoColor  bool
}

// ── Table rendering ───────────────────────────────────────────────────────────

type RenderOpts struct {
	Markdown       bool
	IsToday        bool
	IsNext         bool // limits apply, show checklist summary
	SuppressFooter bool
	IDOffset       int // starting display ID offset (for multi-section views)
}

// renderList renders a list of tasks as a table, updates displayMap, returns it.
func renderList(tasks []*Task, all []*Task, projects []*Project, opts RenderOpts) []string {
	if opts.Markdown {
		return renderMarkdown(tasks, all, projects, opts)
	}
	return renderANSI(tasks, all, projects, opts)
}

func renderANSI(tasks []*Task, all []*Task, projects []*Project, opts RenderOpts) []string {
	var displayMap []string

	if len(tasks) == 0 {
		if !opts.SuppressFooter {
			fmt.Println(col(ansiDim, "0 tasks shown."))
		}
		return displayMap
	}

	// Column widths
	idWidth := len(fmt.Sprintf("%d", opts.IDOffset+len(tasks)))
	if idWidth < 2 {
		idWidth = 2
	}
	urgWidth := 6
	// terminal width
	termWidth := 100
	if w := os.Getenv("COLUMNS"); w != "" {
		fmt.Sscanf(w, "%d", &termWidth)
	}
	descWidth := termWidth - idWidth - urgWidth - 4 // 4 for separators/padding

	// Header
	idHdr := padLeft("ID", idWidth)
	urgHdr := padLeft("Urg", urgWidth)
	descHdr := padRight("Description", descWidth)
	fmt.Printf("%s  %s  %s\n", col(ansiDim, idHdr), col(ansiDim, descHdr), col(ansiDim, urgHdr))

	for _, t := range tasks {
		displayMap = append(displayMap, t.UUID)
		idx := opts.IDOffset + len(displayMap)

		// ID cell
		idStr := padLeft(fmt.Sprintf("%d", idx), idWidth)

		// Urgency cell
		urgStr := fmt.Sprintf("%.1f", t.Urgency)
		urgCell := padLeft(urgStr, urgWidth)
		if t.Urgency < 0 {
			urgCell = col(ansiDim, urgCell)
		}

		// Description cell
		desc := buildDescCell(t, all, projects, opts, descWidth)

		// Row styling for active tasks
		if t.Start != nil && t.Status == "pending" {
			idStr = col(ansiCyan, idStr)
		}

		fmt.Printf("%s  %s  %s\n", idStr, desc, urgCell)
	}

	if !opts.SuppressFooter {
		fmt.Println(col(ansiDim, fmt.Sprintf("%d task(s).", len(tasks))))
	}
	return displayMap
}

func buildDescCell(t *Task, all []*Task, projects []*Project, opts RenderOpts, width int) string {
	var parts []string

	// Order badge (today view only)
	if opts.IsToday && t.Order != nil {
		parts = append(parts, col(ansiDim, fmt.Sprintf("%d", *t.Order)))
	}

	// Checklist marker
	if t.Checklist == "parent" {
		parts = append(parts, col(ansiCyan, "[cl]"))
	}

	// Description
	desc := t.Description
	if t.Priority != nil && *t.Priority >= 50 {
		desc = col(ansiBold, desc)
	}
	parts = append(parts, desc)

	// Checklist summary (next view)
	if opts.IsNext && t.Checklist == "parent" {
		done := 0
		total := 0
		for _, o := range all {
			if o.Checklist == t.UUID {
				total++
				if o.Status == "completed" {
					done++
				}
			}
		}
		parts = append(parts, col(ansiCyan, fmt.Sprintf("(%d/%d)", done, total)))
	}

	// URL indicator
	if t.URL != "" {
		parts = append(parts, col(ansiDim, "[url]"))
	}

	// Blocker count
	blocks := 0
	for _, o := range all {
		if o.Status == "pending" && containsStr(o.Depends, t.UUID) {
			blocks++
		}
	}
	if blocks > 0 {
		parts = append(parts, col(ansiYellow, fmt.Sprintf("[blocks %d]", blocks)))
	}

	// Project
	if t.Project != "" {
		parts = append(parts, formatProject(t.Project))
	}

	// Priority
	if t.Priority != nil {
		priStr := fmt.Sprintf("pri:%d", *t.Priority)
		priColor := priColor(*t.Priority)
		parts = append(parts, col(priColor, priStr))
	}

	// Due
	if t.Due != nil {
		days := daysRemaining(*t.Due)
		dueStr := fmt.Sprintf("(%dd)", days)
		if !opts.IsToday || days != 0 {
			c := ansiDim
			if days < int(cDaysWarning) {
				c = ansiRed
			} else if days < int(cDaysSoon) {
				c = ansiYellow
			}
			parts = append(parts, col(c, dueStr))
		}
	}

	// Wait (if still waiting)
	now := nowMs()
	if t.Wait != nil && *t.Wait > now {
		parts = append(parts, col(ansiDim, "wait:"+formatDate(*t.Wait)))
	}

	// Sched (if scheduled)
	if t.Sched != nil && *t.Sched > now {
		parts = append(parts, col(ansiDim, "sched:"+formatDate(*t.Sched)))
	}

	// Tags (non-virtual real tags)
	for _, tag := range t.Tags {
		if !isVirtualTagName(tag) {
			parts = append(parts, col(ansiCyan+ansiDim, "!"+tag))
		}
	}

	// Recur
	if t.Recur != "" {
		parts = append(parts, col(ansiDim, "~"+t.Recur))
	}

	// Annotation count
	if len(t.Annotations) > 0 {
		parts = append(parts, col(ansiDim, fmt.Sprintf("[%d note(s)]", len(t.Annotations))))
	}

	line := strings.Join(parts, " ")

	// Truncate if needed (strip ANSI for length calculation)
	visLen := visibleLen(line)
	if visLen > width {
		line = truncateANSI(line, width-1) + col(ansiDim, "…")
	} else {
		line = padRight(line, width) // pad visually
	}
	return line
}

func formatProject(proj string) string {
	parts := strings.Split(proj, ".")
	var colored []string
	for i, p := range parts {
		c := projDepthColors[i%len(projDepthColors)]
		colored = append(colored, col(c, p))
	}
	// dim dots
	result := strings.Join(colored, col(ansiDim, "."))
	return result
}

func priColor(pri int) string {
	if pri >= 50 {
		return ansiRed
	}
	if pri >= 25 {
		return ansiYellow
	}
	if pri >= 10 {
		return ansiGreen
	}
	return ansiDim
}

// ── Section headers ───────────────────────────────────────────────────────────

func printSectionHeader(label, colorCode string, markdown bool) {
	if markdown {
		fmt.Printf("\n### %s\n\n", label)
	} else {
		line := strings.Repeat("─", 40)
		fmt.Printf("\n%s %s %s\n\n", col(colorCode, "─── "+label), col(colorCode, line), ansiReset)
	}
}

// ── Markdown rendering ────────────────────────────────────────────────────────

func renderMarkdown(tasks []*Task, all []*Task, projects []*Project, opts RenderOpts) []string {
	var displayMap []string

	if len(tasks) == 0 {
		fmt.Println("_No tasks._")
		return displayMap
	}

	fmt.Println("| ID | Description | Project | Tags | Due | Urg |")
	fmt.Println("|----|-------------|---------|------|-----|-----|")

	for _, t := range tasks {
		displayMap = append(displayMap, t.UUID)
		idx := len(displayMap)

		dueStr := ""
		if t.Due != nil {
			dueStr = formatDateOnly(*t.Due)
		}

		tagsStr := ""
		var tagParts []string
		for _, tg := range t.Tags {
			tagParts = append(tagParts, "!"+tg)
		}
		tagsStr = strings.Join(tagParts, " ")

		desc := t.Description
		if t.Checklist == "parent" {
			desc = "[checklist] " + desc
		}
		// Append metadata inline
		if t.URL != "" {
			desc += " `[url]`"
		}
		if t.Recur != "" {
			desc += " `~" + t.Recur + "`"
		}
		if t.Priority != nil {
			desc += fmt.Sprintf(" `pri:%d`", *t.Priority)
		}

		urgStr := fmt.Sprintf("%.1f", t.Urgency)
		proj := t.Project

		// Sanitize for markdown table (escape pipes)
		desc = strings.ReplaceAll(desc, "|", "\\|")
		proj = strings.ReplaceAll(proj, "|", "\\|")

		fmt.Printf("| %d | %s | %s | %s | %s | %s |\n",
			idx, desc, proj, tagsStr, dueStr, urgStr)
	}

	if !opts.SuppressFooter {
		fmt.Printf("\n_%d task(s)._\n", len(tasks))
	}
	return displayMap
}

// ── Today sections ────────────────────────────────────────────────────────────

func renderTodaySections(all []*Task, projects []*Project, fProj string, search []string, displayMap []string, opts RenderOpts) []string {
	todayStr := formatDateOnly(nowMs())
	now := nowMs()

	// Started: active tasks not due today
	var started []*Task
	for _, t := range all {
		if t.Status != "pending" || t.Start == nil {
			continue
		}
		if t.Due != nil && formatDateOnly(*t.Due) == todayStr {
			continue
		}
		if !matchesProject(t.Project, fProj) {
			continue
		}
		if !matchesSearch(t, search) {
			continue
		}
		t.Urgency = calcUrgency(t, all, projects)
		started = append(started, t)
	}
	sortTodayTasks(started)

	// Overdue: past-due, not started
	var overdue []*Task
	for _, t := range all {
		if t.Status != "pending" || t.Due == nil {
			continue
		}
		if formatDateOnly(*t.Due) >= todayStr {
			continue
		}
		if t.Start != nil {
			continue
		}
		if t.Wait != nil && *t.Wait > now {
			continue
		}
		if t.Sched != nil && *t.Sched > now {
			continue
		}
		if !matchesProject(t.Project, fProj) {
			continue
		}
		if !matchesSearch(t, search) {
			continue
		}
		t.Urgency = calcUrgency(t, all, projects)
		overdue = append(overdue, t)
	}
	sortTodayTasks(overdue)

	// Ready: wait ended today, not due today, not started, not overdue
	var ready []*Task
	for _, t := range all {
		if t.Status != "pending" || t.Wait == nil {
			continue
		}
		if *t.Wait > now {
			continue
		}
		if formatDateOnly(*t.Wait) != todayStr {
			continue
		}
		if t.Due != nil && formatDateOnly(*t.Due) == todayStr {
			continue
		}
		if t.Start != nil {
			continue
		}
		if t.Due != nil && formatDateOnly(*t.Due) < todayStr {
			continue
		}
		if !matchesProject(t.Project, fProj) {
			continue
		}
		if !matchesSearch(t, search) {
			continue
		}
		t.Urgency = calcUrgency(t, all, projects)
		ready = append(ready, t)
	}
	sortTodayTasks(ready)

	sectionOpts := opts
	sectionOpts.SuppressFooter = true

	if len(overdue) > 0 {
		printSectionHeader("overdue", ansiRed, opts.Markdown)
		sectionOpts.IDOffset = len(displayMap)
		dm := renderList(overdue, all, projects, sectionOpts)
		displayMap = append(displayMap, dm...)
	}
	if len(started) > 0 {
		printSectionHeader("started", ansiCyan, opts.Markdown)
		sectionOpts.IDOffset = len(displayMap)
		dm := renderList(started, all, projects, sectionOpts)
		displayMap = append(displayMap, dm...)
	}
	if len(ready) > 0 {
		printSectionHeader("ready", ansiBlue, opts.Markdown)
		sectionOpts.IDOffset = len(displayMap)
		dm := renderList(ready, all, projects, sectionOpts)
		displayMap = append(displayMap, dm...)
	}

	// Combined footer
	total := len(started) + len(overdue) + len(ready)
	if total > 0 {
		var parts []string
		if len(overdue) > 0 {
			parts = append(parts, fmt.Sprintf("%d overdue", len(overdue)))
		}
		if len(started) > 0 {
			parts = append(parts, fmt.Sprintf("%d started", len(started)))
		}
		if len(ready) > 0 {
			parts = append(parts, fmt.Sprintf("%d ready", len(ready)))
		}
		summary := strings.Join(parts, " + ") + fmt.Sprintf(" = %d tasks shown", total)
		if opts.Markdown {
			fmt.Printf("\n_%s_\n", summary)
		} else {
			fmt.Println(col(ansiDim, summary))
		}
	}

	return displayMap
}

func matchesSearch(t *Task, search []string) bool {
	if len(search) == 0 {
		return true
	}
	desc := strings.ToLower(t.Description)
	for _, s := range search {
		if !strings.Contains(desc, s) {
			return false
		}
	}
	return true
}

// ── Info display ──────────────────────────────────────────────────────────────

func printInfo(t *Task, displayID int, all []*Task, projects []*Project, markdown bool) {
	urg := calcUrgency(t, all, projects)

	if markdown {
		fmt.Printf("## Task %d\n\n", displayID)
		fmt.Printf("**UUID:** `%s`  \n", t.UUID)
		fmt.Printf("**Description:** %s  \n", t.Description)
		fmt.Printf("**Status:** %s  \n", t.Status)
		if t.Project != "" {
			fmt.Printf("**Project:** %s  \n", t.Project)
		}
		if t.Priority != nil {
			fmt.Printf("**Priority:** %d  \n", *t.Priority)
		}
		if t.Order != nil {
			fmt.Printf("**Order:** %d  \n", *t.Order)
		}
		if len(t.Tags) > 0 {
			fmt.Printf("**Tags:** %s  \n", strings.Join(t.Tags, " "))
		}
		if t.Due != nil {
			fmt.Printf("**Due:** %s (%dd)  \n", formatDateOnly(*t.Due), daysRemaining(*t.Due))
		}
		if t.Wait != nil {
			fmt.Printf("**Wait:** %s  \n", formatDate(*t.Wait))
		}
		if t.Sched != nil {
			fmt.Printf("**Scheduled:** %s  \n", formatDate(*t.Sched))
		}
		if t.Recur != "" {
			fmt.Printf("**Recur:** %s  \n", t.Recur)
		}
		if t.URL != "" {
			fmt.Printf("**URL:** %s  \n", t.URL)
		}
		if t.Start != nil {
			fmt.Printf("**Started:** %s  \n", formatDate(*t.Start))
		}
		if t.End != nil {
			fmt.Printf("**Completed:** %s  \n", formatDate(*t.End))
		}
		fmt.Printf("**Urgency:** %.1f  \n", urg)
		if len(t.Depends) > 0 {
			fmt.Printf("**Depends on:** %d task(s)  \n", len(t.Depends))
		}
		if len(t.Annotations) > 0 {
			fmt.Printf("\n**Annotations:**\n\n")
			for i, a := range t.Annotations {
				fmt.Printf("%d. `%s` %s  \n", i+1, formatDate(a.Entry), a.Description)
			}
		}
		return
	}

	// ANSI
	fmt.Printf("%s %s — %s\n",
		col(ansiYellow, "Task"),
		col(ansiYellow, fmt.Sprintf("%d", displayID)),
		col(ansiDim, t.UUID))
	fmt.Printf("  %-12s %s\n", col(ansiBold, "Desc:"), t.Description)
	fmt.Printf("  %-12s %s\n", col(ansiBold, "Status:"), t.Status)
	if t.Project != "" {
		fmt.Printf("  %-12s %s\n", col(ansiBold, "Project:"), formatProject(t.Project))
	}
	if t.Priority != nil {
		fmt.Printf("  %-12s %s\n", col(ansiBold, "Priority:"), col(priColor(*t.Priority), fmt.Sprintf("%d", *t.Priority)))
	}
	if t.Order != nil {
		fmt.Printf("  %-12s %d\n", col(ansiBold, "Order:"), *t.Order)
	}
	if len(t.Tags) > 0 {
		fmt.Printf("  %-12s %s\n", col(ansiBold, "Tags:"), strings.Join(t.Tags, " "))
	}
	if t.Due != nil {
		days := daysRemaining(*t.Due)
		c := ansiDim
		if days < int(cDaysWarning) {
			c = ansiRed
		} else if days < int(cDaysSoon) {
			c = ansiYellow
		}
		fmt.Printf("  %-12s %s %s\n", col(ansiBold, "Due:"), formatDateOnly(*t.Due), col(c, fmt.Sprintf("(%dd)", days)))
	}
	if t.Wait != nil {
		fmt.Printf("  %-12s %s\n", col(ansiBold, "Wait:"), formatDate(*t.Wait))
	}
	if t.Sched != nil {
		fmt.Printf("  %-12s %s\n", col(ansiBold, "Scheduled:"), formatDate(*t.Sched))
	}
	if t.Recur != "" {
		fmt.Printf("  %-12s %s\n", col(ansiBold, "Recur:"), t.Recur)
	}
	if t.URL != "" {
		fmt.Printf("  %-12s %s\n", col(ansiBold, "URL:"), t.URL)
	}
	if t.Target != "" {
		fmt.Printf("  %-12s x:%s\n", col(ansiBold, "Target:"), t.Target)
	}
	if t.OnDone != "" {
		fmt.Printf("  %-12s %s\n", col(ansiBold, "On done:"), t.OnDone)
	}
	if t.Start != nil {
		fmt.Printf("  %-12s %s\n", col(ansiBold, "Started:"), formatDate(*t.Start))
	}
	if t.Touches > 0 {
		fmt.Printf("  %-12s %d\n", col(ansiBold, "Touches:"), t.Touches)
	}
	if t.End != nil {
		fmt.Printf("  %-12s %s\n", col(ansiBold, "Completed:"), formatDate(*t.End))
	}
	fmt.Printf("  %-12s %.1f\n", col(ansiBold, "Urgency:"), urg)
	if len(t.Depends) > 0 {
		fmt.Printf("  %-12s %d task(s)\n", col(ansiBold, "Depends:"), len(t.Depends))
	}
	if t.Checklist != "" {
		if t.Checklist == "parent" {
			fmt.Printf("  %-12s %s\n", col(ansiBold, "Checklist:"), "parent")
		} else {
			fmt.Printf("  %-12s %s\n", col(ansiBold, "Checklist:"), "member")
		}
	}
	if len(t.Annotations) > 0 {
		fmt.Printf("  %s\n", col(ansiBold, "Annotations:"))
		for i, a := range t.Annotations {
			fmt.Printf("    %s %s: %s\n",
				col(ansiDim, fmt.Sprintf("%d.", i+1)),
				col(ansiDim, formatDate(a.Entry)),
				a.Description)
		}
	}
	if len(t.Track) > 0 {
		fmt.Printf("  %s\n", col(ansiBold, "Tracking:"))
		for _, tr := range t.Track {
			val := "worked"
			if tr.Type == "pct" && tr.Value != nil {
				val = fmt.Sprintf("%d%%", *tr.Value)
			} else if tr.Type == "min" && tr.Value != nil {
				val = fmt.Sprintf("%dm", *tr.Value)
			}
			fmt.Printf("    %s %s\n", col(ansiDim, formatDate(tr.Entry)+"  "), val)
		}
	}
}

// ── Project info ──────────────────────────────────────────────────────────────

func printProjectInfo(p *Project, name string, store *Store, markdown bool) {
	taskCount := 0
	for _, t := range store.Tasks {
		if t.Status == "pending" && t.Project == name {
			taskCount++
		}
	}

	if markdown {
		fmt.Printf("## Project: %s\n\n", name)
		if p != nil && p.Icon != "" {
			fmt.Printf("**Icon:** %s  \n", p.Icon)
		}
		if p != nil && len(p.Tags) > 0 {
			fmt.Printf("**Tags:** %s  \n", strings.Join(p.Tags, " "))
		}
		if p != nil && len(p.Banners) > 0 {
			fmt.Printf("**Banners:** %d  \n", len(p.Banners))
			for i, b := range p.Banners {
				fmt.Printf("  %d. %s  \n", i+1, b)
			}
			fmt.Printf("**Banner style:** %s  \n", p.BannerStyle)
		}
		fmt.Printf("**Pending tasks:** %d  \n", taskCount)
		if p != nil && len(p.Annotations) > 0 {
			fmt.Printf("\n**Annotations:**\n\n")
			for i, a := range p.Annotations {
				fmt.Printf("%d. `%s` %s  \n", i+1, formatDate(a.Entry), a.Description)
			}
		}
		return
	}

	// ANSI
	fmt.Printf("%s %s\n", col(ansiYellow, "Project:"), formatProject(name))
	if p != nil && p.Icon != "" {
		fmt.Printf("  %-12s %s\n", col(ansiBold, "Icon:"), p.Icon)
	}
	if p != nil && len(p.Tags) > 0 {
		fmt.Printf("  %-12s %s\n", col(ansiBold, "Tags:"), strings.Join(p.Tags, " "))
	}
	if p != nil && len(p.Banners) > 0 {
		fmt.Printf("  %-12s %d banner(s)\n", col(ansiBold, "Banners:"), len(p.Banners))
		for i, b := range p.Banners {
			fmt.Printf("    %s %s\n", col(ansiDim, fmt.Sprintf("%d.", i+1)), b)
		}
		if p.BannerStyle != "" {
			fmt.Printf("  %-12s %s\n", col(ansiBold, "Style:"), p.BannerStyle)
		}
	}
	fmt.Printf("  %-12s %d\n", col(ansiBold, "Pending:"), taskCount)
	if p != nil && len(p.Annotations) > 0 {
		fmt.Printf("  %s\n", col(ansiBold, "Annotations:"))
		for i, a := range p.Annotations {
			fmt.Printf("    %s %s: %s\n",
				col(ansiDim, fmt.Sprintf("%d.", i+1)),
				col(ansiDim, formatDate(a.Entry)),
				a.Description)
		}
	}
}

// ── Chain / dependency tree ───────────────────────────────────────────────────

func printChain(t *Task, all []*Task, displayMap []string, markdown bool) {
	if markdown {
		fmt.Printf("## Dependency Tree for Task %d\n\n", displayIDOf(t.UUID, displayMap))
	} else {
		fmt.Printf("%s %s\n\n", col(ansiYellow, "Chain:"), t.Description)
	}

	// What t depends on (blockers)
	if len(t.Depends) > 0 {
		if markdown {
			fmt.Print("**Depends on:**\n\n")
		} else {
			fmt.Println(col(ansiBold, "Depends on:"))
		}
		for _, depUUID := range t.Depends {
			dep := findTaskIn(all, depUUID)
			if dep == nil {
				continue
			}
			id := displayIDOf(depUUID, displayMap)
			status := ""
			if dep.Status == "completed" {
				status = " ✓"
			} else if dep.Status == "skipped" {
				status = " ⊘"
			}
			if markdown {
				fmt.Printf("- [%d] %s%s\n", id, dep.Description, status)
			} else {
				fmt.Printf("  %s %s%s\n",
					col(ansiDim, fmt.Sprintf("%d", id)),
					dep.Description,
					col(ansiGreen, status))
			}
		}
		fmt.Println()
	}

	// What t blocks (tasks depending on t)
	var blocks []*Task
	for _, o := range all {
		if containsStr(o.Depends, t.UUID) {
			blocks = append(blocks, o)
		}
	}
	if len(blocks) > 0 {
		if markdown {
			fmt.Print("**Blocks:**\n\n")
		} else {
			fmt.Println(col(ansiBold, "Blocks:"))
		}
		printBlockTree(blocks, all, displayMap, 0, markdown)
	}
}

func printBlockTree(tasks []*Task, all []*Task, displayMap []string, depth int, markdown bool) {
	for _, t := range tasks {
		id := displayIDOf(t.UUID, displayMap)
		indent := strings.Repeat("  ", depth)
		prefix := "└─"
		if depth == 0 {
			prefix = "  "
		}
		status := ""
		if t.Status != "pending" {
			status = " (" + t.Status + ")"
		}
		if markdown {
			mdIndent := strings.Repeat("  ", depth)
			fmt.Printf("%s- [%d] %s%s\n", mdIndent, id, t.Description, status)
		} else {
			fmt.Printf("%s%s %s %s%s\n",
				indent, col(ansiDim, prefix),
				col(ansiDim, fmt.Sprintf("%d", id)),
				t.Description,
				col(ansiDim, status))
		}
		// Recurse: who depends on t?
		var nextBlocks []*Task
		for _, o := range all {
			if containsStr(o.Depends, t.UUID) {
				nextBlocks = append(nextBlocks, o)
			}
		}
		if len(nextBlocks) > 0 {
			printBlockTree(nextBlocks, all, displayMap, depth+1, markdown)
		}
	}
}

func displayIDOf(uuid string, displayMap []string) int {
	for i, u := range displayMap {
		if u == uuid {
			return i + 1
		}
	}
	return 0
}

// ── Projects ──────────────────────────────────────────────────────────────────

func printProjects(store *Store, markdown bool) {
	// Count pending tasks per project
	counts := map[string]int{}
	for _, t := range store.Tasks {
		if t.Status == "pending" && t.Project != "" {
			counts[t.Project]++
		}
	}

	// Collect all project names (from tasks + metadata)
	seen := map[string]bool{}
	var names []string
	for _, t := range store.Tasks {
		if t.Project != "" && !seen[t.Project] {
			seen[t.Project] = true
			names = append(names, t.Project)
		}
	}
	// Sort
	for i := 1; i < len(names); i++ {
		for j := i; j > 0 && names[j] < names[j-1]; j-- {
			names[j], names[j-1] = names[j-1], names[j]
		}
	}

	if markdown {
		fmt.Println("| Project | Tasks | Tags |")
		fmt.Println("|---------|-------|------|")
		for _, name := range names {
			p := findProject(store, name)
			tags := ""
			if p != nil {
				var ts []string
				for _, tg := range p.Tags {
					ts = append(ts, "!"+tg)
				}
				tags = strings.Join(ts, " ")
			}
			fmt.Printf("| %s | %d | %s |\n", name, counts[name], tags)
		}
	} else {
		fmt.Printf("%-30s  %5s  %s\n", col(ansiDim, "Project"), col(ansiDim, "Tasks"), col(ansiDim, "Tags"))
		for _, name := range names {
			p := findProject(store, name)
			tags := ""
			if p != nil {
				var ts []string
				for _, tg := range p.Tags {
					ts = append(ts, "!"+tg)
				}
				tags = col(ansiDim, strings.Join(ts, " "))
			}
			fmt.Printf("%-30s  %5d  %s\n", formatProject(name), counts[name], tags)
		}
		fmt.Printf(col(ansiDim, "\n%d project(s).\n"), len(names))
	}
}

// ── Calendar ──────────────────────────────────────────────────────────────────

func printCalendar(tasks []*Task, all []*Task, projects []*Project, days int, markdown bool) []string {
	var displayMap []string

	now := time.Now()
	todayStr := formatDateOnly(now.UnixMilli())

	// Collect date → tasks map
	type dateEntry struct {
		task   *Task
		marker string // "due", "sched", "wait"
	}
	byDate := map[string][]dateEntry{}

	// Include overdue from past 7 days
	pastStart := now.AddDate(0, 0, -7)
	futureEnd := now.AddDate(0, 0, days)

	for _, t := range tasks {
		if t.Due != nil {
			ds := formatDateOnly(*t.Due)
			d := time.UnixMilli(*t.Due)
			if (d.After(pastStart) || ds == todayStr) && d.Before(futureEnd) {
				byDate[ds] = append(byDate[ds], dateEntry{t, "due"})
			}
		}
		if t.Sched != nil {
			ds := formatDateOnly(*t.Sched)
			d := time.UnixMilli(*t.Sched)
			if d.After(pastStart) && d.Before(futureEnd) {
				byDate[ds] = append(byDate[ds], dateEntry{t, "sched"})
			}
		}
		if t.Wait != nil {
			ds := formatDateOnly(*t.Wait)
			d := time.UnixMilli(*t.Wait)
			if d.After(pastStart) && d.Before(futureEnd) {
				byDate[ds] = append(byDate[ds], dateEntry{t, "wait"})
			}
		}
	}

	// Collect sorted date strings
	var dates []string
	seen := map[string]bool{}

	// Past 7 days + future days
	for i := -7; i <= days; i++ {
		ds := formatDateOnly(now.AddDate(0, 0, i).UnixMilli())
		if !seen[ds] && len(byDate[ds]) > 0 {
			seen[ds] = true
			dates = append(dates, ds)
		}
	}
	// Sort dates
	for i := 1; i < len(dates); i++ {
		for j := i; j > 0 && dates[j] < dates[j-1]; j-- {
			dates[j], dates[j-1] = dates[j-1], dates[j]
		}
	}

	dayNames := []string{"Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"}

	for _, ds := range dates {
		entries := byDate[ds]
		if len(entries) == 0 {
			continue
		}

		// Parse date for weekday
		var y, m, d int
		fmt.Sscanf(ds, "%4d%2d%2d", &y, &m, &d)
		t := time.Date(y, time.Month(m), d, 0, 0, 0, 0, time.Local)
		wd := dayNames[t.Weekday()]

		isPast := ds < todayStr
		isToday := ds == todayStr

		if markdown {
			marker := ""
			if isToday {
				marker = " *(today)*"
			} else if isPast {
				marker = " *(overdue)*"
			}
			fmt.Printf("\n### %s  %s%s\n\n", ds, wd, marker)
		} else {
			dateColor := ansiDim
			if isToday {
				dateColor = ansiCyan
			} else if isPast {
				dateColor = ansiRed
			}
			fmt.Printf("\n%s  %s\n", col(dateColor, ds), col(ansiDim, wd))
		}

		for _, e := range entries {
			t := e.task
			// Calc urgency
			t.Urgency = calcUrgency(t, all, projects)
			displayMap = append(displayMap, t.UUID)
			id := len(displayMap)

			marker := "[" + e.marker + "]"
			urgStr := fmt.Sprintf("%.1f", t.Urgency)

			if markdown {
				proj := ""
				if t.Project != "" {
					proj = " `" + t.Project + "`"
				}
				fmt.Printf("| %d | %s `%s`%s | %s |\n", id, t.Description, marker, proj, urgStr)
			} else {
				markerC := ansiDim
				switch e.marker {
				case "due":
					markerC = ansiYellow
				case "sched":
					markerC = ansiBlue
				}
				proj := ""
				if t.Project != "" {
					proj = " " + formatProject(t.Project)
				}
				fmt.Printf("  %s  %s %s%s  %s\n",
					col(ansiDim, fmt.Sprintf("%3d", id)),
					t.Description,
					col(markerC, marker),
					proj,
					col(ansiDim, urgStr))
			}
		}
	}

	fmt.Println()
	return displayMap
}

// ── Reports ───────────────────────────────────────────────────────────────────

func reportStale(store *Store, markdown bool) {
	now := nowMs()

	type projActivity struct {
		name     string
		lastMs   int64
		isRef    bool
	}

	// Find last activity per project
	activity := map[string]int64{}
	for _, t := range store.Tasks {
		if t.Project == "" {
			continue
		}
		updateMax := func(ms int64) {
			if ms > activity[t.Project] {
				activity[t.Project] = ms
			}
		}
		updateMax(t.Entry)
		if t.End != nil {
			updateMax(*t.End)
		}
		if t.Start != nil {
			updateMax(*t.Start)
		}
	}

	var projs []projActivity
	for name, lastMs := range activity {
		p := findProject(store, name)
		if isRefProject(p) {
			continue
		}
		projs = append(projs, projActivity{name, lastMs, false})
	}

	// Sort by lastMs asc (stalest first)
	for i := 1; i < len(projs); i++ {
		for j := i; j > 0 && projs[j].lastMs < projs[j-1].lastMs; j-- {
			projs[j], projs[j-1] = projs[j-1], projs[j]
		}
	}

	if markdown {
		fmt.Print("## Stale Projects\n\n")
		fmt.Println("| Project | Last Activity | Days |")
		fmt.Println("|---------|--------------|------|")
		for _, p := range projs {
			days := int(math.Floor(float64(now-p.lastMs) / (1000 * 60 * 60 * 24)))
			fmt.Printf("| %s | %s | %d |\n", p.name, formatDateOnly(p.lastMs), days)
		}
	} else {
		fmt.Printf("%-30s  %-12s  %s\n", col(ansiDim, "Project"), col(ansiDim, "Last activity"), col(ansiDim, "Days"))
		for _, p := range projs {
			days := int(math.Floor(float64(now-p.lastMs) / (1000 * 60 * 60 * 24)))
			c := ""
			if days > 30 {
				c = ansiRed
			} else if days > 14 {
				c = ansiYellow
			}
			daysStr := col(c, fmt.Sprintf("%d", days))
			fmt.Printf("%-30s  %-12s  %s\n", formatProject(p.name), col(ansiDim, formatDateOnly(p.lastMs)), daysStr)
		}
	}
}

func reportRot(store *Store, n int, markdown bool) {
	now := nowMs()
	var pending []*Task
	for _, t := range store.Tasks {
		if t.Status == "pending" {
			pending = append(pending, t)
		}
	}
	// Sort by entry asc (oldest first)
	for i := 1; i < len(pending); i++ {
		for j := i; j > 0 && pending[j].Entry < pending[j-1].Entry; j-- {
			pending[j], pending[j-1] = pending[j-1], pending[j]
		}
	}
	if n > len(pending) {
		n = len(pending)
	}
	oldest := pending[:n]

	// Age summary
	var lt30, lt90, gt90 int
	for _, t := range pending {
		days := int(float64(now-t.Entry) / (1000 * 60 * 60 * 24))
		if days >= 90 {
			gt90++
		} else if days >= 30 {
			lt90++
		} else {
			lt30++
		}
	}

	if markdown {
		fmt.Printf("## Oldest %d Tasks\n\n", n)
		fmt.Printf("_Age distribution: <30d: %d  30–90d: %d  >90d: %d_\n\n", lt30, lt90, gt90)
		fmt.Println("| ID | Description | Age |")
		fmt.Println("|----|-------------|-----|")
		for i, t := range oldest {
			days := int(float64(now-t.Entry) / (1000 * 60 * 60 * 24))
			fmt.Printf("| %d | %s | %dd |\n", i+1, t.Description, days)
		}
	} else {
		fmt.Printf(col(ansiDim, "Age distribution: <30d: %d  30–90d: %d  >90d: %d\n\n"), lt30, lt90, gt90)
		fmt.Printf("%-4s  %-50s  %s\n", col(ansiDim, "Rank"), col(ansiDim, "Description"), col(ansiDim, "Age"))
		for i, t := range oldest {
			days := int(float64(now-t.Entry) / (1000 * 60 * 60 * 24))
			c := ""
			if days >= 90 {
				c = ansiRed
			} else if days >= 30 {
				c = ansiYellow
			}
			ageStr := col(c, fmt.Sprintf("%dd", days))
			desc := t.Description
			if len(desc) > 50 {
				desc = desc[:49] + "…"
			}
			fmt.Printf("%-4d  %-50s  %s\n", i+1, desc, ageStr)
		}
	}
}

func reportDone(store *Store, period string, groupBy string, markdown bool) {
	cutoff := parseRelativeTime(period)
	if cutoff == nil {
		v := time.Now().Add(-7 * 24 * time.Hour).UnixMilli()
		cutoff = &v
	}

	var done []*Task
	for _, t := range store.Tasks {
		if t.Status == "completed" && t.End != nil && *t.End >= *cutoff {
			done = append(done, t)
		}
	}

	// Group
	groups := map[string][]*Task{}
	var groupOrder []string
	seenGroup := map[string]bool{}

	addGroup := func(key string, t *Task) {
		groups[key] = append(groups[key], t)
		if !seenGroup[key] {
			seenGroup[key] = true
			groupOrder = append(groupOrder, key)
		}
	}

	for _, t := range done {
		if groupBy == "tag" {
			if len(t.Tags) == 0 {
				addGroup("(untagged)", t)
			} else {
				for _, tag := range t.Tags {
					addGroup(tag, t)
				}
			}
		} else {
			key := t.Project
			if key == "" {
				key = "(no project)"
			}
			addGroup(key, t)
		}
	}

	// Sort group keys alphabetically
	for i := 1; i < len(groupOrder); i++ {
		for j := i; j > 0 && groupOrder[j] < groupOrder[j-1]; j-- {
			groupOrder[j], groupOrder[j-1] = groupOrder[j-1], groupOrder[j]
		}
	}

	if markdown {
		fmt.Printf("## Done (%s)\n\n", period)
		for _, g := range groupOrder {
			tasks := groups[g]
			fmt.Printf("### %s (%d)\n\n", g, len(tasks))
			for _, t := range tasks {
				fmt.Printf("- %s\n", t.Description)
			}
			fmt.Println()
		}
	} else {
		for _, g := range groupOrder {
			tasks := groups[g]
			fmt.Printf("\n%s %s\n", col(ansiYellow, g), col(ansiDim, fmt.Sprintf("(%d)", len(tasks))))
			for _, t := range tasks {
				fmt.Printf("  %s %s\n", col(ansiGreen, "✓"), t.Description)
			}
		}
	}
}

// ── Utilities ─────────────────────────────────────────────────────────────────

func padLeft(s string, w int) string {
	v := visibleLen(s)
	if v >= w {
		return s
	}
	return strings.Repeat(" ", w-v) + s
}

func padRight(s string, w int) string {
	v := visibleLen(s)
	if v >= w {
		return s
	}
	return s + strings.Repeat(" ", w-v)
}

// visibleLen returns the display length of a string, ignoring ANSI escape codes.
func visibleLen(s string) int {
	n := 0
	inEscape := false
	for i := 0; i < len(s); i++ {
		if s[i] == '\x1b' {
			inEscape = true
			continue
		}
		if inEscape {
			if (s[i] >= 'a' && s[i] <= 'z') || (s[i] >= 'A' && s[i] <= 'Z') {
				inEscape = false
			}
			continue
		}
		n++
	}
	return n
}

// truncateANSI truncates a string to maxVisible visible characters, preserving ANSI codes.
func truncateANSI(s string, maxVisible int) string {
	visible := 0
	var out strings.Builder
	inEscape := false
	for i := 0; i < len(s); i++ {
		if s[i] == '\x1b' {
			inEscape = true
			out.WriteByte(s[i])
			continue
		}
		if inEscape {
			out.WriteByte(s[i])
			if (s[i] >= 'a' && s[i] <= 'z') || (s[i] >= 'A' && s[i] <= 'Z') {
				inEscape = false
			}
			continue
		}
		if visible >= maxVisible {
			break
		}
		out.WriteByte(s[i])
		visible++
	}
	if !noColor {
		out.WriteString(ansiReset)
	}
	return out.String()
}

var virtualTagNames = map[string]bool{
	"someday": true, "routine": true, "next": true, "reference": true, "ref": true,
}

func isVirtualTagName(tag string) bool {
	return virtualTagNames[strings.ToLower(tag)]
}
