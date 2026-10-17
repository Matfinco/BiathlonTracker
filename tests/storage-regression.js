(async function(){
  const D=BiathlonDomain,assert=(condition,message='Assertion failed')=>{
    if(!condition)throw Error(message);
  };
  const copy=value=>value===undefined?undefined:D.clone(value);
  const tick=async()=>{
    for(let i=0;i<8;i++)await Promise.resolve();
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
  class Transaction{
    constructor(db,names,mode){
      Object.assign(this,{
        db,names,mode,requests:[],writes:[],aborted:false,finished:false
      });
    }
    objectStore(name){
      return {
        get:key=>this.request(()=>this.db.data[name].get(key)),getAll:()=>this.request(()=>Array.from(this.db.data[name].values())),getAllKeys:()=>this.request(()=>Array.from(this.db.data[name].keys())),put:(value,key)=>{
          this.writes.push({
            name,key:key??value.id,value:copy(value)
          });
          return {
          };
        },delete:key=>{
          this.writes.push({
            name,key,remove:true
          });
        }
      };
    }
    request(read){
      const req={
        read
      };
      this.requests.push(req);
      return req;
    }
    runRequests(){
      for(const req of [...this.requests]){
        req.result=copy(req.read());
        req.onsuccess?.();
      }
    }
    complete(){
      if(this.aborted)return;
      for(const w of this.writes)w.remove?this.db.data[w.name].delete(w.key):this.db.data[w.name].set(w.key,copy(w.value));
      this.finished=true;
      this.oncomplete?.();
    }
    abort(){
      this.aborted=true;
      this.finished=true;
      this.onabort?.();
    }
  }
  class Database{
    constructor(snapshot){
      this.data={
        appState:new Map(),meta:new Map(),series:new Map(),outbox:new Map(),sessions:new Map()
      };
      this.transactions=[];
      if(snapshot){
        this.data.meta.set('main',copy(snapshot.meta));
        for(const name of ['series','outbox','sessions'])for(const row of snapshot[name])this.data[name].set(row.id,copy(row));
      }
    }
    transaction(names,mode){
      const tx=new Transaction(this,names,mode);
      this.transactions.push(tx);
      return tx;
    }
    close(){
      this.closed=true;
    }
  }
  function fixture(snapshot=D.create()){
    const repo=new BiathlonRepository(),db=new Database(snapshot);
    repo.db=db;
    return {
      repo,db
    };
  }
  async function drive(db){
    for(let i=0;i<15;i++){
      await tick();
      for(const tx of db.transactions.filter(t=>!t.finished)){
        tx.runRequests();
        tx.complete();
      }
    }
  }
  globalThis.localStorage={
    getItem:()=>null,removeItem:()=>{
    }
  };
  await test('IndexedDB write resolves after transaction completion, not request success',async()=>{
    const {
      repo,db
    }
    =fixture();
    let done=false;
    const promise=repo.mutate(s=>{
      s.meta.coachName='Saved';
    }).then(()=>done=true);
    await tick();
    const tx=db.transactions[0];
    tx.runRequests();
    await tick();
    assert(!done);
    assert(db.data.meta.get('main').coachName==='');
    tx.complete();
    await promise;
    assert(done);
    assert(db.data.meta.get('main').coachName==='Saved');
  });
  await test('Aborted IndexedDB transaction rejects and keeps previous archive',async()=>{
    const {
      repo,db
    }
    =fixture();
    let rejected=false;
    const promise=repo.mutate(s=>{
      s.meta.coachName='Unsaved';
    }).catch(()=>rejected=true);
    await tick();
    const tx=db.transactions[0];
    tx.runRequests();
    tx.abort();
    await promise;
    assert(rejected);
    assert(db.data.meta.get('main').coachName==='');
  });
  await test('Domain validation failure aborts the whole IndexedDB mutation',async()=>{
    const {
      repo,db
    }
    =fixture();
    let rejected=false;
    const promise=repo.mutate(s=>{
      s.meta.coachName='Unsaved';
      throw Error('Validation failed');
    }).catch(()=>rejected=true);
    await tick();
    db.transactions[0].runRequests();
    await promise;
    assert(rejected);
    assert(db.data.meta.get('main').coachName==='');
  });
  await test('A metadata change does not rewrite historical records or the outbox',async()=>{
    const s=D.create();
    s.series=[{
      id:'historical',shots:[]
    }];
    s.outbox=[{
      id:'pending'
    }];
    const {
      repo,db
    }
    =fixture(s);
    const promise=repo.mutate(s=>s.meta.theme='night');
    await tick();
    const tx=db.transactions[0];
    tx.runRequests();
    assert(tx.writes.length===1&&tx.writes[0].name==='meta');
    tx.complete();
    await promise;
  });
  await test('Legacy migration keeps a raw backup and only commits a complete new archive',async()=>{
    const {
      repo,db
    }
    =fixture(null);
    db.data.appState.set('main_state',{
      roster:[{
        id:1,name:'A'
      }],activeAthletes:[{
        id:1,name:'A'
      }],currentAthleteId:1,currentShots:[{
        seq:1,x:100,y:110,bx:200,by:220
      }],history:[],syncQueue:[],deleteQueue:[]
    });
    const promise=repo.initialize();
    await drive(db);
    const migrated=await promise;
    assert(migrated.meta.schemaVersion===6);
    assert(D.draft(migrated).shots[0].x===200);
    assert(db.data.appState.has('legacy_backup_v5'));
    assert(db.data.appState.has('main_state'));
  });
  await test('Corrupt legacy localStorage does not prevent opening a valid current archive',async()=>{
    const {
      repo,db
    }
    =fixture();
    localStorage.getItem=()=>'{broken';
    try{
      const promise=repo.initialize();
      await drive(db);
      const saved=await promise;
      assert(saved.meta.schemaVersion===6);
    }finally{
      localStorage.getItem=()=>null;
    }
  });
  await test('Reset closes the local connection and reports a blocked deletion',async()=>{
    const {
      repo,db
    }
    =fixture();
    let request,rejected=false;
    globalThis.indexedDB={
      deleteDatabase:()=>request={
      }
    };
    const promise=repo.reset().catch(()=>rejected=true);
    await tick();
    assert(db.closed);
    request.onblocked();
    await promise;
    assert(rejected);
  });
  globalThis.testDone=true;
})().catch(error=>{
  testResults.push({
    name:'Storage test harness',ok:false,error:error.message+' '+error.stack
  });
  testDone=true;
});
