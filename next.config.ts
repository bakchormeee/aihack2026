import type { NextConfig } from "next";

// Cache Components and partial prefetching are switched off on purpose:
// every page in this app is per-user and dynamic, so the previous rendering
// model (no Suspense requirement around request-time data) is simpler.
const nextConfig: NextConfig = {
  // The end-to-end tests run their own dev server, which needs its own build folder.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Dev only: lets the dev server serve pages opened at 127.0.0.1, which gives a
  // browser its own cookie jar separate from localhost (parallel agents share one browser).
  allowedDevOrigins: ["127.0.0.1"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
