import { requireUser } from '@/server/auth/guard';
import { CalendarApp } from '@/features/calendar/ui';
export default async function Page() {
  await requireUser();
  return <CalendarApp />;
}
