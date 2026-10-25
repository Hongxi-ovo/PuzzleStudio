// Discover material-granted effects from the final local card script.
function walk(node,visit){if(!node||typeof node!=='object')return;visit(node);for(const value of Object.values(node))if(Array.isArray(value))value.forEach(n=>walk(n,visit));else if(value&&typeof value==='object')walk(value,visit);}
function walkCode(node,visit){if(!node||typeof node!=='object')return;visit(node);if(node.type==='FunctionDeclaration')return;for(const value of Object.values(node))if(Array.isArray(value))value.forEach(n=>walkCode(n,visit));else if(value&&typeof value==='object')walkCode(value,visit);}
const name=n=>n?.type==='Identifier'?n.name:n?.type==='MemberExpression'?name(n.base)+'.'+n.identifier.name:'';
const call=n=>n?.type==='CallStatement'?n.expression:null;
function has(node,token){let found=false;walk(node,n=>{if(n.type==='Identifier'&&n.name===token)found=true;});return found;}
function groups(body){
  const found=[];
  function scan(statements){
    for(let i=0;i<statements.length;i++){
      const node=statements[i],init=node.type==='LocalStatement'&&node.variables.length===1&&node.init.length===1?node.init[0]:null;
      if(init?.type==='CallExpression'&&(name(init.base)==='Effect.CreateEffect'||init.base?.identifier?.name==='Clone')){
        const variable=node.variables[0].name,setters=[];
        for(let j=i+1;j<statements.length;j++){
          const c=call(statements[j]);
          if(c?.base?.identifier?.name==='RegisterEffect'&&c.arguments[0]?.name===variable){found.push({variable,init,nodes:statements.slice(i,j+1),setters,registration:c});break;}
          if(c?.base?.base?.name===variable)setters.push(c);
        }
      }
      if(node.type==='IfStatement')for(const clause of node.clauses)scan(clause.body);
      else if(['DoStatement','ForGenericStatement','ForNumericStatement','WhileStatement','RepeatStatement'].includes(node.type))scan(node.body);
    }
  }
  scan(body);return found;
}
function refs(node){const result=new Set();function visit(n){if(!n||typeof n!=='object')return;if(n.type==='Identifier'){result.add(n.name);return;}for(const [key,value]of Object.entries(n)){if(n.type==='MemberExpression'&&key==='identifier'||n.type==='TableKeyString'&&key==='key')continue;if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==='object')visit(value);}}visit(node);return result;}
function dependencies(ast,statements,namespace,source){
  const definitions=new Map();
  for(const n of ast.body){
    if(n.type==='FunctionDeclaration')definitions.set(name(n.identifier),n);
    if(n.type==='LocalStatement'||n.type==='AssignmentStatement')for(const v of n.variables)if(!['id',namespace].includes(name(v)))definitions.set(name(v),n);
  }
  const required=new Set();
  function visit(node){walk(node,n=>{const key=n.type==='MemberExpression'&&n.indexer==='.'?name(n):n.type==='Identifier'?n.name:'';const definition=definitions.get(key);if(definition&&!required.has(definition)&&!key.endsWith('.initial_effect')){required.add(definition);visit(definition.type==='FunctionDeclaration'?definition.body:definition.init);}});}
  statements.forEach(visit);
  return [...required].sort((a,b)=>a.range[0]-b.range[0]).map(n=>source.slice(...n.range)).join('\n');
}
function snapshot(entry,lua,key,title,mode='lua'){
  return {sourceCode:entry.code,sourceKey:entry.code+':'+key,sourceName:entry.name,summary:entry.summary,sourceHash:entry.hash,sourcePath:entry.path,lua,title,mode};
}
export function discoverGrants(entry,parser=globalThis.luaparse){
  if(!parser)throw Error('Lua 解析器未加载');
  const source=entry.source.replace(/\r\n?/g,'\n'),ast=parser.parse(source,{luaVersion:'5.3',ranges:true});
  const functions=new Map(ast.body.filter(n=>n.type==='FunctionDeclaration').map(n=>[name(n.identifier),n]));
  const initial=[...functions.values()].find(n=>name(n.identifier).endsWith('.initial_effect'));
  if(!initial)return {grants:[],errors:[]};
  const namespace=name(initial.identifier).split('.')[0],registered=groups(initial.body),grants=[],errors=[];
  if(registered.some(g=>g.setters.some(s=>has(s,'EFFECT_TYPE_XMATERIAL')))){
    const defined=new Set([namespace,'id','c','aux','Auxiliary','Duel','Effect','Group','Card','bit','math','string','table','pairs','ipairs','GetID','Fusion','Synchro','Xyz','Link','Ritual','Pendulum','Gemini','Spirit','Union']);
    walk(ast,n=>{if(n.type==='LocalStatement')n.variables.forEach(v=>defined.add(v.name));if(n.type==='FunctionDeclaration')n.parameters.forEach(v=>{if(v.name)defined.add(v.name);});});
    const external=[...refs(initial)].filter(n=>!defined.has(n)&&!n.match(/^[A-Z][A-Z0-9_]*$/));
    if(external.length)errors.push({operation:'overlay',message:'原卡初始化依赖扩展辅助脚本：'+external.join('、')});
    else grants.push(snapshot(entry,'','overlay','超量素材提供的效果','overlay'));
  }
  const operations=new Set();
  for(const group of registered){
    const conditionSetter=group.setters.find(s=>s.base.identifier.name==='SetCondition'),condition=functions.get(name(conditionSetter?.arguments[0]));
    const materialEvent=group.setters.some(s=>s.base.identifier.name==='SetCode'&&has(s,'EVENT_BE_MATERIAL'));
    const materialCondition=['REASON_MATERIAL','REASON_LINK','REASON_SYNCHRO','REASON_FUSION','REASON_RITUAL','REASON_XYZ'].some(t=>has(condition,t));
    if(!materialEvent&&!materialCondition)continue;
    const setter=group.setters.find(s=>s.base.identifier.name==='SetOperation');
    const operation=setter?.arguments[0]?.type==='FunctionDeclaration'?setter.arguments[0]:functions.get(name(setter?.arguments[0]));
    if(operation)operations.add(operation);
  }
  for(const operation of operations){
    const operationName=name(operation.identifier)||'material-operation';
    try{
      const receivers=new Set(),owners=new Set(),groupNames=new Set(['eg']);
      walkCode(operation.body,n=>{if(n.type==='ForGenericStatement'&&n.iterators.some(i=>has(i,'eg')))n.variables.forEach(v=>receivers.add(v.name));if(n.type!=='LocalStatement')return;n.init.forEach((init,i)=>{if(init?.type!=='CallExpression')return;const method=init.base?.identifier?.name;if(method==='Filter'&&groupNames.has(init.base.base?.name))groupNames.add(n.variables[i]?.name);if(method==='GetReasonCard'||method==='GetFirst'&&groupNames.has(init.base.base?.name))receivers.add(n.variables[i]?.name);if(method==='GetHandler'&&init.base.base?.name==='e')owners.add(n.variables[i]?.name);});});
      if(!receivers.size)continue;
      const effectGroups=groups(operation.body).filter(g=>receivers.has(g.registration.base.base?.name));
      if(!effectGroups.length)continue;
      const first=Math.min(...effectGroups.map(g=>g.nodes[0].range[0]));
      const start=operation.body.findIndex(n=>n.range[0]<=first&&n.range[1]>first);
      const last=Math.max(...effectGroups.map(g=>g.registration.range[1]));let stop=operation.body.findIndex(n=>n.range[0]<last&&n.range[1]>=last);
      while(stop+1<operation.body.length){const next=call(operation.body[stop+1]);if(next?.base?.identifier?.name==='RegisterFlagEffect'&&receivers.has(next.base.base?.name))stop++;else break;}
      const statements=operation.body.slice(start,stop+1),tailStart=statements[0].range[0],tailEnd=statements.at(-1).range[1];
      const edits=[];
      walkCode(statements,n=>{
        if(n.type!=='CallExpression')return;
        const base=n.base?.base?.name,method=n.base?.identifier?.name;
        if(base==='Duel'&&!['Hint'].includes(method))throw Error('包含决斗操作，需手动分离赋予片段');
        if(base==='Duel'&&method==='Hint')edits.push({start:n.range[0],end:n.range[1],text:'do end'});
        if(method==='GetReasonCard')edits.push({start:n.range[0],end:n.range[1],text:'__recipient'});
        if(base==='e'&&method==='GetHandler')edits.push({start:n.range[0],end:n.range[1],text:'__recipient'});
        if(base==='e'&&!['GetHandler'].includes(method))throw Error('需要素材事件的动态上下文：'+method);
        if(owners.has(base)&&!['RegisterEffect'].includes(method))throw Error('需要原素材的动态数据：'+method);
      });
      let tail=source.slice(tailStart,tailEnd);
      for(const edit of edits.sort((a,b)=>b.start-a.start))tail=tail.slice(0,edit.start-tailStart)+edit.text+tail.slice(edit.end-tailStart);
      const setup=operation.body.slice(0,start).filter(n=>n.type==='LocalStatement'&&n.variables.every(v=>!owners.has(v.name)&&!receivers.has(v.name)&&!groupNames.has(v.name)));
      walkCode(setup,n=>{if(n.type==='CallExpression'&&(n.base?.base?.name==='Duel'||owners.has(n.base?.base?.name)))throw Error('前置数值依赖原素材或决斗过程，需要手动设置');});
      const helper=dependencies(ast,[...setup,...statements],namespace,source);
      let lua=[`local ${namespace}={}`,`local id=${entry.code}`,helper,'local __recipient=c',
        'local tp=c:GetControler()','local ep=tp','local rp=tp','local r=0','local ev=0','local re=nil',
        'local eg=Group.FromCards(c)','eg:GetFirst()','local e=Effect.CreateEffect(c)',
        ...[...new Set([...owners,...receivers])].filter(n=>n&&n!=='c').map(n=>`local ${n}=__recipient`),...[...groupNames].filter(n=>n&&n!=='eg').map(n=>`local ${n}=eg`),...setup.map(n=>source.slice(...n.range)),tail].filter(Boolean).join('\n');
      const result=parser.parse('do local c=nil\n'+lua+'\nend',{luaVersion:'5.3'});
      const defined=new Set(['c','tp','ep','rp','r','ev','re','eg','e','id',namespace,'aux','Auxiliary','Duel','Effect','Group','Card','bit','math','string','table','pairs','ipairs','next','select','type','tonumber','tostring','unpack','assert','Debug','GetID','setmetatable']);
      walk(result,n=>{if(n.type==='LocalStatement')n.variables.forEach(v=>defined.add(v.name));if(n.type==='FunctionDeclaration'){if(n.identifier?.type==='Identifier')defined.add(n.identifier.name);n.parameters.forEach(v=>{if(v.name)defined.add(v.name);});}});
      const unknown=[...refs(result)].filter(n=>!defined.has(n)&&!n.match(/^[A-Z][A-Z0-9_]*$/));
      if(unknown.length)throw Error('缺少可独立复制的依赖：'+unknown.slice(0,5).join('、'));
      // The owner of a material-created effect cannot be synthesized without
      // the actual donor. Such callbacks must remain a manual Lua operation.
      if(effectGroups.some(g=>owners.has(g.init.arguments?.[0]?.name))&&helper.includes(':GetOwner()'))throw Error('回调依赖原素材实体，需手动 Lua');
      grants.push(snapshot(entry,lua,operationName,'素材赋予效果'));
    }catch(error){errors.push({operation:operationName,message:error.message});}
  }
  return {grants,errors};
}
export function extractGrant(entry,parser=globalThis.luaparse){
  const result=discoverGrants(entry,parser);
  if(entry.sourceKey){const chosen=result.grants.find(g=>g.sourceKey===entry.sourceKey);if(chosen)return chosen;}
  if(result.grants.length===1)return result.grants[0];
  if(result.grants.length>1)throw Error('此卡有多种赋予效果，请选择具体片段');
  throw Error(result.errors[0]?.message||'未识别到可独立提取的素材赋予效果');
}
