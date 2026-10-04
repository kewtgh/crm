import {commissionRead,commissionWrite} from "@/lib/commission-api";
export const GET=commissionRead("settlements");
export const POST=commissionWrite("settlement");
