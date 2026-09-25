import 'server-only';
import { z } from 'zod';
const schema = z.object({
  DATABASE_URL: z.url().refine((v) => v.startsWith('postgresql://') || v.startsWith('postgres://')),
  AUTH_URL: z.url(),
  AUTH_SECRET: z.string().min(32),
  AUTH_GOOGLE_ID: z.string().min(1),
  AUTH_GOOGLE_SECRET: z.string().min(1),
  ALLOWED_GOOGLE_SUB: z.string().min(1),
  ALLOWED_EMAIL: z.email(),
  ENCRYPTION_KEY: z
    .string()
    .regex(/^[A-Za-z0-9+/]{43}=$/)
    .refine((v) => Buffer.from(v, 'base64').length === 32),
  DEMO_MODE: z.enum(['true', 'false']).default('false'),
});
export function readEnv(source: Record<string, string | undefined> = process.env) {
  const result = schema.safeParse(source);
  if (!result.success)
    throw new Error(
      `Invalid server configuration: ${result.error.issues.map((i) => i.path.join('.')).join(', ')}`,
    );
  if (source.NODE_ENV === 'production' && !result.data.AUTH_URL.startsWith('https://'))
    throw new Error('Production AUTH_URL requires HTTPS');
  return result.data;
}
export const env = readEnv();
