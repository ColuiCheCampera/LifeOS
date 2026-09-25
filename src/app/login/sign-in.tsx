'use client';
import { signIn } from 'next-auth/react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
export function LoginButton({ label }: { label: string }) {
  const [pending, setPending] = useState(false);
  return (
    <Button
      className="google-button"
      disabled={pending}
      onClick={() => {
        setPending(true);
        void signIn('google', { callbackUrl: '/today' }).catch(() => setPending(false));
      }}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
        <path
          fill="currentColor"
          d="M21.6 12.2c0-.7-.1-1.5-.2-2.2H12v4h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.2 3-7.3ZM12 22c2.7 0 5-.9 6.6-2.5l-3.2-2.4c-.9.6-2 1-3.4 1-2.6 0-4.9-1.8-5.7-4.2H3v2.6A10 10 0 0 0 12 22ZM6.3 13.9a6 6 0 0 1 0-3.8V7.5H3a10 10 0 0 0 0 9l3.3-2.6ZM12 5.9c1.5 0 2.8.5 3.8 1.5l2.8-2.8A9.5 9.5 0 0 0 12 2a10 10 0 0 0-9 5.5l3.3 2.6C7.1 7.7 9.4 5.9 12 5.9Z"
        />
      </svg>
      {pending ? '…' : label}
    </Button>
  );
}
