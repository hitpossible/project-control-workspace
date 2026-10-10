import type { NextConfig } from 'next';

// Authenticated, data-driven app: every page renders per user (server-side access policies), so no static prerendering / cacheComponents.
const nextConfig: NextConfig = {
  // keep the dev badge away from the sidebar collapse button (bottom-left)
  devIndicators: { position: 'bottom-right' },
};

export default nextConfig;
