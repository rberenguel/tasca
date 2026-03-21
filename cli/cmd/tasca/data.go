package main

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"sync/atomic"
	"time"
)

// ── Flexible int (handles JSON number or string) ──────────────────────────────

// FlexInt unmarshals from JSON number or quoted string.
type FlexInt struct{ V int }

func (f *FlexInt) UnmarshalJSON(b []byte) error {
	s := string(b)
	if s == "null" {
		return nil
	}
	// Strip quotes if present
	if len(s) >= 2 && s[0] == '"' {
		s = s[1 : len(s)-1]
	}
	if s == "" {
		return nil // treat empty string as absent
	}
	n, err := strconv.Atoi(s)
	if err != nil {
		// Try float truncation (e.g. "10.0")
		var fv float64
		if err2 := json.Unmarshal(b, &fv); err2 == nil {
			f.V = int(fv)
			return nil
		}
		return err
	}
	f.V = n
	return nil
}

func (f FlexInt) MarshalJSON() ([]byte, error) {
	return json.Marshal(f.V)
}

// ── Task & related types ──────────────────────────────────────────────────────

type WaitTime struct {
	Hours   int `json:"hours"`
	Minutes int `json:"minutes"`
}

type Color struct {
	Icon  string `json:"icon,omitempty"`
	Title string `json:"title,omitempty"`
}

type Annotation struct {
	Entry       int64  `json:"entry"`
	Description string `json:"description"`
}

type TrackEntry struct {
	Entry int64  `json:"entry"`
	Type  string `json:"type"`
	Value *int   `json:"value,omitempty"`
}

type Task struct {
	UUID        string       `json:"uuid"`
	Description string       `json:"description"`
	Status      string       `json:"status"`
	Entry       int64        `json:"entry"`
	Modified    int64        `json:"modified,omitempty"`
	Project     string       `json:"project,omitempty"`
	Priority    *int         `json:"priority,omitempty"`
	Order       *int         `json:"order,omitempty"`
	Tags        []string     `json:"tags,omitempty"`
	Depends     []string     `json:"depends,omitempty"`
	Due         *int64       `json:"due,omitempty"`
	Wait        *int64       `json:"wait,omitempty"`
	WaitTime    *WaitTime    `json:"waitTime,omitempty"`
	Sched       *int64       `json:"sched,omitempty"`
	Recur       string       `json:"recur,omitempty"`
	URL         string       `json:"url,omitempty"`
	Icon        string       `json:"icon,omitempty"`
	Color       *Color       `json:"color,omitempty"`
	Target      string       `json:"target,omitempty"`
	OnDone      string       `json:"onDone,omitempty"`
	Start       *int64       `json:"start,omitempty"`
	End         *int64       `json:"end,omitempty"`
	Annotations []Annotation `json:"annotations,omitempty"`
	Track       []TrackEntry `json:"track,omitempty"`
	Checklist   string       `json:"checklist,omitempty"`
	Touches     int          `json:"touches,omitempty"`

	// Computed, not stored
	Urgency float64 `json:"-"`
}

// rawTask mirrors Task but with flexible int fields for JSON unmarshaling.
type rawTask struct {
	UUID        string       `json:"uuid"`
	Description string       `json:"description"`
	Status      string       `json:"status"`
	Entry       int64        `json:"entry"`
	Modified    int64        `json:"modified,omitempty"`
	Project     string       `json:"project,omitempty"`
	Priority    *FlexInt     `json:"priority,omitempty"`
	Order       *FlexInt     `json:"order,omitempty"`
	Tags        []string     `json:"tags,omitempty"`
	Depends     []string     `json:"depends,omitempty"`
	Due         *int64       `json:"due,omitempty"`
	Wait        *int64       `json:"wait,omitempty"`
	WaitTime    *WaitTime    `json:"waitTime,omitempty"`
	Sched       *int64       `json:"sched,omitempty"`
	Recur       string       `json:"recur,omitempty"`
	URL         string       `json:"url,omitempty"`
	Icon        string       `json:"icon,omitempty"`
	Color       *Color       `json:"color,omitempty"`
	Target      string       `json:"target,omitempty"`
	OnDone      string       `json:"onDone,omitempty"`
	Start       *int64       `json:"start,omitempty"`
	End         *int64       `json:"end,omitempty"`
	Annotations []Annotation `json:"annotations,omitempty"`
	Track       []TrackEntry `json:"track,omitempty"`
	Checklist   string       `json:"checklist,omitempty"`
	Touches     int          `json:"touches,omitempty"`
}

func (t *Task) UnmarshalJSON(b []byte) error {
	var r rawTask
	if err := json.Unmarshal(b, &r); err != nil {
		return err
	}
	t.UUID = r.UUID
	t.Description = r.Description
	t.Status = r.Status
	t.Entry = r.Entry
	t.Modified = r.Modified
	t.Project = r.Project
	if r.Priority != nil {
		v := r.Priority.V
		t.Priority = &v
	}
	if r.Order != nil {
		v := r.Order.V
		t.Order = &v
	}
	t.Tags = r.Tags
	t.Depends = r.Depends
	t.Due = r.Due
	t.Wait = r.Wait
	t.WaitTime = r.WaitTime
	t.Sched = r.Sched
	t.Recur = r.Recur
	t.URL = r.URL
	t.Icon = r.Icon
	t.Color = r.Color
	t.Target = r.Target
	t.OnDone = r.OnDone
	t.Start = r.Start
	t.End = r.End
	t.Annotations = r.Annotations
	t.Track = r.Track
	t.Checklist = r.Checklist
	t.Touches = r.Touches
	return nil
}

type Project struct {
	Name        string       `json:"name"`
	Icon        string       `json:"icon,omitempty"`
	Tags        []string     `json:"tags,omitempty"`
	Banners     []string     `json:"banners,omitempty"`
	BannerStyle string       `json:"bannerStyle,omitempty"`
	Annotations []Annotation `json:"annotations,omitempty"`
	Modified    int64        `json:"modified,omitempty"`
}

// ── Store (top-level JSON) ────────────────────────────────────────────────────

type Store struct {
	Tasks    []*Task    `json:"tasks"`
	Projects []*Project `json:"projects"`
	SavedAt  int64      `json:"savedAt,omitempty"`
}

func loadStore(path string) (*Store, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open %s: %w", path, err)
	}
	defer f.Close()
	var s Store
	if err := json.NewDecoder(f).Decode(&s); err != nil {
		return nil, fmt.Errorf("decode %s: %w", path, err)
	}
	if s.Tasks == nil {
		s.Tasks = []*Task{}
	}
	if s.Projects == nil {
		s.Projects = []*Project{}
	}
	return &s, nil
}

func saveStore(path string, s *Store) error {
	dir := filepath.Dir(path)
	tmp, err := os.CreateTemp(dir, ".tasca-*.json")
	if err != nil {
		return fmt.Errorf("create temp: %w", err)
	}
	tmpName := tmp.Name()
	enc := json.NewEncoder(tmp)
	enc.SetIndent("", "  ")
	if err := enc.Encode(s); err != nil {
		tmp.Close()
		os.Remove(tmpName)
		return fmt.Errorf("encode: %w", err)
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmpName)
		return err
	}
	return os.Rename(tmpName, path)
}

// ── State file ────────────────────────────────────────────────────────────────

type State struct {
	DisplayMap []string `json:"displayMap"`
	UpdatedAt  int64    `json:"updatedAt"`
	Context    []string `json:"context,omitempty"` // last view args; nil = next
}

func stateDir() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".tasca")
}

func statePath(jsonPath string) string {
	abs, _ := filepath.Abs(jsonPath)
	// simple hash: sum of bytes mod large prime, formatted as hex
	var h uint32 = 2166136261
	for _, c := range []byte(abs) {
		h ^= uint32(c)
		h *= 16777619
	}
	return filepath.Join(stateDir(), fmt.Sprintf("%08x.state", h))
}

func loadState(jsonPath string) *State {
	p := statePath(jsonPath)
	f, err := os.Open(p)
	if err != nil {
		return &State{}
	}
	defer f.Close()
	var st State
	if err := json.NewDecoder(f).Decode(&st); err != nil {
		return &State{}
	}
	// Expire after 24h
	if time.Now().UnixMilli()-st.UpdatedAt > 24*60*60*1000 {
		return &State{}
	}
	return &st
}

func saveState(jsonPath string, st *State) error {
	dir := stateDir()
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	st.UpdatedAt = time.Now().UnixMilli()
	p := statePath(jsonPath)
	tmp, err := os.CreateTemp(dir, ".state-*.json")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	if err := json.NewEncoder(tmp).Encode(st); err != nil {
		tmp.Close()
		os.Remove(tmpName)
		return err
	}
	tmp.Close()
	return os.Rename(tmpName, p)
}

// ── UUID & timestamps ─────────────────────────────────────────────────────────

func newUUID() string {
	var b [16]byte
	rand.Read(b[:])
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x",
		b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}

var lastTs atomic.Int64

func uniqueTimestamp() int64 {
	now := time.Now().UnixMilli()
	for {
		prev := lastTs.Load()
		next := now
		if next <= prev {
			next = prev + 1
		}
		if lastTs.CompareAndSwap(prev, next) {
			return next
		}
	}
}

// ── Helpers ───────────────────────────────────────────────────────────────────

func hasTag(t *Task, tag string) bool {
	for _, tg := range t.Tags {
		if strEqFold(tg, tag) {
			return true
		}
	}
	return false
}

func strEqFold(a, b string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := 0; i < len(a); i++ {
		ca, cb := a[i], b[i]
		if ca >= 'A' && ca <= 'Z' {
			ca += 32
		}
		if cb >= 'A' && cb <= 'Z' {
			cb += 32
		}
		if ca != cb {
			return false
		}
	}
	return true
}

func nowMs() int64 { return time.Now().UnixMilli() }

func cloneTask(t *Task) *Task {
	c := *t
	if t.Priority != nil {
		v := *t.Priority
		c.Priority = &v
	}
	if t.Order != nil {
		v := *t.Order
		c.Order = &v
	}
	if t.Due != nil {
		v := *t.Due
		c.Due = &v
	}
	if t.Wait != nil {
		v := *t.Wait
		c.Wait = &v
	}
	if t.Sched != nil {
		v := *t.Sched
		c.Sched = &v
	}
	if t.Start != nil {
		v := *t.Start
		c.Start = &v
	}
	if t.End != nil {
		v := *t.End
		c.End = &v
	}
	if t.WaitTime != nil {
		wt := *t.WaitTime
		c.WaitTime = &wt
	}
	if t.Color != nil {
		col := *t.Color
		c.Color = &col
	}
	c.Tags = append([]string(nil), t.Tags...)
	c.Depends = append([]string(nil), t.Depends...)
	c.Annotations = append([]Annotation(nil), t.Annotations...)
	c.Track = append([]TrackEntry(nil), t.Track...)
	c.Touches = t.Touches
	return &c
}

func findTask(store *Store, uuid string) *Task {
	for _, t := range store.Tasks {
		if t.UUID == uuid {
			return t
		}
	}
	return nil
}

func findProject(store *Store, name string) *Project {
	for _, p := range store.Projects {
		if p.Name == name {
			return p
		}
	}
	return nil
}

func isRefProject(p *Project) bool {
	if p == nil {
		return false
	}
	for _, tag := range p.Tags {
		if strEqFold(tag, "reference") || strEqFold(tag, "ref") {
			return true
		}
	}
	return false
}
