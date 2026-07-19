import type { Metadata } from "next";
import { cookies } from "next/headers";
import { I18nProvider } from "@/components/i18n-provider";
import { dictionaries, isLocale, translate } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/page-metadata";
import "./globals.css";
import "./v200.css";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const configuredBase = process.env.APP_URL?.trim();
  const baseUrl = new URL(configuredBase && /^https?:\/\//.test(configuredBase) ? configuredBase : "http://localhost:3200");
  const description = translate(locale, "meta.description");
  return {
    metadataBase: baseUrl,
    title: { default: "Lumina Education CRM", template: "%s · Lumina CRM" },
    description,
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
    openGraph: {
      title: "Lumina Education CRM",
      description,
      type: "website",
      images: [{ url: new URL("/og-v120.png", baseUrl).toString(), width: 1734, height: 907, alt: translate(locale, "meta.ogAlt") }],
    },
    twitter: { card: "summary_large_image", title: "Lumina Education CRM", description, images: [new URL("/og-v120.png", baseUrl).toString()] },
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
