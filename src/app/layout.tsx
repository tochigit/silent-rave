import type { Metadata } from "next";

// Deliberately minimal for the scaffolding phase — no fonts, no global CSS,
// no providers, no branding. Visual design is a later phase (per spec, the
// brand/visual identity is still an OPEN decision).
export const metadata: Metadata = {
  title: "Silent Rave",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
