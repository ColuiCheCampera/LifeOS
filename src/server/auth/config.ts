import 'server-only';
import type { NextAuthConfig } from 'next-auth';
import Google from 'next-auth/providers/google';
import { env } from '@/server/env';
import { lifeosAdapter } from './adapter';
import { logger } from '@/server/logger';
import { isAllowedProfile } from '@/server/security/policy';
export function authConfig(device?: string, cookieHeader?: string): NextAuthConfig {
  return {
    secret: env.AUTH_SECRET,
    trustHost: true,
    logger: {
      error(error) {
        logger.error({ code: error.name }, 'Authentication failed');
      },
      warn(code) {
        logger.warn({ code }, 'Authentication warning');
      },
    },
    adapter: lifeosAdapter(device),
    providers: [
      Google({
        clientId: env.AUTH_GOOGLE_ID,
        clientSecret: env.AUTH_GOOGLE_SECRET,
        authorization: { params: { scope: 'openid email profile', prompt: 'select_account' } },
        checks: ['pkce', 'state', 'nonce'],
      }),
    ],
    session: { strategy: 'database', maxAge: 90 * 86400, updateAge: 60 },
    useSecureCookies: new URL(env.AUTH_URL).protocol === 'https:',
    pages: { signIn: '/login', error: '/login' },
    callbacks: {
      async signIn({ account, profile }) {
        if (
          account?.provider !== 'google' ||
          !isAllowedProfile(profile, { sub: env.ALLOWED_GOOGLE_SUB, email: env.ALLOWED_EMAIL })
        )
          return false;
        // Rotate only the current browser's existing token after a validated login.
        const entry = cookieHeader
          ?.split(';')
          .map((v) => v.trim())
          .find(
            (v) =>
              v.startsWith('authjs.session-token=') ||
              v.startsWith('__Secure-authjs.session-token='),
          );
        if (entry)
          await lifeosAdapter().deleteSession!(
            decodeURIComponent(entry.slice(entry.indexOf('=') + 1)),
          );
        return true;
      },
      session({ session, user }) {
        session.user.id = user.id;
        return session;
      },
      redirect({ url }) {
        const target = new URL(url, env.AUTH_URL);
        return target.origin === new URL(env.AUTH_URL).origin ? target.href : env.AUTH_URL;
      },
    },
  };
}
