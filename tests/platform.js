/* Small platform fakes; these tests do not claim to exercise a real browser. */
globalThis.__timers=new Map();
globalThis.__timerId=0;
globalThis.setTimeout=(fn,ms)=>{
  const id=++__timerId;
  __timers.set(id,{
    fn,ms
  });
  return id;
};
globalThis.clearTimeout=id=>__timers.delete(id);
globalThis.AbortController=class{
  constructor(){
    this.signal={
      aborted:false,addEventListener:(name,fn)=>this.listener=fn
    };
  }
  abort(){
    this.signal.aborted=true;
    if(this.listener)this.listener();
  }
};
globalThis.URL=class{
  constructor(value,base){
    if(!/^https?:/.test(value)&&base)value=base.slice(0,base.lastIndexOf('/')+1)+value.replace(/^\.\//,'');
    const match=/^(https?):\/\/([^/\s]+)(\/[^\s]*)?$/.exec(value);
    if(!match)throw Error('Invalid URL');
    this.protocol=match[1]+':';
    this.hostname=match[2];
    this.origin=this.protocol+'//'+this.hostname;
    this.pathname=match[3]||'/';
    this.href=value;
  }
};
globalThis.crypto={
  randomUUID:()=>`test-${++globalThis.__uuid}`
};
globalThis.__uuid=0;
globalThis.testDone=false;
globalThis.testResults=[];
