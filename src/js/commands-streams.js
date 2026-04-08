// Stream view handler - renders the `ss` (streams) command output

import { dbOps } from "./db.js";
import { displayMapRef, zippedUuids } from "./state.js";
import { formatTaskDescription, formatInlineCode } from "./ui.js";

const colorMap = {
  b: "var(--blue)",
  v: "var(--violet)",
  o: "var(--orange)",
  c: "var(--cyan)",
  g: "var(--green)",
  y: "var(--yellow)",
  r: "var(--red)",
  m: "var(--magenta)",
};

const iconClass = (name) =>
  name?.startsWith("ph-") ? name : `ph-light ph-${name}`;

const sortStreams = (a, b) => {
  const aOrd = a.order != null ? a.order : Infinity;
  const bOrd = b.order != null ? b.order : Infinity;
  if (aOrd !== bOrd) return aOrd - bOrd;
  return (a.entry || 0) - (b.entry || 0);
};

export const handleStreams = async (args, print) => {
  const all = await dbOps.getByStatus("pending");
  const projects = await dbOps.getAllProjects();

  const streams = all.filter((t) =>
    t.tags?.some((tg) => tg.toLowerCase() === "stream"),
  );

  if (streams.length === 0) {
    print('<span class="msg-info">No streams.</span>', false);
    return;
  }

  const active = streams.filter((t) => !!t.start).sort(sortStreams);
  const yielding = streams.filter((t) => !t.start).sort(sortStreams);
  const allOrdered = [...active, ...yielding];

  displayMapRef.value = allOrdered.map((t) => t.uuid);

  const container = document.createElement("div");

  const renderRow = (t, idx, yielding = false) => {
    const tr = document.createElement("tr");
    if (yielding) tr.style.filter = "saturate(0.4) brightness(0.7)";

    // ID
    const tdId = document.createElement("td");
    tdId.className = "row-id";
    tdId.textContent = idx + 1;
    tr.appendChild(tdId);

    // Description + metadata
    const tdDesc = document.createElement("td");
    tdDesc.className = "row-desc";

    if (t.order != null) {
      const ob = document.createElement("span");
      ob.className = "order-badge";
      ob.textContent = t.order;
      tdDesc.appendChild(ob);
    }

    if (t.icon) {
      const i = document.createElement("i");
      i.className = iconClass(t.icon);
      i.style.marginRight = "5px";
      if (t.color?.icon && colorMap[t.color.icon]) {
        i.style.color = colorMap[t.color.icon];
      }
      tdDesc.appendChild(i);
    }

    const descSpan = document.createElement("span");
    descSpan.innerHTML = formatTaskDescription(t);
    tdDesc.appendChild(descSpan);

    // URL link icon
    if (t.url) {
      const a = document.createElement("a");
      a.href = t.url;
      a.target = "_blank";
      a.rel = "noopener";
      a.className = "task-link";
      a.style.marginLeft = "4px";
      a.innerHTML = '<i class="ph-light ph-link"></i>';
      tdDesc.appendChild(a);
    }

    // Project
    if (t.project) {
      tdDesc.appendChild(document.createTextNode(" "));
      const pMeta = projects.find((p) => p.name === t.project);
      const projSpan = document.createElement("span");
      projSpan.style.color = "var(--yellow)";
      let projHtml = "";
      if (pMeta?.icon) {
        projHtml += `<i class="${iconClass(pMeta.icon)}" style="margin-right:3px"></i>`;
      }
      projHtml += t.project;
      projSpan.innerHTML = projHtml;
      tdDesc.appendChild(projSpan);
    }

    // Tags (hide the stream tag itself)
    const visibleTags = (t.tags || []).filter(
      (tg) => tg.toLowerCase() !== "stream",
    );
    visibleTags.forEach((tag) => {
      tdDesc.appendChild(document.createTextNode(" "));
      const tagSpan = document.createElement("span");
      tagSpan.className = "tag-pill";
      tagSpan.textContent = tag;
      tdDesc.appendChild(tagSpan);
    });

    // Annotations count
    if (t.annotations && t.annotations.length > 0) {
      tdDesc.appendChild(document.createTextNode(" "));
      const annoSpan = document.createElement("span");
      annoSpan.className = "anno-count";
      annoSpan.textContent = `msg:${t.annotations.length}`;
      tdDesc.appendChild(annoSpan);
    }

    tr.appendChild(tdDesc);

    // Empty urgency cell (keeps column alignment with standard table CSS)
    const tdUrg = document.createElement("td");
    tdUrg.className = "row-urgency";
    tr.appendChild(tdUrg);

    return tr;
  };

  const renderZipRow = (t, isYielding) => {
    const tr = document.createElement("tr");
    if (isYielding) tr.style.filter = "saturate(0.4) brightness(0.7)";
    const tdId = document.createElement("td");
    tr.appendChild(tdId);
    const tdContent = document.createElement("td");
    tdContent.colSpan = 2;
    tdContent.style.cssText =
      "padding: 1px 4px 6px 16px; color: var(--base01); font-size: 0.9em; line-height: 1.6;";
    (t.annotations || []).forEach((ann) => {
      const div = document.createElement("div");
      const date = new Date(ann.entry).toISOString().slice(0, 10);
      div.innerHTML = `<span style="opacity:0.5; margin-right:10px;">${date}</span>${formatInlineCode(ann.description)}`;
      tdContent.appendChild(div);
    });
    tr.appendChild(tdContent);
    return tr;
  };

  const renderSection = (sectionTasks, label, color, startIdx) => {
    if (sectionTasks.length === 0) return startIdx;

    const sep = document.createElement("div");
    sep.style.cssText =
      "border-bottom:1px solid var(--base01); margin-bottom:2px; margin-top:8px;";
    const labelSpan = document.createElement("span");
    labelSpan.style.color = color;
    labelSpan.textContent = label;
    sep.appendChild(labelSpan);
    container.appendChild(sep);

    const wrapper = document.createElement("div");
    wrapper.className = "table-wrapper";
    const table = document.createElement("table");
    const tbody = document.createElement("tbody");
    table.appendChild(tbody);
    wrapper.appendChild(table);
    const isYielding = label === "yielding";
    sectionTasks.forEach((t, i) => {
      tbody.appendChild(renderRow(t, startIdx + i, isYielding));
      if (zippedUuids.has(t.uuid))
        tbody.appendChild(renderZipRow(t, isYielding));
    });
    container.appendChild(wrapper);

    return startIdx + sectionTasks.length;
  };

  let idx = 0;
  idx = renderSection(active, "active", "var(--cyan)", idx);
  idx = renderSection(yielding, "yielding", "var(--base01)", idx);

  const footer = document.createElement("div");
  footer.style.fontSize = "0.8em";
  footer.style.color = "var(--base01)";
  const parts = [];
  if (active.length) parts.push(`${active.length} active`);
  if (yielding.length) parts.push(`${yielding.length} yielding`);
  footer.textContent = `${streams.length} stream${streams.length === 1 ? "" : "s"} (${parts.join(", ")}).`;
  container.appendChild(footer);

  print(container, false);
};
