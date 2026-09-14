import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Transport selection. The development server uses the localhost-only mock adapter unless the untracked
 * file `apps/web/.api-mode` contains `live` (PROTO-ACTIVATION-001): then `npm run dev` talks to the real
 * API through the same-origin `/v1` rewrite, exactly as a production build does. A production build never
 * selects the mock. A file, not an environment variable, because the repository's environment guard
 * reserves `process.env` for the shared configuration loader.
 */
function developmentUsesLiveApi(): boolean {
  const marker = join(__dirname, ".api-mode");
  return existsSync(marker) && readFileSync(marker, "utf8").trim() === "live";
}

export default function nextConfig(phase: string): NextConfig {
  const mock = phase === PHASE_DEVELOPMENT_SERVER && !developmentUsesLiveApi();
  const mode = join(__dirname, "src/api", mock ? "runtime-mode.mock.ts" : "runtime-mode.ts");
  return {
  poweredByHeader: false,
  async rewrites() {
    return [{ source: "/v1/:path*", destination: "http://127.0.0.1:3001/v1/:path*" }];
  },
  // Keep the development indicator from covering keyboard/pointer journey controls.
  devIndicators: false,
  transpilePackages: ["@cobudget/budget-domain"],
  turbopack: { resolveAlias: { "@/api/runtime-mode": mock ? "./src/api/runtime-mode.mock.ts" : "./src/api/runtime-mode.ts" } },
  webpack(config) {
    config.resolve.alias["@/api/runtime-mode"] = mode;
    return config;
  },
  };
}
