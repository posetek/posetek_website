#!/usr/bin/env node
"use strict";
const fs=require("node:fs"),path=require("node:path"),{createHash}=require("node:crypto"),{execFileSync}=require("node:child_process");
const root=path.resolve(__dirname,"../.."),input=path.join(root,"functions"),target=process.argv[2];
if(!target||!path.isAbsolute(target)||fs.existsSync(target))throw Error("Provide a new absolute private output directory");
fs.mkdirSync(target,{recursive:true,mode:0o700});const source=path.join(target,"source");fs.mkdirSync(source,{mode:0o700});
const files={};
function copy(name){
 if(files[name])return;
 const from=path.resolve(input,name);if(!from.startsWith(input+path.sep)||fs.lstatSync(from).isSymbolicLink())throw Error("Unsafe dependency path");
 const bytes=fs.readFileSync(from),to=path.join(source,name);fs.mkdirSync(path.dirname(to),{recursive:true});fs.writeFileSync(to,bytes);
 files[name]={sha256:createHash("sha256").update(bytes).digest("hex"),bytes:bytes.length};
 if(name.endsWith(".js"))for(const match of bytes.toString().matchAll(/require\(["'](\.\/[^"']+)["']\)/g)){let dep=path.join(path.dirname(name),match[1]);if(!path.extname(dep))dep+=".js";copy(dep);}
}
for(const file of ["device-processing.js","package.json","package-lock.json"])copy(file);
const entry=fs.readFileSync(path.join(__dirname,"index.js"));fs.writeFileSync(path.join(source,"index.js"),entry);files["index.js"]={sha256:createHash("sha256").update(entry).digest("hex"),bytes:entry.length};
fs.writeFileSync(path.join(source,".gcloudignore"),".gcloudignore\nnode_modules/\n");
const manifest={project:"kickai-69dd0",region:"us-central1",sourceCommit:execFileSync("git",["rev-parse","HEAD"],{cwd:root,encoding:"utf8"}).trim(),files,endpoints:["getDeviceProcessingV1","observeDeviceProcessingManifest"],runtime:"nodejs22",memory:"512MB",timeoutSeconds:120,callableMaxInstances:10,observerMaxInstances:5};
fs.writeFileSync(path.join(target,"manifest.json"),JSON.stringify(manifest,null,2)+"\n",{mode:0o600});console.log(JSON.stringify({source,files:Object.keys(files).length,endpoints:manifest.endpoints}));
