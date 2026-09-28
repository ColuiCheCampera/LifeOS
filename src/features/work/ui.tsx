'use client';
import { useEffect, useRef, useState, useMemo } from 'react';
import { useLocale } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import { v7 as uuidv7 } from 'uuid';
import { Temporal } from '@js-temporal/polyfill';
import Markdown from 'react-markdown';
import {
  Plus,
  Search,
  Check,
  MoreHorizontal,
  ArrowUp,
  ArrowDown,
  Folder,
  Inbox,
  RotateCcw,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SyncPanel, useWork, useLocalSettings } from '@/features/sync/provider';
import { enqueueWork, flush } from '@/features/sync/client';
import { schemas, taskData, projectData, type Kind, type WorkRecord } from './schema';
import {
  fuzzyScore,
  parseCapture,
  matchesQuery,
  todayIn,
  dateAt,
  taskDepth,
  taskEditorValues,
} from './domain';
import { copy, type Copy } from './copy';
const views = [
  'inbox',
  'today',
  'upcoming',
  'project',
  'tag',
  'board',
  'calendar',
  'completed',
  'trash',
] as const;
type View = (typeof views)[number];
type Edit = { kind: Kind; record?: WorkRecord; initial?: Record<string, unknown> };
function useCopy() {
  return copy[useLocale() === 'en' ? 'en' : 'it'];
}
export function openCapture() {
  window.dispatchEvent(new CustomEvent('lifeos-capture'));
}
function useActions() {
  const query = useQueryClient();
  return async (
    kind: Kind,
    id: string,
    patch: Record<string, unknown>,
    operation: Parameters<typeof enqueueWork>[3] = 'upsert',
  ) => {
    await enqueueWork(kind, id, patch, operation);
    await query.invalidateQueries();
  };
}
function Dialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const startY = useRef<number | null>(null);
  const [expanded, setExpanded] = useState(true);
  const c = useCopy();
  useEffect(() => {
    const d = ref.current!;
    d.showModal();
    return () => d.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`work-dialog ${expanded ? 'sheet-expanded' : 'sheet-half'}`}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header
        onPointerDown={(e) => {
          if (e.pointerType === 'touch' && !(e.target as HTMLElement).closest('button')) {
            startY.current = e.clientY;
            e.currentTarget.setPointerCapture(e.pointerId);
          }
        }}
        onPointerUp={(e) => {
          if (startY.current !== null) {
            const delta = e.clientY - startY.current;
            startY.current = null;
            if (delta > 150) onClose();
            else if (Math.abs(delta) > 50) setExpanded(delta < 0);
          }
        }}
      >
        <button
          type="button"
          className="sheet-handle"
          aria-label={expanded ? c.reduce : c.expand}
          onClick={() => setExpanded((v) => !v)}
        >
          ―
        </button>
        <h2>{title}</h2>
        <button type="button" className="icon-button" aria-label={c.close} onClick={onClose}>
          <X size={20} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
function Editor({
  edit,
  records,
  close,
}: {
  edit: Edit;
  records: WorkRecord[];
  close: () => void;
}) {
  const c = useCopy();
  const preferences = useLocalSettings().data?.snapshot.preferences;
  const zone = preferences?.timezone ?? 'Europe/Rome';
  const action = useActions();
  const source = edit.record?.data ?? edit.initial ?? {};
  const initial = edit.kind === 'task' ? taskEditorValues(source, zone) : source;
  const [form, setForm] = useState<Record<string, unknown>>(() => ({ ...initial }));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const value = (k: string) => String(form[k] ?? '');
  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const dismiss = () => {
    if (busy) return;
    if (!dirty || window.confirm(c.saveFirst)) close();
  };
  const select = (key: string, options: { id: string; title: string }[], nullable = true) => (
    <label>
      {c[key as keyof Copy] ?? key}
      <select
        aria-label={c[key as keyof Copy] ?? key}
        value={value(key)}
        onChange={(e) => set(key, e.target.value || null)}
      >
        {nullable && <option value="">{c.none}</option>}
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.title}
          </option>
        ))}
      </select>
    </label>
  );
  const options = (kind: Kind) =>
    records
      .filter((r) => r.kind === kind && !r.deletedAt && r.id !== edit.record?.id)
      .map((r) => ({ id: r.id, title: String(r.data.title) }));
  const text = (key: string, type = 'text') => (
    <label>
      {c[key as keyof Copy] ?? key}
      <input
        type={type}
        value={value(key)}
        required={key === 'title'}
        maxLength={key === 'title' ? 240 : undefined}
        onChange={(e) =>
          set(
            key,
            ['estimate', 'actual', 'priority'].includes(key)
              ? Number(e.target.value)
              : e.target.value || null,
          )
        }
      />
    </label>
  );
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const data = { ...form };
      if (edit.kind === 'task') {
        data.timezone ??= zone;
        if (data.dueAt && data.dueDate)
          data.dueAt = dateAt(String(data.dueDate), String(data.dueAt), String(data.timezone));
        if (!data.dueDate) data.dueAt = null;
      }
      const parsed = schemas[edit.kind].parse(data);
      const patch: Record<string, unknown> = edit.record
        ? Object.fromEntries(
            Object.entries(parsed).filter(
              ([k, v]) => JSON.stringify(v) !== JSON.stringify(edit.record!.data[k]),
            ),
          )
        : parsed;
      if (Object.keys(patch).length)
        await action(
          edit.kind,
          edit.record?.id ?? uuidv7(),
          patch,
          edit.kind === 'task' &&
            edit.record &&
            edit.record.data.status !== 'done' &&
            patch.status === 'done'
            ? 'complete'
            : 'upsert',
        );
      close();
    } catch {
      setError(c.error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title={edit.record ? c.edit : c[edit.kind]} onClose={dismiss}>
      <form onSubmit={save} data-unsaved={dirty}>
        <div className="work-fields">
          {text('title')}
          {edit.kind === 'task' && (
            <>
              {select(
                'status',
                ['todo', 'doing', 'done'].map((id) => ({ id, title: c[id as 'todo'] })),
                false,
              )}
              <label>
                {c.priority}
                <select
                  value={value('priority') || '4'}
                  onChange={(e) => set('priority', Number(e.target.value))}
                >
                  {[1, 2, 3, 4].map((n) => (
                    <option key={n} value={n}>
                      P{n}
                    </option>
                  ))}
                </select>
              </label>
              {text('dueDate', 'date')}
              <label>
                {c.dueAt}
                <input
                  type="time"
                  step="1"
                  value={value('dueAt')}
                  onChange={(e) => set('dueAt', e.target.value || null)}
                />
              </label>
              {text('startDate', 'date')}
              {text('estimate', 'number')}
              {text('actual', 'number')}
              {select('projectId', options('project'))}
              {select('parentId', options('task'))}
              <label>
                {c.tags}
                <input
                  value={((form.tags as string[]) ?? []).join(', ')}
                  onChange={(e) =>
                    set(
                      'tags',
                      e.target.value
                        .split(',')
                        .map((t) => t.trim())
                        .filter(Boolean),
                    )
                  }
                />
              </label>
              {text('recurrence')}
              {text('timezone')}
              <label className="wide">
                {c.reminders}
                <textarea
                  value={((form.reminders as string[]) ?? []).join('\n')}
                  onChange={(e) => set('reminders', e.target.value.split('\n').filter(Boolean))}
                />
                <small>{c.reminderHint}</small>
              </label>
              <label className="wide">
                {c.attachments}
                <textarea
                  value={((form.attachments as { name: string; url: string }[]) ?? [])
                    .map((a) => a.name + ' | ' + a.url)
                    .join('\n')}
                  onChange={(e) =>
                    set(
                      'attachments',
                      e.target.value
                        .split('\n')
                        .filter(Boolean)
                        .map((line) => {
                          const [name, url] = line.split('|').map((s) => s.trim());
                          return { name, url, bytes: 0 };
                        }),
                    )
                  }
                />
              </label>
            </>
          )}
          {edit.kind === 'project' && (
            <>
              {select(
                'status',
                ['active', 'paused', 'done'].map((id) => ({ id, title: c[id as 'active'] })),
                false,
              )}
              {select('areaId', options('area'))}
              {text('deadline', 'date')}
              <label className="wide">
                {c.goal}
                <textarea value={value('goal')} onChange={(e) => set('goal', e.target.value)} />
              </label>
            </>
          )}
          {edit.kind === 'area' && text('color', 'color')}
          {edit.kind === 'milestone' && (
            <>
              {select('projectId', options('project'), false)}
              {text('dueDate', 'date')}
              <label>
                <input
                  type="checkbox"
                  checked={!!form.done}
                  onChange={(e) => set('done', e.target.checked)}
                />
                {c.done}
              </label>
            </>
          )}
          {edit.kind === 'filter' && text('query')}
          {(edit.kind === 'task' || edit.kind === 'project') && (
            <label className="wide">
              {c.notes}
              <textarea
                rows={5}
                value={value('notes')}
                onChange={(e) => set('notes', e.target.value)}
              />
              {!!form.notes && (
                <details>
                  <summary>{c.preview}</summary>
                  <div className="markdown">
                    <Markdown>{String(form.notes)}</Markdown>
                  </div>
                </details>
              )}
            </label>
          )}
        </div>
        {error && <p role="alert">{error}</p>}
        <footer>
          {edit.record && (
            <Button
              type="button"
              variant="ghost"
              onClick={async () => {
                if (window.confirm(c.deleteConfirm)) {
                  try {
                    await action(edit.kind, edit.record!.id, {}, 'delete');
                    close();
                  } catch {
                    setError(c.error);
                  }
                }
              }}
            >
              {c.remove}
            </Button>
          )}
          <Button type="button" variant="outline" disabled={busy} onClick={dismiss}>
            {c.cancel}
          </Button>
          <Button disabled={busy}>{c.save}</Button>
        </footer>
      </form>
    </Dialog>
  );
}
export function WorkOverlays() {
  const c = useCopy();
  const records = useWork().data?.records ?? [];
  const settings = useLocalSettings();
  const zone = settings.data?.snapshot.preferences.timezone ?? 'Europe/Rome';
  const action = useActions();
  const [capture, setCapture] = useState(false);
  const [palette, setPalette] = useState(false);
  const [help, setHelp] = useState(false);
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  const [edit, setEdit] = useState<Edit | null>(null);
  const [error, setError] = useState('');
  const parsed = useMemo(() => {
    try {
      return parseCapture(text, zone);
    } catch {
      return null;
    }
  }, [text, zone]);
  useEffect(() => {
    const open = () => setCapture(true);
    const key = (e: KeyboardEvent) => {
      if (document.querySelector('dialog[open]') && !(e.metaKey || e.ctrlKey)) return;
      const typing = (e.target as HTMLElement).matches(
        'input,textarea,select,[contenteditable=true]',
      );
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette((v) => !v);
      } else if (!typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (e.key.toLowerCase() === 'n') {
          e.preventDefault();
          setCapture(true);
        }
        if (e.key === '?') setHelp(true);
      }
    };
    window.addEventListener('lifeos-capture', open);
    window.addEventListener('keydown', key);
    if (new URLSearchParams(location.search).get('capture') === '1')
      queueMicrotask(() => setCapture(true));
    return () => {
      window.removeEventListener('lifeos-capture', open);
      window.removeEventListener('keydown', key);
    };
  }, []);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      if (!parsed?.title) throw new Error();
      await action('task', uuidv7(), parsed);
      setText('');
      setCapture(false);
      setError('');
    } catch {
      setError(c.invalid);
    }
  }
  return (
    <>
      <div className="work-global">
        <Button variant="outline" aria-label={c.palette} onClick={() => setPalette(true)}>
          <Search size={18} />
          <span>⌘ K</span>
        </Button>
        <Button aria-label={c.newTask} onClick={() => setCapture(true)}>
          <Plus size={18} />
          <span>{c.newTask}</span>
        </Button>
        <button className="icon-button" aria-label={c.shortcuts} onClick={() => setHelp(true)}>
          ?
        </button>
      </div>
      {capture && (
        <Dialog
          title={c.capture}
          onClose={() => {
            setCapture(false);
            setText('');
          }}
        >
          <form onSubmit={save} data-unsaved={!!text}>
            <label>
              {c.newTask}
              <input
                autoFocus
                value={text}
                placeholder={c.captureHint}
                onChange={(e) => setText(e.target.value)}
              />
            </label>
            <div className="capture-preview">
              <small>{c.preview}</small>
              <h3>{parsed?.title || '…'}</h3>
              <p>
                {parsed?.dueDate ?? c.noDue}{' '}
                {parsed?.dueAt
                  ? new Intl.DateTimeFormat(localeKey(settings.data?.snapshot.preferences.locale), {
                      hour: '2-digit',
                      minute: '2-digit',
                      timeZone: zone,
                    }).format(new Date(parsed.dueAt))
                  : ''}{' '}
                · P{parsed?.priority ?? 4} {parsed?.tags.map((t) => '#' + t).join(' ')}
              </p>
            </div>
            {error && <p role="alert">{error}</p>}
            <footer>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setEdit({ kind: 'task', initial: parsed ?? {} });
                  setCapture(false);
                }}
              >
                {c.more}
              </Button>
              <Button disabled={!parsed?.title || !settings.data}>{c.save}</Button>
            </footer>
          </form>
        </Dialog>
      )}
      {palette && (
        <Dialog title={c.palette} onClose={() => setPalette(false)}>
          <label>
            {c.paletteHint}
            <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <div className="command-results">
            <Button
              variant="ghost"
              onClick={() => {
                setPalette(false);
                setCapture(true);
              }}
            >
              {c.newTask}
            </Button>
            {[
              ['/tasks', c.tasks],
              ['/projects', c.projects],
              ['/review', c.review],
              ['/settings', c.settings],
            ].map(([href, label]) => (
              <a key={href} className="button button-outline" href={href}>
                {label}
              </a>
            ))}
            {records
              .filter((r) => !r.deletedAt && fuzzyScore(String(r.data.title), search) >= 0)
              .sort(
                (a, b) =>
                  fuzzyScore(String(b.data.title), search) -
                  fuzzyScore(String(a.data.title), search),
              )
              .slice(0, 50)
              .map((r) => (
                <button
                  className="command-result"
                  key={r.id}
                  onClick={() => {
                    setPalette(false);
                    setEdit({ kind: r.kind, record: r });
                  }}
                >
                  <span>{String(r.data.title)}</span>
                  <small>{c[r.kind]}</small>
                </button>
              ))}
          </div>
        </Dialog>
      )}
      {help && (
        <Dialog title={c.shortcuts} onClose={() => setHelp(false)}>
          <p>{c.shortcutHint}</p>
        </Dialog>
      )}
      {edit && <Editor edit={edit} records={records} close={() => setEdit(null)} />}
    </>
  );
}
function localeKey(locale?: string) {
  return locale === 'en' ? 'en' : 'it';
}
function TaskRow({
  record,
  records,
  selected,
  onSelect,
  onEdit,
  onChange,
  onDelete,
  onMove,
  onDrop,
}: {
  record: WorkRecord;
  records: WorkRecord[];
  selected: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onChange: (patch: Record<string, unknown>, operation?: 'upsert' | 'complete') => void;
  onDelete: () => void;
  onMove: (direction: number) => void;
  onDrop: (id: string) => void;
}) {
  const c = useCopy();
  const task = taskData(record);
  const start = useRef<{ x: number; y: number } | null>(null);
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressClick = useRef(false);
  const [menu, setMenu] = useState(false);
  useEffect(
    () => () => {
      if (hold.current) clearTimeout(hold.current);
    },
    [],
  );
  const clear = () => {
    if (hold.current) clearTimeout(hold.current);
    hold.current = null;
  };
  return (
    <article
      className={`task-row ${selected ? 'is-selected' : ''} ${task.status === 'done' ? 'is-done' : ''}`}
      data-task-id={record.id}
      draggable
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onDrop(e.dataTransfer.getData('text/lifeos-task'));
      }}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/lifeos-task', record.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenu(true);
      }}
      onClickCapture={(e) => {
        if (suppressClick.current) {
          e.preventDefault();
          e.stopPropagation();
          suppressClick.current = false;
        }
      }}
      onPointerDown={(e) => {
        suppressClick.current = false;
        const control = (e.target as HTMLElement).closest('button,input,a');
        if (e.pointerType === 'mouse' || (control && !control.classList.contains('task-main')))
          return;
        start.current = { x: e.clientX, y: e.clientY };
        hold.current = setTimeout(() => {
          suppressClick.current = true;
          onSelect();
          start.current = null;
        }, 550);
      }}
      onPointerMove={(e) => {
        if (
          start.current &&
          Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 12
        )
          clear();
      }}
      onPointerCancel={() => {
        clear();
        start.current = null;
      }}
      onPointerUp={(e) => {
        clear();
        if (start.current) {
          const x = e.clientX - start.current.x,
            y = e.clientY - start.current.y;
          if (Math.abs(x) > 90 && Math.abs(y) < 40) {
            suppressClick.current = true;
            if (x > 0) {
              onChange(
                task.status === 'done' ? { status: 'todo', completedAt: null } : {},
                task.status === 'done' ? 'upsert' : 'complete',
              );
              navigator.vibrate?.(15);
            } else onEdit();
          }
          start.current = null;
        }
      }}
    >
      <input
        type="checkbox"
        aria-label={`${c.select}: ${task.title}`}
        checked={selected}
        onChange={onSelect}
      />
      <button
        className={`task-check priority-${task.priority}`}
        aria-label={`${task.status === 'done' ? c.reopen : c.complete}: ${task.title}`}
        onClick={() =>
          onChange(
            task.status === 'done' ? { status: 'todo', completedAt: null } : {},
            task.status === 'done' ? 'upsert' : 'complete',
          )
        }
      >
        {task.status === 'done' && <Check size={18} />}
      </button>
      <button className="task-main" onClick={onEdit}>
        <strong>
          {task.parentId && (
            <span aria-label={c.parentId} className="task-depth">
              ↳{taskDepth(record, records) > 1 ? taskDepth(record, records) : ''}{' '}
            </span>
          )}
          {task.title}
        </strong>
        <span>
          {task.projectId
            ? String(records.find((r) => r.id === task.projectId)?.data.title ?? '')
            : c.inbox}
          {task.dueDate && ' · ' + task.dueDate}
          {task.tags.map((t) => ' #' + t).join('')}
          {task.recurrence && ' ↻'}
        </span>
      </button>
      <span className={`priority-tag priority-${task.priority}`}>P{task.priority}</span>
      <button
        className="icon-button"
        aria-label={`${c.more}: ${task.title}`}
        onClick={() => setMenu(!menu)}
      >
        <MoreHorizontal size={19} />
      </button>
      {menu && (
        <div className="task-actions">
          <Button variant="ghost" onClick={onEdit}>
            {c.edit}
          </Button>
          <Button variant="ghost" onClick={() => onMove(-1)} aria-label={c.up}>
            <ArrowUp size={18} />
          </Button>
          <Button variant="ghost" onClick={() => onMove(1)} aria-label={c.down}>
            <ArrowDown size={18} />
          </Button>
          <Button variant="ghost" onClick={onDelete}>
            {c.remove}
          </Button>
          <Button variant="ghost" onClick={() => setMenu(false)}>
            {c.close}
          </Button>
        </div>
      )}
    </article>
  );
}
function VirtualList({
  rows,
  render,
}: {
  rows: WorkRecord[];
  render: (r: WorkRecord) => React.ReactNode;
}) {
  const [top, setTop] = useState(0);
  const height = 88;
  const start = Math.max(0, Math.floor(top / height) - 5);
  const visible = rows.length > 100 ? rows.slice(start, start + 22) : rows;
  return (
    <div
      className={rows.length > 100 ? 'virtual-tasks' : 'task-list'}
      onScroll={(e) => setTop(e.currentTarget.scrollTop)}
    >
      {rows.length > 100 && <div style={{ height: start * height }} />}
      {visible.map(render)}
      {rows.length > 100 && (
        <div style={{ height: Math.max(0, rows.length - start - visible.length) * height }} />
      )}
    </div>
  );
}
export function WorkApp({ mode = 'tasks' }: { mode?: 'tasks' | 'projects' | 'today' | 'review' }) {
  const c = useCopy();
  const locale = useLocale();
  const local = useWork();
  const preferences = useLocalSettings().data?.snapshot.preferences;
  const zone = preferences?.timezone ?? 'Europe/Rome';
  const records = local.data?.records ?? [];
  const action = useActions();
  const [view, setView] = useState<View>(mode === 'today' ? 'today' : 'inbox');
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('');
  const [edit, setEdit] = useState<Edit | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [notice, setNotice] = useState('');
  const [undo, setUndo] = useState<WorkRecord | null>(null);
  const [month, setMonth] = useState(() => todayIn(zone).slice(0, 7));
  const [area, setArea] = useState('');
  const [projectStatus, setProjectStatus] = useState('');
  const [projectSearch, setProjectSearch] = useState('');
  const pullStart = useRef<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  const live = records.filter((r) => !r.deletedAt);
  const projects = live.filter((r) => r.kind === 'project');
  const visibleProjects = projects.filter(
    (p) =>
      (!area || p.data.areaId === area) &&
      (!projectStatus || p.data.status === projectStatus) &&
      `${p.data.title} ${p.data.goal}`
        .toLocaleLowerCase(locale)
        .includes(projectSearch.trim().toLocaleLowerCase(locale)),
  );
  const tasks = live.filter((r) => r.kind === 'task');
  const today = todayIn(zone);
  const filtered = records
    .filter((r) => {
      if (view === 'trash') return !!r.deletedAt && now - Date.parse(r.deletedAt) < 30 * 86400000;
      if (r.kind !== 'task') return false;
      const t = taskData(r);
      if (r.deletedAt) return false;
      if (view === 'completed') return t.status === 'done' && matchesQuery(t, query, zone);
      if (t.status === 'done') return false;
      if (!matchesQuery(t, query, zone)) return false;
      if (view === 'inbox' && t.projectId) return false;
      if (view === 'today' && (!t.dueDate || t.dueDate > today)) return false;
      if (view === 'upcoming' && (!t.dueDate || t.dueDate <= today)) return false;
      if (view === 'project' && group && t.projectId !== group) return false;
      if (view === 'tag' && group && !t.tags.includes(group)) return false;
      return true;
    })
    .sort((a, b) => {
      if (view === 'trash') return (b.deletedAt ?? '').localeCompare(a.deletedAt ?? '');
      const x = taskData(a),
        y = taskData(b);
      if (['today', 'upcoming', 'calendar'].includes(view))
        return (x.dueDate ?? '9999').localeCompare(y.dueDate ?? '9999') || x.priority - y.priority;
      return (
        x.position - y.position || x.priority - y.priority || a.createdAt.localeCompare(b.createdAt)
      );
    });
  async function change(
    r: WorkRecord,
    patch: Record<string, unknown>,
    operation: Parameters<typeof enqueueWork>[3] = 'upsert',
  ) {
    try {
      await action(r.kind, r.id, patch, operation);
      setNotice(c.saved);
      return true;
    } catch {
      setNotice(c.error);
      return false;
    }
  }
  async function remove(r: WorkRecord) {
    if (await change(r, {}, 'delete')) setUndo(r);
  }
  const row = (r: WorkRecord) => (
    <TaskRow
      key={r.id}
      record={r}
      records={records}
      selected={selected.includes(r.id)}
      onSelect={() =>
        setSelected((s) => (s.includes(r.id) ? s.filter((id) => id !== r.id) : [...s, r.id]))
      }
      onEdit={() => setEdit({ kind: 'task', record: r })}
      onChange={(p, op) => void change(r, p, op)}
      onDelete={() => void remove(r)}
      onDrop={(id) => {
        const source = records.find((item) => item.id === id);
        if (source && source.id !== r.id)
          void change(
            source,
            {
              position: Number(r.data.position) - 0.25,
              ...(view === 'board' ? { status: r.data.status } : {}),
              ...(view === 'project' ? { projectId: r.data.projectId } : {}),
            },
            view === 'board' && r.data.status === 'done' ? 'complete' : 'upsert',
          );
      }}
      onMove={(direction) => {
        const index = filtered.findIndex((t) => t.id === r.id);
        const other = filtered[index + direction];
        if (other) void change(r, { position: Number(other.data.position) + direction * 0.5 });
      }}
    />
  );
  const drop = (e: React.DragEvent, patch: Record<string, unknown>) => {
    e.preventDefault();
    const r = records.find((r) => r.id === e.dataTransfer.getData('text/lifeos-task'));
    if (r) void change(r, patch);
  };
  const stalled = projects.filter(
    (r) =>
      r.data.status === 'active' &&
      now -
        Math.max(
          Date.parse(r.updatedAt),
          ...tasks.filter((t) => t.data.projectId === r.id).map((t) => Date.parse(t.updatedAt)),
        ) >
        7 * 86400000,
  );
  const first = Temporal.PlainDate.from(month + '-01');
  const offset = (first.dayOfWeek - (preferences?.weekStart === 'sunday' ? 7 : 1) + 7) % 7;
  if (!local.data)
    return (
      <div className="page">
        <p role="status">{c.loading}</p>
        <SyncPanel />
      </div>
    );
  return (
    <div
      className="page work-page"
      onTouchStart={(e) => {
        pullStart.current =
          window.scrollY === 0 &&
          !(e.target as HTMLElement).closest('input,button,select,textarea,.task-row')
            ? e.touches[0].clientY
            : null;
      }}
      onTouchEnd={(e) => {
        if (
          pullStart.current !== null &&
          window.scrollY === 0 &&
          e.changedTouches[0].clientY - pullStart.current > 90
        )
          void flush().catch(() => setNotice(c.error));
        pullStart.current = null;
      }}
    >
      <div className="page-heading work-heading">
        <div>
          <p className="eyebrow">
            {new Intl.DateTimeFormat(locale, {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              timeZone: zone,
            }).format(new Date())}
          </p>
          <h1>{c[mode]}</h1>
          <p>{mode === 'review' ? c.reviewHint : c.ready}</p>
        </div>
        <div className="heading-actions">
          {mode === 'projects' ? (
            <>
              <Button onClick={() => setEdit({ kind: 'project' })}>
                <Plus size={18} />
                {c.newProject}
              </Button>
              <Button variant="outline" onClick={() => setEdit({ kind: 'area' })}>
                {c.newArea}
              </Button>
            </>
          ) : (
            <Button onClick={openCapture}>
              <Plus size={18} />
              {c.newTask}
            </Button>
          )}
        </div>
      </div>
      <SyncPanel />
      <div className="work-status">
        <span role="status">{notice}</span>
        {undo && (
          <Button
            variant="outline"
            onClick={() => {
              void change(undo, {}, 'restore');
              setUndo(null);
            }}
          >
            <RotateCcw size={16} />
            {c.undo}
          </Button>
        )}
        <Button variant="ghost" onClick={() => void flush().catch(() => setNotice(c.error))}>
          {c.refresh}
        </Button>
      </div>
      {mode === 'projects' ? (
        <>
          <div className="work-toolbar">
            <label className="work-search">
              <Search size={18} />
              <input
                aria-label={c.searchProjects}
                placeholder={c.searchProjects}
                value={projectSearch}
                onChange={(e) => setProjectSearch(e.target.value)}
              />
            </label>
            <select
              aria-label={c.status}
              value={projectStatus}
              onChange={(e) => setProjectStatus(e.target.value)}
            >
              <option value="">{c.allStatuses}</option>
              {(['active', 'paused', 'done'] as const).map((status) => (
                <option key={status} value={status}>
                  {c[status]}
                </option>
              ))}
            </select>
            <span role="status">
              {visibleProjects.length} / {projects.length} {c.projects.toLocaleLowerCase(locale)}
            </span>
          </div>
          <div className="work-tabs">
            <button
              aria-pressed={!area}
              className={!area ? 'active' : ''}
              onClick={() => setArea('')}
            >
              {c.all}
            </button>
            {live
              .filter((r) => r.kind === 'area')
              .map((r) => (
                <span key={r.id} className="area-tab">
                  <button
                    onClick={() => setArea(r.id)}
                    aria-pressed={area === r.id}
                    className={area === r.id ? 'active' : ''}
                    style={{ borderColor: String(r.data.color) }}
                  >
                    {String(r.data.title)}
                  </button>
                  <button
                    aria-label={`${c.edit}: ${r.data.title}`}
                    onClick={() => setEdit({ kind: 'area', record: r })}
                  >
                    …
                  </button>
                </span>
              ))}
          </div>
          <div className="project-grid">
            {visibleProjects.map((p) => {
              const data = projectData(p);
              const linked = tasks.filter((t) => t.data.projectId === p.id);
              const done = linked.filter((t) => t.data.status === 'done').length;
              return (
                <section
                  className="card project-card"
                  key={p.id}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => drop(e, { projectId: p.id })}
                >
                  <div className="project-top">
                    <Folder size={22} />
                    <span className="small-tag">{c[data.status]}</span>
                  </div>
                  <h2>{data.title}</h2>
                  <p>{data.goal}</p>
                  <progress value={done} max={linked.length || 1} aria-label={c.progress} />
                  <small>
                    {done}/{linked.length} · {data.deadline ?? c.noDue}
                  </small>
                  {data.notes && (
                    <div className="markdown">
                      <Markdown>{data.notes}</Markdown>
                    </div>
                  )}
                  <div className="project-actions">
                    <Button
                      variant="outline"
                      onClick={() => setEdit({ kind: 'project', record: p })}
                    >
                      {c.edit}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => setEdit({ kind: 'task', initial: { projectId: p.id } })}
                    >
                      {c.newTask}
                    </Button>
                    <Button variant="ghost" onClick={() => void remove(p)}>
                      {c.remove}
                    </Button>
                  </div>
                  <h3>{c.milestones}</h3>
                  {live
                    .filter((m) => m.kind === 'milestone' && m.data.projectId === p.id)
                    .map((m) => (
                      <div className="milestone-row" key={m.id}>
                        <input
                          type="checkbox"
                          aria-label={String(m.data.title)}
                          checked={!!m.data.done}
                          onChange={() => void change(m, { done: !m.data.done })}
                        />
                        <button onClick={() => setEdit({ kind: 'milestone', record: m })}>
                          {String(m.data.title)} <small>{String(m.data.dueDate ?? '')}</small>
                        </button>
                        <button
                          className="icon-button"
                          aria-label={c.remove}
                          onClick={() => void remove(m)}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  <Button
                    variant="ghost"
                    onClick={() => setEdit({ kind: 'milestone', initial: { projectId: p.id } })}
                  >
                    {c.newMilestone}
                  </Button>
                  <details>
                    <summary>
                      {c.tasks} ({linked.length})
                    </summary>
                    {linked.map(row)}
                  </details>
                </section>
              );
            })}
          </div>
          {!projects.length && (
            <Empty
              c={c}
              kind="project"
              onAdd={() => setEdit({ kind: 'project', initial: { areaId: area || null } })}
            />
          )}
          {!!projects.length && !visibleProjects.length && (
            <section className="work-empty">
              <Search size={34} />
              <h2>{c.noResults}</h2>
              <p>{c.noResultsHint}</p>
              <Button
                variant="outline"
                onClick={() => {
                  setArea('');
                  setProjectStatus('');
                  setProjectSearch('');
                }}
              >
                {c.resetFilters}
              </Button>
            </section>
          )}
        </>
      ) : mode === 'review' ? (
        <div className="review-grid">
          <section className="card">
            <h2>
              {c.stalled} ({stalled.length})
            </h2>
            {stalled.map((p) => (
              <button
                className="command-result"
                key={p.id}
                onClick={() => setEdit({ kind: 'project', record: p })}
              >
                {String(p.data.title)}
              </button>
            ))}
          </section>
          <section>
            <h2>{c.overdue}</h2>
            {tasks
              .filter(
                (t) => t.data.status !== 'done' && t.data.dueDate && String(t.data.dueDate) < today,
              )
              .map(row)}
          </section>
          <section>
            <h2>{c.processInbox}</h2>
            {tasks.filter((t) => t.data.status !== 'done' && !t.data.projectId).map(row)}
          </section>
        </div>
      ) : (
        <>
          <nav className="work-tabs" aria-label={c.tasks}>
            {views.map((v) => (
              <button
                key={v}
                className={view === v ? 'active' : ''}
                aria-pressed={view === v}
                onClick={() => {
                  setView(v);
                  setGroup('');
                  setSelected([]);
                }}
              >
                {c[v]}
              </button>
            ))}
          </nav>
          <div className="work-toolbar">
            <label className="work-search">
              <Search size={18} />
              <input
                aria-label={c.search}
                placeholder={c.search}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            {(view === 'project' || view === 'tag') && (
              <select aria-label={c[view]} value={group} onChange={(e) => setGroup(e.target.value)}>
                <option value="">{c.all}</option>
                {(view === 'project'
                  ? projects.map((p) => ({ id: p.id, title: String(p.data.title) }))
                  : [...new Set(tasks.flatMap((t) => taskData(t).tags))].map((tag) => ({
                      id: tag,
                      title: '#' + tag,
                    }))
                ).map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.title}
                  </option>
                ))}
              </select>
            )}
            <Button
              variant="outline"
              disabled={!query}
              onClick={() => setEdit({ kind: 'filter', initial: { query } })}
            >
              {c.newFilter}
            </Button>
          </div>
          {live.some((r) => r.kind === 'filter') && (
            <div className="saved-filters">
              {live
                .filter((r) => r.kind === 'filter')
                .map((f) => (
                  <span key={f.id}>
                    <button
                      onClick={() => {
                        setQuery(String(f.data.query));
                        setView('board');
                      }}
                    >
                      {String(f.data.title)}
                    </button>
                    <button
                      aria-label={`${c.remove}: ${f.data.title}`}
                      onClick={() => void remove(f)}
                    >
                      ×
                    </button>
                  </span>
                ))}
            </div>
          )}
          {!!selected.length && (
            <div className="bulk-bar">
              <strong>
                {selected.length} {c.selected}
              </strong>
              <Button
                onClick={() => {
                  for (const id of selected) {
                    const r = records.find((r) => r.id === id)!;
                    void change(r, {}, 'complete');
                  }
                  setSelected([]);
                }}
              >
                {c.complete}
              </Button>
              <select
                aria-label={c.move}
                defaultValue=""
                onChange={(e) => {
                  for (const id of selected)
                    void change(
                      records.find((r) => r.id === id)!,
                      { projectId: e.target.value || null },
                    );
                  setSelected([]);
                }}
              >
                <option value="">{c.move}</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {String(p.data.title)}
                  </option>
                ))}
              </select>
              <Button
                variant="outline"
                onClick={() => {
                  for (const id of selected)
                    void change(
                      records.find((r) => r.id === id)!,
                      {},
                      'delete',
                    );
                  setSelected([]);
                }}
              >
                {c.remove}
              </Button>
              <Button variant="ghost" onClick={() => setSelected([])}>
                {c.clear}
              </Button>
            </div>
          )}
          {view === 'board' ? (
            <div className="kanban">
              {(['todo', 'doing'] as const).map((status) => (
                <section
                  key={status}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => drop(e, { status })}
                >
                  <h2>
                    {c[status]}{' '}
                    <small>{filtered.filter((r) => r.data.status === status).length}</small>
                  </h2>
                  {filtered.filter((r) => r.data.status === status).map(row)}
                </section>
              ))}
              <section
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const r = records.find(
                    (r) => r.id === e.dataTransfer.getData('text/lifeos-task'),
                  );
                  if (r) void change(r, {}, 'complete');
                }}
              >
                <h2>{c.done}</h2>
                {tasks
                  .filter((r) => r.data.status === 'done' && matchesQuery(taskData(r), query, zone))
                  .map(row)}
              </section>
            </div>
          ) : view === 'calendar' ? (
            <>
              <div className="calendar-toolbar">
                <Button
                  variant="outline"
                  aria-label={c.previous}
                  onClick={() => setMonth(first.subtract({ months: 1 }).toString().slice(0, 7))}
                >
                  ←
                </Button>
                <label>
                  {c.month}
                  <input
                    type="month"
                    value={month}
                    onChange={(e) => {
                      if (e.target.value) setMonth(e.target.value);
                    }}
                  />
                </label>
                <Button
                  variant="outline"
                  aria-label={c.next}
                  onClick={() => setMonth(first.add({ months: 1 }).toString().slice(0, 7))}
                >
                  →
                </Button>
              </div>
              <div className="deadline-calendar">
                {Array.from({ length: offset }, (_, i) => (
                  <div key={'blank' + i} />
                ))}
                {Array.from({ length: first.daysInMonth }, (_, i) => {
                  const day = first.add({ days: i }).toString();
                  return (
                    <section
                      key={day}
                      className={day === today ? 'is-today' : ''}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => drop(e, { dueDate: day, dueAt: null })}
                    >
                      <button
                        aria-label={`${c.newTask}: ${day}`}
                        onClick={() => setEdit({ kind: 'task', initial: { dueDate: day } })}
                      >
                        {i + 1}
                      </button>
                      {filtered
                        .filter((r) => r.data.dueDate === day)
                        .map((r) => (
                          <button
                            draggable
                            onDragStart={(e) => e.dataTransfer.setData('text/lifeos-task', r.id)}
                            className="calendar-task"
                            key={r.id}
                            onClick={() => setEdit({ kind: 'task', record: r })}
                          >
                            {String(r.data.title)}
                          </button>
                        ))}
                    </section>
                  );
                })}
              </div>
            </>
          ) : view === 'trash' ? (
            <>
              <p>{c.deleteHint}</p>
              {filtered.map((r) => (
                <div className="task-row" key={r.id}>
                  <span>{String(r.data.title)}</span>
                  <Button variant="outline" onClick={() => void change(r, {}, 'restore')}>
                    {c.restore}
                  </Button>
                </div>
              ))}
            </>
          ) : (
            <VirtualList rows={filtered} render={row} />
          )}
          {!filtered.length && view !== 'calendar' && view !== 'board' && (
            <Empty c={c} onAdd={openCapture} />
          )}
          <p className="work-hint">{c.dragHint}</p>
        </>
      )}
      {edit && <Editor edit={edit} records={records} close={() => setEdit(null)} />}
    </div>
  );
}
function Empty({
  c,
  onAdd,
  kind = 'task',
}: {
  c: Copy;
  onAdd: () => void;
  kind?: 'task' | 'project';
}) {
  return (
    <section className="work-empty">
      <Inbox size={34} />
      <h2>{c.empty}</h2>
      <p>{kind === 'project' ? c.emptyProjectHint : c.emptyHint}</p>
      <Button variant="outline" onClick={onAdd}>
        <Plus size={18} />
        {kind === 'project' ? c.createProject : c.createTask}
      </Button>
    </section>
  );
}
