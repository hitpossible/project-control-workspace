import type { NextConfig } from 'next';

// Authenticated, data-driven app: every page renders per user (server-side access policies), so no static prerendering / cacheComponents.
const nextConfig: NextConfig = {};

export default nextConfig;
