/* Rules shared by the field interface, migration and regression tests. */
(function (root) {
  'use strict';
  const MODES = ['Azzeramento', 'Gara', 'L2', 'L3', 'L4', 'Solo Sparo', 'Altro'];
  const VERSION = 6;
  const clone = value => JSON.parse(JSON.stringify(value));
  const uid = () => root.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  const text = value => String(value ?? '').trim();
  const id = value => {
    const result = text(value);
    if (!result || result.length > 180) throw Error('Identificativo atleta non valido.');
    return result;
  };
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const validUrl = value => {
    if (!text(value)) return '';
    const u = new URL(text(value));
    if (u.protocol !== 'https:') throw Error('Usa un indirizzo HTTPS valido.');
    return u.href;
  };
  function invitation(value) {
    try {
      const raw=text(value);
      if(raw.length>8192)throw Error();
      const hash=raw.slice(raw.indexOf('#'));
      const admin=hash.startsWith('#gestione=');
      if(!admin&&!hash.startsWith('#accesso='))throw Error();
      const data=JSON.parse(decodeURIComponent(hash.slice(hash.indexOf('=')+1)));
      if(data.v!==1||(!admin&&typeof data.name!=='string')||typeof data.token!=='string'||typeof data.url!=='string')throw Error();
      const coachName=admin?'':text(data.name),apiToken=text(data.token),cloudUrl=validUrl(data.url);
      if((!admin&&(!coachName||coachName.length>120))||apiToken.length<16||apiToken.length>250||!/^[A-Za-z0-9_-]+$/.test(apiToken))throw Error();
      if(!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(cloudUrl))throw Error();
      return {role:admin?'admin':'coach',coachName,apiToken,cloudUrl};
    } catch(error) {
      throw Error('Collegamento personale non valido. Chiedi all’amministratore di copiarlo nuovamente.');
    }
  }
  function invitationLink(config,appUrl) {
    const base=validUrl(appUrl).split(/[?#]/)[0];
    return base+'#accesso='+encodeURIComponent(JSON.stringify({v:1,name:config.coachName,token:config.apiToken,url:config.cloudUrl}));
  }
  function limit(value) {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1 || n > 50) throw Error('Il limite deve essere un numero intero da 1 a 50.');
    return n;
  }
  function wind(value = {
  }) {
    return {
      dir: ['C','N','NE','E','SE','S','SW','W','NW'].includes(value.dir) ? value.dir : 'C', int: Number.isInteger(value.int) && value.int >= 0 && value.int <= 5 ? value.int : 0
    };
  }
  function shot(x, y, position, seq) {
    if (!finite(x) || !finite(y) || x < 0 || x > 400 || y < 0 || y > 440) throw Error('Coordinate del colpo non valide.');
    const distanza = Math.hypot(x - 200, y - 220);
    return {
      seq, x, y, distanza, esito: distanza <= (position === 'T' ? 70.4 : 180) ? 'Bersaglio' : 'Errore'
    };
  }
  function shots(values, position, legacy = false) {
    if (!Array.isArray(values) || values.length > 50) throw Error('Una serie può contenere al massimo 50 colpi.');
    return values.map((s, i) => {
      if (!s || !finite(s.x) || !finite(s.y)) throw Error('Colpo danneggiato nel salvataggio.');
      const x = legacy && s.bx ? s.x / s.bx * 400 : s.x;
      const y = legacy && s.by ? s.y / s.by * 440 : s.y;
      return shot(legacy?Math.max(0,Math.min(400,x)):x,legacy?Math.max(0,Math.min(440,y)):y,position,i+1);
    });
  }
  const key = meta => JSON.stringify([meta.sessionId, meta.currentAthleteId, meta.currentMode, meta.currentPos]);
  const counterKey = (athleteId, mode, position, sessionId) => JSON.stringify([sessionId,athleteId,mode,position]);
  function create() {
    const sessionId = uid(), startedAt = new Date().toISOString();
    return {
      meta: {
        schemaVersion: VERSION, revision: 0, coachName: '', cloudUrl: '', lookerUrl: '', apiToken: '', adminUrl: '', adminToken: '', theme: 'day', shotColor: 'color', shotLimit: 5, roster: [], activeIds: [], currentAthleteId: '', currentPos: 'T', currentMode: 'Azzeramento', currentWind: {
          dir:'C',int:0
        }, sessionId, lastActivity: Date.now(), counters: {
        }, drafts: {
        }, lastSync: null
      }, series: [], outbox: [], sessions: [{
        id:sessionId, startedAt, title:new Date().toLocaleDateString('it-IT')
      }]
    };
  }
  function roster(values) {
    if (!Array.isArray(values)) throw Error('Anagrafica non valida.');
    const seen = new Set();
    return values.map(a => {
      const athlete = {
        id: id(a?.id), name: text(a?.name)
      };
      if (!athlete.name || athlete.name.length > 120 || seen.has(athlete.id)) throw Error('Nomi o identificativi duplicati/non validi nell’anagrafica.');
      seen.add(athlete.id);
      return athlete;
    });
  }
  function draft(state, createIfMissing = true) {
    const m = state.meta, k = key(m);
    if (!m.currentAthleteId || !m.activeIds.includes(m.currentAthleteId)) return null;
    if (!m.drafts[k] && createIfMissing) {
      const previous=state.series.filter(s=>s.sessionId===m.sessionId&&s.athleteId===m.currentAthleteId&&s.type===m.currentMode&&s.position===m.currentPos).map(s=>s.number||parseInt(s.series,10)||1);
      m.drafts[k] = {
        key:k, sessionId:m.sessionId, athleteId:m.currentAthleteId, athleteName:m.roster.find(a=>a.id===m.currentAthleteId)?.name||'', mode:m.currentMode, position:m.currentPos, number:Math.max(m.counters[counterKey(m.currentAthleteId,m.currentMode,m.currentPos,m.sessionId)]||1,...previous.map(n=>n+1)), wind:clone(m.currentWind), shots:[], version:0, replacesId:null
      };
    }
    return m.drafts[k] || null;
  }
  function checkedDraft(state, expectedKey, expectedVersion) {
    const d = draft(state);
    if (!d || d.key !== expectedKey || (expectedVersion !== undefined && d.version !== expectedVersion)) throw Error('La serie è cambiata in un’altra scheda. Controlla il bersaglio e riprova.');
    return d;
  }
  function addShot(state, x, y, expectedKey, expectedVersion) {
    const d = checkedDraft(state, expectedKey, expectedVersion);
    if (d.shots.length >= state.meta.shotLimit) throw Error(`Raggiunto il limite di ${state.meta.shotLimit} colpi. Puoi aumentarlo nelle impostazioni.`);
    d.shots.push(shot(x,y,d.position,d.shots.length+1));
    d.version++;
    state.meta.lastActivity = Date.now();
  }
  function setContext(state, athleteId, mode, position) {
    if (athleteId && !state.meta.activeIds.includes(id(athleteId))) throw Error('Atleta non presente nella sessione.');
    if (!MODES.includes(mode) || !['T','P'].includes(position)) throw Error('Posizione o modalità non valida.');
    Object.assign(state.meta, {
      currentAthleteId:athleteId ? id(athleteId) : '', currentMode:mode, currentPos:position
    });
    draft(state);
  }
  function packet(record) {
    return {
      id:record.id, sessionId:record.sessionId, athleteId:record.athleteId, type:record.type, timestamp:record.timestamp, localDate:record.localDate, coach:record.coach, athlete:record.athlete, position:record.position, series:record.series, windDir:record.windDir, windInt:record.windInt, shots:record.shots.map(s=>shot(s.x,s.y,record.position,s.seq))
    };
  }
  function enqueue(state, kind, seriesId, payload) {
    state.outbox.push({
      id:uid(),kind,seriesId,payload,coach:payload?.coach||state.meta.coachName,createdAt:new Date().toISOString()
    });
  }
  function localDate(date) {
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  }
  function saveSeries(state, expectedKey, expectedVersion) {
    const d = checkedDraft(state, expectedKey, expectedVersion);
    if (!d.shots.length) throw Error('Inserisci almeno un colpo.');
    const a = state.meta.roster.find(a=>a.id===d.athleteId);
    if (!a) throw Error('L’atleta non è più nell’anagrafica. La bozza è conservata.');
    const label = `${d.number}${d.position}`;
    const existing = state.series.find(s=>s.sessionId===d.sessionId && s.athleteId===a.id && s.type===d.mode && s.series===label);
    if (existing && existing.id !== d.replacesId) throw Error('Questa serie esiste già. Aprila dallo storico per modificarla.');
    const now = new Date(),original=d.replacesId?state.series.find(r=>r.id===d.replacesId):null;
    const record = {
      id:uid(), sessionId:d.sessionId, athleteId:a.id, athlete:a.name, coach:state.meta.coachName, type:d.mode, position:d.position, series:label, number:d.number, timestamp:original?.timestamp||now.toISOString(),localDate:original?.localDate||localDate(original?new Date(original.timestamp):now),updatedAt:now.toISOString(),windDir:d.wind.dir,windInt:d.wind.int,shots:shots(d.shots,d.position)
    };
    if (d.replacesId) removeSeries(state,d.replacesId);
    state.series.push(record);
    enqueue(state,'insert',record.id,packet(record));
    const ck = counterKey(a.id,d.mode,d.position,d.sessionId);
    state.meta.counters[ck] = Math.max(state.meta.counters[ck]||1,d.number+1);
    delete state.meta.drafts[d.key];
    state.meta.lastActivity=Date.now();
    draft(state);
    return record;
  }
  function removeSeries(state, recordId) {
    const sid=id(recordId);
    const record=state.series.find(s=>s.id===sid);
    if(record?.coach&&state.meta.coachName&&record.coach!==state.meta.coachName)throw Error('Puoi cancellare soltanto le serie della tua firma allenatore.');
    state.series=state.series.filter(s=>s.id!==sid);
    // Keep a tombstone even for unsent inserts: a request might already be in flight.
    state.outbox=state.outbox.filter(op=>op.seriesId!==sid);
    enqueue(state,'delete',sid,null);
  }
  function editSeries(state, recordId) {
    const record=state.series.find(s=>s.id===recordId);
    if (!record) throw Error('Serie non trovata.');
    if(record.coach&&state.meta.coachName&&record.coach!==state.meta.coachName)throw Error('Puoi modificare soltanto le serie della tua firma allenatore.');
    const m=state.meta;
    if (!m.roster.some(a=>a.id===record.athleteId)) m.roster.push({
      id:record.athleteId,name:record.athlete
    });
    if (!m.activeIds.includes(record.athleteId)) m.activeIds.push(record.athleteId);
    // An archived series keeps its session; current session counters are not changed.
    const k=JSON.stringify([record.sessionId,record.athleteId,record.type,record.position]);
    if (m.drafts[k]?.shots.length) throw Error('Salva o svuota prima la bozza già presente per questo atleta.');
    m.sessionId=record.sessionId;
    setContext(state,record.athleteId,record.type,record.position);
    m.drafts[k]={
      key:k,sessionId:record.sessionId,athleteId:record.athleteId,athleteName:record.athlete,mode:record.type,position:record.position,number:record.number||parseInt(record.series,10)||1,wind:{
        dir:record.windDir,int:record.windInt
      },shots:clone(record.shots),version:0,replacesId:record.id
    };
  }
  function startSession(state, ids) {
    const valid=ids.map(id);
    if (!valid.length) throw Error('Seleziona almeno un atleta.');
    if (valid.some(value=>!state.meta.roster.some(a=>a.id===value))) throw Error('Atleta non trovato.');
    const sessionId=uid(), now=new Date();
    for(const [k,d]of Object.entries(state.meta.drafts))if(!d.shots.length&&!d.replacesId)delete state.meta.drafts[k];
    state.sessions.push({
      id:sessionId,startedAt:now.toISOString(),title:now.toLocaleString('it-IT')
    });
    Object.assign(state.meta,{
      sessionId,activeIds:[...new Set(valid)],currentAthleteId:valid[0],currentMode:'Azzeramento',currentWind:{
        dir:'C',int:0
      },lastActivity:Date.now()
    });
    draft(state);
  }
  function mergeRoster(state, incoming) {
    const remote=roster(incoming),m=state.meta;
    if(!remote.length)throw Error('Il foglio non contiene atleti.');
    for(const a of remote){
      let local=m.roster.find(x=>x.id===a.id);
      if(!local){
        const matches=m.roster.filter(x=>x.name.toLocaleLowerCase('it')===a.name.toLocaleLowerCase('it'));
        if(matches.length===1)local=matches[0];
      }
      if(!local){
        m.roster.push(a);
        continue;
      }
      const old=local.id;
      if(old!==a.id){
        for(const record of state.series)if(record.athleteId===old)record.athleteId=a.id;
        for(const op of state.outbox)if(op.payload?.athleteId===old){
          op.payload.athleteId=a.id;
          op.id=uid();
        }
        const drafts={
        };
        for(const d of Object.values(m.drafts)){
          if(d.athleteId===old)d.athleteId=a.id;
          d.key=JSON.stringify([d.sessionId,d.athleteId,d.mode,d.position]);
          if(drafts[d.key]?.shots.length&&d.shots.length)throw Error('Due bozze corrispondono allo stesso atleta. Salvale prima di unire l’anagrafica.');
          if(!drafts[d.key]?.shots.length)drafts[d.key]=d;
        }
        m.drafts=drafts;
        const counters={
        };
        for(const [k,n]of Object.entries(m.counters)){
          const parts=JSON.parse(k);
          if(parts[1]===old)parts[1]=a.id;
          const next=JSON.stringify(parts);
          counters[next]=Math.max(counters[next]||1,n);
        }
        m.counters=counters;
        m.activeIds=m.activeIds.map(i=>i===old?a.id:i);
        if(m.currentAthleteId===old)m.currentAthleteId=a.id;
      }
      Object.assign(local,a);
    }
  }
  function migrate(old) {
    if (!old || typeof old!=='object') return create();
    if (old.meta) return validate(old);
    const s=create(), m=s.meta;
    m.roster=roster(old.roster||[]);
    m.activeIds=(old.activeAthletes||[]).map(a=>id(a.id)).filter(i=>m.roster.some(a=>a.id===i));
    m.currentAthleteId=m.activeIds.includes(String(old.currentAthleteId))?String(old.currentAthleteId):(m.activeIds[0]||'');
    Object.assign(m,{
      coachName:text(old.coachName),cloudUrl:text(old.cloudUrl),lookerUrl:text(old.lookerUrl),currentPos:old.currentPos==='P'?'P':'T',currentMode:MODES.includes(old.currentMode)?old.currentMode:'Azzeramento',shotColor:old.shotColor==='white'?'white':'color',currentWind:wind(old.currentWind),lastActivity:old.sessionTimestamp||Date.now()
    });
    for (const a of old.activeAthletes||[]) for (const mode of MODES) for (const p of ['T','P']) m.counters[counterKey(id(a.id),mode,p,m.sessionId)] = a.seriesByMode?.[mode]?.[p] || (mode==='Azzeramento' ? a[p==='T'?'seriesT':'seriesP'] : 1) || 1;
    for (const h of old.history||[]) {
      const pos=h.position==='P'?'P':'T';
      s.series.push({
        ...clone(h),id:id(h.id),sessionId:m.sessionId,athleteId:id(h.athleteId),coach:text(h.coach||old.coachName),position:pos,type:MODES.includes(h.type)?h.type:'Altro',number:parseInt(h.series,10)||1,shots:shots(h.shots,pos,true)
      });
    }
    for (const q of old.syncQueue||[]) {
      const p=clone(q);
      p.id=id(p.id);
      const local=s.series.find(r=>r.id===p.id);
      p.shots=local?clone(local.shots):shots(p.shots,p.position);
      if(local){
        p.athleteId=local.athleteId;
        p.sessionId=local.sessionId;
      }
      if(!p.coach||p.coach==='Non specificato')p.coach=m.coachName;
      enqueue(s,'insert',p.id,p);
    }
    for (const value of old.deleteQueue||[]) {
      s.outbox=s.outbox.filter(op=>op.seriesId!==String(value));
      enqueue(s,'delete',id(value),null);
    }
    const d=draft(s);
    if (d) d.shots=shots(old.currentShots||[],m.currentPos,true);
    return s;
  }
  function validate(value) {
    if (!value || value.meta?.schemaVersion!==VERSION || !Array.isArray(value.series)||!Array.isArray(value.outbox)||!Array.isArray(value.sessions)) throw Error('Formato del backup non supportato. Nessun dato è stato sostituito.');
    const s=clone(value),m=s.meta;
    m.roster=roster(m.roster);
    m.shotLimit=limit(m.shotLimit);
    m.activeIds=m.activeIds.map(id).filter(i=>m.roster.some(a=>a.id===i));
    if(!['day','night'].includes(m.theme)||!['color','white'].includes(m.shotColor)||!finite(m.revision)||m.revision<0)throw Error('Aspetto o versione del salvataggio non validi.');
    if (!MODES.includes(m.currentMode)||!['T','P'].includes(m.currentPos)||!m.sessionId||!m.drafts||typeof m.drafts!=='object'||!m.counters||typeof m.counters!=='object') throw Error('Configurazione del backup non valida.');
    m.currentAthleteId=m.activeIds.includes(String(m.currentAthleteId))?String(m.currentAthleteId):(m.activeIds[0]||'');
    const seen=new Set();
    for(const r of s.series){
      r.id=id(r.id);
      r.athleteId=id(r.athleteId);
      if(seen.has(r.id)||!['T','P'].includes(r.position))throw Error('Serie duplicata o non valida.');
      seen.add(r.id);
      r.shots=shots(r.shots,r.position);
    }
    const ops=new Set();
    for(const op of s.outbox){
      op.id=id(op.id);
      op.seriesId=id(op.seriesId);
      if(ops.has(op.id)||!['insert','delete'].includes(op.kind))throw Error('Coda non valida.');
      ops.add(op.id);
      if(op.kind==='insert'){
        if(!op.payload||op.payload.id!==op.seriesId||!['T','P'].includes(op.payload.position))throw Error('Serie in coda non valida.');
        op.payload.shots=shots(op.payload.shots,op.payload.position);
      }
    }
    for(const d of Object.values(m.drafts)){
      if(!d||!['T','P'].includes(d.position)||!finite(d.version))throw Error('Bozza non valida.');
      d.shots=shots(d.shots,d.position);
    }
    return s;
  }
  root.BiathlonDomain={
    MODES,VERSION,clone,uid,id,validUrl,invitation,invitationLink,limit,wind,shot,shots,key,counterKey,create,roster,draft,checkedDraft,addShot,setContext,packet,enqueue,saveSeries,removeSeries,editSeries,startSession,mergeRoster,migrate,validate
  };
})(globalThis);
