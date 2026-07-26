import { fetchWithTimeout } from "./fetch-timeout";

export type ObservabilityEvent = {
  name: "api.request.completed";
  requestId: string;
  method: string;
  route: string;
  status: number;
  durationMs: number;
  outcome: "success" | "redirect" | "client_error" | "server_error";
  errorCode?: string;
};

function enabled(value: string | undefined) {
  return /^(1|true|yes|on)$/i.test(value?.trim() ?? "");
}

function sampleRate() {
  const value = Number(process.env.OBSERVABILITY_SAMPLE_RATE ?? "1");
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1;
}

export async function emitObservabilityEvent(event: ObservabilityEvent) {
  const envelope = {
    schemaVersion: 1,
    service: "lumina-crm",
    environment: process.env.NODE_ENV ?? "unknown",
    occurredAt: new Date().toISOString(),
    ...event,
  };
  // This allow-listed envelope never includes request bodies, query strings,
  // cookies, account identifiers, or business-record content.
  if (event.status >= 500 || Math.random() <= sampleRate()) {
    console.info(`[observability] ${JSON.stringify(envelope)}`);
  }
  if (!enabled(process.env.OBSERVABILITY_ENABLED) || Math.random() > sampleRate()) return;
  const endpoint = process.env.OBSERVABILITY_WEBHOOK_URL?.trim();
  const token = process.env.OBSERVABILITY_WEBHOOK_TOKEN?.trim();
  if (!endpoint || !token) return;
  try {
    await fetchWithTimeout(endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(envelope),
    }, 2_000);
  } catch (error) {
    console.warn("[observability] delivery failed", error instanceof Error ? error.name : "unknown");
  }
}

export function requestOutcome(status: number): ObservabilityEvent["outcome"] {
  if (status >= 500) return "server_error";
  if (status >= 400) return "client_error";
  if (status >= 300) return "redirect";
  return "success";
}

export function routeTemplate(pathname:string){
  return `/${pathname.split("/").filter(Boolean).map((segment)=>{
    if(/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(segment))return ":id";
    if(/^\d+$/.test(segment))return ":id";
    if(segment.length>48||/^[A-Za-z0-9_-]{32,}$/.test(segment))return ":token";
    return segment;
  }).join("/")}`;
}
