import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["@duckdb/node-api", "playwright"],
  // The local DuckDB file is runtime data. Tracing it into a server bundle
  // can fail on Windows while the running app holds the database open.
  outputFileTracingExcludes: {
    "/*": ["./data/*.duckdb", "./data/*.wal"],
  },
};

export default nextConfig;
