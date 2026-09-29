import { Temporal } from '@js-temporal/polyfill';
import { rrulestr } from 'rrule';
import {
  schemas,
  taskData,
  type Task,
  type WorkRecord,
  type WorkMutation,
  type WorkSnapshot,
} from './schema';
export function todayIn(zone: string, now = Date.now()) {
  return Temporal.Instant.fromEpochMilliseconds(now)
    .toZonedDateTimeISO(zone)
    .toPlainDate()
    .toString();
}
export function dateAt(date: string, time: string, zone: string) {
  return Temporal.PlainDate.from(date)
    .toPlainDateTime(Temporal.PlainTime.from(time))
    .toZonedDateTime(zone, { disambiguation: 'reject' })
    .toInstant()
    .toString();
}
export function taskEditorValues(data: Record<string, unknown>, zone: string) {
  return {
    ...data,
    timezone: data.timezone ?? zone,
    dueAt: data.dueAt
      ? Temporal.Instant.from(String(data.dueAt))
          .toZonedDateTimeISO(String(data.timezone ?? zone))
          .toPlainTime()
          .toString({ smallestUnit: 'second' })
      : null,
  };
}
export function validateRule(rule: string) {
  if (!rule) return;
  if (!/^FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)(;[A-Z]+=[A-Z0-9,+-]+)*$/.test(rule))
    throw new Error('invalid_recurrence');
  const parsed = rrulestr('RRULE:' + rule);
  if (
    parsed.options.interval < 1 ||
    parsed.options.interval > 366 ||
    (parsed.options.count !== null && (parsed.options.count < 1 || parsed.options.count > 10000))
  )
    throw new Error('invalid_recurrence');
}
export function nextOccurrence(task: Task) {
  validateRule(task.recurrence);
  if (!task.recurrence || (!task.dueDate && !task.dueAt)) return null;
  const base = task.dueAt
    ? Temporal.Instant.from(task.dueAt).toZonedDateTimeISO(task.timezone)
    : Temporal.PlainDate.from(task.dueDate!).toZonedDateTime({
        timeZone: task.timezone,
        plainTime: '12:00',
      });
  const anchor = task.recurrenceStart
    ? Temporal.Instant.from(task.recurrenceStart).toZonedDateTimeISO(task.timezone)
    : base;
  const local = anchor.toPlainDateTime().toString({ smallestUnit: 'second' }).replace(/[-:]/g, '');
  const rule = rrulestr(`DTSTART:${local}Z\nRRULE:${task.recurrence}`);
  const floating = new Date(base.toPlainDateTime().toString({ smallestUnit: 'second' }) + 'Z');
  const horizon = new Date(floating);
  horizon.setUTCFullYear(horizon.getUTCFullYear() + 10);
  const next = rule.between(floating, horizon, false, (_date, index) => index === 0)[0];
  if (!next) return null;
  const instant = Temporal.PlainDateTime.from(next.toISOString().slice(0, 19))
    .toZonedDateTime(task.timezone, { disambiguation: 'compatible' })
    .toInstant();
  return {
    dueAt: task.dueAt ? instant.toString() : null,
    dueDate: instant.toZonedDateTimeISO(task.timezone).toPlainDate().toString(),
  };
}
export function parseCapture(input: string, zone: string, now = Date.now()) {
  let title = input.trim();
  const tags = [...title.matchAll(/#([\p{L}\p{N}_-]+)/gu)].map((m) => m[1]);
  title = title.replace(/#[\p{L}\p{N}_-]+/gu, ' ');
  const p = /\bp([1-4])\b/i.exec(title);
  const priority = p ? Number(p[1]) : 4;
  if (p) title = title.replace(p[0], ' ');
  let dueDate: string | null = null;
  let dueAt: string | null = null;
  let recurrence = '';
  const recurring =
    /\b(ogni giorno|every day|ogni settimana|every week|ogni mese|every month)\b/i.exec(title);
  if (recurring) {
    recurrence =
      'FREQ=' +
      (/giorno|day/i.test(recurring[0])
        ? 'DAILY'
        : /settimana|week/i.test(recurring[0])
          ? 'WEEKLY'
          : 'MONTHLY');
    title = title.replace(recurring[0], ' ');
  }
  const day = Temporal.PlainDate.from(todayIn(zone, now));
  const relative = /\b(dopodomani|domani|oggi|tomorrow|today)\b/i.exec(title);
  const iso = /\b(\d{4}-\d{2}-\d{2})\b/.exec(title);
  const weekday =
    /\b(next\s+|prossimo\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday|lunedì|martedì|mercoledì|giovedì|venerdì|sabato|domenica)(?:\s+prossimo)?/iu.exec(
      title,
    );
  if (relative) {
    dueDate = day
      .add({
        days: /dopodomani/i.test(relative[0]) ? 2 : /domani|tomorrow/i.test(relative[0]) ? 1 : 0,
      })
      .toString();
    title = title.replace(relative[0], ' ');
  } else if (iso) {
    dueDate = Temporal.PlainDate.from(iso[1]).toString();
    title = title.replace(iso[0], ' ');
  } else if (weekday) {
    const names = [
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
      'sunday',
      'lunedì',
      'martedì',
      'mercoledì',
      'giovedì',
      'venerdì',
      'sabato',
      'domenica',
    ];
    const target = (names.indexOf(weekday[2].toLowerCase()) % 7) + 1;
    dueDate = day.add({ days: (target - day.dayOfWeek + 7) % 7 || 7 }).toString();
    title = title.replace(weekday[0], ' ');
  }
  if (recurrence && !dueDate) dueDate = day.toString();
  const clock =
    /(?:\b(?:alle|at)\s+)(\d{1,2})(?::(\d{2}))?(?:\s*(am|pm))?\b|\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.exec(
      title,
    );
  if (clock) {
    let h = Number(clock[1] ?? clock[4]);
    const min = Number(clock[2] ?? clock[5] ?? 0);
    const ap = clock[3] ?? clock[6];
    if (ap) {
      if (h < 1 || h > 12) throw new Error('invalid_time');
      h = (h % 12) + (ap.toLowerCase() === 'pm' ? 12 : 0);
    }
    dueDate ??= day.toString();
    dueAt = dateAt(dueDate, `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`, zone);
    title = title.replace(clock[0], ' ');
  }
  return {
    title: title.replace(/\s+/g, ' ').trim(),
    tags: [...new Set(tags)],
    priority,
    dueDate,
    dueAt,
    recurrence,
    timezone: zone,
  };
}
export function validateRelations(records: WorkRecord[], candidate: WorkRecord) {
  const data = schemas[candidate.kind].parse(candidate.data);
  const requireRef = (id: unknown, kind: string) => {
    if (id && !records.some((r) => r.id === id && r.kind === kind && !r.deletedAt))
      throw new Error('missing_relation');
  };
  if (candidate.kind === 'task') {
    const task = taskData(candidate);
    requireRef(task.projectId, 'project');
    requireRef(task.parentId, 'task');
    validateRule(task.recurrence);
    todayIn(task.timezone);
    if (task.recurrence && !task.dueAt && !task.dueDate) throw new Error('recurrence_requires_due');
    const visited = new Set([candidate.id]);
    let parent = task.parentId;
    while (parent) {
      if (visited.has(parent)) throw new Error('task_cycle');
      visited.add(parent);
      const row = records.find((r) => r.id === parent);
      parent = row ? taskData(row).parentId : null;
    }
  }
  if ('areaId' in data) requireRef(data.areaId, 'area');
  if (candidate.kind === 'milestone')
    requireRef((data as { projectId: string }).projectId, 'project');
}
export function applyWork(snapshot: WorkSnapshot, mutation: WorkMutation) {
  const records = snapshot.records.map((r) => ({
    ...r,
    data: { ...r.data },
    clocks: { ...r.clocks },
  }));
  const index = records.findIndex((r) => r.id === mutation.recordId);
  let record = records[index];
  const conflicts: string[] = [];
  const stamp = new Date(mutation.at).toISOString();
  if (record && record.kind !== mutation.kind) throw new Error('kind_mismatch');
  if (!record) {
    if (mutation.operation !== 'upsert') throw new Error('not_found');
    const initial = schemas[mutation.kind].parse(mutation.patch);
    record = {
      id: mutation.recordId,
      kind: mutation.kind,
      data: initial,
      createdAt: stamp,
      updatedAt: stamp,
      deletedAt: null,
      version: 1,
      clocks: Object.fromEntries(
        [...Object.keys(initial), 'deletedAt']
          .filter((key) => !(key in mutation.patch))
          .map((key) => [key, { at: mutation.at, clientId: mutation.clientId }]),
      ),
    };
  }
  const newer = (field: string) => {
    const old = record.clocks[field];
    return (
      !old || mutation.at > old.at || (mutation.at === old.at && mutation.clientId > old.clientId)
    );
  };
  const patch = { ...mutation.patch };
  if (mutation.operation === 'complete') {
    patch.status = 'done';
    patch.completedAt = stamp;
  }
  if (record.deletedAt && mutation.operation !== 'restore' && mutation.operation !== 'delete')
    return { snapshot: { revision: snapshot.revision, records }, conflicts: ['deletedAt'] };
  if (
    mutation.operation === 'restore' &&
    record.deletedAt &&
    mutation.at - Date.parse(record.deletedAt) > 30 * 86400000
  )
    throw new Error('trash_expired');
  let changed = index < 0;
  if (mutation.operation === 'delete' || mutation.operation === 'restore') {
    if (newer('deletedAt')) {
      record.deletedAt = mutation.operation === 'delete' ? stamp : null;
      record.clocks.deletedAt = { at: mutation.at, clientId: mutation.clientId };
      changed = true;
    } else conflicts.push('deletedAt');
  } else
    for (const [field, value] of Object.entries(patch)) {
      if (newer(field)) {
        record.data[field] = value;
        record.clocks[field] = { at: mutation.at, clientId: mutation.clientId };
        changed = true;
      } else conflicts.push(field);
    }
  record.data = schemas[record.kind].parse(record.data);
  if (!record.deletedAt) validateRelations(records, record);
  if (changed) {
    record.updatedAt = stamp;
    if (index >= 0) record.version++;
  }
  if (index < 0) records.push(record);
  else records[index] = record;
  if (mutation.operation === 'complete' && changed && !conflicts.includes('status')) {
    const old = index < 0 ? null : snapshot.records[index];
    const task = taskData(record);
    if (old && taskData(old).status !== 'done' && task.recurrence) {
      const due = nextOccurrence(task);
      if (due) {
        if (records.some((r) => r.id === mutation.nextId)) throw new Error('duplicate_successor');
        const data = {
          ...task,
          ...due,
          recurrenceStart:
            task.recurrenceStart ?? task.dueAt ?? dateAt(task.dueDate!, '12:00', task.timezone),
          status: 'todo' as const,
          completedAt: null,
          actual: 0,
          reminders: [],
        };
        records.push({
          ...record,
          id: mutation.nextId!,
          data,
          version: 1,
          clocks: Object.fromEntries(
            Object.keys(data).map((k) => [k, { at: mutation.at, clientId: mutation.clientId }]),
          ),
        });
      }
    }
  }
  return { snapshot: { revision: snapshot.revision + (changed ? 1 : 0), records }, conflicts };
}
export function optimisticWork(snapshot: WorkSnapshot, queue: WorkMutation[]) {
  return queue.reduce((s, m) => {
    try {
      return applyWork(s, m).snapshot;
    } catch {
      return s;
    }
  }, snapshot);
}
export function matchesQuery(task: Task, query: string, zone: string, now = Date.now()) {
  const today = todayIn(zone, now);
  const end = Temporal.PlainDate.from(today)
    .add({ days: 7 - Temporal.PlainDate.from(today).dayOfWeek })
    .toString();
  return query.split('&').every((raw) => {
    const term = raw.trim().toLowerCase();
    if (!term) return true;
    if (/^p[1-4]$/.test(term)) return task.priority === Number(term[1]);
    if (term.startsWith('#')) return task.tags.some((t) => t.toLowerCase() === term.slice(1));
    if (term === 'due:today') return task.dueDate === today;
    if (term === 'due:overdue') return !!task.dueDate && task.dueDate < today;
    if (term === 'due:this week')
      return !!task.dueDate && task.dueDate >= today && task.dueDate <= end;
    if (term.startsWith('status:')) return task.status === term.slice(7);
    return (task.title + ' ' + task.notes + ' ' + task.tags.join(' ')).toLowerCase().includes(term);
  });
}
export function taskDepth(record: WorkRecord, records: WorkRecord[]) {
  let depth = 0;
  let parent = taskData(record).parentId;
  const seen = new Set([record.id]);
  while (parent && !seen.has(parent)) {
    seen.add(parent);
    depth++;
    const r = records.find((r) => r.id === parent);
    parent = r ? taskData(r).parentId : null;
  }
  return depth;
}

export function parentTaskOptions(records: WorkRecord[], taskId?: string) {
  const tasks = records.filter((r) => r.kind === 'task');
  const children = new Map<string, string[]>();
  for (const task of tasks) {
    if (typeof task.data.parentId !== 'string') continue;
    const siblings = children.get(task.data.parentId) ?? [];
    siblings.push(task.id);
    children.set(task.data.parentId, siblings);
  }
  const excluded = new Set<string>();
  const pending = taskId ? [taskId] : [];
  while (pending.length) {
    const id = pending.pop()!;
    if (excluded.has(id)) continue;
    excluded.add(id);
    pending.push(...(children.get(id) ?? []));
  }
  return tasks.filter((task) => !task.deletedAt && !excluded.has(task.id));
}

export function fuzzyScore(text: string, query: string) {
  const normalized = (s: string) =>
    s
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  const haystack = normalized(text),
    needle = normalized(query).replace(/\s/g, '');
  if (!needle) return 0;
  if (haystack.includes(normalized(query))) return 1000 - haystack.indexOf(normalized(query));
  let position = 0,
    span = 0;
  for (const char of needle) {
    const found = haystack.indexOf(char, position);
    if (found < 0) return -1;
    span += found - position;
    position = found + 1;
  }
  return 100 - span;
}

export function mergeWorkAck(current: WorkSnapshot, delta: WorkSnapshot): WorkSnapshot {
  const records = new Map(current.records.map((record) => [record.id, record]));
  for (const record of delta.records) {
    const old = records.get(record.id);
    if (!old || record.version > old.version) records.set(record.id, record);
  }
  return { revision: Math.max(current.revision, delta.revision), records: [...records.values()] };
}
