import test from 'node:test';
import assert from 'node:assert/strict';
import {workflowPresets,workflowPresetData} from '../lib/workflow-presets.ts';
import {workflowTemplateDataSchema} from '../lib/workflow-input.ts';
import {buildV2Csv,buildV2Xlsx} from '../lib/import-v2-template.ts';
import {buildSetTemplate} from '../lib/import-set-template.ts';
import {v2Headers,validateV2Headers} from '../lib/import-v2.ts';
import {setHeaders,validateSetHeaders} from '../lib/import-set-contract.ts';
import {normalizeLocalizedImport,localizedImportHeader} from '../lib/import-localized-headers.ts';
import {parseCsvDocument} from '../lib/csv.ts';
import {normalizeImportSheet} from '../lib/import-sheet.ts';
import {readSheet} from 'read-excel-file/node';
import {visibleDestinations,activeDestination} from '../lib/navigation-destinations.ts';

test('two editable bilingual presets create independent validated step identities',()=>{
 assert.equal(workflowPresets.length,2);
 for(const preset of workflowPresets){const a=workflowTemplateDataSchema.parse(workflowPresetData(preset.key)),b=workflowPresetData(preset.key);assert.ok(a.steps.every(step=>step.name_zh&&step.name_en));assert.ok(a.steps.every((step,i)=>step.id!==b.steps[i].id));}
});
test('localized CSV and XLSX headers normalize to exactly the same v2 protocol',async()=>{
 for(const locale of ['zh-CN','en']){
  const csv=parseCsvDocument(buildV2Csv('CONTACTS','example',locale));
  assert.equal(csv.headers[0],localizedImportHeader('operation',locale));
  const canonical=normalizeLocalizedImport(csv,v2Headers('CONTACTS'));validateV2Headers('CONTACTS',canonical.headers);
  const sheet=await readSheet(await buildV2Xlsx('CONTACTS','example',locale),'Data',{parseNumber:value=>value});
  assert.deepEqual(normalizeLocalizedImport(normalizeImportSheet(sheet),v2Headers('CONTACTS')).rows,canonical.rows);
 }
});
test('localized import sets retain references and reject duplicate aliases',async()=>{
 for(const locale of ['zh-CN','en']){
  const parsed=parseCsvDocument(await buildSetTemplate('HOUSEHOLD_MEMBERS','example','csv',locale));
  const normalized=normalizeLocalizedImport(parsed,setHeaders('HOUSEHOLD_MEMBERS'));validateSetHeaders('HOUSEHOLD_MEMBERS',normalized.headers);
  assert.equal(normalized.rows[0].operation,'CREATE');assert.ok(normalized.rows[0].householdReference);
 }
 assert.throws(()=>normalizeLocalizedImport({headers:['operation',localizedImportHeader('operation','zh-CN')],rows:[]},['operation']),/TEMPLATE_SCHEMA_INVALID/);
 const unknown=normalizeLocalizedImport({headers:['Untrusted [operation]'],rows:[]},v2Headers('CONTACTS'));
 assert.throws(()=>validateV2Headers('CONTACTS',unknown.headers),/UNKNOWN_COLUMN/);
});
test('AI and automation share one capability-aware navigation destination',()=>{
 for(const role of ['ADMIN','SUPER_ADMIN','SALES_MANAGER','SALES_SPECIALIST','SALES_SUPPORT']){
  const entries=visibleDestinations(role),assist=entries.filter(entry=>entry.id==='assistance');assert.ok(assist.length<=1);
  if(assist.length){for(const path of ['/ai','/automation'])assert.equal(activeDestination(path,new URLSearchParams(),entries)?.id,'assistance');}
 }
});
