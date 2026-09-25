import type { NextRequest } from 'next/server';
import { handlers } from '@/server/auth';
import { rateLimit } from '@/server/security/rate-limit';
import { json, safeRoute } from '@/server/api';
const handle = (request: NextRequest, method: 'GET' | 'POST') =>
  safeRoute(async () => {
    if (!(await rateLimit('auth:global', 120))) return json({ error: 'Too many requests' }, 429);
    return handlers[method](request);
  });
export const GET = (request: NextRequest) => handle(request, 'GET');
export const POST = (request: NextRequest) => handle(request, 'POST');
