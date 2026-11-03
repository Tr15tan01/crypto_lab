import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { DEFAULT_THEME, THEME_INIT_SCRIPT } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Crypto Lab", template: "%s · Crypto Lab" },
  description: "Personal crypto research and paper-trading laboratory.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f6f8" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0b0d" },
  ],
  colorScheme: "dark light",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // The CSP (src/proxy.ts) only allows inline scripts carrying this request's nonce.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html
      lang="en"
      data-theme={DEFAULT_THEME}
      // The inline script below may change data-theme before React hydrates.
      suppressHydrationWarning
      className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}
    >
      <head>
        {/* Browsers blank the nonce attribute after parsing, hence suppressHydrationWarning. */}
        <script nonce={nonce} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
