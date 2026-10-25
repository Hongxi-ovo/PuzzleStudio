import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {extractGrant,discoverGrants} from '../web/grant-effects.mjs';
import {newDocument,newCard,exportLua,parseDocument,physicalSlot} from '../web/model.mjs';
import {fieldMarkup,exDestination} from '../web/field-layout.mjs';
import {importLua} from '../web/lua-import.mjs';
const parser=createRequire(import.meta.url)('../web/vendor/luaparse.js');
const allSources=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const sources=allSources.filter(e=>[31772684,49394035,49477180,67267333,70491682].includes(e.code));
assert.equal(sources.length,5);
const cases=[];
const preamble=`Debug.ReloadFieldBegin(66,5)
Debug.SetPlayerInfo(0,8000,0,0)
Debug.SetPlayerInfo(1,8000,0,0)
local recipient=Debug.AddCard(4388680,0,0,LOCATION_MZONE,0,POS_FACEUP_ATTACK,true)
local opponent=Debug.AddCard(89631139,1,1,LOCATION_MZONE,0,POS_FACEUP_ATTACK,true)
local backrow=Debug.AddCard(83764718,1,1,LOCATION_SZONE,0,POS_FACEUP_ATTACK)
Debug.PreSummon(opponent,SUMMON_TYPE_SPECIAL)
`;
const intercept=`local effects={}
local register=Card.RegisterEffect
Card.RegisterEffect=function(card,e,forced)
  if card==recipient then effects[#effects+1]=e end
  return register(card,e,forced)
end
`;
for(const source of sources){
  const grant=extractGrant(source,parser);
  assert(!grant.lua.includes('function c'+source.code+'.initial_effect'));
  assert(!grant.lua.includes('SetCode(EVENT_BE_MATERIAL)'));
  const expected={49394035:'EFFECT_CANNOT_BE_EFFECT_TARGET',70491682:'EFFECT_BATTLE_DESTROY_REDIRECT',49477180:'EVENT_BATTLED',31772684:'EVENT_FREE_CHAIN',67267333:'EVENT_FREE_CHAIN'}[source.code];
  let checks=`Card.RegisterEffect=register
Debug.ReloadFieldEnd()
local found=nil
for _,e in ipairs(effects) do if e:GetCode()==${expected} then found=e end end
assert(found,"granted effect registered")
assert(found:GetOwner()==recipient,"effect owner is recipient")
assert(found:GetHandler()==recipient,"effect handler is recipient")
assert(found:GetCode()~=EVENT_BE_MATERIAL,"source material trigger not copied")
`;
  if(source.code===49394035)checks+=`assert(not found:GetValue()(found,nil,0),"own targeting allowed")
assert(found:GetValue()(found,nil,1),"opponent targeting blocked")
`;
  if(source.code===70491682)checks+='assert(found:GetValue()==LOCATION_REMOVED,"battle banish destination")\n';
  if([31772684,67267333].includes(source.code))checks+=`assert((found:GetType() & EFFECT_TYPE_QUICK_O)~=0,"quick effect")
assert(found:GetRange()==LOCATION_MZONE,"on-field range")
assert(found:CheckCountLimit(0),"initially unused")
assert(found:GetTarget()~=nil,"target callback retained")
found:UseCountLimit(0)
assert(not found:CheckCountLimit(0),"once per turn retained")
`;
  if(source.code===49477180)checks+='assert(found:GetOperation()~=nil,"battle draw/discard operation")\n';
  const lua=preamble+intercept+'do local c=recipient\n'+grant.lua+'\nend\n'+checks+'aux.BeginPuzzle()\n';
  parser.parse(lua,{luaVersion:'5.3'});cases.push({name:'extracted-source-'+source.code,lua});
  // Compare the exact same checks against the real source material operation.
  const baseline=preamble+`local material=Debug.AddCard(${source.code},0,0,LOCATION_GRAVE,0,POS_FACEUP_ATTACK)\nlocal materialEffect=Effect.CreateEffect(material)\n`+intercept+`c${source.code}.mtop(materialEffect,0,Group.FromCards(recipient),0,0,nil,REASON_RITUAL,0)\n`+checks+'aux.BeginPuzzle()\n';
  cases.push({name:'original-material-grant-'+source.code,lua:baseline});
}
const d=newDocument();d.cards=[newCard(89631139,0,'mzone')];d.cards[0].grants=sources.map(s=>extractGrant(s,parser));
const saved=parseDocument(JSON.stringify(d));assert.equal(saved.cards[0].grants.length,5);assert.equal(saved.cards[0].grants[0].sourceHash,sources[0].hash);
const normal=exportLua(saved);parser.parse(normal,{luaVersion:'5.3'});cases.push({name:'all-five-grants-on-normal-monster',lua:normal});
const imported=importLua('Debug.ReloadFieldBegin(66,5)\nlocal m=Debug.AddCard(89631139,0,0,LOCATION_MZONE,0,POS_FACEUP_ATTACK)\nDebug.ReloadFieldEnd()\naux.BeginPuzzle()','granted import',parser);imported.cards[0].grants=[extractGrant(sources.find(x=>x.code===49394035),parser)];
cases.push({name:'imported-puzzle-with-extracted-grant',lua:exportLua(parseDocument(JSON.stringify(imported))).replace('aux.BeginPuzzle()','assert(m:IsHasEffect(EFFECT_CANNOT_BE_EFFECT_TARGET),"imported grant")\naux.BeginPuzzle()')});
const removed=newDocument();removed.cards=[newCard(89631139,0,'removed'),newCard(46986414,0,'removed'),newCard(89631139,1,'removed')];removed.cards[1].position=8;
cases.push({name:'both-players-faceup-facedown-banished',lua:exportLua(parseDocument(JSON.stringify(removed))).replace('aux.BeginPuzzle()','assert(c1:IsFaceup() and c2:IsFacedown() and c3:IsFaceup(),"banished faces")\nassert(c1:GetControler()==0 and c2:GetControler()==0 and c3:GetControler()==1,"banished ownership")\naux.BeginPuzzle()')});
// Layout has seven cells per row and EX overlays main columns 2 and 4.
const markup=fieldMarkup(5,(p,z,s)=>`<i data-player="${p}" data-zone="${z}" data-seq="${s}"></i>`,(p,z)=>`<i data-player="${p}" data-zone="${z}"></i>`);
const cells=[...markup.matchAll(/<(?:div|i)\b[^>]*>[^<]*<\/(?:div|i)>/g)].map(m=>m[0]);
const opRemoved=cells.findIndex(x=>x.includes('data-player="1"')&&x.includes('data-zone="removed"')),myRemoved=cells.findIndex(x=>x.includes('data-player="0"')&&x.includes('data-zone="removed"'));
assert.equal(opRemoved%7,0);assert.equal(myRemoved%7,6);assert(myRemoved>opRemoved);
assert.equal(cells.findIndex(x=>x.includes('data-seq="5"'))%7,2);assert.equal(cells.findIndex(x=>x.includes('data-seq="6"'))%7,4);
assert.equal(physicalSlot(exDestination(5,1),5),physicalSlot(exDestination(5,0),5));
// Verify every automatically extracted Lua fragment or real-overlay plan.
const discovered=[];
for(const entry of allSources){
  const result=discoverGrants(entry,parser);
  for(const grant of result.grants){
    let lua='Debug.ReloadFieldBegin(66,5)\nDebug.SetPlayerInfo(0,8000,0,0)\nDebug.SetPlayerInfo(1,8000,0,0)\n';
    if(grant.mode==='overlay')lua+=`local c=Debug.AddCard(581014,0,0,LOCATION_MZONE,0,POS_FACEUP_ATTACK,true)\nDebug.AddCard(${entry.code},0,0,LOCATION_MZONE,0,POS_FACEUP_ATTACK)\n`;
    else lua+=`local c=Debug.AddCard(4388680,0,0,LOCATION_MZONE,0,POS_FACEUP_ATTACK,true)\ndo\n${grant.lua}\nend\n`;
    lua+='Debug.ReloadFieldEnd()\naux.BeginPuzzle()';parser.parse(lua,{luaVersion:'5.3'});
    cases.push({name:'automatic-'+grant.sourceKey,lua});discovered.push({code:entry.code,key:grant.sourceKey,mode:grant.mode});
  }
}
assert(discovered.length>100,'must scan more than a short allow-list');assert(discovered.some(g=>g.code===65741786));
// I:P only protects against the opposing player, including on opponent cards.
for(const player of [0,1]){
  const ip=extractGrant(allSources.find(e=>e.code===65741786),parser);
  const lua=`Debug.ReloadFieldBegin(66,5)\nlocal c=Debug.AddCard(1861629,${player},${player},LOCATION_MZONE,0,POS_FACEUP_ATTACK,true)\n${ip.lua}\nDebug.ReloadFieldEnd()\nlocal protection=c:IsHasEffect(EFFECT_INDESTRUCTABLE_EFFECT)\nassert(protection, "IP granted protection")\nassert(not protection:GetValue()(protection,nil,${player}),"IP allows own effect destruction")\nassert(protection:GetValue()(protection,nil,${1-player}),"IP prevents opponent effect destruction")\naux.BeginPuzzle()`;
  cases.push({name:'ip-opponent-only-protection-player-'+player,lua});
}
fs.writeFileSync(process.argv[3],JSON.stringify(cases));console.log(`${cases.length} grant, overlay and banishment probes generated.`);
