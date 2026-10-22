export function classifyPublicEdgeFailure(error) {
  const code = error?.cause?.code ?? error?.code ?? error?.name;
  if (["ENOTFOUND", "EAI_AGAIN"].includes(code)) return "PUBLIC_EDGE_DNS_FAILED";
  if (["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "TimeoutError", "AbortError"].includes(code)) return "PUBLIC_EDGE_TIMEOUT";
  if (["ECONNRESET", "UND_ERR_SOCKET"].includes(code)) return "PUBLIC_EDGE_CONNECTION_RESET";
  if (/TLS|SSL|CERT/i.test(String(code))) return "PUBLIC_EDGE_TLS_FAILED";
  return "PUBLIC_EDGE_TRANSPORT_FAILED";
}

export async function waitForPublicEdge({ url, expectedVersion, fetchResponse = fetch,
  durationMs = 30_000, attemptTimeoutMs = 5_000, maxAttempts = 7,
  now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), random = Math.random,
  onAttempt = () => {} }) {
  if (!expectedVersion || durationMs < 1 || durationMs > 60_000 || maxAttempts < 1 || maxAttempts > 10) {
    throw new Error("PUBLIC_EDGE_CONFIGURATION_INVALID");
  }
  const deadline = now() + durationMs;
  let category = "PUBLIC_EDGE_TIMEOUT";
  for (let attempt = 1; attempt <= maxAttempts && now() < deadline; attempt++) {
    let retry = true;
    try {
      const response = await fetchResponse(url, { redirect: "manual",
        signal: AbortSignal.timeout(Math.max(1, Math.min(attemptTimeoutMs, deadline - now()))) });
      if (response.status !== 200) {
        category = [530, 502, 503, 504].includes(response.status)
          ? `PUBLIC_EDGE_HTTP_${response.status}` : "PUBLIC_EDGE_HTTP_REJECTED";
        retry = [530, 502, 503, 504].includes(response.status);
        await response.body?.cancel();
      } else {
        // Bound response consumption as well as connection establishment.
        const reader = response.body?.getReader();
        let size = 0;
        const chunks = [];
        if (reader) {
          try {
            while (true) {
              const part = await reader.read();
              if (part.done) break;
              size += part.value.byteLength;
              if (size > 65_536) { await reader.cancel(); break; }
              chunks.push(Buffer.from(part.value));
            }
          } finally { reader.releaseLock(); }
        }
        let body;
        try { body = size > 65_536 ? null : JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { body = null; }
        if (!body || body.status !== "ok") category = "PUBLIC_EDGE_RESPONSE_INVALID";
        else if (body.version !== expectedVersion) category = "PUBLIC_EDGE_VERSION_MISMATCH";
        else { onAttempt({ attempt, category: "HEALTHY" }); return { status: "HEALTHY", attempts: attempt, version: expectedVersion }; }
        retry = false;
      }
    } catch (error) { category = classifyPublicEdgeFailure(error); }
    onAttempt({ attempt, category });
    if (!retry || attempt === maxAttempts || now() >= deadline) break;
    await sleep(Math.min(deadline - now(), Math.round(Math.min(8_000, 500 * 2 ** (attempt - 1)) * (0.8 + random() * 0.4))));
  }
  throw Object.assign(new Error(category), { code: category, publicEdgeFailure: true });
}
