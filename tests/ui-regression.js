(async function(){
  const element=id=>document.getElementById(id),assert=(v,m='Assertion failed')=>{
    if(!v)throw Error(m);
  };
  const flush=async()=>{
    for(let i=0;i<15;i++)await Promise.resolve();
  };
  async function reset(){
    for(const dialog of document.querySelectorAll('dialog[open]'))dialog.close();
    const s=BiathlonDomain.clone(__uiInitial);
    s.meta.revision=__uiRepo.snapshot.meta.revision+1;
    BiathlonDomain.draft(s);
    __uiRepo.snapshot=s;
    await __uiRepo.onchange();
    await flush();
    if(element('edit-button').getAttribute('aria-pressed')==='true')await element('edit-button').click();
  }
  async function test(name,fn,resetBefore=true){
    try{
      if(resetBefore)await reset();
      await fn();
      testResults.push({
        name,ok:true
      });
    }catch(error){
      testResults.push({
        name,ok:false,error:String(error.message||error)+' '+String(error.stack||'')
      });
    }
  }
  async function tap(x=195,y=214.5,extra={
  }){
    const target=element('target-box');
    await target.emit('pointerdown',{
      pointerId:1,isPrimary:true,button:0,clientX:x,clientY:y,...extra
    });
    await target.emit('pointerup',{
      pointerId:1,isPrimary:true,button:0,clientX:x,clientY:y,...extra
    });
    await flush();
  }
  async function settings(){
    await element('menu-open').click();
    await document.querySelectorAll('[data-open]').find(b=>b.dataset.open==='settings-dialog').click();
  }
  await flush();
  assert(element('startup').hidden,'Application did not start');
  assert(!element('app').inert,'Application still inert');
  await test('A personal invite survives an update reload and still requires explicit activation',()=>{
    assert(element('access-dialog').open);
    assert(element('access-description').textContent.includes('Coach Invito'));
    assert(!__uiRepo.snapshot.meta.apiToken);
    assert(!__uiSession.has('biathlon-update-pending-access'),'Pending credential was not removed after recovery');
    assert(!location.href.includes('pending-personal-test-token'));
  },false);
  await test('UI starts with 5-shot limit and explicit athlete/context',async()=>{
    assert(element('shot-count').textContent==='0 / 5 colpi');
    assert(element('athlete-select').value==='1');
    assert(element('position-button').textContent==='Terra');
  });
  await test('Updated training menu keeps an old series editable and saves new selections with their names',async()=>{
    const s=__uiRepo.snapshot,D=BiathlonDomain;
    D.setContext(s,'1','L3','T');
    let draft=D.draft(s);D.addShot(s,200,220,draft.key,draft.version);
    draft=D.draft(s);D.saveSeries(s,draft.key,draft.version);
    await __uiRepo.onchange();await flush();
    await element('history-open').click();
    await element('history-list').children[0].children[1].children[1].click();await flush();
    assert(element('mode-select').value==='L3');
    assert(element('mode-select').children.find(o=>o.value==='L3').hidden);
    await tap(240,240);await element('save-button').click();await flush();
    assert(__uiRepo.snapshot.series[0].type==='L3');
    const modes=['Azzeramento','Tiro da fermo','i1-i2','i3','i4','i5','Gara','Altro'];
    assert(JSON.stringify(element('mode-select').children.filter(o=>!o.hidden).map(o=>o.value))===JSON.stringify(modes));
    for(const mode of modes){
      element('mode-select').value=mode;await element('mode-select').emit('change');await flush();
      await tap();await element('save-button').click();await flush();
      assert(__uiRepo.snapshot.series.at(-1).type===mode);
      assert(__uiRepo.snapshot.outbox.at(-1).payload.type===mode);
    }
  });
  await test('Public access can keep local athletes offline but cannot download or upload to Google',async()=>{
    let calls=0;
    const oldFetch=globalThis.fetch;
    globalThis.fetch=async()=>{calls++;throw Error('Anonymous cloud request');};
    navigator.onLine=true;
    try{
      await tap();await element('save-button').click();await flush();
      await settings();
      assert(element('access-status').textContent==='Nessun allenatore');
      assert(element('roster-list').children.length===2);
      await element('roster-download').click();await flush();
      await element('sync-now').click();await flush();
      assert(calls===0);
      assert(__uiRepo.snapshot.outbox.length===1);
      assert(__uiRepo.snapshot.meta.roster.length===2);
      const fresh=BiathlonDomain.create();
      assert(fresh.meta.roster.length===0&&!fresh.meta.apiToken&&!fresh.meta.adminToken);
    }finally{globalThis.fetch=oldFetch;navigator.onLine=false;}
  });
  await test('Connection check identifies the destination with a personal credential and no data upload',async()=>{
    const oldFetch=globalThis.fetch;
    let request;
    globalThis.fetch=async(url,options)=>{
      request=JSON.parse(options.body);
      return {ok:true,json:async()=>({status:'success',protocolVersion:2,coach:'Coach',databaseSheet:'Database_Colpi'})};
    };
    navigator.onLine=true;
    try{
      await settings();
      element('coach-name').value='Coach';
      element('cloud-url').value='https://script.google.com/macros/s/test/exec';
      element('api-token').value='personal-test-token';
      await element('connection-check').click();await flush();
      assert(request.action==='connection'&&request.token==='personal-test-token');
      assert(!request.inserts&&!request.deletes);
      assert(element('connection-result').textContent.includes('Database_Colpi'));
      assert(!__uiRepo.snapshot.meta.apiToken,'Checking must not save credentials before confirmation');
    }finally{globalThis.fetch=oldFetch;navigator.onLine=false;}
  });
  await test('Administrator can activate a separate coach access on the same device',async()=>{
    const oldFetch=globalThis.fetch;
    const endpoint='https://script.google.com/macros/s/test/exec',adminToken='private-admin-test-token',coachToken='personal-coach-test-token';
    const s=__uiRepo.snapshot;
    s.meta.adminUrl=endpoint;s.meta.adminToken=adminToken;
    await __uiRepo.onchange();await flush();
    const requests=[];
    globalThis.fetch=async(url,options)=>{
      const request=JSON.parse(options.body);requests.push(request);
      if(request.action==='admin.list'){
        assert(request.token===adminToken);
        return {ok:true,json:async()=>({status:'success',protocolVersion:2,coaches:[{id:'coach-id',name:'Coach',active:true,token:coachToken,keyHint:'st-token'}]})};
      }
      assert(request.action==='roster'&&request.token===coachToken);
      return {ok:true,json:async()=>({status:'success',protocolVersion:2,coach:'Coach',roster:[{id:'remote-id',name:'Atleta remoto'}]})};
    };
    navigator.onLine=true;
    try{
      await settings();
      assert(element('access-status').textContent==='Amministratore');
      await element('admin-open').click();await flush();
      const use=element('admin-coaches').querySelectorAll('button').find(b=>b.dataset.action==='use-access');
      assert(use);
      await use.click();await flush();
      assert(!__uiRepo.snapshot.meta.apiToken);
      assert(requests.length===1,'Coach activation must require confirmation');
      await element('access-activate').click();await flush();
      assert(__uiRepo.snapshot.meta.apiToken===coachToken);
      assert(__uiRepo.snapshot.meta.adminToken===adminToken);
      assert(__uiRepo.snapshot.meta.cloudUrl===endpoint);
      assert(__uiRepo.snapshot.meta.roster.some(a=>a.id==='remote-id'));
      assert(element('access-status').textContent==='Coach');
    }finally{globalThis.fetch=oldFetch;navigator.onLine=false;}
  });
  await test('UI records repeated taps at the same point',async()=>{
    await tap();
    await tap();
    assert(BiathlonDomain.draft(__uiRepo.snapshot).shots.length===2);
    assert(element('shots-layer').children.length===2);
  });
  await test('UI pointer cancellation and scroll do not create phantom shots',async()=>{
    const t=element('target-box');
    await t.emit('pointerdown',{
      pointerId:1,isPrimary:true,button:0,clientX:195,clientY:214
    });
    await t.emit('pointercancel',{
      pointerId:1
    });
    await t.emit('pointerup',{
      pointerId:1,clientX:195,clientY:214
    });
    await t.emit('pointerdown',{
      pointerId:1,isPrimary:true,button:0,clientX:195,clientY:214
    });
    await t.emit('pointermove',{
      pointerId:1,clientX:195,clientY:300
    });
    await t.emit('pointerup',{
      pointerId:1,clientX:195,clientY:300
    });
    await flush();
    assert(!BiathlonDomain.draft(__uiRepo.snapshot).shots.length);
  });
  await test('UI switches athletes without moving the previous draft',async()=>{
    await tap();
    element('athlete-select').value='2';
    await element('athlete-select').emit('change');
    await flush();
    assert(element('shot-count').textContent==='0 / 5 colpi');
    await tap();
    await element('save-button').click();
    await flush();
    assert(__uiRepo.snapshot.series[0].athlete==='Atleta B');
    element('athlete-select').value='1';
    await element('athlete-select').emit('change');
    await flush();
    assert(element('shot-count').textContent==='1 / 5 colpi');
  });
  await test('UI failed disk write preserves draft and displays a saving error',async()=>{
    await tap();
    __uiRepo.failNext=true;
    await element('save-button').click();
    await flush();
    assert(__uiRepo.snapshot.series.length===0);
    assert(BiathlonDomain.draft(__uiRepo.snapshot).shots.length===1);
    assert(element('storage-status').classList.contains('error'));
  });
  await test('UI saves locally without network and queues the series',async()=>{
    await tap();
    await element('save-button').click();
    await flush();
    assert(__uiRepo.snapshot.series.length===1);
    assert(__uiRepo.snapshot.outbox.length===1);
    assert(element('storage-status').textContent==='Salvato sul dispositivo');
    assert(element('shot-count').textContent==='0 / 5 colpi');
  });
  await test('UI monochrome selection immediately recomputes marker contrast',async()=>{
    await tap();
    await element('menu-open').click();
    const settings=document.querySelectorAll('[data-open]').find(b=>b.dataset.open==='settings-dialog');
    await settings.click();
    element('shot-color-select').value='white';
    await element('settings-form').emit('submit');
    await flush();
    assert(element('target-box').classList.contains('mono'));
    assert(element('shots-layer').children[0].classList.contains('on-dark'));
  });
  await test('UI accepts limit 1..50 while retaining shots already recorded',async()=>{
    await tap();
    await element('menu-open').click();
    await document.querySelectorAll('[data-open]').find(b=>b.dataset.open==='settings-dialog').click();
    element('shot-limit').value='50';
    await element('settings-form').emit('submit');
    await flush();
    assert(__uiRepo.snapshot.meta.shotLimit===50);
    assert(BiathlonDomain.draft(__uiRepo.snapshot).shots.length===1);
  });
  await test('UI edit mode moves only the selected shot',async()=>{
    await tap();
    await tap(220,220);
    await element('edit-button').click();
    await tap(240,240);
    const shots=BiathlonDomain.draft(__uiRepo.snapshot).shots;
    assert(shots.length===2);
    assert(Math.abs(shots[0].x-240/390*400)<1e-9);
    assert(Math.abs(shots[1].x-220/390*400)<1e-9);
  });
  async function editTouch(type,extra={}){
    const rect=element('edit-button').getBoundingClientRect();
    return element('edit-button').emit(type,{
      pointerId:2,pointerType:'touch',isPrimary:true,button:0,
      clientX:(rect.left+rect.right)/2,clientY:(rect.top+rect.bottom)/2,...extra
    });
  }
  await test('One touch finishes editing after a drag and the following click cannot reopen it',async()=>{
    await tap();await element('edit-button').click();
    const target=element('target-box');
    await target.emit('pointerdown',{pointerId:1,pointerType:'touch',isPrimary:true,button:0,clientX:195,clientY:214});
    await target.emit('pointermove',{pointerId:1,clientX:240,clientY:240});
    await target.emit('pointerup',{pointerId:1,clientX:240,clientY:240});
    await editTouch('pointerdown');await editTouch('pointerup');
    assert(element('edit-button').getAttribute('aria-pressed')==='false','A second touch would be needed');
    assert(element('edit-button').textContent==='Modifica colpi');
    assert(element('shot-picker').hidden&&element('aim-preview').hidden);
    assert(!target.hasPointerCapture(1));
    await element('edit-button').emit('click',{detail:1,pointerType:'touch',pointerId:2});
    assert(element('edit-button').getAttribute('aria-pressed')==='false','Compatibility click reopened editing');
    const moved=BiathlonDomain.draft(__uiRepo.snapshot).shots[0];
    assert(Math.abs(moved.x-240/390*400)<1e-9);
    await tap(300,300);
    assert(BiathlonDomain.draft(__uiRepo.snapshot).shots.length===2,'Target remained in editing mode');
  });
  await test('Finishing editing during a pending shot save retains the moved point',async()=>{
    await tap();await element('edit-button').click();
    let release;
    const target=element('target-box');
    await target.emit('pointerdown',{pointerId:1,pointerType:'touch',isPrimary:true,button:0,clientX:195,clientY:214});
    __uiRepo.queue=new Promise(resolve=>{release=resolve;});
    const saving=target.emit('pointerup',{pointerId:1,clientX:240,clientY:240});
    try{
      await editTouch('pointerdown');await editTouch('pointerup');
      assert(element('edit-button').getAttribute('aria-pressed')==='false');
    }finally{release();await saving;}
    await element('edit-button').emit('click',{detail:1,pointerType:'touch',pointerId:2});
    assert(element('edit-button').getAttribute('aria-pressed')==='false');
    assert(Math.abs(BiathlonDomain.draft(__uiRepo.snapshot).shots[0].x-240/390*400)<1e-9);
  });
  await test('Scrolling, cancelling or releasing outside Fine modifica does not activate it',async()=>{
    await tap();await element('edit-button').click();
    for(const action of ['cancel','scroll','outside']){
      const start=action==='outside'?{clientX:385}:{};
      await editTouch('pointerdown',start);
      if(action==='cancel')await editTouch('pointercancel');
      if(action==='scroll')await editTouch('pointermove',{clientY:260});
      await editTouch('pointerup',action==='outside'?{clientX:395}:{});
      await element('edit-button').emit('click',{detail:1,pointerType:'touch',pointerId:2});
      assert(element('edit-button').getAttribute('aria-pressed')==='true',`${action} activated the button`);
    }
  });
  await test('Edit controls accept successive pen taps and keyboard or mouse activation',async()=>{
    await tap();
    for(const expected of ['true','false']){
      await editTouch('pointerdown',{pointerType:'pen'});await editTouch('pointerup',{pointerType:'pen'});
      await element('edit-button').emit('click',{detail:1,pointerType:'pen',pointerId:2});
      assert(element('edit-button').getAttribute('aria-pressed')===expected);
    }
    await editTouch('pointerdown');await editTouch('pointerup');
    // A browser may omit the touch click: keyboard activation must still work.
    await element('edit-button').emit('click',{detail:0});
    assert(element('edit-button').getAttribute('aria-pressed')==='false');
    await editTouch('pointerdown',{pointerType:'mouse'});await editTouch('pointerup',{pointerType:'mouse'});
    await element('edit-button').emit('click',{detail:1,pointerType:'mouse'});
    assert(element('edit-button').getAttribute('aria-pressed')==='true');
    await element('edit-button').emit('click',{detail:0});
    assert(element('edit-button').getAttribute('aria-pressed')==='false');
  });
  async function openCorrection(){
    await tap();await tap(220,220);
    await element('save-button').click();await flush();
    const original=BiathlonDomain.clone(__uiRepo.snapshot.series[0]);
    await element('history-open').click();
    await element('history-list').children[0].children[1].children[1].click();await flush();
    assert(BiathlonDomain.draft(__uiRepo.snapshot).replacesId===original.id,'Original series was not opened for correction');
    assert(element('edit-button').getAttribute('aria-pressed')==='true','Correction did not start shot editing');
    await element('undo-button').click();await flush();
    await element('undo-button').click();await flush();
    assert(BiathlonDomain.draft(__uiRepo.snapshot).shots.length===0,'Undo did not remove all shots');
    return original;
  }
  await test('Removing the final shot of a correction allows new shots and saving a replacement',async()=>{
    const original=await openCorrection();
    assert(element('edit-button').getAttribute('aria-pressed')==='false','Empty correction stayed in shot editing mode');
    assert(!element('clear-button').disabled,'Empty correction cannot be cancelled');
    assert(element('save-button').disabled,'An empty correction must not replace the original');
    assert(__uiRepo.snapshot.series[0].id===original.id);
    await tap(240,240);
    assert(BiathlonDomain.draft(__uiRepo.snapshot).shots.length===1);
    await element('save-button').click();await flush();
    const replacement=__uiRepo.snapshot.series[0];
    assert(__uiRepo.snapshot.series.length===1);
    assert(replacement.id!==original.id&&replacement.series===original.series);
    assert(replacement.timestamp===original.timestamp);
    assert(replacement.shots.length===1);
    assert(__uiRepo.snapshot.outbox.some(op=>op.kind==='delete'&&op.seriesId===original.id));
    assert(__uiRepo.snapshot.outbox.some(op=>op.kind==='insert'&&op.seriesId===replacement.id));
  });
  await test('Cancelling an empty correction preserves the original series and pending operations',async()=>{
    const original=await openCorrection();
    const queue=JSON.stringify(__uiRepo.snapshot.outbox);
    assert(!element('clear-button').disabled,'Cancel is disabled after undoing every shot');
    const pending=element('clear-button').click();await flush();
    element('confirm-dialog').close('accept');await pending;await flush();
    assert(JSON.stringify(__uiRepo.snapshot.series[0])===JSON.stringify(original));
    assert(JSON.stringify(__uiRepo.snapshot.outbox)===queue);
    assert(!BiathlonDomain.draft(__uiRepo.snapshot).replacesId);
    await tap();await element('save-button').click();await flush();
    assert(__uiRepo.snapshot.series.length===2,'Registration did not resume after cancellation');
  });
  await test('UI athlete names are text, never interpreted markup',async()=>{
    const s=__uiRepo.snapshot;
    s.meta.roster[0].name='<img src=x onerror=evil()>';
    await __uiRepo.onchange();
    await flush();
    assert(element('athlete-select').children[0].textContent==='<img src=x onerror=evil()>');
    assert(element('athlete-select').children[0].children.length===0);
  });
  await test('UI removing the active athlete selects a valid remaining athlete',async()=>{
    await tap();await element('menu-open').click();await document.querySelectorAll('[data-open]').find(b=>b.dataset.open==='settings-dialog').click();const pending=element('roster-list').children[0].children[1].click();await flush();element('confirm-dialog').close('accept');await pending;await flush();assert(__uiRepo.snapshot.meta.currentAthleteId==='2');element('settings-dialog').close();await tap();await element('save-button').click();await flush();assert(__uiRepo.snapshot.series[0].athlete==='Atleta B');
  });
  await test('UI deleting the last saved series clears its history row',async()=>{
    await tap();await element('save-button').click();await flush();await element('history-open').click();const row=element('history-list').children[0],buttons=row.children[1];const pending=buttons.children[2].click();await flush();element('confirm-dialog').close('accept');await pending;await flush();assert(__uiRepo.snapshot.series.length===0);assert(element('history-list').children.length===1);assert(element('history-list').children[0].textContent==='Nessuna serie per questa selezione.');
  });
  await test('UI wind selection shows the original flag poses on a descending scale',async()=>{
    await element('wind-open').click();
    const levels=element('wind-levels').children;
    assert(levels.length===6);
    assert(levels.map(b=>b.dataset.level).join(',')==='5,4,3,2,1,0');
    assert(levels.every(b=>b.querySelector('svg')));
    assert(levels[0].querySelector('rect').getAttribute('transform')==='rotate(0 24 17)');
    assert(levels[5].querySelector('rect').getAttribute('transform')==='rotate(90 24 17)');
  });
  await test('UI wind choice stays a draft until confirmed and is restored after cancellation',async()=>{
    await element('wind-open').click();
    await element('wind-levels').children.find(b=>b.dataset.level==='3').click();
    assert(BiathlonDomain.draft(__uiRepo.snapshot).wind.int===0);
    element('wind-dialog').close();
    await element('wind-open').click();
    assert(element('wind-levels').children.find(b=>b.getAttribute('aria-pressed')==='true').dataset.level==='0');
    await element('wind-levels').children.find(b=>b.dataset.level==='3').click();
    await element('wind-save').click();await flush();
    assert(BiathlonDomain.draft(__uiRepo.snapshot).wind.int===3);
    assert(element('wind-open').querySelector('rect').getAttribute('transform')==='rotate(45 24 17)');
  });
  globalThis.testDone=true;
})().catch(error=>{
  testResults.push({
    name:'UI test harness',ok:false,error:String(error.stack||error)
  });
  testDone=true;
});
