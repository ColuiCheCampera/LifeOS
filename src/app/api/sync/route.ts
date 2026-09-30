import { getWork } from '@/features/work/service';
import { apiGuard, json, safeRoute, readJson } from '@/server/api';
import { getSnapshot, applyMutation } from '@/features/sync/service';
import { mutationSchema } from '@/features/sync/schema';
export const GET = (request: Request) =>
  safeRoute(async () => {
    const guard = await apiGuard(request);
    if (guard.response) return guard.response;
    const snapshot = await getSnapshot(guard.userId);
    const params = new URL(request.url).searchParams;
    const work = params.get('work') === '1' ? await getWork(guard.userId) : undefined;
    if (work && params.get('calendar') !== '1')
      work.records = work.records.filter((r) => r.kind !== 'event');
    return json({
      userId: guard.userId,
      expiresAt: Math.min(guard.expiresAt, Date.now() + snapshot.preferences.idleMinutes * 60000),
      snapshot,
      ...(work ? { work } : {}),
    });
  });
export const POST = (request: Request) =>
  safeRoute(async () => {
    const guard = await apiGuard(request, true);
    if (guard.response) return guard.response;
    const parsed = mutationSchema.safeParse(await readJson(request));
    if (!parsed.success) return json({ error: 'invalid_mutation' }, 400);
    const applied = await applyMutation(guard.userId, parsed.data);
    return applied.error ? json({ error: applied.error }, 409) : json(applied.result);
  });
