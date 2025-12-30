import { formatDate } from './utils.js';

export const C = { next: 15.0, due: 12.0, blocking: 8.0, blocked: -5.0, priority: { H: 6.0, M: 3.9, L: 1.8 }, age: 2.0, project: 1.0 };

export const calculateUrgency = (t, allTasks) => {
    if (t.wait && t.wait > Date.now()) return -10.0;
    let u = 0.0;
    if (t.tags && t.tags.includes('next')) u += C.next;
    if (t.priority && C.priority[t.priority]) u += C.priority[t.priority];
    if (t.project) u += C.project;
    const ageDays = (Date.now() - t.entry) / (1000 * 60 * 60 * 24);
    u += (ageDays > 100 ? C.age : (ageDays / 100) * C.age);
    if (t.due) {
        const daysLeft = (t.due - Date.now()) / (1000 * 60 * 60 * 24);
        if (daysLeft <= 2) u += C.due; 
        else if (daysLeft <= 14) u += C.due * (1 - (daysLeft - 2) / 12);
    }
    // Check blocking (t blocks o) - if any 'o' is pending and depends on 't'
    const isBlocking = allTasks.some(o => o.status === 'pending' && o.depends?.includes(t.uuid));
    if (isBlocking) u += C.blocking;

    // Check blocked (t depends on d) - if any 'd' is pending
    if (t.depends?.length > 0) {
        if (allTasks.filter(d => t.depends.includes(d.uuid)).some(d => d.status === 'pending')) u += C.blocked;
    }
    return u.toFixed(1);
};

export const getDaysRemaining = (due, now = Date.now()) => {
    return Math.floor((due - now) / (1000 * 60 * 60 * 24));
};

export const matchesProject = (taskProj, filterProj) => {
    if (!filterProj) return true;
    if (!taskProj) return false;
    if (taskProj === filterProj) return true;
    return taskProj.startsWith(filterProj + '.');
};

export const hasVirtualTag = (t, tag, allTasks) => {
    const now = Date.now();
    const tagClean = tag.replace(/^\+/, '').toUpperCase();
    if (tagClean === 'OVERDUE') return t.due && t.due < now && t.status === 'pending';
    if (tagClean === 'TODAY') return t.due && formatDate(t.due) === formatDate(now);
    if (tagClean === 'WAITING') return t.wait && t.wait > now && t.status === 'pending';
    if (tagClean === 'BLOCKED') return t.depends?.length > 0 && allTasks.filter(d => t.depends.includes(d.uuid)).some(d => d.status === 'pending');
    return false;
};

export const VALID_COMMANDS = ['add', 'log', 'list', 'ls', 'next', 'done', 'delete', 'rm', 'modify', 'mod', 'export', 'import', 'help', 'clear', 'annotate', 'info', 'chain', 'projects', 'proj'];

export const resolveCommand = (str) => {
    const matches = VALID_COMMANDS.filter(c => c.startsWith(str));
    return matches.length === 1 ? matches[0] : null;
};
