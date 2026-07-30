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

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const baseUrl = new URL(applicationOrigin("http://localhost:3200"));
  const description = translate(locale, "meta.description");
  return {
    metadataBase: baseUrl,
    title: { default: "Lumina CRM", template: "%s · Lumina CRM" },
    description,
    icons: {
      icon: [
        { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
        { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
        { url: "/favicon-192x192.png", sizes: "192x192", type: "image/png" },
      ],
      shortcut: "/favicon-32x32.png",
      apple: [{ url: "/favicon-192x192.png", sizes: "192x192", type: "image/png" }],
    },
    openGraph: {
      title: "Lumina CRM",
      description,
      type: "website",
      images: [{ url: new URL("/og-v280.png", baseUrl).toString(), width: 1726, height: 911, alt: translate(locale, "meta.ogAlt") }],
    },
    twitter: { card: "summary_large_image", title: "Lumina CRM", description, images: [new URL("/og-v280.png", baseUrl).toString()] },
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
