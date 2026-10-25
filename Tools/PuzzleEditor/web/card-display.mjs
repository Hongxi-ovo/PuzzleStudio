const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const isFaceDown=position=>Boolean(position&10);
export const cardAngle=(position,opponent=false,monsterZone=true)=>(opponent?180:0)-(monsterZone&&[4,8].includes(position)?90:0);
export function cardSurface(code,name,position=1,angle=0,key=''){
  const down=isFaceDown(position),picture=`/card-image/${Number(code)}`;
  return `<span class="card-visual" data-display-key="${escape(key)}" data-angle="${angle}" data-down="${down}"><span class="card-flipper ${down?'is-facedown':''}"><span class="card-face card-front"><img src="${picture}" alt="${escape(name)}" draggable="false"></span><span class="card-face card-back"><img src="/card-back.jpg" alt="卡背" draggable="false"><img class="card-face-hint" src="${picture}" alt="" aria-hidden="true" draggable="false"></span></span></span>`;
}
export function captureCardViews(root=document){
  return new Map([...root.querySelectorAll('.card-visual[data-display-key]')].filter(e=>e.dataset.displayKey).map(e=>[e.dataset.displayKey,{angle:Number(e.dataset.angle),down:e.dataset.down==='true'}]));
}
export function animateCardViews(before,root=document){
  if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  for(const element of root.querySelectorAll('.card-visual[data-display-key]')){
    const previous=before.get(element.dataset.displayKey);if(!previous)continue;
    const angle=Number(element.dataset.angle),down=element.dataset.down==='true';
    if(angle!==previous.angle)element.animate([{transform:`translate(-50%,-50%) rotate(${previous.angle}deg)`},{transform:`translate(-50%,-50%) rotate(${angle}deg)`}],{duration:320,easing:'cubic-bezier(.2,.65,.3,1)'});
    if(down!==previous.down)element.querySelector('.card-flipper').animate([{transform:`rotateY(${previous.down?180:0}deg)`},{transform:`rotateY(${down?180:0}deg)`}],{duration:460,easing:'ease-in-out'});
  }
}
export function startPictureRefresh(){
  let running=false;
  const versions=new Map();
  async function refresh(){
    if(running||document.hidden)return;running=true;
    try{
      const images=[...document.querySelectorAll('img[src^="/card-image/"]')];
      const visible=images.filter(image=>{const rect=image.getBoundingClientRect();return rect.width>0&&rect.height>0&&rect.bottom>0&&rect.top<innerHeight;});
      const codes=[...new Set(visible.map(image=>image.getAttribute('src').match(/\/card-image\/(\d+)/)?.[1]))].filter(Boolean).slice(0,120);
      if(!codes.length)return;
      const response=await fetch('/api/images?codes='+codes.join(','));if(!response.ok)return;
      const result=await response.json();
      for(const [code,version]of Object.entries(result)){
        if(!version)continue;versions.set(code,version);
      }
      for(const image of images){const code=image.getAttribute('src').match(/\/card-image\/(\d+)/)?.[1],version=versions.get(code);if(version&&image.dataset.pictureVersion!==version){image.dataset.pictureVersion=version;image.src=`/card-image/${code}?v=${version}`;}}
    }catch{}finally{running=false;}
  }
  const timer=setInterval(refresh,1800);refresh();return()=>clearInterval(timer);
}
