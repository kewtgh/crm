import {commissionRead,commissionWrite} from "@/lib/commission-api";
export const GET=commissionRead("agreements");
export const POST=commissionWrite("agreement");
