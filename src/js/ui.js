import { getDaysRemaining } from './logic.js';
let projectMetadata = {};

export const setProjectMetadata = (meta) => {
    projectMetadata = {};
    if(meta && meta.length) {
        meta.forEach(m => projectMetadata[m.name] = m);
    }
};

export const print = (html, append = true) => {
    const term = document.getElementById('terminal-output');
    if (!append) term.innerHTML = '';
    const div = document.createElement('div');
    div.innerHTML = html;
    term.appendChild(div);
    term.scrollTop = term.scrollHeight;
};

export const formatProject = (proj) => {
    if (!proj) return '';
    
    // Check for icon
    let iconHtml = '';
    // Check exact match or parent match if we want inheritance, but let's stick to simple lookup first.
    // If strict match:
    if (projectMetadata[proj] && projectMetadata[proj].icon) {
        iconHtml = `<i class="${projectMetadata[proj].icon}" style="margin-right:4px;"></i>`;
    } 
    // If we wanted inheritance (e.g. Work.Project gets Work icon), we'd split and loop.
    // Let's support simple inheritance: check 'Work.Project', then 'Work'.
    else {
        const parts = proj.split('.');
        while(parts.length > 0) {
            const p = parts.join('.');
            if (projectMetadata[p] && projectMetadata[p].icon) {
                iconHtml = `<i class="${projectMetadata[p].icon}" style="margin-right:4px;"></i>`;
                break;
            }
            parts.pop();
        }
    }

    const parts = proj.split('.');
    let html = '';
    for (let i = 0; i < parts.length; i++) {
        const isLeaf = i === parts.length - 1;
        html += `<span class="${isLeaf ? 'row-proj-leaf' : 'row-proj-parent'}">${parts[i]}</span>`;
        if (!isLeaf) html += '<span class="row-proj-parent">.</span>';
    }
    return iconHtml + html;
};

export const renderTable = (tasks, allTasks, displayMapRef, projects = []) => {
    setProjectMetadata(projects);
    if (!tasks || tasks.length === 0) return print('<span class="msg-info">No tasks found.</span>', false);
    
    displayMapRef.value = tasks.map(t => t.uuid);
    
    let html = `
    <div class="table-wrapper">
    <table>
        <thead><tr>
            <th style="width:25px">ID</th>
            <th>Description</th>
            <th style="width:40px; text-align:right">Urg</th>
        </tr></thead>
        <tbody>`;

    tasks.forEach((t, index) => {
        let desc = t.description;
        
        let tagsHtml = '';
        if (t.tags && t.tags.length > 0) {
            t.tags.forEach(tag => {
                tagsHtml += ` <span class="tag-pill">+${tag}</span>`;
            });
        }
        
        // Enrich description with project, priority etc if not simple list
        let metaHtml = '';
        if (t.project) metaHtml += ` ${formatProject(t.project)}`;
        if (t.priority) metaHtml += ` <span style="color:${t.priority==='H'?'var(--red)':(t.priority==='M'?'var(--yellow)':'var(--base01)')}; font-weight:bold">pri:${t.priority}</span>`;
        
        if (t.due) {
            const daysCheck = getDaysRemaining(t.due);
            let cls = 'date-far';
            if (daysCheck < 2) cls = 'date-urgent';
            else if (daysCheck < 7) cls = 'date-soon';
            metaHtml += ` <span class="date-pill ${cls}">(${daysCheck}d)</span>`;
        }
        if (t.wait && t.wait > Date.now()) {
             metaHtml += ` <span class="date-pill date-wait">wait:${new Date(t.wait).toISOString().slice(0,10).replace(/-/g,'')}</span>`;
        }
        if (t.recur) {
             metaHtml += ` <span class="recur-icon">↻${t.recur}</span>`;
        }
        if (t.depends && t.depends.length > 0) {
             const activeDeps = allTasks.filter(tsk => t.depends.includes(tsk.uuid) && tsk.status === 'pending');
             if(activeDeps.length > 0) {
                 metaHtml += ` <span class="blocked-pill">dep:${activeDeps.length}</span>`;
             }
        }
        if (t.annotations && t.annotations.length > 0) {
            metaHtml += ` <span class="anno-count">msg:${t.annotations.length}</span>`;
        }

        html += `<tr>
            <td class="row-id">${index + 1}</td>
            <td class="row-desc">${desc}${metaHtml}${tagsHtml}</td>
            <td class="row-urgency">${t.urgency}</td>
        </tr>`;
    });

    html += `</tbody></table></div>`;
    html += `<div style="font-size:0.8em; color:var(--base01)">${tasks.length} tasks shown.</div>`;
    
    // renderChain is effectively dead code in this modular version unless imported/refactored, 
    // keeping ui.js consistent with previous file but updated.
    
    print(html, false);
};
