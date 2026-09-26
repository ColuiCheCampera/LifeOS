import { apiGuard, json, safeRoute, readJson } from '@/server/api';
import { getWork, mutateWork, searchWork } from '@/features/work/service';
import { workMutationSchema } from '@/features/work/schema';
export const GET = (request: Request) =>
  safeRoute(async () => {
    const guard = await apiGuard(request);
    if (guard.response) return guard.response;
    const q = new URL(request.url).searchParams.get('q');
    return json(q ? await searchWork(guard.userId, q.slice(0, 300)) : await getWork(guard.userId));
  });
export const POST = (request: Request) =>
  safeRoute(async () => {
    const guard = await apiGuard(request, true);
    if (guard.response) return guard.response;
    const parsed = workMutationSchema.safeParse(await readJson(request));
    if (!parsed.success) return json({ error: 'invalid_mutation' }, 400);
    const applied = await mutateWork(guard.userId, parsed.data);
    return applied.error ? json({ error: applied.error }, 409) : json(applied.result);
  });
