/* Statistics rules shared by the statistics page and the regression tests */
(function(root){
  'use strict';
  // Black aiming area: 115 mm wide, 180 units of radius on the 400 x 440 target
  const MM_PER_UNIT=57.5/180;
  const CENTER={x:200,y:220};
  const POSITIONS=['T','P'];

  function seriesNumber(label){
    return parseInt(label,10)||1;
  }
  // Row layout sent by the Apps Script archive action
  function fromRow(r){
    return {
      id:r[0],date:r[1],type:r[2],coach:r[3],athlete:r[4],position:r[5]==='P'?'P':'T',series:r[6],
      seq:r[7],x:r[8],y:r[9],esito:r[10],windDir:r[11],windInt:r[12],deleted:r[13],
      athleteId:r[14]||'',sessionId:r[15]||'',timestamp:r[16]||''
    };
  }
  // Merge one archive page into a Map of series; returns what to persist
  function applyArchivePage(archive,page){
    const changed=new Set(),removed=new Set();
    if(page.reset){
      for(const id of archive.keys())removed.add(id);
      archive.clear();
    }
    for(const raw of page.rows||[]){
      const r=fromRow(raw);
      if(!r.id||!Number.isFinite(r.x)||!Number.isFinite(r.y))continue;
      if(r.deleted){
        if(archive.delete(r.id))removed.add(r.id);
        changed.delete(r.id);
        continue;
      }
      let s=archive.get(r.id);
      if(!s){
        s={
          id:r.id,date:r.date||String(r.timestamp).slice(0,10),type:r.type,coach:r.coach,athlete:r.athlete,
          athleteId:r.athleteId||'name:'+r.athlete.toLocaleLowerCase('it'),position:r.position,series:r.series,
          number:seriesNumber(r.series),sessionId:r.sessionId,timestamp:r.timestamp||r.date,
          windDir:r.windDir||'C',windInt:Number(r.windInt)||0,shots:[]
        };
        archive.set(r.id,s);
        removed.delete(r.id);
      }
      // A series split across two pages arrives twice: keep one shot per number
      if(!s.shots.some(x=>x.seq===r.seq))s.shots.push({seq:r.seq,x:r.x,y:r.y,esito:r.esito});
      s.shots.sort((a,b)=>a.seq-b.seq);
      changed.add(r.id);
    }
    for(const id of page.tombstones||[]){
      if(archive.delete(id))removed.add(id);
      changed.delete(id);
    }
    return {changed,removed};
  }
  // Archive from Google plus series of this device that are not uploaded yet
  function mergeSources(archiveSeries,state){
    const pendingDeletes=new Set((state?.outbox||[]).filter(o=>o.kind==='delete').map(o=>o.seriesId));
    const result=new Map();
    for(const s of archiveSeries)if(!pendingDeletes.has(s.id))result.set(s.id,{...s,source:'archive'});
    for(const r of state?.series||[]){
      if(result.has(r.id)||pendingDeletes.has(r.id))continue;
      result.set(r.id,{
        id:r.id,date:r.localDate||String(r.timestamp).slice(0,10),type:r.type,coach:r.coach||state.meta?.coachName||'',
        athlete:r.athlete,athleteId:r.athleteId,position:r.position,series:r.series,number:r.number||seriesNumber(r.series),
        sessionId:r.sessionId,timestamp:r.timestamp,windDir:r.windDir,windInt:Number(r.windInt)||0,
        shots:r.shots.map(s=>({seq:s.seq,x:s.x,y:s.y,esito:s.esito})),source:'local'
      });
    }
    // Old sheet rows have no athlete ID: reuse the ID of a series with the same name
    const byName=new Map();
    for(const a of state?.meta?.roster||[])byName.set(a.name.toLocaleLowerCase('it'),a.id);
    for(const s of result.values())if(!String(s.athleteId).startsWith('name:'))byName.set(String(s.athlete).toLocaleLowerCase('it'),s.athleteId);
    for(const s of result.values()){
      if(!String(s.athleteId).startsWith('name:'))continue;
      const id=byName.get(String(s.athlete).toLocaleLowerCase('it'));
      if(id)s.athleteId=id;
    }
    return Array.from(result.values());
  }
  // Same athlete registered with different IDs on old rows: group by name as fallback
  function athletes(series){
    const map=new Map();
    for(const s of series)if(!map.has(s.athleteId))map.set(s.athleteId,s.athlete);
    return Array.from(map,([id,name])=>({id,name})).sort((a,b)=>a.name.localeCompare(b.name,'it'));
  }
  function values(series,key){
    return Array.from(new Set(series.map(s=>s[key]).filter(v=>v!==''&&v!=null))).sort((a,b)=>String(a).localeCompare(String(b),'it',{numeric:true}));
  }
  function days(series){
    return values(series,'date').reverse();
  }
  function inSet(set,value){
    return !set||set.has(value);
  }
  // f: {from,to,athletes,coaches,types,positions,number,seqs,esito,windMin,windMax}; sets are null for "all"
  function seriesMatch(s,f){
    if(f.from&&s.date<f.from)return false;
    if(f.to&&s.date>f.to)return false;
    if(!inSet(f.athletes,s.athleteId)||!inSet(f.coaches,s.coach)||!inSet(f.types,s.type))return false;
    if(f.number&&s.number!==f.number)return false;
    const w=Number(s.windInt)||0;
    if(f.windMin!=null&&w<f.windMin)return false;
    if(f.windMax!=null&&w>f.windMax)return false;
    return true;
  }
  function shots(series,f){
    const out=[];
    for(const s of series){
      if(!seriesMatch(s,f))continue;
      for(const shot of s.shots){
        const hit=shot.esito==='Bersaglio';
        if(!inSet(f.seqs,shot.seq))continue;
        if(f.esito==='hit'&&!hit)continue;
        if(f.esito==='miss'&&hit)continue;
        out.push({x:shot.x,y:shot.y,seq:shot.seq,hit,series:s});
      }
    }
    return out;
  }
  function meanPoint(list){
    if(!list.length)return null;
    let x=0,y=0;
    for(const s of list){
      x+=s.x;
      y+=s.y;
    }
    x/=list.length;
    y/=list.length;
    // Screen Y grows downwards: up is positive in millimetres
    return {x,y,right:(x-CENTER.x)*MM_PER_UNIT,up:(CENTER.y-y)*MM_PER_UNIT};
  }
  function summary(list){
    const result={};
    for(const p of POSITIONS){
      const own=list.filter(s=>s.series.position===p),hits=own.filter(s=>s.hit).length,bySeq=new Map();
      for(const s of own){
        const g=bySeq.get(s.seq)||{seq:s.seq,n:0,hits:0};
        g.n++;
        if(s.hit)g.hits++;
        bySeq.set(s.seq,g);
      }
      result[p]={
        n:own.length,hits,pct:own.length?hits/own.length*100:null,mpi:meanPoint(own),
        series:new Set(own.map(s=>s.series.id)).size,
        perSeq:Array.from(bySeq.values()).sort((a,b)=>a.seq-b.seq).map(g=>({...g,pct:g.hits/g.n*100}))
      };
    }
    return result;
  }
  function offsetText(mpi){
    if(!mpi)return '';
    const part=(v,pos,neg)=>Math.abs(v)<0.05?'':`${Math.abs(v).toFixed(1).replace('.',',')} mm ${v>0?pos:neg}`;
    const parts=[part(mpi.right,'a destra','a sinistra'),part(mpi.up,'in alto','in basso')].filter(Boolean);
    return parts.length?parts.join(' · '):'al centro';
  }
  // Colour groups: result, athlete, series number or wind strength
  function colorKey(shot,mode){
    if(mode==='athlete')return shot.series.athleteId;
    if(mode==='series')return String(shot.series.number);
    if(mode==='wind')return String(Number(shot.series.windInt)||0);
    return shot.hit?'hit':'miss';
  }
  function legend(list,mode){
    if(mode==='esito')return [{key:'hit',label:'Bersaglio'},{key:'miss',label:'Errore'}];
    if(mode==='wind')return [0,1,2,3,4,5].map(n=>({key:String(n),label:n?`Vento ${n}/5`:'Calmo'}));
    const map=new Map();
    for(const s of list){
      const key=colorKey(s,mode);
      if(!map.has(key))map.set(key,mode==='athlete'?s.series.athlete:`Serie ${s.series.number}`);
    }
    return Array.from(map,([key,label])=>({key,label})).sort((a,b)=>a.label.localeCompare(b.label,'it',{numeric:true}));
  }
  function localDay(date){
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  }
  // Quick periods relative to today
  function period(kind,now=new Date()){
    const today=localDay(now),back=n=>{
      const d=new Date(now.getFullYear(),now.getMonth(),now.getDate()-n);
      return localDay(d);
    };
    if(kind==='today')return {from:today,to:today};
    if(kind==='7')return {from:back(6),to:today};
    if(kind==='30')return {from:back(29),to:today};
    return {from:'',to:''};
  }
  root.BiathlonStats={
    MM_PER_UNIT,CENTER,fromRow,applyArchivePage,mergeSources,athletes,values,days,seriesMatch,shots,
    meanPoint,summary,offsetText,colorKey,legend,period,localDay
  };
})(globalThis);
