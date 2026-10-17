(async function(){
  const D=BiathlonDomain;
  function assert(condition,message='Assertion failed'){
    if(!condition)throw Error(message);
  }
  function equal(a,b){
    assert(JSON.stringify(a)===JSON.stringify(b),JSON.stringify(a)+' != '+JSON.stringify(b));
  }
  function throws(fn){
    let caught=false;
    try{
      fn();
    }catch(e){
      caught=true;
    }
    assert(caught,'Expected failure');
  }
  async function test(name,fn){
    try{
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
  function setup(){
    const s=D.create();
    s.meta.roster=[{
      id:'1',name:'Atleta A'
    },{
      id:'2',name:'Atleta B'
    }];
    s.meta.activeIds=['1','2'];
    s.meta.currentAthleteId='1';
    D.draft(s);
    return s;
  }
  function add(s,x=200,y=220){
    const d=D.draft(s);
    D.addShot(s,x,y,d.key,d.version);
  }
  function save(s){
    const d=D.draft(s);
    return D.saveSeries(s,d.key,d.version);
  }
  function repoFor(s){
    return {
      snapshot:s,async mutate(fn){
        const next=D.clone(this.snapshot);
        const value=fn(next);
        this.snapshot=next;
        return {
          state:D.clone(next),value
        };
      }
    };
  }
  function okResponse(options){
    const payload=JSON.parse(options.body);
    return {ok:true,json:async()=>({status:'success',protocolVersion:2,ack:{inserts:payload.inserts.map(p=>p.id),deletes:payload.deletes}})};
  }
  function engineFor(s,fetcher){
    s.meta.cloudUrl='https://script.google.com/macros/s/test/exec';
    s.meta.coachName='Coach';
    s.meta.apiToken='coach-token';
    const repo=repoFor(s),engine=new BiathlonSync(repo,{
      online:()=>true,fetch:fetcher||(async(url,opts)=>okResponse(opts))
    });
    return {
      repo,engine
    };
  }
  function deferred(){
    let resolve,reject;
    const promise=new Promise((a,b)=>{
      resolve=a;
      reject=b;
    });
    return {
      promise,resolve,reject
    };
  }
  await test('Default is 5 shots; configurable integer range is 1..50',()=>{
    equal(D.create().meta.shotLimit,5);
    equal(D.limit(1),1);
    equal(D.limit('50'),50);
    for(const n of [0,51,2.5,'bad',null])throws(()=>D.limit(n));
  });
  await test('Lowering the limit never truncates a saved draft',()=>{
    const s=setup();
    for(let i=0;i<5;i++)add(s);
    s.meta.shotLimit=1;
    throws(()=>add(s));
    equal(D.draft(s).shots.length,5);
    equal(save(s).shots.length,5);
  });
  await test('Different athletes, positions and modes keep separate drafts',()=>{
    const s=setup();
    add(s,230,220);
    D.setContext(s,'2','Gara','P');
    equal(D.draft(s).shots.length,0);
    add(s);
    const b=save(s);
    equal(b.athlete,'Atleta B');
    D.setContext(s,'1','Azzeramento','T');
    equal(D.draft(s).shots[0].x,230);
  });
  await test('String IDs stay strings and unknown athletes cannot be selected',()=>{
    const s=setup();
    D.setContext(s,'2','Gara','T');
    equal(s.meta.currentAthleteId,'2');
    throws(()=>D.setContext(s,'missing','Gara','T'));
  });
  await test('Stale tab cannot append or save under another context/version',()=>{
    const s=setup(),d=D.clone(D.draft(s));
    add(s);
    throws(()=>D.addShot(s,200,220,d.key,d.version));
    D.setContext(s,'2','Gara','T');
    throws(()=>D.saveSeries(s,d.key,d.version));
  });
  await test('Prone and standing boundaries stay identical in display and cloud',()=>{
    for(const p of ['T','P'])for(const delta of [-.51,-.01,0,.01,.49,.51]){
      const s=setup();
      s.meta.currentPos=p;
      const threshold=p==='T'?70.4:180;
      add(s,200+threshold+delta,220);
      const screen=D.draft(s).shots[0].esito,r=save(s);
      equal(D.packet(r).shots[0].esito,screen);
      equal(screen,delta<=0?'Bersaglio':'Errore');
    }
  });
  await test('Clustered shots at the same coordinates remain separate',()=>{
    const s=setup();
    add(s);
    add(s);
    equal(D.draft(s).shots.length,2);
    equal(save(s).shots.map(s=>s.seq),[1,2]);
  });
  await test('Opening a saved series for editing preserves original and queue',()=>{
    const s=setup();
    add(s);
    const r=save(s),out=D.clone(s.outbox);
    D.editSeries(s,r.id);
    equal(s.series.length,1);
    equal(s.outbox,out);
    equal(D.draft(s).replacesId,r.id);
  });
  await test('Replacement deletes old only on save and has a new identity',()=>{
    const s=setup();
    add(s);
    const old=save(s);
    D.editSeries(s,old.id);
    const replacement=save(s);
    assert(replacement.id!==old.id);
    equal(s.series.length,1);
    assert(s.outbox.some(o=>o.kind==='delete'&&o.seriesId===old.id));
    assert(s.outbox.some(o=>o.kind==='insert'&&o.seriesId===replacement.id));
  });
  await test('New session keeps history, pending sends and old drafts',()=>{
    const s=setup();
    add(s);
    save(s);
    add(s);
    const oldKey=D.draft(s).key;
    D.startSession(s,['2']);
    equal(s.series.length,1);
    equal(s.outbox.length,1);
    equal(s.meta.drafts[oldKey].shots.length,1);
    equal(D.draft(s).number,1);
  });
  await test('Series counters are independent for athlete, mode and session',()=>{
    const s=setup();
    add(s);
    save(s);
    equal(D.draft(s).number,2);
    D.setContext(s,'1','Gara','T');
    equal(D.draft(s).number,1);
    D.startSession(s,['1']);
    equal(D.draft(s).number,1);
  });
  await test('Legacy migration preserves pixel coordinates, queues and ID types',()=>{
    const old={
      roster:[{
        id:123,name:'A'
      }],activeAthletes:[{
        id:123,name:'A',seriesT:4
      }],currentAthleteId:123,currentPos:'T',currentMode:'Azzeramento',currentShots:[{
        seq:1,x:100,y:110,bx:200,by:220
      }],history:[],syncQueue:[{
        id:'legacy_1',coach:'Non specificato',position:'T',shots:[{
          seq:1,x:270.49,y:220
        }]
      }],deleteQueue:['old'],coachName:'Coach'
    };
    const s=D.migrate(old);
    equal(s.meta.currentAthleteId,'123');
    equal(D.draft(s).number,4);
    equal(D.draft(s).shots[0].x,200);
    equal(s.outbox.length,2);
    equal(s.outbox[0].payload.shots[0].esito,'Errore');
    equal(s.outbox[0].payload.coach,'Coach');
  });
  await test('Backups round trip and reject unsupported/damaged formats',()=>{
    const s=setup();
    add(s);
    save(s);
    equal(D.validate(s),s);
    throws(()=>D.validate({
      meta:{
        schemaVersion:999
      }
    }));
    const bad=D.clone(s);
    bad.series[0].shots[0].x=NaN;
    throws(()=>D.validate(bad));
  });
  await test('Existing training categories retain drafts, pending uploads and editable history',()=>{
    for(const mode of ['L2','L3','L4','Solo Sparo']){
      const s=setup();
      D.setContext(s,'1',mode,'T');add(s);
      const original=save(s),pending=D.clone(s.outbox[0]);
      add(s,240,220);
      const oldDraft=D.clone(D.draft(s)),restored=D.validate(s);
      D.setContext(restored,'1','i5','T');add(restored);save(restored);
      D.setContext(restored,'1',mode,'T');
      equal(D.draft(restored),oldDraft);
      equal(restored.series[0],original);
      equal(restored.outbox[0],pending);
      // Correct the archived record on a copy without its separate unfinished draft.
      const correction=D.validate(restored);
      delete correction.meta.drafts[oldDraft.key];
      D.editSeries(correction,original.id);
      equal(save(correction).type,mode);
    }
  });
  await test('Version 5 migration retains old category names and per-category counters',()=>{
    for(const mode of ['L2','L3','L4','Solo Sparo']){
      const source=setup();source.meta.coachName='Coach';
      D.setContext(source,'1',mode,'T');add(source);
      const original=save(source);
      const migrated=D.migrate({
        roster:source.meta.roster,activeAthletes:[{id:'1',seriesByMode:{[mode]:{T:7}}}],
        currentAthleteId:'1',currentPos:'T',currentMode:mode,coachName:'Coach',
        currentShots:[D.shot(240,220,'T',1)],history:[original],syncQueue:[D.packet(original)]
      });
      equal(D.draft(migrated).mode,mode);
      equal(D.draft(migrated).number,7);
      equal(D.draft(migrated).shots[0].x,240);
      equal(migrated.series[0].type,mode);
      equal(migrated.outbox[0].payload.type,mode);
      D.validate(migrated);
    }
  });
  await test('Manual and automatic requests share one in-flight promise',async()=>{
    const gate=deferred();
    let calls=0;
    const s=setup();
    add(s);
    save(s);
    const {
      engine
    }
    =engineFor(s,async(url,opts)=>{
      calls++;
      await gate.promise;
      return okResponse(opts);
    });
    const a=engine.run(),b=engine.run();
    assert(a===b);
    await Promise.resolve();
    gate.resolve();
    await Promise.all([a,b]);
    equal(calls,1);
  });
  await test('Acknowledgement keeps series added while a request is pending',async()=>{
    const gate=deferred(),entered=deferred();
    let sent;
    const s=setup();
    add(s);
    const first=save(s);
    const {
      repo,engine
    }
    =engineFor(s,async(url,opts)=>{
      sent=JSON.parse(opts.body);
      entered.resolve();
      await gate.promise;
      return okResponse(opts);
    });
    const pending=engine.run();
    await entered.promise;
    await repo.mutate(state=>{
      add(state);
      save(state);
    });
    gate.resolve();
    await pending;
    equal(sent.inserts.map(p=>p.id),[first.id]);
    equal(repo.snapshot.outbox.length,1);
    assert(repo.snapshot.outbox[0].seriesId!==first.id);
  });
  await test('Deletion added during insert is kept for a later request',async()=>{
    const gate=deferred(),entered=deferred(),s=setup();
    add(s);
    const r=save(s);
    const {
      repo,engine
    }
    =engineFor(s,async(url,opts)=>{
      entered.resolve();
      await gate.promise;
      return okResponse(opts);
    });
    const pending=engine.run();
    await entered.promise;
    await repo.mutate(state=>D.removeSeries(state,r.id));
    gate.resolve();
    await pending;
    equal(repo.snapshot.outbox.map(o=>o.kind),['delete']);
  });
  await test('Two tabs respect the shared synchronization lease',async()=>{
    const gate=deferred(),entered=deferred(),s=setup();
    add(s);
    save(s);
    const {
      repo,engine
    }
    =engineFor(s,async(url,opts)=>{
      entered.resolve();
      await gate.promise;
      return okResponse(opts);
    });
    const second=new BiathlonSync(repo,{
      online:()=>true,fetch:async()=>{
        throw Error('Overlapping request');
      }
    });
    const pending=engine.run();
    await entered.promise;
    equal(await second.run(),{
      idle:true
    });
    gate.resolve();
    await pending;
  });
  await test('HTTP errors and partial acknowledgements preserve unconfirmed operations',async()=>{
    const s=setup();
    add(s);
    const first=save(s);
    add(s);
    const second=save(s);
    const {
      repo,engine
    }
    =engineFor(s,async()=>({
      ok:true,json:async()=>({
        status:'success',protocolVersion:2,ack:{
          inserts:[first.id],deletes:[]
        }
      })
    }));
    await engine.run();
    equal(repo.snapshot.outbox.map(o=>o.seriesId),[second.id]);
    engine.fetch=async()=>({
      ok:false,status:503
    });
    let failed=false;
    try{
      await engine.run();
    }catch(e){
      failed=true;
    }
    assert(failed);
    equal(repo.snapshot.outbox.length,1);
    assert(!repo.snapshot.meta.syncLease);
  });
  await test('Coach configured after local save is filled at send time',async()=>{
    let sent;
    const s=setup();
    add(s);
    save(s);
    const {
      engine
    }
    =engineFor(s,async(url,opts)=>{
      sent=JSON.parse(opts.body);
      return okResponse(opts);
    });
    await engine.run();
    equal(sent.inserts[0].coach,'Coach');
  });
  await test('Offline run does not claim or send any queue items',async()=>{
    const s=setup();
    add(s);
    save(s);
    const {
      repo,engine
    }
    =engineFor(s);
    engine.online=()=>false;
    equal(await engine.run(),{
      offline:true
    });
    equal(repo.snapshot.outbox.length,1);
    assert(!repo.snapshot.meta.syncLease);
  });
  await test('Missing credentials and public app or spreadsheet URLs never start a cloud request',async()=>{
    let requests=0;
    const engine=new BiathlonSync(repoFor(D.create()),{fetch:async()=>{requests++;throw Error('Unexpected network request');}});
    const endpoint='https://script.google.com/macros/s/test/exec';
    for(const config of [{cloudUrl:endpoint,apiToken:''},{cloudUrl:'',apiToken:'personal-token'},{cloudUrl:'https://matfinco.github.io/BiathlonTracker/',apiToken:'personal-token'},{cloudUrl:'https://docs.google.com/spreadsheets/d/id/edit',apiToken:'personal-token'}]){
      let rejected=false;
      try{await engine.request(config,{action:'roster'});}catch(error){rejected=true;}
      assert(rejected);
    }
    equal(requests,0);
    equal(D.syncUrl('https://script.google.com/a/macros/team.example/s/deployment/exec'),'https://script.google.com/macros/s/deployment/exec');
  });
  // Spreadsheet fixtures exercise the actual Apps Script handlers without touching a Google account.
  class Range{
    constructor(sheet,row,col,nr=1,nc=1){
      Object.assign(this,{
        sheet,row,col,nr,nc
      });
    }
    getValues(){
      return Array.from({
        length:this.nr
      },(_,i)=>Array.from({
        length:this.nc
      },(_,j)=>this.sheet.grid[this.row+i-1]?.[this.col+j-1]??''));
    }
    getValue(){
      return this.getValues()[0][0];
    }
    setValues(rows){
      rows.forEach((row,i)=>row.forEach((v,j)=>{
        this.sheet.grid[this.row+i-1]??=[];
        this.sheet.grid[this.row+i-1][this.col+j-1]=v;
      }));
      return this;
    }
    setValue(value){
      return this.setValues(Array.from({
        length:this.nr
      },()=>Array(this.nc).fill(value)));
    }
  }
  class Sheet{
    constructor(name,grid=[]){
      this.name=name;
      this.grid=grid;
      this.maxColumns=26;
    }
    getRange(...args){
      return new Range(this,...args);
    }
    getLastRow(){
      let i=this.grid.length;
      while(i&&!this.grid[i-1].some(v=>v!==''&&v!=null))i--;
      return i;
    }
    getMaxColumns(){
      return this.maxColumns;
    }
    getMaxRows(){return this.maxRows||1000;}
    insertRowsAfter(row,count){this.maxRows=this.getMaxRows()+count;}
    insertColumnsAfter(col,n){
      this.maxColumns+=n;
    }
    hideSheet(){
    }
    getRangeList(ranges){
      return {
        setValue:value=>ranges.forEach(r=>{
          const row=Number(r.slice(1));
          this.getRange(row,15).setValue(value);
        })
      };
    }
  }
  let sheets,properties,locked;
  function server(){
    sheets={
      Database:new Sheet('Database',[BIATHLON_HEADERS.slice(0,15)]),Anagrafica:new Sheet('Anagrafica',[['Nome','Email','Note'],['Atleta A','a@example.test','']])
    };
    properties={
      BIATHLON_SPREADSHEET_ID:'test-sheet-id',
      BIATHLON_ADMIN_TOKEN:'admin-test-token-that-is-private',
      BIATHLON_COACH_KEYS:JSON.stringify({
        'coach-token':'Coach','other-token':'Other Coach'
      })
    };
    locked=false;
    globalThis.SpreadsheetApp={
      getActiveSpreadsheet:()=>{throw Error('No active spreadsheet in a deployed web app');},
      openById:id=>{
        equal(id,'test-sheet-id');
        return {getSheetByName:n=>sheets[n]||null,insertSheet:n=>(sheets[n]=new Sheet(n))};
      },flush:()=>{
      }
    };
    globalThis.LockService={
      getScriptLock:()=>({
        tryLock:()=>!locked,hasLock:()=>true,releaseLock:()=>{
        }
      })
    };
    globalThis.PropertiesService={
      getScriptProperties:()=>({
        getProperty:k=>properties[k]||null,
        getProperties:()=>({...properties}),
        setProperty(k,v){properties[k]=String(v);return this;},
        deleteProperty(k){delete properties[k];return this;}
      })
    };
    globalThis.Utilities={
      getUuid:()=>`00000000-0000-4000-8000-${String(++globalThis.__uuid).padStart(12,'0')}`
    };
    globalThis.ContentService={
      MimeType:{
        JSON:'json'
      },createTextOutput:value=>({
        setMimeType:()=>JSON.parse(value)
      })
    };
  }
  function serverPacket(){
    const s=setup();
    s.meta.coachName='Coach';
    add(s,270.49,220);
    return D.packet(save(s));
  }
  function post(data){
    return doPost({
      postData:{
        contents:JSON.stringify({
          token:'coach-token',...data
        })
      }
    });
  }
  function setupEditor({detected=null,pasted='https://script.google.com/macros/s/chosen-deployment/exec',cancel=false}={}){
    const context={prompts:0,detections:0,html:''};
    SpreadsheetApp.getActiveSpreadsheet=()=>({getId:()=>properties.BIATHLON_SPREADSHEET_ID||'test-sheet-id'});
    SpreadsheetApp.getUi=()=>({
      Button:{OK:'ok',CANCEL:'cancel'},ButtonSet:{OK_CANCEL:'ok_cancel'},
      prompt:()=>{context.prompts++;return {getSelectedButton:()=>cancel?'cancel':'ok',getResponseText:()=>pasted};},
      showModalDialog:output=>{context.html=output.html;}
    });
    globalThis.ScriptApp={getService:()=>({getUrl:()=>{context.detections++;return detected;}})};
    globalThis.HtmlService={createHtmlOutput:html=>({html,setWidth(){return this;},setHeight(){return this;}})};
    return context;
  }
  await test('Setup accepts production URLs with account and Workspace prefixes',()=>{
    const expected='https://script.google.com/macros/s/deployment-ID/exec';
    for(const url of [expected,expected+'/',expected+'?authuser=0','https://script.google.com/macros/u/0/s/deployment-ID/exec','https://script.google.com/a/macros/team.example/s/deployment-ID/exec','https://script.google.com/a/team.example/macros/s/deployment-ID/exec'])equal(normalizeServiceUrl_(url),expected);
    for(const url of ['https://evil.example/macros/s/id/exec','https://script.google.com.evil.example/macros/s/id/exec','http://script.google.com/macros/s/id/exec','https://script.google.com/macros/s/id/dev'])equal(normalizeServiceUrl_(url),'');
  });
  await test('Setup asks for an existing deployment when automatic detection returns no URL',()=>{
    server();
    delete properties.BIATHLON_SPREADSHEET_ID;
    const originalToken=properties.BIATHLON_ADMIN_TOKEN,editor=setupEditor();
    configuraBiathlon();
    equal(editor.prompts,1);
    equal(properties.BIATHLON_SPREADSHEET_ID,'test-sheet-id');
    equal(properties.BIATHLON_SERVICE_URL,'https://script.google.com/macros/s/chosen-deployment/exec');
    equal(properties.BIATHLON_ADMIN_TOKEN,originalToken);
    const link=editor.html.match(/href="([^"]+)"/)[1];
    const config=D.invitation(link);
    equal(config.role,'admin');
    equal(config.cloudUrl,properties.BIATHLON_SERVICE_URL);
    equal(config.apiToken,originalToken);
    equal(post({token:config.apiToken,action:'admin.list'}).status,'success');
    configuraBiathlon();
    equal(editor.prompts,1);
    equal(editor.detections,1);
    equal(properties.BIATHLON_ADMIN_TOKEN,originalToken);
  });
  await test('Detected Workspace deployment is normalized and reused without manual properties',()=>{
    server();
    const editor=setupEditor({detected:'https://script.google.com/a/macros/team.example/s/active-deployment/exec'});
    configuraBiathlon();
    equal(editor.prompts,0);
    equal(properties.BIATHLON_SERVICE_URL,'https://script.google.com/macros/s/active-deployment/exec');
  });
  await test('Cancelling setup or entering an invalid deployment leaves credentials unchanged',()=>{
    for(const options of [{cancel:true},{pasted:'https://evil.example/exec'},{pasted:'https://script.google.com/macros/s/testing/dev'}]){
      server();
      const before=D.clone(properties),editor=setupEditor(options);
      if(options.cancel)configuraBiathlon();else throws(()=>configuraBiathlon());
      equal(properties,before);
      equal(editor.html,'');
    }
  });
  await test('Owner can explicitly choose another deployment while preserving personal accesses',()=>{
    server();
    properties.BIATHLON_SERVICE_URL='https://script.google.com/macros/s/previous-deployment/exec';
    const token=properties.BIATHLON_ADMIN_TOKEN,editor=setupEditor();
    scegliServizioBiathlon();
    equal(editor.prompts,1);
    equal(editor.detections,0);
    equal(properties.BIATHLON_SERVICE_URL,'https://script.google.com/macros/s/chosen-deployment/exec');
    equal(properties.BIATHLON_ADMIN_TOKEN,token);
    equal(post({action:'roster'}).status,'success');
  });
  await test('Deployed handlers open the configured file without an active spreadsheet',()=>{
    server();
    equal(post({action:'roster'}).status,'success');
    equal(doGet({parameter:{token:'coach-token'}}).status,'success');
    equal(post({inserts:[serverPacket()]}).status,'success');
  });
  await test('Missing spreadsheet configuration returns an actionable error without writes',()=>{
    server();
    delete properties.BIATHLON_SPREADSHEET_ID;
    const before=D.clone(sheets.Anagrafica.grid);
    const response=post({inserts:[serverPacket()]});
    equal(response.status,'error');
    assert(response.error.includes('BIATHLON_SPREADSHEET_ID'));
    equal(doGet({parameter:{token:'coach-token'}}).status,'error');
    equal(sheets.Database.getLastRow(),1);
    equal(sheets.Anagrafica.grid,before);
    assert(!sheets._BiathlonDeleted);
  });
  await test('Server insertion is idempotent across retries',()=>{
    server();
    const p=serverPacket();
    equal(post({
      inserts:[p]
    }).status,'success');
    equal(post({
      inserts:[p,p]
    }).status,'success');
    equal(sheets.Database.getLastRow(),2);
    equal(sheets.Database.grid[1][11],'Errore');
    equal(sheets.Database.grid[0].slice(0,15),BIATHLON_HEADERS.slice(0,15));
  });
  await test('Every new training category saves independently and reaches Google with its chosen name',()=>{
    server();
    const s=setup();s.meta.coachName='Coach';
    const modes=['Azzeramento','Tiro da fermo','i1-i2','i3','i4','i5','Gara','Altro'];
    for(const mode of modes){
      D.setContext(s,'1',mode,'T');add(s);
      equal(save(s).series,'1T');
    }
    const restored=D.validate(s),inserts=restored.outbox.map(op=>op.payload);
    equal(post({inserts}).status,'success');
    equal(sheets.Database.grid.slice(1).map(row=>row[2]),modes);
  });
  await test('Database_Colpi receives authenticated series and the connection check does not change data',()=>{
    server();
    sheets.Database_Colpi=sheets.Database;
    delete sheets.Database;
    const before=D.clone(sheets.Anagrafica.grid);
    const connection=post({action:'connection'});
    equal(connection.status,'success');
    equal(connection.databaseSheet,'Database_Colpi');
    equal(connection.coach,'Coach');
    equal(sheets.Anagrafica.grid,before);
    equal(sheets.Database_Colpi.getLastRow(),1);
    assert(!sheets._BiathlonDeleted);
    equal(post({inserts:[serverPacket()]}).status,'success');
    equal(sheets.Database_Colpi.getLastRow(),2);
  });
  await test('An explicitly configured database takes precedence over automatic names',()=>{
    server();
    sheets.Database_Colpi=new Sheet('Database_Colpi',[BIATHLON_HEADERS.slice()]);
    equal(post({action:'connection'}).databaseSheet,'Database_Colpi');
    properties.BIATHLON_DATABASE_SHEET='Database';
    equal(post({inserts:[serverPacket()]}).status,'success');
    equal(sheets.Database.getLastRow(),2);
    equal(sheets.Database_Colpi.getLastRow(),1);
    properties.BIATHLON_DATABASE_SHEET='Missing';
    equal(post({action:'connection'}).status,'error');
  });
  await test('Anonymous and invalid credentials cannot read or change any spreadsheet',()=>{
    server();
    let reads=0;
    const before=D.clone(Object.fromEntries(Object.entries(sheets).map(([k,v])=>[k,v.grid])));
    SpreadsheetApp.openById=()=>{reads++;throw Error('Unauthorized sheet access');};
    for(const token of ['', 'invalid-token']){
      for(const action of ['roster','connection','admin.list']){
        const response=post({token,action});
        equal(response.status,'error');
        assert(!response.roster&&!response.coaches&&!response.coach);
      }
      equal(post({token,inserts:[serverPacket()]}).status,'error');
      equal(post({token,deletes:['old-series-id']}).status,'error');
      equal(doGet({parameter:{token}}).status,'error');
    }
    equal(reads,0);
    equal(Object.fromEntries(Object.entries(sheets).map(([k,v])=>[k,v.grid])),before);
  });
  const admin=(action,extra={})=>post({token:'admin-test-token-that-is-private',action,...extra});
  await test('Coach and unauthenticated requests cannot list or manage personal accesses',()=>{
    server();
    for(const action of ['admin.list','admin.create','admin.rotate','admin.revoke']){
      equal(post({action,name:'Intruder'}).status,'error');
      equal(post({action,token:'',name:'Intruder'}).status,'error');
    }
    assert(properties.BIATHLON_COACH_KEYS);
    equal(coachRecords_().length,0);
    equal(post({action:'roster',token:properties.BIATHLON_ADMIN_TOKEN}).status,'error');
  });
  await test('Admin migration preserves every legacy key and its coach without duplicate imports',()=>{
    server();
    const result=admin('admin.list');
    equal(result.status,'success');
    equal(result.coaches.length,2);
    equal(result.coaches.find(c=>c.name==='Coach').token,'coach-token');
    assert(!properties.BIATHLON_COACH_KEYS);
    equal(admin('admin.list').coaches.length,2);
    equal(post({action:'roster'}).status,'success');
  });
  await test('Admin creates a named access; its personal link configures the matching coach',()=>{
    server();
    const result=admin('admin.create',{name:'Allenatore Neve'});
    equal(result.status,'success');
    const coach=result.coaches.find(c=>c.name==='Allenatore Neve');
    assert(coach.active);
    const url='https://script.google.com/macros/s/test-deployment/exec';
    const link=D.invitationLink({coachName:coach.name,apiToken:coach.token,cloudUrl:url},'https://example.test/BiathlonTracker/');
    const config=D.invitation(link);
    equal(config.coachName,coach.name);
    equal(config.apiToken,coach.token);
    equal(post({action:'roster',token:config.apiToken}).coach,coach.name);
    equal(admin('admin.create',{name:'allenatore neve'}).status,'error');
  });
  await test('Revocation blocks old links; rotation reactivates only the new credential',()=>{
    server();
    let coach=admin('admin.create',{name:'Coach New'}).coaches.find(c=>c.name==='Coach New');
    const oldToken=coach.token;
    equal(post({action:'roster',token:oldToken}).status,'success');
    coach=admin('admin.revoke',{id:coach.id}).coaches.find(c=>c.id===coach.id);
    assert(!coach.active);
    equal(coach.token,'');
    equal(post({action:'roster',token:oldToken}).status,'error');
    coach=admin('admin.rotate',{id:coach.id}).coaches.find(c=>c.id===coach.id);
    assert(coach.active&&coach.token!==oldToken);
    equal(post({action:'roster',token:coach.token}).status,'success');
    equal(post({action:'roster',token:oldToken}).status,'error');
    equal(post({action:'roster'}).status,'success');
  });
  await test('Migration retries preserve revocation and never restore a revoked legacy key',()=>{
    server();
    const coach=admin('admin.list').coaches.find(c=>c.name==='Coach');
    admin('admin.revoke',{id:coach.id});
    properties.BIATHLON_COACH_KEYS=JSON.stringify({'coach-token':'Coach'});
    admin('admin.list');
    equal(post({action:'roster'}).status,'error');
    equal(coachRecords_().filter(c=>c.token==='coach-token').length,1);
  });
  await test('Malformed invitation links cannot redirect credentials to another host',()=>{
    const make=(url,extra={})=>'#accesso='+encodeURIComponent(JSON.stringify({v:1,name:'Coach',token:'personal-test-token',url,...extra}));
    const good='https://script.google.com/macros/s/deployment/exec';
    equal(D.invitation(make(good)).role,'coach');
    for(const url of ['https://evil.example/exec','http://script.google.com/macros/s/deployment/exec',good+'?other=1','https://script.google.com.evil.example/macros/s/deployment/exec'])throws(()=>D.invitation(make(url)));
    throws(()=>D.invitation(make(good,{v:999})));
    throws(()=>D.invitation('#accesso=broken%'));
    equal(D.invitation('#gestione='+encodeURIComponent(JSON.stringify({v:1,url:good,token:'private-admin-token'}))).role,'admin');
  });
  await test('Server tombstone prevents delayed inserts from resurrecting deleted series',()=>{
    server();
    const p=serverPacket();
    equal(post({
      deletes:[p.id]
    }).status,'success');
    equal(post({
      inserts:[p]
    }).status,'success');
    equal(sheets.Database.getLastRow(),1);
    equal(sheets._BiathlonDeleted.getLastRow(),2);
  });
  await test('Server soft deletion is idempotent and keeps A:O columns in place',()=>{
    server();
    const p=serverPacket();
    post({
      inserts:[p]
    });
    post({
      deletes:[p.id]
    });
    post({
      deletes:[p.id]
    });
    equal(sheets.Database.grid[1][14],'TRUE');
    equal(sheets.Database.getLastRow(),2);
    equal(sheets._BiathlonDeleted.getLastRow(),2);
  });
  await test('Malformed batch is rejected before any writes',()=>{
    server();
    const p=serverPacket(),bad=D.clone(p);
    bad.id='bad';
    bad.shots[0].x=Infinity;
    const before=D.clone(sheets.Anagrafica.grid);
    equal(post({
      inserts:[p,bad]
    }).status,'error');
    equal(sheets.Database.getLastRow(),1);
    equal(sheets.Anagrafica.grid,before);
  });
  await test('Server computes full-precision results instead of trusting client labels',()=>{
    server();
    const p=serverPacket();
    p.shots[0].esito='Bersaglio';
    p.shots[0].distanza=0;
    post({
      inserts:[p]
    });
    equal(sheets.Database.grid[1][11],'Errore');
    assert(Math.abs(sheets.Database.grid[1][10]-70.49)<1e-9);
  });
  await test('Server roster IDs survive row reordering',()=>{
    server();
    sheets.Anagrafica.grid.push(['Atleta B','b@example.test','']);
    const first=post({
      action:'roster'
    }).roster;
    const tmp=sheets.Anagrafica.grid[1];
    sheets.Anagrafica.grid[1]=sheets.Anagrafica.grid[2];
    sheets.Anagrafica.grid[2]=tmp;
    const second=post({
      action:'roster'
    }).roster;
    equal(first.find(a=>a.name==='Atleta A').id,second.find(a=>a.name==='Atleta A').id);
  });
  await test('Personal keys are required for reads/writes and can be revoked',()=>{
    server();
    equal(doGet({
      parameter:{
      }
    }).status,'error');
    equal(post({
      token:'',inserts:[serverPacket()]
    }).status,'error');
    equal(post({
      action:'roster'
    }).status,'success');
    properties.BIATHLON_COACH_KEYS='{}';
    equal(post({
      action:'roster'
    }).status,'error');
  });
  await test('Server refuses a batch when another invocation owns the lock',()=>{
    server();
    locked=true;
    equal(post({
      inserts:[serverPacket()]
    }).status,'error');
    equal(sheets.Database.getLastRow(),1);
  });
  await test('Spreadsheet formulas in user-provided text are escaped',()=>{
    server();
    const p=serverPacket();
    p.athlete='=IMPORTXML("bad")';
    p.coach='=1+1';
    properties.BIATHLON_COACH_KEYS=JSON.stringify({
      'coach-token':'=1+1'
    });
    equal(post({
      inserts:[p]
    }).status,'success');
    assert(sheets.Database.grid[1][3].startsWith("'="));
    assert(sheets.Database.grid[1][4].startsWith("'="));
  });
  await test('Personal key cannot impersonate another coach or delete their records',()=>{
    server();
    const p=serverPacket();
    equal(post({
      inserts:[p]
    }).status,'success');
    equal(post({
      inserts:[p],token:'other-token'
    }).status,'error');
    equal(post({
      deletes:[p.id],token:'other-token'
    }).status,'error');
    equal(sheets.Database.grid[1][14],'FALSE');
  });
  await test('Server rejects formula identifiers before touching the sheet',()=>{
    server();
    const p=serverPacket();
    p.id='=1+1';
    equal(post({
      inserts:[p]
    }).status,'error');
    equal(sheets.Database.getLastRow(),1);
  });
  await test('Roster merge updates IDs in drafts, history, counters and pending packets',()=>{
    const s=setup();add(s);save(s);add(s);D.mergeRoster(s,[{id:'stable-athlete-id',name:'Atleta A'}]);
    equal(s.meta.currentAthleteId,'stable-athlete-id');equal(D.draft(s).athleteId,'stable-athlete-id');equal(s.series[0].athleteId,'stable-athlete-id');equal(s.outbox[0].payload.athleteId,'stable-athlete-id');equal(D.draft(s).number,2);
  });
  await test('Backup import rejects coordinates outside the target',()=>{const s=setup();add(s);save(s);s.series[0].shots[0].x=401;throws(()=>D.validate(s));});
  await test('Editing an archived series preserves its original date',()=>{const s=setup();add(s);const r=save(s);r.timestamp='2025-01-01T10:00:00.000Z';r.localDate='2025-01-01';D.editSeries(s,r.id);const edited=save(s);equal(edited.timestamp,r.timestamp);equal(edited.localDate,'2025-01-01');});
  await test('Missing acknowledgements and old server versions never empty the queue',async()=>{
    for(const reply of [{status:'success',protocolVersion:1},{status:'success',protocolVersion:2,ack:null}]){const s=setup();add(s);save(s);const {repo,engine}=engineFor(s,async()=>({ok:true,json:async()=>reply}));let failed=false;try{await engine.run();}catch(error){failed=true;}assert(failed);equal(repo.snapshot.outbox.length,1);}
  });
  await test('Requests that time out keep operations and release the synchronization lease',async()=>{
    const s=setup();add(s);save(s);const entered=deferred();const {repo,engine}=engineFor(s,async(url,opts)=>{entered.resolve();return new Promise((resolve,reject)=>opts.signal.addEventListener('abort',()=>{const error=Error('Aborted');error.name='AbortError';reject(error);}));});engine.timeout=90123;
    const pending=engine.run().catch(()=>{});await entered.promise;const timer=Array.from(__timers.values()).find(t=>t.ms===90123);assert(timer);timer.fn();await pending;equal(repo.snapshot.outbox.length,1);assert(!repo.snapshot.meta.syncLease);
  });
  await test('Server appends by actual IDs rather than distant formulas',()=>{server();sheets.Database.grid[20]=['','','formula'];const p=serverPacket();equal(post({inserts:[p]}).status,'success');equal(sheets.Database.grid[1][0],p.id);equal(sheets.Database.grid[20][2],'formula');});
  await test('Server expands the sheet before writing beyond its row limit',()=>{server();sheets.Database.maxRows=1;const p=serverPacket();equal(post({inserts:[p]}).status,'success');assert(sheets.Database.getMaxRows()>=2);});
  globalThis.testDone=true;
})().catch(error=>{
  testResults.push({
    name:'test harness',ok:false,error:String(error.stack||error)
  });
  testDone=true;
});
