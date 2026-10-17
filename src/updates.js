/* Activate a ready update at startup; later updates wait for explicit consent. */
(function(root){
  'use strict';
  class AppUpdates {
    constructor({serviceWorker=root.navigator?.serviceWorker,online=()=>root.navigator?.onLine!==false,
      timeout=3000,activationTimeout=8000,beforeActivate=async()=>{},reload=()=>root.location.reload(),
      onAvailable=()=>{},onFailure=()=>{}}={}){
      Object.assign(this,{serviceWorker,online,timeout,activationTimeout,beforeActivate,reload,onAvailable,onFailure});
      this.registration=null;
      this.activation=null;
      this.requestedWorker=null;
      this.finishActivation=null;
      this.reloaded=false;
      this.observed=new WeakSet();
      serviceWorker?.addEventListener('controllerchange',()=>{
        if(this.requestedWorker&&serviceWorker.controller===this.requestedWorker)this.finishActivation?.(true);
      });
    }
    watch(worker){
      if(!worker||this.observed.has(worker))return;
      this.observed.add(worker);
      worker.addEventListener('statechange',()=>{
        Promise.resolve().then(()=>this.onAvailable(Boolean(this.registration?.waiting)));
      });
    }
    async detect(){
      const sw=this.serviceWorker;
      if(!sw)return null;
      let registration;
      if(!this.online())registration=await sw.getRegistration?.();
      else{
        try{registration=await sw.register('sw.js',{updateViaCache:'none'});}
        catch(error){registration=await sw.getRegistration?.();}
      }
      if(!registration)return null;
      this.registration=registration;
      registration.addEventListener('updatefound',()=>{
        this.watch(registration.installing);
        this.onAvailable(Boolean(registration.waiting));
      });
      this.watch(registration.installing);
      this.onAvailable(Boolean(registration.waiting));
      if(registration.waiting)return registration.waiting;
      if(this.online()){
        try{await registration.update();}catch(error){return registration.waiting||null;}
      }
      if(registration.waiting)return registration.waiting;
      const worker=registration.installing;
      if(!worker)return null;
      this.watch(worker);
      if(!['installed','activated','redundant'].includes(worker.state))await new Promise(resolve=>{
        const check=()=>{
          if(['installed','activated','redundant'].includes(worker.state)){
            worker.removeEventListener('statechange',check);
            resolve();
          }
        };
        worker.addEventListener('statechange',check);
        check();
      });
      return registration.waiting||null;
    }
    async start(){
      if(!this.serviceWorker)return false;
      let timer;
      try{
        // A slow update may finish later, but cannot reload an app already in use.
        const worker=await Promise.race([
          this.detect().catch(()=>null),
          new Promise(resolve=>{timer=setTimeout(()=>resolve(null),this.timeout);})
        ]);
        clearTimeout(timer);
        return worker?await this.activate(worker):false;
      }finally{clearTimeout(timer);}
    }
    activate(worker=this.registration?.waiting){
      if(this.activation)return this.activation;
      if(!worker||worker.state==='redundant')return Promise.resolve(false);
      this.activation=this.apply(worker).finally(()=>{this.activation=null;});
      return this.activation;
    }
    async apply(worker){
      let timer;
      try{
        await this.beforeActivate();
        if(worker.state==='activated'&&this.serviceWorker.controller===worker){
          this.reloadOnce();
          return true;
        }
        const activated=await new Promise((resolve,reject)=>{
          this.finishActivation=resolve;
          this.requestedWorker=worker;
          timer=setTimeout(()=>resolve(false),this.activationTimeout);
          try{worker.postMessage({type:'ACTIVATE'});}catch(error){reject(error);}
        });
        if(!activated)throw Error('Aggiornamento non completato. Puoi continuare e riprovare alla prossima apertura.');
        this.reloadOnce();
        return true;
      }catch(error){
        this.onFailure(error.message||String(error));
        return false;
      }finally{
        clearTimeout(timer);
        this.requestedWorker=null;
        this.finishActivation=null;
        this.onAvailable(Boolean(this.registration?.waiting));
      }
    }
    reloadOnce(){
      if(this.reloaded)return;
      this.reloaded=true;
      this.reload();
    }
  }
  root.BiathlonUpdates=AppUpdates;
})(globalThis);
