export function GET() {
  return new Response(null, {
    status: 308,
    headers: { location: "/favicon-32x32.png" },
  });
}
