import fs from 'node:fs';
import path from 'node:path';
import { evidenceDirectory, readPrivateJson, writeEvidenceJson } from '../../scripts/lib/public-ci-artifacts.mjs';
import { emptyReport, publicSummary, sourceDigest } from './contract.mjs';

const root = process.cwd();
const context = { sha: process.env.GITHUB_SHA, runId: process.env.GITHUB_RUN_ID,
  attempt: process.env.GITHUB_RUN_ATTEMPT, sourceDigest: sourceDigest(root) };
const privateDir = evidenceDirectory(root, 'ci-private');
const raw = readPrivateJson(privateDir, 'deployment-v2-validation.json') ?? emptyReport(context);
const summary = publicSummary(raw, context);
const output = evidenceDirectory(root, 'public-artifacts');
const file = path.join(output, 'deployment-v2-validation-summary.json');
if (fs.existsSync(file)) throw new Error('PUBLIC_OUTPUT_ALREADY_EXISTS');
writeEvidenceJson(output, 'deployment-v2-validation-summary.json', summary);
console.log('DEPLOYMENT_VALIDATION_SUMMARY_READY');
