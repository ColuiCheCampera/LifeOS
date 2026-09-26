import { getWork } from '@/features/work/service';
import { apiGuard, json, safeRoute, readJson } from '@/server/api';
import { getSnapshot, applyMutation } from '@/features/sync/service';
import { mutationSchema } from '@/features/sync/schema';
export const GET = (request: Request) =>
  safeRoute(async () => {
    const guard = await apiGuard(request);
    if (guard.response) return guard.response;
    const snapshot = await getSnapshot(guard.userId);
    return json({
      userId: guard.userId,
      expiresAt: Math.min(guard.expiresAt, Date.now() + snapshot.preferences.idleMinutes * 60000),
      snapshot,
      ...(new URL(request.url).searchParams.get('work') === '1'
        ? { work: await getWork(guard.userId) }
        : {}),
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
