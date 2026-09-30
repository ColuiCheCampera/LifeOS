import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  jsonb,
  index,
  uniqueIndex,
  check,
  boolean,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { FieldClocks } from '@/features/sync/schema';
import type { WorkRecord } from '@/features/work/schema';
import type { Preferences } from '@/features/settings/schema';
import type { ProviderEvent, SharedEvent } from '@/features/calendar/provider-schema';
const metadata = () => ({
  id: uuid('id').primaryKey().$defaultFn(uuidv7),
  userId: uuid('user_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  version: integer('version').default(1).notNull(),
});
export const users = pgTable(
  'users',
  {
    ...metadata(),
    email: text('email').notNull().unique(),
    name: text('name'),
    image: text('image'),
    emailVerified: timestamp('email_verified_at', { withTimezone: true }),
  },
  (t) => [
    check('user_owns_self', sql`${t.id} = ${t.userId}`),
    check('users_version_positive', sql`${t.version} > 0`),
  ],
);
export const accounts = pgTable(
  'accounts',
  {
    ...metadata(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    providerAccountId: text('provider_account_id').notNull(),
    type: text('type').notNull(),
  },
  (t) => [
    uniqueIndex('accounts_provider_subject').on(t.provider, t.providerAccountId),
    index('accounts_user').on(t.userId),
    check('accounts_version_positive', sql`${t.version} > 0`),
  ],
);
export const sessions = pgTable(
  'sessions',
  {
    ...metadata(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    expires: timestamp('expires', { withTimezone: true }).notNull(),
    lastSeen: timestamp('last_seen', { withTimezone: true }).defaultNow().notNull(),
    device: text('device').notNull().default('Browser'),
  },
  (t) => [
    index('sessions_user').on(t.userId),
    index('sessions_expiry').on(t.expires),
    check('sessions_version_positive', sql`${t.version} > 0`),
  ],
);
export const settings = pgTable(
  'settings',
  {
    ...metadata(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    preferences: jsonb('preferences').$type<Preferences>().notNull(),
    fieldClocks: jsonb('field_clocks').$type<FieldClocks>().notNull().default({}),
    workRevision: integer('work_revision').notNull().default(0),
  },
  (t) => [
    uniqueIndex('settings_user').on(t.userId),
    check('settings_version_positive', sql`${t.version} > 0`),
  ],
);
export const auditLogs = pgTable(
  'audit_logs',
  {
    ...metadata(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id'),
    details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [
    index('audit_user_created').on(t.userId, t.createdAt),
    check('audit_version_positive', sql`${t.version} > 0`),
  ],
);
export const rateLimits = pgTable(
  'rate_limits',
  {
    ...metadata(),
    bucket: text('bucket').notNull().unique(),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    hits: integer('hits').notNull(),
  },
  (t) => [
    index('rate_window').on(t.windowStart),
    check('rate_version_positive', sql`${t.version} > 0`),
  ],
);

export const mutationReceipts = pgTable(
  'mutation_receipts',
  {
    ...metadata(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    mutationId: uuid('mutation_id').notNull(),
    payloadHash: text('payload_hash').notNull(),
    result: jsonb('result').notNull(),
  },
  (t) => [
    uniqueIndex('receipts_user_mutation').on(t.userId, t.mutationId),
    index('receipts_user_created').on(t.userId, t.createdAt),
    check('receipts_version_positive', sql`${t.version}>0`),
  ],
);

// Separate domain tables retain typed payloads and per-field clocks for offline reconciliation.
function workTable(name: string) {
  return pgTable(
    name,
    {
      ...metadata(),
      userId: uuid('user_id')
        .notNull()
        .references(() => users.id, { onDelete: 'cascade' }),
      data: jsonb('data').$type<WorkRecord['data']>().notNull(),
      fieldClocks: jsonb('field_clocks').$type<WorkRecord['clocks']>().notNull().default({}),
    },
    (t) => [
      index(name + '_user_updated').on(t.userId, t.updatedAt),
      index(name + '_user_deleted').on(t.userId, t.deletedAt),
      check(name + '_version_positive', sql`${t.version}>0`),
    ],
  );
}
export const tasks = workTable('tasks');
export const projects = workTable('projects');
export const areas = workTable('areas');
export const milestones = workTable('milestones');
export const savedFilters = workTable('saved_filters');
export const calendarEvents = workTable('calendar_events');

export const calendarConnections = pgTable(
  'calendar_connections',
  {
    ...metadata(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    refreshCipher: text('refresh_cipher'),
    status: text('status').notNull().default('disconnected'),
    stateHash: text('state_hash'),
    verifierCipher: text('verifier_cipher'),
    stateExpires: timestamp('state_expires', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('calendar_connections_user').on(t.userId),
    check('calendar_connections_version_positive', sql`${t.version}>0`),
  ],
);

export const calendarSources = pgTable(
  'calendar_sources',
  {
    ...metadata(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    remoteId: text('remote_id').notNull(),
    name: text('name').notNull(),
    color: text('color').notNull(),
    timezone: text('timezone').notNull(),
    role: text('role').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    syncToken: text('sync_token'),
    nextRun: timestamp('next_run', { withTimezone: true }).notNull().defaultNow(),
    lastSynced: timestamp('last_synced', { withTimezone: true }),
    failures: integer('failures').notNull().default(0),
    error: text('error'),
  },
  (t) => [
    uniqueIndex('calendar_sources_user_remote').on(t.userId, t.remoteId),
    index('calendar_sources_due').on(t.enabled, t.nextRun),
  ],
);
export const calendarBindings = pgTable(
  'calendar_bindings',
  {
    ...metadata(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => calendarSources.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id').references(() => calendarEvents.id, { onDelete: 'cascade' }),
    remoteId: text('remote_id').notNull(),
    etag: text('etag'),
    base: jsonb('base').$type<SharedEvent | null>(),
    remote: jsonb('remote').$type<ProviderEvent | null>(),
    state: text('state').notNull().default('pending'),
  },
  (t) => [
    uniqueIndex('calendar_bindings_remote').on(t.userId, t.sourceId, t.remoteId),
    uniqueIndex('calendar_bindings_event').on(t.userId, t.eventId),
    index('calendar_bindings_source').on(t.userId, t.sourceId),
  ],
);
