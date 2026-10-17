(function(){
  'use strict';
  const D=BiathlonDomain, repo=new BiathlonRepository(), $=id=>document.getElementById(id);
  let state=null,busy=false,review=null,editing=false,selectedShot=0,locked=false,gesture=null,windChoice=null,windTarget=null,wakeLock=null,wakeWanted=false,registration=null,lastSyncError='',confirming=false,installingUpdate=false;
  const arrows={
    C:'Calmo',N:'↑',NE:'↗',E:'→',SE:'↘',S:'↓',SW:'↙',W:'←',NW:'↖'
  };
  const sync=new BiathlonSync(repo,{
    onstate:info=>{
      if(info.status==='error')lastSyncError=info.message;
      if(info.status==='success')lastSyncError='';
      $('sync-status').dataset.state=info.status;
      refresh().catch(showError);
    }
  });
  function node(tag,content,attrs={
  }){
    const e=document.createElement(tag);
    if(content!==undefined)e.textContent=content;
    for(const [k,v]of Object.entries(attrs))k==='class'?e.className=v:e.setAttribute(k,String(v));
    return e;
  }
  function button(label,action,cls='secondary'){
    const b=node('button',label,{
      type:'button',class:cls
    });
    b.addEventListener('click',action);
    return b;
  }
  function notify(message,error=false){
    $('notice').textContent=message;
    $('notice').classList.toggle('error',error);
    $('notice').hidden=false;
    const open=Array.from(document.querySelectorAll('dialog[open]')).at(-1);
    if(open&&open.id!=='confirm-dialog'){
      let area=open.querySelector('.dialog-notice');
      if(!area){
        area=node('p',undefined,{
          class:'notice dialog-notice',role:'status','aria-live':'polite'
        });
        open.querySelector('.dialog-content').prepend(area);
      }
      area.textContent=message;
      area.classList.toggle('error',error);
      area.scrollIntoView({
        block:'nearest'
      });
    }
  }
  function showError(error){
    notify(error.message||String(error),true);
  }
  function currentDraft(){
    return state?D.draft(state,false):null;
  }
  function record(){
    return review?state.series.find(s=>s.id===review):null;
  }
  function activity(){
    return record()||currentDraft();
  }
  function context(){
    const d=currentDraft();
    return {
      key:d?.key,version:d?.version
    };
  }
  async function refresh(){
    const latest=await repo.read();
    if(!state||latest.meta.revision>=state.meta.revision){
      state=latest;
      render();
    }
  }
  async function change(updater,message){
    if(busy||!state)return null;
    busy=true;
    $('app').setAttribute('aria-busy','true');
    $('storage-status').textContent='Salvataggio sul dispositivo…';
    $('storage-status').classList.remove('error');
    try{
      const saved=await repo.mutate(updater);
      state=saved.state;
      render();
      if(message)notify(typeof message==='function'?message(saved.value):message);
      return saved;
    } catch(error){
      $('storage-status').textContent='Operazione non salvata: riprova prima di chiudere.';
      $('storage-status').classList.add('error');
      showError(error);
      return null;
    } finally{
      busy=false;
      $('app').setAttribute('aria-busy','false');
    }
  }
  function setSelect(select,items,value){
    select.replaceChildren(...items.map(item=>{
      const o=node('option',item.name);
      o.value=item.id;
      return o;
    }));
    select.value=value;
  }
  function windText(w){
    return !w||w.int===0?'Vento: calmo':`Vento: ${arrows[w.dir]} ${w.int}/5`;
  }
  function windFlag(level){
    // Keep the six visual references from the original field interface.
    const angle=[90,75,60,45,25,0][level]??90;
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('viewBox','0 0 80 72');
    svg.setAttribute('class','wind-flag');
    svg.setAttribute('aria-hidden','true');
    svg.setAttribute('focusable','false');
    const pole=document.createElementNS('http://www.w3.org/2000/svg','line');
    for(const [key,value]of Object.entries({x1:22,y1:10,x2:22,y2:64,class:'wind-flag-pole'}))pole.setAttribute(key,String(value));
    const cloth=document.createElementNS('http://www.w3.org/2000/svg','rect');
    for(const [key,value]of Object.entries({x:24,y:12,width:34,height:10,rx:1,transform:`rotate(${angle} 24 17)`,class:'wind-flag-cloth'}))cloth.setAttribute(key,String(value));
    svg.append(pole,cloth);
    return svg;
  }
  function render(){
    const m=state.meta,d=currentDraft(),r=record(),active=r||d,values=active?.shots||[],isReview=!!r;
    if(review&&!r)review=null;
    document.body.dataset.theme=m.theme;
    $('target-box').classList.toggle('mono',m.shotColor==='white');
    const athletes=m.roster.filter(a=>m.activeIds.includes(a.id));
    setSelect($('athlete-select'),isReview?[{
      id:r.athleteId,name:r.athlete
    }]:(athletes.length?athletes:[{
      id:'',name:'Aggiungi o seleziona atleti'
    }]),isReview?r.athleteId:m.currentAthleteId);
    $('athlete-select').disabled=isReview||!athletes.length||locked;
    $('mode-select').value=isReview?r.type:m.currentMode;
    $('mode-select').disabled=isReview||locked;
    const position=isReview?r.position:m.currentPos;
    $('position-button').textContent=position==='T'?'Terra':'Piedi';
    $('position-button').disabled=isReview||locked;
    $('series-button').textContent=`${isReview?'Rivedi':'Serie'} ${isReview?r.series:(d?.number||1)}`;
    $('series-button').disabled=isReview||locked||!d;
    const session=state.sessions.find(s=>s.id===(active?.sessionId||m.sessionId));
    $('session-label').textContent=(isReview?'Storico · ':'')+(session?.title||'Sessione');
    const displayedWind=isReview?{
      dir:r.windDir,int:r.windInt
    }:(d?.wind||m.currentWind);
    $('wind-open').replaceChildren(windFlag(displayedWind.int),node('span',windText(displayedWind)));
    $('wind-open').disabled=isReview||locked;
    $('shot-count').textContent=isReview?`${values.length} colpi`:`${values.length} / ${m.shotLimit} colpi`;
    const hits=values.filter(s=>s.esito==='Bersaglio').length;
    $('hit-count').textContent=`${hits} ${hits===1?'centro':'centri'}`;
    $('edit-button').hidden=isReview;
    $('edit-button').textContent=editing?'Fine modifica':'Modifica colpi';
    $('edit-button').setAttribute('aria-pressed',String(editing));
    $('edit-button').disabled=locked||!values.length;
    $('edit-help').hidden=!editing||isReview;
    $('shot-picker').hidden=!editing||isReview;
    $('target-box').classList.toggle('editing',editing&&!isReview);
    $('entry-actions').hidden=isReview;
    $('review-actions').hidden=!isReview;
    $('clear-button').hidden=isReview;
    $('undo-button').disabled=locked||!d?.shots.length;
    $('save-button').disabled=locked||!d?.shots.length;
    $('save-button').textContent=d?.replacesId?'Salva correzione':'Salva serie';
    $('clear-button').disabled=locked||!d?.shots.length;
    $('clear-button').textContent=d?.replacesId?'Annulla correzione':'Svuota serie';
    $('lock-button').textContent=locked?'Sblocca':'Blocca';
    $('lock-button').setAttribute('aria-pressed',String(locked));
    $('touch-cover').hidden=!locked;
    $('review-info').hidden=!isReview;
    $('review-slider').hidden=!isReview;
    $('review-slider-label').hidden=!isReview;
    if(isReview){
      $('review-info').textContent=`${r.athlete} · ${r.position==='T'?'Terra':'Piedi'} · ${r.type} · ${r.series} · ${new Date(r.timestamp).toLocaleString('it-IT')}`;
      $('review-slider').max=values.length;
      if($('review-slider').dataset.record!==r.id){
        $('review-slider').value=values.length;
        $('review-slider').dataset.record=r.id;
      }
    }
    selectedShot=Math.max(0,Math.min(selectedShot,values.length-1));
    $('shot-picker').replaceChildren(...values.map((s,i)=>{
      const b=button(`${s.seq} ${s.esito==='Bersaglio'?'✓':'×'}`,()=>{
        selectedShot=i;
        renderShots();
        render();
      });
      b.setAttribute('aria-label',`Modifica colpo ${s.seq}, ${s.esito==='Bersaglio'?'centro':'errore'}`);
      b.setAttribute('aria-pressed',String(i===selectedShot));
      return b;
    }));
    renderShots();
    renderSync();
    $('storage-status').textContent='Salvato sul dispositivo';
    $('storage-status').classList.remove('error');
    if($('history-dialog').open)renderHistory();
    if($('summary-dialog').open)renderSummary();
  }
  function renderShots(preview){
    const r=record(),active=r||currentDraft(),values=preview||active?.shots||[],shown=r?Number($('review-slider').value):values.length;
    $('shots-layer').replaceChildren(...values.slice(0,shown).map((s,i)=>{
      const marker=node('span',String(s.seq),{
        class:`shot ${s.esito==='Bersaglio'?'hit':'miss'}${editing&&selectedShot===i?' selected':''}`, 'aria-hidden':'true'
      });
      marker.style.left=`${s.x/4}%`;
      marker.style.top=`${s.y/4.4}%`;
      if(Math.hypot(s.x-200,s.y-220)<=180)marker.classList.add('on-dark');
      return marker;
    }));
  }
  function renderSync(){
    const m=state.meta,count=state.outbox.length,doing=m.syncLease?.until>Date.now(),last=m.lastSync?new Date(m.lastSync).toLocaleTimeString('it-IT',{
      hour:'2-digit',minute:'2-digit'
    }):'';
    const connection=navigator.onLine?'Rete disponibile':'Senza connessione';
    let message=doing?'Sincronizzazione in corso…':count?`${connection} · ${count} operazioni da inviare`:(last?`Tutto sincronizzato · ${last}`:'Nessuna operazione da inviare');
    if(count&&(!m.cloudUrl||!m.coachName||!m.apiToken))message=`${count} operazioni da inviare · configura Google, firma e chiave`;
    if(lastSyncError&&navigator.onLine&&count)message=`Invio da riprovare · ${count} operazioni conservate`;
    $('sync-status').textContent=message;
    $('menu-sync-info').textContent=lastSyncError||message;
  }
  function openDialog(id){
    if(busy||confirming)return;
    for(const dialog of document.querySelectorAll('dialog[open]'))dialog.close();
    if(id==='settings-dialog')fillSettings();
    if(id==='session-dialog')fillSession();
    if(id==='history-dialog')fillHistory();
    if(id==='summary-dialog')renderSummary();
    if(id==='series-dialog')$('series-number').value=currentDraft()?.number||1;
    $(id).showModal();
  }
  async function confirmAction(title,message,label='Conferma'){
    if(confirming)return false;
    confirming=true;
    const dialog=$('confirm-dialog');
    $('confirm-title').textContent=title;
    $('confirm-message').textContent=message;
    $('confirm-accept').textContent=label;
    dialog.returnValue='cancel';
    dialog.showModal();
    return new Promise(resolve=>dialog.addEventListener('close',()=>{
      confirming=false;
      resolve(dialog.returnValue==='accept');
    },{
      once:true
    }));
  }
  function fillSettings(){
    const m=state.meta;
    for(const [input,key]of [['coach-name','coachName'],['cloud-url','cloudUrl'],['looker-url','lookerUrl'],['api-token','apiToken'],['shot-limit','shotLimit'],['theme-select','theme'],['shot-color-select','shotColor']])$(input).value=m[key]??'';
    renderRoster();
  }
  function renderRoster(){
    $('roster-list').replaceChildren(...state.meta.roster.map(a=>{
      const li=node('li'),name=node('strong',a.name),remove=button('Rimuovi',async()=>{
        if(!await confirmAction('Rimuovi atleta',`Rimuovere ${a.name} dall’anagrafica locale? Le sue serie e bozze resteranno nello storico.`,'Rimuovi'))return;
        const result=await change(s=>{
          s.meta.roster=s.meta.roster.filter(x=>x.id!==a.id);
          s.meta.activeIds=s.meta.activeIds.filter(x=>x!==a.id);
          if(s.meta.currentAthleteId===a.id)s.meta.currentAthleteId=s.meta.activeIds[0]||'';
          D.draft(s);
        },'Atleta rimosso. Storico e bozze conservati.');
        if(result)renderRoster();
      },'text-button danger-text');
      remove.setAttribute('aria-label',`Rimuovi ${a.name}`);
      li.append(name,remove);
      return li;
    }));
  }
  function fillSession(){
    $('session-checklist').replaceChildren(...state.meta.roster.map(a=>{
      const label=node('label'),input=node('input');
      input.type='checkbox';
      input.value=a.id;
      input.checked=state.meta.activeIds.includes(a.id);
      label.append(input,node('span',a.name));
      return label;
    }));
    if(!state.meta.roster.length)$('session-checklist').append(node('p','Aggiungi prima gli atleti nelle impostazioni.'));
  }
  function fillHistory(){
    const sessions=[{
      id:'all',name:'Tutte le sessioni'
    },...state.sessions.slice().sort((a,b)=>b.startedAt.localeCompare(a.startedAt)).map(s=>({
      id:s.id,name:s.title
    }))];
    const old=$('history-session').value;
    setSelect($('history-session'),sessions,sessions.some(s=>s.id===old)?old:'all');
    const map=new Map(state.series.map(s=>[s.athleteId,s.athlete]));
    for(const a of state.meta.roster)map.set(a.id,a.name);
    const athletes=[{
      id:'all',name:'Tutti gli atleti'
    },...Array.from(map,([id,name])=>({
      id,name
    }))];
    const oldAthlete=$('history-athlete').value;
    setSelect($('history-athlete'),athletes,athletes.some(a=>a.id===oldAthlete)?oldAthlete:'all');
    renderHistory();
  }
  function renderHistory(){
    const session=$('history-session').value,athlete=$('history-athlete').value;
    const rows=state.series.filter(r=>(session==='all'||r.sessionId===session)&&(athlete==='all'||r.athleteId===athlete)).sort((a,b)=>b.timestamp.localeCompare(a.timestamp));
    $('history-list').replaceChildren(...rows.map(r=>{
      const li=node('li'),info=node('div',undefined,{
        class:'record-info'
      }),buttons=node('div',undefined,{
        class:'record-buttons'
      });
      info.append(node('strong',`${r.athlete} · ${r.series} · ${r.type}`),node('small',`${new Date(r.timestamp).toLocaleString('it-IT')} · ${r.shots.filter(s=>s.esito==='Bersaglio').length}/${r.shots.length} centri`));
      buttons.append(button('Apri',()=>{
        review=r.id;
        editing=false;
        $('history-dialog').close();
        render();
        $('target-box').scrollIntoView({
          block:'start'
        });
      }),button('Modifica',async()=>{
        const result=await change(s=>D.editSeries(s,r.id),'Correzione aperta. L’originale sarà sostituito soltanto al salvataggio.');
        if(result){
          review=null;
          editing=true;
          selectedShot=0;
          $('history-dialog').close();
          render();
        }
      }),button('Elimina',async()=>{
        if(!await confirmAction('Elimina serie',`Eliminare ${r.series} di ${r.athlete}? La cancellazione sarà inviata quando la rete è disponibile.`,'Elimina'))return;
        const done=await change(s=>D.removeSeries(s,r.id),'Serie eliminata sul dispositivo.');
        if(done)sync.schedule();
      },'text-button danger-text'));
      li.append(info,buttons);
      return li;
    }));
    if(!rows.length)$('history-list').append(node('li','Nessuna serie per questa selezione.'));
    const drafts=Object.values(state.meta.drafts).filter(d=>d.shots.length&&(session==='all'||d.sessionId===session)&&(athlete==='all'||d.athleteId===athlete));
    $('draft-list').replaceChildren(...drafts.map(d=>{
      const li=node('li'),name=state.meta.roster.find(a=>a.id===d.athleteId)?.name||d.athleteName||state.series.find(s=>s.athleteId===d.athleteId)?.athlete||'Atleta archiviato';
      li.append(node('span',`${name} · ${d.number}${d.position} · ${d.shots.length} colpi`),button('Riprendi',async()=>{
        const done=await change(s=>{
          const saved=s.meta.drafts[d.key];
          if(!saved)throw Error('Bozza non trovata.');
          if(!s.meta.roster.some(a=>a.id===d.athleteId))s.meta.roster.push({
            id:d.athleteId,name
          });
          if(!s.meta.activeIds.includes(d.athleteId))s.meta.activeIds.push(d.athleteId);
          s.meta.sessionId=d.sessionId;
          D.setContext(s,d.athleteId,d.mode,d.position);
        });
        if(done){
          review=null;
          editing=false;
          $('history-dialog').close();
          render();
        }
      }));
      return li;
    }));
    if(!drafts.length)$('draft-list').append(node('li','Nessuna bozza da riprendere.'));
  }
  function renderSummary(){
    const groups=new Map();
    for(const r of state.series){
      const k=JSON.stringify([r.athleteId,r.position,r.type]);
      if(!groups.has(k))groups.set(k,{
        name:r.athlete,position:r.position,type:r.type,series:0,shots:0,hits:0
      });
      const g=groups.get(k);
      g.series++;
      g.shots+=r.shots.length;
      g.hits+=r.shots.filter(s=>s.esito==='Bersaglio').length;
    }
    $('summary-list').replaceChildren(...Array.from(groups.values(),g=>{
      const card=node('article',undefined,{
        class:'summary-card'
      });
      card.append(node('strong',g.name),node('p',`${g.position==='T'?'Terra':'Piedi'} · ${g.type}`),node('p',`${g.series} serie · ${g.hits}/${g.shots} centri · ${g.shots?Math.round(g.hits/g.shots*100):0}%`));
      return card;
    }));
    if(!groups.size)$('summary-list').append(node('p','Il riepilogo comparirà dopo la prima serie salvata.'));
  }
  function openWind(){
    const d=currentDraft();
    if(!d||review||locked)return;
    windChoice=D.clone(d.wind);
    windTarget=context();
    drawWind();
    openDialog('wind-dialog');
  }
  function drawWind(){
    $('wind-directions').replaceChildren(...['NW','N','NE','W','C','E','SW','S','SE'].map(dir=>{
      const b=button(arrows[dir],()=>{
        windChoice.dir=dir;
        if(dir==='C')windChoice.int=0;
        else if(!windChoice.int)windChoice.int=1;
        drawWind();
      });
      b.setAttribute('aria-label',dir==='C'?'Vento calmo':`Direzione ${arrows[dir]}`);
      b.setAttribute('aria-pressed',String(windChoice.dir===dir));
      return b;
    }));
    $('wind-levels').replaceChildren(...[5,4,3,2,1,0].map(level=>{
      const b=button('',()=>{
        windChoice.int=level;
        if(!level)windChoice.dir='C';
        else if(windChoice.dir==='C')windChoice.dir='N';
        drawWind();
      });
      b.classList.add('wind-level-button');
      b.append(windFlag(level),node('span',String(level)));
      b.setAttribute('data-level',String(level));
      b.setAttribute('aria-label',`Intensità ${level} su 5${level===0?': bandierina pendente':level===5?': bandierina distesa':''}`);
      b.setAttribute('aria-pressed',String(windChoice.int===level));
      return b;
    }));
  }
  function coords(e){
    const rect=$('target-box').getBoundingClientRect();
    return {
      x:Math.max(0,Math.min(400,(e.clientX-rect.left)/rect.width*400)),y:Math.max(0,Math.min(440,(e.clientY-rect.top)/rect.height*440))
    };
  }
  function resetGesture(){
    gesture=null;
    $('aim-preview').hidden=true;
  }
  $('target-box').addEventListener('pointerdown',e=>{
    if(gesture){
      resetGesture();
      return;
    }
    if(busy||locked||review||e.isPrimary===false||e.button>0)return;
    const d=currentDraft();
    if(!d){
      notify('Aggiungi gli atleti nel menu e avvia una sessione.');
      return;
    }
    gesture={
      pointerId:e.pointerId,startX:e.clientX,startY:e.clientY,...coords(e),...context(),index:selectedShot,editing,drift:false
    };
    if(editing){
      $('target-box').setPointerCapture(e.pointerId);
      previewAim(e);
    }
  });
  function previewAim(e){
    const p=coords(e),rect=$('target-box').getBoundingClientRect(),aim=$('aim-preview');
    aim.hidden=false;
    aim.style.left=`${Math.max(48,Math.min(rect.width-48,e.clientX-rect.left))}px`;
    aim.style.top=`${Math.max(112,e.clientY-rect.top)}px`;
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('viewBox',`${p.x-20} ${p.y-20} 40 40`);
    const shape=(tag,attrs)=>{
      const part=document.createElementNS('http://www.w3.org/2000/svg',tag);
      for(const [key,value]of Object.entries(attrs))part.setAttribute(key,String(value));
      svg.append(part);
    };
    shape('rect',{
      x:0,y:0,width:400,height:440,fill:'#f7f7f2'
    });
    shape('circle',{
      cx:200,cy:220,r:180,fill:'#171c21'
    });
    shape('circle',{
      cx:200,cy:220,r:70.4,fill:'none',stroke:'white','stroke-width':.8
    });
    for(const s of currentDraft()?.shots||[])shape('circle',{
      cx:s.x,cy:s.y,r:2,fill:s.esito==='Bersaglio'?'#2fc98b':'#ff5c5c',stroke:'white','stroke-width':.5
    });
    shape('path',{
      d:`M ${p.x-6} ${p.y} h 12 M ${p.x} ${p.y-6} v 12`,stroke:'#ffd200','stroke-width':1
    });
    aim.replaceChildren(svg);
    const list=D.clone(currentDraft()?.shots||[]);
    if(list[gesture.index])list[gesture.index]=D.shot(p.x,p.y,state.meta.currentPos,gesture.index+1);
    renderShots(list);
  }
  $('target-box').addEventListener('pointermove',e=>{
    if(!gesture||gesture.pointerId!==e.pointerId)return;
    if(Math.hypot(e.clientX-gesture.startX,e.clientY-gesture.startY)>20)gesture.drift=true;
    if(gesture.editing)previewAim(e);
  });
  $('target-box').addEventListener('pointerup',async e=>{
    if(!gesture||gesture.pointerId!==e.pointerId)return;
    const g=gesture,p=coords(e);
    resetGesture();
    if($('target-box').hasPointerCapture(e.pointerId))$('target-box').releasePointerCapture(e.pointerId);
    if(busy||locked||review||(!g.editing&&g.drift)){
      renderShots();
      return;
    }
    await change(s=>{
      if(g.editing){
        const d=D.checkedDraft(s,g.key,g.version);
        if(!d.shots[g.index])throw Error('Colpo non trovato.');
        d.shots[g.index]=D.shot(p.x,p.y,d.position,g.index+1);
        d.version++;
      }else D.addShot(s,p.x,p.y,g.key,g.version);
    });
  });
  $('target-box').addEventListener('pointercancel',()=>{
    resetGesture();
    renderShots();
  });
  $('target-box').addEventListener('lostpointercapture',()=>{
    resetGesture();
    renderShots();
  });
  $('athlete-select').addEventListener('change',e=>{
    const value=e.target.value;
    editing=false;
    change(s=>D.setContext(s,value,s.meta.currentMode,s.meta.currentPos),'Atleta selezionato. Le altre bozze sono conservate.');
  });
  $('mode-select').addEventListener('change',e=>{
    const value=e.target.value;
    editing=false;
    change(s=>D.setContext(s,s.meta.currentAthleteId,value,s.meta.currentPos));
  });
  $('position-button').addEventListener('click',()=>{
    editing=false;
    change(s=>D.setContext(s,s.meta.currentAthleteId,s.meta.currentMode,s.meta.currentPos==='T'?'P':'T'));
  });
  $('series-button').addEventListener('click',()=>openDialog('series-dialog'));
  $('series-form').addEventListener('submit',async e=>{
    e.preventDefault();
    const number=Number($('series-number').value),c=context();
    if(!Number.isInteger(number)||number<1||number>9999)return showError(Error('Numero serie non valido.'));
    const done=await change(s=>{
      const d=D.checkedDraft(s,c.key,c.version);
      if(s.series.some(r=>r.sessionId===d.sessionId&&r.athleteId===d.athleteId&&r.type===d.mode&&r.series===`${number}${d.position}`&&r.id!==d.replacesId))throw Error('La serie esiste già: aprila dallo storico per modificarla.');
      d.number=number;
      d.version++;
    });
    if(done)$('series-dialog').close();
  });
  $('edit-button').addEventListener('click',()=>{
    if(locked)return;
    editing=!editing;
    selectedShot=0;
    render();
  });
  $('undo-button').addEventListener('click',()=>{
    const c=context();
    change(s=>{
      const d=D.checkedDraft(s,c.key,c.version);
      d.shots.pop();
      d.version++;
    });
  });
  $('clear-button').addEventListener('click',async()=>{
    const c=context(),d=currentDraft();
    if(!d||locked)return;
    if(!await confirmAction('Svuota bersaglio',`Cancellare i ${d.shots.length} colpi della bozza? Le serie già salvate resteranno nello storico.`,'Svuota'))return;
    await change(s=>{
      const draft=D.checkedDraft(s,c.key,c.version);
      if(draft.replacesId){delete s.meta.drafts[c.key];D.draft(s);return;}
      draft.shots=[];
      draft.version++;
      draft.replacesId=null;
    });
    editing=false;
    render();
  });
  $('save-button').addEventListener('click',async()=>{
    const c=context();
    const done=await change(s=>D.saveSeries(s,c.key,c.version),r=>`${r.athlete} · Serie ${r.series} salvata sul dispositivo.`);
    if(done){
      editing=false;
      render();
      sync.schedule();
    }
  });
  $('lock-button').addEventListener('click',async()=>{
    if(locked&&!await confirmAction('Sblocca comandi','Riprendere la registrazione dei colpi?','Sblocca'))return;
    locked=!locked;
    resetGesture();
    render();
  });
  $('wind-open').addEventListener('click',openWind);
  $('wind-save').addEventListener('click',async()=>{
    const choice=D.clone(windChoice),c=windTarget;
    const done=await change(s=>{
      const d=D.checkedDraft(s,c.key,c.version);
      d.wind=choice;
      d.version++;
      s.meta.currentWind=choice;
    });
    if(done)$('wind-dialog').close();
  });
  $('menu-open').addEventListener('click',()=>openDialog('menu-dialog'));
  $('sync-status').addEventListener('click',()=>openDialog('menu-dialog'));
  $('history-open').addEventListener('click',()=>openDialog('history-dialog'));
  document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>b.closest('dialog').close()));
  document.querySelectorAll('[data-open]').forEach(b=>b.addEventListener('click',()=>openDialog(b.dataset.open)));
  for(const dialog of document.querySelectorAll('dialog'))dialog.addEventListener('click',e=>{
    if(e.target===dialog&&dialog.id!=='confirm-dialog'){
      const rect=dialog.getBoundingClientRect();
      if(e.clientX<rect.left||e.clientX>rect.right||e.clientY<rect.top||e.clientY>rect.bottom)dialog.close();
    }
  });
  $('settings-form').addEventListener('submit',async e=>{
    e.preventDefault();
    try{
      const config={
        coachName:$('coach-name').value.trim(),cloudUrl:D.validUrl($('cloud-url').value),lookerUrl:D.validUrl($('looker-url').value),apiToken:$('api-token').value.trim(),shotLimit:D.limit($('shot-limit').value),theme:$('theme-select').value,shotColor:$('shot-color-select').value
      };
      if(config.cloudUrl&&new URL(config.cloudUrl).hostname!=='script.google.com')throw Error('Inserisci l’indirizzo del deployment Google Apps Script.');
      if(state.outbox.length&&state.meta.cloudUrl&&config.cloudUrl!==state.meta.cloudUrl&&!await confirmAction('Cambia destinazione',`Ci sono ${state.outbox.length} operazioni pendenti. Inviarle al nuovo indirizzo configurato?`,'Cambia destinazione'))return;
      const done=await change(s=>{
        if(s.meta.syncLease?.until>Date.now()&&(config.cloudUrl!==s.meta.cloudUrl||config.apiToken!==s.meta.apiToken))throw Error('Attendi la fine della sincronizzazione prima di cambiare indirizzo o chiave.');
        Object.assign(s.meta,config);
      },'Impostazioni salvate sul dispositivo.');
      if(done)sync.schedule();
    }catch(error){
      showError(error);
    }
  });
  $('athlete-form').addEventListener('submit',async e=>{
    e.preventDefault();
    const name=$('new-athlete').value.trim();
    if(!name)return;
    const done=await change(s=>{
      if(s.meta.roster.some(a=>a.name.toLocaleLowerCase('it')===name.toLocaleLowerCase('it')))throw Error('Un atleta con questo nome è già presente.');
      const a={
        id:D.uid(),name
      };
      s.meta.roster.push(a);
      if(!s.meta.activeIds.length){
        s.meta.activeIds=[a.id];
        s.meta.currentAthleteId=a.id;
        D.draft(s);
      }
    },'Atleta aggiunto all’archivio.');
    if(done){
      $('new-athlete').value='';
      renderRoster();
    }
  });
  $('session-start').addEventListener('click',async()=>{
    const ids=Array.from($('session-checklist').querySelectorAll('input:checked'),e=>e.value);
    const done=await change(s=>D.startSession(s,ids),'Nuova sessione avviata. Le sessioni precedenti sono nello storico.');
    if(done){
      review=null;
      editing=false;
      $('session-dialog').close();
      render();
    }
  });
  $('history-session').addEventListener('change',renderHistory);
  $('history-athlete').addEventListener('change',renderHistory);
  $('review-slider').addEventListener('input',renderShots);
  $('review-exit').addEventListener('click',()=>{
    review=null;
    render();
  });
  $('sync-now').addEventListener('click',async()=>{
    try{
      await repo.queue;
      const result=await sync.run();
      if(result.offline)notify('Senza connessione. I dati restano sul dispositivo.');
      else if(result.idle)notify('Nessuna operazione da inviare, oppure invio già attivo in un’altra scheda.');
      else notify(result.remaining?'Invio in corso: altre operazioni seguiranno automaticamente.':'Sincronizzazione completata.');
    }catch(error){
      showError(error);
    }
    await refresh();
  });
  $('roster-download').addEventListener('click',async()=>{
    if(!navigator.onLine)return showError(Error('Serve una connessione per scaricare gli atleti. L’archivio locale resta disponibile.'));
    try{
      const config=D.clone(state.meta);
      const roster=await sync.roster(config);
      if(!roster.length)throw Error('Il foglio non contiene atleti.');
      if(!await confirmAction('Aggiorna anagrafica',`Scaricati ${roster.length} atleti. Unirli all’archivio locale conservando gli atleti già presenti?`,'Unisci'))return;
      const done=await change(s=>D.mergeRoster(s,roster),'Anagrafica aggiornata. Seleziona i presenti in Nuova sessione.');
      if(done)renderRoster();
    }catch(error){
      showError(error);
    }
  });
  function download(data,name){
    const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{
      type:'application/json'
    })),link=node('a');
    link.href=url;
    link.download=name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  $('backup-export').addEventListener('click',async()=>{
    try{
      download(await repo.backup(),`biathlon-backup-${new Date().toISOString().slice(0,10)}.json`);
      notify('Backup preparato. Conserva il file scaricato.');
    }catch(error){
      showError(error);
    }
  });
  $('backup-file').addEventListener('change',async e=>{
    const file=e.target.files[0];
    if(!file)return;
    try{
      if(file.size>20000000)throw Error('Il backup supera 20 MB.');
      const valid=D.validate(JSON.parse(await file.text()));
      if(!await confirmAction('Ripristina backup',`Il backup contiene ${valid.series.length} serie e ${valid.outbox.length} operazioni da inviare. Sostituire i dati su questo dispositivo? Esporta prima un backup dell’archivio attuale.`,'Ripristina'))return;
      if(state.meta.syncLease?.until>Date.now())throw Error('Attendi la fine della sincronizzazione prima del ripristino.');
      sync.stop();
      const result=await change(s=>{
        Object.assign(s,D.clone(valid));
        s.meta.syncLease=null;
      },'Backup ripristinato. Verifica firma, indirizzo Google e chiave prima di sincronizzare.');
      if(result){
        review=null;
        editing=false;
        fillSettings();
        render();
      }
    }catch(error){
      showError(error);
    }finally{
      e.target.value='';
    }
  });
  $('factory-reset').addEventListener('click',async()=>{
    if(state.meta.syncLease?.until>Date.now())return showError(Error('Attendi la fine della sincronizzazione prima del reset.'));
    if(!await confirmAction('Reset totale',`Eliminare tutti i dati di questo dispositivo? Sono presenti ${state.series.length} serie e ${state.outbox.length} operazioni da inviare. Esporta prima un backup. Il foglio Google non sarà cancellato.`,'Elimina dati locali'))return;
    try{
      sync.stop();
      await repo.reset();
      location.reload();
    }catch(error){
      showError(error);
    }
  });
  $('dashboard-open').addEventListener('click',()=>{
    try{
      if(!navigator.onLine)throw Error('Le statistiche online richiedono connessione. Usa il riepilogo sul dispositivo.');
      const url=D.validUrl(state.meta.lookerUrl);
      if(!url)throw Error('Configura l’indirizzo delle statistiche nelle impostazioni.');
      window.open(url,'_blank','noopener,noreferrer');
    }catch(error){
      showError(error);
    }
  });
  async function requestWake(){
    try{
      if(!('wakeLock'in navigator))throw Error('Questo browser non supporta il mantenimento dello schermo acceso.');
      wakeLock=await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release',()=>{
        $('wake-button').textContent='Mantieni schermo acceso';
        $('wake-button').setAttribute('aria-pressed','false');
      });
      $('wake-button').textContent='Schermo acceso · Disattiva';
      $('wake-button').setAttribute('aria-pressed','true');
    }catch(error){
      wakeWanted=false;
      showError(error);
    }
  }
  $('wake-button').addEventListener('click',async()=>{
    wakeWanted=!wakeWanted;
    if(wakeWanted)await requestWake();
    else await wakeLock?.release();
  });
  async function setupOffline(){
    if(!('serviceWorker'in navigator)){
      $('offline-ready').textContent='Questo browser non supporta il caricamento offline. Usa un browser aggiornato.';
      return;
    }
    try{
      registration=await navigator.serviceWorker.register('sw.js');
      const ready=await navigator.serviceWorker.ready;
      const check=()=>{
        if(registration.waiting)$('update-button').hidden=false;
      };
      registration.addEventListener('updatefound',()=>{
        const worker=registration.installing;
        worker?.addEventListener('statechange',check);
      });
      check();
      const cache=await caches.open('biathlon-field-v6-2');
      $('offline-ready').textContent=await cache.match(new URL('index.html',location.href).href)?'App pronta per la riapertura senza connessione.':'Preparazione offline in corso. Attendi il completamento prima di disconnetterti.';
      if(!navigator.serviceWorker.controller)ready.active?.postMessage({
        type:'CLAIM'
      });
    }catch(error){
      $('offline-ready').textContent='Preparazione offline non riuscita. Riapri l’app con una connessione prima di usarla senza rete.';
    }
  }
  $('update-button').addEventListener('click',async()=>{
    if(!await confirmAction('Aggiorna app','Installare l’aggiornamento e riaprire l’app? Serie e bozze già salvate rimarranno sul dispositivo.','Aggiorna'))return;
    await repo.queue;
    installingUpdate=true;
    registration?.waiting?.postMessage({
      type:'ACTIVATE'
    });
  });
  navigator.serviceWorker?.addEventListener('controllerchange',()=>{
    if(installingUpdate)location.reload();
  });
  window.addEventListener('online',()=>{
    if(state)renderSync();
    sync.schedule(3000);
  });
  window.addEventListener('offline',()=>{
    sync.stop();
    if(state)renderSync();
  });
  document.addEventListener('visibilitychange',async()=>{
    resetGesture();
    if(document.visibilityState==='visible'&&state){
      await refresh().catch(showError);
      sync.schedule();
      if(wakeWanted)requestWake();
    }
  });
  window.addEventListener('pagehide',()=>{
    resetGesture();
    repo.close();
  });
  repo.onchange=()=>refresh().catch(showError);
  repo.onblocked=message=>{
    $('startup-message').textContent=message;
    $('startup').hidden=false;
  };
  $('reload-button').addEventListener('click',()=>location.reload());
  $('recovery-export').addEventListener('click',async()=>{
    try{
      download(await repo.rawBackup(),'biathlon-recupero.json');
    }catch(error){
      $('startup-message').textContent=error.message;
    }
  });
  async function init(){
    try{
      state=await repo.initialize();
      const initialized=await repo.mutate(s=>D.draft(s));
      state=initialized.state;
      render();
      $('app').inert=false;
      $('app').setAttribute('aria-busy','false');
      $('startup').hidden=true;
      if(!state.meta.roster.length)notify('Apri il menu per aggiungere gli atleti o scaricare l’anagrafica.');
      setupOffline();
      sync.schedule();
      if(navigator.storage?.persist)navigator.storage.persist().catch(()=>{
      });
    }catch(error){
      $('startup-message').textContent=`Archivio non aperto: ${error.message} I dati esistenti non sono stati sostituiti.`;
      $('recovery-export').hidden=false;
      $('reload-button').hidden=false;
    }
  }
  init();
})();
