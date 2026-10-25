import {newDocument,newCard,clone,uid,ZONES,POSITIONS,RULES,LIST_ZONES,ATTRIBUTES,RACES,SUMMON_TYPES,SUMMON_LOCATIONS,physicalSlot,allowedPositions,removeCard,validate,parseDocument,exportLua} from './model.mjs';
import {importLua} from './lua-import.mjs';
import {fieldMarkup,exDestination} from './field-layout.mjs';
import {discoverGrants} from './grant-effects.mjs';
import {cardSurface,cardAngle,captureCardViews,animateCardViews,startPictureRefresh} from './card-display.mjs';
import {prepareCardScripts,cardScripts,scriptValue} from './lua-card-scripts.mjs';
const $=id=>document.getElementById(id),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icons={plus:'M12 5v14M5 12h14',folder:'M3 7h7l2 2h9v11H3zM3 7V4h7l2 3',save:'M4 3h13l4 4v14H3V3zM7 3v6h10V3M7 21v-8h10v8',code:'m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18',search:'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',layout:'M3 3h18v18H3zM8 3v18M16 3v18M8 11h8',undo:'M9 4 3 10l6 6M3 10h11a7 7 0 0 1 7 7',redo:'m15 4 6 6-6 6m6-6H10a7 7 0 0 0-7 7',settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M10 2h4l1 3 3 1 3 1-1 4v2l1 4-3 1-3 1-1 3h-4l-1-3-3-1-3-1 1-4v-2L3 7l3-1 3-1z',cursor:'m4 3 15 10-7 1-3 7z',close:'m6 6 12 12M6 18 18 6',download:'M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4',copy:'M9 9h12v12H9zM5 15H3V3h12v2',package:'m12 2 10 5-10 5L2 7zM2 7v10l10 5 10-5V7M12 12v10m-5-17 10 5',help:'M9 9a3 3 0 1 1 5 2c-2 1-2 2-2 3m0 3h.01M22 12A10 10 0 1 1 2 12a10 10 0 0 1 20 0',trash:'M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7',shield:'m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6z',card:'M5 2h14v20H5zM8 6h8v8H8zM8 18h8',arrow:'m9 5 7 7-7 7'};
const icon=name=>`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icons[name]||icons.card}"/></svg>`;
function decorate(){document.querySelectorAll('[data-icon]').forEach(e=>{const name=e.dataset.icon;e.removeAttribute('data-icon');e.insertAdjacentHTML('afterbegin',icon(name));});}
let doc=newDocument(),catalog=new Map(),selection=null,previewCode=null,tab='basic',history=[],future=[],target=null,libraryType='all',offset=0,pickerOffset=0,searchToken=0,pickerToken=0,toastTimer,exported='';
let activePile=null,grantSources=[],grantRecipient=null,importedScriptSelection=null,grantVisible=60,grantScanCount=0;
let draggedInstance=null,projectOpen=true,cleanSnapshot=null,pendingClose=null;let settingsLines={description:[],hints:[]};
const STORAGE='mdpro3-puzzle-studio-v1';
function toast(message,error=false){clearTimeout(toastTimer);$('toast').textContent=message;$('toast').className='toast'+(error?' error':'');$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,error?7000:3500);}
async function api(path,options){const r=await fetch(path,options);if(!r.ok){let data;try{data=await r.json();}catch{}throw Error(data?.error||`请求失败 ${r.status}`);}return r;}
function modified(){return projectOpen&&(cleanSnapshot===null||JSON.stringify(doc)!==cleanSnapshot||pendingLuaChanged()||($('project-title').value.trim()||'未命名残局')!==doc.title);}
function applyPendingTitle(title=$('project-title').value.trim()||'未命名残局'){if(projectOpen&&title!==doc.title)commit(()=>doc.title=title);}
function markClean(){cleanSnapshot=JSON.stringify(doc);localStorage.removeItem(STORAGE+'-dirty');$('save-state').textContent='已保存工程';}
function autosave(){try{if(!projectOpen)return;localStorage.setItem(STORAGE,JSON.stringify(doc));localStorage.removeItem(STORAGE+'-closed');localStorage.setItem(STORAGE+'-dirty',JSON.stringify(doc)===cleanSnapshot?'0':'1');$('save-state').textContent=(JSON.stringify(doc)===cleanSnapshot?'':'有修改 · ')+'已自动保存';}catch{$('save-state').textContent='本地存储空间不足，请保存工程';}}
function pendingLuaChanged(){const c=doc.cards.find(c=>c.uid===selection),editor=$('card-lua');if(!c||!editor)return false;const imported=activeImportedScript(c),normalize=s=>String(s||'').replace(/\r\n?/g,'\n');return normalize(editor.value)!==normalize(imported?scriptValue(doc,imported):c.lua)||!!imported&&normalize($('additional-card-lua')?.value)!==normalize(c.lua);}
function applyPendingLua(){
  const c=doc.cards.find(c=>c.uid===selection),editor=$('card-lua');if(!c||!editor||!pendingLuaChanged())return true;
  const lua=editor.value,imported=activeImportedScript(c),additional=$('additional-card-lua')?.value||'';
  try{for(const code of [lua,additional])globalThis.luaparse.parse('do local c=nil\nlocal tp=0\n'+code+'\nend',{luaVersion:'5.3'});editCard(c=>{if(imported){doc.sourceMap.cardScriptEdits[imported.id]=lua;c.lua=additional;}else c.lua=lua;});return true;}catch(e){toast(e.message,true);return false;}
}
function closeProject(){
  endPointerDrag();doc=newDocument();selection=null;previewCode=null;target=null;activePile=null;history=[];future=[];projectOpen=false;cleanSnapshot=null;
  for(const suffix of ['', '-dirty'])localStorage.removeItem(STORAGE+suffix);localStorage.setItem(STORAGE+'-closed','1');
  $('save-state').textContent='未打开工程';render();
}
function requestCloseProject(){if(!projectOpen)return;if(!modified()){closeProject();return;}pendingClose=closeProject;$('close-save-dialog').showModal();}
function commit(change,message){history.push(clone(doc));if(history.length>70)history.shift();future=[];change();autosave();render();if(message)toast(message);}
function restore(direction){const from=direction==='undo'?history:future,to=direction==='undo'?future:history;if(!from.length)return;to.push(clone(doc));doc=from.pop();selection=doc.cards.some(c=>c.uid===selection)?selection:null;autosave();render();}
function kind(m){return m?.type&0x4000000?'link':m?.type&0x800000?'xyz':m?.type&0x1000000?'pendulum':m?.type&1?'monster':m?.type&2?'spell':'trap';}
function typeName(m){return ({link:'连接怪兽',xyz:'超量怪兽',pendulum:'灵摆怪兽',monster:m?.type&0x40?'融合怪兽':m?.type&0x2000?'同调怪兽':m?.type&16?'通常怪兽':'效果怪兽',spell:'魔法',trap:'陷阱'})[kind(m)];}
function battle(v){return v<0?'?':v??'—';}
function stats(m,c){if(!(m?.type&1))return m?.id||'';return `${battle(c?.overrides.attack??c?.overrides.baseAttack??m.atk)} / ${m.type&0x4000000?'LINK '+m.level:battle(c?.overrides.defense??c?.overrides.baseDefense??m.def)}`;}
function cardButton(m){return `<button class="library-card ${previewCode===m.id?'selected':''}" draggable="true" data-code="${m.id}" title="${esc(m.name)} · ${m.id}"><img src="/card-image/${m.id}" alt="${esc(m.name)}" loading="lazy"><span class="type-corner">${typeName(m).replace('怪兽','')}</span><div class="library-card-name">${esc(m.name)}</div><div class="card-sub"><span>${m.type&1?'★ '+m.level:typeName(m)}</span><span>${m.type&1?battle(m.atk):m.id}</span></div></button>`;}
function boardCard(c,hand=false){
  const m=catalog.get(c.code)||{name:String(c.code),type:1,atk:0,def:0};
  const count=doc.cards.filter(x=>x.overlayOf===c.uid).length,protectedCard=Object.values(c.protections||{}).some(Boolean),printing=cardScripts(doc,c.uid).some(s=>s.printing&&scriptValue(doc,s).trim());
  return `<div class="board-card ${selection===c.uid?'selected':''} ${hand?'hand-card':''}" draggable="false" tabindex="0" role="button" data-instance="${c.uid}" aria-label="选择 ${esc(m.name)}" title="${esc(m.name)} · ${POSITIONS[c.position]||'表侧'}">${cardSurface(c.code,m.name,c.position,hand?0:cardAngle(c.position,c.controller===1,c.zone==='mzone'),'board:'+c.uid)}${count?`<span class="overlay-badge">素材 ${count}</span>`:''}${protectedCard?'<span class="card-protection">抗性</span>':''}${printing?'<span class="script-badge">印卡</span>':''}</div>`;
}
async function hydrate(document){const codes=[...new Set(document.cards.map(c=>c.code))];for(let i=0;i<codes.length;i+=30)await Promise.all(codes.slice(i,i+30).filter(c=>!catalog.has(c)).map(async code=>{try{const data=await(await api('/api/card/'+code)).json();catalog.set(code,data);}catch{catalog.set(code,{id:code,name:'缺失卡片 #'+code,desc:'本地卡库没有此卡片的数据，请补齐原残局所需资源。',type:0,atk:0,def:0,level:0,attribute:0,race:0,alias:0,missing:true});}}));}
async function loadLibrary(more=false){const token=++searchToken;if(!more)offset=0;const category=$('extra-filter').value||libraryType,q=$('search').value.trim();let result;
  try{result=await(await api(`/api/cards?q=${encodeURIComponent(q)}&type=${category}&offset=${offset}&limit=40`)).json();if(token!==searchToken)return;
    result.cards.forEach(c=>catalog.set(c.id,c));$('search-count').textContent=`${result.total.toLocaleString()} 个结果`;
    if(!more)$('card-library').innerHTML='';$('card-library').insertAdjacentHTML('beforeend',result.cards.map(cardButton).join(''));
    if(!result.total)$('card-library').innerHTML='<div class="blank-search">没有找到卡片<br>试试卡号或其他关键词</div>';
    offset+=result.cards.length;$('load-more').disabled=offset>=result.total;
  }catch(e){$('card-library').innerHTML=`<div class="blank-search">${esc(e.message)}</div>`;}
}
function slot(p,zone,seq,label,extra=''){
  const shared=zone==='mzone'&&seq>=5;
  const key=physicalSlot({controller:p,zone,seq},doc.rule),c=doc.cards.find(c=>physicalSlot(c,doc.rule)===key&&key!==null);
  const accessible=shared?`EX区 ${seq===5?'左':'右'}`:`${p?'对方':'我方'} ${label}`;
  return `<div class="field-slot ${extra}" tabindex="0" role="button" data-player="${p}" data-zone="${zone}" data-seq="${seq}" ${shared?'data-shared="true"':''} aria-label="${accessible}">${c?boardCard(c):`<span class="empty-symbol">+</span><span class="slot-label">${label}</span>`}${shared&&c?'<span class="ex-label">EX区</span>':''}</div>`;
}
function pile(p,zone){
  const cards=doc.cards.filter(c=>c.controller===p&&c.zone===zone),down=cards.filter(c=>Boolean(c.position&10)).length;
  const label=`${p?'对方':'我方'}${ZONES[zone]}`,printing=cards.some(c=>cardScripts(doc,c.uid).some(s=>s.printing&&scriptValue(doc,s).trim()));
  return `<div class="field-slot pile" tabindex="0" role="button" data-player="${p}" data-zone="${zone}" data-seq="0" aria-label="${label} ${cards.length}张">${cards.length?cardSurface(cards[0].code,catalog.get(cards[0].code)?.name||cards[0].code,cards[0].position,p?180:0,'stack:'+cards[0].uid):''}<span class="pile-count">${cards.length||'+'}</span><span class="slot-label">${label}</span>${printing?'<span class="script-badge">印卡</span>':''}${zone==='removed'&&cards.length?`<span class="pile-faces">表 ${cards.length-down} / 里 ${down}</span>`:''}</div>`;
}
function renderField(){
  $('duel-field').innerHTML=fieldMarkup(doc.rule,slot,pile);
  for(const p of [0,1]){const cards=doc.cards.filter(c=>c.controller===p&&c.zone==='hand');$(p?'opponent-hand':'player-hand').innerHTML=`<div class="shelf-label">${p?'对方':'我方'}手牌<small>${cards.length} CARDS</small></div><div class="hand-cards" data-player="${p}" data-zone="hand" data-seq="0">${cards.length?cards.map(c=>boardCard(c,true)).join(''):'<span class="hand-empty">点击 + 添加手牌</span>'}</div><button class="shelf-add" data-add-hand="${p}" aria-label="添加${p?'对方':'我方'}手牌">+</button>`;}
}
function render(){
  const previousViews=captureCardViews();
  document.body.classList.toggle('project-closed',!projectOpen);$('closed-project').hidden=projectOpen;for(const id of ['project-title','rule-select','lp-0','lp-1','settings','export-project','save-project','inspect-project'])$(id).disabled=!projectOpen;$('project-title').placeholder='未打开工程';$('project-title').value=projectOpen?doc.title:'';$('rule-select').value=doc.rule;$('lp-0').value=doc.players[0].lp;$('lp-1').value=doc.players[1].lp;$('player-name').textContent=doc.players[0].name;$('opponent-name').textContent=doc.players[1].name;
  $('field-card-count').textContent=projectOpen?`${doc.cards.length} 张卡片`:'未打开工程';$('undo').disabled=!history.length;$('redo').disabled=!future.length;
  const check=validate(doc,catalog);$('validation-status').textContent=check.errors.length?`${check.errors.length} 项需要处理`:check.warnings.length?`${check.warnings.length} 项场地提示`:'场地已就绪';$('validation-status').title=[...check.errors,...check.warnings].join('\n');$('validation-status').className=check.errors.length?'danger':'';
  renderField();renderInspector();if(activePile&&$('pile-dialog').open)renderPile();decorate();animateCardViews(previousViews);document.documentElement.dataset.projectDirty=modified()?'true':'false';
}
function options(values,selected,empty=''){return (empty?`<option value="">${empty}</option>`:'')+Object.entries(values).map(([v,label])=>`<option value="${v}" ${Number(v)===Number(selected)?'selected':''}>${esc(label)}</option>`).join('');}
function inputStat(c,key,label,placeholder){return `<label>${label}<input type="number" min="0" max="2147483647" data-stat="${key}" value="${c.overrides[key]??''}" placeholder="${esc(placeholder??'不修改')}"></label>`;}
function activeImportedScript(c){const scripts=cardScripts(doc,c.uid);return scripts.find(s=>s.id===importedScriptSelection)||scripts[0];}
function renderInspector(){
  const c=projectOpen?doc.cards.find(c=>c.uid===selection):null,m=catalog.get(c?.code??previewCode),root=$('inspector-content');for(const id of ['replace-card','duplicate-card','delete-card'])$(id).disabled=!c;$('close-project').disabled=!projectOpen;
  if(!m){root.innerHTML=`<div class="inspector-empty"><div class="empty-orbit">${icon('card')}</div><h3>未选择卡片</h3><p>点击场地格子添加卡片<br>选中卡片后可修改状态和效果</p><button id="empty-settings" class="quiet">残局设置 ${icon('arrow')}</button></div>`;return;}
  root.innerHTML=`<div class="inspect-hero"><img src="/card-image/${m.id}" alt="${esc(m.name)}"><span class="hero-type">${esc(typeName(m))}${m.type&1?' · '+(ATTRIBUTES[m.attribute]||'')+' / '+(RACES[m.race]||'')+'族':''}</span></div><div class="card-description top-card-description">${esc(m.desc)}</div><h3 class="inspect-title">${esc(m.name)}</h3><div class="inspect-code"><span># ${m.id}</span><span>${c?`${c.controller?'对方':'我方'} · ${c.zone==='mzone'&&c.seq>=5?'EX区':ZONES[c.zone]}`:'卡库预览'}</span></div>${!c?`<div class="notice">点击场地上的格子，选择这张卡片放置。</div>`:`<div class="inspect-tabs"><button data-tab="basic" class="${tab==='basic'?'active':''}">状态</button><button data-tab="effects" class="${tab==='effects'?'active':''}">效果</button><button data-tab="lua" class="${tab==='lua'?'active':''}">Lua</button></div><div id="inspector-tab"></div>`}`;
  if(!c)return;
  let body='';
  if(tab==='basic'){
    body=`<div class="two-columns"><label>控制者<select id="card-controller">${options({0:'我方',1:'对方'},c.controller)}</select></label><label>原持有者<select id="card-owner">${options({0:'我方',1:'对方'},c.owner)}</select></label></div><label>表示形式</label><div class="position-options">${allowedPositions(c,m).map(p=>`<button data-position="${p}" class="${c.position===p?'active':''}">${c.zone==='mzone'?POSITIONS[p]:[2,8].includes(p)?'里侧':'表侧'}</button>`).join('')}</div><div class="field-group"><h3>数值覆盖 <span class="stat-hint">留空 = 不修改</span></h3><div class="two-columns">${inputStat(c,'attack','攻击力',m.atk)}${m.type&0x4000000?'':inputStat(c,'defense','守备力',m.def)}${inputStat(c,'baseAttack','原本攻击力',m.atk)}${m.type&0x4000000?'':inputStat(c,'baseDefense','原本守备力',m.def)}${m.type&0x4000000?'':inputStat(c,m.type&0x800000?'rank':'level',m.type&0x800000?'阶级':'等级',m.level)}</div>${m.type&0x1000000?`<div class="two-columns">${inputStat(c,'lscale','左刻度',m.lscale)}${inputStat(c,'rscale','右刻度',m.rscale)}</div>`:''}</div><label class="check-row"><input id="proc-complete" type="checkbox" ${c.proc?'checked':''}>已正规出场（苏生相关状态）</label>${m.type&1?`<div class="field-group"><h3>召唤记录</h3><div class="two-columns"><label>召唤方式<select id="card-summon-type">${options({...SUMMON_TYPES,...(c.summonType&&!SUMMON_TYPES[c.summonType]?{[c.summonType]:'自定义 · '+c.summonType}: {})},c.summonType||0)}</select></label><label>召唤前区域<select id="card-summon-location">${options(SUMMON_LOCATIONS,c.summonLocation||0)}</select></label></div></div>`:''}`;
    if(doc.rule>=4&&((c.zone==='szone'&&[0,4].includes(c.seq))||c.zone==='pzone')&&m.type&0x1000000)body+=`<label class="check-row"><input id="pendulum-role" type="checkbox" ${c.zone==='pzone'?'checked':''}>作为灵摆区卡片</label>`;
    if(c.zone==='mzone'&&m.type&0x800000){const materials=doc.cards.filter(x=>x.overlayOf===c.uid);body+=`<div class="field-group"><h3>超量素材 · ${materials.length}</h3>${materials.map(x=>miniRow(x,true)).join('')}<button class="add-card-button" id="add-material">+ 添加素材</button></div>`;}
  }else if(tab==='effects'){
    body=`<div class="field-group grant-group"><h3>附加卡片效果</h3><button id="open-grants" class="add-card-button">+ 从卡片提取效果</button>${(c.grants||[]).map((g,i)=>`<div class="granted-effect"><header><span>${esc(g.sourceName)}</span><button class="icon-button danger" data-remove-grant="${i}" aria-label="移除提取效果">×</button></header><p>${esc(g.summary)}</p></div>`).join('')}<p class="grant-state-hint">设置开局已获得的效果；正常召唤的赋予过程由原卡脚本处理。</p>${doc.cards.filter(x=>x.overlayOf===c.uid).map(x=>`<div class="material-effect-row">超量素材：${esc(catalog.get(x.code)?.name||x.code)}<button data-remove-card="${x.uid}" aria-label="移除素材">−</button></div>`).join('')}</div><h3 class="section-header">抗性</h3>${[['battle','不会被战斗破坏'],['effect','不会被效果破坏'],['target','不能成为效果对象'],['immune','不受其他卡片效果影响']].map(([key,label])=>`<label class="check-row"><input type="checkbox" data-protection="${key}" ${c.protections?.[key]?'checked':''}>${label}</label>`).join('')}<div class="field-group"><h3>属性与种族（效果修改）</h3><div class="two-columns"><label>属性<select data-stat="attribute">${options(ATTRIBUTES,c.overrides.attribute,'不修改')}</select></label><label>种族<select data-stat="race">${options(RACES,c.overrides.race,'不修改')}</select></label></div><p class="muted">仅对当前残局实例施加属性与种族效果。</p></div><div class="field-group"><h3>效果设置</h3><label class="check-row"><input id="reset-on-leave" type="checkbox" ${c.resetOnLeave!==false?'checked':''}>离场等标准事件时重置</label><label class="check-row"><input id="unnegatable" type="checkbox" ${c.unnegatable?'checked':''}>这些效果不能被无效</label></div><div class="field-group"><h3>装备对象</h3><select id="equip-target"><option value="">无</option>${doc.cards.filter(x=>x.zone==='mzone'&&[1,4].includes(x.position)&&x.uid!==c.uid).map(x=>`<option value="${x.uid}" ${c.equipTo===x.uid?'selected':''}>${esc(cardLabel(x))}</option>`).join('')}</select><h3 class="field-group">永续效果对象</h3><select id="add-target"><option value="">+ 添加对象</option>${doc.cards.filter(x=>x.uid!==c.uid&&!c.targetIds.includes(x.uid)).map(x=>`<option value="${x.uid}">${esc(cardLabel(x))}</option>`).join('')}</select>${c.targetIds.map(id=>`<div class="mini-row"><span>${esc(cardLabel(doc.cards.find(x=>x.uid===id)))}</span><button data-remove-target="${id}" aria-label="移除对象">×</button></div>`).join('')}</div><div class="field-group"><h3>指示物</h3>${c.counters.map((x,i)=>`<div class="mini-row"><span>0x${x.type.toString(16).toUpperCase()} · ${x.count} 个</span><button data-remove-counter="${i}" aria-label="移除指示物">×</button></div>`).join('')}<div class="counter-inputs"><input id="counter-type" placeholder="编号 / 0x1" aria-label="指示物编号"><input id="counter-count" type="number" min="1" max="65535" value="1" aria-label="指示物数量"><button id="add-counter">+</button></div></div>`;
  }else{
    const imported=activeImportedScript(c),scripts=cardScripts(doc,c.uid);
    body=`${imported?`<div class="imported-script-heading"><strong>${esc(imported.title)}</strong><span>已从 Lua 导入</span></div>${scripts.length>1?`<select id="imported-script-select" aria-label="选择导入片段">${scripts.map((s,i)=>`<option value="${s.id}" ${s.id===imported.id?'selected':''}>${i+1}. ${esc(s.title)}</option>`).join('')}</select>`:''}<p class="muted">变量 <code>${esc(imported.alias)}</code> 指向这张卡；应用后替换原位置的脚本。</p>`:'<p class="muted">这里的 <code>c</code> 是选中卡片，<code>tp</code> 是其控制者。填写初始化代码，不需要包裹函数。</p>'}<select id="lua-template" class="lua-template"><option value="">插入模板…</option><option value="print">印卡能力（参考示例）</option><option value="protect">不会被效果破坏</option><option value="draw">起动效果：抽 1 张卡</option></select><textarea id="card-lua" class="code-input" rows="16" spellcheck="false" placeholder="-- 自定义初始化 Lua">${esc(imported?scriptValue(doc,imported):c.lua||'')}</textarea>${imported?`<details class="field-group"><summary>追加初始化 Lua${c.lua?.trim()?'（已有片段）':''}</summary><p class="muted">独立于上方导入脚本；c 为这张卡片，tp 为控制者。</p><textarea id="additional-card-lua" class="code-input" rows="8" spellcheck="false">${esc(c.lua||'')}</textarea></details>`:''}<button id="apply-card-lua" class="primary full-width">应用片段</button>${doc.sourceMap?`<details class="field-group"><summary>导入文件的原始脚本（只读）</summary><p class="muted">${doc.sourceMap.unhandled.length} 个语句保留原文和执行顺序。场地和可识别的参数会按当前编辑结果更新。</p><textarea class="code-input" rows="12" readonly>${esc(doc.sourceMap.source)}</textarea></details>`:''}`;
  }
  $('inspector-tab').innerHTML=body;
}
function cardLabel(c){return c?`${c.controller?'对方':'我方'} · ${catalog.get(c.code)?.name||c.code} · ${c.zone==='mzone'&&c.seq>=5?'EX区':ZONES[c.zone]}${c.zone==='mzone'&&c.seq<5?' '+(c.seq+1):''}`:'不存在的卡片';}
function miniRow(c,material=false){return `<div class="mini-row"><img src="/card-image/${c.code}" alt=""><span>${esc(catalog.get(c.code)?.name||c.code)}</span><button data-select-instance="${c.uid}" aria-label="选择素材">${icon('arrow')}</button>${material?`<button data-remove-card="${c.uid}" aria-label="删除素材">×</button>`:''}</div>`;}
function selectCard(id){importedScriptSelection=null;if($('pile-dialog').open)$('pile-dialog').close();activePile=null;selection=id;previewCode=null;target=null;render();}
function showPicker(destination){
  if(!projectOpen){toast('请先新建或打开工程',true);return;}
  target={...destination};
  const shared=destination.zone==='mzone'&&destination.seq>=5&&!destination.replace;
  target.shared=shared;
  $('shared-controller-row').hidden=!shared;
  if(shared){target.physicalSequence=destination.controller===0?destination.seq:11-destination.seq;$('shared-controller').value=String(destination.controller);}
  const isMaterial=destination.zone==='overlay';
  $('picker-title').textContent=destination.replace?'替换卡片':isMaterial?'添加超量素材':shared?'EX区 · 选择卡片':`${destination.controller?'对方':'我方'} · ${ZONES[destination.zone]}${['mzone','szone'].includes(destination.zone)?' '+(destination.seq+1):''}`;
  $('picker-search').value='';$('picker-type').value=destination.zone==='pzone'?'pendulum':'all';
  $('picker-dialog').showModal();loadPicker();$('picker-search').focus();
}
async function loadPicker(more=false){const token=++pickerToken;if(!more)pickerOffset=0;const q=$('picker-search').value.trim(),category=$('picker-type').value;let result;
  try{result=await(await api(`/api/cards?q=${encodeURIComponent(q)}&type=${category}&offset=${pickerOffset}&limit=40`)).json();if(token!==pickerToken)return;result.cards.forEach(c=>catalog.set(c.id,c));if(!more)$('picker-results').innerHTML='';$('picker-results').insertAdjacentHTML('beforeend',result.cards.map(cardButton).join(''));if(!result.cards.length&&!more)$('picker-results').innerHTML='<div class="blank-search">没有匹配的卡片</div>';pickerOffset+=result.cards.length;$('picker-count').textContent=`${result.total.toLocaleString()} 个结果 · 点击放置`;$('picker-more').disabled=pickerOffset>=result.total;}catch(e){toast(e.message,true);}}
function addAt(code,destination,instance=null){
  if(!projectOpen)return false;
  const next=clone(doc);let card=instance?next.cards.find(c=>c.uid===instance):null;
  if(!card){card=newCard(code,destination.controller,destination.zone,destination.seq);next.cards.push(card);}else Object.assign(card,{controller:destination.controller,zone:destination.zone,seq:destination.seq,overlayOf:null});
  if(destination.replace){next.cards=next.cards.filter(x=>x.uid!==card.uid);const replaced=next.cards.find(c=>c.uid===destination.replace);card=replaced;card.code=code;}
  if(destination.zone==='overlay'){card.overlayOf=destination.host;card.zone='overlay';card.seq=0;}
  if(!allowedPositions(card,catalog.get(code)).includes(card.position))card.position=allowedPositions(card,catalog.get(code))[0];
  for(const material of next.cards.filter(x=>x.overlayOf===card.uid))material.controller=card.controller;
  const check=validate(next,catalog);if(check.errors.length){toast(check.errors[0],true);return false;}
  commit(()=>{projectOpen=true;doc=next;selection=card.uid;previewCode=null;},'已放置卡片');return true;
}
function editCard(change){const c=doc.cards.find(c=>c.uid===selection);if(c)commit(()=>change(c));}
function inspectPile(p,zone){
  activePile={controller:p,zone,seq:0};target=null;
  renderPile();if(!$('pile-dialog').open)$('pile-dialog').showModal();
}
function renderPile(){
  if(!activePile)return;
  const {controller:p,zone}=activePile,cards=doc.cards.filter(c=>c.controller===p&&c.zone===zone);
  $('pile-title').textContent=`${p?'对方':'我方'} · ${ZONES[zone]}`;
  $('pile-summary').textContent=`${cards.length} 张${zone==='deck'?' · 列表第一张为牌堆顶':zone==='removed'?' · 可切换表侧 / 里侧':''}`;
  $('pile-cards').innerHTML=cards.length?cards.map((c,i)=>{
    const meta=catalog.get(c.code),down=Boolean(c.position&10),face=zone==='removed'||zone==='extra';
    return `<article class="pile-item ${down?'is-facedown':''}"><button class="pile-card-preview" draggable="false" data-instance="${c.uid}" data-select-instance="${c.uid}" aria-label="编辑 ${esc(meta?.name||c.code)}">${cardSurface(c.code,meta?.name||c.code,c.position,0,'pile:'+c.uid)}<span class="pile-card-name">${i+1}. ${esc(meta?.name||c.code)}</span></button><div class="pile-card-info"><span># ${c.code}${cardScripts(doc,c.uid).some(s=>s.printing&&scriptValue(doc,s).trim())?' · 印卡':''}</span><span class="face-tag">${down?'里侧':'表侧'}</span></div><div class="pile-item-actions"><div><button data-order="${c.uid}" data-delta="-1" aria-label="上移 ${esc(meta?.name||c.code)}" ${i===0?'disabled':''}>↑</button><button data-order="${c.uid}" data-delta="1" aria-label="下移 ${esc(meta?.name||c.code)}" ${i===cards.length-1?'disabled':''}>↓</button></div>${face?`<button class="quiet" data-pile-flip="${c.uid}">改为${down?'表侧':'里侧'}</button>`:`<button class="quiet" data-select-instance="${c.uid}">编辑</button>`}<button class="icon-button danger" data-remove-card="${c.uid}" aria-label="删除 ${esc(meta?.name||c.code)}">${icon('trash')}</button></div></article>`;
  }).join(''):'<div class="pile-empty">此区域没有卡片</div>';
}
async function openGrants(){
  const c=doc.cards.find(c=>c.uid===selection);if(!c)return;
  if(c.zone!=='mzone'||!(catalog.get(c.code)?.type&1)){toast('请先选中怪兽区的怪兽',true);return;}
  grantRecipient=c.uid;grantVisible=60;$('grant-search').value='';$('grant-results').innerHTML='<p class="muted">正在扫描本地素材效果脚本…</p>';$('grant-dialog').showModal();
  if(grantSources.length){renderGrants();return;}
  try{
    const sources=await(await api('/api/grants')).json();grantScanCount=sources.length;
    for(let i=0;i<sources.length;i++){
      const entry=sources[i];try{const result=discoverGrants(entry);for(const grant of result.grants)grantSources.push({...entry,grant,key:grant.sourceKey});for(const error of result.errors)grantSources.push({...entry,error:error.message,key:entry.code+':pending:'+error.operation});if(!result.grants.length&&!result.errors.length&&/获得以下效果|得到以下效果|追加以下效果/.test(entry.description))grantSources.push({...entry,error:'此脚本通过特殊流程赋予效果，需在卡片 Lua 中手动配置',key:entry.code+':pending'});}catch(e){grantSources.push({...entry,error:e.message,key:entry.code+':pending'});}
      if(i%20===0){$('grant-status').textContent=`正在扫描 ${i+1} / ${sources.length}`;await new Promise(requestAnimationFrame);}
    }
    renderGrants();
  }catch(e){$('grant-results').textContent=e.message;}
}
function renderGrants(){
  const fold=s=>String(s).normalize('NFKC').replace(/[^\p{L}\p{N}]/gu,'').toLowerCase(),query=fold($('grant-search').value),recipient=doc.cards.find(c=>c.uid===grantRecipient);
  const filtered=grantSources.filter(g=>(!g.error||$('grant-show-pending').checked)&&fold(g.name+' '+g.code+' '+g.summary).includes(query));
  const valid=grantSources.filter(g=>g.grant).length,pending=grantSources.filter(g=>g.error).length;
  $('grant-status').textContent=`扫描 ${grantScanCount} 张候选卡 · ${valid} 种可用 · ${pending} 种需手动处理`;
  $('grant-results').innerHTML=filtered.slice(0,grantVisible).map(g=>{
    const added=g.grant?.mode==='overlay'?doc.cards.some(c=>c.overlayOf===recipient?.uid&&c.code===g.code):recipient?.grants?.some(x=>x.sourceKey===g.key||!x.sourceKey&&x.sourceCode===g.code);
    const wrongHost=g.grant?.mode==='overlay'&&!(catalog.get(recipient?.code)?.type&0x800000);
    return `<article class="grant-source"><div class="grant-source-header"><img src="/card-image/${g.code}" alt="${esc(g.name)}"><div><h3>${esc(g.name)}</h3><small># ${g.code} · ${esc(g.grant?.title||'需手动处理')}</small></div><button class="primary" data-apply-grant="${esc(g.key)}" ${added||g.error||wrongHost?'disabled':''}>${added?'已添加':wrongHost?'需要超量怪兽':g.grant?.mode==='overlay'?'添加为素材':'附加效果'}</button></div><p>${esc(g.summary)}</p><details><summary>原卡条件与脚本</summary><p>${esc(g.description)}</p><small>${esc(g.path)} · SHA-256 ${g.hash.slice(0,12)}</small><pre>${esc(g.error?g.source:g.grant?.mode==='overlay'?'通过真实超量素材保留原脚本全部效果；取除素材后按游戏规则失效。':g.grant.lua)}</pre></details>${g.error?`<p class="danger">${esc(g.error)}</p>`:''}</article>`;
  }).join('')||'<div class="pile-empty">没有匹配的效果来源</div>';
  $('grant-more').hidden=filtered.length<=grantVisible;
}
function download(content,name,type='application/json'){const blob=content instanceof Blob?content:new Blob([content],{type});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
async function saveProject(){
  if(!projectOpen)return false;const title=$('project-title').value.trim()||'未命名残局';if(!applyPendingLua())return false;applyPendingTitle(title);
  const content=JSON.stringify(doc,null,2),filename=doc.title+'.puzzle.json';
  try{
    if(window.pywebview?.api?.save_project){const result=await window.pywebview.api.save_project(content,filename);if(result.error)throw Error(result.error);if(!result.saved)return false;toast('已保存工程：'+result.path);}
    else{download(content,filename);toast('工程已下载');}
    markClean();autosave();render();return true;
  }catch(error){toast('保存失败：'+error.message,true);return false;}
}
function renderSettingsLines(){
  for(const kind of ['description','hints'])$(kind==='description'?'description-lines':'hint-lines').innerHTML=settingsLines[kind].map((text,i)=>`<div class="line-row"><span>${i+1}</span>${kind==='description'?`<input data-line-kind="${kind}" value="${esc(text)}" aria-label="残局说明第 ${i+1} 行">`:`<textarea rows="2" data-line-kind="${kind}" aria-label="开场提示第 ${i+1} 条">${esc(text)}</textarea>`}<button type="button" data-remove-line="${kind}" data-line-index="${i}" aria-label="删除${kind==='description'?'残局说明':'开场提示'}第 ${i+1} ${kind==='description'?'行':'条'}">−</button></div>`).join('');
}
function collectSettingsLines(kind){return [...document.querySelectorAll(`[data-line-kind="${kind}"]`)].map(e=>e.value);}
function openSettings(){const f=$('settings-form');for(const p of [0,1]){f.elements['name'+p].value=doc.players[p].name;f.elements['start'+p].value=doc.players[p].startCount;f.elements['draw'+p].value=doc.players[p].drawCount;}settingsLines={description:doc.description?doc.description.split('\n'):[''],hints:[...doc.hints]};renderSettingsLines();f.elements.solution.value=doc.solution;f.elements.shuffle.checked=doc.pseudoShuffle;f.elements.lua.value=doc.initializationLua||'';$('settings-dialog').showModal();}
function openExport(){try{exported=exportLua(doc,catalog);const parser=globalThis.luaparse;if(parser)parser.parse(exported,{luaVersion:'5.3'});$('lua-preview').textContent=exported;const check=validate(doc,catalog);$('export-notices').innerHTML=[...check.warnings.map(s=>`<div class="notice warning">${esc(s)}</div>`),...(doc.sourceMap?.unhandled.length?[`<div class="notice">导入文件的 ${doc.sourceMap.unhandled.length} 个自定义语句保留执行顺序；已识别的卡片片段按编辑结果替换。行为仍需在游戏中测试。</div>`]:[])].join('');$('export-dialog').showModal();}catch(e){toast(e.message,true);}}
async function sendExport(packageOnly){try{const r=await api(packageOnly?'/api/package':'/api/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:doc.title,lua:exported,document:doc})});if(packageOnly){download(await r.blob(),doc.title+'.zip');toast('完整包已下载');}else{const result=await r.json();toast('已保存：'+result.path);}}catch(e){toast(e.message,true);}}
function confirmReplace(){return true;} // Replaced projects remain in undo history.
async function loadDocument(next){prepareCardScripts(next);await hydrate(next);const check=validate(next,catalog);if(check.errors.length)throw Error(check.errors.join('\n'));commit(()=>{projectOpen=true;doc=next;selection=next.sourceMap?.cardScripts?.find(s=>s.printing&&scriptValue(next,s).trim())?.uid||null;previewCode=null;tab=selection?'lua':'basic';});markClean();autosave();render();loadLibrary();}
async function demo(){if(!confirmReplace())return;const next=newDocument();next.title='示例场面';next.description='用于熟悉编辑器功能的示例场面。';const positions=[[89631139,1,'mzone',2],[14558127,1,'hand',0],[24094653,1,'szone',2],[1861629,0,'mzone',5],[46986414,0,'mzone',2],[83764718,0,'hand',0],[23434538,0,'hand',0],[16178681,0,'pzone',0],[73915051,0,'szone',3]];for(const args of positions)next.cards.push(newCard(...args));next.cards[2].position=2;next.cards[3].protections={battle:true};next.cards[3].proc=true;await loadDocument(next);selection=next.cards[3].uid;render();}
const templates={protect:`local e=Effect.CreateEffect(c)\ne:SetType(EFFECT_TYPE_SINGLE)\ne:SetCode(EFFECT_INDESTRUCTABLE_EFFECT)\ne:SetValue(1)\nc:RegisterEffect(e)`,draw:`local e=Effect.CreateEffect(c)\ne:SetType(EFFECT_TYPE_IGNITION)\ne:SetRange(LOCATION_MZONE)\ne:SetCountLimit(1)\ne:SetOperation(function(e,tp)\n  Duel.Draw(tp,1,REASON_EFFECT)\nend)\nc:RegisterEffect(e)`,print:`-- 参考“残局-真印寂血”：双方可从额外卡组发动印卡能力\nlocal e=Effect.CreateEffect(c)\ne:SetType(EFFECT_TYPE_IGNITION)\ne:SetProperty(EFFECT_FLAG_BOTH_SIDE)\ne:SetRange(LOCATION_EXTRA)\ne:SetOperation(function(e,tp)\n  local toHand=false\n  if Duel.GetFlagEffect(tp,4392470)==0 then\n    toHand=Duel.SelectYesNo(tp,aux.Stringid(15978426,1))\n  end\n  local code=Duel.AnnounceCard(tp)\n  local token=Duel.CreateToken(tp,code)\n  if toHand and not token:IsType(TYPE_MONSTER) then\n    Debug.Message("只能添加怪兽卡到手卡")\n    return\n  end\n  if toHand then\n    Duel.SendtoHand(token,nil,REASON_RULE)\n    Duel.ShuffleHand(tp)\n    Duel.RegisterFlagEffect(tp,4392470,0,0,1)\n  else\n    Duel.Remove(token,POS_FACEUP,REASON_RULE)\n    Duel.SendtoDeck(token,tp,0,REASON_RULE)\n  end\nend)\nc:RegisterEffect(e)`};

// Delegated events keep the field and inspector independent from DOM node identity.
document.addEventListener('click',event=>{
  const lineButton=event.target.closest('[data-add-line],[data-remove-line]');if(lineButton){const kind=lineButton.dataset.addLine||lineButton.dataset.removeLine;settingsLines[kind]=collectSettingsLines(kind);if(lineButton.dataset.addLine)settingsLines[kind].push('');else settingsLines[kind].splice(Number(lineButton.dataset.lineIndex),1);renderSettingsLines();return;}
  const local=event.target.closest('[data-local-puzzle]');if(local){openLocalPuzzle(local.dataset.localPuzzle);return;}
  const close=event.target.closest('[data-close]');if(close){$(close.dataset.close).close();return;}
  const instance=event.target.closest('[data-instance]');if(instance){event.stopPropagation();selectCard(instance.dataset.instance);return;}
  const choose=event.target.closest('[data-code]');if(choose){const code=Number(choose.dataset.code);if(choose.closest('#picker-results')){if(target&&addAt(code,target)){$('picker-dialog').close();target=null;}}else{previewCode=code;selection=null;render();}return;}
  const flip=event.target.closest('[data-pile-flip]');if(flip){commit(()=>{const card=doc.cards.find(c=>c.uid===flip.dataset.pileFlip);if(card)card.position=card.position&10?1:8;});return;}
  const removeGrant=event.target.closest('[data-remove-grant]');if(removeGrant){editCard(c=>c.grants.splice(Number(removeGrant.dataset.removeGrant),1));return;}
  const grantButton=event.target.closest('[data-apply-grant]');if(grantButton){try{
    const entry=grantSources.find(g=>g.key===grantButton.dataset.applyGrant),recipient=doc.cards.find(c=>c.uid===grantRecipient);if(!entry?.grant||!recipient)throw Error('接收者或效果已不存在');
    if(entry.grant.mode==='overlay'){
      if(!(catalog.get(recipient.code)?.type&0x800000))throw Error('请选中超量怪兽');
      if(doc.cards.some(c=>c.overlayOf===recipient.uid&&c.code===entry.code))return;
      commit(()=>{const material=newCard(entry.code,recipient.controller,'overlay');material.overlayOf=recipient.uid;doc.cards.push(material);});
    }else{if(recipient.grants?.some(g=>g.sourceKey===entry.key||!g.sourceKey&&g.sourceCode===entry.code))return;commit(()=>{recipient.grants??=[];recipient.grants.push(clone(entry.grant));});}
    renderGrants();toast(entry.grant.mode==='overlay'?'已添加真实超量素材':'已附加素材赋予效果');
  }catch(e){toast(e.message,true);}return;}
  const field=event.target.closest('.field-slot');if(field){const destination={controller:Number(field.dataset.player),zone:field.dataset.zone,seq:Number(field.dataset.seq)};if(LIST_ZONES.includes(destination.zone))inspectPile(destination.controller,destination.zone);else showPicker(destination);return;}
  const hand=event.target.closest('[data-add-hand]');if(hand){showPicker({controller:Number(hand.dataset.addHand),zone:'hand',seq:0});return;}
  const tabButton=event.target.closest('[data-tab]');if(tabButton){tab=tabButton.dataset.tab;renderInspector();decorate();return;}
  const pos=event.target.closest('[data-position]');if(pos){editCard(c=>c.position=Number(pos.dataset.position));return;}
  const select=event.target.closest('[data-select-instance]');if(select){selectCard(select.dataset.selectInstance);return;}
  const del=event.target.closest('[data-remove-card]');if(del){commit(()=>removeCard(doc,del.dataset.removeCard));return;}
  const counter=event.target.closest('[data-remove-counter]');if(counter){editCard(c=>c.counters.splice(Number(counter.dataset.removeCounter),1));return;}
  const ref=event.target.closest('[data-remove-target]');if(ref){editCard(c=>c.targetIds=c.targetIds.filter(x=>x!==ref.dataset.removeTarget));return;}
  const order=event.target.closest('[data-order]');if(order){const c=doc.cards.find(c=>c.uid===order.dataset.order),pile=doc.cards.filter(x=>x.controller===c.controller&&x.zone===c.zone),i=pile.indexOf(c),j=i+Number(order.dataset.delta);if(j>=0&&j<pile.length){commit(()=>{const a=doc.cards.indexOf(c),b=doc.cards.indexOf(pile[j]);[doc.cards[a],doc.cards[b]]=[doc.cards[b],doc.cards[a]];});inspectPile(c.controller,c.zone);}return;}
  const c=doc.cards.find(c=>c.uid===selection);
  switch(event.target.closest('button')?.id){
    case 'delete-card':if(c)commit(()=>{removeCard(doc,c.uid);selection=null;},'已删除');break;
    case 'duplicate-card':if(c)commit(()=>{const copy=clone(c);copy.uid=uid();copy.zone='hand';copy.seq=0;copy.position=1;copy.overlayOf=null;copy.equipTo=null;copy.targetIds=[];copy.grants=[];copy.summonType=0;copy.summonLocation=0;doc.cards.push(copy);selection=copy.uid;});break;
    case 'replace-card':if(c)showPicker({controller:c.controller,zone:c.zone,seq:c.seq,host:c.overlayOf,replace:c.uid});break;
    case 'add-material':if(c)showPicker({controller:c.controller,zone:'overlay',seq:0,host:c.uid});break;
    case 'pile-add':if(activePile)showPicker(activePile);break;
    case 'open-grants':openGrants();break;
    case 'add-counter':{const type=Number($('counter-type').value),count=Number($('counter-count').value);if(!Number.isInteger(type)||type<1||type>65535||!Number.isInteger(count)||count<1||count>65535){toast('请填写有效的指示物编号和数量',true);break;}editCard(c=>{const old=c.counters.find(x=>x.type===type);if(old)old.count+=count;else c.counters.push({type,count});});break;}
    case 'apply-card-lua':if(applyPendingLua())toast('Lua 片段已应用');break;
    case 'empty-settings':openSettings();break;
  }
});
document.addEventListener('change',event=>{
  const e=event.target,c=doc.cards.find(c=>c.uid===selection);
  if(e.dataset.stat&&c){editCard(c=>{if(e.value==='')delete c.overrides[e.dataset.stat];else c.overrides[e.dataset.stat]=Number(e.value);});return;}
  if(e.dataset.protection&&c){editCard(c=>c.protections[e.dataset.protection]=e.checked);return;}
  switch(e.id){case 'shared-controller':if(target?.shared){const physicalSequence=target.physicalSequence;target={...target,...exDestination(physicalSequence,Number(e.value)),physicalSequence};}break;case 'card-owner':editCard(c=>c.owner=Number(e.value));break;case 'card-controller':{const next=clone(doc),x=next.cards.find(x=>x.uid===selection),newP=Number(e.value);if(x.zone==='mzone'&&x.seq>=5)x.seq=11-x.seq;x.controller=newP;for(const a of next.cards.filter(a=>a.overlayOf===x.uid))a.controller=newP;const check=validate(next,catalog);if(check.errors.length){toast(check.errors[0],true);render();}else commit(()=>doc=next);break;}
    case 'card-summon-type':editCard(c=>c.summonType=Number(e.value));break;case 'card-summon-location':editCard(c=>c.summonLocation=Number(e.value));break;case 'proc-complete':editCard(c=>c.proc=e.checked);break;case 'reset-on-leave':editCard(c=>c.resetOnLeave=e.checked);break;case 'unnegatable':editCard(c=>c.unnegatable=e.checked);break;
    case 'pendulum-role':editCard(c=>{c.zone=e.checked?'pzone':'szone';c.seq=e.checked?(c.seq===0?0:1):(c.seq===0?0:4);c.position=1;});break;
    case 'equip-target':editCard(c=>c.equipTo=e.value||null);break;case 'add-target':if(e.value)editCard(c=>c.targetIds.push(e.value));break;
    case 'imported-script-select':importedScriptSelection=e.value;renderInspector();break;case 'lua-template':if(e.value&&$('card-lua')){const imported=activeImportedScript(c);if(e.value==='print'&&imported?.printing)toast('上方已显示导入的印卡能力，无需重复添加');else{const editor=$('additional-card-lua')||$('card-lua');editor.value=[editor.value,templates[e.value]].filter(Boolean).join('\n\n');if(editor.id==='additional-card-lua')editor.closest('details').open=true;}e.value='';}break;
  }
});
function hideDeleteDrop(){
  const zone=$('delete-drop-zone');if(zone.hidePopover&&zone.matches(':popover-open'))zone.hidePopover();zone.hidden=true;zone.classList.remove('drop-ready');
}
function finishDrag(){draggedInstance=null;hideDeleteDrop();document.querySelectorAll('.drop-over').forEach(e=>e.classList.remove('drop-over'));}
function updateDeleteDrop(event,hit=event.target){
  if(!draggedInstance)return;
  const zone=$('delete-drop-zone'),card=doc.cards.find(c=>c.uid===draggedInstance);
  if(!card)return;
  if(event.clientY>=window.innerHeight-160){
    if(zone.hidden){$('delete-drop-name').textContent=catalog.get(card.code)?.name||String(card.code);(document.querySelector('dialog[open]')||document.body).append(zone);zone.hidden=false;
      // Popovers remain above an open pile dialog without replacing that dialog.
      if(zone.showPopover)zone.showPopover();
    }
  }else if(event.clientY<window.innerHeight-190)hideDeleteDrop();
  const over=!!hit?.closest('#delete-drop-zone');zone.classList.toggle('drop-ready',over);
  if(over){event.preventDefault();if(event.dataTransfer)event.dataTransfer.dropEffect='move';}
}
// Pointer dragging keeps existing cards movable across dialogs and the delete
// popover, without depending on a browser's native image-drag session.
let pointerCard=null,suppressDragClick=false;
function endPointerDrag(){
  const ghost=$('card-drag-preview');if(ghost.hidePopover&&ghost.matches(':popover-open'))ghost.hidePopover();ghost.hidden=true;
  const drag=pointerCard;pointerCard=null;
  if(drag){drag.source.classList.remove('drag-source');if(drag.source.hasPointerCapture(drag.pointerId))drag.source.releasePointerCapture(drag.pointerId);}
  finishDrag();
}
function deleteDraggedCard(id){const card=doc.cards.find(c=>c.uid===id);if(!card)return;const name=catalog.get(card.code)?.name||card.code;commit(()=>{removeCard(doc,id);if(!doc.cards.some(c=>c.uid===selection))selection=null;},`已删除 ${name} · Ctrl+Z 撤销`);}
document.addEventListener('pointerdown',event=>{
  const source=event.target.closest('[data-instance]');if(!source||event.button!==0||pointerCard)return;
  pointerCard={id:source.dataset.instance,source,x:event.clientX,y:event.clientY,pointerId:event.pointerId,active:false};source.setPointerCapture(event.pointerId);
});
document.addEventListener('pointermove',event=>{
  const drag=pointerCard;if(!drag||drag.pointerId!==event.pointerId)return;
  if(!drag.active&&Math.hypot(event.clientX-drag.x,event.clientY-drag.y)<6)return;
  if(!drag.active){
    const card=doc.cards.find(c=>c.uid===drag.id);if(!card){endPointerDrag();return;}
    drag.active=true;draggedInstance=drag.id;drag.source.classList.add('drag-source');
    const ghost=$('card-drag-preview');(document.querySelector('dialog[open]')||document.body).append(ghost);ghost.innerHTML=`<img src="/card-image/${card.code}" alt=""><span>${esc(catalog.get(card.code)?.name||card.code)}</span>`;ghost.hidden=false;if(ghost.showPopover)ghost.showPopover();
  }
  event.preventDefault();
  const ghost=$('card-drag-preview');ghost.style.left=event.clientX+14+'px';ghost.style.top=event.clientY-28+'px';
  const hit=document.elementFromPoint(event.clientX,event.clientY);updateDeleteDrop(event,hit);
  document.querySelectorAll('.drop-over').forEach(el=>el.classList.remove('drop-over'));
  if(!hit?.closest('#delete-drop-zone'))hit?.closest('[data-zone]')?.classList.add('drop-over');
});
document.addEventListener('pointerup',event=>{
  const drag=pointerCard;if(!drag||drag.pointerId!==event.pointerId)return;
  if(!drag.active){endPointerDrag();return;}
  event.preventDefault();suppressDragClick=true;
  const hit=document.elementFromPoint(event.clientX,event.clientY),trash=hit?.closest('#delete-drop-zone'),field=hit?.closest('[data-zone]');
  endPointerDrag();
  if(trash)deleteDraggedCard(drag.id);
  else if(field){const card=doc.cards.find(c=>c.uid===drag.id);if(card){let destination={controller:Number(field.dataset.player),zone:field.dataset.zone,seq:Number(field.dataset.seq||0)};if(field.dataset.shared)destination=exDestination(destination.seq,card.controller);addAt(card.code,destination,drag.id);}}
  setTimeout(()=>suppressDragClick=false,0);
});
document.addEventListener('pointercancel',endPointerDrag);
document.addEventListener('lostpointercapture',event=>{if(pointerCard?.pointerId===event.pointerId)endPointerDrag();});
window.addEventListener('blur',endPointerDrag);
document.addEventListener('click',event=>{if(suppressDragClick){event.preventDefault();event.stopImmediatePropagation();suppressDragClick=false;}},true);
document.addEventListener('dragstart',event=>{finishDrag();const instance=event.target.closest('[data-instance]'),card=event.target.closest('[data-code]');if(instance){event.preventDefault();return;}if(card){draggedInstance=instance?.dataset.instance||null;event.dataTransfer.setData('application/x-puzzle-card',JSON.stringify(instance?{instance:draggedInstance}:{code:Number(card.dataset.code)}));event.dataTransfer.effectAllowed=instance?'move':'copy';}});
document.addEventListener('dragover',event=>{updateDeleteDrop(event);if(event.target.closest('#delete-drop-zone'))return;const destination=event.target.closest('[data-zone]');if(destination&&[...event.dataTransfer.types].includes('application/x-puzzle-card')){event.preventDefault();destination.classList.add('drop-over');}});
document.addEventListener('dragleave',event=>{event.target.closest('[data-zone]')?.classList.remove('drop-over');if(event.target.closest('#delete-drop-zone')&&!$('delete-drop-zone').contains(event.relatedTarget))$('delete-drop-zone').classList.remove('drop-ready');});
document.addEventListener('dragend',finishDrag);
document.addEventListener('drop',event=>{
  const trash=event.target.closest('#delete-drop-zone'),field=event.target.closest('[data-zone]');
  if(!trash&&!field){finishDrag();return;}
  event.preventDefault();
  try{
    const data=JSON.parse(event.dataTransfer.getData('application/x-puzzle-card'));
    if(trash){
      const card=doc.cards.find(c=>c.uid===data.instance);
      if(card&&data.instance===draggedInstance){const name=catalog.get(card.code)?.name||card.code;finishDrag();commit(()=>{removeCard(doc,card.uid);if(!doc.cards.some(c=>c.uid===selection))selection=null;},`已删除 ${name} · Ctrl+Z 撤销`);}
    }else{const code=data.code||doc.cards.find(c=>c.uid===data.instance)?.code;if(code){let destination={controller:Number(field.dataset.player),zone:field.dataset.zone,seq:Number(field.dataset.seq||0)};if(field.dataset.shared&&data.instance)destination=exDestination(destination.seq,doc.cards.find(c=>c.uid===data.instance).controller);addAt(code,destination,data.instance);}}
  }catch(e){toast(e.message,true);}finally{finishDrag();}
});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&pointerCard?.active){event.preventDefault();event.stopPropagation();endPointerDrag();return;}const editing=event.target.matches('input,textarea,select,[contenteditable]');if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();saveProject();return;}if(editing)return;if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){event.preventDefault();restore(event.shiftKey?'redo':'undo');}else if(event.key==='Delete'&&selection&&!document.querySelector('dialog[open]'))commit(()=>{removeCard(doc,selection);selection=null;});else if(event.key==='/'){event.preventDefault();$('search').focus();}else if(event.key==='Enter'||event.key===' '){const interactive=event.target.closest('.field-slot,[data-instance]');if(interactive){event.preventDefault();interactive.click();}}});
const debounce=(fn,delay=220)=>{let timer;return(...args)=>{clearTimeout(timer);timer=setTimeout(()=>fn(...args),delay);}};
$('search').addEventListener('input',debounce(()=>loadLibrary()));$('picker-search').addEventListener('input',debounce(()=>loadPicker()));$('picker-type').onchange=()=>loadPicker();$('extra-filter').onchange=()=>loadLibrary();
$('filters').onclick=e=>{const b=e.target.closest('[data-type]');if(!b)return;libraryType=b.dataset.type;$('extra-filter').value='';$('filters').querySelectorAll('button').forEach(x=>x.classList.toggle('active',x===b));loadLibrary();};
$('load-more').onclick=()=>loadLibrary(true);$('picker-more').onclick=()=>loadPicker(true);$('undo').onclick=()=>restore('undo');$('redo').onclick=()=>restore('redo');$('save-project').onclick=saveProject;$('open-project').onclick=async()=>{try{localPuzzles=await(await api('/api/puzzles')).json();renderLocalPuzzles();$('open-dialog').showModal();}catch(e){toast(e.message,true);}};$('open-file').onclick=()=>{$('open-dialog').close();$('file-input').click();};
$('project-title').onchange=e=>commit(()=>doc.title=e.target.value.trim()||'未命名残局');for(const p of [0,1])$('lp-'+p).onchange=e=>commit(()=>doc.players[p].lp=Number(e.target.value));
$('rule-select').onchange=e=>{const next=clone(doc);next.rule=Number(e.target.value);const check=validate(next,catalog);if(check.errors.length){toast('无法切换：'+check.errors[0],true);render();}else commit(()=>doc=next);};
$('settings').onclick=openSettings;$('inspect-project').onclick=openSettings;$('help').onclick=()=>$('help-dialog').showModal();$('export-project').onclick=openExport;$('demo').onclick=()=>demo().catch(e=>toast(e.message,true));
$('new-project').onclick=()=>{if(confirmReplace()){commit(()=>{projectOpen=true;doc=newDocument();selection=null;previewCode=null;});markClean();autosave();render();}};
$('file-input').onchange=async e=>{const f=e.target.files[0];if(!f)return;if(f.size>2_000_000){toast('文件超过 2 MB',true);return;}try{if(!confirmReplace())return;const text=await f.text(),next=f.name.toLowerCase().endsWith('.lua')?importLua(text,f.name):parseDocument(text);await loadDocument(next);toast(next.sourceMap?`已导入 ${next.cards.length} 张卡，${next.sourceMap.unhandled.length} 个自定义语句保留原文`:'工程已打开');}catch(error){toast(error.message,true);}finally{e.target.value='';}};
$('settings-form').onsubmit=e=>{e.preventDefault();const f=e.target;commit(()=>{for(const p of [0,1])Object.assign(doc.players[p],{name:f.elements['name'+p].value, startCount:Number(f.elements['start'+p].value),drawCount:Number(f.elements['draw'+p].value)});doc.description=collectSettingsLines('description').join('\n');doc.solution=f.elements.solution.value;doc.hints=collectSettingsLines('hints');doc.pseudoShuffle=f.elements.shuffle.checked;doc.initializationLua=f.elements.lua.value;});$('settings-dialog').close();};
$('copy-lua').onclick=async()=>{try{await navigator.clipboard.writeText(exported);toast('脚本已复制');}catch{toast('剪贴板不可用，请下载 Lua',true);}};$('download-lua').onclick=()=>download(exported,doc.title+'.lua','text/plain;charset=utf-8');$('download-package').onclick=()=>sendExport(true);$('install-puzzle').onclick=()=>sendExport(false);
$('grant-search').oninput=()=>{grantVisible=60;renderGrants();};$('grant-more').onclick=()=>{grantVisible+=60;renderGrants();};$('grant-show-pending').onchange=renderGrants;
$('close-project').onclick=requestCloseProject;$('start-new-project').onclick=()=>$('new-project').click();$('start-open-project').onclick=()=>$('open-project').click();
$('close-save-yes').onclick=async()=>{const action=pendingClose;pendingClose=null;$('close-save-dialog').close();if(await saveProject())action?.();};$('close-save-no').onclick=()=>{const action=pendingClose;pendingClose=null;$('close-save-dialog').close();action?.();};$('close-save-cancel').onclick=()=>{pendingClose=null;$('close-save-dialog').close();};$('close-save-dialog').addEventListener('cancel',()=>pendingClose=null);
$('pile-dialog').addEventListener('close',()=>{activePile=null;});
$('cancel-placement').onclick=()=>{target=null;$('placement-banner').hidden=true;};
let localPuzzles=[];
function renderLocalPuzzles(){const q=$('local-puzzle-search').value.toLowerCase();$('local-puzzles').innerHTML=localPuzzles.filter(p=>p.name.toLowerCase().includes(q)).map(p=>`<button class="local-puzzle-row quiet" data-local-puzzle="${esc(p.path)}"><span>${esc(p.name)}</span>${icon('arrow')}</button>`).join('');}
$('local-puzzle-search').oninput=renderLocalPuzzles;
async function openLocalPuzzle(path){if(!confirmReplace())return;try{const data=await(await api('/api/puzzle?path='+encodeURIComponent(path))).json();await loadDocument(importLua(data.source,data.name));$('open-dialog').close();toast('已导入本地残局');}catch(e){toast(e.message,true);}}
async function init(){decorate();try{const info=await(await api('/api/info')).json();$('library-total').textContent=info.count.toLocaleString();const saved=localStorage.getItem(STORAGE);if(saved){try{const next=parseDocument(saved);prepareCardScripts(next);await hydrate(next);doc=next;selection=next.sourceMap?.cardScripts?.find(s=>s.printing&&scriptValue(next,s).trim())?.uid||null;if(selection)tab='lua';cleanSnapshot=localStorage.getItem(STORAGE+'-dirty')==='1'?null:JSON.stringify(doc);}catch(e){toast('上次工程未能恢复：'+e.message,true);}}if(!saved){projectOpen=localStorage.getItem(STORAGE+'-closed')!=='1';cleanSnapshot=JSON.stringify(doc);}await loadLibrary();render();}catch(e){toast('无法读取本地资源：'+e.message,true);render();}}
startPictureRefresh();init();
