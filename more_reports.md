Suggested by Gemini

### 1. `report forecast` (Predictability & Capacity Planning)
**Purpose:** Answers "When will we be done?" using data, not hope.
**Method:**
1.  Calculate **Average Velocity** ($V_{avg}$) over the last 4 weeks (tasks completed/week).
2.  Count **Pending Backlog** ($N_{pending}$) matching the current filter.
3.  Calculate **ETA Weeks** = $N_{pending} / V_{avg}$.
4.  Project the completion date.

---

### 2. `report churn` (Efficiency & Context Switching)
**Purpose:** Specific metric for "Thrashing"—working hard but feeling unproductive.
**Method:**
1.  Scan `start` and `end` timestamps for the requested period (default 1w).
2.  Extract the set of unique Project names touched: $P_{active} = \{p \mid \exists t \in \text{Tasks}: t.project = p \land (t.started \lor t.completed)\}$.
3.  Metric = $|P_{active}|$ (Cardinality of the set).

---

### 3. `report audit` (Signal-to-Noise Ratio)
**Purpose:** Identifies "Alert Fatigue" in recurring tasks.
**Method:**
1.  Filter for recurring tasks (parent templates or generated instances).
2.  Count total instances created in the window.
3.  Count instances resolved via `skip`.
4.  Metric: **Skip Rate** = $\frac{\text{Skipped}}{\text{Total}}$.