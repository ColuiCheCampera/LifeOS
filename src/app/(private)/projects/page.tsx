import { requireUser } from '@/server/auth/guard';
import { WorkApp } from '@/features/work/ui';
export default async function Page() {
  await requireUser();
  return <WorkApp mode="projects" />;
}
