/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Let a tunnel (e.g. cloudflared) load dev assets from another origin.
  allowedDevOrigins: ["*.trycloudflare.com"],
  // Optional same-origin API: set API_PROXY_TARGET (and an empty
  // NEXT_PUBLIC_API_BASE) to serve /api/* through Next, so one URL is enough.
  // Django URLs end in "/", so keep trailing slashes instead of redirecting.
  skipTrailingSlashRedirect: true,
  async rewrites() {
    const target = process.env.API_PROXY_TARGET;
    if (!target) return [];
    return [
      { source: "/api/:path*/", destination: `${target}/api/:path*/` },
      { source: "/api/:path*", destination: `${target}/api/:path*` },
    ];
  },
};

export default nextConfig;
