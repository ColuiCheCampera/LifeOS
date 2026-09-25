import 'server-only';
import type { Adapter, AdapterUser } from 'next-auth/adapters';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { db } from '@/server/db';
import { users, accounts, sessions } from '@/server/db/schema';
import { env } from '@/server/env';
import { tokenHash, isSessionExpired } from '@/server/security/policy';
import { getSettings } from '@/features/settings/service';
const asUser = (row: typeof users.$inferSelect): AdapterUser => ({
  id: row.id,
  email: row.email,
  name: row.name,
  image: row.image,
  emailVerified: row.emailVerified,
});
export function lifeosAdapter(device = 'Browser'): Adapter {
  return {
    async createUser(user) {
      if (user.email !== env.ALLOWED_EMAIL) throw new Error('Account denied');
      const id = uuidv7();
      const [row] = await db
        .insert(users)
        .values({
          id,
          userId: id,
          email: user.email,
          name: user.name,
          image: user.image,
          emailVerified: new Date(),
        })
        .returning();
      return asUser(row);
    },
    async getUser(id) {
      const [row] = await db
        .select()
        .from(users)
        .where(and(eq(users.id, id), isNull(users.deletedAt)));
      return row ? asUser(row) : null;
    },
    async getUserByEmail(email) {
      const [row] = await db
        .select()
        .from(users)
        .where(and(eq(users.email, email), isNull(users.deletedAt)));
      return row ? asUser(row) : null;
    },
    async getUserByAccount({ provider, providerAccountId }) {
      const [row] = await db
        .select({ user: users })
        .from(accounts)
        .innerJoin(users, eq(users.id, accounts.userId))
        .where(
          and(
            eq(accounts.provider, provider),
            eq(accounts.providerAccountId, providerAccountId),
            isNull(users.deletedAt),
            isNull(accounts.deletedAt),
          ),
        );
      return row ? asUser(row.user) : null;
    },
    async updateUser(user) {
      if (user.email && user.email !== env.ALLOWED_EMAIL) throw new Error('Account denied');
      const [row] = await db
        .update(users)
        .set({
          name: user.name,
          image: user.image,
          updatedAt: new Date(),
          version: sql`${users.version}+1`,
        })
        .where(eq(users.id, user.id))
        .returning();
      return asUser(row);
    },
    async linkAccount(account) {
      if (account.provider !== 'google' || account.providerAccountId !== env.ALLOWED_GOOGLE_SUB)
        throw new Error('Account denied');
      await db
        .insert(accounts)
        .values({
          userId: account.userId,
          provider: account.provider,
          providerAccountId: account.providerAccountId,
          type: account.type,
        })
        .onConflictDoNothing();
    },
    async createSession(session) {
      const { preferences } = await getSettings(session.userId);
      const expires = new Date(
        Math.min(session.expires.getTime(), Date.now() + preferences.absoluteDays * 86400000),
      );
      await db.insert(sessions).values({
        userId: session.userId,
        tokenHash: tokenHash(session.sessionToken),
        expires,
        device: device.slice(0, 180),
      });
      return { ...session, expires };
    },
    async getSessionAndUser(sessionToken) {
      const [row] = await db
        .select({ session: sessions, user: users, account: accounts })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .innerJoin(accounts, eq(accounts.userId, users.id))
        .where(
          and(
            eq(sessions.tokenHash, tokenHash(sessionToken)),
            isNull(users.deletedAt),
            isNull(sessions.deletedAt),
            isNull(accounts.deletedAt),
          ),
        );
      if (!row) return null;
      const { preferences } = await getSettings(row.user.id);
      if (
        row.user.email !== env.ALLOWED_EMAIL ||
        row.account.provider !== 'google' ||
        row.account.providerAccountId !== env.ALLOWED_GOOGLE_SUB ||
        isSessionExpired(row.session, preferences)
      ) {
        await db.delete(sessions).where(eq(sessions.id, row.session.id));
        return null;
      }
      await db
        .update(sessions)
        .set({ lastSeen: new Date(), updatedAt: new Date(), version: sql`${sessions.version}+1` })
        .where(eq(sessions.id, row.session.id));
      return {
        user: asUser(row.user),
        session: { sessionToken, userId: row.user.id, expires: row.session.expires },
      };
    },
    async updateSession(session) {
      const [row] = await db
        .select()
        .from(sessions)
        .where(eq(sessions.tokenHash, tokenHash(session.sessionToken)));
      return row
        ? { sessionToken: session.sessionToken, userId: row.userId, expires: row.expires }
        : null;
    },
    async deleteSession(sessionToken) {
      await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash(sessionToken)));
    },
  };
}
