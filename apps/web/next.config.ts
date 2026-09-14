import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";
import { join } from "node:path";

export default function nextConfig(phase: string): NextConfig {
  const mode = join(__dirname, "src/api", phase === PHASE_DEVELOPMENT_SERVER ? "runtime-mode.mock.ts" : "runtime-mode.ts");
  return {
  poweredByHeader: false,
  async rewrites() {
    return [{ source: "/v1/:path*", destination: "http://127.0.0.1:3001/v1/:path*" }];
  },
  // Keep the development indicator from covering keyboard/pointer journey controls.
  devIndicators: false,
  transpilePackages: ["@cobudget/budget-domain"],
  turbopack: { resolveAlias: { "@/api/runtime-mode": phase === PHASE_DEVELOPMENT_SERVER ? "./src/api/runtime-mode.mock.ts" : "./src/api/runtime-mode.ts" } },
  webpack(config) {
    config.resolve.alias["@/api/runtime-mode"] = mode;
    return config;
  },
  };
}
