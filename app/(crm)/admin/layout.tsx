import { requireRole } from "@/lib/auth";
import { localizedPageMetadata } from "@/lib/page-metadata";

export const generateMetadata=()=>localizedPageMetadata("meta.admin");

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireRole("SUPER_ADMIN", "ADMIN");
  return children;
}
