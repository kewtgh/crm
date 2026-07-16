import { ContractsPage } from "@/components/contracts-page";
import { localizedPageMetadata } from "@/lib/page-metadata";

export const generateMetadata = () => localizedPageMetadata("meta.contracts");

export default function Page() {
  return <ContractsPage />;
}
