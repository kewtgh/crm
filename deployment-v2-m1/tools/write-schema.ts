import fs from 'node:fs';
import { reportSchema } from '../src/report-schema.ts';
fs.mkdirSync(new URL('../schemas/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('../schemas/diagnostics-v1.schema.json', import.meta.url), `${JSON.stringify(reportSchema, null, 2)}\n`);
