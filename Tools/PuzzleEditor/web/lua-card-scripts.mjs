// Associate self-contained top-level effect registrations with their card.
// Keep source ranges so edits replace the original registration in place.
function walk(node,visit){
  if(!node||typeof node!=='object')return;
  visit(node);
  for(const value of Object.values(node))if(Array.isArray(value))value.forEach(n=>walk(n,visit));else if(value&&typeof value==='object')walk(value,visit);
}
function names(node){const result=new Set();walk(node,n=>{if(n.type==='Identifier')result.add(n.name);});return result;}
function memberCall(node,base,method,indexer=':'){
  return node?.type==='CallExpression'&&node.base?.type==='MemberExpression'&&node.base.indexer===indexer&&node.base.base?.name===base&&node.base.identifier.name===method;
}
export function prepareCardScripts(doc,parser=globalThis.luaparse){
  const sm=doc.sourceMap;if(!sm||sm.cardScriptVersion===2||!parser)return;
  const ast=parser.parse(sm.source,{luaVersion:'5.3',ranges:true}),body=ast.body,functions=new Map(),scripts=[];
  body.forEach((n,i)=>{if(n.type==='FunctionDeclaration'&&n.identifier?.type==='Identifier')functions.set(n.identifier.name,{node:n,index:i});});
  const bindings=new Map();
  for(let i=0;i<body.length;i++){
    const node=body[i],cardPatch=sm.patches.find(p=>p.kind==='card'&&p.statementRange[0]===node.range[0]);
    if(cardPatch?.alias)bindings.set(cardPatch.alias,cardPatch.uid);
    else if(['LocalStatement','AssignmentStatement'].includes(node.type))for(const variable of node.variables)if(variable.type==='Identifier')bindings.delete(variable.name);
    if(node.type!=='LocalStatement'||node.variables.length!==1||node.init.length!==1)continue;
    const create=node.init[0],effect=node.variables[0].name;
    if(!memberCall(create,'Effect','CreateEffect','.')||create.arguments.length!==1)continue;
    const alias=create.arguments[0].name,uid=bindings.get(alias);if(!uid)continue;
    let end=i+1;
    for(;end<body.length;end++){
      const call=body[end].type==='CallStatement'?body[end].expression:null;
      if(memberCall(call,alias,'RegisterEffect')&&call.arguments.length===1&&call.arguments[0].name===effect)break;
      if(!(call?.base?.type==='MemberExpression'&&call.base.indexer===':'&&call.base.base?.name===effect&&call.base.identifier.name.startsWith('Set')))break;
    }
    if(end>=body.length||!memberCall(body[end].expression,alias,'RegisterEffect')||body[end].expression.arguments[0]?.name!==effect)continue;
    const dependencies=new Set(),pending=[...names(body.slice(i,end+1))];
    while(pending.length){const name=pending.pop(),fn=functions.get(name);if(fn&&!dependencies.has(name)){dependencies.add(name);pending.push(...names(fn.node.body));}}
    let start=i;
    while(start>0&&body[start-1].type==='FunctionDeclaration'&&dependencies.has(body[start-1].identifier?.name))start--;
    if([...dependencies].some(name=>functions.get(name).index<start||functions.get(name).index>=i))continue;
    const protectedNames=new Set([effect,...dependencies]);
    // Don't move shared callbacks or locals used by another script block.
    if(body.some((n,j)=>(j<start||j>end)&&[...names(n)].some(name=>protectedNames.has(name))))continue;
    const first=body[start].range[0],last=body[end].range[1],source=sm.source.slice(first,last);
    let creates=false,announces=false;walk(body.slice(start,end+1),n=>{if(memberCall(n,'Duel','CreateToken','.'))creates=true;if(memberCall(n,'Duel','AnnounceCard','.'))announces=true;});
    const prints=creates&&announces;
    scripts.push({id:`script-${first}-${last}`,uid,alias,start:first,end:last,source,title:prints?'印卡能力':'导入卡片效果',printing:prints});
    i=end;
  }
  const raw=body.filter(node=>!sm.patches.some(p=>p.statementRange[0]===node.range[0])).map(node=>({node,names:names(node)}));
  sm.unsafeDeleteIds=sm.patches.filter(p=>p.kind==='card'&&p.alias&&raw.some(({node,names})=>
    names.has(p.alias)&&!scripts.some(s=>s.uid===p.uid&&s.start<=node.range[0]&&s.end>=node.range[1]))).map(p=>p.uid);
  sm.cardScripts=scripts;sm.cardScriptEdits??={};sm.cardScriptVersion=2;
}
export function cardScripts(doc,uid){return (doc.sourceMap?.cardScripts||[]).filter(s=>s.uid===uid);}
export function scriptValue(doc,script){return doc.sourceMap?.cardScriptEdits?.[script.id]??script.source;}
