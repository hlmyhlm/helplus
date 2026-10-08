import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  serverExternalPackages: ["whatsapp-web.js", "puppeteer", "tesseract.js", "sharp"],
  experimental: {
    // middleware clones the body and cuts it at this size; 5 screenshots of 10 MB plus overhead
    proxyClientMaxBodySize: "52mb",
  },
};

export default nextConfig;
