export const SCHEMA = 1;
export const ZONES = {mzone:'怪兽区', szone:'魔法 / 陷阱区', fzone:'场地区', pzone:'灵摆区', hand:'手牌', deck:'主卡组', extra:'额外卡组', grave:'墓地', removed:'除外', overlay:'超量素材'};
export const POSITIONS = {1:'表侧攻击', 2:'里侧攻击', 4:'表侧守备', 8:'里侧守备'};
export const RULES = {3:'大师规则 3 · 2014', 4:'新大师规则 · 2017', 5:'大师规则 · 2020 修订'};
export const LIST_ZONES = ['hand','deck','extra','grave','removed'];
export const SUMMON_TYPES = {0:'未设置',268435456:'通常召唤',285212672:'上级召唤',301989888:'再度召唤',536870912:'反转召唤',1073741824:'特殊召唤',1124073472:'融合召唤',1157627904:'仪式召唤',1174405120:'同调召唤',1224736768:'超量召唤',1241513984:'灵摆召唤',1275068416:'连接召唤'};
export const SUMMON_LOCATIONS = {0:'未设置',1:'卡组',2:'手牌',4:'怪兽区',8:'魔陷区',16:'墓地',32:'除外',64:'额外卡组'};
export const ATTRIBUTES = {1:'地',2:'水',4:'炎',8:'风',16:'光',32:'暗',64:'神'};
export const RACES = {1:'战士',2:'魔法师',4:'天使',8:'恶魔',16:'不死',32:'机械',64:'水',128:'炎',256:'岩石',512:'鸟兽',1024:'植物',2048:'昆虫',4096:'雷',8192:'龙',16384:'兽',32768:'兽战士',65536:'恐龙',131072:'鱼',262144:'海龙',524288:'爬虫',1048576:'念动力',2097152:'幻神兽',4194304:'创造神',8388608:'幻龙',16777216:'电子界',33554432:'幻想魔'};
export const clone = value => JSON.parse(JSON.stringify(value));
export const uid = () => crypto.randomUUID();
export function newDocument() {
  return {schemaVersion:SCHEMA,title:'未命名残局',description:'',solution:'',hints:['在这个回合取得胜利！'],rule:5,pseudoShuffle:false,
    players:[{name:'我方',lp:8000,startCount:0,drawCount:0},{name:'对手',lp:8000,startCount:0,drawCount:0}],cards:[],initializationLua:''};
}
export function newCard(code,controller,zone,seq=0) {
  return {uid:uid(),code,owner:controller,controller,zone,seq,position:['deck','extra'].includes(zone)?8:1,proc:false,summonType:0,summonLocation:0,
    overlayOf:null,counters:[],overrides:{},equipTo:null,targetIds:[],protections:{},grants:[],resetOnLeave:true,unnegatable:false,lua:''};
}
export function physicalSlot(card,rule) {
  if(card.zone==='overlay'||LIST_ZONES.includes(card.zone)) return null;
  if(card.zone==='mzone'&&card.seq>=5) return `emz-${card.controller===0?card.seq-5:6-card.seq}`;
  if(card.zone==='pzone'&&rule>=4) return `${card.controller}-szone-${card.seq===0?0:4}`;
  return `${card.controller}-${card.zone}-${card.seq}`;
}
export function allowedPositions(card,meta) {
  if(card.zone==='pzone'||card.zone==='grave'||card.zone==='overlay') return [1];
  if(card.zone==='szone'||card.zone==='fzone') return [1,2];
  if(card.zone==='deck') return [8];
  if(card.zone==='extra'||card.zone==='removed') return [1,8];
  if(card.zone==='hand') return [1];
  if(meta?.type&0x4000000) return [1];
  return [1,4,8,2];
}
export function removeCard(doc,id) {
  const removed=new Set([id,...doc.cards.filter(c=>c.overlayOf===id).map(c=>c.uid)]);
  doc.cards=doc.cards.filter(c=>!removed.has(c.uid));
  for(const c of doc.cards){if(removed.has(c.equipTo)) c.equipTo=null;c.targetIds=c.targetIds.filter(t=>!removed.has(t));}
}
export function validate(doc,catalog=new Map()) {
  const errors=[],warnings=[...(doc.sourceMap?.importWarnings||[])];
  if(doc.schemaVersion!==SCHEMA) errors.push('不支持的工程版本');
  if(!Object.hasOwn(RULES,doc.rule)) errors.push('请选择有效规则');
  if(typeof doc.title!=='string'||!doc.title.trim()) errors.push('请填写工程名称');
  if(!Array.isArray(doc.cards)||doc.cards.length>2000) return {errors:[...errors,'卡片列表无效或超过 2000 张'],warnings};
  if(!Array.isArray(doc.players)||doc.players.length!==2) return {errors:[...errors,'需要两名玩家'],warnings};
  for(const p of doc.players){if(!Number.isInteger(p.lp)||p.lp<1||p.lp>2147483647)errors.push('LP 必须在 1～2147483647 之间');for(const key of ['startCount','drawCount'])if(!Number.isInteger(p[key])||p[key]<0||p[key]>255)errors.push('抽牌数量必须在 0～255 之间');}
  const ids=new Map(),occupied=new Map();
  for(const c of doc.cards) {
    const meta=catalog.get(c.code),label=meta?.name||String(c.code);
    if(typeof c.uid!=='string'||!c.uid||ids.has(c.uid)){errors.push('卡片实例 ID 无效或重复');continue;}ids.set(c.uid,c);
    if(!Number.isInteger(c.code)||c.code<=0||c.code>0x7fffffff) errors.push('卡号无效');
    if(![0,1].includes(c.owner)||![0,1].includes(c.controller)) errors.push(`${label}：玩家编号无效`);
    if(!Number.isInteger(c.summonType??0)||(c.summonType??0)<0||(c.summonType??0)>0x7fffffff||!Number.isInteger(c.summonLocation??0)||!Object.hasOwn(SUMMON_LOCATIONS,c.summonLocation??0))errors.push(`${label}：召唤记录无效`);
    if(!Object.hasOwn(ZONES,c.zone)) errors.push(`${label}：区域无效`);
    const max=c.zone==='mzone'?6:c.zone==='szone'?4:c.zone==='pzone'?1:LIST_ZONES.includes(c.zone)?2000:0;
    if(!Number.isInteger(c.seq)||c.seq<0||c.seq>max)errors.push(`${label}：区域编号无效`);
    if(doc.rule===3&&c.zone==='mzone'&&c.seq>=5)errors.push(`${label}：MR3 没有额外怪兽区`);
    const original=doc.sourceMap?.originalCards?.find(x=>x.uid===c.uid);
    if(!allowedPositions(c,meta).includes(c.position)&&!(original&&original.position===c.position&&original.zone===c.zone))errors.push(`${label}：表示形式不适用于此卡或区域`);
    if(c.zone==='pzone'&&meta&&!(meta.type&0x1000000))errors.push(`${label}：灵摆区需要灵摆怪兽`);
    const slot=physicalSlot(c,doc.rule);if(slot){if(occupied.has(slot))errors.push(`${label}：与其他卡片占用同一格（包含共享区）`);occupied.set(slot,c);}
    if(!Array.isArray(c.counters)||c.counters.some(x=>!Number.isInteger(x.type)||x.type<1||x.type>65535||!Number.isInteger(x.count)||x.count<1||x.count>65535))errors.push(`${label}：指示物编号或数量无效`);
    if(new Set(c.counters?.map(x=>x.type)).size!==c.counters?.length) errors.push(`${label}：同类指示物请合并数量`);
    for(const [key,value]of Object.entries(c.overrides||{})){if(!['attack','defense','baseAttack','baseDefense','level','rank','lscale','rscale','attribute','race'].includes(key)||!Number.isInteger(value)||value<0||value>2147483647)errors.push(`${label}：数值修改无效`);}
    if(!Array.isArray(c.targetIds))errors.push(`${label}：对象列表无效`);
    if(!Array.isArray(c.grants||[])||(c.grants||[]).length>30||(c.grants||[]).some(g=>!Number.isInteger(g.sourceCode)||g.sourceCode<=0||typeof g.lua!=='string'||g.lua.length>100000))errors.push(`${label}：提取效果数据无效`);
    if((c.grants||[]).length&&c.zone!=='mzone')errors.push(`${label}：提取效果的接收者需要放在怪兽区`);
    if((c.grants||[]).length&&meta&&!(meta.type&1))errors.push(`${label}：提取效果的接收者需要是怪兽`);
    if(new Set((c.grants||[]).map(g=>g.sourceKey||String(g.sourceCode))).size!==(c.grants||[]).length)errors.push(`${label}：同一来源效果不能重复添加`);
    if(meta?.type&0x4000000&&['defense','baseDefense','level','rank'].some(k=>c.overrides?.[k]!==undefined))errors.push(`${label}：连接怪兽不能修改守备力、等级或阶级`);
    if((!meta&&catalog.size)||meta?.missing){if(original&&original.code===c.code)warnings.push(`本地卡库缺少原残局中的卡片 ${c.code}，已保留卡号；需要补齐资源才能还原其真实效果`);else errors.push(`本地卡库缺少卡片 ${c.code}`);}
  }
  for(const c of doc.cards){
    if(c.zone==='overlay'){
      const host=ids.get(c.overlayOf);
      if(!host||host.zone!=='mzone'||!(catalog.get(host.code)?.type&0x800000)&&catalog.size)errors.push('超量素材必须关联场上的超量怪兽');
      if(host&&host.controller!==c.controller)errors.push('素材控制者必须与宿主一致');
    }else if(c.overlayOf)errors.push('普通卡片不能同时关联素材宿主');
    if(c.equipTo){const target=ids.get(c.equipTo);if(!target||c.zone!=='szone'||target.zone!=='mzone'||![1,4].includes(target.position)||c.uid===c.equipTo)errors.push('装备卡必须在魔陷区，并指向表侧怪兽');}
    for(const id of c.targetIds||[])if(!ids.has(id)||id===c.uid)errors.push('永续对象引用无效');
  }
  for(const player of [0,1])if(doc.cards.filter(c=>c.controller===player&&c.zone==='mzone'&&c.seq>=5).length>1)warnings.push(`${player?'对方':'我方'}占用两个额外怪兽区，请核对特殊场面来源`);
  return {errors:[...new Set(errors)],warnings:[...new Set(warnings)]};
}
export function parseDocument(text,catalog=new Map()) {
  const d=JSON.parse(text);
  if(!d||typeof d!=='object'||d.schemaVersion!==SCHEMA||!Array.isArray(d.cards)||d.cards.length>2000)throw Error('这不是受支持的 Puzzle Studio 工程');
  const normalized=newDocument();
  for(const key of ['title','description','solution','initializationLua'])if(typeof d[key]==='string')normalized[key]=d[key].slice(0,100000);
  if(d.diyCards?.length)throw Error('此工程含已停用的 DIY 卡数据，请先用旧版迁移为游戏内已有卡片。');
  if(d.sourceMap&&typeof d.sourceMap.source==='string'&&Array.isArray(d.sourceMap.patches)&&Array.isArray(d.sourceMap.originalCards)&&Array.isArray(d.sourceMap.unhandled))normalized.sourceMap=clone(d.sourceMap);
  if(!Array.isArray(d.hints)||d.hints.some(h=>typeof h!=='string'))throw Error('提示内容格式无效');
  normalized.hints=d.hints.slice(0,100).map(s=>s.slice(0,10000));
  normalized.rule=d.rule;normalized.pseudoShuffle=!!d.pseudoShuffle;
  if(!Array.isArray(d.players))throw Error('玩家信息无效');
  normalized.players=d.players.map(p=>({name:String(p.name||''),lp:p.lp,startCount:p.startCount,drawCount:p.drawCount}));
  normalized.cards=d.cards.map(c=>({...newCard(c.code,c.controller,c.zone,c.seq),uid:c.uid,owner:c.owner,position:c.position,proc:!!c.proc,summonType:c.summonType??0,summonLocation:c.summonLocation??0,overlayOf:c.overlayOf||null,
    counters:Array.isArray(c.counters)?c.counters.map(x=>({type:x.type,count:x.count})):[],overrides:{...c.overrides},equipTo:c.equipTo||null,targetIds:Array.isArray(c.targetIds)?c.targetIds.slice():[],
    protections:{...c.protections},grants:clone(c.grants||[]),resetOnLeave:c.resetOnLeave!==false,unnegatable:!!c.unnegatable,lua:typeof c.lua==='string'?c.lua.slice(0,100000):''}));
  const result=validate(normalized,catalog);if(result.errors.length)throw Error(result.errors.join('\n'));
  return normalized;
}
export function luaString(s) {
  return '"'+String(s).replace(/[\\"\x00-\x1f\x7f]/g,c=>c==='\\'?'\\\\':c==='"'?'\\"':`\\${c.charCodeAt(0).toString().padStart(3,'0')}`)+'"';
}
export function exportLua(doc,catalog=new Map(),internalScaffold=false) {
  const check=internalScaffold?{errors:[]}:validate(doc,catalog);if(check.errors.length)throw Error(check.errors.join('\n'));
  if(doc.sourceMap)return exportSourceLua(doc,catalog);
  const lines=['-- Puzzle Studio · MDPro3','-- '+doc.title.replace(/[\r\n]/g,' '),`Debug.SetAIName(${luaString(doc.players[1].name)})`,
    `Debug.ReloadFieldBegin(DUEL_ATTACK_FIRST_TURN+DUEL_SIMPLE_AI${doc.pseudoShuffle?'+DUEL_PSEUDO_SHUFFLE':''},${doc.rule})`];
  doc.players.forEach((p,i)=>lines.push(`Debug.SetPlayerInfo(${i},${p.lp},${p.startCount},${p.drawCount})`));
  const cards=doc.cards.filter(c=>c.zone!=='overlay'),vars=new Map(doc.cards.map((c,i)=>[c.uid,`c${i+1}`]));
  const location={mzone:'LOCATION_MZONE',szone:'LOCATION_SZONE',fzone:'LOCATION_SZONE',pzone:'LOCATION_PZONE',deck:'LOCATION_DECK',hand:'LOCATION_HAND',extra:'LOCATION_EXTRA',grave:'LOCATION_GRAVE',removed:'LOCATION_REMOVED'};
  function add(c,host=null){
    const z=host||c,seq=z.zone==='fzone'?5:LIST_ZONES.includes(z.zone)?0:z.seq;
    // Globals avoid Lua's 200-local limit for large authored decks.
    lines.push(`${vars.get(c.uid)}=Debug.AddCard(${c.code},${c.owner},${z.controller},${location[z.zone]},${seq},${c.position},${c.proc?'true':'false'})`);
  }
  // The model's first card is the top of a pile. Deck sequence 0 appends to
  // the engine's vector (whose last element is drawn first), hence reverse it.
  for(const c of cards.filter(c=>c.zone!=='deck'))add(c);
  for(const p of [0,1])for(const c of cards.filter(c=>c.zone==='deck'&&c.controller===p).reverse())add(c);
  for(const c of doc.cards.filter(c=>c.zone==='overlay'))add(c,doc.cards.find(h=>h.uid===c.overlayOf));
  for(const c of doc.cards){
    if(c.summonType)lines.push(`Debug.PreSummon(${vars.get(c.uid)},${c.summonType},${c.summonLocation||0})`);
    if(c.equipTo)lines.push(`Debug.PreEquip(${vars.get(c.uid)},${vars.get(c.equipTo)})`);
    for(const id of c.targetIds)lines.push(`Debug.PreSetTarget(${vars.get(c.uid)},${vars.get(id)})`);
    for(const counter of c.counters)lines.push(`Debug.PreAddCounter(${vars.get(c.uid)},${counter.type},${counter.count})`);
  }
  lines.push('Debug.ReloadFieldEnd()');
  const effects={attack:'EFFECT_SET_ATTACK',defense:'EFFECT_SET_DEFENSE',baseAttack:'EFFECT_SET_BASE_ATTACK',baseDefense:'EFFECT_SET_BASE_DEFENSE',level:'EFFECT_CHANGE_LEVEL',rank:'EFFECT_CHANGE_RANK',lscale:'EFFECT_CHANGE_LSCALE',rscale:'EFFECT_CHANGE_RSCALE',attribute:'EFFECT_CHANGE_ATTRIBUTE',race:'EFFECT_CHANGE_RACE'};
  const protectionEffects={battle:'EFFECT_INDESTRUCTABLE_BATTLE',effect:'EFFECT_INDESTRUCTABLE_EFFECT',target:'EFFECT_CANNOT_BE_EFFECT_TARGET',immune:'EFFECT_IMMUNE_EFFECT'};
  for(const c of doc.cards){
    const entries=[...Object.entries(c.overrides).map(([key,value])=>[effects[key],value]),...Object.entries(c.protections||{}).filter(([key,on])=>on&&protectionEffects[key]).map(([key])=>[protectionEffects[key],key==='immune'?'function(e,re) return e:GetOwner()~=re:GetOwner() end':1])];
    for(const [effect,value]of entries){
      lines.push(`do local e=Effect.CreateEffect(${vars.get(c.uid)})`,`e:SetType(EFFECT_TYPE_SINGLE)`,`e:SetCode(${effect})`,`e:SetValue(${value})`);
      if(c.unnegatable)lines.push('e:SetProperty(EFFECT_FLAG_CANNOT_DISABLE)');
      if(c.resetOnLeave)lines.push('e:SetReset(RESET_EVENT+RESETS_STANDARD)');
      lines.push(`${vars.get(c.uid)}:RegisterEffect(e)`,`end`);
    }
  }
  // Execute authored initialization while all card handles are available, before
  // ReloadFieldEnd publishes the initial scene. Raw Lua is never executed in the browser.
  const initialization=[];
  for(const c of doc.cards)for(const grant of c.grants||[])initialization.push(`-- Granted effect from ${grant.sourceCode}\ndo local c=${vars.get(c.uid)}\n${grant.lua}\nend`);
  for(const c of doc.cards)if(c.lua?.trim())initialization.push(`do local c=${vars.get(c.uid)}\nlocal tp=c:GetControler()\n${c.lua}\nend`);
  if(doc.initializationLua?.trim())initialization.push(doc.initializationLua);
  const boundary=lines.indexOf('Debug.ReloadFieldEnd()');lines.splice(boundary,0,...initialization);
  for(const hint of doc.hints.filter(Boolean))lines.push(`Debug.ShowHint(${luaString(hint)})`);
  lines.push('aux.BeginPuzzle()');
  // Match the existing selector's metadata convention; do not allow a comment terminator inside it.
  if(doc.description)lines.push('--[[message',doc.description.replace(/\]\]/g,'] ]'),']]');
  if(doc.solution)lines.push('--[[','Solution:',doc.solution.replace(/\]\]/g,'] ]'),']]');
  return lines.join('\n')+'\n';
}

function exportSourceLua(doc,catalog){
  const sm=doc.sourceMap,edits=[],handles=new Map(),originalIds=new Set(sm.originalCards.map(c=>c.uid));
  const deleted=sm.originalCards.filter(c=>!doc.cards.some(x=>x.uid===c.uid));
  if(deleted.some(c=>sm.unsafeDeleteIds?sm.unsafeDeleteIds.includes(c.uid):sm.unhandled.length))throw Error('删除的卡片仍被其他自定义 Lua 引用；请先处理相应脚本引用。');
  for(const [i,c]of doc.cards.entries())handles.set(c.uid,sm.patches.find(p=>p.kind==='card'&&p.uid===c.uid)?.alias||`ps${i+1}`);
  const locations={mzone:4,szone:8,fzone:8,pzone:512,hand:2,deck:1,extra:64,grave:16,removed:32};
  const relationShape=cards=>JSON.stringify(cards.map(c=>[c.uid,c.equipTo,c.targetIds,c.counters]));
  const changedRelations=relationShape(doc.cards)!==relationShape(sm.originalCards);
  const reorderedDecks=new Map();
  for(const player of [0,1]){
    const before=sm.originalCards.filter(c=>c.zone==='deck'&&c.controller===player),after=doc.cards.filter(c=>c.zone==='deck'&&c.controller===player);
    if(before.length===after.length&&before.length&&before.every(c=>after.some(a=>a.uid===c.uid))&&before.some((c,i)=>after[i].uid!==c.uid)){
      if(sm.unhandled.length)throw Error('此残局含自定义 Lua，重排卡组可能改变脚本变量绑定，请先处理原始脚本。');
      const patches=sm.patches.filter(p=>p.kind==='card'&&before.some(c=>c.uid===p.uid));
      if(patches.some(p=>p.alias))throw Error('此卡组有原脚本变量引用，暂不支持直接重排。');
      patches.forEach((p,i)=>reorderedDecks.set(p.uid,after[after.length-1-i]));
    }
  }
  const args=c=>{const host=c.zone==='overlay'?doc.cards.find(h=>h.uid===c.overlayOf):c;return [c.code,c.owner,host.controller,locations[host.zone],host.zone==='fzone'?5:LIST_ZONES.includes(host.zone)?0:host.seq,c.position,c.proc?'true':'false'].join(',');};
  for(const p of sm.patches){
    let text;
    if(p.kind==='card'){
      const c=reorderedDecks.get(p.uid)||doc.cards.find(x=>x.uid===p.uid);
      if(!c){edits.push({start:p.statementRange[0],end:p.statementRange[1],text:''});continue;}
      const original=sm.originalCards.find(x=>x.uid===c.uid);
      // Preserve exact engine position and insertion flags when the card is unchanged.
      const unchanged=!reorderedDecks.has(p.uid)&&['code','owner','controller','zone','seq','position','proc','overlayOf'].every(k=>c[k]===original[k]);
      text=`${p.direct?handles.get(c.uid)+'=':''}Debug.AddCard(${unchanged?p.originalArgsText:args(c)})`;
    }else if(p.kind==='summon'){
      const c=doc.cards.find(x=>x.uid===p.uid),original=sm.originalCards.find(x=>x.uid===p.uid);
      if(!c||!c.summonType){edits.push({start:p.statementRange[0],end:p.statementRange[1],text:''});continue;}
      if(c.summonType!==original.summonType||c.summonLocation!==original.summonLocation)text=`Debug.PreSummon(${handles.get(c.uid)},${c.summonType},${c.summonLocation||0})`;
    }else if(p.kind==='begin')text=`Debug.ReloadFieldBegin(${sm.flagsRaw||((sm.flags&~16)|(doc.pseudoShuffle?16:0))},${doc.rule})`;
    else if(p.kind==='ai')text=`Debug.SetAIName(${luaString(doc.players[1].name)})`;
    else if(p.kind==='player'){const player=doc.players[p.player];text=`Debug.SetPlayerInfo(${p.player},${player.lp},${player.startCount},${player.drawCount})`;}
    else if(p.kind==='hint'){
      if(p.index>=doc.hints.length){edits.push({start:p.statementRange[0],end:p.statementRange[1],text:''});continue;}
      text=`Debug.ShowHint(${luaString(doc.hints[p.index])})`;
    }else if(p.kind==='relation'&&changedRelations){edits.push({start:p.statementRange[0],end:p.statementRange[1],text:''});continue;}
    if(text!==undefined)edits.push({start:p.start,end:p.end,text});
  }
  const extra=[];
  for(const script of sm.cardScripts||[]){
    if(!doc.cards.some(c=>c.uid===script.uid)){edits.push({start:script.start,end:script.end,text:''});continue;}
    const value=sm.cardScriptEdits?.[script.id];
    if(value!==undefined&&value!==script.source){
      if(typeof value!=='string'||value.length>100000)throw Error('导入的卡片脚本修改无效');
      edits.push({start:script.start,end:script.end,text:value});
    }
  }
  for(const c of doc.cards.filter(c=>!originalIds.has(c.uid)))extra.push(`${handles.get(c.uid)}=Debug.AddCard(${args(c)})`);
  for(const c of doc.cards)if(c.summonType&&!sm.patches.some(p=>p.kind==='summon'&&p.uid===c.uid))extra.push(`Debug.PreSummon(${handles.get(c.uid)},${c.summonType},${c.summonLocation||0})`);
  if(changedRelations)for(const c of doc.cards){
    if(c.equipTo)extra.push(`Debug.PreEquip(${handles.get(c.uid)},${handles.get(c.equipTo)})`);
    for(const id of c.targetIds)extra.push(`Debug.PreSetTarget(${handles.get(c.uid)},${handles.get(id)})`);
    for(const x of c.counters)extra.push(`Debug.PreAddCounter(${handles.get(c.uid)},${x.type},${x.count})`);
  }
  const scaffoldCards=doc.cards.map(c=>({...c,position:allowedPositions(c,catalog.get(c.code))[0]}));
  const canonical=exportLua({...doc,cards:scaffoldCards,sourceMap:null,hints:[],description:'',solution:'',initializationLua:''},catalog,true);
  const end=canonical.indexOf('Debug.ReloadFieldEnd()');
  const advanced=canonical.slice(end+'Debug.ReloadFieldEnd()'.length,canonical.lastIndexOf('aux.BeginPuzzle()')).trim();
  if(advanced)extra.push(advanced.replace(/\bc(\d+)\b/g,(m,n)=>handles.get(doc.cards[Number(n)-1]?.uid)||m));
  for(const c of doc.cards)for(const grant of c.grants||[])extra.push(`-- Granted effect from ${grant.sourceCode}\ndo local c=${handles.get(c.uid)}\n${grant.lua}\nend`);
  for(const c of doc.cards)if(c.lua?.trim())extra.push(`do local c=${handles.get(c.uid)}\nlocal tp=c:GetControler()\n${c.lua}\nend`);
  if(doc.initializationLua?.trim())extra.push(doc.initializationLua);
  for(const hint of doc.hints.slice(sm.patches.filter(p=>p.kind==='hint').length))extra.push(`Debug.ShowHint(${luaString(hint)})`);
  const endPatch=sm.patches.find(p=>p.kind==='end');
  if(extra.length)edits.push({start:endPatch.start,end:endPatch.start,text:extra.join('\n')+'\n'});
  let source=sm.source;
  for(const edit of edits.sort((a,b)=>b.start-a.start||b.end-a.end))source=source.slice(0,edit.start)+edit.text+source.slice(edit.end);
  if(doc.description!==sm.originalDescription){source=source.replace(/--\[\[message[\s\S]*?\]\]/,'');if(doc.description)source+='\n--[[message\n'+doc.description.replace(/\]\]/g,'] ]')+'\n]]';}
  if(doc.solution!==sm.originalSolution){source=source.replace(/--\[\[\s*\r?\nSolution:[\s\S]*?\]\]/,'');if(doc.solution)source+='\n--[[\nSolution:\n'+doc.solution.replace(/\]\]/g,'] ]')+'\n]]';}
  return '-- Puzzle Studio · MDPro3 · imported source preserved\n'+source+'\n';
}
