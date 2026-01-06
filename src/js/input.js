import { resolveCommand } from "./logic.js";
import { knownProjects, knownTags, knownIcons, historyState } from "./state.js";

export const setupInput = (execute) => {
  const input = document.getElementById("cmd-input");
  const ghost = document.getElementById("ghost-input");

  const updateGhost = () => {
    const val = input.value;
    const parts = val.split(" ");
    const last = parts[parts.length - 1];
    let suggestion = "";

    if (parts.length === 1 && val.length > 0) {
      const match = resolveCommand(val);
      if (match && match !== val) suggestion = match.substring(val.length);
    } else if (
      last.startsWith("p:") ||
      last.startsWith("pro:") ||
      last.startsWith("proj:") ||
      last.startsWith("project:")
    ) {
      const prefix = last.includes(":") ? last.split(":")[1] : "";
      if (prefix) {
        for (let p of knownProjects) {
          if (p.startsWith(prefix) && p !== prefix) {
            const remainder = p.substring(prefix.length);
            const nextDot = remainder.indexOf(".", 1);
            if (nextDot !== -1) {
              suggestion = remainder.substring(0, nextDot);
            } else {
              suggestion = remainder;
            }
            break;
          }
        }
      }
    } else if (last.startsWith("!")) {
      const prefix = last.substring(1);
      if (prefix) {
        for (let t of knownTags) {
          if (t.startsWith(prefix) && t !== prefix) {
            suggestion = t.substring(prefix.length);
            break;
          }
        }
      }
    } else if (last.startsWith("icon:")) {
      const prefix = last.substring(5);
      if (prefix) {
        for (let i of knownIcons) {
          if (i.startsWith(prefix) && i !== prefix) {
            suggestion = i.substring(prefix.length);
            break;
          }
        }
      }
    }

    if (suggestion) {
      const prefixText = val;
      ghost.innerHTML = `<span style="opacity:0">${prefixText}</span><span style="opacity:0.4">${suggestion}</span>`;
    } else {
      ghost.innerHTML = "";
    }
  };

  input.addEventListener("input", updateGhost);
  // iOS fires compositionend after completing text input - ensure ghost updates
  input.addEventListener("compositionend", updateGhost);

  input.addEventListener("keydown", async (e) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const gText = ghost.textContent;
      if (gText) {
        input.value += gText.substring(input.value.length);
        ghost.innerHTML = "";
        input.dispatchEvent(new Event("input"));
      }
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (historyState.cmdHistory.length === 0) return;
      if (historyState.historyIndex === -1) {
        historyState.historyTemp = input.value;
        historyState.historyIndex = historyState.cmdHistory.length - 1;
      } else if (historyState.historyIndex > 0) {
        historyState.historyIndex--;
      }
      input.value = historyState.cmdHistory[historyState.historyIndex];
      ghost.innerHTML = "";
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyState.historyIndex === -1) return;
      if (historyState.historyIndex < historyState.cmdHistory.length - 1) {
        historyState.historyIndex++;
        input.value = historyState.cmdHistory[historyState.historyIndex];
      } else {
        historyState.historyIndex = -1;
        input.value = historyState.historyTemp;
      }
      ghost.innerHTML = "";
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const val = input.value.trim();
      input.value = "";
      ghost.innerHTML = "";
      if (val) {
        if (
          historyState.cmdHistory.length === 0 ||
          historyState.cmdHistory[historyState.cmdHistory.length - 1] !== val
        ) {
          historyState.cmdHistory.push(val);
          if (historyState.cmdHistory.length > 100)
            historyState.cmdHistory.shift();
          localStorage.setItem(
            "tasca_history",
            JSON.stringify(historyState.cmdHistory),
          );
        }
      }
      historyState.historyIndex = -1;
      historyState.historyTemp = "";
      await execute(val);
    }
  });

  // Touch gestures for history navigation and autocomplete on mobile
  const inputLine = document.querySelector(".input-line");
  let touchStartX = null;
  let touchStartY = null;
  inputLine.addEventListener("touchstart", (e) => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  });
  inputLine.addEventListener(
    "touchmove",
    (e) => {
      if (touchStartY !== null) {
        e.preventDefault();
      }
    },
    { passive: false },
  );
  inputLine.addEventListener("touchend", (e) => {
    if (touchStartX === null || touchStartY === null) return;
    const touchEndX = e.changedTouches[0].clientX;
    const touchEndY = e.changedTouches[0].clientY;
    const diffX = touchEndX - touchStartX;
    const diffY = touchStartY - touchEndY;
    touchStartX = null;
    touchStartY = null;

    // Determine if swipe is primarily horizontal or vertical
    if (Math.abs(diffX) > Math.abs(diffY) && diffX > 30) {
      // Swipe right - accept autocomplete
      const gText = ghost.textContent;
      if (gText) {
        input.value += gText.substring(input.value.length);
        ghost.innerHTML = "";
        input.dispatchEvent(new Event("input"));
      }
      return;
    }

    if (Math.abs(diffY) < 30) return;
    if (diffY > 0) {
      // Swipe up - previous command
      if (historyState.cmdHistory.length === 0) return;
      if (historyState.historyIndex === -1) {
        historyState.historyTemp = input.value;
        historyState.historyIndex = historyState.cmdHistory.length - 1;
      } else if (historyState.historyIndex > 0) {
        historyState.historyIndex--;
      }
      input.value = historyState.cmdHistory[historyState.historyIndex];
      ghost.innerHTML = "";
    } else {
      // Swipe down - next command
      if (historyState.historyIndex === -1) return;
      if (historyState.historyIndex < historyState.cmdHistory.length - 1) {
        historyState.historyIndex++;
        input.value = historyState.cmdHistory[historyState.historyIndex];
      } else {
        historyState.historyIndex = -1;
        input.value = historyState.historyTemp;
      }
      ghost.innerHTML = "";
    }
  });
};
