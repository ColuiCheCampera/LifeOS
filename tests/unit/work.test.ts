import { describe, it, expect } from 'vitest';
import { v7 as uuid } from 'uuid';
import {
  mergeWorkAck,
  fuzzyScore,
  parseCapture,
  dateAt,
  todayIn,
  validateRule,
  nextOccurrence,
  applyWork,
  optimisticWork,
  matchesQuery,
  taskDepth,
  parentTaskOptions,
  taskEditorValues,
} from '@/features/work/domain';
import {
  taskSchema,
  workMutationSchema,
  recordSchema,
  emptyWork,
  type WorkMutation,
} from '@/features/work/schema';
const now = Date.parse('2026-09-25T10:00:00Z');
const actor = uuid();
function mutation(patch: Record<string, unknown>, rest: Partial<WorkMutation> = {}): WorkMutation {
  return {
    id: uuid(),
    clientId: actor,
    at: now,
    kind: 'task',
    recordId: uuid(),
    operation: 'upsert',
    patch,
    ...rest,
  };
}
const create = (patch: Record<string, unknown> = { title: 'Task' }) =>
  applyWork(emptyWork(), mutation(patch)).snapshot;
describe('capture and calendar math', () => {
  it('edits a deadline in local time and preserves the clock across a DST date change', () => {
    const values = taskEditorValues(
      { dueAt: '2026-03-28T16:00:00Z', timezone: 'Europe/Rome' },
      'UTC',
    );
    expect(values.dueAt).toBe('17:00:00');
    expect(dateAt('2026-03-29', values.dueAt!, String(values.timezone))).toBe(
      '2026-03-29T15:00:00Z',
    );
    expect(taskEditorValues({}, 'Europe/Rome')).toEqual({ timezone: 'Europe/Rome', dueAt: null });
    expect(() => dateAt('2026-03-29', '02:30:00', 'Europe/Rome')).toThrow();
  });
  it('parses Italian date, clock, priority and unicode tag', () =>
    expect(
      parseCapture('Pagare bolletta domani alle 17 #casa p1', 'Europe/Rome', now),
    ).toMatchObject({
      title: 'Pagare bolletta',
      dueDate: '2026-09-26',
      dueAt: '2026-09-26T15:00:00Z',
      tags: ['casa'],
      priority: 1,
    }));
  it('parses next weekday and English am/pm', () =>
    expect(parseCapture('pay tax next Friday 5pm #finance p2', 'Europe/Rome', now)).toMatchObject({
      title: 'pay tax',
      dueDate: '2026-10-02',
      dueAt: '2026-10-02T15:00:00Z',
      priority: 2,
    }));
  it.each([
    ['oggi', '2026-09-25'],
    ['tomorrow', '2026-09-26'],
    ['dopodomani', '2026-09-27'],
    ['2026-10-01', '2026-10-01'],
    ['lunedì prossimo', '2026-09-28'],
  ])('understands %s', (text, date) =>
    expect(parseCapture('test ' + text, 'Europe/Rome', now).dueDate).toBe(date),
  );
  it.each([
    ['ogni giorno', 'DAILY'],
    ['every week', 'WEEKLY'],
    ['ogni mese', 'MONTHLY'],
  ])('parses recurrence %s', (text, freq) =>
    expect(parseCapture('test ' + text, 'Europe/Rome', now)).toMatchObject({
      recurrence: 'FREQ=' + freq,
      dueDate: '2026-09-25',
    }),
  );
  it('keeps plain text and midnight semantics', () => {
    expect(parseCapture('read book', 'UTC', now).dueDate).toBeNull();
    expect(parseCapture('read 12am', 'UTC', now).dueAt).toBe('2026-09-25T00:00:00Z');
    expect(parseCapture('read 12pm', 'UTC', now).dueAt).toBe('2026-09-25T12:00:00Z');
  });
  it('deduplicates tags and refuses impossible dates/times', () => {
    expect(parseCapture('test #casa #casa', 'UTC', now).tags).toEqual(['casa']);
    expect(() => parseCapture('test 2026-02-30', 'UTC', now)).toThrow();
    expect(() => parseCapture('test 15pm', 'UTC', now)).toThrow();
    expect(() => dateAt('2026-03-29', '02:30', 'Europe/Rome')).toThrow();
  });
  it('respects local date at UTC midnight', () =>
    expect(todayIn('America/New_York', Date.parse('2026-09-25T01:00:00Z'))).toBe('2026-09-24'));
  it('validates recurrence syntax', () => {
    expect(() => validateRule('')).not.toThrow();
    expect(() => validateRule('FREQ=DAILY;INTERVAL=2')).not.toThrow();
    expect(() => validateRule('oops')).toThrow();
  });
  it('keeps wall time over DST and supports finite COUNT', () => {
    const task = taskSchema.parse({
      title: 'Daily',
      dueDate: '2026-03-28',
      dueAt: '2026-03-28T08:00:00Z',
      recurrence: 'FREQ=DAILY;COUNT=2',
    });
    const next = nextOccurrence(task)!;
    expect(next.dueAt).toBe('2026-03-29T07:00:00Z');
    expect(nextOccurrence({ ...task, ...next, recurrenceStart: task.dueAt })).toBeNull();
  });
  it('handles all-day month ends and no recurrence', () => {
    expect(nextOccurrence(taskSchema.parse({ title: 'x' }))).toBeNull();
    expect(
      nextOccurrence(
        taskSchema.parse({ title: 'x', dueDate: '2026-01-31', recurrence: 'FREQ=MONTHLY' }),
      )?.dueDate,
    ).toBe('2026-03-31');
  });
});
describe('work boundary and reconciliation', () => {
  it('rejects unknown fields and invalid operation payloads', () => {
    expect(workMutationSchema.safeParse(mutation({ title: 'x', userId: uuid() })).success).toBe(
      false,
    );
    expect(workMutationSchema.safeParse(mutation({})).success).toBe(false);
    expect(workMutationSchema.safeParse(mutation({}, { operation: 'complete' })).success).toBe(
      false,
    );
    expect(recordSchema.safeParse({ ...create().records[0], data: { title: '' } }).success).toBe(
      false,
    );
  });
  it('preserves independent concurrent fields, rejects stale clocks and breaks ties', () => {
    const base = create();
    const id = base.records[0].id;
    const a = mutation({ title: 'New' }, { recordId: id, at: now + 10 });
    const b = mutation({ priority: 1 }, { recordId: id, at: now + 5 });
    const ab = applyWork(applyWork(base, a).snapshot, b).snapshot;
    const ba = applyWork(applyWork(base, b).snapshot, a).snapshot;
    expect(ab.records[0].data).toEqual(ba.records[0].data);
    expect(applyWork(ab, mutation({ title: 'Old' }, { recordId: id, at: 1 })).conflicts).toEqual([
      'title',
    ]);
    const tied = applyWork(
      ab,
      mutation({ title: 'Tie' }, { recordId: id, at: now + 10, clientId: 'z' }),
    );
    expect(tied.snapshot.records[0].data.title).toBe('Tie');
  });
  it('validates ownership references, parent cycles and arbitrary depth', () => {
    let state = create();
    const parent = state.records[0].id;
    expect(() => applyWork(state, mutation({ title: 'x', projectId: uuid() }))).toThrow(
      'missing_relation',
    );
    expect(() =>
      applyWork(state, mutation({ parentId: parent }, { recordId: parent, at: now + 1 })),
    ).toThrow('task_cycle');
    for (let i = 0; i < 30; i++)
      state = applyWork(
        state,
        mutation({ title: 'child', parentId: state.records.at(-1)!.id }),
      ).snapshot;
    expect(taskDepth(state.records.at(-1)!, state.records)).toBe(30);
    expect(taskDepth(state.records[0], state.records)).toBe(0);
    expect(parentTaskOptions(state.records, parent)).toEqual([]);
    expect(parentTaskOptions(state.records, state.records.at(-1)!.id)).toHaveLength(30);
    expect(parentTaskOptions(state.records)).toHaveLength(31);
    expect(() =>
      applyWork(
        state,
        mutation({ parentId: state.records.at(-1)!.id }, { recordId: parent, at: now + 1 }),
      ),
    ).toThrow('task_cycle');
  });
  it('excludes descendants through deleted nodes and terminates on corrupted cycles', () => {
    let state = create({ title: 'Root' });
    const root = state.records[0].id;
    state = applyWork(state, mutation({ title: 'Child', parentId: root })).snapshot;
    const child = state.records[1].id;
    state = applyWork(state, mutation({ title: 'Grandchild', parentId: child })).snapshot;
    state = applyWork(state, mutation({ title: 'Unrelated' })).snapshot;
    const other = state.records[3].id;
    const records = structuredClone(state.records);
    records[1].deletedAt = new Date(now).toISOString();
    records[0].data.parentId = records[2].id;
    expect(parentTaskOptions(records, root).map((r) => r.id)).toEqual([other]);
    expect(parentTaskOptions(records, uuid()).map((r) => r.id)).toEqual([
      root,
      records[2].id,
      other,
    ]);
  });
  it('validates areas, milestones and project references', () => {
    let state = applyWork(emptyWork(), mutation({ title: 'Work' }, { kind: 'area' })).snapshot;
    const area = state.records[0].id;
    state = applyWork(
      state,
      mutation({ title: 'Project', areaId: area }, { kind: 'project' }),
    ).snapshot;
    const project = state.records[1].id;
    state = applyWork(
      state,
      mutation({ title: 'Milestone', projectId: project }, { kind: 'milestone' }),
    ).snapshot;
    expect(state.records).toHaveLength(3);
    expect(() =>
      applyWork(state, mutation({ title: 'bad', projectId: area }, { kind: 'milestone' })),
    ).toThrow();
  });
  it('supports deletion, restoration and tombstone conflicts', () => {
    const base = create();
    const recordId = base.records[0].id;
    const deleted = applyWork(
      base,
      mutation({}, { operation: 'delete', recordId, at: now + 2 }),
    ).snapshot;
    expect(deleted.records[0].deletedAt).toBeTruthy();
    expect(
      applyWork(deleted, mutation({ title: 'edited' }, { recordId, at: now + 3 })).conflicts,
    ).toEqual(['deletedAt']);
    expect(
      applyWork(deleted, mutation({}, { operation: 'restore', recordId, at: now + 1 })).conflicts,
    ).toEqual(['deletedAt']);
    expect(
      applyWork(deleted, mutation({}, { operation: 'restore', recordId, at: now + 3 })).snapshot
        .records[0].deletedAt,
    ).toBeNull();
    expect(() =>
      applyWork(deleted, mutation({}, { operation: 'restore', recordId, at: now + 31 * 86400000 })),
    ).toThrow('trash_expired');
  });
  it('creates exactly one recurring successor and respects COUNT', () => {
    const base = create({
      title: 'Daily',
      dueDate: '2026-09-25',
      recurrence: 'FREQ=DAILY;COUNT=2',
    });
    const complete = mutation(
      {},
      { recordId: base.records[0].id, operation: 'complete', nextId: uuid(), at: now + 1 },
    );
    const done = applyWork(base, complete).snapshot;
    expect(done.records).toHaveLength(2);
    expect(done.records[1].data.dueDate).toBe('2026-09-26');
    expect(applyWork(done, complete).snapshot.records).toHaveLength(2);
    const again = applyWork(
      done,
      mutation(
        {},
        { recordId: complete.nextId!, operation: 'complete', nextId: uuid(), at: now + 2 },
      ),
    ).snapshot;
    expect(again.records).toHaveLength(2);
  });
  it('rejects missing and changed-kind records; invalid recurrence does not enter queue', () => {
    expect(() => applyWork(emptyWork(), mutation({}, { operation: 'delete' }))).toThrow(
      'not_found',
    );
    const state = create();
    expect(() =>
      applyWork(
        state,
        mutation({ title: 'project' }, { recordId: state.records[0].id, kind: 'project' }),
      ),
    ).toThrow('kind_mismatch');
    expect(() => create({ title: 'bad', recurrence: 'FREQ=DAILY' })).toThrow(
      'recurrence_requires_due',
    );
    expect(() => create({ title: 'bad', timezone: 'bad' })).toThrow();
  });
  it('replays optimistic writes without discarding rejected queue entries', () => {
    const base = create();
    const valid = mutation({ notes: 'offline' }, { recordId: base.records[0].id, at: now + 2 });
    expect(
      optimisticWork(base, [mutation({}, { operation: 'delete' }), valid]).records[0].data.notes,
    ).toBe('offline');
  });
});
describe('saved filters', () => {
  const task = taskSchema.parse({
    title: 'Pay bill',
    notes: 'bank',
    priority: 1,
    dueDate: '2026-09-25',
    tags: ['Work'],
  });
  it.each(['p1 & due:this week & #work', 'due:today', 'bank', 'status:todo', ''])(
    'matches %s',
    (q) => expect(matchesQuery(task, q, 'UTC', now)).toBe(true),
  );
  it.each(['p2', 'due:overdue', '#home', 'status:done', 'unknown'])('excludes %s', (q) =>
    expect(matchesQuery(task, q, 'UTC', now)).toBe(false),
  );
  it('handles no due date and overdue', () => {
    expect(matchesQuery({ ...task, dueDate: null }, 'due:this week', 'UTC', now)).toBe(false);
    expect(matchesQuery({ ...task, dueDate: '2026-09-24' }, 'due:overdue', 'UTC', now)).toBe(true);
  });
});

describe('fuzzy command matching', () => {
  it('ranks exact matches above subsequences and normalizes accents', () => {
    expect(fuzzyScore('Comprare quaderno', 'cmpqdr')).toBeGreaterThan(0);
    expect(fuzzyScore('Caffè', 'caffe')).toBe(1000);
    expect(fuzzyScore('task', 'zzz')).toBe(-1);
    expect(fuzzyScore('task', '')).toBe(0);
  });
  it('bounds recurrence intervals and rejects invalid count', () => {
    expect(() => validateRule('FREQ=DAILY;INTERVAL=0')).toThrow();
    expect(() => validateRule('FREQ=DAILY;COUNT=0')).toThrow();
    expect(() => validateRule('FREQ=YEARLY;INTERVAL=1000')).toThrow();
  });
});

describe('snapshot acknowledgements', () => {
  it('merges changed records without rollback or loss', () => {
    const a = create();
    const b = create({ title: 'other' });
    const current = { revision: 10, records: [...a.records, ...b.records] };
    const updated = {
      ...a.records[0],
      version: 2,
      data: { ...a.records[0].data, title: 'updated' },
    };
    const merged = mergeWorkAck(current, { revision: 11, records: [updated] });
    expect(merged.records).toHaveLength(2);
    expect(mergeWorkAck(merged, a)).toEqual(merged);
    expect(merged.records[0].data.title).toBe('updated');
    expect(mergeWorkAck(emptyWork(), b).records).toHaveLength(1);
  });
});
