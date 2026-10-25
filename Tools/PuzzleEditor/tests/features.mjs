import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {newDocument,newCard,physicalSlot,validate,exportLua,parseDocument,luaString,removeCard} from '../web/model.mjs';
import {importLua} from '../web/lua-import.mjs';
import {prepareCardScripts,cardScripts,scriptValue} from '../web/lua-card-scripts.mjs';
const parser=createRequire(import.meta.url)('../web/vendor/luaparse.js');
const catalog=new Map(JSON.parse(fs.readFileSync(process.argv[2],'utf8')).cards.map(c=>[c.id,c]));
const corpus=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const cases=[];
function probe(name,document,assertions){const lua=exportLua(document,catalog);parser.parse(lua,{luaVersion:'5.3'});cases.push({name,lua:lua.replace('aux.BeginPuzzle()',assertions+'\naux.BeginPuzzle()')});}
assert.equal(physicalSlot({controller:0,zone:'mzone',seq:5},5),physicalSlot({controller:1,zone:'mzone',seq:6},5));
const conflict=newDocument();conflict.cards=[newCard(89631139,0,'mzone',5),newCard(46986414,1,'mzone',6)];assert(validate(conflict,catalog).errors.some(e=>e.includes('同一格')));
const pconflict=newDocument();pconflict.cards=[newCard(16178681,0,'pzone',0),newCard(83764718,0,'szone',0)];assert(validate(pconflict,catalog).errors.length);
const link=newDocument();link.cards=[newCard(1861629,0,'mzone',0)];link.cards[0].position=4;assert(validate(link,catalog).errors.length);
const d=newDocument();d.title='属性与抗性';const c=newCard(89631139,0,'mzone',0);c.overrides={baseAttack:3500,attack:4200,attribute:32,race:1,level:7};c.protections={battle:true,effect:true,target:true,immune:true};c.unnegatable=true;d.cards=[c];
probe('attribute-and-protection',d,`assert(c1:GetAttack()==4200,"attack")\nassert(c1:GetBaseAttack()==3500,"base attack")\nassert(c1:GetAttribute()==32,"attribute")\nassert(c1:GetOriginalAttribute()==16,"original attribute unchanged")\nassert(c1:GetRace()==1,"race")\nassert(c1:GetLevel()==7,"level")\nassert(c1:IsHasEffect(EFFECT_INDESTRUCTABLE_EFFECT),"effect protection")\nassert(c1:IsHasEffect(EFFECT_INDESTRUCTABLE_BATTLE),"battle protection")\nassert(c1:IsHasEffect(EFFECT_CANNOT_BE_EFFECT_TARGET),"target protection")\nassert(c1:IsHasEffect(EFFECT_IMMUNE_EFFECT),"immunity")`);
for(const rule of [3,4,5]){const doc=newDocument();doc.rule=rule;doc.cards=[newCard(16178681,0,'pzone',0),newCard(16178681,0,'pzone',1)];probe('pendulum-rule-'+rule,doc,`assert(c1:GetSequence()==${rule===3?6:0},"left pendulum")\nassert(c2:GetSequence()==${rule===3?7:4},"right pendulum")`);}
const overlay=newDocument();overlay.cards=[newCard(581014,0,'mzone',0),newCard(46986414,0,'overlay',0)];overlay.cards[1].overlayOf=overlay.cards[0].uid;probe('xyz-material',overlay,'assert(c1:GetOverlayCount()==1,"overlay")');
// Materials keep their original card type, including spells and traps.
for(const player of [0,1]){
  const mixed=newDocument(),host=newCard(581014,player,'mzone',2);
  mixed.cards=[host,...[46986414,12580477,97077563].map(code=>{
    const material=newCard(code,player,'overlay');material.owner=1-player;material.overlayOf=host.uid;return material;
  })];
  const saved=parseDocument(JSON.stringify(mixed),catalog);
  const assertions=`assert(c1:GetOverlayCount()==3,"mixed material count")\n`+saved.cards.slice(1).map((material,i)=>`assert(c${i+2}:GetLocation()==LOCATION_OVERLAY,"material location")\nassert(c${i+2}:GetOverlayTarget()==c1,"material host")\nassert(c${i+2}:GetOriginalType()==${catalog.get(material.code).type},"original card type")\nassert(c${i+2}:GetOwner()==${1-player},"material owner")`).join('\n');
  probe('xyz-mixed-materials-player-'+player,saved,assertions);
  const reopened=parseDocument(JSON.stringify(importLua(exportLua(saved,catalog),'mixed materials',parser)),catalog);
  assert.deepEqual(reopened.cards.slice(1).map(c=>[c.code,c.zone,c.owner,c.controller,c.overlayOf===reopened.cards[0].uid]),saved.cards.slice(1).map(c=>[c.code,c.zone,c.owner,c.controller,true]));
  probe('imported-xyz-mixed-materials-player-'+player,reopened,assertions);
}
const counter=newDocument();counter.cards=[newCard(46986414,0,'mzone',0)];counter.cards[0].counters=[{type:1,count:3}];probe('counter',counter,'assert(c1:GetCounter(1)==3,"counter")');
const lua=newDocument();lua.cards=[newCard(46986414,0,'mzone',0)];lua.cards[0].lua='local e=Effect.CreateEffect(c)\ne:SetType(EFFECT_TYPE_SINGLE)\ne:SetCode(EFFECT_INDESTRUCTABLE_EFFECT)\ne:SetValue(1)\nc:RegisterEffect(e)';probe('bound-lua-snippet',lua,'assert(c1:IsHasEffect(EFFECT_INDESTRUCTABLE_EFFECT),"bound snippet")');
const deck=newDocument();deck.cards=[newCard(89631139,0,'deck'),newCard(46986414,0,'deck')];probe('deck-top-order',deck,'assert(Duel.GetDecktopGroup(0,1):GetFirst():GetCode()==89631139,"deck top")');
const imported=importLua('Debug.ReloadFieldBegin(66,5)\nDebug.SetPlayerInfo(0,8000,0,0)\nDebug.SetPlayerInfo(1,8000,0,0)\nDebug.AddCard(46986414,0,0,LOCATION_DECK,0,POS_FACEDOWN)\nDebug.AddCard(89631139,0,0,LOCATION_DECK,0,POS_FACEDOWN)\nDebug.ReloadFieldEnd()\naux.BeginPuzzle()','reordered',parser);imported.cards.reverse();probe('imported-deck-reorder',imported,'assert(Duel.GetDecktopGroup(0,1):GetFirst():GetCode()==46986414,"reordered top")');
const edited=importLua('Debug.ReloadFieldBegin(66,5)\nDebug.SetPlayerInfo(0,8000,0,0)\nDebug.SetPlayerInfo(1,8000,0,0)\nlocal m=Debug.AddCard(89631139,0,0,LOCATION_MZONE,0,POS_FACEUP_ATTACK)\nDebug.ReloadFieldEnd()\naux.BeginPuzzle()','edited',parser);edited.cards[0].seq=2;edited.cards[0].owner=1;edited.cards[0].overrides={attack:5000};edited.cards[0].protections={effect:true};probe('imported-edits',edited,'assert(m:GetSequence()==2,"edited zone")\nassert(m:GetOwner()==1,"edited owner")\nassert(m:GetAttack()==5000,"edited stat")\nassert(m:IsHasEffect(EFFECT_INDESTRUCTABLE_EFFECT),"edited resistance")');
const quoted=newDocument();quoted.hints=['中文 "引号" \\ 反斜杠\n换行'];parser.parse(exportLua(quoted),{luaVersion:'5.3'});assert.equal(parseDocument(JSON.stringify(d),catalog).cards[0].overrides.attack,4200);
const refs=newDocument();refs.cards=[newCard(581014,0,'mzone',0),newCard(46986414,0,'overlay',0),newCard(83764718,0,'szone',0)];refs.cards[1].overlayOf=refs.cards[0].uid;refs.cards[2].targetIds=[refs.cards[0].uid];removeCard(refs,refs.cards[0].uid);assert.equal(refs.cards.length,1);assert.deepEqual(refs.cards[0].targetIds,[]);
const summon=newDocument();summon.cards=[newCard(4388680,0,'mzone')];summon.cards[0].summonType=0x45000000;summon.cards[0].summonLocation=2;summon.cards[0].proc=true;
probe('ritual-summon-history',parseDocument(JSON.stringify(summon)),`assert(c1:IsSummonType(SUMMON_TYPE_RITUAL),"ritual history")\nassert(c1:IsSummonType(SUMMON_TYPE_SPECIAL),"special history")\nassert(c1:GetSummonLocation()==LOCATION_HAND,"summoned from hand")\nassert(c1:IsStatus(STATUS_PROC_COMPLETE),"properly summoned")`);
const history=importLua('Debug.ReloadFieldBegin(66,5)\nlocal m=Debug.AddCard(89631139,0,0,LOCATION_MZONE,0,POS_FACEUP_ATTACK)\nDebug.PreSummon(m,SUMMON_TYPE_SPECIAL,LOCATION_HAND)\nDebug.ReloadFieldEnd()\naux.BeginPuzzle()','summon history',parser);
assert.equal(history.cards[0].summonType,0x40000000);history.cards[0].summonType=0x43000000;history.cards[0].summonLocation=64;
const historyOutput=exportLua(parseDocument(JSON.stringify(history)));assert.equal((historyOutput.match(/Debug.PreSummon/g)||[]).length,1);
probe('imported-summon-history-edit',history,'assert(m:IsSummonType(SUMMON_TYPE_FUSION),"edited summon type")\nassert(m:GetSummonLocation()==LOCATION_EXTRA,"edited summon origin")');
history.cards[0].summonType=0;assert(!exportLua(history).includes('Debug.PreSummon'));
edited.cards[0].summonType=0x40000000;edited.cards[0].summonLocation=16;
probe('imported-add-summon-history',edited,'assert(m:IsSummonType(SUMMON_TYPE_SPECIAL),"added summon history")\nassert(m:GetSummonLocation()==LOCATION_GRAVE,"added origin")');
const printSource=corpus.files.find(f=>f.name.endsWith('残局-真印寂血.lua'))?.source||`Debug.ReloadFieldBegin(66,5)
local c=Debug.AddCard(48333324,1,1,LOCATION_EXTRA,0,POS_FACEUP_ATTACK)
function print_hand(e,tp)
local token=Duel.CreateToken(tp,Duel.AnnounceCard(tp))
Duel.SendtoHand(token,nil,REASON_RULE)
end
local e1=Effect.CreateEffect(c)
e1:SetType(EFFECT_TYPE_IGNITION)
e1:SetProperty(EFFECT_FLAG_BOTH_SIDE)
e1:SetRange(LOCATION_EXTRA)
e1:SetOperation(print_hand)
c:RegisterEffect(e1)
Debug.ReloadFieldEnd()
aux.BeginPuzzle()`;
const printDoc=importLua(printSource,'print',parser),script=printDoc.sourceMap.cardScripts[0],printCard=printDoc.cards.find(c=>c.uid===script.uid);
assert.equal(printCard.code,48333324);assert.equal(script.title,'印卡能力');assert(scriptValue(printDoc,script).includes('Duel.CreateToken'));
assert.equal(printCard.lua,'');assert.equal((exportLua(printDoc,catalog).match(/SetOperation\(print_hand\)/g)||[]).length,1);
const legacy=JSON.parse(JSON.stringify(printDoc));delete legacy.sourceMap.cardScriptVersion;delete legacy.sourceMap.cardScripts;delete legacy.sourceMap.cardScriptEdits;prepareCardScripts(legacy,parser);assert.equal(cardScripts(legacy,printCard.uid).length,1);
function printProbe(name,document,expected){
  let lua=exportLua(document,catalog);parser.parse(lua,{luaVersion:'5.3'});
  lua=`local register=Card.RegisterEffect\nlocal printCount=0\nCard.RegisterEffect=function(self,e,...)\nif self:GetCode()==48333324 and (e:GetType() & EFFECT_TYPE_IGNITION)~=0 and e:GetRange()==LOCATION_EXTRA then printCount=printCount+1 end\nreturn register(self,e,...)\nend\n`+lua;
  lua=lua.replace('aux.BeginPuzzle()',`Card.RegisterEffect=register\nassert(printCount==${expected},"imported print registration count")\naux.BeginPuzzle()`);cases.push({name,lua});
}
printProbe('imported-print-identified-once',printDoc,1);
printDoc.sourceMap.cardScriptEdits[script.id]=script.source+'\nassert(c:GetLocation()==LOCATION_EXTRA,"edited print host")\nassert(e1:GetRange()==LOCATION_EXTRA,"edited print range")\nassert((e1:GetProperty() & EFFECT_FLAG_BOTH_SIDE)~=0,"print usable by both players")';
const printSaved=parseDocument(JSON.stringify(printDoc),catalog);assert(scriptValue(printSaved,cardScripts(printSaved,printCard.uid)[0]).includes('edited print host'));
printProbe('imported-print-edit-save-reopen-once',printSaved,1);
printSaved.sourceMap.cardScriptEdits[script.id]='';printProbe('imported-print-remove-original-registration',printSaved,0);
// Shared callbacks and reassigned card variables must remain raw source.
const shared=importLua(printSource.replace('Debug.ReloadFieldEnd()','local other=print_hand\nDebug.ReloadFieldEnd()'),'shared callback',parser);assert.equal(shared.sourceMap.cardScripts.length,0);
const rebound=importLua(printSource.replace('local e1=Effect.CreateEffect(c)','c=nil\nlocal e1=Effect.CreateEffect(c)'),'rebound card',parser);assert.equal(rebound.sourceMap.cardScripts.length,0);
const tokenOnly=importLua(printSource.replaceAll('Duel.AnnounceCard(tp)','89631139'),'token effect',parser);assert.equal(tokenOnly.sourceMap.cardScripts[0].printing,false);
const removedHost=parseDocument(JSON.stringify(printDoc),catalog);removeCard(removedHost,printCard.uid);printProbe('delete-imported-print-host-cleans-script',removedHost,0);
const removable=importLua(printSource.replace('Debug.ReloadFieldEnd()','Debug.AddCard(89631139,0,0,LOCATION_MZONE,0,POS_FACEUP_ATTACK)\nDebug.ReloadFieldEnd()'),'remove unrelated card',parser);removeCard(removable,removable.cards.find(c=>c.code===89631139).uid);printProbe('delete-imported-unreferenced-card-keeps-print',removable,1);
assert(shared.sourceMap.unsafeDeleteIds.includes(shared.cards.find(c=>c.code===48333324).uid));
fs.writeFileSync(process.argv[3],JSON.stringify(cases));console.log(`Model assertions passed; ${cases.length} native probes generated.`);
