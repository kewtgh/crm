import {runManagementIntegration} from './test-management-intelligence-postgres.mjs';
import {projectManagementOverview} from '../lib/management-overview-projection.ts';
import {validateOverview} from '../lib/management-ux-presentation.ts';

await runManagementIntegration(async({client,context,ws,otherWs,admin,sales,stranger})=>{
 for(const [actor,workspace] of [[admin,ws],[sales,ws],[stranger,otherWs]]) {
  await context(actor,workspace);
  for(const filters of [{},{from:'2026-01-01',to:'2026-12-31'},{from:'2020-01-01',to:'2020-01-01'}]) {
   const raw=(await client.query('select public.management_overview_filtered($1) x',[filters])).rows[0].x;
   validateOverview(projectManagementOverview(raw));
  }
 }
 await context();
 console.log('PASS current management projection/validator: manager, restricted seller, empty foreign workspace, default and explicit date filters');
});
