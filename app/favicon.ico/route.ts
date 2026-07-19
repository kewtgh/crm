const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#173f36"/>
  <path d="M9 25 32 14l23 11-23 11L9 25Zm8 8v10c8 7 22 7 30 0V33l-15 7-15-7Z" fill="#e8f1ed"/>
</svg>`;

export function GET() {
  return new Response(icon, {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=86400",
    },
  });
}
