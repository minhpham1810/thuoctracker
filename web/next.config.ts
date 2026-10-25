import type { NextConfig } from "next";

// The browser only talks to this Next server; /api/* is proxied to the FastAPI backend.
const backend = process.env.BACKEND_URL ?? "http://localhost:8000";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // /ai/ask chains up to 3 AI calls (30 s each); the default 30 s proxy timeout cut it off.
  experimental: { proxyTimeout: 120_000 },
  async redirects() {
    return [{ source: "/", destination: "/doctor", permanent: false }];
  },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${backend}/:path*` }];
  },
};

export default nextConfig;
