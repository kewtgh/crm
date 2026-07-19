import { localizedPageMetadata } from "@/lib/page-metadata";

export const generateMetadata=()=>localizedPageMetadata("meta.privacy");

export default function LegalLayout({children}:{children:React.ReactNode}){
  return children;
}
