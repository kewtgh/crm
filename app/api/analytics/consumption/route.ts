import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { loadConsumption, type ConsumptionPeriod } from "@/lib/consumption-repository";
export async function GET(request: Request) { await requireUser(); const url=new URL(request.url);const value = url.searchParams.get("period"); const period: ConsumptionPeriod = value === "month" || value === "year" ? value : "quarter";const currency=url.searchParams.get("currency")??undefined;if(currency&&!/^[A-Z]{3}$/.test(currency))return NextResponse.json({code:"INVALID_CURRENCY"},{status:400}); try { return NextResponse.json({ data: await loadConsumption(period,currency) }); } catch { return NextResponse.json({ code: "ANALYTICS_LOAD_FAILED" }, { status: 500 }); } }
