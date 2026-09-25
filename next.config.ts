import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
const config: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  devIndicators: false,
  experimental: { serverActions: { bodySizeLimit: '1mb' } },
};
export default createNextIntlPlugin('./src/i18n/request.ts')(config);
