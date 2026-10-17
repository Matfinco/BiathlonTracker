(function(root){
  'use strict';
  const D=root.BiathlonDomain;
  const STORES=['meta','series','outbox','sessions'];
  class Repository {
    constructor(){
      this.db=null;
      this.queue=Promise.resolve();
      this.channel=typeof BroadcastChannel==='function'?new BroadcastChannel('biathlon-tracker-v6'):null;
      this.onchange=()=>{
      };
      if(this.channel)this.channel.onmessage=()=>this.onchange();
    }
    async open(){
      if(this.db)return this.db;
      this.db=await new Promise((resolve,reject)=>{
        const req=indexedDB.open('BiathlonTrackerDB',2);
        req.onupgradeneeded=()=>{
          const db=req.result;
          if(!db.objectStoreNames.contains('appState'))db.createObjectStore('appState');
          for(const name of STORES)if(!db.objectStoreNames.contains(name))db.createObjectStore(name,name==='meta'?undefined:{
            keyPath:'id'
          });
        };
        req.onerror=()=>reject(req.error);
        req.onblocked=()=>{
          this.onblocked?.('Chiudi le altre schede di Biathlon Tracker per aggiornare l’archivio.');
        };
        req.onsuccess=()=>resolve(req.result);
      });
      this.db.onversionchange=()=>{
        this.close();
        this.onblocked?.('Archivio aggiornato in un’altra scheda. Riapri l’app.');
      };
      return this.db;
    }
    async initialize(){
      const db=await this.open();
      return new Promise((resolve,reject)=>{
        const tx=db.transaction([...STORES,'appState'],'readwrite'), metaReq=tx.objectStore('meta').get('main'), oldReq=tx.objectStore('appState').get('main_state');
        let result, problem, remaining=2;
        const ready=()=>{
          if(--remaining)return;
          try{
            if(metaReq.result){
              result=null;
              return;
            }
            let old=oldReq.result;
            if(!old){
              const raw=localStorage.getItem('biathlon_tracker_data_v5');
              if(raw)old=JSON.parse(raw);
            }
            result=D.migrate(old);
            if(old)tx.objectStore('appState').put({
              savedAt:new Date().toISOString(),data:old
            },'legacy_backup_v5');
            tx.objectStore('meta').put(result.meta,'main');
            for(const name of ['series','outbox','sessions'])for(const entry of result[name])tx.objectStore(name).put(entry);
          }catch(e){
            problem=e;
            tx.abort();
          }
        };
        metaReq.onsuccess=ready;
        oldReq.onsuccess=ready;
        tx.oncomplete=()=>resolve(result);
        tx.onabort=()=>reject(problem||tx.error||Error('Migrazione interrotta.'));
        tx.onerror=()=>{
        };
      }).then(()=>this.read()).then(snapshot=>D.validate(snapshot));
    }
    async read(){
      const db=await this.open();
      return new Promise((resolve,reject)=>{
        const tx=db.transaction(STORES,'readonly'), requests={
          meta:tx.objectStore('meta').get('main')
        };
        for(const name of ['series','outbox','sessions'])requests[name]=tx.objectStore(name).getAll();
        tx.oncomplete=()=>{
          const state=Object.fromEntries(Object.entries(requests).map(([k,r])=>[k,r.result]));
          if(!state.meta)reject(Error('Archivio non inizializzato.'));
          else resolve(state);
        };
        tx.onabort=()=>reject(tx.error||Error('Lettura interrotta.'));
        tx.onerror=()=>{
        };
      });
    }
    mutate(updater){
      const run=async()=>{
        const db=await this.open();
        return new Promise((resolve,reject)=>{
          // Reading and writing in one transaction serializes all tabs and prevents lost updates.
          const tx=db.transaction(STORES,'readwrite'), requests={
            meta:tx.objectStore('meta').get('main')
          };
          for(const name of ['series','outbox','sessions'])requests[name]=tx.objectStore(name).getAll();
          let remaining=4,snapshot,value,problem;
          const ready=()=>{
            if(--remaining)return;
            try{
              snapshot=Object.fromEntries(Object.entries(requests).map(([k,r])=>[k,r.result]));
              if(!snapshot.meta)throw Error('Archivio non inizializzato.');
              const before={
              };
              for(const name of ['series','outbox','sessions'])before[name]=new Map(snapshot[name].map(e=>[e.id,JSON.stringify(e)]));
              value=updater(snapshot);
              if(value&&typeof value.then==='function')throw Error('La transazione deve essere sincrona.');
              snapshot.meta.revision=(snapshot.meta.revision||0)+1;
              tx.objectStore('meta').put(snapshot.meta,'main');
              for(const name of ['series','outbox','sessions']){
                const store=tx.objectStore(name),after=new Map(snapshot[name].map(e=>[e.id,e]));
                for(const oldId of before[name].keys())if(!after.has(oldId))store.delete(oldId);
                for(const entry of after.values())if(before[name].get(entry.id)!==JSON.stringify(entry))store.put(entry);
              }
            }catch(e){
              problem=e;
              tx.abort();
            }
          };
          for(const request of Object.values(requests))request.onsuccess=ready;
          tx.oncomplete=()=>{
            this.channel?.postMessage({
              revision:snapshot.meta.revision
            });
            resolve({
              state:snapshot,value
            });
          };
          tx.onabort=()=>reject(problem||tx.error||Error('Salvataggio interrotto. Nessuna modifica confermata.'));
          tx.onerror=()=>{
          };
        });
      };
      const result=this.queue.then(run,run);
      this.queue=result.catch(()=>{
      });
      return result;
    }
    async replace(backup){
      const valid=D.validate(backup);
      return this.mutate(s=>{
        Object.assign(s,D.clone(valid));
        s.meta.syncLease=null;
      });
    }
    async backup(){
      const state=await this.read();
      state.meta.syncLease=null;
      state.meta.apiToken='';
      return {
        format:'BiathlonTrackerBackup',exportedAt:new Date().toISOString(),...state
      };
    }
    async rawBackup(){
      const db=await this.open();
      return new Promise((resolve,reject)=>{
        const tx=db.transaction(['appState',...STORES],'readonly'),entries={
        };
        for(const name of ['appState',...STORES]){
          const store=tx.objectStore(name),keys=store.getAllKeys(),values=store.getAll();
          keys.onsuccess=()=>{
            entries[name]??={
            };
            entries[name].keys=keys.result;
          };
          values.onsuccess=()=>{
            entries[name]??={
            };
            entries[name].values=values.result;
          };
        }
        tx.oncomplete=()=>resolve({
          format:'BiathlonTrackerRecovery',exportedAt:new Date().toISOString(),entries
        });
        tx.onabort=()=>reject(tx.error);
      });
    }
    async reset(){
      await this.queue;
      this.close();
      await new Promise((resolve,reject)=>{
        const request=indexedDB.deleteDatabase('BiathlonTrackerDB');
        request.onsuccess=()=>resolve();
        request.onerror=()=>reject(request.error);
        request.onblocked=()=>reject(Error('Reset in attesa: chiudi le altre schede dell’app e riprova.'));
      });
      localStorage.removeItem('biathlon_tracker_data_v5');
    }
    close(){
      if(this.db)this.db.close();
      this.db=null;
    }
    dispose(){
      this.close();
      this.channel?.close();
    }
  }
  root.BiathlonRepository=Repository;
})(globalThis);
