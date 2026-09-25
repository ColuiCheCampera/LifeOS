import { getTranslations } from 'next-intl/server';
import { auth } from '@/server/auth';
import { redirect } from 'next/navigation';
import { ShieldCheck, ArrowUpRight } from 'lucide-react';
import { LoginButton } from './sign-in';
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if ((await auth())?.user) redirect('/today');
  const t = await getTranslations();
  const error = (await searchParams).error;
  return (
    <main className="login-page">
      <div className="login-brand">
        <span className="brand-mark">
          l<span>o</span>
        </span>
        <span className="brand-name">
          Life<span>OS</span>
        </span>
      </div>
      <section className="login-story">
        <p className="eyebrow">{t('loginLabel')}</p>
        <h1>
          {t('loginTitle')
            .split('\n')
            .map((line, i) => (
              <span key={i}>
                {line}
                <br />
              </span>
            ))}
        </h1>
        <p>{t('loginDescription')}</p>
        <div className="login-art" aria-hidden="true">
          <div className="art-ring ring-one" />
          <div className="art-ring ring-two" />
          <div className="art-ring ring-three" />
          <span className="art-dot" />
          <span className="art-center">
            <ArrowUpRight size={54} strokeWidth={1} />
          </span>
        </div>
        <p className="login-footnote">01 / {t('brandTag')}</p>
      </section>
      <section className="login-panel">
        <span className="card-icon">
          <ShieldCheck size={26} />
        </span>
        <h2>{t('private')}</h2>
        <p>{t('loginPrivate')}</p>
        {error && (
          <p role="alert" className="alert">
            {t('loginError')}
          </p>
        )}
        <LoginButton label={t('loginButton')} />
        <small>{t('identityOnly')}</small>
        <div className="login-divider" />
        <p className="muted">{t('privateDescription')}</p>
      </section>
      <footer className="login-footer">
        LifeOS · 0.1 <span>{t('foundation')}</span>
      </footer>
    </main>
  );
}
