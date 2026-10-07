export function organizationAdvancedCount(value: { commercialTier: string; keyContact: string; potentialMin: string }) {
  // Owner is a primary filter; search/status/owner do not contribute to this badge.
  return [value.commercialTier, value.keyContact, value.potentialMin].filter(value => value !== "").length;
}
