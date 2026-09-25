import { getRequestConfig } from 'next-intl/server';
import { cookies } from 'next/headers';
import { auth } from '@/server/auth';
import { getSettings } from '@/features/settings/service';
export default getRequestConfig(async () => {
  const session = await auth();
  const locale = session?.user?.id
    ? (await getSettings(session.user.id)).preferences.locale
    : (await cookies()).get('lifeos-locale')?.value === 'en'
      ? 'en'
      : 'it';
  return { locale, messages: (await import(`../messages/${locale}.json`)).default };
});
