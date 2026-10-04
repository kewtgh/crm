import {commissionRead,commissionWrite} from "@/lib/commission-api";
export const GET=commissionRead("accruals");
export const POST=commissionWrite("accrual");
