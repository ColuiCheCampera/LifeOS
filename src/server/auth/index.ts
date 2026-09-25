import 'server-only';
import NextAuth from 'next-auth';
import { authConfig } from './config';
export const { auth, handlers, signIn, signOut } = NextAuth((request) =>
  authConfig(
    request?.headers.get('user-agent') ?? 'Browser',
    request?.headers.get('cookie') ?? undefined,
  ),
);
