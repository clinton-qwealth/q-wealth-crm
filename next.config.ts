import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root. There is an unrelated package-lock.json in the home
  // directory, and Turbopack would otherwise infer that as the root and resolve
  // modules from the wrong place.
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
