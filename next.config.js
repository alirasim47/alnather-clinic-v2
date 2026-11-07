/** @type {import('next').NextConfig} */
const { getSecurityHeaders } = require("./lib/security-headers.cjs");

const nextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: getSecurityHeaders(),
      },
    ];
  },
};

module.exports = nextConfig;
