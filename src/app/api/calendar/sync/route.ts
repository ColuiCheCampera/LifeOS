import { z } from 'zod';
import { apiGuard, json, safeRoute, readJson } from '@/server/api';
import {
  attachEvent,
  configureSource,
  requestSync,
  resolveConflict,
  syncStatus,
} from '@/features/calendar/sync-service';
const command = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('configure'),
      remoteId: z.string().min(1).max(1024),
      enabled: z.boolean(),
    })
    .strict(),
  z
    .object({
      action: z.literal('attach'),
      sourceId: z.uuid(),
      eventId: z.uuid(),
      version: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      action: z.literal('resolve'),
      eventId: z.uuid(),
      version: z.number().int().positive(),
      bindingVersion: z.number().int().positive(),
      keepCopy: z.boolean(),
    })
    .strict(),
  z.object({ action: z.literal('sync') }).strict(),
]);
export const GET = (request: Request) =>
  safeRoute(async () => {
    const guard = await apiGuard(request);
    if (guard.response) return guard.response;
    return json(await syncStatus(guard.userId));
  });
export const POST = (request: Request) =>
  safeRoute(async () => {
    const guard = await apiGuard(request, true);
    if (guard.response) return guard.response;
    const parsed = command.safeParse(await readJson(request));
    if (!parsed.success) return json({ error: 'invalid_command' }, 400);
    const data = parsed.data;
    try {
      if (data.action === 'configure')
        await configureSource(guard.userId, data.remoteId, data.enabled);
      if (data.action === 'attach')
        await attachEvent(guard.userId, data.sourceId, data.eventId, data.version);
      if (data.action === 'resolve')
        await resolveConflict(
          guard.userId,
          data.eventId,
          data.version,
          data.bindingVersion,
          data.keepCopy,
        );
      if (data.action === 'sync') await requestSync(guard.userId);
      return json({ ok: true }, 202);
    } catch {
      return json({ error: 'calendar_command_rejected' }, 409);
    }
  });
