import { supabaseJson } from "./supabase-server";

export type QueueMetric = {
  key: string;
  pending: number;
  failed: number;
  stuck: number;
  breached: number;
  slaMinutes: number;
  oldest: string | null;
};
export type WorkerMetric = {
  key: string;
  lastSeenAt: string;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  consecutiveFailures: number;
  lastError: string | null;
  stale: boolean;
  metadata: Record<string, unknown>;
};
export type OperationalSnapshot = {
  generatedAt: string;
  queues: QueueMetric[];
  workers: WorkerMetric[];
};
export type RetryableJob = {
  id: string;
  type: "NOTIFICATION_OUTBOX" | "CALENDAR_DELIVERIES" | "GENERATED_JOBS" | "REMINDERS" | "WEBHOOK_INBOX" | "IDENTITY_REPAIR";
  label: string;
  status: string;
  error: string;
  updatedAt: string;
};
export type IntegrationConnection = {
  id: string;
  provider: "MICROSOFT_365" | "GOOGLE_CALENDAR" | "EMAIL" | "E_SIGNATURE" | "ACCOUNTING";
  status: "DISCONNECTED" | "CONNECTING" | "CONNECTED" | "DEGRADED" | "ACTION_REQUIRED";
  syncDirection: "NONE" | "IMPORT_ONLY" | "EXPORT_ONLY" | "BIDIRECTIONAL";
  externalAccountLabel: string;
  cursorValue: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
};
export type NextBestAction = {
  id: string;
  organizationId: string;
  organizationNameZh: string;
  organizationNameEn: string;
  ruleKey: string;
  ruleVersion: string;
  priority: "LOW" | "MEDIUM" | "HIGH";
  titleZh: string;
  titleEn: string;
  rationaleZh: string;
  rationaleEn: string;
  evidence: Record<string, unknown>;
  confidence: number;
  status: "SUGGESTED" | "ACCEPTED" | "REJECTED" | "EXPIRED";
  validUntil: string;
  draftTaskId: string | null;
};
export type ProductBundle = {
  id: string;
  code: string;
  nameZh: string;
  nameEn: string;
  active: boolean;
  version: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  items: Array<{
    productId: string;
    productNameZh: string;
    productNameEn: string;
    quantity: number;
    optional: boolean;
    discountCeiling: number;
  }>;
};
export type ExchangeRateSnapshot = {
  id: string;
  baseCurrency: string;
  quoteCurrency: string;
  rate: number;
  source: string;
  effectiveAt: string;
  createdAt: string;
};

export type BusinessInsights = {
  retention: { eligible: number; retained: number; rate: number };
  renewal: { renewed: number; lost: number; overdue: number; conversionRate: number };
  forecast: { forecast: number; actual: number; accuracy: number };
  queueSla: { pending: number; breached: number; attainment: number };
  nextBestAction: {
    suggested: number; accepted: number; rejected: number; completed: number;
    adoptionRate: number; completionRate: number;
  };
};

export async function loadOperationalSnapshot() {
  return supabaseJson<OperationalSnapshot>("/rest/v1/rpc/operational_snapshot", {
    method: "POST",
    body: "{}",
  });
}

export async function retryOperationalJob(jobType: string, jobId: string) {
  return supabaseJson<void>("/rest/v1/rpc/retry_operational_job", {
    method: "POST",
    body: JSON.stringify({ job_type: jobType, job_id: jobId }),
  });
}

export async function listRetryableJobs(): Promise<RetryableJob[]> {
  return supabaseJson<RetryableJob[]>("/rest/v1/rpc/operational_retryable_jobs", {
    method: "POST",
    body: "{}",
  });
}

export async function listIntegrations(): Promise<IntegrationConnection[]> {
  const rows = await supabaseJson<Array<Record<string, unknown>>>(
    "/rest/v1/integration_connections?select=id,provider,status,sync_direction,external_account_label,cursor_value,last_synced_at,last_error&order=provider",
  );
  return rows.map((row) => ({
    id: String(row.id),
    provider: row.provider as IntegrationConnection["provider"],
    status: row.status as IntegrationConnection["status"],
    syncDirection: row.sync_direction as IntegrationConnection["syncDirection"],
    externalAccountLabel: String(row.external_account_label ?? ""),
    cursorValue: row.cursor_value ? String(row.cursor_value) : null,
    lastSyncedAt: row.last_synced_at ? String(row.last_synced_at) : null,
    lastError: row.last_error ? String(row.last_error) : null,
  }));
}

export async function generateNextBestActions(organizationId?: string | null) {
  return supabaseJson<number>("/rest/v1/rpc/generate_next_best_actions", {
    method: "POST",
    body: JSON.stringify({ target_organization: organizationId || null }),
  });
}

export async function listNextBestActions(organizationId?: string | null): Promise<NextBestAction[]> {
  const organizationFilter = organizationId ? `&organization_id=eq.${encodeURIComponent(organizationId)}` : "";
  const rows = await supabaseJson<Array<Record<string, unknown>>>(
    `/rest/v1/next_best_actions?select=id,organization_id,rule_key,rule_version,priority,title_zh,title_en,rationale_zh,rationale_en,evidence,confidence,status,valid_until,draft_task_id,organizations(name_zh,name_en)&status=eq.SUGGESTED${organizationFilter}&order=priority.desc,valid_until.asc&limit=100`,
  );
  return rows.map((row) => {
    const organization = row.organizations as Record<string, unknown> | null;
    return {
      id: String(row.id),
      organizationId: String(row.organization_id),
      organizationNameZh: String(organization?.name_zh ?? ""),
      organizationNameEn: String(organization?.name_en ?? ""),
      ruleKey: String(row.rule_key),
      ruleVersion: String(row.rule_version),
      priority: row.priority as NextBestAction["priority"],
      titleZh: String(row.title_zh),
      titleEn: String(row.title_en),
      rationaleZh: String(row.rationale_zh),
      rationaleEn: String(row.rationale_en),
      evidence: (row.evidence ?? {}) as Record<string, unknown>,
      confidence: Number(row.confidence),
      status: row.status as NextBestAction["status"],
      validUntil: String(row.valid_until),
      draftTaskId: row.draft_task_id ? String(row.draft_task_id) : null,
    };
  });
}

export async function decideNextBestAction(id: string, decision: "ACCEPTED" | "REJECTED", reason = "") {
  return supabaseJson<Record<string, unknown>>("/rest/v1/rpc/decide_next_best_action", {
    method: "POST",
    body: JSON.stringify({ target_action: id, decision, reason }),
  });
}

export async function listProductBundles(): Promise<ProductBundle[]> {
  const rows = await supabaseJson<Array<Record<string, unknown>>>(
    "/rest/v1/product_bundles?select=id,code,name_zh,name_en,active,version,effective_from,effective_to,product_bundle_items(product_id,quantity,optional,discount_ceiling,products(name_zh,name_en))&order=code,version.desc",
  );
  return rows.map((row) => ({
    id: String(row.id),
    code: String(row.code),
    nameZh: String(row.name_zh),
    nameEn: String(row.name_en),
    active: Boolean(row.active),
    version: Number(row.version),
    effectiveFrom: String(row.effective_from),
    effectiveTo: row.effective_to ? String(row.effective_to) : null,
    items: ((row.product_bundle_items ?? []) as Array<Record<string, unknown>>).map((item) => {
      const product = item.products as Record<string, unknown> | null;
      return {
        productId: String(item.product_id),
        productNameZh: String(product?.name_zh ?? ""),
        productNameEn: String(product?.name_en ?? ""),
        quantity: Number(item.quantity),
        optional: Boolean(item.optional),
        discountCeiling: Number(item.discount_ceiling),
      };
    }),
  }));
}

export async function createProductBundle(input: {
  code: string;
  nameZh: string;
  nameEn: string;
  items: Array<{ productId: string; quantity: number; optional: boolean; discountCeiling: number }>;
}) {
  const row = await supabaseJson<{ id: string }>("/rest/v1/rpc/create_product_bundle", {
    method: "POST",
    body: JSON.stringify({
      bundle_code: input.code,
      bundle_name_zh: input.nameZh,
      bundle_name_en: input.nameEn,
      bundle_items: input.items.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        optional: item.optional,
        discountCeiling: item.discountCeiling,
      })),
    }),
  });
  return row.id;
}

export async function listExchangeRates(): Promise<ExchangeRateSnapshot[]> {
  const rows = await supabaseJson<Array<Record<string, unknown>>>(
    "/rest/v1/exchange_rate_snapshots?select=id,base_currency,quote_currency,rate,source,effective_at,created_at&order=effective_at.desc&limit=100",
  );
  return rows.map((row) => ({
    id: String(row.id),
    baseCurrency: String(row.base_currency),
    quoteCurrency: String(row.quote_currency),
    rate: Number(row.rate),
    source: String(row.source),
    effectiveAt: String(row.effective_at),
    createdAt: String(row.created_at),
  }));
}

export async function recordExchangeRate(input: {
  base: string;
  quote: string;
  rate: number;
  source: string;
  effectiveAt: string;
}) {
  return supabaseJson<Record<string, unknown>>("/rest/v1/rpc/record_exchange_rate_snapshot", {
    method: "POST",
    body: JSON.stringify({
      base: input.base,
      quote: input.quote,
      snapshot_rate: input.rate,
      rate_source: input.source,
      effective: input.effectiveAt,
    }),
  });
}

export async function configureIntegration(input: {
  provider: IntegrationConnection["provider"];
  status: IntegrationConnection["status"];
  syncDirection: IntegrationConnection["syncDirection"];
  accountLabel: string;
}) {
  return supabaseJson<Record<string, unknown>>("/rest/v1/rpc/configure_integration", {
    method: "POST",
    body: JSON.stringify({
      target_provider: input.provider,
      next_status: input.status,
      next_direction: input.syncDirection,
      account_label: input.accountLabel,
    }),
  });
}

export async function requestIntegrationSync(provider: IntegrationConnection["provider"]) {
  return supabaseJson<Record<string, unknown>>("/rest/v1/rpc/request_integration_sync", {
    method: "POST",
    body: JSON.stringify({ target_provider: provider }),
  });
}

export async function loadBusinessInsights() {
  return supabaseJson<BusinessInsights>("/rest/v1/rpc/business_improvement_snapshot", {
    method: "POST",
    body: "{}",
  });
}
