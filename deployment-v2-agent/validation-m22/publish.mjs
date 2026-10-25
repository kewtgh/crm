import fs from 'node:fs';
import { evidenceDirectory, readPrivateJson, writeEvidenceJson } from '../../scripts/lib/public-ci-artifacts.mjs';
import { initial, sourceDigest, summary } from './contract.mjs';
const root = process.cwd(), context = { sha: process.env.GITHUB_SHA, runId: process.env.GITHUB_RUN_ID,
  attempt: process.env.GITHUB_RUN_ATTEMPT, profile: process.env.M22_PROFILE };
const raw = readPrivateJson(evidenceDirectory(root, 'ci-private'), 'm22-report.json') ?? initial({ ...context, sourceDigest: sourceDigest(root) });
const output = evidenceDirectory(root, 'public-artifacts');
if (fs.existsSync(`${output}/deployment-v2-rootless-summary.json`)) throw new Error('OUTPUT_EXISTS');
writeEvidenceJson(output, 'deployment-v2-rootless-summary.json', summary(raw, context));
console.log('M22_REVIEWED_SUMMARY_READY');
