#!/usr/bin/env node
'use strict';
const fs=require('node:fs');const path=require('node:path');
const output=process.argv[2];if(!output)throw new Error('Usage: node build-office-scripts.cjs IGNORED_OUTPUT_DIRECTORY');
const target=path.resolve(output);const root=path.resolve(__dirname,'../..');
if(!target.startsWith(path.join(root,'.netlify')+path.sep))throw new Error('Use an ignored .netlify output directory; generated scripts do not belong in Git');
fs.mkdirSync(target,{recursive:true});
const writer=fs.readFileSync(path.join(__dirname,'office-script.ts'),'utf8');
const bootstrap=writer.slice(0,writer.indexOf('function main(workbook:'))+fs.readFileSync(path.join(__dirname,'bootstrap-main.ts'),'utf8');
fs.writeFileSync(path.join(target,'PoseTek-upsert.ts'),writer);fs.writeFileSync(path.join(target,'PoseTek-bootstrap.ts'),bootstrap);
console.log(JSON.stringify({candidateOnly:true,files:['PoseTek-upsert.ts','PoseTek-bootstrap.ts'],output:target}));
