// next.config.ts
import path from "path";
import type { NextConfig } from "next";

const config: NextConfig = {
  outputFileTracingRoot: path.join(__dirname, "../../.."),
};

export default config;
