import React, { useMemo, useState } from 'react';
import { useCollection, todayStr } from '../lib/hooks.js';
import { Empty, PCheck } from '../components/ui.jsx';
import * as db from '../lib/db.js';
import {
  normaliseTask, fmtTime, fmtDuration, minutesOf, hhmmOf,
  isScheduled, isEstimated, isOverdue, subtaskProgress, addSubtask, toggleSubtask,
  removeSubtask, completeTask, REPEATS, isEveryN, everyN, sortTasks, layoutDay,
  estimateStats, dayLoad, priorityOf, DEFAULT_BLOCK_MIN,
} from '../lib/todos.js';

// ---- TickTick-style TODO: smart lists + folders/lists, list / kanban / timeline ----
const PRI = { 3: { label: 'High', cls: 'p3', c: 'var(--red)' }, 2: { label: 'Medium', cls: 'p2', c: 'var(--yellow)' }, 1: { label: 'Low', cls: 'p1', c: 'var(--cyan)' }, 0: { label: 'None', cls: 'p0', c: 'var(--ink-3)' } };
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id' + Date.now() + Math.round(Math.random() * 1e6));
const z = n => String(n).padStart(2, '0');
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return `${x.getFullYear()}-${z(x.getMonth() + 1)}-${z(x.getDate())}`; };
const prettyDate = iso => {
  if (!iso) return '';
  const t = todayStr();
  if (iso === t) return 'Today';
  if (iso === addDays(new Date(), 1)) return 'Tomorrow';
  if (iso === addDays(new Date(), -1)) return 'Yesterday';
  try { return new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', weekday: 'short' }); } catch { return iso; }
};

const SMART = [
  { key: 'today', label: 'Today', icon: '☀' },
  { key: 'next7', label: 'Next 7 Days', icon: '▤' },
  { key: 'inbox', label: 'Inbox', icon: '↧' },
  { key: 'all', label: 'All', icon: '≡' },
  { key: 'done', label: 'Completed', icon: '✓' },
];

export default function Todos() {
  const { items: rawItems, add, patch, del } = useCollection('todos');
  // Normalised once, here, so the row, the detail panel and the day grid can
  // never disagree about what a task is. Three of this file's older bugs were
  // a field read one way in one place and another way in another.
  const items = useMemo(() => (rawItems || []).map(normaliseTask), [rawItems]);
  const { items: cfgMem, refresh: rCfg } = useCollection('memory', { filter: 'key=eq.todo_lists', order: 'key' });
  const cfg = cfgMem?.[0]?.value || { folders: [], lists: [] };

  const [view, setView] = useState({ type: 'smart', key: 'today' });
  const [mode, setMode] = useState('list'); // list | day | kanban | timeline
  const [navOpen, setNavOpen] = useState(false); // mobile drawer
  const [detail, setDetail] = useState(null); // task being edited
  const [openFolders, setOpenFolders] = useState({});
  const [adding, setAdding] = useState(null); // 'list' | 'folder' | null
  const [newName, setNewName] = useState('');
  const [folderForNewList, setFolderForNewList] = useState(null);
  // {kind:'list'|'folder', key} — the row currently swapped for an input.
  const [renaming, setRenaming] = useState(null);

  const today = todayStr();
  // The day the grid is showing. Its own state, so stepping to tomorrow does not
  // change which smart list is selected underneath.
  const [dayDate, setDayDate] = useState(todayStr());
  const week = addDays(new Date(), 7);

  async function saveCfg(next) { await db.upsertMemory('todo_lists', next); await rCfg(); }

  const listNames = useMemo(() => {
    const s = new Set(['Inbox']);
    cfg.lists?.forEach(l => s.add(l.name));
    items.forEach(t => t.list && s.add(t.list));
    return [...s];
  }, [cfg, items]);
  const listMeta = name => cfg.lists?.find(l => l.name === name) || { name, folder: null };
  const ungrouped = listNames.filter(n => n !== 'Inbox' && !listMeta(n).folder);

  const activeCount = fn => items.filter(t => !t.completed && fn(t)).length;
  const countSmart = k => {
    if (k === 'done') return items.filter(t => t.completed).length;
    if (k === 'today') return activeCount(t => t.due_date && t.due_date <= today);
    if (k === 'next7') return activeCount(t => t.due_date && t.due_date <= week);
    if (k === 'inbox') return activeCount(t => (t.list || 'Inbox') === 'Inbox');
    return activeCount(() => true);
  };
  const countList = name => activeCount(t => (t.list || 'Inbox') === name);

  const shown = useMemo(() => {
    let out;
    if (view.type === 'smart') {
      const k = view.key;
      if (k === 'done') out = items.filter(t => t.completed);
      else if (k === 'today') out = items.filter(t => !t.completed && t.due_date && t.due_date <= today);
      else if (k === 'next7') out = items.filter(t => !t.completed && t.due_date && t.due_date <= week);
      else if (k === 'inbox') out = items.filter(t => !t.completed && (t.list || 'Inbox') === 'Inbox');
      else out = items.filter(t => !t.completed);
    } else {
      out = items.filter(t => !t.completed && (t.list || 'Inbox') === view.key);
    }
    // Grouped by date first, then the model's own order within a day: timed work
    // in clock order, then priority, then manual, then title.
    return sortTasks(out).sort((a, b) => {
      const ad = a.due_date || '9999', bd = b.due_date || '9999';
      return ad === bd ? 0 : ad.localeCompare(bd);
    });
  }, [items, view, today, week]);

  const viewLabel = view.type === 'smart' ? SMART.find(s => s.key === view.key)?.label : view.key;
  const defaultList = view.type === 'list' ? view.key : 'Inbox';

  const [qa, setQa] = useState({ title: '', due: '', time: '', mins: '', pri: 0 });
  async function quickAdd() {
    if (!qa.title.trim()) return;
    const due = qa.due || (view.type === 'smart' && view.key === 'today' ? today : '');
    await add({
      title: qa.title.trim(),
      due_date: due || null,
      // A time is only stored when there is a date for it to sit on.
      due_time: due && minutesOf(qa.time) != null ? hhmmOf(minutesOf(qa.time)) : null,
      duration_min: Number(qa.mins) > 0 ? Math.round(Number(qa.mins)) : null,
      priority: qa.pri,
      list: defaultList,
      completed: false,
    });
    // Date, time and length persist between adds; the title does not. Logging
    // three things for the same afternoon should not mean typing the afternoon
    // three times.
    setQa(q => ({ ...q, title: '' }));
  }

  // Ticking off a repeating task creates the next occurrence and leaves this one
  // completed on its own date — decision 3 in lib/todos.js. Un-ticking is a
  // plain reversal and never generates anything: undoing a completion is not
  // the same event as completing it.
  async function toggle(t) {
    if (t.completed) {
      await patch(t.id, { completed: false, completed_at: null });
      return;
    }
    const { updated, next } = completeTask(t, { at: new Date() });
    await patch(t.id, { completed: true, completed_at: updated.completed_at });
    if (next) {
      const { id, ...row } = next;
      await add(row);
    }
  }
  async function pushToCalendar(t) {
    if (!t.due_date) return;
    await db.sendRequest('calendar_add', { summary: t.title, start: `${t.due_date}T09:00:00`, end: `${t.due_date}T09:30:00`, timeZone: 'Asia/Kolkata', allDay: true });
    patch(t.id, { notes: (t.notes || '').includes('[gcal]') ? t.notes : ((t.notes || '') + ' [gcal]').trim() });
  }

  async function addList() {
    const name = newName.trim(); if (!name) { setAdding(null); return; }
    if (!listNames.includes(name)) await saveCfg({ ...cfg, lists: [...(cfg.lists || []), { name, folder: folderForNewList }] });
    setAdding(null); setNewName(''); setFolderForNewList(null); setView({ type: 'list', key: name });
  }
  async function addFolder() {
    const name = newName.trim(); if (!name) { setAdding(null); return; }
    const id = 'f_' + uid().slice(0, 6);
    await saveCfg({ ...cfg, folders: [...(cfg.folders || []), { id, name }] });
    setOpenFolders(o => ({ ...o, [id]: true }));
    setAdding(null); setNewName('');
  }

  // A list's name is its identity in two separate places: the cfg entry that
  // remembers which folder it sits under, and the `list` column on every task
  // that belongs to it. Renaming one without the other either loses the folder
  // grouping or strands the tasks under a list no longer in the sidebar, so
  // both move together and the view follows if it was the one being renamed.
  async function renameList(oldName, raw) {
    const name = (raw || '').trim();
    setRenaming(null);
    if (!name || name === oldName) return;
    const meta = listMeta(oldName);
    const rest = (cfg.lists || []).filter(l => l.name !== oldName && l.name !== name);
    await saveCfg({ ...cfg, lists: [...rest, { ...meta, name }] });
    await Promise.all(items.filter(t => (t.list || 'Inbox') === oldName).map(t => patch(t.id, { list: name })));
    if (view.type === 'list' && view.key === oldName) setView({ type: 'list', key: name });
  }
  // Folders are referenced by a generated id, never by name, so this one is
  // only ever a label change — nothing else has to be repointed.
  async function renameFolder(id, raw) {
    const name = (raw || '').trim();
    setRenaming(null);
    if (!name) return;
    await saveCfg({ ...cfg, folders: (cfg.folders || []).map(f => (f.id === id ? { ...f, name } : f)) });
  }
  const isRen = (kind, key) => renaming && renaming.kind === kind && renaming.key === key;

  const pick = v => { setView(v); setNavOpen(false); };

  return (
    <div className="tt2">
      <aside className={`tt2-nav${navOpen ? ' open' : ''}`}>
        <div className="tt2-nav-h">Lists <button className="tt2-x" onClick={() => setNavOpen(false)}>✕</button></div>
        <div className="tt2-sec">
          {SMART.map(s => (
            <button key={s.key} className={`tt2-navitem${view.type === 'smart' && view.key === s.key ? ' on' : ''}`} onClick={() => pick({ type: 'smart', key: s.key })}>
              <span className="tt2-ico">{s.icon}</span><span className="tt2-nl">{s.label}</span>
              {countSmart(s.key) > 0 && <span className="tt2-ct">{countSmart(s.key)}</span>}
            </button>
          ))}
        </div>

        {(cfg.folders || []).map(f => {
          const fl = listNames.filter(n => listMeta(n).folder === f.id);
          const open = openFolders[f.id] !== false;
          return (
            <div className="tt2-sec" key={f.id}>
              {isRen('folder', f.id) ? (
                <input className="tt2-renin" autoFocus defaultValue={f.name}
                  onKeyDown={e => { if (e.key === 'Enter') renameFolder(f.id, e.target.value); if (e.key === 'Escape') setRenaming(null); }}
                  onBlur={e => renameFolder(f.id, e.target.value)} />
              ) : (
                <div className="tt2-row">
                  <button className="tt2-folder" onClick={() => setOpenFolders(o => ({ ...o, [f.id]: !open }))}>
                    <span className="tt2-ico">{open ? '▾' : '▸'}</span><span className="tt2-nl">{f.name}</span>
                  </button>
                  <button className="tt2-ren" title="Rename folder" onClick={() => setRenaming({ kind: 'folder', key: f.id })}>✎</button>
                </div>
              )}
              {open && fl.map(n => (isRen('list', n) ? (
                <input key={n} className="tt2-renin sub" autoFocus defaultValue={n}
                  onKeyDown={e => { if (e.key === 'Enter') renameList(n, e.target.value); if (e.key === 'Escape') setRenaming(null); }}
                  onBlur={e => renameList(n, e.target.value)} />
              ) : (
                <div className="tt2-row" key={n}>
                  <button className={`tt2-navitem sub${view.type === 'list' && view.key === n ? ' on' : ''}`} onClick={() => pick({ type: 'list', key: n })}>
                    <span className="tt2-dot" /><span className="tt2-nl">{n}</span>
                    {countList(n) > 0 && <span className="tt2-ct">{countList(n)}</span>}
                  </button>
                  <button className="tt2-ren" title="Rename list" onClick={() => setRenaming({ kind: 'list', key: n })}>✎</button>
                </div>
              )))}
              {open && (
                <button className="tt2-navitem sub add" onClick={() => { setAdding('list'); setNewName(''); setFolderForNewList(f.id); }}>
                  <span className="tt2-dot" style={{ opacity: 0 }} /><span className="tt2-nl muted">+ list</span>
                </button>
              )}
            </div>
          );
        })}

        {ungrouped.length > 0 && (
          <div className="tt2-sec">
            <div className="tt2-seclabel">Lists</div>
            {ungrouped.map(n => (isRen('list', n) ? (
              <input key={n} className="tt2-renin" autoFocus defaultValue={n}
                onKeyDown={e => { if (e.key === 'Enter') renameList(n, e.target.value); if (e.key === 'Escape') setRenaming(null); }}
                onBlur={e => renameList(n, e.target.value)} />
            ) : (
              <div className="tt2-row" key={n}>
                <button className={`tt2-navitem${view.type === 'list' && view.key === n ? ' on' : ''}`} onClick={() => pick({ type: 'list', key: n })}>
                  <span className="tt2-dot" /><span className="tt2-nl">{n}</span>
                  {countList(n) > 0 && <span className="tt2-ct">{countList(n)}</span>}
                </button>
                <button className="tt2-ren" title="Rename list" onClick={() => setRenaming({ kind: 'list', key: n })}>✎</button>
              </div>
            )))}
          </div>
        )}

        <div className="tt2-navfoot">
          {adding ? (
            <div className="tt2-addrow">
              <input autoFocus placeholder={adding === 'folder' ? 'Folder name' : 'List name'} value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') (adding === 'folder' ? addFolder() : addList()); if (e.key === 'Escape') { setAdding(null); setNewName(''); } }} />
              <button className="btn btn-sm btn-green" onClick={() => (adding === 'folder' ? addFolder() : addList())}>ok</button>
            </div>
          ) : (
            <div className="flex" style={{ gap: 6 }}>
              <button className="btn btn-sm" onClick={() => { setAdding('list'); setNewName(''); setFolderForNewList(null); }}>+ List</button>
              <button className="btn btn-sm" onClick={() => { setAdding('folder'); setNewName(''); }}>+ Folder</button>
            </div>
          )}
        </div>
      </aside>
      {navOpen && <div className="tt2-scrim" onClick={() => setNavOpen(false)} />}

      <section className="tt2-main">
        <div className="tt2-top">
          <button className="tt2-burger" onClick={() => setNavOpen(true)}>☰</button>
          <h1 className="tt2-title">{viewLabel}</h1>
          <span className="tt2-count">{shown.length}</span>
          <div className="tt2-modes">
            {['list', 'day', 'kanban', 'timeline'].map(m => (
              <button key={m} className={`tt2-mode${mode === m ? ' on' : ''}`} onClick={() => setMode(m)}>{m}</button>
            ))}
          </div>
          {mode === 'day' && (
            <div className="tt2-daynav">
              <button className="btn btn-sm" onClick={() => setDayDate(d => addDays(new Date(d + 'T00:00:00'), -1))}>‹</button>
              <span className="tt2-daylab">{prettyDate(dayDate)}</span>
              <button className="btn btn-sm" onClick={() => setDayDate(d => addDays(new Date(d + 'T00:00:00'), 1))}>›</button>
              {dayDate !== today && <button className="btn btn-sm" onClick={() => setDayDate(today)}>today</button>}
            </div>
          )}
        </div>

        {view.key !== 'done' && (
          <div className="tt2-add">
            <input type="text" placeholder={`Add a task to ${view.type === 'list' ? view.key : 'Inbox'}…`} value={qa.title}
              onChange={e => setQa({ ...qa, title: e.target.value })} onKeyDown={e => e.key === 'Enter' && quickAdd()} />
            <input type="date" value={qa.due} onChange={e => setQa({ ...qa, due: e.target.value })} />
            <input type="time" value={qa.time} disabled={!qa.due && !(view.type === 'smart' && view.key === 'today')}
              title="start time — needs a date" style={{ width: 108 }}
              onChange={e => setQa({ ...qa, time: e.target.value })} />
            <input type="number" min="0" step="5" placeholder="mins" style={{ width: 74 }}
              value={qa.mins} onChange={e => setQa({ ...qa, mins: e.target.value })} />
            <select value={qa.pri} onChange={e => setQa({ ...qa, pri: Number(e.target.value) })}>
              <option value={0}>No priority</option><option value={1}>Low</option><option value={2}>Medium</option><option value={3}>High</option>
            </select>
            <button className="btn btn-green" onClick={quickAdd}>+ Add</button>
          </div>
        )}

        {shown.length === 0 && mode !== 'day' && <Empty icon="✓" text="Nothing here. Peaceful." />}
        {mode === 'day' && (
          <DayView
            tasks={items} date={dayDate} onToggle={toggle} onOpen={setDetail}
            onSchedule={(t, time) => patch(t.id, { due_date: dayDate, due_time: time })}
          />
        )}
        {shown.length > 0 && mode === 'list' && <ListView tasks={shown} smart={view.type === 'smart'} today={today} onToggle={toggle} onOpen={setDetail} />}
        {shown.length > 0 && mode === 'kanban' && <KanbanView tasks={shown} today={today} onToggle={toggle} onOpen={setDetail} onMove={(id, p) => patch(id, { priority: p })} />}
        {shown.length > 0 && mode === 'timeline' && <TimelineView tasks={shown} today={today} onToggle={toggle} onOpen={setDetail} />}
      </section>

      {detail && (
        <TaskDetail t={detail} lists={listNames}
          onClose={() => setDetail(null)}
          onSave={p => { patch(detail.id, p); setDetail({ ...detail, ...p }); }}
          onDelete={() => { del(detail.id); setDetail(null); }}
          onPush={() => { pushToCalendar(detail); setDetail({ ...detail, notes: ((detail.notes || '') + ' [gcal]').trim() }); }} />
      )}
    </div>
  );
}

// A row now has to carry four things it never used to: when it starts, how long
// it takes, whether it has a checklist under it, and whether it comes back
// tomorrow. Each is a chip rather than a line, because a task list is scanned
// and a scan reads shapes.
//
// The chips are deliberately asymmetric. A TIME is a commitment and gets the
// bright treatment; a DURATION with no time is an estimate and is drawn quieter,
// because the whole point of decision 1 in lib/todos.js is that those two are
// not the same claim and a list that styles them alike says they are.
function TaskRow({ t, today, onToggle, onOpen, showList }) {
  const over = isOverdue(t, today);
  const note = (t.notes || '').replace('[gcal]', '').trim();
  const sub = subtaskProgress(t);
  const pri = priorityOf(t.priority);
  return (
    <div className={`tt2-task${over ? ' tt2-over' : ''}`}>
      <PCheck done={t.completed} xp={10} onToggle={() => onToggle(t)} />
      {t.priority > 0 && (
        <span className="tt2-flag" style={{ background: pri.color }} title={pri.label} />
      )}
      <button className="tt2-tt" onClick={() => onOpen(t)}>
        <span className={t.completed ? 'struck' : ''}>{t.title}</span>
        {note && <span className="tt2-note">{note}</span>}
        <span className="tt2-chips">
          {isScheduled(t) && <em className="tt2-chip tt2-at">{fmtTime(t.due_time)}</em>}
          {t.duration_min > 0 && (
            <em className={`tt2-chip${isEstimated(t) ? ' tt2-est' : ''}`}
              title={isEstimated(t) ? 'estimated — no time set, so it is not on the calendar' : 'how long it is booked for'}>
              {fmtDuration(t.duration_min)}
            </em>
          )}
          {sub.total > 0 && (
            <em className={`tt2-chip${sub.all ? ' tt2-subdone' : ''}`} title="checklist">
              ☑ {sub.done}/{sub.total}
            </em>
          )}
          {t.repeat_rule && <em className="tt2-chip" title={`repeats: ${t.repeat_rule}`}>↻</em>}
          {t.actual_min > 0 && (
            <em className="tt2-chip tt2-actual" title="what it actually took">
              took {fmtDuration(t.actual_min)}
            </em>
          )}
        </span>
      </button>
      <span className="tt2-meta">
        {t.due_date && <span className={`tt2-due${over ? ' over' : ''}`}>{prettyDate(t.due_date)}</span>}
        {showList && <span className="tt2-listtag">{t.list || 'Inbox'}</span>}
        {(t.notes || '').includes('[gcal]') && <span className="tt2-gcal" title="On Google Calendar">⌾</span>}
      </span>
    </div>
  );
}

// The day as a grid, which is the view a duration was added for.
//
// Two things share this screen and they are drawn differently on purpose:
// blocks that have a time, and work that is due today with no time on it. The
// second sits in a tray beside the grid rather than being hidden — it is real
// work with a real deadline, and a calendar that shows only what fits on a grid
// is a calendar that gets more reassuring the less you plan.
export function DayView({ tasks, date, onToggle, onOpen, onSchedule }) {
  const day = useMemo(() => layoutDay(tasks, date), [tasks, date]);
  const load = useMemo(() => dayLoad(tasks, date), [tasks, date]);
  const [dragging, setDragging] = useState(null);

  const FROM = 6 * 60, TO = 23 * 60;                 // 06:00 → 23:00
  const span = TO - FROM;
  const PXH = 46;                                     // pixels per hour
  const height = (span / 60) * PXH;
  const y = min => ((min - FROM) / span) * height;
  const hours = [];
  for (let h = 6; h <= 23; h++) hours.push(h);

  // Which slot a drop landed on, rounded to the nearest fifteen minutes —
  // finer than that is a precision the mouse does not have.
  const slotAt = e => {
    const box = e.currentTarget.getBoundingClientRect();
    const mins = FROM + ((e.clientY - box.top) / height) * span;
    return hhmmOf(Math.max(FROM, Math.min(TO, Math.round(mins / 15) * 15)));
  };

  return (
    <div className="tt2-day">
      <div className="tt2-dayhead">
        <span className="tt2-dayload">
          {fmtDuration(load.plannedMin) || 'nothing'} booked
          {load.unplacedMin > 0 && <i> · {fmtDuration(load.unplacedMin)} estimated with no time</i>}
        </span>
        {day.clashes.length > 0 && (
          <span className="tt2-clash" title={day.clashes.map(c => `${c.a.title} × ${c.b.title}`).join('\n')}>
            ⚠ {day.clashes.length} overlap{day.clashes.length === 1 ? '' : 's'}
          </span>
        )}
      </div>

      <div className="tt2-daywrap">
        <div className="tt2-grid" style={{ height }}
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); if (dragging) onSchedule(dragging, slotAt(e)); setDragging(null); }}>
          {hours.map(h => (
            <div key={h} className="tt2-hour" style={{ top: y(h * 60) }}>
              <span className="tt2-hourlab">{h % 12 === 0 ? 12 : h % 12}{h < 12 ? 'a' : 'p'}</span>
            </div>
          ))}
          {day.blocks.map(b => (
            <button
              key={b.task.id}
              className={`tt2-block${b.columns > 1 ? ' tt2-clashing' : ''}`}
              style={{
                top: y(b.start),
                height: Math.max(16, (b.minutes / 60) * PXH - 2),
                left: `calc(46px + ${(b.column / b.columns) * 100}% - ${(b.column / b.columns) * 46}px)`,
                width: `calc(${100 / b.columns}% - ${46 / b.columns}px - 4px)`,
                borderLeftColor: priorityOf(b.task.priority).color,
              }}
              draggable
              onDragStart={() => setDragging(b.task)}
              onClick={() => onOpen(b.task)}
            >
              <span className="tt2-block-t">{b.task.title}</span>
              <span className="tt2-block-m">{fmtTime(b.task.due_time)} · {fmtDuration(b.minutes)}</span>
            </button>
          ))}
        </div>

        <div className="tt2-tray">
          <div className="tt2-trayh">No time yet</div>
          {day.unscheduled.length === 0 && <div className="tt2-traye">Everything due today has a time.</div>}
          {day.unscheduled.map(t => (
            <div key={t.id} className="tt2-traycard" draggable onDragStart={() => setDragging(t)}>
              <PCheck done={t.completed} xp={10} onToggle={() => onToggle(t)} />
              <button className="tt2-tt" onClick={() => onOpen(t)}>
                <span>{t.title}</span>
                {t.duration_min > 0 && <em className="tt2-chip tt2-est">{fmtDuration(t.duration_min)}</em>}
              </button>
            </div>
          ))}
          <div className="tt2-trayhint">Drag one onto the grid to give it a time.</div>
        </div>
      </div>
    </div>
  );
}

function ListView({ tasks, smart, today, onToggle, onOpen }) {
  const week = addDays(new Date(), 7);
  const tom = addDays(new Date(), 1);
  const groups = [
    { key: 'over', label: 'Overdue', test: t => t.due_date && t.due_date < today },
    { key: 'today', label: 'Today', test: t => t.due_date === today },
    { key: 'tom', label: 'Tomorrow', test: t => t.due_date === tom },
    { key: 'week', label: 'Next 7 days', test: t => t.due_date && t.due_date > tom && t.due_date <= week },
    { key: 'later', label: 'Later', test: t => t.due_date && t.due_date > week },
    { key: 'none', label: 'No date', test: t => !t.due_date },
  ];
  const used = new Set();
  return (
    <div className="tt2-list">
      {groups.map(g => {
        const rows = tasks.filter(t => !used.has(t.id) && g.test(t));
        rows.forEach(t => used.add(t.id));
        if (!rows.length) return null;
        return (
          <div className="tt2-group" key={g.key}>
            <div className={`tt2-grouph${g.key === 'over' ? ' over' : ''}`}>{g.label} <span>{rows.length}</span></div>
            {rows.map(t => <TaskRow key={t.id} t={t} today={today} onToggle={onToggle} onOpen={onOpen} showList={smart} />)}
          </div>
        );
      })}
    </div>
  );
}

function KanbanView({ tasks, today, onToggle, onOpen, onMove }) {
  const cols = [3, 2, 1, 0];
  const [over, setOver] = useState(null);
  return (
    <div className="tt2-kanban">
      {cols.map(p => {
        const rows = tasks.filter(t => (t.priority || 0) === p);
        return (
          <div key={p} className={`tt2-col${over === p ? ' over' : ''}`}
            onDragOver={e => { e.preventDefault(); setOver(p); }} onDragLeave={() => setOver(o => (o === p ? null : o))}
            onDrop={e => { const id = e.dataTransfer.getData('id'); if (id) onMove(id, p); setOver(null); }}>
            <div className="tt2-colh"><span className={`tt2-flag ${PRI[p].cls}`} />{PRI[p].label} <span>{rows.length}</span></div>
            {rows.map(t => (
              <div key={t.id} className="tt2-kcard" draggable onDragStart={e => e.dataTransfer.setData('id', t.id)}>
                <div className="flex" style={{ gap: 8, alignItems: 'flex-start' }}>
                  <PCheck done={t.completed} xp={10} onToggle={() => onToggle(t)} />
                  <button className="tt2-tt" onClick={() => onOpen(t)}><span className={t.completed ? 'struck' : ''}>{t.title}</span></button>
                </div>
                <div className="tt2-kmeta">
                  {t.due_date && <span className={`tt2-due${t.due_date < today ? ' over' : ''}`}>{prettyDate(t.due_date)}</span>}
                  <span className="tt2-listtag">{t.list || 'Inbox'}</span>
                </div>
              </div>
            ))}
            {rows.length === 0 && <div className="tt2-kempty">drop here</div>}
          </div>
        );
      })}
    </div>
  );
}

function TimelineView({ tasks, today, onToggle, onOpen }) {
  const dated = tasks.filter(t => t.due_date).sort((a, b) => a.due_date.localeCompare(b.due_date));
  const undated = tasks.filter(t => !t.due_date);
  const byDate = {};
  dated.forEach(t => { (byDate[t.due_date] = byDate[t.due_date] || []).push(t); });
  const dates = Object.keys(byDate).sort();
  return (
    <div className="tt2-timeline">
      {dates.length === 0 && <div className="muted small" style={{ padding: 8 }}>No dated tasks to lay out.</div>}
      {dates.map(d => (
        <div className="tt2-tl-row" key={d}>
          <div className={`tt2-tl-date${d < today ? ' over' : d === today ? ' now' : ''}`}><span className="tt2-tl-dot" />{prettyDate(d)}</div>
          <div className="tt2-tl-tasks">{byDate[d].map(t => <TaskRow key={t.id} t={t} today={today} onToggle={onToggle} onOpen={onOpen} showList />)}</div>
        </div>
      ))}
      {undated.length > 0 && (
        <div className="tt2-tl-row">
          <div className="tt2-tl-date"><span className="tt2-tl-dot" />No date</div>
          <div className="tt2-tl-tasks">{undated.map(t => <TaskRow key={t.id} t={t} today={today} onToggle={onToggle} onOpen={onOpen} showList />)}</div>
        </div>
      )}
    </div>
  );
}

function TaskDetail({ t, lists, onClose, onSave, onDelete, onPush }) {
  const [f, setF] = useState({
    title: t.title,
    notes: (t.notes || '').replace('[gcal]', '').trim(),
    due_date: t.due_date || '',
    due_time: t.due_time || '',
    duration_min: t.duration_min || '',
    actual_min: t.actual_min || '',
    priority: t.priority || 0,
    list: t.list || 'Inbox',
    repeat_rule: t.repeat_rule || '',
    repeat_until: t.repeat_until || '',
    subtasks: Array.isArray(t.subtasks) ? t.subtasks : [],
  });
  const [newSub, setNewSub] = useState('');
  const synced = (t.notes || '').includes('[gcal]');
  const sub = subtaskProgress(f);
  const pri = priorityOf(f.priority);

  const save = () => onSave({
    title: f.title.trim() || t.title,
    notes: (f.notes + (synced ? ' [gcal]' : '')).trim(),
    due_date: f.due_date || null,
    // A time with no date is not a time — it has no day to be on. Clearing the
    // date clears it rather than leaving an orphan that nothing can draw.
    due_time: f.due_date && minutesOf(f.due_time) != null ? hhmmOf(minutesOf(f.due_time)) : null,
    duration_min: Number(f.duration_min) > 0 ? Math.round(Number(f.duration_min)) : null,
    actual_min: Number(f.actual_min) > 0 ? Math.round(Number(f.actual_min)) : null,
    priority: Number(f.priority),
    list: f.list,
    repeat_rule: f.repeat_rule || null,
    repeat_until: f.repeat_rule && f.repeat_until ? f.repeat_until : null,
    subtasks: f.subtasks,
  });

  const QUICK = [15, 30, 45, 60, 90, 120];

  return (
    <div className="modal-overlay" onClick={() => { save(); onClose(); }}>
      <div className="px tt2-detail" onClick={e => e.stopPropagation()}>
        <div className="spread" style={{ marginBottom: 10 }}>
          <span className="card-title" style={{ margin: 0 }}>
            <span className="sq" style={{ background: pri.color }} />Task
          </span>
          <button className="btn btn-sm btn-pink" onClick={() => { save(); onClose(); }}>✕</button>
        </div>

        <input className="tt2-dtitle" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} />
        <textarea className="tt2-dnotes" placeholder="Notes…" value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} />

        <div className="tt2-drow"><label>Due</label>
          <input type="date" value={f.due_date} onChange={e => setF({ ...f, due_date: e.target.value })} />
          {/* The time input is disabled without a date, rather than accepting a
              time that can never be placed anywhere. */}
          <input type="time" value={f.due_time} disabled={!f.due_date}
            title={f.due_date ? 'start time' : 'pick a date first — a time needs a day to be on'}
            onChange={e => setF({ ...f, due_time: e.target.value })} />
          {f.due_time && (
            <button className="btn btn-sm" title="remove the time and leave it as a deadline"
              onClick={() => setF({ ...f, due_time: '' })}>clear time</button>
          )}
        </div>

        <div className="tt2-drow"><label>How long</label>
          <input type="number" min="0" step="5" placeholder="minutes" style={{ width: 90 }}
            value={f.duration_min} onChange={e => setF({ ...f, duration_min: e.target.value })} />
          <span className="tt2-quick">
            {QUICK.map(q => (
              <button key={q} className={`tt2-qbtn${Number(f.duration_min) === q ? ' on' : ''}`}
                onClick={() => setF({ ...f, duration_min: q })}>{fmtDuration(q)}</button>
            ))}
          </span>
        </div>
        {/* Decision 1, said out loud at the moment it matters. */}
        {f.duration_min > 0 && !f.due_time && (
          <p className="tt2-hint">
            An estimate with no start time. It stays off the calendar grid and sits in
            the tray beside it — drag it onto an hour to book it.
          </p>
        )}

        <div className="tt2-drow"><label>Actually took</label>
          <input type="number" min="0" step="5" placeholder="minutes" style={{ width: 90 }}
            value={f.actual_min} onChange={e => setF({ ...f, actual_min: e.target.value })} />
          <span className="small muted">
            {Number(f.actual_min) > 0 && Number(f.duration_min) > 0
              ? `${(Number(f.actual_min) / Number(f.duration_min)).toFixed(2)}× your estimate`
              : 'logged after the fact — this is what makes the estimates better'}
          </span>
        </div>

        <div className="tt2-drow"><label>Repeats</label>
          <select value={f.repeat_rule} onChange={e => setF({ ...f, repeat_rule: e.target.value })}>
            <option value="">Never</option>
            {REPEATS.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
            <option value="every:2">Every 2 days</option>
            <option value="every:3">Every 3 days</option>
            <option value="every:14">Every 2 weeks</option>
          </select>
          {f.repeat_rule && (
            <>
              <label className="tt2-until">until</label>
              <input type="date" value={f.repeat_until}
                onChange={e => setF({ ...f, repeat_until: e.target.value })} />
            </>
          )}
        </div>
        {f.repeat_rule && (
          <p className="tt2-hint">
            Ticking this off creates the next one and leaves this one completed on its
            own date — so the record of what you actually did stays intact.
          </p>
        )}

        <div className="tt2-drow"><label>Priority</label>
          <select value={f.priority} onChange={e => setF({ ...f, priority: Number(e.target.value) })}>
            <option value={0}>None</option><option value={1}>Low</option>
            <option value={2}>Medium</option><option value={3}>High</option>
          </select>
          <label style={{ marginLeft: 8 }}>List</label>
          <select value={f.list} onChange={e => setF({ ...f, list: e.target.value })}>
            {lists.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>

        {/* Checklist. Ticking every item does NOT complete the task — that is
            still your call, and the count says where you are. */}
        <div className="tt2-subs">
          <div className="tt2-subh">
            Checklist
            {sub.total > 0 && <span className="tt2-subcount">{sub.done}/{sub.total}</span>}
            {sub.total > 0 && (
              <span className="tt2-subbar"><i style={{ width: `${sub.pct}%` }} /></span>
            )}
          </div>
          {f.subtasks.map(s2 => (
            <div key={s2.id} className="tt2-sub">
              <input type="checkbox" checked={s2.done}
                onChange={() => setF(toggleSubtask(f, s2.id))} />
              <span className={s2.done ? 'struck' : ''}>{s2.title}</span>
              <button className="tt2-subx" onClick={() => setF(removeSubtask(f, s2.id))}>×</button>
            </div>
          ))}
          <div className="tt2-sub">
            <input className="tt2-subin" placeholder="add a step…" value={newSub}
              onChange={e => setNewSub(e.target.value)}
              onKeyDown={e => {
                if (e.key !== 'Enter' || !newSub.trim()) return;
                setF(addSubtask(f, newSub)); setNewSub('');
              }} />
          </div>
          {sub.all && (
            <p className="tt2-hint">
              Every step is ticked. The task itself is still open — finishing it is your
              call, because some checklists are guidance rather than the whole job.
            </p>
          )}
        </div>

        <div className="flex mt" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-green" onClick={() => { save(); onClose(); }}>Save</button>
          <button className="btn btn-sm" disabled={!f.due_date || synced} onClick={onPush}>
            {synced ? '⌾ On Google Cal' : '⤴ Push to Google Cal'}
          </button>
          <button className="btn btn-sm" style={{ marginLeft: 'auto', color: 'var(--red)', borderColor: 'var(--red)' }}
            onClick={onDelete}>Delete</button>
        </div>
      </div>
    </div>
  );
}
