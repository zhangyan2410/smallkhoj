import createNextIntlPlugin from "next-intl/plugin"

const withNextIntl = createNextIntlPlugin("./i18n/request.ts")
const internalApiBase = (process.env.INTERNAL_API_BASE_URL || "http://localhost:8000").replace(/\/+$/, "")

/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${internalApiBase}/api/:path*`,
      },
    ]
  },
}

export default withNextIntl(nextConfig)
