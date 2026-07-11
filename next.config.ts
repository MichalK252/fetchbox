import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 is a native C++ addon — it must stay as a
  // require() at runtime, not bundled by webpack/turbopack.
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
