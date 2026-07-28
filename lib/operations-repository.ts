import { databaseSystemJson, databaseJson, databaseRequest, DatabaseRequestError } from "./db/gateway";
import { inspectWorkerRuntimeEnvironment, type WorkerKey } from "./runtime-environment";
import { fetchWithTimeout } from "./fetch-timeout";
import type {
  IntegrationProvider,
  IntegrationStatus,
  IntegrationSyncDirection,
  OperationQueueKey,
  RetryableJobType,
} from "./operations-types";

export type QueueMetric = {
  key: OperationQueueKey;
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
export type ReleaseReadiness={
  ready:boolean;
  database:boolean;
  staleWorkers:number;
  missingWorkers:number;
  failedJobs:number;
  stuckJobs:number;
  oldestPendingAt:string|null;
  environment:{
    core:boolean;
    delivery:boolean;
    webhooks:boolean;
    integrations:boolean;
    observability:boolean;
    sso:boolean;
    scim:boolean;
    webhooksEnabled:boolean;
    integrationsEnabled:boolean;
    observabilityEnabled:boolean;
    ssoEnabled:boolean;
    scimEnabled:boolean;
    enabledWorkers:WorkerKey[];
    configured:number;
    expected:number;
    missing:string[];
  };
};
export type RetryableJob = {
  id: string;
  type: RetryableJobType;
  label: string;
  status: string;
  error: string;
  updatedAt: string;
};
export type IntegrationConnection = {
  id: string;
  provider: IntegrationProvider;
  status: IntegrationStatus;
  syncDirection: IntegrationSyncDirection;
  externalAccountLabel: string;
  cursorValue: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  validation: {status:"SUCCEEDED"|"FAILED";validatedAt:string;expiresAt:string;capabilities:string[];errorCode:string|null}|null;
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
export type PagedResult<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
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
  return databaseJson<OperationalSnapshot>("/db/rpc/operational_snapshot", {
    method: "POST",
    body: "{}",
  });
}

export async function loadReleaseReadiness():Promise<ReleaseReadiness>{
  const environment=inspectWorkerRuntimeEnvironment();
  const workspaceId=process.env.CRM_WORKSPACE_ID;
  const missingWorkers=environment.enabledWorkers.length;
  if(!workspaceId||!/^[0-9a-f-]{36}$/i.test(workspaceId))return{ready:false,database:false,staleWorkers:0,missingWorkers,failedJobs:0,stuckJobs:0,oldestPendingAt:null,environment};
  if(!process.env.SYSTEM_DATABASE_URL)return{ready:false,database:false,staleWorkers:0,missingWorkers,failedJobs:0,stuckJobs:0,oldestPendingAt:null,environment};
  const snapshot=await databaseSystemJson<Partial<ReleaseReadiness>>("/db/rpc/service_readiness_snapshot_for_workers",{method:"POST",body:JSON.stringify({target_workspace:workspaceId,enabled_workers:environment.enabledWorkers})});
  return{ready:snapshot.ready===true&&environment.valid,database:snapshot.database===true,staleWorkers:Number(snapshot.staleWorkers??0),missingWorkers:Number(snapshot.missingWorkers??0),failedJobs:Number(snapshot.failedJobs??0),stuckJobs:Number(snapshot.stuckJobs??0),oldestPendingAt:snapshot.oldestPendingAt??null,environment};
}

export async function retryOperationalJob(jobType: string, jobId: string) {
  return databaseJson<void>("/db/rpc/retry_operational_job", {
    method: "POST",
    body: JSON.stringify({ job_type: jobType, job_id: jobId }),
  });
}

export async function listRetryableJobs(page = 1, pageSize = 10): Promise<PagedResult<RetryableJob>> {
  return databaseJson<PagedResult<RetryableJob>>("/db/rpc/operational_retryable_jobs_page", {
    method: "POST",
    body: JSON.stringify({ page_number: page, page_size: pageSize }),
  });
}

export async function listIntegrations(): Promise<IntegrationConnection[]> {
  const workspaceId=process.env.CRM_WORKSPACE_ID;
  const [rows,receipts] = await Promise.all([databaseJson<Array<Record<string, unknown>>>(
    "/db/table/integration_connections?select=id,provider,status,sync_direction,external_account_label,cursor_value,last_synced_at,last_error&order=provider",
  ),workspaceId?databaseSystemJson<Array<Record<string,unknown>>>(`/db/table/connector_validation_receipts?select=provider,status,validated_at,expires_at,capabilities,error_code&workspace_id=eq.${workspaceId}&order=validated_at.desc&limit=100`):Promise.resolve([])]);
  const validationByProvider=new Map<string,Record<string,unknown>>();for(const receipt of receipts){const key=String(receipt.provider);if(!validationByProvider.has(key))validationByProvider.set(key,receipt);}
  return rows.map((row) => ({
    id: String(row.id),
    provider: row.provider as IntegrationConnection["provider"],
    status: row.status as IntegrationConnection["status"],
    syncDirection: row.sync_direction as IntegrationConnection["syncDirection"],
    externalAccountLabel: String(row.external_account_label ?? ""),
    cursorValue: row.cursor_value ? String(row.cursor_value) : null,
    lastSyncedAt: row.last_synced_at ? String(row.last_synced_at) : null,
    lastError: row.last_error ? String(row.last_error) : null,
    validation:(()=>{const receipt=validationByProvider.get(String(row.provider));return receipt?{status:receipt.status as "SUCCEEDED"|"FAILED",validatedAt:String(receipt.validated_at),expiresAt:String(receipt.expires_at),capabilities:Array.isArray(receipt.capabilities)?receipt.capabilities.map(String):[],errorCode:receipt.error_code?String(receipt.error_code):null}:null;})(),
  }));
}

export async function generateNextBestActions(organizationId?: string | null) {
  return databaseJson<number>("/db/rpc/generate_next_best_actions", {
    method: "POST",
    body: JSON.stringify({ target_organization: organizationId || null }),
  });
}

export async function listNextBestActions(
  organizationId?: string | null,
  page = 1,
  pageSize = 10,
): Promise<PagedResult<NextBestAction>> {
  const organizationFilter = organizationId ? `&organization_id=eq.${encodeURIComponent(organizationId)}` : "";
  const start = (page - 1) * pageSize;
  const response = await databaseRequest(
    `/db/table/next_best_actions?select=id,organization_id,rule_key,rule_version,priority,title_zh,title_en,rationale_zh,rationale_en,evidence,confidence,status,valid_until,draft_task_id,organizations(name_zh,name_en)&status=eq.SUGGESTED${organizationFilter}&order=priority.desc,valid_until.asc,id.asc`,
    { headers: { Prefer: "count=exact", Range: `${start}-${start + pageSize - 1}` } },
  );
  const rows = await response.json() as Array<Record<string, unknown>>;
  const items = rows.map((row) => {
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
  const total = Number((response.headers.get("content-range") ?? `*/${items.length}`).split("/")[1] ?? items.length);
  return { items, total, page, pageSize };
}

export async function decideNextBestAction(id: string, decision: "ACCEPTED" | "REJECTED", reason = "") {
  return databaseJson<Record<string, unknown>>("/db/rpc/decide_next_best_action", {
    method: "POST",
    body: JSON.stringify({ target_action: id, decision, reason }),
  });
}

export async function listProductBundles(): Promise<ProductBundle[]> {
  const rows = await databaseJson<Array<Record<string, unknown>>>(
    "/db/table/product_bundles?select=id,code,name_zh,name_en,active,version,effective_from,effective_to,product_bundle_items(product_id,quantity,optional,discount_ceiling,products(name_zh,name_en))&order=code,version.desc",
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
  const row = await databaseJson<{ id: string }>("/db/rpc/create_product_bundle", {
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
  const rows = await databaseJson<Array<Record<string, unknown>>>(
    "/db/table/exchange_rate_snapshots?select=id,base_currency,quote_currency,rate,source,effective_at,created_at&order=effective_at.desc&limit=100",
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
  return databaseJson<Record<string, unknown>>("/db/rpc/record_exchange_rate_snapshot", {
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
  return databaseJson<Record<string, unknown>>("/db/rpc/configure_integration", {
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
  if (/^(1|true|yes|on)$/i.test(process.env.INTEGRATION_SYNC_ENABLED?.trim()??"")) {
    const workspaceId=process.env.CRM_WORKSPACE_ID;
    if(!workspaceId)throw new DatabaseRequestError(503,"WORKSPACE_NOT_CONFIGURED","Workspace is not configured");
    const receipts=await databaseSystemJson<Array<{expires_at:string}>>(`/db/table/connector_validation_receipts?select=expires_at&workspace_id=eq.${workspaceId}&provider=eq.${provider}&status=eq.SUCCEEDED&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&order=validated_at.desc&limit=1`);
    if(!receipts[0])throw new DatabaseRequestError(409,"CONNECTOR_VALIDATION_REQUIRED","A current successful connector validation is required");
  }
  return databaseJson<Record<string, unknown>>("/db/rpc/request_integration_sync", {
    method: "POST",
    body: JSON.stringify({ target_provider: provider }),
  });
}

function hex(bytes:Uint8Array){return Array.from(bytes,byte=>byte.toString(16).padStart(2,"0")).join("");}
export async function validateIntegration(provider:IntegrationConnection["provider"],actorId:string){
  const environment=inspectWorkerRuntimeEnvironment();const workspaceId=process.env.CRM_WORKSPACE_ID;const endpoint=process.env.INTEGRATION_SYNC_PROCESSOR_URL?.trim();const token=process.env.INTEGRATION_SYNC_PROCESSOR_TOKEN?.trim();
  if(!environment.integrationsEnabled||!environment.integrations||!workspaceId||!endpoint||!token)throw new DatabaseRequestError(503,"CONNECTOR_VALIDATION_NOT_CONFIGURED","Connector validation is not configured");
  const startedAt=performance.now();let status:"SUCCEEDED"|"FAILED"="FAILED";let digest:string|null=null;let capabilities:string[]=[];let errorCode:string|null="CONNECTOR_VALIDATION_FAILED";
  try{const response=await fetchWithTimeout(endpoint,{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},body:JSON.stringify({operation:"validate",provider,requestId:crypto.randomUUID()})},8_000);const payload=await response.json().catch(()=>({})) as {status?:string;capabilities?:unknown};if(!response.ok||payload.status!=="READY"||!Array.isArray(payload.capabilities))throw new Error("CONNECTOR_NOT_READY");capabilities=[...new Set(payload.capabilities.filter((item):item is string=>typeof item==="string"&&/^[A-Za-z0-9._:-]{1,80}$/.test(item)))].sort();const canonical=JSON.stringify({provider,status:"READY",capabilities});digest=hex(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(canonical))));status="SUCCEEDED";errorCode=null;}catch(error){errorCode=error instanceof Error&&/^[A-Z0-9_]{3,80}$/.test(error.message)?error.message:"CONNECTOR_VALIDATION_FAILED";}
  const expiresAt=new Date(Date.now()+24*60*60*1_000).toISOString();const durationMs=Math.min(60_000,Math.max(0,Math.round(performance.now()-startedAt)));await databaseSystemJson("/db/table/connector_validation_receipts",{method:"POST",headers:{Prefer:"return=minimal"},body:JSON.stringify({workspace_id:workspaceId,provider,status,response_digest:digest,capabilities,error_code:errorCode,duration_ms:durationMs,validated_by:actorId,expires_at:expiresAt})});
  if(status!=="SUCCEEDED")throw new DatabaseRequestError(502,errorCode??"CONNECTOR_VALIDATION_FAILED","Connector validation failed");return{status,capabilities,expiresAt,responseDigest:digest};
}

export async function loadBusinessInsights() {
  return databaseJson<BusinessInsights>("/db/rpc/business_improvement_snapshot", {
    method: "POST",
    body: "{}",
  });
}
