import { CHECK_IDS, CODES } from './diagnostics.ts';
import { ERRNOS } from './observation.ts';
import { SECURITY_FIELDS } from './compose.ts';

const enumeration = (values: readonly string[]) => ({ type: 'string', enum: values });
const object = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({ type: 'object', additionalProperties: false, properties, required });
const integer = (maximum: number) => ({ type: 'integer', minimum: 0, maximum });
const version = { type: 'string', maxLength: 24, pattern: '^\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}$' };
const nullable = (value: object) => ({ anyOf: [value, { type: 'null' }] });
const array = (items: object, maximum: number) => ({ type: 'array', maxItems: maximum, items });
const status = enumeration(['PASS', 'FAIL', 'UNKNOWN', 'NOT_RUN']);
export const reportSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://example.invalid/lumina/m1/diagnostics-v1.schema.json',
  ...object({
    schemaVersion: { const: 1 }, kind: { const: 'lumina.deployment.diagnostics' },
    tool: object({ version: { const: '0.1.0-experimental' }, releaseDigest: { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' }, policyVersion: { const: 1 }, productionApproved: { const: false }, provenance: { const: 'UNATTESTED_M1' } }),
    capture: object({ at: { type: 'string', maxLength: 24, pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$' }, durationMs: integer(45_000), readOnly: { const: true }, networkMode: { const: 'NONE' }, scope: { const: 'NONPRODUCTION_TEST' }, complete: { type: 'boolean' } }),
    subject: { type: 'string', pattern: '^host-[a-f0-9-]{36}$', maxLength: 41 },
    versions: array(object({ component: enumeration(['node', 'docker', 'compose', 'buildx']), status, version: nullable(version) }), 4),
    checks: array(object({ checkId: enumeration(CHECK_IDS), status, severity: enumeration(['BLOCKING', 'WARNING']), code: enumeration(CODES), stage: enumeration(['PLATFORM', 'READ_METADATA', 'EXECUTE', 'PARSE', 'EVALUATE']), dependsOn: array(enumeration(CHECK_IDS), 8), expected: { type: 'null' }, observed: nullable(object({ matches: { type: 'boolean' }, available: { type: 'boolean' }, version, installed: { type: 'boolean' }, active: { type: 'boolean' }, mismatches: array(enumeration(SECURITY_FIELDS), 14), state: enumeration(['active', 'inactive', 'failed', 'activating', 'deactivating', 'unknown']) }, [])), exitCode: nullable(integer(255)), errno: nullable(enumeration(ERRNOS)), durationMs: integer(45_000), remediationId: enumeration(['REVIEW_PROJECT_SCOPE', 'RESOLVE_DEPENDENCY_FIRST', 'REVIEW_OBSERVATION']) }), 128),
    state: object({ source: { const: 'UNAVAILABLE' } }),
    capabilities: array(object({ id: enumeration(['oneshot.lifecycle', 'rootless.limits', 'storage.power-loss', 'memory.hard-rss']), requiredLayer: enumeration(['L2', 'L3']), result: { const: 'NOT_RUN' }, reason: { const: 'OUTSIDE_READ_ONLY_SCOPE' } }), 4),
    compatibilityCertified: { const: false },
    summary: object({ pass: integer(128), fail: integer(128), unknown: integer(128), notRun: integer(128), blocking: array(enumeration(CHECK_IDS), 128), partialReason: nullable({ const: 'OBSERVATIONS_INCOMPLETE' }) }),
    redaction: object({ profileVersion: { const: 1 }, pseudonyms: { const: 'PER_REPORT' }, rawIncluded: { const: false }, omitted: array(enumeration(['PATHS', 'UIDS', 'RAW_OUTPUT', 'ENVIRONMENT', 'HOST_IDENTITY']), 5) }),
    budget: object({ deadlineMs: { const: 45_000 }, outputBytesMaximum: { const: 1_048_576 }, observedPeakRssBytes: integer(134_217_728), rssLimitBytes: { const: 134_217_728 }, hardRssLimit: { const: false } }),
  }),
};
