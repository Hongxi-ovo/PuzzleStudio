// Canonical EX slots are expressed from player 0's view. Player 1 shares them
// with mirrored engine sequence numbers; the physical slot has no owner.
export function exDestination(sequence,controller){return {controller,zone:'mzone',seq:controller===0?sequence:11-sequence,shared:true};}

export function fieldMarkup(rule,slot,pile){
  const blank='<div aria-hidden="true"></div>';
  const row=(p,zone)=>[0,1,2,3,4].map(i=>{
    const seq=p?4-i:i;
    return slot(p,zone,seq,zone==='mzone'?`M${seq+1}`:(rule>=4&&(seq===0||seq===4)?`S${seq+1} / P`:`S${seq+1}`));
  }).join('');
  let html=pile(1,'deck')+row(1,'szone')+pile(1,'extra');
  html+=pile(1,'grave')+row(1,'mzone')+slot(1,'fzone',0,'场地');
  // Opponent banished pile: upper left beside their grave. Player banished
  // pile: lower right beside their grave. These cells are never shared.
  html+=pile(1,'removed')+blank;
  if(rule>=4)html+=slot(0,'mzone',5,'EX区','emz')+blank+slot(0,'mzone',6,'EX区','emz');
  else html+=`<div class="mr3-note">大师规则 3</div>`+blank+blank;
  html+=blank+pile(0,'removed');
  html+=slot(0,'fzone',0,'场地')+row(0,'mzone')+pile(0,'grave');
  html+=pile(0,'extra')+row(0,'szone')+pile(0,'deck');
  if(rule===3)html+=blank+slot(1,'pzone',1,'对方右 P')+slot(1,'pzone',0,'对方左 P')+blank+slot(0,'pzone',0,'我方左 P')+slot(0,'pzone',1,'我方右 P')+blank;
  return html;
}
