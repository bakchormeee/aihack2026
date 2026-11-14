import type { NextConfig } from "next";

// Cache Components and partial prefetching are switched off on purpose:
// every page in this app is per-user and dynamic, so the previous rendering
// model (no Suspense requirement around request-time data) is simpler.
const nextConfig: NextConfig = {
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
