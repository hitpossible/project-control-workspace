import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

// Authenticated, data-driven app: every page renders per user (server-side access policies), so no static prerendering / cacheComponents.
const nextConfig: NextConfig = {
  // self-contained server in .next/standalone for the Docker image (see Dockerfile)
  output: 'standalone',
  // keep the dev badge away from the sidebar collapse button (bottom-left)
  devIndicators: { position: 'bottom-right' },
};

// locale + messages per request: src/i18n/request.ts
export default createNextIntlPlugin('./src/i18n/request.ts')(nextConfig);
