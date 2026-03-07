package main

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

func main() {
	// ── Parse global flags ────────────────────────────────────────────────────
	var file string
	var markdown bool
	var noColorFlag bool
	var remaining []string

	args := os.Args[1:]
	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "-f", "--file":
			i++
			if i < len(args) {
				file = args[i]
			}
		case "--markdown", "-m":
			markdown = true
		case "--no-color":
			noColorFlag = true
		default:
			remaining = append(remaining, args[i])
		}
	}

	// ── Colour init ───────────────────────────────────────────────────────────
	if noColorFlag {
		noColor = true
	}
	initColor()

	// ── Help doesn't need a file ──────────────────────────────────────────────
	if len(remaining) > 0 && (remaining[0] == "help" || remaining[0] == "?") {
		cmdHelp(remaining[1:])
		return
	}

	// ── Resolve JSON file ─────────────────────────────────────────────────────
	if file == "" {
		file = resolveFile()
	}
	if file == "" {
		fmt.Fprintln(os.Stderr, "No tasca JSON file found. Use -f <path> or set TASCA_FILE.")
		os.Exit(1)
	}

	opts := Options{Markdown: markdown, File: file, NoColor: noColorFlag}

	// ── Single-shot mode ──────────────────────────────────────────────────────
	if len(remaining) > 0 {
		if err := execute(remaining, file, opts); err != nil {
			fmt.Fprintln(os.Stderr, col(ansiRed, "Error: ")+err.Error())
			os.Exit(1)
		}
		return
	}

	// ── REPL mode ─────────────────────────────────────────────────────────────
	repl := &REPL{file: file, opts: opts}
	if err := repl.Run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func resolveFile() string {
	if v := os.Getenv("TASCA_FILE"); v != "" {
		return v
	}
	if _, err := os.Stat("tasca.json"); err == nil {
		abs, _ := filepath.Abs("tasca.json")
		return abs
	}
	home, _ := os.UserHomeDir()
	p := filepath.Join(home, "tasca.json")
	if _, err := os.Stat(p); err == nil {
		return p
	}
	return ""
}

// ── Command dispatch ──────────────────────────────────────────────────────────

func execute(args []string, file string, opts Options) error {
	if len(args) == 0 {
		args = []string{"next"}
	}

	// Normalise: merge split tokens like ["pro:", "Work"] → ["pro:Work"]
	args = normalizeArgs(args)

	// Resolve "ID COMMAND" syntax: "3 done" → done 3
	cmd, cmdArgs := resolveCommand(args)

	// Load store
	store, err := loadStore(file)
	if err != nil {
		// If file doesn't exist yet and command is import, start fresh
		if os.IsNotExist(err) && cmd == "import" {
			store = &Store{Tasks: []*Task{}, Projects: []*Project{}}
		} else {
			return fmt.Errorf("load %s: %w", file, err)
		}
	}

	// Load state
	state := loadState(file)

	// Dispatch
	var cmdErr error
	mutates := true

	switch cmd {
	case "next", "n":
		cmdErr = cmdNext(store, state, cmdArgs, opts)
	case "list", "ls", "l":
		cmdErr = cmdList(store, state, cmdArgs, opts)
	case "add", "a":
		cmdErr = cmdAdd(store, state, cmdArgs, opts)
	case "done":
		cmdErr = cmdDone(store, state, cmdArgs, opts)
	case "delete", "rm":
		cmdErr = cmdDelete(store, state, cmdArgs, opts)
	case "skip":
		cmdErr = cmdSkip(store, state, cmdArgs, opts)
	case "modify", "mod":
		cmdErr = cmdMod(store, state, cmdArgs, opts)
	case "start", "st":
		cmdErr = cmdStart(store, state, cmdArgs, opts)
	case "info", "i":
		mutates = false
		cmdErr = cmdInfo(store, state, cmdArgs, opts)
	case "annotate":
		cmdErr = cmdAnnotate(store, state, cmdArgs, opts)
	case "chain", "tree", "deps":
		mutates = false
		cmdErr = cmdChain(store, state, cmdArgs, opts)
	case "projects", "proj":
		mutates = false
		cmdErr = cmdProjects(store, state, cmdArgs, opts)
	case "context", "ctx", "c":
		mutates = false
		cmdErr = cmdContext(store, state, cmdArgs, opts)
	case "today", "day":
		mutates = false
		cmdErr = cmdToday(store, state, cmdArgs, opts)
	case "calendar", "cal":
		mutates = false
		cmdErr = cmdCalendar(store, state, cmdArgs, opts)
	case "report", "rep":
		mutates = false
		cmdErr = cmdReport(store, state, cmdArgs, opts)
	case "export", "exp":
		mutates = false
		cmdErr = cmdExport(store, state, cmdArgs, opts)
	case "import", "imp":
		cmdErr = cmdImport(store, state, cmdArgs, opts)
	case "help", "?":
		mutates = false
		cmdHelp(cmdArgs)
	default:
		return fmt.Errorf("unknown command: %s (try 'help')", cmd)
	}

	if cmdErr != nil {
		return cmdErr
	}

	// Save store if command mutates
	if mutates {
		if err := saveStore(file, store); err != nil {
			return fmt.Errorf("save: %w", err)
		}
	}

	// Always save state (display map)
	_ = saveState(file, state)
	return nil
}

// resolveCommand handles "ID CMD" syntax and returns (cmd, args).
func resolveCommand(args []string) (string, []string) {
	if len(args) == 0 {
		return "next", nil
	}

	// Check if first token looks like an ID (digits, commas, hyphens, x:)
	first := args[0]
	isID := isIDToken(first)

	if isID && len(args) >= 2 {
		// "3 done" or "1,3 mod !tag"
		possibleCmd := strings.ToLower(args[1])
		if isValidCommand(possibleCmd) {
			return possibleCmd, append([]string{first}, args[2:]...)
		}
		// "3" alone → info
		if len(args) == 1 {
			return "info", args
		}
	}

	// Bare number → info
	if isIDToken(first) && len(args) == 1 {
		return "info", args
	}

	return strings.ToLower(args[0]), args[1:]
}

func isIDToken(s string) bool {
	if strings.HasPrefix(s, "x:") {
		return true
	}
	for _, c := range s {
		if c != ',' && c != '-' && (c < '0' || c > '9') {
			return false
		}
	}
	return len(s) > 0
}

var validCommands = map[string]bool{
	"next": true, "n": true, "list": true, "ls": true, "l": true,
	"add": true, "a": true, "done": true, "delete": true, "rm": true,
	"skip": true, "modify": true, "mod": true, "start": true, "st": true,
	"info": true, "i": true, "annotate": true, "chain": true, "tree": true,
	"deps": true, "projects": true, "proj": true, "context": true, "ctx": true, "c": true,
	"today": true, "day": true, "calendar": true, "cal": true, "report": true, "rep": true,
	"export": true, "exp": true, "import": true, "imp": true,
	"help": true, "?": true,
}

func isValidCommand(s string) bool {
	return validCommands[s]
}

// normalizeArgs merges split tokens: ["pro:", "Work"] → ["pro:Work"]
func normalizeArgs(args []string) []string {
	colonPrefixes := map[string]bool{
		"p:": true, "pro:": true, "proj:": true, "project:": true,
		"pri:": true, "priority:": true, "due:": true, "wait:": true,
		"sched:": true, "scheduled:": true, "recur:": true, "rec:": true,
		"url:": true, "icon:": true, "dep:": true, "sort:": true,
		"s:": true, "lim:": true, "l:": true, "end:": true,
		"o:": true, "ord:": true, "order:": true, "x:": true, "target:": true,
		"c:": true, "color:": true, "until:": true, "u:": true,
	}
	var result []string
	for i := 0; i < len(args); i++ {
		lo := strings.ToLower(args[i])
		if colonPrefixes[lo] && i+1 < len(args) {
			result = append(result, args[i]+args[i+1])
			i++
		} else {
			result = append(result, args[i])
		}
	}
	return result
}

// ── REPL ──────────────────────────────────────────────────────────────────────

type REPL struct {
	file    string
	opts    Options
	history []string
	histPos int
}

func (r *REPL) Run() error {
	state, err := enableRawMode()
	if err != nil {
		// Fall back to simple line mode if raw mode fails
		return r.runSimple()
	}
	defer disableRawMode(state)

	var buf []rune
	cursor := 0
	r.histPos = len(r.history)

	reader := bufio.NewReader(os.Stdin)

	drawPrompt := func() {
		fmt.Printf("\r\x1b[K\x1b[1;36mtasca\x1b[0m> %s", string(buf))
		if cursor < len(buf) {
			fmt.Printf("\x1b[%dD", len(buf)-cursor)
		}
	}

	// Show initial next view
	disableRawMode(state)
	fmt.Println()
	_ = execute([]string{"next"}, r.file, r.opts)
	fmt.Println()
	state, _ = enableRawMode()
	drawPrompt()

	for {
		b, err := reader.ReadByte()
		if err != nil {
			if err == io.EOF {
				fmt.Print("\r\n")
				return nil
			}
			return err
		}

		switch b {
		case 3: // Ctrl+C
			if len(buf) == 0 {
				fmt.Print("\r\n")
				return nil
			}
			buf = nil
			cursor = 0
			fmt.Print("\r\n")
			drawPrompt()

		case 4: // Ctrl+D
			if len(buf) == 0 {
				fmt.Print("\r\n")
				return nil
			}

		case 127, 8: // Backspace / DEL
			if cursor > 0 {
				buf = append(buf[:cursor-1], buf[cursor:]...)
				cursor--
				drawPrompt()
			}

		case '\r', '\n':
			fmt.Print("\r\n")
			disableRawMode(state)

			input := strings.TrimSpace(string(buf))
			fmt.Println()
			if input == "" {
				// Naked enter: re-render current contextual view
				st := loadState(r.file)
				store, err := loadStore(r.file)
				if err == nil {
					_ = refreshView(store, st, r.opts)
				}
			} else {
				r.history = append(r.history, input)
				r.histPos = len(r.history)
				if input == "exit" || input == "quit" || input == "q" {
					return nil
				}
				args := strings.Fields(input)
				if err := execute(args, r.file, r.opts); err != nil {
					fmt.Println(col(ansiRed, "Error: ")+err.Error())
				}
			}
			fmt.Println()

			state, _ = enableRawMode()
			buf = nil
			cursor = 0
			drawPrompt()

		case '\t':
			completions, prefix := r.complete(string(buf))
			if len(completions) == 1 {
				rem := completions[0][len(prefix):]
				for _, ch := range rem {
					buf = append(buf[:cursor], append([]rune{ch}, buf[cursor:]...)...)
					cursor++
				}
				// Add a space after completed command
				buf = append(buf[:cursor], append([]rune{' '}, buf[cursor:]...)...)
				cursor++
				drawPrompt()
			} else if len(completions) > 1 {
				common := commonPrefix(completions)
				if len(common) > len(prefix) {
					rem := common[len(prefix):]
					for _, ch := range rem {
						buf = append(buf[:cursor], append([]rune{ch}, buf[cursor:]...)...)
						cursor++
					}
					drawPrompt()
				} else {
					disableRawMode(state)
					fmt.Print("\r\n")
					fmt.Println(strings.Join(completions, "  "))
					state, _ = enableRawMode()
					drawPrompt()
				}
			}

		case '\x1b': // Escape sequences
			b1, _ := reader.ReadByte()
			if b1 == '[' {
				b2, _ := reader.ReadByte()
				switch b2 {
				case 'A': // Up
					if r.histPos > 0 {
						r.histPos--
						buf = []rune(r.history[r.histPos])
						cursor = len(buf)
						drawPrompt()
					}
				case 'B': // Down
					if r.histPos < len(r.history)-1 {
						r.histPos++
						buf = []rune(r.history[r.histPos])
						cursor = len(buf)
						drawPrompt()
					} else if r.histPos == len(r.history)-1 {
						r.histPos++
						buf = nil
						cursor = 0
						drawPrompt()
					}
				case 'C': // Right
					if cursor < len(buf) {
						cursor++
						fmt.Print("\x1b[C")
					}
				case 'D': // Left
					if cursor > 0 {
						cursor--
						fmt.Print("\x1b[D")
					}
				case '3': // Delete key (ESC [ 3 ~)
					reader.ReadByte() // consume '~'
					if cursor < len(buf) {
						buf = append(buf[:cursor], buf[cursor+1:]...)
						drawPrompt()
					}
				}
			}

		default:
			if b >= 32 { // printable ASCII
				buf = append(buf[:cursor], append([]rune{rune(b)}, buf[cursor:]...)...)
				cursor++
				drawPrompt()
			}
		}
	}
}

// runSimple is a fallback REPL without raw mode (e.g. piped input).
func (r *REPL) runSimple() error {
	scanner := bufio.NewScanner(os.Stdin)
	fmt.Print("tasca> ")
	for scanner.Scan() {
		input := strings.TrimSpace(scanner.Text())
		if input == "exit" || input == "quit" || input == "q" {
			return nil
		}
		if input != "" {
			args := strings.Fields(input)
			if err := execute(args, r.file, r.opts); err != nil {
				fmt.Println("Error:", err)
			}
		}
		fmt.Print("\ntasca> ")
	}
	return scanner.Err()
}

// complete returns tab completions for the current input.
func (r *REPL) complete(input string) ([]string, string) {
	parts := strings.Fields(input)

	// Completing command name (first token)
	if len(parts) == 0 || (len(parts) == 1 && !strings.HasSuffix(input, " ")) {
		prefix := ""
		if len(parts) == 1 {
			prefix = parts[0]
		}
		var matches []string
		cmds := []string{
			"next", "list", "add", "done", "delete", "skip", "mod", "start",
			"info", "annotate", "chain", "projects", "context", "today", "calendar",
			"report", "export", "import", "help", "exit",
		}
		for _, c := range cmds {
			if strings.HasPrefix(c, prefix) {
				matches = append(matches, c)
			}
		}
		sort.Strings(matches)
		return matches, prefix
	}

	// Completing pro:, !tag from loaded store
	last := parts[len(parts)-1]

	if strings.HasPrefix(last, "pro:") || strings.HasPrefix(last, "p:") {
		pfxLen := strings.Index(last, ":") + 1
		valPrefix := last[pfxLen:]
		store, err := loadStore(r.file)
		if err != nil {
			return nil, last
		}
		seen := map[string]bool{}
		var matches []string
		for _, t := range store.Tasks {
			if t.Project != "" && !seen[t.Project] && strings.HasPrefix(t.Project, valPrefix) {
				seen[t.Project] = true
				matches = append(matches, last[:pfxLen]+t.Project)
			}
		}
		sort.Strings(matches)
		return matches, last
	}

	if strings.HasPrefix(last, "!") {
		prefix := last[1:]
		store, err := loadStore(r.file)
		if err != nil {
			return nil, last
		}
		seen := map[string]bool{}
		var matches []string
		// Real tags from store
		for _, t := range store.Tasks {
			for _, tag := range t.Tags {
				if !seen[tag] && strings.HasPrefix(tag, prefix) {
					seen[tag] = true
					matches = append(matches, "!"+tag)
				}
			}
		}
		// Virtual tags
		for _, vt := range []string{"today", "overdue", "waiting", "scheduled", "blocked", "done", "active", "recurring", "someday", "routine", "checklist"} {
			if strings.HasPrefix(vt, prefix) && !seen[vt] {
				matches = append(matches, "!"+vt)
			}
		}
		sort.Strings(matches)
		return matches, last
	}

	return nil, last
}

func commonPrefix(strs []string) string {
	if len(strs) == 0 {
		return ""
	}
	prefix := strs[0]
	for _, s := range strs[1:] {
		for !strings.HasPrefix(s, prefix) {
			prefix = prefix[:len(prefix)-1]
			if prefix == "" {
				return ""
			}
		}
	}
	return prefix
}
