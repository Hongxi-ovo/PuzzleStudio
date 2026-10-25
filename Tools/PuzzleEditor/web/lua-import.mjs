import {newDocument,newCard,clone} from './model.mjs';
import {prepareCardScripts} from './lua-card-scripts.mjs';

const constants={SUMMON_TYPE_NORMAL:0x10000000,SUMMON_TYPE_ADVANCE:0x11000000,SUMMON_TYPE_DUAL:0x12000000,SUMMON_TYPE_FLIP:0x20000000,SUMMON_TYPE_SPECIAL:0x40000000,SUMMON_TYPE_FUSION:0x43000000,SUMMON_TYPE_RITUAL:0x45000000,SUMMON_TYPE_SYNCHRO:0x46000000,SUMMON_TYPE_XYZ:0x49000000,SUMMON_TYPE_PENDULUM:0x4a000000,SUMMON_TYPE_LINK:0x4c000000,LOCATION_DECK:1,LOCATION_HAND:2,LOCATION_MZONE:4,LOCATION_SZONE:8,LOCATION_GRAVE:16,LOCATION_REMOVED:32,LOCATION_EXTRA:64,LOCATION_OVERLAY:128,LOCATION_FZONE:256,LOCATION_PZONE:512,
  POS_FACEUP_ATTACK:1,POS_FACEDOWN_ATTACK:2,POS_FACEUP_DEFENSE:4,POS_FACEUP_DEFENCE:4,POS_FACEDOWN_DEFENSE:8,POS_FACEDOWN_DEFENCE:8,POS_FACEUP:5,POS_FACEDOWN:10,
  DUEL_TEST_MODE:1,DUEL_ATTACK_FIRST_TURN:2,DUEL_OLD_REPLAY:4,DUEL_OBSOLETE_RULING:8,DUEL_PSEUDO_SHUFFLE:16,DUEL_TAG_MODE:32,DUEL_SIMPLE_AI:64,DUEL_RETURN_DECK_TOP:128,DUEL_REVEAL_DECK_SEQ:256};
const zoneNames={1:'deck',2:'hand',4:'mzone',8:'szone',16:'grave',32:'removed',64:'extra',256:'fzone',512:'pzone'};
function stringValue(raw){
  if(raw.startsWith('[')){const m=raw.match(/^\[(=*)\[/);return raw.slice(m[0].length,-m[0].length).replace(/^\r?\n/,'');}
  return raw.slice(1,-1).replace(/\\(?:([0-9]{1,3})|x([0-9a-fA-F]{2})|(\r?\n)|(.))/gs,(_,d,h,n,c)=>d?String.fromCharCode(Number(d)):h?String.fromCharCode(parseInt(h,16)):n?'\n':({n:'\n',r:'\r',t:'\t',a:'\x07',b:'\b',f:'\f',v:'\v',z:''}[c]??c));
}
export function evaluate(node,env=constants){
  if(!node) return undefined;
  if(node.type==='NumericLiteral'||node.type==='BooleanLiteral')return node.value;
  if(node.type==='StringLiteral')return stringValue(node.raw);
  if(node.type==='Identifier'&&Object.hasOwn(env,node.name))return env[node.name];
  if(node.type==='UnaryExpression'){const v=evaluate(node.argument,env);if(node.operator==='-')return -v;if(node.operator==='~')return ~v;}
  if(node.type==='BinaryExpression'){const a=evaluate(node.left,env),b=evaluate(node.right,env);switch(node.operator){case '+':return a+b;case '-':return a-b;case '*':return a*b;case '/':return a/b;case '|':return a|b;case '&':return a&b;case '<<':return a<<b;case '>>':return a>>>b;}}
  throw Error(`不能静态求值：${node.type}${node.name?' '+node.name:''}`);
}
function callName(n){if(n?.type!=='CallExpression')return '';const b=n.base;return b.type==='MemberExpression'&&b.indexer==='.'&&b.base.type==='Identifier'?b.base.name+'.'+b.identifier.name:'';}
export function importLua(source,title='导入的残局',parser=globalThis.luaparse){
  if(!parser)throw Error('Lua 解析器未加载');
  if(source.length>2_000_000)throw Error('Lua 文件超过 2 MB');
  source=source.replace(/^\uFEFF/,'');
  const ast=parser.parse(source,{luaVersion:'5.3',ranges:true,locations:true,comments:true});
  const doc=newDocument();doc.title=title.replace(/\.lua$/i,'');
  const patches=[],aliases={},env={...constants},unhandled=[],importWarnings=[];let flags=66,flagsRaw=null,rule=5,foundBegin=false;
  for(const statement of ast.body){
    let call=statement.type==='CallStatement'?statement.expression:statement.init?.length===1?statement.init[0]:null;
    const name=callName(call),alias=statement.variables?.length===1&&statement.variables[0].type==='Identifier'?statement.variables[0].name:null;
    const patch={start:call?.range?.[0],end:call?.range?.[1],statementRange:statement.range,line:statement.loc.start.line};
    try{
      if(name==='Debug.ReloadFieldBegin'){
        try{flags=evaluate(call.arguments[0],env);}catch(error){flagsRaw=source.slice(...call.arguments[0].range);importWarnings.push(`第 ${statement.loc.start.line} 行的规则标志无法求值，原表达式已保留：${flagsRaw}`);}
        rule=call.arguments.length>1?evaluate(call.arguments[1],env):(flags&8?1:5);
        if(![3,4,5].includes(rule))throw Error(`该文件使用暂不支持的大师规则 ${rule}`);
        doc.rule=rule;doc.pseudoShuffle=!!(flags&16);patches.push({...patch,kind:'begin',flags});foundBegin=true;
      }else if(name==='Debug.SetAIName'){doc.players[1].name=evaluate(call.arguments[0],env);patches.push({...patch,kind:'ai'});
      }else if(name==='Debug.SetPlayerInfo'){
        const [p,lp,startCount,drawCount]=call.arguments.map(n=>evaluate(n,env));if(![0,1].includes(p))throw Error('无效玩家');
        Object.assign(doc.players[p],{lp,startCount,drawCount});patches.push({...patch,kind:'player',player:p});
      }else if(name==='Debug.AddCard'){
        const values=call.arguments.map((n,index)=>{try{return evaluate(n,env);}catch(error){if(index===5&&n.type==='Identifier'&&n.name.startsWith('POS_')){importWarnings.push(`第 ${statement.loc.start.line} 行含未知表示常量 ${n.name}，保留原调用`);return 0;}throw error;}});
        const [code,owner,controller,location,seq,position,proc=false]=values;
        let zone=zoneNames[location],slot=seq;
        if(!zone)throw Error(`不支持的区域 ${location}`);
        if(zone==='szone'&&seq===5){zone='fzone';slot=0;}
        const card=newCard(code,controller,zone,slot);Object.assign(card,{owner,position:position===0&&zone==='extra'?8:position,proc:!!proc});
        // A repeated occupied monster slot is the engine's Debug.AddCard material convention.
        const host=zone==='mzone'?doc.cards.find(c=>c.zone==='mzone'&&c.controller===controller&&c.seq===seq):null;
        if(host){card.zone='overlay';card.seq=0;card.overlayOf=host.uid;card.position=1;}
        doc.cards.push(card);if(alias)aliases[alias]=card.uid;
        patches.push({...patch,kind:'card',uid:card.uid,alias,originalArgs:[code,owner,controller,location,seq,position,!!proc],originalArgsText:call.arguments.map(n=>source.slice(...n.range)).join(','),direct:statement.type==='CallStatement'});
      }else if(name==='Debug.PreSummon'){
        const card=doc.cards.find(c=>c.uid===aliases[call.arguments[0].name]);if(!card)throw Error('未识别的卡片变量');
        const summonType=evaluate(call.arguments[1],env),summonLocation=call.arguments[2]?evaluate(call.arguments[2],env):0;
        Object.assign(card,{summonType,summonLocation});patches.push({...patch,kind:'summon',uid:card.uid});
      }else if(['Debug.PreEquip','Debug.PreSetTarget','Debug.PreAddCounter'].includes(name)){
        const ref=call.arguments[0],id=aliases[ref.name],card=doc.cards.find(c=>c.uid===id);if(!card)throw Error('未识别的卡片变量');
        if(name==='Debug.PreAddCounter')card.counters.push({type:evaluate(call.arguments[1],env),count:evaluate(call.arguments[2],env)});
        else {const target=aliases[call.arguments[1].name];if(!target)throw Error('未识别的目标变量');if(name==='Debug.PreEquip'){if(card.zone!=='szone')throw Error('原脚本的装备来源不是魔陷区，保留原调用');card.equipTo=target;}else card.targetIds.push(target);}
        patches.push({...patch,kind:'relation'});
      }else if(name==='Debug.ShowHint'){
        if(!patches.some(p=>p.kind==='hint'))doc.hints=[];
        const index=doc.hints.length;doc.hints.push(evaluate(call.arguments[0],env));patches.push({...patch,kind:'hint',index});
      }else if(name==='Debug.ReloadFieldEnd'){patches.push({...patch,kind:'end'});
      }else if(name==='aux.BeginPuzzle'){patches.push({...patch,kind:'puzzle'});
      }else {
        if(alias&&call&&['NumericLiteral','UnaryExpression','BinaryExpression','StringLiteral'].includes(call.type))env[alias]=evaluate(call,env);
        unhandled.push({line:statement.loc.start.line,text:source.slice(...statement.range)});
      }
    }catch(error){
      // A partially interpreted initial layout is not safe to edit as a full scene.
      if(name==='Debug.AddCard'||name==='Debug.ReloadFieldBegin')throw Error(`第 ${statement.loc.start.line} 行：${error.message}`);
      unhandled.push({line:statement.loc.start.line,text:source.slice(...statement.range)});
    }
  }
  if(!foundBegin||!patches.some(p=>p.kind==='end'))throw Error('未找到完整的 Debug.ReloadFieldBegin / End 初始化');
  // The UI's first item is the top of the deck, the engine appends deck sequence 0.
  for(const p of [0,1]){
    const deck=doc.cards.filter(c=>c.zone==='deck'&&c.controller===p);
    const values=[];
    for(const c of deck){const original=patches.find(x=>x.uid===c.uid).originalArgs; if(original[4]===1)values.push(c);else values.unshift(c);}
    let i=0;doc.cards=doc.cards.map(c=>c.zone==='deck'&&c.controller===p?values[i++]:c);
  }
  const description=source.match(/--\[\[message\s*\r?\n([\s\S]*?)\]\]/);if(description)doc.description=description[1].trim();
  const solution=source.match(/--\[\[\s*\r?\nSolution:\s*\r?\n([\s\S]*?)\]\]/);if(solution)doc.solution=solution[1].trim();
  doc.sourceMap={source,patches,unhandled,importWarnings,originalCards:clone(doc.cards),originalRule:rule,originalHints:clone(doc.hints),originalDescription:doc.description,originalSolution:doc.solution,flags,flagsRaw};
  prepareCardScripts(doc,parser);
  return doc;
}
