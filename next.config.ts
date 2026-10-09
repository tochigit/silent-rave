import type { NextConfig } from "next";
import { publicDeploymentEnvironment } from "./scripts/build-netlify-env";

const nextConfig: NextConfig = {
  output: "standalone",
  // Only public provider metadata is inlined. Runtime secrets stay out of env.
  env: publicDeploymentEnvironment(process.env),
  // Tokens belong only in private links, never in development request logs.
  logging: { incomingRequests: false },
  async headers() {
    return [
      ...["/api/admin/:path*", "/api/staff/:path*", "/api/auth/:path*", "/api/internal/:path*", "/admin/:path*", "/staff/:path*"].map(source => ({ source, headers: [
        { key: "Cache-Control", value: "private, no-store" }, { key: "CDN-Cache-Control", value: "no-store" },
        { key: "Netlify-CDN-Cache-Control", value: "no-store" }, { key: "Referrer-Policy", value: "no-referrer" },
        { key: "X-Robots-Tag", value: "noindex, nofollow" },
      ] })),
      {
        source: "/api/orders/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cache-Control", value: "private, no-store" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
      {
        source: "/order/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cache-Control", value: "private, no-store" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          {
            key: "Content-Security-Policy",
            value:
              "img-src 'self' data: blob:; font-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'self'",
          },
        ],
      },
    ];
  },
  outputFileTracingIncludes: {
    "/api/**/*": [
      "./assets/fonts/NotoSans-Regular.ttf",
      "./assets/fonts/OFL.txt",
      // Native shared libraries are loaded by the OS, beyond JavaScript traces.
      "./node_modules/@img/sharp*/lib/**/*",
    ],
  },
  outputFileTracingExcludes: {
    "*": ["./scripts/**/*", "./tests/**/*", "./reports/**/*", "./.test-runtime/**/*", "./.storage-local/**/*", "./.git/**/*",
      "./.docs/**/*", "./netlify/**/*", "./tools/**/*", "./.env*", "./prisma/.env*"],
  },
  reactStrictMode: false,
  // Native dependencies belong in Node handlers. The proxy uses a fetch-only
  // decision broker and cannot import these packages.
  // "bcryptjs" is listed because the password hashing currently uses the
  // pure-JS library (see src/lib/auth/password.ts — deliberate sandbox
  // constraint, flagged for a production keep-or-swap decision). If it is
  // swapped to native `bcrypt`/`argon2`, update this entry to match.
  // "sharp" is the maintained native image library used to re-encode proof
  // uploads (strips EXIF/GPS — 04); it must stay external so its native
  // binaries load correctly inside route handlers.
  serverExternalPackages: [
    "@prisma/client",
    ".prisma/client",
    "bcryptjs",
    "sharp",
  ],
};

export default nextConfig;
