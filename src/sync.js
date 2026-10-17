(function(root){
  'use strict';
  const D=root.BiathlonDomain;
  class SyncEngine {
    constructor(repository,{
      fetch:fetcher=(...args)=>fetch(...args),onstate=()=>{
      },online=()=>navigator.onLine,timeout=30000
    }
    ={
    }){
      this.repo=repository;
      this.fetch=fetcher;
      this.onstate=onstate;
      this.online=online;
      this.timeout=timeout;
      this.running=null;
      this.owner=D.uid();
      this.retryTimer=null;
      this.failures=0;
    }
    run(){
      if(this.running)return this.running;
      this.running=this.perform().finally(()=>{
        this.running=null;
      });
      return this.running;
    }
    async request(config,payload){
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),this.timeout);
      try{
        const response=await this.fetch(D.validUrl(config.cloudUrl),{
          method:'POST',headers:{
            'Content-Type':'text/plain;charset=utf-8'
          },body:JSON.stringify({
            ...payload,token:config.apiToken||''
          }),signal:controller.signal,cache:'no-store',credentials:'omit'
        });
        if(!response.ok)throw Error(`Il server ha risposto con errore HTTP ${response.status}.`);
        let data;
        try{
          data=await response.json();
        }catch(error){
          throw Error('Risposta non valida. Verifica indirizzo /exec e deployment Apps Script.');
        }
        if(data.status!=='success')throw Error(data.error||'Il server non ha confermato il salvataggio.');
        if(data.protocolVersion!==2)throw Error('Aggiorna il codice Google Apps Script alla versione inclusa nel progetto. Le operazioni restano in coda.');
        if(payload.action!=='roster'&&data.coach&&data.coach!==config.coachName)throw Error('La conferma del server appartiene a un altro allenatore.');
        return data;
      }finally{
        clearTimeout(timer);
      }
    }
    async perform(){
      if(!this.online())return {
        offline:true
      };
      const claim=await this.repo.mutate(s=>{
        if(!s.outbox.length)return null;
        if(!s.meta.cloudUrl||!s.meta.coachName||!s.meta.apiToken)throw Error('Configura indirizzo Google, firma e chiave personale prima di sincronizzare.');
        if(s.meta.syncLease&&s.meta.syncLease.until>Date.now()&&s.meta.syncLease.owner!==this.owner)return {
          blockedUntil:s.meta.syncLease.until
        };
        // Deletes are sent on a separate pass, after pending inserts have settled.
        const inserts=s.outbox.filter(op=>op.kind==='insert'&&(!op.payload.coach||op.payload.coach===s.meta.coachName)).slice(0,25);
        const ops=inserts.length?inserts:s.outbox.filter(op=>op.kind==='delete'&&(!op.coach||op.coach===s.meta.coachName)).slice(0,100);
        if(!ops.length)throw Error('Le operazioni pendenti appartengono a un’altra firma. Ripristina le sue credenziali per inviarle.');
        s.meta.syncLease={
          owner:this.owner,until:Date.now()+90000
        };
        return {
          config:D.clone(s.meta),ops:D.clone(ops)
        };
      });
      if(!claim.value)return {
        idle:true
      };
      if(claim.value.blockedUntil){
        this.schedule(Math.max(1000,claim.value.blockedUntil-Date.now()+100));
        return {
          idle:true
        };
      }
      const {
        config,ops
      }
      =claim.value;
      this.onstate({
        status:'syncing',count:ops.length
      });
      try{
        const payload={
          inserts:ops.filter(o=>o.kind==='insert').map(o=>({
            ...o.payload,coach:o.payload.coach||config.coachName
          })),deletes:ops.filter(o=>o.kind==='delete').map(o=>o.seriesId)
        };
        const result=await this.request(config,payload);
        if(!Array.isArray(result.ack?.inserts)||!Array.isArray(result.ack?.deletes))throw Error('Conferma del server incompleta. Le operazioni restano in coda.');
        const confirmedInserts=new Set(result.ack.inserts);
        const confirmedDeletes=new Set(result.ack.deletes);
        const confirmedOps=new Set(ops.filter(o=>(o.kind==='insert'?confirmedInserts:confirmedDeletes).has(o.seriesId)).map(o=>o.id));
        if(!confirmedOps.size)throw Error('Il server non ha confermato nessuna delle operazioni inviate.');
        const saved=await this.repo.mutate(s=>{
          s.outbox=s.outbox.filter(o=>!confirmedOps.has(o.id));
          if(s.meta.syncLease?.owner===this.owner)s.meta.syncLease=null;
          s.meta.lastSync=new Date().toISOString();
        });
        this.failures=0;
        this.onstate({
          status:'success',remaining:saved.state.outbox.length
        });
        if(saved.state.outbox.length)this.schedule(250);
        return {
          remaining:saved.state.outbox.length
        };
      }catch(error){
        await this.repo.mutate(s=>{
          if(s.meta.syncLease?.owner===this.owner)s.meta.syncLease=null;
        }).catch(()=>{
        });
        this.failures++;
        const message=error.name==='AbortError'?'Il server non ha risposto in tempo. Le operazioni restano da inviare.':error.message;
        this.onstate({
          status:'error',message
        });
        this.schedule(Math.min(300000,10000*2**Math.min(this.failures,5)));
        throw Error(message);
      }
    }
    schedule(delay=1000){
      clearTimeout(this.retryTimer);
      this.retryTimer=setTimeout(()=>{
        this.retryTimer=null;
        this.run().catch(()=>{
        });
      },delay);
    }
    async roster(config){
      const data=await this.request(config,{
        action:'roster',inserts:[],deletes:[]
      });
      return D.roster(data.roster);
    }
    stop(){
      clearTimeout(this.retryTimer);
      this.retryTimer=null;
    }
  }
  root.BiathlonSync=SyncEngine;
})(globalThis);
