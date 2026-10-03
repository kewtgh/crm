import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {createOpportunitySchema,transitionOpportunitySchema} from '../lib/opportunity-schema.ts';
import {businessFieldsSchema} from '../lib/education-business.ts';
import {contractEnrollmentMutationSchema} from '../lib/contract-enrollment-input.ts';
import {listContractEnrollmentLinks,mutateContractEnrollment} from '../lib/contract-enrollment-repository.ts';
import {listProductCohorts,getProductCohort} from '../lib/cohort-repository.ts';
import {contractEnrollmentPrivacyRecords} from '../scripts/lib/contract-enrollment-privacy-export.mjs';
import {enCommercialLinks,zhCommercialLinks} from '../lib/i18n/locales/commercial-links.ts';
import {presentApiError} from '../lib/api-error-presenter.ts';
import {ApiClientError} from '../lib/api-client.ts';
const product=randomUUID(),cohort=randomUUID();
test('Opportunity cohort is optional, requires product and strict commercial revision/request input',()=>{
 const data={subjectType:'SCHOOL',organizationId:randomUUID(),titleZh:'商机',titleEn:'Opportunity',stage:'DISCOVERY',amount:0,currency:'CNY',probability:20,expectedCloseDate:'2027-01-01',nextActionZh:'联系',nextActionEn:'Contact'};
 assert(createOpportunitySchema.safeParse(data).success);assert(createOpportunitySchema.safeParse({...data,productId:product,cohortId:cohort}).success);assert(!createOpportunitySchema.safeParse({...data,cohortId:cohort}).success);
 const update={...data,commercialContext:{productId:product,cohortId:cohort},expectedRevision:2,requestKey:randomUUID()};assert(transitionOpportunitySchema.safeParse(update).success);
 for(const patch of [{expectedRevision:undefined},{requestKey:undefined},{expectedRevision:0},{commercialContext:{productId:null,cohortId:cohort}}])assert(!transitionOpportunitySchema.safeParse({...update,...patch}).success);
 assert(!transitionOpportunitySchema.safeParse({stage:'WON',probability:100}).success);
});
test('Event generic/product/cohort contexts keep independent campaign and reject parentless cohort',()=>{
 const data={name:'Session',organization_id:randomUUID(),partner_organization_id:null,kind:'SEMINAR',starts_on:'2027-01-01',ends_on:'2027-01-01',location:'',capacity:null,attendee_count:null,status:'DRAFT',next_action:''};
 const schema=businessFieldsSchema('events');assert.equal(schema.parse(data).cohort_id,null);assert(schema.safeParse({...data,campaign_id:randomUUID(),product_id:product}).success);assert(schema.safeParse({...data,product_id:product,cohort_id:cohort}).success);assert(!schema.safeParse({...data,cohort_id:cohort}).success);
});
test('Cohort suggestions filter by use while historical lookup remains unfiltered',async()=>{
 const paths=[],json=async path=>{paths.push(new URL(path,'http://local'));return [];};
 await listProductCohorts(product,{usage:'OPPORTUNITY'},json);await listProductCohorts(product,{usage:'QUOTE'},json);await listProductCohorts(product,{usage:'EVENT'},json);await getProductCohort(cohort,json);
 assert.equal(paths[0].searchParams.get('status'),'in.(DRAFT,RECRUITING,CLOSED,ACTIVE)');assert.equal(paths[1].searchParams.get('status'),'in.(RECRUITING,ACTIVE)');assert.equal(paths[2].searchParams.get('status'),null);assert.equal(paths[3].searchParams.get('id'),'eq.'+cohort);assert.equal(paths[3].searchParams.get('status'),null);
});
test('Contract link/unlink requests preserve retry identities and require unlink revision/reason',async()=>{
 const id=randomUUID(),contract=randomUUID(),input={operation:'link',id,enrollmentId:randomUUID(),requestKey:randomUUID()},calls=[];
 const json=async(path,init)=>{calls.push([path,JSON.parse(init.body)]);return {};};assert(contractEnrollmentMutationSchema.safeParse(input).success);await mutateContractEnrollment(contract,input,json);await mutateContractEnrollment(contract,input,json);assert.deepEqual(calls[0],calls[1]);assert.equal(calls[0][1].target_contract,contract);
 const unlink={operation:'unlink',id,expectedRevision:1,reason:'Corrected link',requestKey:randomUUID()};assert(contractEnrollmentMutationSchema.safeParse(unlink).success);await mutateContractEnrollment(contract,unlink,json);assert.equal(calls[2][1].expected_revision,1);
 for(const patch of [{reason:' '},{expectedRevision:0},{requestKey:''}])assert(!contractEnrollmentMutationSchema.safeParse({...unlink,...patch}).success);assert(!contractEnrollmentMutationSchema.safeParse({...input,operation:'delete'}).success);
 const paths=[];await listContractEnrollmentLinks({contractId:contract,page:2},async path=>{paths.push(new URL(path,'http://local'));return [];});assert.equal(paths[0].searchParams.get('offset'),'20');assert.equal(paths[0].searchParams.get('contract_id'),'eq.'+contract);
});
test('Privacy relation export is scoped and includes soft history without fetching financial master records',async()=>{
 const ws=randomUUID(),enrollment=randomUUID(),row={id:randomUUID(),workspace_id:ws,enrollment_id:enrollment,status:'UNLINKED'};
 let path;assert.deepEqual(await contractEnrollmentPrivacyRecords(async p=>{path=p;return [row];},ws,[enrollment]),[row]);assert(path.startsWith('/db/table/contract_enrollment_links?'));assert.deepEqual(await contractEnrollmentPrivacyRecords(()=>{throw Error('empty');},ws,[]),[]);
 await assert.rejects(contractEnrollmentPrivacyRecords(async()=>[{...row,workspace_id:randomUUID()}],ws,[enrollment]),/scope mismatch/);await assert.rejects(contractEnrollmentPrivacyRecords(async()=>[],ws,['name']),/Invalid/);
});
test('Commercial validation, conflicts and feedback have matching bilingual coverage',()=>{
 assert.deepEqual(Object.keys(enCommercialLinks).sort(),Object.keys(zhCommercialLinks).sort());
 for(const [code,key] of [['COMMERCIAL_VERSION_CONFLICT','commercial.versionConflict'],['COMMERCIAL_EVENT_MISMATCH','commercial.mismatch'],['COMMERCIAL_LINK_FORBIDDEN','commercial.forbidden'],['COMMERCIAL_QUOTE_LOCKED','commercial.quoteLocked']])for(const messages of [enCommercialLinks,zhCommercialLinks])assert.equal(presentApiError(new ApiClientError(code,409),k=>messages[k],'commercial.saveFailed').message,messages[key]);
});
