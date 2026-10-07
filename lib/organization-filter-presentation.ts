export function organizationAdvancedCount(value: { commercialTier: string; keyContact: string; potentialMin: string;city?:string;curriculum?:string;organizationType?:string }) {
  // Owner is a primary filter; search/status/owner do not contribute to this badge.
  return [value.commercialTier, value.keyContact, value.potentialMin,value.city??"",value.curriculum??"",value.organizationType??""].filter(value => value !== "").length;
}
