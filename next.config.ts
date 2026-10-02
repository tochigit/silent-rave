import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingIncludes: { "/api/**/*": ["./assets/fonts/NotoSans-Regular.ttf", "./assets/fonts/OFL.txt"] },
  reactStrictMode: false,
  // Keep Prisma (and its native query engine) external in server bundles —
  // required for src/proxy.ts (Next 16 proxy runs on the Node.js runtime and
  // imports the Prisma client to validate sessions centrally).
  // "bcryptjs" is listed because the password hashing currently uses the
  // pure-JS library (see src/lib/auth/password.ts — deliberate sandbox
  // constraint, flagged for a production keep-or-swap decision). If it is
  // swapped to native `bcrypt`/`argon2`, update this entry to match.
  // "sharp" is the maintained native image library used to re-encode proof
  // uploads (strips EXIF/GPS — 04); it must stay external so its native
  // binaries load correctly inside route handlers.
  serverExternalPackages: ["@prisma/client", ".prisma/client", "bcryptjs", "sharp"],
};

export default nextConfig;
