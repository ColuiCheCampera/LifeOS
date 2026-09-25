import { apiGuard, json, safeRoute, readJson } from '@/server/api';
import { getSettings, updateSettings } from '@/features/settings/service';
import { settingsUpdateSchema } from '@/features/settings/schema';
export const GET = (request: Request) =>
  safeRoute(async () => {
    const guard = await apiGuard(request);
    if (guard.response) return guard.response;
    return json(await getSettings(guard.userId));
  });
export const PATCH = (request: Request) =>
  safeRoute(async () => {
    const guard = await apiGuard(request, true);
    if (guard.response) return guard.response;
    const input = settingsUpdateSchema.safeParse(await readJson(request));
    if (!input.success) return json({ error: 'Invalid settings' }, 400);
    const updated = await updateSettings(guard.userId, input.data.preferences, input.data.version);
    return updated
      ? json(updated)
      : json({ error: 'Settings changed in another window. Reload before saving.' }, 409);
  });
