const path = require("path");
const { loadEnvConfig } = require("@next/env");

// Match repo docs: shared `.env` at monorepo root, with optional overrides in this app.
loadEnvConfig(path.join(__dirname, ".."));
loadEnvConfig(__dirname);

/** @type {import("next").NextConfig} */
const nextConfig = {
  experimental: {},
};

module.exports = nextConfig;
