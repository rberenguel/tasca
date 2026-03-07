package main

import (
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"
)

// ── Urgency ───────────────────────────────────────────────────────────────────

const (
	cNext          = 15.0
	cDue           = 12.0
	cBlocking      = 8.0
	cActive        = 4.0
	cBlocked       = -20.0
	cPriorityScale = 0.12
	cAge           = 2.0
	cProject       = 1.0
	cSomeday       = -100.0
	cReference     = -100.0
	cRoutine       = -10.0
	cOverdueScale  = 1.5
	cAgeThreshold  = 100.0
	cDaysWarning   = 2.0
	cDaysSoon      = 7.0
)

func calcUrgency(t *Task, all []*Task, projects []*Project) float64 {
	now := nowMs()

	if t.Wait != nil && *t.Wait > now {
		return -10.0
	}

	priContrib := 0.0
	if t.Priority != nil {
		priContrib = float64(*t.Priority) * cPriorityScale
	}

	if hasTag(t, "someday") {
		return cSomeday + priContrib
	}

	if t.Project != "" {
		p := findProject(&Store{Projects: projects}, t.Project)
		if isRefProject(p) {
			return cReference + priContrib
		}
	}

	u := 0.0

	if hasTag(t, "next") {
		u += cNext
	}
	if t.Start != nil {
		u += cActive
	}
	if t.Priority != nil {
		u += float64(*t.Priority) * cPriorityScale
	}
	if t.Project != "" {
		u += cProject
	}

	ageDays := float64(now-t.Entry) / (1000 * 60 * 60 * 24)
	if ageDays > cAgeThreshold {
		u += cAge
	} else {
		u += (ageDays / cAgeThreshold) * cAge
	}

	if t.Due != nil {
		daysLeft := float64(*t.Due-now) / (1000 * 60 * 60 * 24)
		if daysLeft < 0 {
			u += cDue + math.Abs(daysLeft)*cOverdueScale
		} else if daysLeft <= cDaysWarning {
			u += cDue
		} else if daysLeft <= 14 {
			u += cDue * (1 - (daysLeft-cDaysWarning)/12)
		}
	}

	// blocking: does any pending task depend on t?
	for _, o := range all {
		if o.Status == "pending" && containsStr(o.Depends, t.UUID) {
			u += cBlocking
			break
		}
	}

	// blocked: does t depend on any pending task?
	if len(t.Depends) > 0 {
		for _, depUUID := range t.Depends {
			dep := findTaskIn(all, depUUID)
			if dep != nil && dep.Status == "pending" {
				u += cBlocked
				break
			}
		}
	}

	if hasTag(t, "routine") {
		u += cRoutine
	}

	return math.Round(u*10) / 10
}

func findTaskIn(all []*Task, uuid string) *Task {
	for _, t := range all {
		if t.UUID == uuid {
			return t
		}
	}
	return nil
}

func containsStr(ss []string, s string) bool {
	for _, v := range ss {
		if v == s {
			return true
		}
	}
	return false
}

// ── Virtual tags ──────────────────────────────────────────────────────────────

var virtualTagShorthands = map[string]string{
	"O": "overdue", "OD": "overdue", "OVER": "overdue",
	"T": "today", "TOD": "today",
	"W": "waiting", "WAIT": "waiting",
	"S": "scheduled", "SCH": "scheduled", "SCHED": "scheduled",
	"B": "blocked", "BLK": "blocked", "BLOCK": "blocked",
	"D": "done",
	"A": "active", "ACT": "active",
	"R": "recurring", "REC": "recurring", "RECUR": "recurring",
	"SD": "someday",
	"RT": "routine",
	"M": "modified", "MOD": "modified",
	"CL": "checklist",
	"SK": "skipped", "SKIPPED": "skipped",
	"END": "ended", "ENDED": "ended",
}

func expandVirtualTag(tag string) string {
	raw := strings.TrimPrefix(strings.TrimPrefix(tag, "!"), "+")
	up := strings.ToUpper(raw)
	if expanded, ok := virtualTagShorthands[up]; ok {
		prefix := ""
		if strings.HasPrefix(tag, "!") {
			prefix = "!"
		} else if strings.HasPrefix(tag, "+") {
			prefix = "+"
		}
		return prefix + expanded
	}
	return tag
}

func hasVirtualTag(t *Task, tag string, all []*Task, projects []*Project) bool {
	now := nowMs()
	clean := strings.ToUpper(strings.TrimPrefix(strings.TrimPrefix(tag, "!"), "+"))

	switch clean {
	case "OVERDUE":
		return t.Due != nil && *t.Due < now && t.Status == "pending"
	case "TODAY":
		todayStr := formatDateOnly(now)
		todayDue := t.Due != nil && formatDateOnly(*t.Due) == todayStr
		todayEnd := t.End != nil && formatDateOnly(*t.End) == todayStr
		return todayDue || todayEnd
	case "WAITING":
		return t.Wait != nil && *t.Wait > now && t.Status == "pending"
	case "SCHEDULED":
		return t.Sched != nil && *t.Sched > now && t.Status == "pending"
	case "BLOCKED":
		if len(t.Depends) == 0 {
			return false
		}
		for _, depUUID := range t.Depends {
			dep := findTaskIn(all, depUUID)
			if dep != nil && dep.Status == "pending" {
				return true
			}
		}
		return false
	case "DONE", "COMPLETED":
		return t.Status == "completed"
	case "ACTIVE", "STARTED":
		return t.Start != nil && t.Status == "pending"
	case "RECURRING", "RECUR":
		return t.Recur != "" && t.Status == "pending"
	case "SOMEDAY":
		return hasTag(t, "someday")
	case "ROUTINE":
		return hasTag(t, "routine")
	case "REF", "REFS", "REFERENCE", "REFERENCES":
		if t.Project == "" || len(projects) == 0 {
			return false
		}
		p := findProject(&Store{Projects: projects}, t.Project)
		return isRefProject(p)
	case "CHECKLIST":
		return t.Checklist != ""
	case "SKIPPED":
		return t.Status == "skipped"
	case "ENDED":
		return t.Status == "completed" || t.Status == "skipped"
	case "ALL":
		return true
	}
	return false
}

// ── Date parsing ──────────────────────────────────────────────────────────────

func endOfDay(t time.Time) int64 {
	y, m, d := t.Date()
	loc := t.Location()
	return time.Date(y, m, d, 23, 59, 59, 999000000, loc).UnixMilli()
}

func parseDate(s string) *int64 {
	if s == "" {
		return nil
	}
	low := strings.ToLower(s)
	now := time.Now()

	switch low {
	case "today", "tod":
		v := endOfDay(now)
		return &v
	case "tomorrow", "tom":
		v := endOfDay(now.AddDate(0, 0, 1))
		return &v
	case "yesterday":
		v := endOfDay(now.AddDate(0, 0, -1))
		return &v
	}

	// Named days
	dayNames := []string{"sun", "mon", "tue", "wed", "thu", "fri", "sat"}
	for i, name := range dayNames {
		if low == name {
			today := int(now.Weekday())
			diff := i - today
			if diff <= 0 {
				diff += 7
			}
			v := endOfDay(now.AddDate(0, 0, diff))
			return &v
		}
	}

	// Nh - hours
	if strings.HasSuffix(low, "h") {
		n, err := strconv.Atoi(low[:len(low)-1])
		if err == nil && n > 0 {
			v := now.Add(time.Duration(n) * time.Hour).UnixMilli()
			return &v
		}
	}

	// Nd, Nw, Nm
	if len(low) >= 2 {
		unit := low[len(low)-1]
		n, err := strconv.Atoi(low[:len(low)-1])
		if err == nil && n > 0 {
			var d time.Time
			switch unit {
			case 'd':
				d = now.AddDate(0, 0, n)
				v := endOfDay(d)
				return &v
			case 'w':
				d = now.AddDate(0, 0, n*7)
				v := endOfDay(d)
				return &v
			case 'm':
				d = now.AddDate(0, n, 0)
				v := endOfDay(d)
				return &v
			}
		}
	}

	// HH:MM
	if len(s) == 5 && s[2] == ':' {
		h, err1 := strconv.Atoi(s[0:2])
		m, err2 := strconv.Atoi(s[3:5])
		if err1 == nil && err2 == nil && h >= 0 && h <= 23 && m >= 0 && m <= 59 {
			target := time.Date(now.Year(), now.Month(), now.Day(), h, m, 0, 0, now.Location())
			if !target.After(now) {
				target = target.AddDate(0, 0, 1)
			}
			v := target.UnixMilli()
			return &v
		}
	}

	// date@HH:MM
	if idx := strings.Index(s, "@"); idx > 0 {
		datePart := s[:idx]
		timePart := s[idx+1:]
		base := parseDate(datePart)
		if base != nil && len(timePart) == 5 && timePart[2] == ':' {
			h, err1 := strconv.Atoi(timePart[0:2])
			m, err2 := strconv.Atoi(timePart[3:5])
			if err1 == nil && err2 == nil && h >= 0 && h <= 23 && m >= 0 && m <= 59 {
				baseTime := time.UnixMilli(*base)
				target := time.Date(baseTime.Year(), baseTime.Month(), baseTime.Day(), h, m, 0, 0, baseTime.Location())
				v := target.UnixMilli()
				return &v
			}
		}
	}

	// YYYYMMDD
	if len(s) == 8 {
		y, err1 := strconv.Atoi(s[0:4])
		m, err2 := strconv.Atoi(s[4:6])
		d, err3 := strconv.Atoi(s[6:8])
		if err1 == nil && err2 == nil && err3 == nil {
			v := endOfDay(time.Date(y, time.Month(m), d, 0, 0, 0, 0, time.Local))
			return &v
		}
	}

	return nil
}

func parseWaitTime(s string) *WaitTime {
	if len(s) == 5 && s[2] == ':' {
		h, err1 := strconv.Atoi(s[0:2])
		m, err2 := strconv.Atoi(s[3:5])
		if err1 == nil && err2 == nil && h >= 0 && h <= 23 && m >= 0 && m <= 59 {
			return &WaitTime{Hours: h, Minutes: m}
		}
	}
	return nil
}

func parseRelativeTime(s string) *int64 {
	low := strings.ToLower(s)
	if low == "today" {
		now := time.Now()
		v := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location()).UnixMilli()
		return &v
	}
	if len(low) < 2 {
		return nil
	}
	unit := low[len(low)-1]
	n, err := strconv.Atoi(low[:len(low)-1])
	if err != nil || n < 0 {
		return nil
	}
	now := time.Now()
	start := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	var v int64
	switch unit {
	case 'd':
		v = start.Add(-time.Duration(n) * 24 * time.Hour).UnixMilli()
	case 'w':
		v = start.Add(-time.Duration(n) * 7 * 24 * time.Hour).UnixMilli()
	case 'm':
		v = start.AddDate(0, -n, 0).UnixMilli()
	default:
		return nil
	}
	return &v
}

// ── Date formatting ───────────────────────────────────────────────────────────

func formatDateOnly(ms int64) string {
	t := time.UnixMilli(ms)
	return fmt.Sprintf("%04d%02d%02d", t.Year(), t.Month(), t.Day())
}

func formatDate(ms int64) string {
	t := time.UnixMilli(ms)
	dateStr := fmt.Sprintf("%04d%02d%02d", t.Year(), t.Month(), t.Day())
	h, m, sec := t.Hour(), t.Minute(), t.Second()
	if h == 23 && m == 59 && sec == 59 {
		return dateStr
	}
	return fmt.Sprintf("%s@%02d:%02d", dateStr, h, m)
}

func daysRemaining(dueMs int64) int {
	now := time.Now().UnixMilli()
	return int(math.Floor(float64(dueMs-now) / (1000 * 60 * 60 * 24)))
}

// ── Recurrence ────────────────────────────────────────────────────────────────

type Recurrence struct {
	NextDue   int64
	NextWait  *int64
	NextSched *int64
	WaitTime  *WaitTime
}

func calcNextRecurrence(t *Task) *Recurrence {
	if t.Recur == "" || t.Due == nil {
		return nil
	}
	recur := strings.ToLower(t.Recur)
	var nextDue int64

	// Nd, Nw, Nm, Ny
	if len(recur) >= 2 {
		unit := recur[len(recur)-1]
		n, err := strconv.Atoi(recur[:len(recur)-1])
		if err == nil && n > 0 {
			base := time.UnixMilli(*t.Due)
			switch unit {
			case 'd':
				nextDue = base.AddDate(0, 0, n).UnixMilli()
			case 'w':
				nextDue = base.AddDate(0, 0, n*7).UnixMilli()
			case 'm':
				nextDue = base.AddDate(0, n, 0).UnixMilli()
			case 'y':
				nextDue = base.AddDate(n, 0, 0).UnixMilli()
			}
		}
	}
	// Legacy
	if nextDue == 0 {
		base := time.UnixMilli(*t.Due)
		switch {
		case strings.HasPrefix(recur, "dai"):
			nextDue = base.AddDate(0, 0, 1).UnixMilli()
		case strings.HasPrefix(recur, "wee"):
			nextDue = base.AddDate(0, 0, 7).UnixMilli()
		case strings.HasPrefix(recur, "mon"):
			nextDue = base.AddDate(0, 1, 0).UnixMilli()
		case strings.HasPrefix(recur, "yea"):
			nextDue = base.AddDate(1, 0, 0).UnixMilli()
		}
	}
	if nextDue == 0 {
		return nil
	}

	r := &Recurrence{NextDue: nextDue}

	if t.WaitTime != nil {
		nextDueTime := time.UnixMilli(nextDue)
		wt := time.Date(nextDueTime.Year(), nextDueTime.Month(), nextDueTime.Day(),
			t.WaitTime.Hours, t.WaitTime.Minutes, 0, 0, nextDueTime.Location())
		wv := wt.UnixMilli()
		r.NextWait = &wv
		r.WaitTime = t.WaitTime
	} else if t.Wait != nil {
		offset := nextDue - (*t.Due - *t.Wait)
		r.NextWait = &offset
	}

	if t.Sched != nil {
		offset := nextDue - (*t.Due - *t.Sched)
		r.NextSched = &offset
	}

	return r
}

// ── Filter & sorting ──────────────────────────────────────────────────────────

type Filter struct {
	Project    string
	Target     string
	Tags       []string // expanded virtual or real tags, with "!" prefix
	Search     []string // text terms
	EndAfter   *int64
	SortFields []string
	ShowDone   bool
	ShowWaiting bool
	ShowSkipped bool
	IsToday    bool
	IsAll      bool
}

func parseFilters(args []string) Filter {
	var f Filter
	for _, token := range args {
		lo := strings.ToLower(token)
		switch {
		case lo == "!all":
			f.IsAll = true
			f.ShowWaiting = true
			f.ShowDone = true
			f.ShowSkipped = true
		case strings.HasPrefix(token, "p:") ||
			strings.HasPrefix(token, "pro:") ||
			strings.HasPrefix(token, "proj:") ||
			strings.HasPrefix(token, "project:"):
			f.Project = token[strings.Index(token, ":")+1:]
		case strings.HasPrefix(token, "x:") || strings.HasPrefix(token, "target:"):
			f.Target = token[strings.Index(token, ":")+1:]
		case strings.HasPrefix(token, "end:"):
			val := token[4:]
			f.EndAfter = parseRelativeTime(val)
		case strings.HasPrefix(token, "sort:") || strings.HasPrefix(token, "s:"):
			f.SortFields = strings.Split(token[strings.Index(token, ":")+1:], ",")
		case strings.HasPrefix(token, "lim:") || strings.HasPrefix(token, "l:"):
			// handled by caller
		case strings.HasPrefix(token, "!"):
			exp := expandVirtualTag(token)
			clean := strings.ToUpper(exp[1:])
			switch clean {
			case "WAITING", "SCHEDULED", "RECURRING", "ALL":
				f.ShowWaiting = true
			case "DONE", "COMPLETED", "ENDED":
				f.ShowDone = true
				if clean == "ENDED" {
					f.ShowSkipped = true
				}
			case "SKIPPED":
				f.ShowSkipped = true
			case "TODAY":
				f.IsToday = true
				f.ShowWaiting = true // today includes waiting due today
			}
			if clean != "ALL" {
				f.Tags = append(f.Tags, exp)
			}
		default:
			// text search term
			if token != "" {
				f.Search = append(f.Search, lo)
			}
		}
	}
	return f
}

func matchesProject(taskProj, filterProj string) bool {
	if filterProj == "" {
		return true
	}
	if taskProj == "" {
		return false
	}
	return taskProj == filterProj || strings.HasPrefix(taskProj, filterProj+".")
}

func applyFilters(tasks []*Task, f Filter, all []*Task, projects []*Project) []*Task {
	now := nowMs()
	todayStr := formatDateOnly(now)

	var out []*Task
	for _, t := range tasks {
		// Status filter
		if !f.IsAll {
			if f.ShowDone && f.ShowSkipped {
				if t.Status != "completed" && t.Status != "skipped" {
					continue
				}
			} else if f.ShowDone {
				if t.Status != "completed" {
					continue
				}
			} else if f.ShowSkipped {
				if t.Status != "skipped" {
					continue
				}
			} else {
				if t.Status != "pending" {
					continue
				}
			}
		}

		// Wait/sched filter (hide future-waiting tasks unless showWaiting)
		if !f.ShowWaiting && !f.ShowDone {
			if f.IsToday {
				// Today: include waiting tasks due today
				if t.Due != nil && formatDateOnly(*t.Due) == todayStr {
					// show it
				} else if (t.Wait != nil && *t.Wait > now) || (t.Sched != nil && *t.Sched > now) {
					continue
				}
			} else {
				if (t.Wait != nil && *t.Wait > now) || (t.Sched != nil && *t.Sched > now) {
					continue
				}
			}
		}

		// Project filter
		if !matchesProject(t.Project, f.Project) {
			continue
		}

		// Target filter
		if f.Target != "" && t.Target != f.Target {
			continue
		}

		// End-after filter
		if f.EndAfter != nil && (t.End == nil || *t.End < *f.EndAfter) {
			continue
		}

		// Tag filters
		match := true
		for _, ft := range f.Tags {
			clean := strings.ToUpper(ft[1:])
			// Check real tag
			foundReal := false
			for _, tg := range t.Tags {
				if strEqFold(tg, clean) || strEqFold(tg, ft[1:]) {
					foundReal = true
					break
				}
			}
			if foundReal {
				continue
			}
			if !hasVirtualTag(t, ft, all, projects) {
				match = false
				break
			}
		}
		if !match {
			continue
		}

		// Text search
		if len(f.Search) > 0 {
			desc := strings.ToLower(t.Description)
			for _, s := range f.Search {
				if !strings.Contains(desc, s) {
					match = false
					break
				}
			}
		}
		if !match {
			continue
		}

		out = append(out, t)
	}
	return out
}

// sortTasks sorts by urgency desc, then entry asc, then UUID (deterministic)
func sortTasks(tasks []*Task) {
	sortTasksBy(tasks, nil)
}

func sortTodayTasks(tasks []*Task) {
	// order asc (nulls last), then urgency desc, then entry asc, UUID
	n := len(tasks)
	for i := 1; i < n; i++ {
		for j := i; j > 0; j-- {
			a, b := tasks[j-1], tasks[j]
			if todayCmp(a, b) > 0 {
				tasks[j-1], tasks[j] = tasks[j], tasks[j-1]
			} else {
				break
			}
		}
	}
}

func todayCmp(a, b *Task) int {
	ao := math.MaxFloat64
	if a.Order != nil {
		ao = float64(*a.Order)
	}
	bo := math.MaxFloat64
	if b.Order != nil {
		bo = float64(*b.Order)
	}
	if ao != bo {
		if ao < bo {
			return -1
		}
		return 1
	}
	if a.Urgency != b.Urgency {
		if a.Urgency > b.Urgency {
			return -1
		}
		return 1
	}
	if a.Entry != b.Entry {
		if a.Entry < b.Entry {
			return -1
		}
		return 1
	}
	return strings.Compare(a.UUID, b.UUID)
}

var sortFieldMap = map[string]string{
	"start": "start", "st": "start",
	"end": "end", "e": "end",
	"pri": "priority", "priority": "priority",
	"pro": "project", "project": "project",
	"due": "due",
	"urg": "urgency", "urgency": "urgency",
	"desc": "description", "description": "description", "alpha": "description",
	"entry": "entry", "create": "entry", "created": "entry", "c": "entry",
	"modified": "modified", "mod": "modified", "m": "modified",
}

func sortTasksBy(tasks []*Task, fields []string) {
	if len(fields) == 0 {
		// Default: urgency desc, entry asc, UUID
		n := len(tasks)
		for i := 1; i < n; i++ {
			for j := i; j > 0; j-- {
				a, b := tasks[j-1], tasks[j]
				swap := false
				ud := b.Urgency - a.Urgency
				if ud > 0.0001 {
					swap = true
				} else if math.Abs(ud) < 0.0001 {
					if a.Entry > b.Entry {
						swap = true
					} else if a.Entry == b.Entry {
						swap = strings.Compare(a.UUID, b.UUID) > 0
					}
				}
				if swap {
					tasks[j-1], tasks[j] = tasks[j], tasks[j-1]
				} else {
					break
				}
			}
		}
		return
	}

	// Custom sort
	n := len(tasks)
	for i := 1; i < n; i++ {
		for j := i; j > 0; j-- {
			if customCmp(tasks[j-1], tasks[j], fields) > 0 {
				tasks[j-1], tasks[j] = tasks[j], tasks[j-1]
			} else {
				break
			}
		}
	}
}

func customCmp(a, b *Task, fields []string) int {
	for _, field := range fields {
		desc := strings.HasPrefix(field, "-")
		key := field
		if desc {
			key = field[1:]
		}
		mapped := sortFieldMap[key]
		if mapped == "" {
			mapped = key
		}
		cmp := cmpField(a, b, mapped)
		if desc {
			cmp = -cmp
		}
		if cmp != 0 {
			return cmp
		}
	}
	return 0
}

func cmpField(a, b *Task, field string) int {
	switch field {
	case "urgency":
		if a.Urgency > b.Urgency {
			return -1
		}
		if a.Urgency < b.Urgency {
			return 1
		}
		return 0
	case "priority":
		ap := math.MinInt
		if a.Priority != nil {
			ap = *a.Priority
		}
		bp := math.MinInt
		if b.Priority != nil {
			bp = *b.Priority
		}
		if ap > bp {
			return -1
		}
		if ap < bp {
			return 1
		}
		return 0
	case "project":
		return strings.Compare(a.Project, b.Project)
	case "description":
		return strings.Compare(strings.ToLower(a.Description), strings.ToLower(b.Description))
	case "due":
		return cmpOptInt64(a.Due, b.Due, true)
	case "start":
		return cmpOptInt64(a.Start, b.Start, true)
	case "end":
		return cmpOptInt64(a.End, b.End, true)
	case "entry":
		if a.Entry > b.Entry {
			return -1
		}
		if a.Entry < b.Entry {
			return 1
		}
		return 0
	case "modified":
		return cmpOptInt64(&a.Modified, &b.Modified, true)
	}
	return 0
}

func cmpOptInt64(a, b *int64, descDefault bool) int {
	if a == nil && b == nil {
		return 0
	}
	if a == nil {
		return 1
	}
	if b == nil {
		return -1
	}
	if *a > *b {
		if descDefault {
			return -1
		}
		return 1
	}
	if *a < *b {
		if descDefault {
			return 1
		}
		return -1
	}
	return 0
}

// ── Multi-ID parsing ──────────────────────────────────────────────────────────

// resolveIDs parses "1", "1,3,5", "1-3", "x:name" combinations → UUIDs
func resolveIDs(s string, displayMap []string, store *Store) []string {
	if s == "" {
		return nil
	}
	seen := map[string]bool{}
	var out []string

	add := func(uuid string) {
		if uuid != "" && !seen[uuid] {
			seen[uuid] = true
			out = append(out, uuid)
		}
	}

	parts := strings.Split(s, ",")
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if strings.HasPrefix(part, "x:") {
			name := part[2:]
			for _, t := range store.Tasks {
				if t.Status == "pending" && t.Target == name {
					add(t.UUID)
					break
				}
			}
		} else if strings.Contains(part, "-") {
			bounds := strings.SplitN(part, "-", 2)
			start, err1 := strconv.Atoi(bounds[0])
			end, err2 := strconv.Atoi(bounds[1])
			if err1 == nil && err2 == nil {
				lo, hi := start, end
				if lo > hi {
					lo, hi = hi, lo
				}
				for i := lo; i <= hi; i++ {
					if i >= 1 && i <= len(displayMap) {
						add(displayMap[i-1])
					}
				}
			}
		} else {
			id, err := strconv.Atoi(part)
			if err == nil && id >= 1 && id <= len(displayMap) {
				add(displayMap[id-1])
			}
		}
	}
	return out
}

// ── Task arg parsing ──────────────────────────────────────────────────────────

type TaskArgs struct {
	Desc     string
	Project  string
	Priority *int
	Order    *int
	Tags     []string
	Depends  []string
	Due      *int64
	Wait     *int64
	WaitTime *WaitTime
	Sched    *int64
	Recur    string
	URL      string
	Icon     string
	Color    *Color
	Target   string
	OnDone   string
	ClearOrder bool
}

func parseTaskArgs(args []string, displayMap []string) TaskArgs {
	var ta TaskArgs

	// Scan for done:/td: trigger first (captures everything after)
	joined := strings.Join(args, " ")
	if idx := findTrigger(joined); idx >= 0 {
		ta.OnDone = strings.TrimSpace(joined[idx:])
		// find the raw trigger prefix
		trigStart := strings.Index(joined, ta.OnDone) - 0
		// re-find proper boundary
		for _, pfx := range []string{"done:", "td:"} {
			if i := strings.Index(joined, pfx); i >= 0 {
				ta.OnDone = strings.TrimSpace(joined[i+len(pfx):])
				joined = joined[:i]
				break
			}
		}
		args = strings.Fields(joined)
		_ = trigStart
	}

	var desc []string
	for _, token := range args {
		lo := strings.ToLower(token)
		switch {
		case lo == "p:" || lo == "pro:" || lo == "proj:" || lo == "project:":
			// incomplete token, skip
		case strings.HasPrefix(lo, "p:") || strings.HasPrefix(lo, "pro:") ||
			strings.HasPrefix(lo, "proj:") || strings.HasPrefix(lo, "project:"):
			ta.Project = token[strings.Index(token, ":")+1:]
		case strings.HasPrefix(lo, "pri:") || strings.HasPrefix(lo, "priority:"):
			v, err := strconv.Atoi(token[strings.Index(token, ":")+1:])
			if err == nil {
				ta.Priority = &v
			}
		case strings.HasPrefix(lo, "o:") || strings.HasPrefix(lo, "ord:") || strings.HasPrefix(lo, "order:"):
			val := token[strings.Index(token, ":")+1:]
			if val == "" {
				ta.ClearOrder = true
			} else {
				v, err := strconv.Atoi(val)
				if err == nil {
					ta.Order = &v
				}
			}
		case strings.HasPrefix(lo, "dep:"):
			ids := strings.Split(token[4:], ",")
			for _, idStr := range ids {
				id, err := strconv.Atoi(strings.TrimSpace(idStr))
				if err == nil && id >= 1 && id <= len(displayMap) {
					ta.Depends = append(ta.Depends, displayMap[id-1])
				}
			}
		case strings.HasPrefix(lo, "due:"):
			ta.Due = parseDate(token[4:])
		case strings.HasPrefix(lo, "wait:"):
			waitStr := token[5:]
			ta.Wait = parseDate(waitStr)
			ta.WaitTime = parseWaitTime(waitStr)
		case strings.HasPrefix(lo, "sched:") || strings.HasPrefix(lo, "scheduled:"):
			ta.Sched = parseDate(token[strings.Index(token, ":")+1:])
		case strings.HasPrefix(lo, "recur:") || strings.HasPrefix(lo, "rec:"):
			ta.Recur = token[strings.Index(token, ":")+1:]
		case strings.HasPrefix(lo, "url:"):
			ta.URL = token[4:]
		case strings.HasPrefix(lo, "icon:"):
			val := token[5:]
			ta.Icon = val
		case strings.HasPrefix(lo, "x:") || strings.HasPrefix(lo, "target:"):
			ta.Target = token[strings.Index(token, ":")+1:]
		case strings.HasPrefix(lo, "c:") || strings.HasPrefix(lo, "color:"):
			ta.Color = parseColorVal(token[strings.Index(token, ":")+1:])
		case strings.HasPrefix(token, "!"):
			ta.Tags = append(ta.Tags, token[1:])
		default:
			desc = append(desc, token)
		}
	}
	ta.Desc = strings.Join(desc, " ")
	return ta
}

func findTrigger(s string) int {
	for _, pfx := range []string{"done:", "td:"} {
		if i := strings.Index(s, pfx); i >= 0 {
			return i
		}
	}
	return -1
}

func parseColorVal(s string) *Color {
	if s == "" {
		return nil
	}
	parts := strings.SplitN(s, ".", 2)
	c := &Color{}
	if len(parts) > 0 && parts[0] != "" {
		c.Icon = parts[0]
	}
	if len(parts) > 1 && parts[1] != "" {
		c.Title = parts[1]
	}
	if c.Icon == "" && c.Title == "" {
		return nil
	}
	return c
}
