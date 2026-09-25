import { NextIntlClientProvider } from 'next-intl';
import { requireUser } from '@/server/auth/guard';
import { getSettings } from '@/features/settings/service';
import { Shell } from '@/components/shell';
import { LocalProvider, SessionBoundary } from '@/features/sync/provider';
import { ThemeProvider } from '@/components/theme-provider';
export default async function PrivateLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const { preferences } = await getSettings(user.id!);
  const messages = (await import(`../../messages/${preferences.locale}.json`)).default;
  return (
    <NextIntlClientProvider
      locale={preferences.locale}
      messages={messages}
      timeZone={preferences.timezone}
    >
      <LocalProvider>
        <SessionBoundary>
          <ThemeProvider preferences={preferences} />
          <Shell name={user.name ?? 'LifeOS'} email={user.email ?? ''}>
            {children}
          </Shell>
        </SessionBoundary>
      </LocalProvider>
    </NextIntlClientProvider>
  );
}
