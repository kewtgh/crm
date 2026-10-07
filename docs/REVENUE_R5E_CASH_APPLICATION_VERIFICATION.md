# Revenue R5E — Cash custody and application verification

## Baseline and migration

Opening implementation truth was the current uncommitted working tree: branch `main`, HEAD `cd19e48c19343536a9ad5f97e3c7bd89228f63f8`, version **3.31.0**, migration **118**, **123 SQL files**. Opening Git status, diff/stat/index, 123 migration hashes and 47 phase/shared-file hashes are in ignored `work/revenue-r5e/opening.json`. R5A–R5D were retained rather than reconstructed from HEAD.

The append-only migration is `db/migrations/202610080119_cash_applications.sql`. Verified final head/count: **119 / 124 SQL files**. All 123 opening SQL hashes match. Of 47 opening phase/shared paths, 46 remain byte-identical; only the authorized `lib/capabilities.ts` extension differs. No old migration or prior phase report/test is edited. The shared extension adds `finance.cashApplication.manage`, including AAL2 classification. Formal version stays **3.31.0**.

## Owners and Payment purpose

The only new relation is `cash_applications`. Payment still owns received cash; Refund owns cash returned; Receivable owns the customer obligation and paid state; Recognized Revenue Fact owns earned Revenue; Commission owns outbound channel obligations. Reconciliation keeps its existing role.

Payment gains `purpose` and nullable `reporting_entity_id`. Existing rows deterministically default to `TRADE_RECEIPT`, matching the previous Contract/receivable-based runtime. No amount is backfilled or recognition guessed. Trade rows retain their Contract and schedule semantics. Custody rows require a reporting entity and have **no trade Contract, Product or receivable schedule** on Payment. Their accepted terms, payer relationship and permitted targets are retained by the declaration instead. This avoids a fake receivable and excludes unallocated custody from Contract trade totals.

The canonical `record_payment` function is extended with optional custody/request-key inputs. Existing six-argument trade calls remain compatible through the privately revoked prior implementation. Custody receipt and `DECLARE_CUSTODY` are created atomically; a deferred constraint forbids committing a custody Payment without its declaration. App clients cannot INSERT Payment directly. Purpose/entity cannot be reclassified in place, including through privileged SQL with normal integrity mechanisms enabled.

## Declaration, application and reversal

The immutable entry vocabulary is `DECLARE_CUSTODY`, `APPLY`, `REVERSE`. Each entry pins workspace/entity, source Payment, currency, exact amount, terms Contract/version/service, beneficiary interpretation, permitted service IDs, intent, actor/time, request key and a server-generated digest. Application/reversal additionally pins canonical target Contract, specified service and real Receivable. Reversal references its original application.

A declaration requires an accepted specified service in the same entity, its accepted Contract version, current canonical Contract access and a bounded permitted-target list. The payer is derived from that Contract's Organization/Household buyer. Beneficiary is either the reporting entity or that canonical Contract buyer. No new Party master or private contractual body is copied. The designated cash manager's governed declaration explicitly authorizes the target scope and business reference; the software does not infer permissions from extracted contract prose.

Initial custody roles are `COLLECTION_CUSTODIAN`, `CONDITIONAL_SETTLEMENT_HOLDER`, `COLLECTION_FOR_BENEFICIARY`. They do not select Revenue treatment. One Payment has one immutable declaration; changed beneficiary/terms are not supported as an UPDATE or silent reclassification.

APPLY uses an existing permitted service as economic context and a real Receivable as the settlement target. It never targets a recognized Revenue fact. It validates workspace/entity, current Contract visibility/state, service and Contract currency, schedule membership/state and current outstanding balance under lock. It does not infer target balance from Revenue or create a second Payment.

REVERSE appends a positive release quantity tied to an APPLY. Net application is `sum(APPLY) - sum(REVERSE)`. A reversal cannot exceed the original application's unreversed balance. Released cash can be reapplied through a new intent. The original declaration/application remains historical.

Database triggers reject application UPDATE/DELETE unconditionally. Composite foreign keys bind source/entity, target Contract/schedule and reversal/declaration source scope. Direct application writes are revoked from app/system/worker roles. Deferred receipt validation, audit and the canonical Receivable refresh are in the same transaction; an injected audit failure leaves no applied balance or paid-state change.

## Source/target ceilings and Refund

```text
available source = Payment.amount
                 - Payment.refunded_amount
                 - pending/approved Refund reservations
                 - net active applications
```

PAID refunds are already represented in `Payment.refunded_amount` and are not subtracted again. An additional refund guard checks the canonical sum of pending/approved/paid Refund rows plus applications against the original Payment amount. Refund amount/source cannot be changed to evade that check. Pending and approved reservations have equal economic occupancy; rejection releases reservation capacity.

The target limit is its current Receivable amount minus its paid amount, including both direct trade receipts and applied custody. `refresh_receivable` remains the canonical paid-state mutation: it combines net trade receipts and net applications once. A reversed application releases the same quantity atomically. Direct `record_payment` continues checking this current paid amount, so direct settlement and application cannot both settle an outstanding 100 as 200.

Custody Refund request/completion reuse the existing canonical Refund and Approval tables. The functions accept optional request keys; custody requires a key and replay returns the accepted result, while old trade signatures remain compatible. A custody refund requires designated cash authority/AAL2 and accessible source terms. Its approval uses a different designated cash manager; generic administrator membership cannot approve it. The generic approval entry and a database trigger enforce this boundary. Cash already applied must first be released with REVERSE.

Refund decisions continue through canonical Approval requests/actions. There is no second approval engine. Declaration/application/reversal are direct governed commands, with designated authority, AAL2, audit and receipt; they do not implicitly require or create a Revenue posting approval.

## Classification and reads

| Measure | Meaning after R5E |
|---|---|
| Received custody source | Canonical Payment amount, explicitly classified as custody |
| Refunded custody | Completed canonical Refunds, reflected once on Payment |
| Available custody | Retained source cash minus reservations and net applications |
| Applied settlement | Net applications against a real Receivable |
| Contract Collected | Existing net trade receipts **plus applied custody settlement** against that Contract |
| Contract `applied_cash` | Explicit new field separating that applied component |
| Gross receipts/refunded receipt metrics | Retain trade Payment/Refund meanings; application is not a second receipt |
| Recognized Revenue | R5D facts, untouched by cash operations |

A restrictive Payment SELECT policy keeps custody out of legacy unclassified receipt lists and receipt-based consumption/performance queries. Existing Contract, Product and management receipt joins also exclude it because custody has no trade Contract. `contract_finance_snapshot` explicitly adds target settlement once and exposes `applied_cash`; Enrollment and management projections that reuse it inherit correct paid/outstanding/Collected values. Receipt-period trends remain receipt metrics, not application-date or Revenue metrics. No bank cash-on-hand ledger or Revenue metric is introduced.

`cash_source_status` exposes available/reserved/refunded/applied decimal strings and minimal opaque lineage under cash authority and source Contract access. `cash_target_status` exposes a scoped Receivable's paid/outstanding/applied history. `cash_contract_settled` lets existing authorized Contract finance readers see settlement totals without exposing custody payer/terms/source details. Full application rows additionally require source and target Contract visibility via RLS.

## Runtime surface, authority and locking

`lib/cash-application-repository.ts` wraps the existing `record_payment`, `request_refund`, `complete_refund`, plus `cash_application_command`, `cash_source_status`, and `cash_target_status`. Financial inputs/outputs use decimal strings and database `numeric(14,2)`. There is no JS money arithmetic, arbitrary transfer API or accounting FX.

`CASH_APPLICATION_MANAGER` is an entity-specific authority assignment approved through R5A. POSTING_AUTHORITY does not grant it. Database mutations require role/capability eligibility, active membership/designation, ACTIVE reporting profile, entity/workspace, source/target access and AAL2. The existing explicit Revenue workspace mismatch still fails closed.

Lock order: custody commands acquire the inherited workspace Revenue lock, recheck designation, lock the reporting profile, acquire the workspace cash-finance lock, then request receipt/source Payment, canonical terms/service and target Receivable/application scope. Normal trade receipt/refund calls acquire only the cash-finance lock before their existing row-lock path. Custody Refund approval acquires its locks before locking the generic Approval row. Canonical operational source rows are revalidated under locks.

This initial coarse financial lock prevents opposite source/target lock order from oversubscribing cash. It trades workspace financial write concurrency for correctness; finer locking is future optimization, not a second owner. Database unique constraints enforce source+intent identity separately from request receipts. Same key/changed payload and same intent/changed payload conflict. Existing commission domains do not acquire the new cash lock or receive an automatic cash-application event.

## Revenue independence and scenario proof

The disposable suite posts earned Revenue 100 without cash, receives custody 100, applies it to a real Receivable, reverses/releases portions and completes a Refund. Fact identity, count and amount stay unchanged. The cash-first scenario creates no candidate or fact until separate approved policy/binding and accepted fulfillment produce an approved candidate; later application still leaves recognized Revenue exactly 100.

Partial application (100 against 150) leaves outstanding 50. Split 60/40 exhausts source 100; another 1 fails. A full cash refund before earning cannot create recognition. Source 100 with pending Refund 40 has only 60 available; completion leaves the same capacity without double subtraction. Reversal 30 releases exactly 30 and replay does not release again.

## Verification

Local images were checked; tests use **postgres:18.4-bookworm**, not 18.6. Each run uses a random disposable container and password, tmpfs storage, loopback-only random port, a dedicated test database, no application `.env`/database and finally cleanup.

| Check | Result |
|---|---|
| R5E PostgreSQL | PASS: declaration/receipt, source and target ceilings, partial/split/reapply, reverse/replay, Refund reservations/completion/retry, currency/entity/workspace/RLS, authority/AAL, old approval denial, immutability, source/target changes, audit rollback and Revenue independence |
| Required races | PASS: application/application; refund reservation/application; direct trade settlement/application |
| Ordinary Payment/Refund focused regression | PASS: partial trade payment, overpayment rejection, approval/completion, paid/refunded state and receivable refresh |
| R5A / R5B PostgreSQL, unchanged | PASS / PASS |
| R5C PostgreSQL, unchanged | Known historical boundary failure: expects recognized fact table absent; pre-failure candidate financial/authority/health checks pass |
| R5D PostgreSQL, unchanged | Historical boundary failure at line 232: expects cash application table absent; prior posting/correction/cumulative/period/revocation assertions execute |
| R5D current-schema compatibility | PASS, explicitly authorized separate entry; no financial assertion changed and original file hash unchanged |
| Finance/Commission PostgreSQL | PASS: ordinary cash, refunds, settlement, currencies, race, RLS and retention |
| R5E static contracts | 6/6 PASS; combined current R5A–R5E runtime contracts: 21/21 PASS |
| Public privacy | 13/13 PASS |
| Typecheck / lint / build | PASS / PASS (zero warnings) / PASS; existing vinext route-classification notice only |
| Migration / byte protection / staging | PASS: head 119, 124 SQL; all opening 123 SQL unchanged; historical files unchanged; staging empty |
| Browser | NOT REQUIRED: runtime/read-model semantics only, no browser UI added |

The authorized `scripts/test-revenue-fact-current-compat-postgres.mjs` preserves the historical R5D file. It verifies the exact known absence assertion occurs once and replaces only that assertion with proof that migration 119 introduces `cash_applications` and migration 118 does not. The private generated copy and source/effective hashes are retained under `work/revenue-r5e/compatibility/`. The unchanged run is still reported as a failure, not relabeled PASS.

## Architecture deltas and limitations

- **R4_ARCHITECTURE_DELTA:** custody Payment has no trade Contract/schedule linkage. Its accepted terms are pinned on the declaration via an existing entity-scoped specified service. This keeps Payment canonical while avoiding fake obligations and legacy trade collection inflation.
- **R5_PLAN_DELTA:** declaration is atomic with canonical receipt creation; independently unclassified custody payments cannot commit. Declaration beneficiary/terms changes are not supported in place. Third-party beneficiary scenarios must fit the supported canonical Contract-buyer relationship; arbitrary unrelated party custody is not implemented.
- **R5D_INTEGRATION_DELTA:** authorized separate regression compatibility entry resolves the old phase-only cash-table absence assertion; migration 118 and the historical test remain unchanged.
- Existing custody terms and target-service scope are an explicit governed business interpretation, not machine certification of private legal terms. Only same-workspace/entity/currency customer receivables are supported. Removed targets must be restored/governed before further settlement; history stays retained.
- Receipt/performance/commission metrics remain receipt-based. Cash application does not manufacture a Payment event or automatic outbound Commission. Product-specific deposits, provider AP, intercompany netting, GL and FX conversion remain excluded.

## Mandatory acceptance answers

Implementation evidence: migration 119's `cash_application_command`, `cash_source_basis`, refund guards, `refresh_receivable`, purpose/immutability triggers, RLS and receipts. Runtime evidence: `scripts/test-cash-application-postgres.mjs`; ownership/absence invariants: `tests/cash-application-runtime.test.mjs`.

| Question | Answer and proof |
|---|---|
| Does application create cash? | NO — only the extended canonical receipt writer inserts Payment; APPLY references it |
| Does application create Revenue? | NO — fact/candidate counts and earned 100 remain unchanged |
| Does custody Payment create Revenue? | NO — cash-first receipt cannot evaluate without fulfillment |
| Custody without fake Receivable? | YES — Payment Contract/schedule are NULL and declaration pins real terms |
| Source cash over-applied? | NO — locked available balance and simultaneous 80/80 test |
| Refund reservation and application overuse cash? | NO — canonical reservation sum, refund guard and racing full-use test |
| Target over-settled? | NO — current paid state, direct/application race and altered-target test |
| Reversal releases exactly once? | YES — unreversed ceiling plus intent/request replay tests |
| Different currencies? | NO — declaration target and application currency checks |
| Cross reporting entity? | NO — scoped authority/source/service queries and composite FKs |
| Ordinary trade Payment unchanged? | YES — legacy signature and finance/commission plus focused partial/refund regression |
| Applied custody settles Receivable without second Revenue? | YES — applied 100, paid 100, Revenue still 100 |
| Outbound Commission automatically interacts? | NO — no application event is connected to commission; existing regression passes |
| Facts immutable during all cash operations? | YES — unchanged fact rows/amounts and full authorized R5D compatibility suite |

Cash Application ≠ Revenue recognition. Cash Application ≠ General Ledger. Custody Cash ≠ customer trade collection by default. Applied cash ≠ earned Revenue. R5E does not implement provider AP or accounting FX.

## Git boundary and verdict

Staging: EMPTY. Commit: NOT RUN. Push: NOT RUN. Deploy: NOT RUN. Production: NONE. No version promotion or shutdown.

R5E-specific runtime, exact cash ceilings, concurrency and Revenue-independence gates pass. R5A/B and financial regressions pass. The unchanged R5C/D stage-absence failures remain disclosed; the explicitly authorized R5D current-schema compatibility run passes in full. Test containers were removed by their finally cleanup; private final hashes and logs remain under ignored `work/revenue-r5e/`.

```text
REVENUE_R5E_CASH_APPLICATION_RUNTIME_COMPLETE
REVENUE_R5F_READ_UI_READY
```

```text
R5E Cash Application runtime complete
≠ Revenue UI complete

Revenue runtime complete
≠ General Ledger complete

Revenue runtime complete
≠ tenant accounting policy independently validated
```
