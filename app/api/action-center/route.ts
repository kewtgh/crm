import { NextResponse } from "next/server";
import { apiRoute, requireApiUser } from "@/lib/api";
import { loadActionCenter } from "@/lib/action-center-repository";
async function get(){const user=await requireApiUser();return NextResponse.json(await loadActionCenter(user));}
export const GET=apiRoute(get,"ACTION_CENTER_FAILED");
