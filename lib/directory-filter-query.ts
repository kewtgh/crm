export const organizationFilterDefaults = {commercialTier:"",keyContact:"",ownerId:"",potentialMin:"",city:"",curriculum:"",organizationType:""};
export const contactFilterDefaults = {organizationId:"",ownerId:"",contactType:""};
export const noDirectoryFilters: Record<string,string> = {};

/** Only explicitly supported keys become API filters. Unrelated URL context stays in the URL. */
export function parseDirectoryFilters(params: Pick<URLSearchParams,"get">, defaults: Record<string,string>) {
  return Object.fromEntries(Object.entries(defaults).map(([key,fallback])=>[key,params.get(key)??fallback]));
}

export function writeDirectoryFilters(params: URLSearchParams, filters: Record<string,string>) {
  const result = new URLSearchParams(params);
  for (const [key,value] of Object.entries(filters)) {
    if (value) result.set(key,value); else result.delete(key);
  }
  return result;
}

/** Required collection shape: malformed responses are unavailable, never an empty/zero result. */
export function assertPagedResult<T,M>(value: unknown): asserts value is {items:T[];total:number;metrics:M} {
  if (!value || typeof value!=="object" || !("items" in value) || !Array.isArray(value.items)
    || !("total" in value) || typeof value.total!=="number" || !Number.isSafeInteger(value.total) || value.total<0) {
    throw new Error("INVALID_PAGED_RESPONSE");
  }
  const metrics="metrics" in value?value.metrics:null;
  if(!metrics||typeof metrics!=="object"||!["total","needsAttention","averageCompleteness"].every(key=>{
    const fact=(metrics as Record<string,unknown>)[key];
    return typeof fact==="number"&&Number.isFinite(fact)&&fact>=0;
  }))throw new Error("INVALID_PAGED_METRICS");
}
