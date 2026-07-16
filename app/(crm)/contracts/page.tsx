import type { Metadata } from "next";
import { ContractsPage } from "@/components/contracts-page";

export const metadata: Metadata = { title: "客户合同与续约" };

export default function Page() {
  return <ContractsPage />;
}
