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
  async function test(name,fn){
    try{
      await reset();
      await fn();
      testResults.push({
        name,ok:true
      });
    }catch(error){
      testResults.push({
        name,ok:false,error:String(error.stack||error)
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
  await flush();
  assert(element('startup').hidden,'Application did not start');
  assert(!element('app').inert,'Application still inert');
  await test('UI starts with 5-shot limit and explicit athlete/context',async()=>{
    assert(element('shot-count').textContent==='0 / 5 colpi');
    assert(element('athlete-select').value==='1');
    assert(element('position-button').textContent==='Terra');
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
  globalThis.testDone=true;
})().catch(error=>{
  testResults.push({
    name:'UI test harness',ok:false,error:String(error.stack||error)
  });
  testDone=true;
});
