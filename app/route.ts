import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  return new Response(null, {
    status: 307,
    headers: { Location: user ? "/dashboard" : "/login" },
  });
}
