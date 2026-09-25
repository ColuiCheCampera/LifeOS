import 'server-only';
import { auth } from '@/server/auth';
import { env } from '@/server/env';
import { isSameOrigin } from '@/server/security/policy';
import { rateLimit } from '@/server/security/rate-limit';
import { logger } from '@/server/logger';
export const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } });
export async function apiGuard(request: Request, write = false) {
  const session = await auth();
  if (!session?.user?.id) return { response: json({ error: 'Unauthorized' }, 401) };
  if (write && !isSameOrigin(request, env.AUTH_URL))
    return { response: json({ error: 'Forbidden' }, 403) };
  if (!(await rateLimit(`api:${session.user.id}`, 120)))
    return { response: json({ error: 'Too many requests' }, 429) };
  return { userId: session.user.id, expiresAt: new Date(session.expires).getTime() };
}
export async function safeRoute(action: () => Promise<Response>) {
  try {
    return await action();
  } catch (error) {
    logger.error({ errorType: error instanceof Error ? error.name : 'Unknown' }, 'Request failed');
    return json({ error: 'Service unavailable' }, 503);
  }
}
export async function readJson(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) return null;
  let length = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > 16384) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return null;
  }
}
