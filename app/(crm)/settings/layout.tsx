import { localizedPageMetadata } from "@/lib/page-metadata";

export const generateMetadata=()=>localizedPageMetadata("meta.settings");

export default function SettingsLayout({children}:{children:React.ReactNode}){
  return children;
}
