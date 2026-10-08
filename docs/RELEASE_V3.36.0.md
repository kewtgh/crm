# ewaya CRM v3.36.0

Authentication, invitations, reminders, calendar and communication emails share a
consistent ewaya layout with mobile-friendly tables, clear actions, readable codes,
security notes and equivalent plain text. The renderer supports English and Chinese,
with English fallback. Customer-authored content and communication consent remain intact.
Operator preflight requires ewaya branding and sender display configuration.

Staff administration uses suspend → clear/reassign business links → recheck → remove.
Past business activity does not permanently prohibit deletion. The server checks current
business dependencies and protects self, privileged, externally
managed and multi-workspace identities. Confirmed cleanup revokes credentials and
sessions, removes unclaimed invitations and retains minimal audit. If only retained
business-audit references remain, an anonymous disabled identity preserves their UUID;
it has no login or staff-directory membership and cannot gain new business links.
Required business/financial history is never cascade-deleted.

Finance Manager/Specialist, Operations Manager/Specialist, Academic Specialist and
Customer Success Specialist provide bounded access without granting administrator or
Revenue business authority. Business functions and sales-reporting participation are
configured separately. Super administrators can configure their own participation;
administrators can configure their own and ordinary workspace employees' participation.
Qualification requires an explicit approval, Sales function and valid team relationship.

Sales roster, actuals, targets, forecasts and exports share the reporting policy.
Approved historical period scopes are preserved; qualification changes cannot be
backdated. Unscoped contributions remain visible as separate context rather than being
deleted or reassigned. Company Contracted, Collected and Recognized Revenue remain
independent of personal reporting eligibility.

Sensitive staff changes require AAL2, audit and request identity. Uncertain responses
reuse the same request; accepted writes followed by refresh failure offer refresh only.
Staff forms support English/Chinese, keyboard use and narrow screens.

Deployment requires forward-only migrations 128–131; current head is 131 / 136 SQL.
Historical migrations are unchanged. No secret rotation is required. Operators must
validate the non-secret email brand/sender settings before deploying the updated Email
Delivery Worker. No Production change is included in this checkpoint.

Web authentication email stays synchronous; business delivery stays asynchronous.
Revenue recognition, Refund, Commission and Cash Application semantics are unchanged.
New profiles are locally provisioned; existing external-directory role provisioning
retains its prior contract. Email browser previews are not real-client certification.

See [verification](V336_VERIFICATION.md) for test results and operational limitations.

The follow-up [schema/auth CI repair](SCHEMA_AUTH_RLS_CI_REPAIR.md) completes validation
of the receipt actor foreign key without weakening the schema gate or rewriting migration
128. Legacy orphaned actor references require controlled review before upgrade.
