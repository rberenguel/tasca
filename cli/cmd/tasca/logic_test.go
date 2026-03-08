package main

import (
	"math"
	"strings"
	"testing"
	"time"
)

// ── helpers ───────────────────────────────────────────────────────────────────

const day = int64(86400000)

func now() int64 { return time.Now().UnixMilli() }

func dateMs(year, month, day_ int) int64 {
	return time.Date(year, time.Month(month), day_, 23, 59, 59, 999000000, time.Local).UnixMilli()
}

func approx(t *testing.T, got, want, tol float64, msg string) {
	t.Helper()
	if math.Abs(got-want) > tol {
		t.Errorf("%s: got %.2f, want %.2f (±%.2f)", msg, got, want, tol)
	}
}

func ptr(v int) *int    { return &v }
func ptrMs(v int64) *int64 { return &v }

func pendingTask(entry int64) *Task {
	return &Task{UUID: "u-" + string(rune(entry%100+65)), Status: "pending", Entry: entry}
}

// ── Urgency ───────────────────────────────────────────────────────────────────

func TestUrgencyBase(t *testing.T) {
	task := &Task{Entry: now(), Status: "pending"}
	u := calcUrgency(task, nil, nil)
	approx(t, u, 0.0, 0.5, "base urgency")
}

func TestUrgencyPriority(t *testing.T) {
	task := &Task{Entry: now(), Status: "pending", Priority: ptr(50)}
	u := calcUrgency(task, nil, nil)
	approx(t, u, 6.0, 0.1, "pri:50 * 0.12") // 50 * 0.12 = 6
}

func TestUrgencyNextTag(t *testing.T) {
	task := &Task{Entry: now(), Status: "pending", Tags: []string{"next"}}
	u := calcUrgency(task, nil, nil)
	approx(t, u, 15.0, 0.5, "next tag")
}

func TestUrgencyDueSoon(t *testing.T) {
	n := now()
	task := &Task{Entry: n, Status: "pending", Due: ptrMs(n + day)} // due in 1 day
	u := calcUrgency(task, nil, nil)
	approx(t, u, 12.0, 0.5, "due in 1 day")
}

func TestUrgencyDueFar(t *testing.T) {
	n := now()
	task := &Task{Entry: n, Status: "pending", Due: ptrMs(n + 10*day)} // due in 10 days
	u := calcUrgency(task, nil, nil)
	approx(t, u, 4.0, 1.0, "due in 10 days")
}

func TestUrgencySomeday(t *testing.T) {
	n := now()
	t1 := &Task{Entry: n, Status: "pending", Tags: []string{"someday"}}
	t2 := &Task{Entry: n, Status: "pending", Tags: []string{"someday"}, Priority: ptr(50)}
	u1 := calcUrgency(t1, nil, nil)
	u2 := calcUrgency(t2, nil, nil)
	approx(t, u1, -100.0, 0.1, "someday base")
	approx(t, u2, -94.0, 0.1, "someday + pri:50") // -100 + 50*0.12 = -94
	if u2 <= u1 {
		t.Error("someday+priority should be greater than plain someday")
	}
}

func TestUrgencyReferenceProject(t *testing.T) {
	n := now()
	proj := []*Project{{Name: "Books", Tags: []string{"reference"}}}
	t1 := &Task{Entry: n, Status: "pending", Project: "Books"}
	t2 := &Task{Entry: n, Status: "pending", Project: "Books", Priority: ptr(50)}
	u1 := calcUrgency(t1, nil, proj)
	u2 := calcUrgency(t2, nil, proj)
	approx(t, u1, -100.0, 0.1, "reference project")
	approx(t, u2, -94.0, 0.1, "reference project + pri:50")
	if u2 <= u1 {
		t.Error("ref+priority should be greater than plain ref")
	}
}

func TestUrgencyRefAlias(t *testing.T) {
	n := now()
	proj := []*Project{{Name: "Books", Tags: []string{"ref"}}}
	task := &Task{Entry: n, Status: "pending", Project: "Books", Priority: ptr(50)}
	u := calcUrgency(task, nil, proj)
	approx(t, u, -94.0, 0.1, "ref tag alias for reference")
}

func TestUrgencyRoutine(t *testing.T) {
	n := now()
	t1 := &Task{Entry: n, Status: "pending"}
	t2 := &Task{Entry: n, Status: "pending", Tags: []string{"routine"}}
	u1 := calcUrgency(t1, nil, nil)
	u2 := calcUrgency(t2, nil, nil)
	approx(t, u2, u1-10, 0.1, "routine -10")
}

func TestUrgencyBlocked(t *testing.T) {
	n := now()
	dep := &Task{UUID: "u1", Status: "pending", Entry: n}
	blocked := &Task{Entry: n, Status: "pending", Depends: []string{"u1"}}
	all := []*Task{dep, blocked}
	u := calcUrgency(blocked, all, nil)
	if u >= 0 {
		t.Errorf("blocked task should have negative urgency, got %.2f", u)
	}
}

func TestUrgencyBlockedHighPriority(t *testing.T) {
	n := now()
	dep := &Task{UUID: "u1", Status: "pending", Entry: n}
	blocked := &Task{Entry: n, Status: "pending", Depends: []string{"u1"}, Priority: ptr(50)}
	all := []*Task{dep, blocked}
	u := calcUrgency(blocked, all, nil)
	if u >= 0 {
		t.Errorf("blocked+pri:50 should still be negative, got %.2f", u)
	}
}

func TestUrgencyActive(t *testing.T) {
	n := now()
	t1 := &Task{Entry: n, Status: "pending"}
	t2 := &Task{Entry: n, Status: "pending", Start: ptrMs(n)}
	u1 := calcUrgency(t1, nil, nil)
	u2 := calcUrgency(t2, nil, nil)
	if u2 <= u1 {
		t.Errorf("active task should have higher urgency: %.2f vs %.2f", u2, u1)
	}
}

func TestUrgencyWaiting(t *testing.T) {
	n := now()
	task := &Task{Entry: n, Status: "pending", Wait: ptrMs(n + day)}
	u := calcUrgency(task, nil, nil)
	approx(t, u, -10.0, 0.1, "waiting task urgency")
}

// ── matchesProject ────────────────────────────────────────────────────────────

func TestMatchesProjectExact(t *testing.T) {
	if !matchesProject("home", "home") {
		t.Error("exact match should be true")
	}
}

func TestMatchesProjectSub(t *testing.T) {
	if !matchesProject("home.kitchen", "home") {
		t.Error("subproject should match")
	}
}

func TestMatchesProjectDeep(t *testing.T) {
	if !matchesProject("home.kitchen.sink", "home") {
		t.Error("deep subproject should match")
	}
}

func TestMatchesProjectPartialString(t *testing.T) {
	if matchesProject("homework", "home") {
		t.Error("partial string prefix should NOT match")
	}
}

func TestMatchesProjectEmpty(t *testing.T) {
	if matchesProject("", "home") {
		t.Error("empty project should NOT match")
	}
}

func TestMatchesProjectFilterEmpty(t *testing.T) {
	// Empty filter matches everything
	if !matchesProject("home", "") {
		t.Error("empty filter should match any project")
	}
}

// ── hasVirtualTag ─────────────────────────────────────────────────────────────

func TestVirtualTagOverdue(t *testing.T) {
	n := now()
	task := &Task{Entry: n, Status: "pending", Due: ptrMs(n - day)}
	if !hasVirtualTag(task, "overdue", nil, nil) {
		t.Error("past-due task should be overdue")
	}
}

func TestVirtualTagNotOverdue(t *testing.T) {
	n := now()
	task := &Task{Entry: n, Status: "pending", Due: ptrMs(n + day)}
	if hasVirtualTag(task, "overdue", nil, nil) {
		t.Error("future-due task should NOT be overdue")
	}
}

func TestVirtualTagWaiting(t *testing.T) {
	n := now()
	task := &Task{Entry: n, Status: "pending", Wait: ptrMs(n + day)}
	if !hasVirtualTag(task, "waiting", nil, nil) {
		t.Error("future-wait task should be waiting")
	}
}

func TestVirtualTagNotWaiting(t *testing.T) {
	n := now()
	task := &Task{Entry: n, Status: "pending", Wait: ptrMs(n - day)}
	if hasVirtualTag(task, "waiting", nil, nil) {
		t.Error("past-wait task should NOT be waiting")
	}
}

func TestVirtualTagBlocked(t *testing.T) {
	n := now()
	dep := &Task{UUID: "u1", Status: "pending", Entry: n}
	task := &Task{Entry: n, Status: "pending", Depends: []string{"u1"}}
	if !hasVirtualTag(task, "blocked", []*Task{dep, task}, nil) {
		t.Error("task with pending dep should be blocked")
	}
}

func TestVirtualTagScheduled(t *testing.T) {
	n := now()
	task := &Task{Entry: n, Status: "pending", Sched: ptrMs(n + day)}
	if !hasVirtualTag(task, "scheduled", nil, nil) {
		t.Error("future-sched task should be scheduled")
	}
}

func TestVirtualTagScheduledPast(t *testing.T) {
	n := now()
	task := &Task{Entry: n, Status: "pending", Sched: ptrMs(n - day)}
	if hasVirtualTag(task, "scheduled", nil, nil) {
		t.Error("past-sched task should NOT be scheduled")
	}
}

func TestVirtualTagRecurring(t *testing.T) {
	task := &Task{Entry: now(), Status: "pending", Recur: "1w"}
	if !hasVirtualTag(task, "recurring", nil, nil) {
		t.Error("task with recur should be recurring")
	}
}

func TestVirtualTagNotRecurring(t *testing.T) {
	task := &Task{Entry: now(), Status: "pending"}
	if hasVirtualTag(task, "recurring", nil, nil) {
		t.Error("task without recur should NOT be recurring")
	}
}

func TestVirtualTagReference(t *testing.T) {
	proj := []*Project{{Name: "Books", Tags: []string{"reference"}}}
	task := &Task{Entry: now(), Status: "pending", Project: "Books"}
	if !hasVirtualTag(task, "reference", nil, proj) {
		t.Error("task in reference project should have !reference")
	}
}

func TestVirtualTagRoutine(t *testing.T) {
	task := &Task{Entry: now(), Status: "pending", Tags: []string{"routine"}}
	if !hasVirtualTag(task, "routine", nil, nil) {
		t.Error("routine tag should match !routine")
	}
}

func TestVirtualTagDone(t *testing.T) {
	task := &Task{Entry: now(), Status: "completed"}
	if !hasVirtualTag(task, "done", nil, nil) {
		t.Error("completed task should match !done")
	}
}

func TestVirtualTagActive(t *testing.T) {
	n := now()
	task := &Task{Entry: n, Status: "pending", Start: ptrMs(n - 1000)}
	if !hasVirtualTag(task, "active", nil, nil) {
		t.Error("started task should match !active")
	}
}

// ── expandVirtualTag ─────────────────────────────────────────────────

func TestExpandShorthandOverdue(t *testing.T) {
	cases := map[string]string{
		"!o": "!overdue", "!od": "!overdue", "!over": "!overdue", "!overdue": "!overdue",
	}
	for in, want := range cases {
		if got := expandVirtualTag(in); got != want {
			t.Errorf("expandVirtualTag(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestExpandShorthandToday(t *testing.T) {
	cases := map[string]string{
		"!t": "!today", "!tod": "!today", "!today": "!today",
	}
	for in, want := range cases {
		if got := expandVirtualTag(in); got != want {
			t.Errorf("expandVirtualTag(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestExpandShorthandWaiting(t *testing.T) {
	cases := map[string]string{
		"!w": "!waiting", "!wait": "!waiting", "!waiting": "!waiting",
	}
	for in, want := range cases {
		if got := expandVirtualTag(in); got != want {
			t.Errorf("expandVirtualTag(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestExpandShorthandScheduled(t *testing.T) {
	cases := map[string]string{
		"!s": "!scheduled", "!sch": "!scheduled", "!sched": "!scheduled", "!scheduled": "!scheduled",
	}
	for in, want := range cases {
		if got := expandVirtualTag(in); got != want {
			t.Errorf("expandVirtualTag(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestExpandShorthandOther(t *testing.T) {
	cases := map[string]string{
		"!b": "!blocked", "!blk": "!blocked", "!block": "!blocked",
		"!d": "!done",
		"!a": "!active", "!act": "!active",
		"!r": "!recurring", "!rec": "!recurring", "!recur": "!recurring",
		"!sd": "!someday",
		"!rt": "!routine",
		"!m":  "!modified", "!mod": "!modified",
		"!cl": "!checklist",
	}
	for in, want := range cases {
		if got := expandVirtualTag(in); got != want {
			t.Errorf("expandVirtualTag(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestExpandShorthandCaseInsensitive(t *testing.T) {
	if got := expandVirtualTag("!W"); got != "!waiting" {
		t.Errorf("case insensitive: !W -> %q", got)
	}
	if got := expandVirtualTag("!RT"); got != "!routine" {
		t.Errorf("case insensitive: !RT -> %q", got)
	}
	if got := expandVirtualTag("!OD"); got != "!overdue" {
		t.Errorf("case insensitive: !OD -> %q", got)
	}
}

func TestExpandShorthandUnknown(t *testing.T) {
	if got := expandVirtualTag("!errand"); got != "!errand" {
		t.Errorf("unknown tag should pass through: got %q", got)
	}
	if got := expandVirtualTag("!foo"); got != "!foo" {
		t.Errorf("unknown tag should pass through: got %q", got)
	}
}

// ── parseDate ─────────────────────────────────────────────────────────────────

func parseDateDay(s string) (int, int, int) {
	ms := parseDate(s)
	if ms == nil {
		return 0, 0, 0
	}
	d := time.UnixMilli(*ms).Local()
	return d.Year(), int(d.Month()), d.Day()
}

func parseDateHHMM(s string) (int, int) {
	ms := parseDate(s)
	if ms == nil {
		return -1, -1
	}
	d := time.UnixMilli(*ms).Local()
	return d.Hour(), d.Minute()
}

func TestParseDateYYYYMMDD(t *testing.T) {
	y, m, d := parseDateDay("20250115")
	if y != 2025 || m != 1 || d != 15 {
		t.Errorf("20250115: got %d-%d-%d", y, m, d)
	}
}

func TestParseDateToday(t *testing.T) {
	today := time.Now().Local()
	y, m, d := parseDateDay("today")
	if y != today.Year() || m != int(today.Month()) || d != today.Day() {
		t.Errorf("today: got %d-%d-%d", y, m, d)
	}
}

func TestParseDateTod(t *testing.T) {
	if parseDate("tod") == nil {
		t.Error("tod should parse")
	}
}

func TestParseDateTomorrow(t *testing.T) {
	tomorrow := time.Now().Local().AddDate(0, 0, 1)
	_, _, d := parseDateDay("tomorrow")
	if d != tomorrow.Day() {
		t.Errorf("tomorrow: got day %d, want %d", d, tomorrow.Day())
	}
}

func TestParseDateNd(t *testing.T) {
	expected := time.Now().Local().AddDate(0, 0, 3)
	_, _, d := parseDateDay("3d")
	if d != expected.Day() {
		t.Errorf("3d: got day %d, want %d", d, expected.Day())
	}
}

func TestParseDateNw(t *testing.T) {
	expected := time.Now().Local().AddDate(0, 0, 14)
	_, _, d := parseDateDay("2w")
	if d != expected.Day() {
		t.Errorf("2w: got day %d, want %d", d, expected.Day())
	}
}

func TestParseDateNm(t *testing.T) {
	expected := time.Now().Local().AddDate(0, 1, 0)
	_, m, _ := parseDateDay("1m")
	if m != int(expected.Month()) {
		t.Errorf("1m: got month %d, want %d", m, int(expected.Month()))
	}
}

func TestParseDateEndOfDay(t *testing.T) {
	h, min := parseDateHHMM("today")
	if h != 23 || min != 59 {
		t.Errorf("today should be end of day 23:59, got %d:%d", h, min)
	}
}

func TestParseDateHHMM(t *testing.T) {
	h, m := parseDateHHMM("14:30")
	if h != 14 || m != 30 {
		t.Errorf("14:30: got %d:%d", h, m)
	}
}

func TestParseDateAtFormat(t *testing.T) {
	ms := parseDate("tomorrow@09:30")
	if ms == nil {
		t.Fatal("tomorrow@09:30 should parse")
	}
	d := time.UnixMilli(*ms).Local()
	tomorrow := time.Now().Local().AddDate(0, 0, 1)
	if d.Day() != tomorrow.Day() || d.Hour() != 9 || d.Minute() != 30 {
		t.Errorf("tomorrow@09:30: got %d %d:%d", d.Day(), d.Hour(), d.Minute())
	}
}

func TestParseDateYYYYMMDDAtTime(t *testing.T) {
	ms := parseDate("20250615@18:00")
	if ms == nil {
		t.Fatal("20250615@18:00 should parse")
	}
	d := time.UnixMilli(*ms).Local()
	if d.Year() != 2025 || int(d.Month()) != 6 || d.Day() != 15 || d.Hour() != 18 || d.Minute() != 0 {
		t.Errorf("20250615@18:00: got %v", d)
	}
}

func TestParseDateNamedDays(t *testing.T) {
	days := []string{"sun", "mon", "tue", "wed", "thu", "fri", "sat"}
	for i, name := range days {
		ms := parseDate(name)
		if ms == nil {
			t.Errorf("%s should parse", name)
			continue
		}
		d := time.UnixMilli(*ms).Local()
		if int(d.Weekday()) != i {
			t.Errorf("%s: got weekday %d, want %d", name, d.Weekday(), i)
		}
		// End of day
		if d.Hour() != 23 || d.Minute() != 59 {
			t.Errorf("%s: should be end of day, got %d:%d", name, d.Hour(), d.Minute())
		}
		// In the future (1-7 days)
		diffDays := int(time.Until(d).Hours() / 24)
		if diffDays < 0 || diffDays > 7 {
			t.Errorf("%s: diff days out of range: %d", name, diffDays)
		}
	}
}

func TestParseDateSameDayNextWeek(t *testing.T) {
	days := []string{"sun", "mon", "tue", "wed", "thu", "fri", "sat"}
	todayName := days[int(time.Now().Local().Weekday())]
	ms := parseDate(todayName)
	if ms == nil {
		t.Fatal("today's weekday name should parse")
	}
	d := time.UnixMilli(*ms).Local()
	now := time.Now().Local()
	nowMidnight := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	tgtMidnight := time.Date(d.Year(), d.Month(), d.Day(), 0, 0, 0, 0, d.Location())
	diff := int(math.Round(tgtMidnight.Sub(nowMidnight).Hours() / 24))
	if diff != 7 {
		t.Errorf("same-day should be next week (+7 days), got +%d", diff)
	}
}

func TestParseDateCaseInsensitive(t *testing.T) {
	for _, s := range []string{"TODAY", "Tomorrow", "3D", "MON", "FRI"} {
		if parseDate(s) == nil {
			t.Errorf("%s should parse case-insensitively", s)
		}
	}
}

func TestParseDateInvalid(t *testing.T) {
	for _, s := range []string{"invalid", "", "foobar"} {
		if parseDate(s) != nil {
			t.Errorf("%q should return nil", s)
		}
	}
}

func TestParseDateNh(t *testing.T) {
	before := time.Now()
	ms := parseDate("3h")
	after := time.Now()
	if ms == nil {
		t.Fatal("3h should parse")
	}
	got := time.UnixMilli(*ms)
	expected := before.Add(3 * time.Hour)
	if got.Before(expected.Add(-time.Second)) || got.After(after.Add(3*time.Hour+time.Second)) {
		t.Errorf("3h: got %v, expected ~%v", got, expected)
	}
}

// ── Recurrence ────────────────────────────────────────────────────────────────

func TestRecurDaily(t *testing.T) {
	due := dateMs(2025, 1, 15)
	task := &Task{Due: ptrMs(due), Recur: "1d"}
	r := calcNextRecurrence(task)
	if r == nil {
		t.Fatal("1d recurrence should return result")
	}
	d := time.UnixMilli(r.NextDue).Local()
	if d.Day() != 16 {
		t.Errorf("1d: expected day 16, got %d", d.Day())
	}
}

func TestRecur3Days(t *testing.T) {
	due := dateMs(2025, 1, 15)
	task := &Task{Due: ptrMs(due), Recur: "3d"}
	r := calcNextRecurrence(task)
	if r == nil {
		t.Fatal("3d recurrence should return result")
	}
	d := time.UnixMilli(r.NextDue).Local()
	if d.Day() != 18 {
		t.Errorf("3d: expected day 18, got %d", d.Day())
	}
}

func TestRecurLegacyDaily(t *testing.T) {
	due := dateMs(2025, 1, 15)
	task := &Task{Due: ptrMs(due), Recur: "daily"}
	if r := calcNextRecurrence(task); r == nil {
		t.Error("legacy 'daily' should work")
	}
}

func TestRecurWeekly(t *testing.T) {
	due := dateMs(2025, 1, 15)
	task := &Task{Due: ptrMs(due), Recur: "1w"}
	r := calcNextRecurrence(task)
	if r == nil {
		t.Fatal("1w recurrence should return result")
	}
	d := time.UnixMilli(r.NextDue).Local()
	if d.Day() != 22 {
		t.Errorf("1w: expected day 22, got %d", d.Day())
	}
}

func TestRecur2Weeks(t *testing.T) {
	due := dateMs(2025, 1, 15)
	task := &Task{Due: ptrMs(due), Recur: "2w"}
	r := calcNextRecurrence(task)
	if r == nil {
		t.Fatal("2w recurrence should return result")
	}
	d := time.UnixMilli(r.NextDue).Local()
	if d.Day() != 29 {
		t.Errorf("2w: expected day 29, got %d", d.Day())
	}
}

func TestRecurLegacyWeekly(t *testing.T) {
	due := dateMs(2025, 1, 15)
	task := &Task{Due: ptrMs(due), Recur: "weekly"}
	if r := calcNextRecurrence(task); r == nil {
		t.Error("legacy 'weekly' should work")
	}
}

func TestRecurMonthly(t *testing.T) {
	due := dateMs(2025, 1, 15)
	task := &Task{Due: ptrMs(due), Recur: "1m"}
	r := calcNextRecurrence(task)
	if r == nil {
		t.Fatal("1m recurrence should return result")
	}
	d := time.UnixMilli(r.NextDue).Local()
	if int(d.Month()) != 2 || d.Day() != 15 {
		t.Errorf("1m: expected Feb 15, got %v", d)
	}
}

func TestRecurYearly(t *testing.T) {
	due := dateMs(2025, 3, 10)
	task := &Task{Due: ptrMs(due), Recur: "1y"}
	r := calcNextRecurrence(task)
	if r == nil {
		t.Fatal("1y recurrence should return result")
	}
	d := time.UnixMilli(r.NextDue).Local()
	if d.Year() != 2026 || int(d.Month()) != 3 || d.Day() != 10 {
		t.Errorf("1y: expected 2026-03-10, got %v", d)
	}
}

func TestRecurNoRecur(t *testing.T) {
	due := dateMs(2025, 1, 15)
	task := &Task{Due: ptrMs(due)}
	if r := calcNextRecurrence(task); r != nil {
		t.Error("no recur field should return nil")
	}
}

func TestRecurNoDue(t *testing.T) {
	task := &Task{Recur: "1d"}
	if r := calcNextRecurrence(task); r != nil {
		t.Error("no due date should return nil")
	}
}

// ── resolveIDs ────────────────────────────────────────────────────────────────

func TestResolveIDsSingle(t *testing.T) {
	dm := []string{"uuid-a", "uuid-b", "uuid-c"}
	uuids := resolveIDs("2", dm, nil)
	if len(uuids) != 1 || uuids[0] != "uuid-b" {
		t.Errorf("single ID: got %v", uuids)
	}
}

func TestResolveIDsCSV(t *testing.T) {
	dm := []string{"u1", "u2", "u3", "u4", "u5"}
	uuids := resolveIDs("1,3,5", dm, nil)
	if len(uuids) != 3 || uuids[0] != "u1" || uuids[1] != "u3" || uuids[2] != "u5" {
		t.Errorf("csv IDs: got %v", uuids)
	}
}

func TestResolveIDsRange(t *testing.T) {
	dm := []string{"u1", "u2", "u3", "u4", "u5"}
	uuids := resolveIDs("2-4", dm, nil)
	if len(uuids) != 3 || uuids[0] != "u2" || uuids[1] != "u3" || uuids[2] != "u4" {
		t.Errorf("range IDs: got %v", uuids)
	}
}

func TestResolveIDsMixed(t *testing.T) {
	dm := []string{"u1", "u2", "u3", "u4", "u5", "u6", "u7"}
	uuids := resolveIDs("1,3-5,7", dm, nil)
	if len(uuids) != 5 {
		t.Errorf("mixed IDs: got %v", uuids)
	}
}

func TestResolveIDsTarget(t *testing.T) {
	store := &Store{Tasks: []*Task{
		{UUID: "uuid-x", Status: "pending", Target: "docs"},
	}}
	dm := []string{"uuid-x"}
	uuids := resolveIDs("x:docs", dm, store)
	if len(uuids) != 1 || uuids[0] != "uuid-x" {
		t.Errorf("x:target: got %v", uuids)
	}
}

// ── parseTaskArgs ─────────────────────────────────────────────────────────────

func TestParseTaskArgsDescription(t *testing.T) {
	ta := parseTaskArgs([]string{"Buy", "milk"}, nil)
	if ta.Desc != "Buy milk" {
		t.Errorf("desc: got %q", ta.Desc)
	}
}

func TestParseTaskArgsProject(t *testing.T) {
	ta := parseTaskArgs([]string{"Fix", "bug", "pro:Work.Backend"}, nil)
	if ta.Desc != "Fix bug" {
		t.Errorf("desc with project: got %q", ta.Desc)
	}
	if ta.Project != "Work.Backend" {
		t.Errorf("project: got %q", ta.Project)
	}
}

func TestParseTaskArgsPriority(t *testing.T) {
	ta := parseTaskArgs([]string{"task", "pri:50"}, nil)
	if ta.Priority == nil || *ta.Priority != 50 {
		t.Errorf("priority: got %v", ta.Priority)
	}
}

func TestParseTaskArgsTags(t *testing.T) {
	ta := parseTaskArgs([]string{"task", "!urgent", "!work"}, nil)
	if len(ta.Tags) != 2 {
		t.Errorf("tags: got %v", ta.Tags)
	}
}

func TestParseTaskArgsDue(t *testing.T) {
	ta := parseTaskArgs([]string{"task", "due:today"}, nil)
	if ta.Due == nil {
		t.Error("due:today should set Due")
	}
}

func TestParseTaskArgsURL(t *testing.T) {
	ta := parseTaskArgs([]string{"task", "url:https://example.com/path"}, nil)
	if ta.URL != "https://example.com/path" {
		t.Errorf("url: got %q", ta.URL)
	}
}

func TestParseTaskArgsProjectAliases(t *testing.T) {
	for _, prefix := range []string{"pro:", "p:", "proj:", "project:"} {
		ta := parseTaskArgs([]string{"task", prefix + "Home"}, nil)
		if ta.Project != "Home" {
			t.Errorf("%s: project not parsed, got %q", prefix, ta.Project)
		}
	}
}

func TestParseTaskArgsRecur(t *testing.T) {
	ta := parseTaskArgs([]string{"task", "recur:1d"}, nil)
	if ta.Recur != "1d" {
		t.Errorf("recur: got %q", ta.Recur)
	}
}

// ── contextDefaults ───────────────────────────────────────────────────────────

func TestContextDefaultsProject(t *testing.T) {
	proj, tags := contextDefaults([]string{"pro:Work"})
	if proj != "Work" {
		t.Errorf("context project: got %q", proj)
	}
	if len(tags) != 0 {
		t.Errorf("no tags expected, got %v", tags)
	}
}

func TestContextDefaultsTag(t *testing.T) {
	proj, tags := contextDefaults([]string{"!urgent"})
	if proj != "" {
		t.Errorf("no project expected, got %q", proj)
	}
	if len(tags) != 1 || tags[0] != "urgent" {
		t.Errorf("tags: got %v", tags)
	}
}

func TestContextDefaultsSkipsVirtualTags(t *testing.T) {
	virtual := []string{"!today", "!overdue", "!waiting", "!scheduled", "!blocked",
		"!done", "!active", "!recurring", "!someday", "!routine", "!modified", "!checklist",
		"!t", "!o", "!w", "!s", "!b", "!d", "!a", "!r", "!sd", "!rt", "!m", "!cl"}
	for _, v := range virtual {
		_, tags := contextDefaults([]string{v})
		if len(tags) != 0 {
			t.Errorf("virtual tag %s should not be inherited, got %v", v, tags)
		}
	}
}

func TestContextDefaultsMixed(t *testing.T) {
	proj, tags := contextDefaults([]string{"pro:Work", "!urgent", "!today"})
	if proj != "Work" {
		t.Errorf("project: got %q", proj)
	}
	// "urgent" is real, "today" is virtual
	if len(tags) != 1 || tags[0] != "urgent" {
		t.Errorf("tags: got %v", tags)
	}
}

// ── withContext ───────────────────────────────────────────────────────────────

func TestWithContextEmpty(t *testing.T) {
	state := &State{}
	result := withContext(state, []string{"foo"})
	if len(result) != 1 || result[0] != "foo" {
		t.Errorf("empty context: got %v", result)
	}
}

func TestWithContextPrepends(t *testing.T) {
	state := &State{Context: []string{"pro:Work"}}
	result := withContext(state, []string{"!urgent"})
	if len(result) != 2 || result[0] != "pro:Work" || result[1] != "!urgent" {
		t.Errorf("prepend: got %v", result)
	}
}

func TestWithContextNoExtraArgs(t *testing.T) {
	state := &State{Context: []string{"pro:Work"}}
	result := withContext(state, nil)
	if len(result) != 1 || result[0] != "pro:Work" {
		t.Errorf("no extra args: got %v", result)
	}
}

// ── formatDateOnly ────────────────────────────────────────────────────────────

func TestFormatDateOnly(t *testing.T) {
	ts := time.Date(2025, 1, 15, 14, 30, 0, 0, time.Local).UnixMilli()
	got := formatDateOnly(ts)
	if got != "20250115" {
		t.Errorf("formatDateOnly: got %q", got)
	}
}

// ── UUID ──────────────────────────────────────────────────────────────────────

func TestNewUUID(t *testing.T) {
	u := newUUID()
	if len(u) != 36 {
		t.Errorf("UUID length: got %d", len(u))
	}
	parts := strings.Split(u, "-")
	if len(parts) != 5 {
		t.Errorf("UUID parts: got %d", len(parts))
	}
}

func TestNewUUIDUnique(t *testing.T) {
	seen := map[string]bool{}
	for i := 0; i < 100; i++ {
		u := newUUID()
		if seen[u] {
			t.Fatalf("duplicate UUID: %s", u)
		}
		seen[u] = true
	}
}

// ── applyAnnotation ───────────────────────────────────────────────────────────

func TestApplyAnnotationAdd(t *testing.T) {
	var anns []Annotation
	var mod int64
	if err := applyAnnotation(&anns, &mod, "hello world"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(anns) != 1 {
		t.Fatalf("expected 1 annotation, got %d", len(anns))
	}
	if anns[0].Description != "hello world" {
		t.Errorf("description: got %q", anns[0].Description)
	}
	if anns[0].Entry == 0 {
		t.Error("entry timestamp should be set")
	}
	if mod == 0 {
		t.Error("modified should be set")
	}
}

func TestApplyAnnotationAddSecond(t *testing.T) {
	anns := []Annotation{{Entry: 1000, Description: "first"}}
	var mod int64
	if err := applyAnnotation(&anns, &mod, "second"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(anns) != 2 {
		t.Fatalf("expected 2 annotations, got %d", len(anns))
	}
	if anns[1].Description != "second" {
		t.Errorf("second annotation: got %q", anns[1].Description)
	}
}

func TestApplyAnnotationRemove(t *testing.T) {
	anns := []Annotation{
		{Entry: 1000, Description: "first"},
		{Entry: 2000, Description: "second"},
		{Entry: 3000, Description: "third"},
	}
	var mod int64
	if err := applyAnnotation(&anns, &mod, "-2"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(anns) != 2 {
		t.Fatalf("expected 2 annotations after remove, got %d", len(anns))
	}
	if anns[0].Description != "first" || anns[1].Description != "third" {
		t.Errorf("wrong annotations after remove: %v", anns)
	}
}

func TestApplyAnnotationRemoveFirst(t *testing.T) {
	anns := []Annotation{
		{Entry: 1000, Description: "first"},
		{Entry: 2000, Description: "second"},
	}
	var mod int64
	if err := applyAnnotation(&anns, &mod, "-1"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(anns) != 1 || anns[0].Description != "second" {
		t.Errorf("wrong annotations: %v", anns)
	}
}

func TestApplyAnnotationEdit(t *testing.T) {
	anns := []Annotation{
		{Entry: 1000, Description: "original"},
		{Entry: 2000, Description: "other"},
	}
	var mod int64
	if err := applyAnnotation(&anns, &mod, "-1 updated text"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(anns) != 2 {
		t.Fatalf("edit should not change count, got %d", len(anns))
	}
	if anns[0].Description != "updated text" {
		t.Errorf("edit: got %q", anns[0].Description)
	}
	if anns[1].Description != "other" {
		t.Errorf("other annotation should be unchanged: %q", anns[1].Description)
	}
}

func TestApplyAnnotationEditMultiWord(t *testing.T) {
	anns := []Annotation{{Entry: 1000, Description: "old"}}
	var mod int64
	if err := applyAnnotation(&anns, &mod, "-1 some new replacement text here"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if anns[0].Description != "some new replacement text here" {
		t.Errorf("multi-word edit: got %q", anns[0].Description)
	}
}

func TestApplyAnnotationInvalidIndex(t *testing.T) {
	anns := []Annotation{{Entry: 1000, Description: "only"}}
	var mod int64
	if err := applyAnnotation(&anns, &mod, "-0"); err == nil {
		t.Error("index 0 should error")
	}
	if err := applyAnnotation(&anns, &mod, "-2"); err == nil {
		t.Error("out-of-range index should error")
	}
}

func TestApplyAnnotationInvalidSyntax(t *testing.T) {
	var anns []Annotation
	var mod int64
	if err := applyAnnotation(&anns, &mod, "-abc"); err == nil {
		t.Error("non-numeric index should error")
	}
}

// ── annotateProject ───────────────────────────────────────────────────────────

func TestAnnotateProjectCreatesProject(t *testing.T) {
	store := &Store{Tasks: []*Task{}, Projects: []*Project{}}
	opts := Options{}
	if err := annotateProject(store, "Work", "some note", opts); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(store.Projects) != 1 {
		t.Fatalf("expected 1 project, got %d", len(store.Projects))
	}
	p := store.Projects[0]
	if p.Name != "Work" {
		t.Errorf("name: got %q", p.Name)
	}
	if len(p.Annotations) != 1 || p.Annotations[0].Description != "some note" {
		t.Errorf("annotations: %v", p.Annotations)
	}
}

func TestAnnotateProjectExisting(t *testing.T) {
	store := &Store{
		Tasks:    []*Task{},
		Projects: []*Project{{Name: "Work", Tags: []string{"ref"}}},
	}
	opts := Options{}
	if err := annotateProject(store, "Work", "a note", opts); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// Should update existing, not create duplicate
	if len(store.Projects) != 1 {
		t.Fatalf("should still be 1 project, got %d", len(store.Projects))
	}
	p := store.Projects[0]
	if len(p.Tags) != 1 || p.Tags[0] != "ref" {
		t.Error("existing tags should be preserved")
	}
	if len(p.Annotations) != 1 {
		t.Errorf("annotations: %v", p.Annotations)
	}
}

func TestAnnotateProjectRemove(t *testing.T) {
	store := &Store{
		Tasks: []*Task{},
		Projects: []*Project{{
			Name: "Work",
			Annotations: []Annotation{
				{Entry: 1000, Description: "first"},
				{Entry: 2000, Description: "second"},
			},
		}},
	}
	opts := Options{}
	if err := annotateProject(store, "Work", "-1", opts); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	p := store.Projects[0]
	if len(p.Annotations) != 1 || p.Annotations[0].Description != "second" {
		t.Errorf("after remove: %v", p.Annotations)
	}
}

func TestAnnotateProjectEdit(t *testing.T) {
	store := &Store{
		Tasks: []*Task{},
		Projects: []*Project{{
			Name:        "Work",
			Annotations: []Annotation{{Entry: 1000, Description: "original"}},
		}},
	}
	opts := Options{}
	if err := annotateProject(store, "Work", "-1 updated", opts); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	p := store.Projects[0]
	if len(p.Annotations) != 1 || p.Annotations[0].Description != "updated" {
		t.Errorf("after edit: %v", p.Annotations)
	}
}
