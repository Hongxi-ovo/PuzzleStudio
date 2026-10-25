import fs from 'node:fs';
import {createRequire} from 'node:module';
import {importLua} from '../web/lua-import.mjs';
import {exportLua,parseDocument,validate} from '../web/model.mjs';
const parser=createRequire(import.meta.url)('../web/vendor/luaparse.js');
const input=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const catalog=new Map(input.cards.map(c=>[c.id,c]));
const cases=[];
for(const file of input.files){
  try{
    const doc=importLua(file.source,file.name,parser);
    const check=validate(doc,catalog);
    if(check.errors.length)throw Error(check.errors.join('\n'));
    const saved=parseDocument(JSON.stringify(doc),catalog);
    const lua=exportLua(saved,catalog);
    parser.parse(lua,{luaVersion:'5.3'});
    cases.push({name:file.name,original:file.source,exported:lua,cards:doc.cards.length,rawStatements:doc.sourceMap.unhandled.length,warnings:check.warnings,ok:true});
  }catch(error){cases.push({name:file.name,original:file.source,ok:false,error:error.message});}
}
fs.writeFileSync(process.argv[3],JSON.stringify(cases));
console.log(JSON.stringify({total:cases.length,passed:cases.filter(c=>c.ok).length,failed:cases.filter(c=>!c.ok).map(c=>({name:c.name,error:c.error}))},null,2));
