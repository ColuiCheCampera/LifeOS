import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { z } from 'zod';
const identity = z.object({
  sub: z.string().min(1),
  email: z.email(),
  email_verified: z.literal(true),
});
export function isAllowedProfile(profile: unknown, allowed: { sub: string; email: string }) {
  const parsed = identity.safeParse(profile);
  return parsed.success && parsed.data.sub === allowed.sub && parsed.data.email === allowed.email;
}
export function tokenHash(token: string) {
  return createHash('sha256').update(token).digest('hex');
}
export function isSessionExpired(
  session: { createdAt: Date; lastSeen: Date; expires: Date },
  preferences: { idleMinutes: number; absoluteDays: number },
  now = new Date(),
) {
  return (
    now.getTime() >=
    Math.min(
      session.expires.getTime(),
      session.createdAt.getTime() + preferences.absoluteDays * 86400000,
      session.lastSeen.getTime() + preferences.idleMinutes * 60000,
    )
  );
}
export function encryptSecret(plaintext: string, key: Buffer, context: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(context));
  return [
    'v1',
    iv.toString('base64'),
    Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]).toString('base64'),
    cipher.getAuthTag().toString('base64'),
  ].join('.');
}
export function decryptSecret(envelope: string, key: Buffer, context: string) {
  const parts = envelope.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('Invalid encrypted envelope');
  const [, iv, body, tag] = parts;
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(body, 'base64')), decipher.final()]).toString(
    'utf8',
  );
}
export function isSameOrigin(request: Request, origin: string) {
  return (
    request.headers.get('origin') === new URL(origin).origin &&
    request.headers.get('content-type')?.split(';')[0] === 'application/json'
  );
}
