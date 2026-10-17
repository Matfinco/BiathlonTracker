(async function(){
  const assert=(condition,message='Assertion failed')=>{
    if(!condition)throw Error(message);
  };
  async function test(name,fn){
    try{
      await fn();
      testResults.push({
        name,ok:true
      });
    }catch(error){
      testResults.push({
        name,ok:false,error:error.message+' '+error.stack
      });
    }
  }
  const listeners={
  },contents=new Map(),deleted=[],added=[];
  let claims=0,activations=0,currentCache='';
  globalThis.self={
    location:{
      origin:'https://example.test'
    },registration:{
      scope:'https://example.test/BiathlonTracker/'
    },clients:{
      claim:async()=>{
        claims++;
      }
    },skipWaiting:()=>{
      activations++;
    },addEventListener:(type,handler)=>{
      listeners[type]=handler;
    }
  };
  globalThis.caches={
    open:async name=>{
      if(!currentCache)currentCache=name;
      return {
      addAll:async assets=>{
        added.push(...assets);
        contents.set('https://example.test/BiathlonTracker/index.html',{
          body:'cached app'
        });
      },match:async request=>contents.get(typeof request==='string'?request:request.url)
    };},keys:async()=>['unrelated-app','biathlon-field-old-one','biathlon-field-old-two',currentCache],delete:async name=>{
      deleted.push(name);
    }
  };
  globalThis.fetch=async()=>{
    throw Error('Network unavailable');
  };
  (0,eval)(__workerSource);
  await test('Offline installation contains the complete local application',async()=>{
    let task;
    listeners.install({
      waitUntil:p=>task=p
    });
    await task;
    assert(added.includes('index.html')&&added.includes('src/app.js')&&added.includes('styles/app.css'));
    assert(added.every(path=>!path.startsWith('http')));
    assert(activations===0,'Update activated without user action');
  });
  await test('Cached application can be reopened with network unavailable',async()=>{
    let task;
    listeners.fetch({
      request:{
        url:'https://example.test/BiathlonTracker/',method:'GET',mode:'navigate'
      },respondWith:p=>task=p
    });
    const response=await task;
    assert(response.body==='cached app');
  });
  await test('Cloud requests are never cached or replayed by the worker',()=>{
    let intercepted=false;
    for(const method of ['GET','POST'])listeners.fetch({
      request:{
        url:'https://script.google.com/macros/s/test/exec',method,mode:'cors'
      },respondWith:()=>intercepted=true
    });
    assert(!intercepted);
  });
  await test('Worker update removes only old application caches',async()=>{
    let task;
    listeners.activate({
      waitUntil:p=>task=p
    });
    await task;
    assert(deleted.length===2&&deleted.includes('biathlon-field-old-one')&&deleted.includes('biathlon-field-old-two'));
    assert(!deleted.includes(currentCache)&&!deleted.includes('unrelated-app'));
    assert(claims===1);
  });
  await test('Worker activation requires an explicit update message',()=>{
    listeners.message({
      data:{
        type:'UNKNOWN'
      }
    });
    assert(activations===0);
    listeners.message({
      data:{
        type:'ACTIVATE'
      }
    });
    assert(activations===1);
  });
  globalThis.testDone=true;
})().catch(error=>{
  testResults.push({
    name:'Service worker test harness',ok:false,error:error.message+' '+error.stack
  });
  testDone=true;
});
