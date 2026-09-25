import { requireUser } from '@/server/auth/guard';
import { getSettings } from '@/features/settings/service';
import { SettingsPanel } from '@/features/settings/ui';
import { env } from '@/server/env';
export default async function SettingsPage() {
  const user = await requireUser();
  const initial = await getSettings(user.id!);
  return <SettingsPanel initial={initial} email={env.ALLOWED_EMAIL} />;
}
