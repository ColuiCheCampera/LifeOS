'use client';
import { useEffect } from 'react';
import type { Preferences } from '@/features/settings/schema';
export function ThemeProvider({ preferences }: { preferences: Preferences }) {
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      document.documentElement.dataset.theme =
        preferences.theme === 'system' ? (media.matches ? 'dark' : 'light') : preferences.theme;
      document.documentElement.dataset.density = preferences.density;
      document.documentElement.dataset.font = preferences.fontSize;
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [preferences]);
  return null;
}
