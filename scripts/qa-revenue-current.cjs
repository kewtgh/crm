/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS adapter for the pinned browser runner. */
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const Module=require('node:module');
// Add closure coverage without rewriting the historical 18-check browser suite.
const filename=path.resolve('scripts/qa-revenue-workspace.cjs');
const original=fs.readFileSync(filename,'utf8');
const anchor="  report.revenueMutations=writes.map";
assert.equal(original.split(anchor).length,2);
const checks=`
  await page.getByRole('button',{name:'QA English'}).click();
  await tab('Cash / custody');
  await page.getByRole('button',{name:'Release applied cash',exact:true}).click();
  dialog=page.getByRole('dialog');await dialog.getByLabel('Application to release').selectOption({index:1});
  await dialog.getByLabel('Amount',{exact:true}).fill('10.00');await dialog.getByLabel('Decision / business reference').fill('EX-RELEASE');
  await shot('cash-release-confirmation',{releaseNotRefund:true,noRevenueAmount:true});
  await dialog.getByRole('button',{name:'Confirm',exact:true}).click();await dialog.waitFor({state:'hidden'});
  assert.equal(writes.at(-1).command,'REVERSE');assert.equal(data.recognized[0].amount,'480.00');
  assert.equal(data.cash[0].available,'40.00');await shot('cash-release-accepted',{revenueUnchanged:true,capacityReleased:true});
`;
const effective=original.replace("if(payload.operation==='cash'){","if(payload.operation==='cash'&&payload.command==='REVERSE'){data.cash[0].applied='60.00';data.cash[0].available='40.00';data.contracts[0].collected='700.00';data.contracts[0].applied_cash='60.00';data.contracts[0].outstanding='300.00';} else if(payload.operation==='cash'){")
 .replace(anchor,checks+anchor);
const compiled=new Module(filename,module);compiled.filename=filename;compiled.paths=module.paths;compiled._compile(effective,filename);
module.exports=async args=>{try{return await compiled.exports(args);}finally{assert.equal(fs.readFileSync(filename,'utf8'),original);}};
