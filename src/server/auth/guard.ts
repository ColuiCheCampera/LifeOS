import 'server-only';
import { redirect } from 'next/navigation';
import { auth } from './index';
export async function requireUser() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  return session.user;
}
