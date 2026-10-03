import type { Metadata } from "next";
import "./globals.css";
import "./operations.css";

// Customer fonts and assets are first-party; token pages load no remote resources.
export const metadata: Metadata = {
  title: "Silent Rave",
  description: "Explore Silent Rave events and reserve tickets with guest checkout.",
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
