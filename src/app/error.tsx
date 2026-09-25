'use client';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
export default function ErrorPage({ reset }: { reset: () => void }) {
  const t = useTranslations();
  return (
    <div className="page">
      <h1>{t('errorTitle')}</h1>
      <Button onClick={reset}>{t('retry')}</Button>
    </div>
  );
}
