'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  Sun,
  SlidersHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  ShieldCheck,
  ArrowUpRight,
} from 'lucide-react';
import { WorkOverlays } from '@/features/work/ui';
import { useLocale } from 'next-intl';
import { copy } from '@/features/work/copy';
import { CheckSquare, Folder, ClipboardCheck } from 'lucide-react';
import { useState } from 'react';
import { purgeLocal, localSnapshot } from '@/features/sync/client';
import { signOut } from 'next-auth/react';
import { Button } from './ui/button';
export function Shell({
  name,
  email,
  children,
}: {
  name: string;
  email: string;
  children: React.ReactNode;
}) {
  const t = useTranslations();
  const path = usePathname();
  const c = copy[useLocale() === 'en' ? 'en' : 'it'];
  const [collapsed, setCollapsed] = useState(false);
  const links = [
    { href: '/today', label: t('today'), icon: Sun },
    { href: '/tasks', label: c.tasks, icon: CheckSquare },
    { href: '/projects', label: c.projects, icon: Folder },
    { href: '/review', label: c.review, icon: ClipboardCheck },
    { href: '/settings', label: t('settings'), icon: SlidersHorizontal },
  ];
  return (
    <div className={`app-shell ${collapsed ? 'sidebar-collapsed' : ''}`}>
      <a className="skip-link" href="#main-content">
        {t('skipContent')}
      </a>
      <aside className="sidebar" aria-label={t('personalSpace')}>
        <Link href="/today" className="brand" aria-label="LifeOS">
          <span className="brand-mark">
            l<span>o</span>
          </span>
          <span className="brand-name">
            Life<span>OS</span>
          </span>
        </Link>
        <p className="sidebar-caption">{t('personalSpace')}</p>
        <nav aria-label={t('mainNavigation')}>
          {links.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={path === href ? 'page' : undefined}
              className="nav-link"
              title={label}
            >
              <Icon size={20} />
              <span>{label}</span>
              {path === href && <span className="nav-dot" />}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="privacy-note">
            <ShieldCheck size={19} />
            <div>
              <strong>{t('private')}</strong>
              <small>{t('foundation')}</small>
            </div>
          </div>
          <div className="profile">
            <span className="avatar">{name.slice(0, 1).toUpperCase()}</span>
            <div>
              <strong>{name}</strong>
              <small title={email}>{email}</small>
            </div>
            <button
              className="icon-button"
              aria-label={t('signOut')}
              onClick={async () => {
                let pending = 0;
                try {
                  pending = (await localSnapshot()).pending;
                } catch {}
                if (pending && !window.confirm(t('clearCacheConfirm'))) return;
                await signOut({ redirect: false });
                await purgeLocal();
                // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- Clear all in-memory private state after server sign-out.
                window.location.assign('/login');
              }}
            >
              <ArrowUpRight size={18} />
            </button>
          </div>
          <Button
            variant="ghost"
            className="collapse-button"
            aria-label={collapsed ? t('expandSidebar') : t('collapseSidebar')}
            onClick={() => setCollapsed(!collapsed)}
          >
            {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
            <span>LifeOS · 0.3</span>
          </Button>
        </div>
      </aside>
      <div className="main-wrap">
        <header className="topbar">
          <span>
            LifeOS <span className="breadcrumb">/</span>{' '}
            <strong>{links.find((l) => l.href === path)?.label ?? t('today')}</strong>
          </span>
          <span className="status-pill">
            <span />
            {t('protected')}
          </span>
        </header>
        <WorkOverlays />
        <main id="main-content">{children}</main>
        <footer className="page-footer">
          <span>{t('brandTag')}</span>
          <span>LifeOS / M3</span>
        </footer>
      </div>
      <nav className="mobile-tabs" aria-label={t('mobileNavigation')}>
        {links.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} aria-current={path === href ? 'page' : undefined}>
            <Icon size={21} />
            <span>{label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
