(async function(){
  const assert=(value,message='Assertion failed')=>{if(!value)throw Error(message);};
  const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
  const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
  async function test(name,run){
    try{await run();testResults.push({name,ok:true});}
    catch(error){testResults.push({name,ok:false,error:String(error.message||error)+' '+String(error.stack||'')});}
  }
  class Events{
    constructor(){this.listeners={};}
    addEventListener(name,fn){(this.listeners[name]??=[]).push(fn);}
    removeEventListener(name,fn){this.listeners[name]=(this.listeners[name]||[]).filter(handler=>handler!==fn);}
    emit(name){for(const fn of [...(this.listeners[name]||[])])fn();}
  }
  function fixture({waiting=false,online=true,controlled=true,beforeActivate=async()=>{},completeActivation=true}={}){
    const sw=new Events(),registration=new Events(),worker=new Events();
    const calls={register:0,update:0,activate:0,reload:0,available:false,failures:[]};
    sw.controller=controlled?{state:'activated'}:null;
    worker.state=waiting?'installed':'installing';
    registration.waiting=waiting?worker:null;
    registration.installing=null;
    registration.update=async()=>{calls.update++;return registration;};
    sw.register=async(url,options)=>{
      calls.register++;assert(url==='sw.js');assert(options.updateViaCache==='none');return registration;
    };
    sw.getRegistration=async()=>registration;
    worker.postMessage=message=>{
      assert(message.type==='ACTIVATE');calls.activate++;
      if(completeActivation){
        registration.waiting=null;worker.state='activated';sw.controller=worker;sw.emit('controllerchange');
      }
    };
    const manager=new BiathlonUpdates({serviceWorker:sw,online:()=>online,timeout:31,activationTimeout:79,
      beforeActivate,reload:()=>{calls.reload++;},onAvailable:available=>{calls.available=available;},onFailure:message=>calls.failures.push(message)});
    const install=()=>{
      registration.installing=worker;worker.state='installing';registration.emit('updatefound');
    };
    const installed=()=>{
      registration.installing=null;registration.waiting=worker;worker.state='installed';worker.emit('statechange');
    };
    return {manager,sw,registration,worker,calls,install,installed};
  }
  function fireTimer(ms){
    const found=[...__timers].find(([,timer])=>timer.ms===ms);
    assert(found,'Expected update timer');__timers.delete(found[0]);found[1].fn();
  }
  await test('A waiting update activates automatically at startup and reloads only once',async()=>{
    const f=fixture({waiting:true});
    assert(await f.manager.start());
    assert(f.calls.activate===1&&f.calls.reload===1);
    f.sw.emit('controllerchange');
    assert(f.calls.reload===1);
  });
  await test('An update discovered on opening waits for installation and committed writes',async()=>{
    const saved=deferred(),f=fixture({beforeActivate:()=>saved.promise});
    f.registration.update=async()=>{f.calls.update++;f.install();return f.registration;};
    const task=f.manager.start();await flush();
    assert(f.calls.update===1&&f.calls.activate===0);
    f.installed();await flush();
    assert(f.calls.activate===0&&f.calls.reload===0,'Reload began before local writes completed');
    saved.resolve();assert(await task);
    assert(f.calls.activate===1&&f.calls.reload===1);
  });
  await test('Opening with no new version checks for updates without reloading',async()=>{
    const f=fixture();
    assert(!await f.manager.start());
    assert(f.calls.register===1&&f.calls.update===1&&f.calls.reload===0);
  });
  await test('An update arriving after the startup deadline is offered without interrupting work',async()=>{
    const f=fixture();
    f.registration.update=async()=>{f.install();return f.registration;};
    const task=f.manager.start();await flush();fireTimer(31);
    assert(!await task);
    f.installed();await flush();
    assert(f.calls.available&&f.calls.activate===0&&f.calls.reload===0);
    assert(await f.manager.activate());
    assert(f.calls.reload===1);
  });
  await test('Offline opening uses the existing installation without network update calls',async()=>{
    const f=fixture({online:false});
    assert(!await f.manager.start());
    assert(f.calls.register===0&&f.calls.update===0&&f.calls.reload===0);
  });
  await test('The first service worker claim and changes from another tab do not reload an active page',async()=>{
    const f=fixture({controlled:false});
    assert(!await f.manager.start());
    f.sw.controller={state:'activated'};f.sw.emit('controllerchange');
    assert(f.calls.reload===0);
  });
  await test('Network update errors keep the available application usable',async()=>{
    const f=fixture();
    f.sw.register=async()=>{throw Error('Network unavailable');};
    f.registration.update=async()=>{throw Error('Network unavailable');};
    assert(!await f.manager.start());
    assert(f.calls.activate===0&&f.calls.reload===0);
  });
  await test('An activation timeout releases the page and a late controller change cannot interrupt work',async()=>{
    const f=fixture({waiting:true,completeActivation:false});
    const task=f.manager.start();await flush();fireTimer(79);
    assert(!await task);
    assert(f.calls.failures.length===1&&f.calls.reload===0);
    f.sw.controller=f.worker;f.sw.emit('controllerchange');
    assert(f.calls.reload===0);
  });
  await test('Concurrent activation requests share one update and one reload',async()=>{
    const saved=deferred(),f=fixture({waiting:true,beforeActivate:()=>saved.promise});
    f.manager.registration=f.registration;
    const first=f.manager.activate(),second=f.manager.activate();
    assert(first===second);saved.resolve();
    assert(await first);assert(await second);
    assert(f.calls.activate===1&&f.calls.reload===1);
  });
  await test('A failed pre-update save never activates the new worker',async()=>{
    const f=fixture({waiting:true,beforeActivate:async()=>{throw Error('Local save failed');}});
    assert(!await f.manager.start());
    assert(f.calls.activate===0&&f.calls.reload===0&&f.calls.failures.length===1);
  });
  globalThis.testDone=true;
})().catch(error=>{
  testResults.push({name:'Update test harness',ok:false,error:String(error.message||error)});
  testDone=true;
});
