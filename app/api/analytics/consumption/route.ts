import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { loadConsumption, type ConsumptionPeriod } from "@/lib/consumption-repository";
export async function GET(request: Request) { await requireUser(); const value = new URL(request.url).searchParams.get("period"); const period: ConsumptionPeriod = value === "month" || value === "year" ? value : "quarter"; try { return NextResponse.json({ data: await loadConsumption(period) }); } catch { return NextResponse.json({ code: "ANALYTICS_LOAD_FAILED" }, { status: 500 }); } }
