import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const baseUrl = new URL(`${protocol}://${host}`);
  const description = "面向国际教育团队的现代化双语关系 CRM，统一学校、学生、家庭与运营协作。";
  return {
    metadataBase: baseUrl,
    title: { default: "Lumina Education CRM", template: "%s · Lumina CRM" },
    description,
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
    openGraph: {
      title: "Lumina Education CRM",
      description,
      type: "website",
      images: [{ url: new URL("/og.png", baseUrl).toString(), width: 1734, height: 907, alt: "Lumina Education CRM relationship workspace" }],
    },
    twitter: { card: "summary_large_image", title: "Lumina Education CRM", description, images: [new URL("/og.png", baseUrl).toString()] },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
