import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  transpilePackages: ["@cobudget/budget-domain"],
};

export default nextConfig;
