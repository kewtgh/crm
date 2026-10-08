import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {navigationDestinations} from '../lib/navigation-destinations.ts';
import {destinationIconNames,destinationIcon,workspaceLinkIcon} from '../lib/workspace-visuals.ts';
import {uiIcons} from '../components/ui-icon.tsx';
import {WorkspaceHeading,WorkspaceIconContext} from '../components/workspace-heading.tsx';
test('every canonical navigation destination has an intentional semantic icon',()=>{
 assert.deepEqual(Object.keys(destinationIconNames).sort(),navigationDestinations.map(d=>d.id).sort());
 for(const d of navigationDestinations){assert.ok(uiIcons[destinationIcon(d.id)]);assert.equal(workspaceLinkIcon(d.href),destinationIcon(d.id));}
});
test('headings preserve h1 and text while decorative icons follow each destination',()=>{
 for(const d of navigationDestinations){const html=renderToStaticMarkup(React.createElement(WorkspaceIconContext.Provider,{value:destinationIcon(d.id)},React.createElement(WorkspaceHeading,{id:'heading'},'Fictional workspace')));assert.match(html,/<h1[^>]*id="heading"/);assert.ok(html.includes('Fictional workspace'));assert.ok(html.includes('data-icon="'+destinationIcon(d.id)+'"'));assert.match(html,/aria-hidden="true"/);}
});
test('all operational component h1 headings use the shared heading or existing record avatar',()=>{
 const exceptions=new Set(['workspace-heading.tsx','record-header.tsx','auth-form.tsx','device-verification-form.tsx','first-login-security.tsx','password-reset-forms.tsx','public-portal-page.tsx','data-state.tsx']);
 for(const file of readdirSync('components').filter(f=>f.endsWith('.tsx')&&!exceptions.has(f)))assert.doesNotMatch(readFileSync('components/'+file,'utf8'),/<h1[ >]/,file);
 const css=readFileSync('app/workspace-theme.css','utf8');for(const space of ['relationships','students','commercial','management','governance','admin','account'])assert.ok(css.includes('data-workspace-space='+space));
 assert.doesNotMatch(css,/\.status-badge|\.danger-button|(?:^|[;{])content:/);
});
