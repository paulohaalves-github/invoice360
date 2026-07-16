import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "imapflow", "mailparser"],
};

export default nextConfig;
