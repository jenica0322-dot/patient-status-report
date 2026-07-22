/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
};

// --- PWA CONFIGURATION ---
const withPWA = require("next-pwa")({
  dest: "public",
  register: true,
  skipWaiting: true,
  disable: false,
});
// -------------------------

module.exports = withPWA(nextConfig);
