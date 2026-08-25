import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The protocol is a workspace package Next transpiles itself.
  transpilePackages: ["@skill-lab/protocol"],
};

export default nextConfig;
