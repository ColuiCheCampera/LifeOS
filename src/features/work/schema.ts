import { z } from 'zod';
const title = z.string().trim().min(1).max(240);
const text = z.string().max(8000);
const reference = z.uuid().nullable();
const date = z.iso.date().nullable();
const time = z.iso.datetime().nullable();
const position = z.number().finite().min(-1e15).max(1e15);
export const kinds = ['task', 'project', 'area', 'milestone', 'filter'] as const;
export const kindSchema = z.enum(kinds);
export type Kind = z.infer<typeof kindSchema>;
export const taskSchema = z
  .object({
    title,
    notes: text.default(''),
    status: z.enum(['todo', 'doing', 'done']).default('todo'),
    priority: z.number().int().min(1).max(4).default(4),
    dueDate: date.default(null),
    dueAt: time.default(null),
    startDate: date.default(null),
    estimate: z.number().int().min(0).max(100000).default(0),
    actual: z.number().int().min(0).max(100000).default(0),
    tags: z.array(z.string().trim().min(1).max(40)).max(30).default([]),
    projectId: reference.default(null),
    parentId: reference.default(null),
    recurrence: z.string().max(400).default(''),
    recurrenceStart: time.default(null),
    timezone: z.string().max(80).default('Europe/Rome'),
    reminders: z.array(z.iso.datetime()).max(10).default([]),
    attachments: z
      .array(
        z
          .object({
            name: title,
            url: z.url().refine((v) => /^https?:\/\//.test(v)),
            bytes: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .max(20)
      .default([]),
    position: position.default(0),
    completedAt: time.default(null),
  })
  .strict();
export const projectSchema = z
  .object({
    title,
    goal: text.default(''),
    notes: text.default(''),
    status: z.enum(['active', 'paused', 'done']).default('active'),
    deadline: date.default(null),
    areaId: reference.default(null),
    position: position.default(0),
  })
  .strict();
export const areaSchema = z
  .object({
    title,
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .default('#28533d'),
    position: position.default(0),
  })
  .strict();
export const milestoneSchema = z
  .object({
    title,
    projectId: z.uuid(),
    dueDate: date.default(null),
    done: z.boolean().default(false),
    position: position.default(0),
  })
  .strict();
export const filterSchema = z
  .object({ title, query: z.string().trim().min(1).max(300), position: position.default(0) })
  .strict();
export const schemas = {
  task: taskSchema,
  project: projectSchema,
  area: areaSchema,
  milestone: milestoneSchema,
  filter: filterSchema,
};
export type Task = z.infer<typeof taskSchema>;
export type Project = z.infer<typeof projectSchema>;
export type Data = z.infer<(typeof schemas)[Kind]>;
const clock = z.object({ at: z.number().int().nonnegative(), clientId: z.string() }).strict();
export const recordSchema = z
  .object({
    id: z.uuid(),
    kind: kindSchema,
    data: z.record(z.string(), z.unknown()),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    deletedAt: time,
    version: z.number().int().positive(),
    clocks: z.record(z.string(), clock),
  })
  .strict()
  .superRefine((r, ctx) => {
    if (!schemas[r.kind].safeParse(r.data).success)
      ctx.addIssue({ code: 'custom', message: 'invalid_record' });
  });
export type WorkRecord = z.infer<typeof recordSchema>;
export const workSnapshotSchema = z
  .object({ revision: z.number().int().nonnegative(), records: z.array(recordSchema) })
  .strict();
export type WorkSnapshot = z.infer<typeof workSnapshotSchema>;
export const workMutationSchema = z
  .object({
    id: z.uuid(),
    clientId: z.uuid(),
    at: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    kind: kindSchema,
    recordId: z.uuid(),
    operation: z.enum(['upsert', 'delete', 'restore', 'complete']),
    patch: z.record(z.string(), z.unknown()),
    nextId: z.uuid().optional(),
  })
  .strict()
  .superRefine((m, ctx) => {
    const schema = schemas[m.kind].partial();
    if (
      !schema.safeParse(m.patch).success ||
      (m.operation === 'upsert' && !Object.keys(m.patch).length) ||
      (m.operation === 'complete' && (m.kind !== 'task' || !m.nextId))
    )
      ctx.addIssue({ code: 'custom', message: 'invalid_mutation' });
  });
export type WorkMutation = z.infer<typeof workMutationSchema>;
export const workAckSchema = z
  .object({ mutationId: z.uuid(), snapshot: workSnapshotSchema, conflicts: z.array(z.string()) })
  .strict();
export const emptyWork = (): WorkSnapshot => ({ revision: 0, records: [] });
export function taskData(r: WorkRecord): Task {
  return taskSchema.parse(r.data);
}
export function projectData(r: WorkRecord): Project {
  return projectSchema.parse(r.data);
}
