import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { I18nProvider } from "@/components/i18n-provider";
import { isLocale, translate } from "@/lib/i18n";
import { getRequestLocale } from "@/lib/page-metadata";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const baseUrl = new URL(`${protocol}://${host}`);
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
      images: [{ url: new URL("/og.png", baseUrl).toString(), width: 1734, height: 907, alt: translate(locale, "meta.ogAlt") }],
    },
    twitter: { card: "summary_large_image", title: "Lumina Education CRM", description, images: [new URL("/og.png", baseUrl).toString()] },
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
      <body><I18nProvider initialLocale={locale}>{children}</I18nProvider></body>
    </html>;
}
