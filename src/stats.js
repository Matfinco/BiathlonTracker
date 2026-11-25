/* Statistics page: shared archive from Google plus local series, drawn on two targets */
(function(){
  'use strict';
  const S=BiathlonStats,$=id=>document.getElementById(id);
  const HIT='#22c07a',MISS='#ff4d4d',MPI='#ffd400';
  const PALETTE=['#4cc9f0','#ffb000','#f15bb5','#9b5de5','#00d4b4','#fee440','#ff6b35','#7bd389','#a0a8ff','#ff8fa3'];
  // Calm to strong wind
  const WIND=['#d8f0ff','#8fd0ff','#4aa3ff','#ffc94a','#ff8a30','#ff3b3b'];
  const PERIOD={a:'#1e9bff',b:'#ff9f1a'};
  const ARROWS={C:'',N:'↑',NE:'↗',E:'→',SE:'↘',S:'↓',SW:'↙',W:'←',NW:'↖'};
  const repo=new BiathlonRepository(),sync=new BiathlonSync(repo);
  let local=null,archive=new Map(),cursor={cursor:1,cursorId:'',tombCursor:1,updatedAt:null};
  let all=[],options={athletes:[],coaches:[],types:[],seqs:[]},selected=null,focus=false,downloading=false,frame=0;
  const excluded={athletes:new Set(),coaches:new Set(),types:new Set(),seqs:new Set()};
  const view={from:'',to:'',fromB:'',toB:'',compare:false,number:0,esito:'all',windMin:0,windMax:5,color:'esito',mpi:true};
  try{
    const saved=localStorage.getItem('biathlon-stats-color');
    if(['esito','athlete','series','wind'].includes(saved))view.color=saved;
    view.mpi=localStorage.getItem('biathlon-stats-mpi')!=='off';
  }catch(error){}

  function node(tag,text,cls){
    const e=document.createElement(tag);
    if(text!==undefined)e.textContent=text;
    if(cls)e.className=cls;
    return e;
  }
  function status(text,error=false){
    $('data-status').textContent=text;
    $('data-status').classList.toggle('error',error);
    // Restart the highlight so a repeated message is still noticed
    $('data-status').classList.remove('pulse');
    void $('data-status').offsetWidth;
    $('data-status').classList.add('pulse');
  }
  function missText(n){
    return `${n} ${n===1?'errore':'errori'}`;
  }
  function pct(value){
    return value==null?'–':`${value.toFixed(1).replace('.',',')}%`;
  }
  function dayLabel(day){
    const [y,m,d]=day.split('-').map(Number);
    return new Date(y,m-1,d).toLocaleDateString('it-IT',{weekday:'short',day:'numeric',month:'short',year:'numeric'});
  }

  /* Local copy of the shared archive, separate from the field database */
  const ArchiveDB={
    db:null,
    open(){
      if(this.db)return Promise.resolve(this.db);
      return new Promise((resolve,reject)=>{
        const request=indexedDB.open('BiathlonArchiveDB',1);
        request.onupgradeneeded=()=>{
          const db=request.result;
          if(!db.objectStoreNames.contains('series'))db.createObjectStore('series',{keyPath:'id'});
          if(!db.objectStoreNames.contains('meta'))db.createObjectStore('meta');
        };
        request.onsuccess=()=>{
          this.db=request.result;
          resolve(this.db);
        };
        request.onerror=()=>reject(request.error);
      });
    },
    async load(){
      const db=await this.open();
      return new Promise((resolve,reject)=>{
        const tx=db.transaction(['series','meta'],'readonly'),series=tx.objectStore('series').getAll(),meta=tx.objectStore('meta').get('cursor');
        tx.oncomplete=()=>resolve({series:series.result||[],cursor:meta.result||null});
        tx.onabort=()=>reject(tx.error||Error('Lettura interrotta.'));
      });
    },
    async save(map,diff,reset,state){
      const db=await this.open();
      return new Promise((resolve,reject)=>{
        const tx=db.transaction(['series','meta'],'readwrite'),store=tx.objectStore('series');
        if(reset)store.clear();
        for(const id of diff.removed)store.delete(id);
        for(const id of diff.changed)if(map.has(id))store.put(map.get(id));
        tx.objectStore('meta').put(state,'cursor');
        tx.oncomplete=()=>resolve();
        tx.onabort=()=>reject(tx.error||Error('Salvataggio interrotto.'));
      });
    }
  };

  function dataStatus(){
    const pending=all.filter(s=>s.source==='local').length;
    const updated=cursor.updatedAt?new Date(cursor.updatedAt).toLocaleString('it-IT',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'';
    let text=`${all.length} serie`;
    if(updated)text+=` · archivio aggiornato ${updated}`;
    else text+=' · archivio Google non ancora scaricato';
    if(pending)text+=` · ${pending} solo su questo dispositivo`;
    return text;
  }
  // Coach access first, otherwise the administrator access of this device
  function credentials(m){
    const list=[];
    if(m?.cloudUrl&&m?.apiToken)list.push({cloudUrl:m.cloudUrl,apiToken:m.apiToken,coachName:m.coachName});
    if(m?.adminUrl&&m?.adminToken)list.push({cloudUrl:m.adminUrl,apiToken:m.adminToken,coachName:''});
    return list;
  }
  // Names the deployment the app talks to, so it can be compared with the one edited in Apps Script
  function outdated(config){
    const id=/\/s\/([^/]+)\/exec/.exec(config?.cloudUrl||'')?.[1]||'';
    return `Il servizio Google usato dall’app risponde con codice vecchio${id?` (deployment …${id.slice(-8)})`:''}. In Apps Script apri Esegui deployment → Gestisci deployment: l’ID deve finire con le stesse lettere. Se è un altro, modifica con la matita quello giusto e scegli Nuova versione, invece di creare un nuovo deployment.`;
  }
  // Try each verified access of this device: a rotated coach key falls back to the recovery key
  async function requestArchive(list,payload){
    let last,used;
    for(const config of list){
      used=config;
      try{
        return await sync.request(config,payload);
      }catch(error){
        last=error;
        if(!error.server)throw error;
      }
    }
    if(last.server&&last.serverVersion<3)throw Error(outdated(used));
    throw last;
  }
  async function download(){
    if(downloading)return;
    const config=credentials(local?.meta);
    if(!config.length){
      status('Download bloccato: su questo dispositivo non è attivo un accesso verificato. Nell’app apri Menu → Impostazioni e atleti → Accesso e sincronizzazione e incolla il tuo collegamento personale.',true);
      return;
    }
    if(!navigator.onLine){
      status(`${dataStatus()} · senza connessione: riprova quando torna la rete`,true);
      return;
    }
    downloading=true;
    $('archive-refresh').disabled=true;
    try{
      for(let page=0;page<200;page++){
        status(`Scaricamento archivio… ${archive.size} serie`);
        const r=await requestArchive(config,{action:'archive',cursor:cursor.cursor,cursorId:cursor.cursorId,tombCursor:cursor.tombCursor,inserts:[],deletes:[]});
        if(!Array.isArray(r.rows)||!Number.isInteger(r.cursor))throw Error(outdated(config[0]));
        const diff=S.applyArchivePage(archive,r);
        // Each page is saved with its cursor: an interrupted download resumes from there
        cursor={cursor:r.cursor,cursorId:r.cursorId,tombCursor:r.tombCursor,updatedAt:r.done?new Date().toISOString():cursor.updatedAt};
        await ArchiveDB.save(archive,diff,r.reset,cursor);
        if(r.done)break;
      }
      rebuild();
      status(dataStatus());
    }catch(error){
      rebuild();
      status(`${dataStatus()} · download non riuscito: ${error.name==='AbortError'?'il server non ha risposto in tempo':error.message}`,true);
    }finally{
      downloading=false;
      $('archive-refresh').disabled=false;
    }
  }

  /* Filters */
  function allowed(ids,set){
    return set.size?new Set(ids.filter(id=>!set.has(id))):null;
  }
  function filterFor(period){
    return {
      from:period==='b'?view.fromB:view.from,to:period==='b'?view.toB:view.to,
      athletes:allowed(options.athletes.map(a=>a.id),excluded.athletes),coaches:allowed(options.coaches,excluded.coaches),
      types:allowed(options.types,excluded.types),seqs:allowed(options.seqs,excluded.seqs),
      number:view.number,esito:view.esito,windMin:view.windMin,windMax:view.windMax
    };
  }
  function checklist(container,items,set){
    const actions=node('div',undefined,'list-actions'),every=node('button','Tutti','secondary'),none=node('button','Nessuno','secondary');
    every.type=none.type='button';
    every.addEventListener('click',()=>{set.clear();buildOptions();render();});
    none.addEventListener('click',()=>{for(const i of items)set.add(i.id);buildOptions();render();});
    actions.append(every,none);
    container.replaceChildren(actions,...items.map(item=>{
      const label=node('label'),input=node('input');
      input.type='checkbox';
      input.checked=!set.has(item.id);
      input.addEventListener('change',()=>{
        if(input.checked)set.delete(item.id);else set.add(item.id);
        render();
      });
      label.append(input,node('span',item.name));
      return label;
    }));
    if(!items.length)container.replaceChildren(node('p','Nessun dato','empty'));
  }
  function daySelect(select,from,to){
    const days=S.days(all);
    select.replaceChildren(node('option','Scegli una giornata'),...days.map(d=>{
      const o=node('option',dayLabel(d));
      o.value=d;
      return o;
    }));
    select.firstChild.value='';
    select.value=from&&from===to&&days.includes(from)?from:'';
  }
  function buildOptions(){
    options.athletes=S.athletes(all);
    options.coaches=S.values(all,'coach');
    options.types=S.values(all,'type');
    const maxSeq=Math.max(5,...all.flatMap(s=>s.shots.map(x=>x.seq)));
    options.seqs=Array.from({length:maxSeq},(_,i)=>i+1);
    checklist($('athlete-list'),options.athletes,excluded.athletes);
    checklist($('coach-list'),options.coaches.map(c=>({id:c,name:c||'Senza firma'})),excluded.coaches);
    checklist($('type-list'),options.types.map(t=>({id:t,name:t})),excluded.types);
    daySelect($('day-select'),view.from,view.to);
    daySelect($('day-select-b'),view.fromB,view.toB);
    const numbers=Array.from(new Set(all.map(s=>s.number))).sort((a,b)=>a-b);
    $('series-number').replaceChildren(node('option','Tutte'),...numbers.map(n=>{
      const o=node('option',`Serie ${n}`);
      o.value=String(n);
      return o;
    }));
    $('series-number').firstChild.value='0';
    $('series-number').value=numbers.includes(view.number)?String(view.number):'0';
    $('seq-list').replaceChildren(...options.seqs.map(n=>{
      const b=node('button',String(n));
      b.type='button';
      b.setAttribute('aria-pressed',String(!excluded.seqs.has(n)));
      b.setAttribute('aria-label',`Colpo ${n}`);
      b.addEventListener('click',()=>{
        if(excluded.seqs.has(n))excluded.seqs.delete(n);else excluded.seqs.add(n);
        b.setAttribute('aria-pressed',String(!excluded.seqs.has(n)));
        render();
      });
      return b;
    }));
  }
  function syncControls(){
    $('date-from').value=view.from;
    $('date-to').value=view.to;
    $('date-from-b').value=view.fromB;
    $('date-to-b').value=view.toB;
    $('compare-toggle').checked=view.compare;
    $('mpi-toggle').checked=view.mpi;
    $('compare-fields').hidden=!view.compare;
    for(const b of $('color-mode').children){
      b.setAttribute('aria-pressed',String(b.dataset.mode===view.color));
      b.disabled=view.compare;
    }
    for(const b of $('esito-mode').children)b.setAttribute('aria-pressed',String(b.dataset.esito===view.esito));
    for(const [id,from,to] of [['period-quick',view.from,view.to],['compare-quick',view.fromB,view.toB]]){
      for(const b of $(id).children){
        const p=S.period(b.dataset.period);
        b.setAttribute('aria-pressed',String(p.from===from&&p.to===to));
      }
    }
    for(const [id,from,to] of [['day-select',view.from,view.to],['day-select-b',view.fromB,view.toB]]){
      const select=$(id),match=from&&from===to&&Array.from(select.options).some(o=>o.value===from);
      select.value=match?from:'';
    }
    $('wind-min').value=String(view.windMin);
    $('wind-max').value=String(view.windMax);
  }
  function rebuild(){
    all=S.mergeSources(Array.from(archive.values()),local);
    if(selected&&!all.some(s=>s.id===selected.id)){
      selected=null;
      focus=false;
    }
    buildOptions();
    render();
  }

  /* Drawing */
  function colorFor(shot,period){
    if(view.compare)return PERIOD[period];
    if(view.color==='esito')return shot.hit?HIT:MISS;
    if(view.color==='wind')return WIND[Math.max(0,Math.min(5,Number(shot.series.windInt)||0))];
    return PALETTE[paletteIndex(S.colorKey(shot,view.color))%PALETTE.length];
  }
  // Stable colours: the same athlete or series number keeps its colour across filters
  function paletteIndex(key){
    if(view.color==='athlete'){
      const i=options.athletes.findIndex(a=>a.id===key);
      return i<0?0:i;
    }
    return Math.max(0,(parseInt(key,10)||1)-1);
  }
  function draw(canvas,groups,mpis){
    const w=canvas.clientWidth;
    if(!w)return;
    const h=w*1.1,dpr=window.devicePixelRatio||1,k=w/400;
    canvas.width=Math.round(w*dpr);
    canvas.height=Math.round(h*dpr);
    const c=canvas.getContext('2d');
    c.setTransform(dpr*k,0,0,dpr*k,0,0);
    c.fillStyle='#ecebe4';
    c.fillRect(0,0,400,440);
    c.fillStyle='#171c21';
    c.beginPath();
    c.arc(200,220,180,0,Math.PI*2);
    c.fill();
    c.strokeStyle='#5d676d';
    c.lineWidth=1/k;
    c.beginPath();
    c.moveTo(20,220);c.lineTo(380,220);
    c.moveTo(200,40);c.lineTo(200,400);
    c.stroke();
    c.strokeStyle='#d8dcdc';
    c.lineWidth=1.3/k;
    c.beginPath();
    c.arc(200,220,70.4,0,Math.PI*2);
    c.stroke();
    const points=[],count=groups.reduce((n,g)=>n+g.list.length,0),r=(count>800?Math.max(2.6,Math.min(4,3*k)):Math.max(3.2,Math.min(6,4.5*k)))/k;
    const faded=selected?.position&&groups.some(g=>g.list.some(s=>s.series.id===selected.id));
    // Smaller group on top, so a short period stays visible over a long one
    for(const g of groups.slice().sort((x,y)=>y.list.length-x.list.length)){
      for(const s of g.list){
        const own=selected&&s.series.id===selected.id;
        if(focus&&!own)continue;
        c.globalAlpha=faded&&!own?.18:count>1500?.65:.92;
        c.fillStyle=colorFor(s,g.period);
        c.strokeStyle='rgba(0,0,0,.5)';
        c.lineWidth=1/k;
        c.beginPath();
        if(g.shape==='square')c.rect(s.x-r,s.y-r,r*2,r*2);
        else c.arc(s.x,s.y,r,0,Math.PI*2);
        c.fill();
        c.stroke();
        points.push({px:s.x*k,py:s.y*k,shot:s});
      }
    }
    c.globalAlpha=1;
    // Selected series on top, numbered and outlined
    if(selected){
      c.font=`700 ${11/k}px system-ui,sans-serif`;
      c.textAlign='center';
      c.textBaseline='middle';
      for(const g of groups)for(const s of g.list){
        if(s.series.id!==selected.id)continue;
        c.fillStyle=colorFor(s,g.period);
        c.strokeStyle='#fff';
        c.lineWidth=2.5/k;
        c.beginPath();
        c.arc(s.x,s.y,r*1.6,0,Math.PI*2);
        c.fill();
        c.stroke();
        c.fillStyle='#000';
        c.fillText(String(s.seq),s.x,s.y+.5/k);
      }
    }
    // Mean point of impact: thin translucent cross and ring, so shots underneath stay visible
    for(const m of mpis){
      if(!m.point)continue;
      const {x,y}=m.point,arm=16/k;
      c.globalAlpha=.75;
      c.lineCap='round';
      for(const [color,width] of [['#000',3.5/k],[MPI,1.6/k]]){
        c.strokeStyle=color;
        c.lineWidth=width;
        c.beginPath();
        c.moveTo(x-arm,y);c.lineTo(x-4/k,y);
        c.moveTo(x+4/k,y);c.lineTo(x+arm,y);
        c.moveTo(x,y-arm);c.lineTo(x,y-4/k);
        c.moveTo(x,y+4/k);c.lineTo(x,y+arm);
        c.stroke();
      }
      c.beginPath();
      c.arc(x,y,8/k,0,Math.PI*2);
      c.fillStyle='rgba(255,212,0,.28)';
      c.fill();
      c.strokeStyle=m.ring||MPI;
      c.lineWidth=2/k;
      c.stroke();
      if(m.label){
        // Period letter beside the marker: A left, B right, readable when the two overlap
        const side=m.label==='A'?-1:1,lx=x+side*22/k,ly=y-14/k;
        c.globalAlpha=.85;
        c.fillStyle=m.ring;
        c.beginPath();
        c.arc(lx,ly,8/k,0,Math.PI*2);
        c.fill();
        c.fillStyle='#000';
        c.font=`800 ${11/k}px system-ui,sans-serif`;
        c.textAlign='center';
        c.textBaseline='middle';
        c.fillText(m.label,lx,ly+.5/k);
      }
      c.globalAlpha=1;
    }
    canvas._points=points;
  }
  function legendFor(list){
    if(view.compare)return [{label:'Periodo A',color:PERIOD.a},{label:'Periodo B',color:PERIOD.b,square:true}];
    return S.legend(list,view.color).map(e=>({
      label:e.label,
      color:view.color==='esito'?(e.key==='hit'?HIT:MISS):view.color==='wind'?WIND[Number(e.key)]:PALETTE[paletteIndex(e.key)%PALETTE.length]
    }));
  }
  function renderBars(container,a,b){
    const seqs=Array.from(new Set([...a.perSeq,...(b?.perSeq||[])].map(g=>g.seq))).sort((x,y)=>x-y);
    if(!seqs.length){
      container.replaceChildren(node('p','Nessun colpo con questi filtri.','empty'));
      return;
    }
    container.replaceChildren(...seqs.map(seq=>{
      const row=node('div',undefined,'bar-row'),track=node('div',undefined,'bar-track'),ga=a.perSeq.find(g=>g.seq===seq),gb=b?.perSeq.find(g=>g.seq===seq);
      const bar=(g,cls)=>{
        const e=node('div',undefined,`bar ${cls}`);
        e.style.width=`${g?g.pct:0}%`;
        return e;
      };
      track.append(bar(ga,b?'period-a':''));
      if(b)track.append(bar(gb,'period-b'));
      const value=b?`${ga?Math.round(ga.pct):'–'} · ${gb?Math.round(gb.pct):'–'}%`:ga?`${Math.round(ga.pct)}% (${missText(ga.n-ga.hits)})`:'–';
      row.append(node('span',String(seq)),track,node('span',value,'bar-value'));
      return row;
    }));
  }
  function render(){
    cancelAnimationFrame(frame);
    syncControls();
    const listA=S.shots(all,filterFor('a')),listB=view.compare?S.shots(all,filterFor('b')):[];
    const sumA=S.summary(listA),sumB=view.compare?S.summary(listB):null;
    for(const p of ['T','P']){
      const panel=$('panel-'+p),a=sumA[p],b=sumB?.[p],ownA=listA.filter(s=>s.series.position===p),ownB=listB.filter(s=>s.series.position===p);
      const head=panel.querySelector('.panel-pct');
      if(b){
        head.replaceChildren(node('small','A '),document.createTextNode(pct(a.pct)+' '),node('small','B '),document.createTextNode(pct(b.pct)));
      }else head.textContent=pct(a.pct);
      panel.querySelector('.panel-meta').textContent=b
        ?`A: ${a.n} colpi, ${a.series} serie, ${missText(a.n-a.hits)} · B: ${b.n} colpi, ${b.series} serie, ${missText(b.n-b.hits)}`
        :`${a.n} colpi · ${a.series} serie · ${missText(a.n-a.hits)}`;
      const mpiLine=panel.querySelector('.panel-mpi');
      mpiLine.replaceChildren(node('strong','Punto medio: '),document.createTextNode(b
        ?`A ${S.offsetText(a.mpi)||'–'} · B ${S.offsetText(b.mpi)||'–'}`
        :(S.offsetText(a.mpi)||'nessun colpo')));
      const groups=[{list:ownA,period:'a',shape:'circle'}];
      if(b)groups.push({list:ownB,period:'b',shape:'square'});
      const mpis=!view.mpi?[]:b?[{point:a.mpi,label:'A',ring:PERIOD.a},{point:b.mpi,label:'B',ring:PERIOD.b}]:[{point:a.mpi}];
      draw(panel.querySelector('canvas'),groups,mpis);
      const legend=panel.querySelector('.legend');
      legend.replaceChildren(...legendFor(ownA.concat(ownB)).map(e=>{
        const li=node('li'),sw=node('span',undefined,`swatch${e.square?' square':''}`);
        sw.style.background=e.color;
        li.append(sw,node('span',e.label));
        return li;
      }),...(view.mpi?[(()=>{
        const li=node('li');
        li.append(node('span',undefined,'swatch mpi'),node('span','Punto medio'));
        return li;
      })()]:[]));
      renderBars(panel.querySelector('.bars'),a,b);
    }
    renderDetail();
  }
  function renderDetail(){
    $('detail').hidden=!selected;
    if(!selected)return;
    const s=selected,misses=s.shots.filter(x=>x.esito!=='Bersaglio').length;
    $('detail-title').textContent=`${s.athlete} · Serie ${s.series} · ${s.type}`;
    const wind=Number(s.windInt)?`vento ${ARROWS[s.windDir]||''} ${s.windInt}/5`:'vento calmo';
    $('detail-info').textContent=`${s.date?dayLabel(s.date):''} · ${s.position==='T'?'Terra':'Piedi'} · allenatore ${s.coach||'non indicato'} · ${wind} · ${missText(misses)} su ${s.shots.length}${s.source==='local'?' · non ancora sincronizzata':''}`;
    $('detail-shots').replaceChildren(...s.shots.map(x=>node('li',`${x.seq} ${x.esito==='Bersaglio'?'✓':'×'}`,x.esito==='Bersaglio'?'hit':'miss')));
    $('detail-focus').setAttribute('aria-pressed',String(focus));
    $('detail-focus').textContent=focus?'Mostra tutti i colpi':'Mostra solo questa serie';
  }

  /* Events */
  for(const canvas of document.querySelectorAll('.target-canvas')){
    canvas.addEventListener('click',e=>{
      const rect=canvas.getBoundingClientRect(),x=e.clientX-rect.left,y=e.clientY-rect.top;
      let best=null,dist=Infinity;
      for(const p of canvas._points||[]){
        const d=Math.hypot(p.px-x,p.py-y);
        if(d<dist){
          dist=d;
          best=p;
        }
      }
      if(best&&dist<=16){
        if(selected?.id!==best.shot.series.id)focus=false;
        selected=best.shot.series;
      }else if(!focus)selected=null;
      render();
      if(selected&&window.matchMedia('(max-width:900px)').matches)$('detail').scrollIntoView({block:'nearest',behavior:'smooth'});
    });
  }
  $('detail-close').addEventListener('click',()=>{
    selected=null;
    focus=false;
    render();
  });
  $('detail-focus').addEventListener('click',()=>{
    focus=!focus;
    render();
  });
  for(const [id,period] of [['period-quick','a'],['compare-quick','b']]){
    $(id).addEventListener('click',e=>{
      const kind=e.target.closest('button')?.dataset.period;
      if(!kind)return;
      const p=S.period(kind);
      if(period==='b'){
        view.fromB=p.from;
        view.toB=p.to;
      }else{
        view.from=p.from;
        view.to=p.to;
      }
      render();
    });
  }
  for(const [id,period] of [['day-select','a'],['day-select-b','b']]){
    $(id).addEventListener('change',e=>{
      const day=e.target.value;
      if(!day)return;
      if(period==='b'){
        view.fromB=view.toB=day;
      }else view.from=view.to=day;
      render();
    });
  }
  for(const [id,key] of [['date-from','from'],['date-to','to'],['date-from-b','fromB'],['date-to-b','toB']]){
    $(id).addEventListener('change',e=>{
      view[key]=e.target.value;
      render();
    });
  }
  $('mpi-toggle').addEventListener('change',e=>{
    view.mpi=e.target.checked;
    try{localStorage.setItem('biathlon-stats-mpi',view.mpi?'on':'off');}catch(error){}
    render();
  });
  $('compare-toggle').addEventListener('change',e=>{
    view.compare=e.target.checked;
    render();
  });
  $('color-mode').addEventListener('click',e=>{
    const mode=e.target.closest('button')?.dataset.mode;
    if(!mode)return;
    view.color=mode;
    try{localStorage.setItem('biathlon-stats-color',mode);}catch(error){}
    render();
  });
  $('esito-mode').addEventListener('click',e=>{
    const esito=e.target.closest('button')?.dataset.esito;
    if(!esito)return;
    view.esito=esito;
    render();
  });
  $('series-number').addEventListener('change',e=>{
    view.number=Number(e.target.value)||0;
    render();
  });
  for(const id of ['wind-min','wind-max']){
    $(id).replaceChildren(...[0,1,2,3,4,5].map(n=>{
      const o=node('option',n?`${n}/5`:'Calmo');
      o.value=String(n);
      return o;
    }));
    $(id).addEventListener('change',()=>{
      view.windMin=Number($('wind-min').value);
      view.windMax=Number($('wind-max').value);
      if(view.windMin>view.windMax)[view.windMin,view.windMax]=[view.windMax,view.windMin];
      render();
    });
  }
  $('filters-reset').addEventListener('click',()=>{
    Object.assign(view,{from:'',to:'',fromB:'',toB:'',compare:false,number:0,esito:'all',windMin:0,windMax:5});
    for(const set of Object.values(excluded))set.clear();
    selected=null;
    focus=false;
    buildOptions();
    render();
  });
  $('filters-toggle').addEventListener('click',()=>{
    const open=$('filters').classList.toggle('open');
    $('filters-toggle').setAttribute('aria-expanded',String(open));
  });
  $('archive-refresh').addEventListener('click',download);
  window.addEventListener('online',download);
  // Redraw canvases when their width changes (rotation, window resize)
  let lastWidth=0;
  const observer=typeof ResizeObserver==='function'?new ResizeObserver(entries=>{
    const width=Math.round(entries[0].contentRect.width);
    if(width===lastWidth)return;
    lastWidth=width;
    cancelAnimationFrame(frame);
    frame=requestAnimationFrame(render);
  }):null;
  observer?.observe(document.querySelector('.targets'));
  repo.onchange=async()=>{
    try{
      local=await repo.read();
      rebuild();
      status(dataStatus());
    }catch(error){}
  };
  async function init(){
    try{
      local=await repo.read();
    }catch(error){
      local=null;
    }
    try{
      const saved=await ArchiveDB.load();
      for(const s of saved.series)archive.set(s.id,s);
      if(saved.cursor)cursor=saved.cursor;
    }catch(error){
      status(`Archivio statistiche non disponibile: ${error.message}`,true);
    }
    rebuild();
    status(dataStatus());
    download();
  }
  init();
})();
