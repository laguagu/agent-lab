import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The protocol is a workspace package Next transpiles itself.
  transpilePackages: ["@agent-lab/protocol"],
};

export default nextConfig;
