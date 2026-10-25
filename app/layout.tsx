import type { Metadata } from "next";
import { cookies } from "next/headers";
import { I18nProvider } from "@/components/i18n-provider";
import { dictionaries, isLocale, translate } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/page-metadata";
import { applicationOrigin } from "@/lib/application-origin.mjs";
import "./globals.css";
import "./v200.css";
import "./v220.css";
import "./v220-quality.css";
import "./v220-operations.css";
import "./v270.css";
import "./ui-system.css";
import "./workflow-experience.css";
import "./operations-usability.css";
import "./workspace-density.css";
import "./workspace-theme.css";
import "./communications-workspace.css";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const baseUrl = new URL(applicationOrigin("http://localhost:3200"));
  const description = translate(locale, "meta.description");
  return {
    metadataBase: baseUrl,
    title: { default: "ewaya CRM", template: "%s · ewaya CRM" },
    description,
    manifest: "/site.webmanifest?v=white-1",
    icons: {
      icon: [
        { url: "/favicon.ico?v=white-1", sizes: "16x16 32x32 48x48", type: "image/x-icon" },
        { url: "/favicon-16x16.png?v=white-1", sizes: "16x16", type: "image/png" },
        { url: "/favicon-32x32.png?v=white-1", sizes: "32x32", type: "image/png" },
        { url: "/favicon-192x192.png?v=white-1", sizes: "192x192", type: "image/png" },
        { url: "/icon-512x512.png?v=white-1", sizes: "512x512", type: "image/png" },
      ],
      shortcut: "/favicon.ico?v=white-1",
      apple: [{ url: "/apple-touch-icon.png?v=white-1", sizes: "180x180", type: "image/png" }],
    },
    openGraph: {
      title: "ewaya CRM",
      description,
      type: "website",
      images: [{ url: new URL("/brand/ewaya-social.png?v=white-1", baseUrl).toString(), width: 512, height: 512, alt: translate(locale, "meta.ogAlt") }],
    },
    twitter: { card: "summary", title: "ewaya CRM", description, images: [new URL("/brand/ewaya-social.png?v=white-1", baseUrl).toString()] },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const requestedLocale = cookieStore.get("lumina-locale")?.value;
  const locale = isLocale(requestedLocale) ? requestedLocale : "zh-CN";
  return <html lang={locale}>
      <body><I18nProvider initialLocale={locale} initialMessages={dictionaries[locale]}>{children}</I18nProvider></body>
    </html>;
}
