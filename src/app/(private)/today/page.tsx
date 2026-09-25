import Link from 'next/link';
import { ArrowUpRight, Check, ShieldCheck, SlidersHorizontal, Sprout } from 'lucide-react';
import { createTranslator } from 'next-intl';
import { requireUser } from '@/server/auth/guard';
import { getSettings } from '@/features/settings/service';
import { Button } from '@/components/ui/button';
export default async function Today() {
  const user = await requireUser();
  const { preferences } = await getSettings(user.id!);
  const messages = (await import(`../../../messages/${preferences.locale}.json`)).default;
  const t = createTranslator({ locale: preferences.locale, messages });
  const date = new Intl.DateTimeFormat(preferences.locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: preferences.timezone,
  }).format(new Date());
  return (
    <div className="page">
      <div className="page-heading">
        <p className="eyebrow">{date}</p>
        <h1>{t('welcome')}</h1>
        <p>{t('welcomeDescription')}</p>
      </div>
      <div className="today-grid">
        <section className="welcome-card">
          <div className="orbit-art" aria-hidden="true">
            <div />
            <div />
            <div />
            <Sprout size={48} />
          </div>
          <span className="eyebrow">{t('setup')}</span>
          <h2>{t('setupTitle')}</h2>
          <p>{t('setupDescription')}</p>
          <Button asChild>
            <Link href="/settings">
              {t('openSettings')}
              <ArrowUpRight size={18} />
            </Link>
          </Button>
        </section>
        <section className="card system-card">
          <span className="card-icon">
            <ShieldCheck size={22} />
          </span>
          <h2>{t('status')}</h2>
          <ul>
            <li>
              <Check size={17} />
              {t('database')}
            </li>
            <li>
              <Check size={17} />
              {t('connected')}
            </li>
            <li>
              <Check size={17} />
              {preferences.timezone}
            </li>
          </ul>
          <p className="muted">{t('identityOnly')}</p>
        </section>
        <section className="card roadmap-card">
          <span className="card-icon">
            <SlidersHorizontal size={22} />
          </span>
          <div>
            <h2>{t('modulesTitle')}</h2>
            <p>{t('modulesDescription')}</p>
          </div>
          <span className="small-tag">M2 → M8</span>
        </section>
      </div>
    </div>
  );
}
