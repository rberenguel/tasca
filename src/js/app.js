import { generateUUID, parseDate, formatDate, addDays, addMonths } from './utils.js';
import { initDB, dbOps } from './db.js';
import { C, calculateUrgency, hasVirtualTag, resolveCommand, matchesProject, getDaysRemaining } from './logic.js';
import { print, renderTable, formatProject } from './ui.js';

let displayMap = [];
const displayMapRef = { value: displayMap }; // reference wrapper for ui module
let knownProjects = new Set();
let knownTags = new Set();

const updateCache = (tasks) => {
    knownProjects.clear(); knownTags.clear();
    tasks.forEach(t => {
        if(t.project) knownProjects.add(t.project);
        if(t.tags) t.tags.forEach(tag => knownTags.add(tag));
    });
};

const execute = async (str) => {
    dbOps.check();

    try {
        const parts = str.trim().split(/\s+/);
        if(!parts.length || parts[0] === '') return;
        if(parts[0] === 'task') parts.shift();

        let rawCmd = parts[0];
        let cmd = resolveCommand(rawCmd);
        if (!cmd && rawCmd.match(/^\d+$/)) cmd = 'info'; 
        if (!cmd) cmd = rawCmd; 

        let args = parts.slice(1);
        let targetId = rawCmd.match(/^\d+$/) ? parseInt(rawCmd) : null;

        if (cmd === 'export') {
            const all = await dbOps.getAll();
            const dataStr = JSON.stringify(all, null, 2);
            const blob = new Blob([dataStr], {type: "application/json"});
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = url; a.download = `tasca_${new Date().toISOString().slice(0,10).replace(/-/g,'')}.json`;
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            print(`<span class="msg-success">Exported ${all.length} tasks.</span>`);
        }
        else if (cmd === 'import') document.getElementById('import-picker').click();
        else if (cmd === 'clear') document.getElementById('terminal-output').innerHTML = '';

        else if (['add', 'log'].includes(cmd)) {
            let desc = [], proj = "", priority = "", tags = [], depends = [], due = null, wait = null, recur = null;
            for (let token of args) {
                if (token.startsWith('pro:') || token.startsWith('project:')) proj = token.split(':')[1];
                else if (token.startsWith('pri:') || token.startsWith('priority:')) priority = token.split(':')[1].toUpperCase();
                else if (token.startsWith('dep:')) token.split(':')[1].split(',').forEach(id => { if(displayMapRef.value[id-1]) depends.push(displayMapRef.value[id-1]); });
                else if (token.startsWith('due:')) due = parseDate(token.split(':')[1]);
                else if (token.startsWith('wait:')) wait = parseDate(token.split(':')[1]);
                else if (token.startsWith('recur:')) recur = token.split(':')[1];
                else if (token.startsWith('+')) tags.push(token.substring(1));
                else desc.push(token);
            }
            if (desc.length === 0) return print('<span class="msg-error">No description.</span>');
            await dbOps.add({ uuid: generateUUID(), description: desc.join(' '), project: proj, priority, tags, depends, due, wait, recur, annotations:[], status: 'pending', entry: Date.now() });
            execute('list');
        }

        else if (['list', 'ls', 'next'].includes(cmd)) {
            const all = await dbOps.getAll();
            let pending = all.filter(t => t.status === 'pending');
            let search = [], fProj = null, fTags = [];
            let showWaiting = false;

            for (let token of args) {
                if (token.startsWith('pro:') || token.startsWith('project:')) fProj = token.split(':')[1];
                else if (token.startsWith('+')) {
                    const tag = token.substring(1);
                    if (tag.toUpperCase() === 'WAITING' || tag.toUpperCase() === 'ALL') showWaiting = true;
                    fTags.push(token);
                }
                else search.push(token.toLowerCase());
            }

            if (!showWaiting) pending = pending.filter(t => !t.wait || t.wait <= Date.now());
            if (fProj) pending = pending.filter(t => matchesProject(t.project, fProj));
            if (fTags.length) {
                pending = pending.filter(t => fTags.every(ft => {
                    const tag = ft.substring(1);
                    if (t.tags && t.tags.includes(tag)) return true;
                    if (hasVirtualTag(t, ft, all)) return true;
                    return false;
                }));
            }
            if (search.length) pending = pending.filter(t => search.every(s => t.description.toLowerCase().includes(s)));
            pending.forEach(t => t.urgency = calculateUrgency(t, all));
            pending.sort((a,b) => parseFloat(b.urgency) - parseFloat(a.urgency));
            renderTable(pending, all, displayMapRef);
        }

        else if (cmd === 'chain') {
            const id = parseInt(args[0]);
            if (!id || !displayMapRef.value[id-1]) return print('<span class="msg-error">Invalid ID.</span>');
            const rootUuid = displayMapRef.value[id-1];
            const all = await dbOps.getAll();
            // Chain visualization logic is complex. To save space in plan I will keep it simple or reimplement. 
            // The original implementation was inline. I will reimplement in ui.js or keep here.
            // For now, let's keep it here but I need to adapt it. 
            // Re-implementing simplified chain logic for brevity as I cannot simply import the old one.
            
            // ... (Chain logic logic adapted from index.html)
            const pending = all.filter(t => t.status === 'pending');
            const blocking = {}; const uuidMap = {};
            pending.forEach(t => { uuidMap[t.uuid] = t; if (t.depends) t.depends.forEach(dep => { if (!blocking[dep]) blocking[dep] = []; blocking[dep].push(t.uuid); }); });
            
            // ... (Traversal logic) ...
            // Since this is a direct extraction, I'll copy the logic logic if possible, 
            // but for safety/simplicity in this step, I'll print a placeholder or minimally implement.
            // User requested refactor, so better to be complete.
            
            // Re-use logic:
            const ancestors = new Set();
            const getAncestors = (curr) => { const t = uuidMap[curr]; if(!t || !t.depends) return; t.depends.forEach(d => { if(uuidMap[d] && !ancestors.has(d)) { ancestors.add(d); getAncestors(d); }}); };
            getAncestors(rootUuid);
            
            const descendants = new Set();
            const getDescendants = (curr) => { if(blocking[curr]) blocking[curr].forEach(b => { if(uuidMap[b] && !descendants.has(b)) { descendants.add(b); getDescendants(b); }}); };
            getDescendants(rootUuid);
            
            const relevantUUIDs = new Set([...ancestors, rootUuid, ...descendants]);
            const roots = [];
            relevantUUIDs.forEach(u => { const t = uuidMap[u]; if (!(t.depends && t.depends.some(d => relevantUUIDs.has(d)))) roots.push(u); });
            
            let html = '<div style="line-height: 1.5; font-family: monospace;">';
            const renderFinal = (u, prefix, isTail) => {
                const t = uuidMap[u];
                const isTarget = u === rootUuid;
                let treeMarker = "";
                if (prefix.length > 0 || isTail !== undefined) treeMarker = `<span style="color:var(--base01)">${prefix}${isTail ? '└── ' : '├── '}</span>`;
                
                let content = `<span style="${isTarget ? 'color:var(--yellow); font-weight:bold' : ''}">ID:${displayMapRef.value.indexOf(u)+1} ${t.description}</span>`;
                if (t.tags && t.tags.length) content += ` <span style="color:var(--blue)">${t.tags.map(tag=>'+'+tag).join(' ')}</span>`;
                if(t.project) content += ` <span style="color:var(--yellow)">${t.project}</span>`;
                
                html += `<div>${treeMarker}${content}</div>`;
                
                const children = blocking[u] ? blocking[u].filter(c => relevantUUIDs.has(c)) : [];
                children.forEach((child, i) => {
                    const childIsTail = i === children.length - 1;
                    let nextPrefix = prefix;
                    if (isTail !== undefined) nextPrefix += isTail ? '    ' : '│   ';
                    renderFinal(child, nextPrefix, childIsTail);
                });
            };
            if (roots.length === 0 && relevantUUIDs.size > 0) renderFinal(rootUuid, '', undefined);
            else roots.forEach(r => renderFinal(r, '', undefined));
            html += '</div>';
            print(html, false);
        }

        else if (cmd === 'annotate') {
            const id = parseInt(args[0]);
            if (!id || !displayMapRef.value[id-1]) return print('<span class="msg-error">Invalid ID.</span>');
            const task = await dbOps.get(displayMapRef.value[id-1]);
            const note = args.slice(1).join(' ');
            if(!note) return print('<span class="msg-error">No annotation text.</span>');
            if(!task.annotations) task.annotations = [];
            task.annotations.push({ entry: Date.now(), description: note });
            await dbOps.update(task);
            execute('list');
        }

        else if (cmd === 'info') {
            const id = parseInt(args[0] || rawCmd);
            if (!id || !displayMapRef.value[id-1]) return print('<span class="msg-error">Invalid ID.</span>');
            const t = await dbOps.get(displayMapRef.value[id-1]);
            let html = `<div style="border:1px solid var(--base01); padding:10px; margin-bottom:10px">`;
            html += `<div style="color:var(--yellow)">Task ${id} - ${t.uuid}</div>`;
            html += `<div><b>Desc:</b> ${t.description}</div>`;
            html += `<div><b>Status:</b> ${t.status}</div>`;
            if(t.project) html += `<div><b>Project:</b> ${t.project}</div>`;
            if(t.due) html += `<div><b>Due:</b> ${formatDate(t.due)}</div>`;
            if(t.wait) html += `<div><b>Wait:</b> ${formatDate(t.wait)}</div>`;
            if(t.recur) html += `<div><b>Recur:</b> ${t.recur}</div>`;
            if(t.annotations && t.annotations.length > 0) {
                 html += `<div style="margin-top:5px; border-top:1px dashed var(--base01); padding-top:5px"><b>Annotations:</b></div>`;
                 t.annotations.forEach(a => { html += `<div style="margin-left:10px; font-size:0.9em; color:var(--base1)">${formatDate(a.entry)}: ${a.description}</div>`; });
            }
            html += `</div>`;
            print(html, false);
        }

        else if (targetId && (args[0] === 'mod' || args[0] === 'modify') || (['modify','mod'].includes(cmd) && args[0].match(/^\d+$/))) {
            const id = targetId || parseInt(args[0]);
            const tokens = targetId ? args : args.slice(1);
            if (!id || !displayMapRef.value[id-1]) return print('<span class="msg-error">Invalid ID.</span>');
            const task = await dbOps.get(displayMapRef.value[id-1]);
            tokens.forEach(token => {
                if (token.startsWith('pri:')) task.priority = token.split(':')[1].toUpperCase();
                if (token.startsWith('pro:')) task.project = token.split(':')[1];
                if (token.startsWith('due:')) task.due = parseDate(token.split(':')[1]);
                if (token.startsWith('wait:')) task.wait = parseDate(token.split(':')[1]);
                if (token.startsWith('recur:')) task.recur = token.split(':')[1];
                if (token.startsWith('+')) task.tags.push(token.substring(1));
                if (token.startsWith('dep:')) {
                     if(!task.depends) task.depends = [];
                     token.split(':')[1].split(',').forEach(i => { if(displayMapRef.value[i-1]) task.depends.push(displayMapRef.value[i-1]); });
                }
            });
            await dbOps.update(task);
            execute('list');
        }

        else if (cmd === 'done' || (targetId && args[0] === 'done')) {
            const id = targetId || parseInt(args.find(a => a.match(/^\d+$/)));
            if (!id || !displayMapRef.value[id-1]) return print('<span class="msg-error">Invalid ID.</span>');
            const task = await dbOps.get(displayMapRef.value[id-1]);
            if(task) { 
                task.status = 'completed'; 
                await dbOps.update(task);
                if(task.recur && task.due) {
                    let nextDue = null, nextWait = null;
                    if(task.recur.startsWith('dai')) nextDue = addDays(task.due, 1);
                    else if(task.recur.startsWith('wee')) nextDue = addDays(task.due, 7);
                    else if(task.recur.startsWith('mon')) nextDue = addMonths(task.due, 1);
                    else if(task.recur.startsWith('yea')) nextDue = addMonths(task.due, 12);
                    if (nextDue) {
                        if (task.wait) nextWait = nextDue - (task.due - task.wait);
                        const newTask = { ...task, uuid: generateUUID(), status: 'pending', due: nextDue, wait: nextWait, entry: Date.now(), annotations: [] };
                        delete newTask.depends; 
                        await dbOps.add(newTask);
                        print(`<span class="msg-success">Recurring task created.</span>`);
                    }
                }
                execute('list'); 
            }
        }

        else if (['delete', 'rm'].includes(cmd)) {
            const id = parseInt(args[0]);
            if (!id || !displayMapRef.value[id-1]) return print('<span class="msg-error">Invalid ID.</span>');
            await dbOps.delete(displayMapRef.value[id-1]);
            execute('list');
        }
        
        else if (cmd === 'help') {
            const sub = args[0];
            if (!sub) {
                print(`<span style="color:var(--yellow)">Commands:</span> add, list, done, delete, modify, annotate, info, chain, export, import. Type <span class="msg-hl">help [cmd]</span> for details.`);
            } else {
                const c = resolveCommand(sub);
                if (c === 'add') print(`<div class="msg-help"><span class="msg-hl">add</span> description <span class="msg-arg">pro:Project</span> <span class="msg-arg">pri:H/M/L</span> <span class="msg-arg">due:YYYYMMDD</span> <span class="msg-arg">wait:YYYYMMDD</span> <span class="msg-arg">recur:period</span> <span class="msg-arg">+tag</span></div>`);
                else if (c === 'modify') print(`<div class="msg-help"><span class="msg-hl">mod</span> ID [desc] <span class="msg-arg">pro:P</span> <span class="msg-arg">pri:H</span> <span class="msg-arg">due:Y</span> <span class="msg-arg">wait:Y</span> <span class="msg-arg">recur:P</span> <span class="msg-arg">+tag</span> <span class="msg-arg">dep:ID</span></div>`);
                else if (c === 'list') print(`<div class="msg-help"><span class="msg-hl">list</span> [search] <span class="msg-arg">pro:Project</span> <span class="msg-arg">+tag</span><br>Virtual: <span class="msg-arg">+OVERDUE</span> <span class="msg-arg">+TODAY</span> <span class="msg-arg">+WAITING</span> <span class="msg-arg">+BLOCKED</span> <span class="msg-arg">+ALL</span></div>`);
                else if (c === 'done') print(`<div class="msg-help"><span class="msg-hl">done</span> ID<br>Completes a task. If recurring, creates the next instance.</div>`);
                else if (c === 'delete') print(`<div class="msg-help"><span class="msg-hl">delete</span> ID<br>Permanently removes a task.</div>`);
                else if (c === 'annotate') print(`<div class="msg-help"><span class="msg-hl">annotate</span> ID <span class="msg-arg">note text...</span><br>Adds a timestamped note to a task.</div>`);
                else if (c === 'info') print(`<div class="msg-help"><span class="msg-hl">info</span> ID<br>Shows full details including annotations and full UUID.</div>`);
                else if (c === 'chain') print(`<div class="msg-help"><span class="msg-hl">chain</span> ID<br>Visualizes dependency tree for the specified task.</div>`);
                else print(`<span class="msg-error">No specific help for: ${sub}</span>`);
            }
        }

        else print(`<span class="msg-error">Unknown: ${cmd}</span>`);

    } catch (err) { console.error(err); print(`<span class="msg-error">Error: ${err.message}</span>`); }
};

// --- GHOST & AUTOCOMPLETE ---
const setupInput = () => {
    const input = document.getElementById('cmd-input');
    const ghost = document.getElementById('ghost-input');

    input.addEventListener('input', () => {
        const val = input.value;
        const parts = val.split(' ');
        const last = parts[parts.length - 1];
        let suggestion = "";
        
        if (parts.length === 1 && val.length > 0) {
            const match = resolveCommand(val);
            if (match && match !== val) suggestion = match.substring(val.length);
        }
        else if (last.startsWith('pro:') || last.startsWith('project:')) {
            const prefix = last.includes(':') ? last.split(':')[1] : "";
            if (prefix) {
                for (let p of knownProjects) {
                    if (p.startsWith(prefix) && p !== prefix) { suggestion = p.substring(prefix.length); break; }
                }
            }
        }
        else if (last.startsWith('+')) {
            const prefix = last.substring(1);
            if (prefix) {
                for (let t of knownTags) {
                    if (t.startsWith(prefix) && t !== prefix) { suggestion = t.substring(prefix.length); break; }
                }
            }
        }

        if (suggestion) {
            const prefixText = val; 
            ghost.innerHTML = `<span style="opacity:0">${prefixText}</span><span style="opacity:0.4">${suggestion}</span>`;
        } else {
            ghost.innerHTML = '';
        }
    });

    input.addEventListener('keydown', async (e) => {
        if (e.key === 'Tab') {
            e.preventDefault();
            const gText = ghost.textContent;
            if(gText) {
                input.value += gText.substring(input.value.length);
                ghost.innerHTML = '';
            }
        }
        if (e.key === 'Enter') { const val = input.value; input.value = ''; ghost.innerHTML = ''; await execute(val); }
    });
};

initDB().then(async () => {
    document.getElementById('import-picker').addEventListener('change', (e) => { 
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (ev) => {
            try {
                const data = JSON.parse(ev.target.result);
                for (const t of data) if (t.uuid) await dbOps.update(t);
                print(`<span class="msg-success">Imported tasks.</span>`);
                execute('list');
            } catch (err) { print(`<span class="msg-error">Error: ${err.message}</span>`); }
            e.target.value = '';
        };
        reader.readAsText(file);
    });
    
    setupInput();
    
    try { 
        const tasks = await dbOps.getAll(); 
        updateCache(tasks); 
        if(tasks.length > 0) execute('list'); 
    } catch(e){}
});
