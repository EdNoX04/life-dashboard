import React, { useMemo, useState } from 'react';
import { useCollection, todayStr } from '../lib/hooks.js';
import { Empty, PCheck } from '../components/ui.jsx';
import * as db from '../lib/db.js';

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
  const { items, add, patch, del } = useCollection('todos');
  const { items: cfgMem, refresh: rCfg } = useCollection('memory', { filter: 'key=eq.todo_lists', order: 'key' });
  const cfg = cfgMem?.[0]?.value || { folders: [], lists: [] };

  const [view, setView] = useState({ type: 'smart', key: 'today' });
  const [mode, setMode] = useState('list'); // list | kanban | timeline
  const [navOpen, setNavOpen] = useState(false); // mobile drawer
  const [detail, setDetail] = useState(null); // task being edited
  const [openFolders, setOpenFolders] = useState({});
  const [adding, setAdding] = useState(null); // 'list' | 'folder' | null
  const [newName, setNewName] = useState('');
  const [folderForNewList, setFolderForNewList] = useState(null);

  const today = todayStr();
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
    return out.slice().sort((a, b) => {
      const ad = a.due_date || '9999', bd = b.due_date || '9999';
      if (ad !== bd) return ad.localeCompare(bd);
      return (b.priority || 0) - (a.priority || 0);
    });
  }, [items, view, today, week]);

  const viewLabel = view.type === 'smart' ? SMART.find(s => s.key === view.key)?.label : view.key;
  const defaultList = view.type === 'list' ? view.key : 'Inbox';

  const [qa, setQa] = useState({ title: '', due: '', pri: 0 });
  async function quickAdd() {
    if (!qa.title.trim()) return;
    const due = qa.due || (view.type === 'smart' && view.key === 'today' ? today : '');
    await add({ title: qa.title.trim(), due_date: due || null, priority: qa.pri, list: defaultList, completed: false });
    setQa({ title: '', due: '', pri: 0 });
  }

  function toggle(t) { patch(t.id, { completed: !t.completed, completed_at: t.completed ? null : new Date().toISOString() }); }
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
              <button className="tt2-folder" onClick={() => setOpenFolders(o => ({ ...o, [f.id]: !open }))}>
                <span className="tt2-ico">{open ? '▾' : '▸'}</span><span className="tt2-nl">{f.name}</span>
              </button>
              {open && fl.map(n => (
                <button key={n} className={`tt2-navitem sub${view.type === 'list' && view.key === n ? ' on' : ''}`} onClick={() => pick({ type: 'list', key: n })}>
                  <span className="tt2-dot" /><span className="tt2-nl">{n}</span>
                  {countList(n) > 0 && <span className="tt2-ct">{countList(n)}</span>}
                </button>
              ))}
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
            {ungrouped.map(n => (
              <button key={n} className={`tt2-navitem${view.type === 'list' && view.key === n ? ' on' : ''}`} onClick={() => pick({ type: 'list', key: n })}>
                <span className="tt2-dot" /><span className="tt2-nl">{n}</span>
                {countList(n) > 0 && <span className="tt2-ct">{countList(n)}</span>}
              </button>
            ))}
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
            {['list', 'kanban', 'timeline'].map(m => (
              <button key={m} className={`tt2-mode${mode === m ? ' on' : ''}`} onClick={() => setMode(m)}>{m}</button>
            ))}
          </div>
        </div>

        {view.key !== 'done' && (
          <div className="tt2-add">
            <input type="text" placeholder={`Add a task to ${view.type === 'list' ? view.key : 'Inbox'}…`} value={qa.title}
              onChange={e => setQa({ ...qa, title: e.target.value })} onKeyDown={e => e.key === 'Enter' && quickAdd()} />
            <input type="date" value={qa.due} onChange={e => setQa({ ...qa, due: e.target.value })} />
            <select value={qa.pri} onChange={e => setQa({ ...qa, pri: Number(e.target.value) })}>
              <option value={0}>No priority</option><option value={1}>Low</option><option value={2}>Medium</option><option value={3}>High</option>
            </select>
            <button className="btn btn-green" onClick={quickAdd}>+ Add</button>
          </div>
        )}

        {shown.length === 0 && <Empty icon="✓" text="Nothing here. Peaceful." />}
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

function TaskRow({ t, today, onToggle, onOpen, showList }) {
  const overdue = t.due_date && t.due_date < today && !t.completed;
  const note = (t.notes || '').replace('[gcal]', '').trim();
  return (
    <div className="tt2-task">
      <PCheck done={t.completed} xp={10} onToggle={() => onToggle(t)} />
      {t.priority > 0 && <span className={`tt2-flag ${PRI[t.priority].cls}`} title={PRI[t.priority].label} />}
      <button className="tt2-tt" onClick={() => onOpen(t)}>
        <span className={t.completed ? 'struck' : ''}>{t.title}</span>
        {note && <span className="tt2-note">{note}</span>}
      </button>
      <span className="tt2-meta">
        {t.due_date && <span className={`tt2-due${overdue ? ' over' : ''}`}>{prettyDate(t.due_date)}</span>}
        {showList && <span className="tt2-listtag">{t.list || 'Inbox'}</span>}
        {(t.notes || '').includes('[gcal]') && <span className="tt2-gcal" title="On Google Calendar">⌾</span>}
      </span>
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
  const [f, setF] = useState({ title: t.title, notes: (t.notes || '').replace('[gcal]', '').trim(), due_date: t.due_date || '', priority: t.priority || 0, list: t.list || 'Inbox' });
  const synced = (t.notes || '').includes('[gcal]');
  const save = () => onSave({ title: f.title.trim() || t.title, notes: (f.notes + (synced ? ' [gcal]' : '')).trim(), due_date: f.due_date || null, priority: Number(f.priority), list: f.list });
  return (
    <div className="modal-overlay" onClick={() => { save(); onClose(); }}>
      <div className="px tt2-detail" onClick={e => e.stopPropagation()}>
        <div className="spread" style={{ marginBottom: 10 }}>
          <span className="card-title" style={{ margin: 0 }}><span className="sq" style={{ background: PRI[f.priority].c }} />Task</span>
          <button className="btn btn-sm btn-pink" onClick={() => { save(); onClose(); }}>✕</button>
        </div>
        <input className="tt2-dtitle" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} />
        <textarea className="tt2-dnotes" placeholder="Notes…" value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} />
        <div className="tt2-drow"><label>Due</label><input type="date" value={f.due_date} onChange={e => setF({ ...f, due_date: e.target.value })} /></div>
        <div className="tt2-drow"><label>Priority</label>
          <select value={f.priority} onChange={e => setF({ ...f, priority: Number(e.target.value) })}>
            <option value={0}>None</option><option value={1}>Low</option><option value={2}>Medium</option><option value={3}>High</option>
          </select>
        </div>
        <div className="tt2-drow"><label>List</label>
          <select value={f.list} onChange={e => setF({ ...f, list: e.target.value })}>
            {lists.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
        <div className="flex mt" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-green" onClick={() => { save(); onClose(); }}>Save</button>
          <button className="btn btn-sm" disabled={!f.due_date || synced} onClick={onPush}>{synced ? '⌾ On Google Cal' : '⤴ Push to Google Cal'}</button>
          <button className="btn btn-sm" style={{ marginLeft: 'auto', color: 'var(--red)', borderColor: 'var(--red)' }} onClick={onDelete}>Delete</button>
        </div>
      </div>
    </div>
  );
}
