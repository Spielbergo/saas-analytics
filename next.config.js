/** @type {import('next').NextConfig} */
const securityHeaders = [
  // Keep this private admin tool out of search engines and link previews.
  { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
  // Stop other sites framing the dashboard (clickjacking) and MIME sniffing.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Don't leak admin URLs to other sites when following links.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  // API responses carry subscriber data — never let browsers/CDNs cache them.
];

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/api/:path*", headers: [{ key: "Cache-Control", value: "no-store" }] },
    ];
  },
};

module.exports = nextConfig;
