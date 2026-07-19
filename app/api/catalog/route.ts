import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, apiRoute, requireApiCapability, requireApiUser } from "@/lib/api";
import { mutationIsTrusted } from "@/lib/request-security";
import {
  createProductBundle,
  listExchangeRates,
  listProductBundles,
  recordExchangeRate,
} from "@/lib/operations-repository";

const schema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("bundle"),
    code: z.string().trim().min(2).max(40).regex(/^[A-Za-z0-9-]+$/).transform((value) => value.toUpperCase()),
    nameZh: z.string().trim().min(2).max(100),
    nameEn: z.string().trim().min(2).max(120),
    items: z.array(z.object({
      productId: z.uuid(),
      quantity: z.number().positive().max(1000),
      optional: z.boolean(),
      discountCeiling: z.number().min(0).max(100),
    })).min(1).max(50),
  }),
  z.object({
    operation: z.literal("exchangeRate"),
    base: z.string().regex(/^[A-Za-z]{3}$/).transform((value) => value.toUpperCase()),
    quote: z.string().regex(/^[A-Za-z]{3}$/).transform((value) => value.toUpperCase()),
    rate: z.number().positive(),
    source: z.string().trim().min(2).max(120),
    effectiveAt: z.iso.datetime(),
  }),
]);

async function get() {
  await requireApiUser();
  const [bundles, exchangeRates] = await Promise.all([listProductBundles(), listExchangeRates()]);
  return NextResponse.json({ bundles, exchangeRates });
}

async function post(request: Request) {
  if (!mutationIsTrusted(request)) throw new ApiError("UNTRUSTED_ORIGIN", 403);
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) throw new ApiError("INVALID_CATALOG_OPERATION", 400);
  if (parsed.data.operation === "bundle") {
    await requireApiCapability("catalog.manage");
    return NextResponse.json({ id: await createProductBundle(parsed.data) }, { status: 201 });
  }
  await requireApiCapability("exchangeRates.manage");
  if (parsed.data.base === parsed.data.quote) throw new ApiError("EXCHANGE_RATE_PAIR_INVALID", 400);
  return NextResponse.json({ item: await recordExchangeRate(parsed.data) }, { status: 201 });
}

export const GET = apiRoute(get, "CATALOG_LOAD_FAILED");
export const POST = apiRoute(post, "CATALOG_OPERATION_FAILED");
