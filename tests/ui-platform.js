/* DOM fixture for event-flow regressions. Layout and real IndexedDB remain device tests. */
class FixtureElement {
  constructor(tag,attributes={
  }){
    this.tagName=tag;
    this.attributes={
    };
    this.children=[];
    this.parentElement=null;
    this.listeners={
    };
    this.style={
    };
    this.dataset={
    };
    this._text='';
    this._value='';
    this._class='';
    this.hidden=false;
    this.open=false;
    this.disabled=false;
    this.checked=false;
    this.files=[];
    this.captured=new Set();
    for(const [k,v]of Object.entries(attributes))this.setAttribute(k,v);
  }
  setAttribute(key,value){
    this.attributes[key]=String(value);
    if(key==='id')this.id=value;
    if(key==='class')this.className=value;
    if(key==='value')this.value=value;
    if(key==='type')this.type=value;
    if(key==='hidden')this.hidden=true;
    if(key.startsWith('data-'))this.dataset[key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=value;
  }
  getAttribute(key){
    return this.attributes[key]??null;
  }
  get className(){
    return this._class;
  }
  set className(value){
    this._class=value;
  }
  get classList(){
    const self=this;
    return {
      contains(c){
        return self._class.split(/\s+/).includes(c);
      },add(...values){
        const all=new Set(self._class.split(/\s+/).filter(Boolean));
        for(const v of values)all.add(v);
        self._class=[...all].join(' ');
      },remove(...values){
        self._class=self._class.split(/\s+/).filter(c=>!values.includes(c)).join(' ');
      },toggle(c,force){
        const has=this.contains(c),next=force===undefined?!has:force;
        next?this.add(c):this.remove(c);
        return next;
      }
    };
  }
  get value(){
    return this._value;
  }
  set value(value){
    this._value=String(value);
  }
  get textContent(){
    return this._text+this.children.map(c=>c.textContent).join('');
  }
  set textContent(value){
    this._text=String(value);
    this.children=[];
  }
  append(...children){
    for(const child of children){
      child.parentElement=this;
      this.children.push(child);
      if(this.tagName==='select'&&child.tagName==='option'&&this.children.length===1)this.value=child.value;
    }
  }
  prepend(child){
    child.parentElement=this;
    this.children.unshift(child);
  }
  replaceChildren(...children){
    this._text='';
    this.children=[];
    this.append(...children);
  }
  remove(){
    if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(e=>e!==this);
  }
  addEventListener(type,fn,options={
  }){
    (this.listeners[type]??=[]).push({
      fn,once:options.once
    });
  }
  async emit(type,extra={
  }){
    const event={
      type,target:this,preventDefault(){
        this.defaultPrevented=true;
      },...extra
    };
    for(const listener of [...(this.listeners[type]||[])]){
      const result=listener.fn(event);
      if(listener.once)this.listeners[type]=this.listeners[type].filter(e=>e!==listener);
      await result;
    }
    return event;
  }
  click(){
    return this.emit('click');
  }
  matches(selector){
    if(selector==='input:checked')return this.tagName==='input'&&this.checked;
    if(selector==='dialog[open]')return this.tagName==='dialog'&&this.open;
    if(selector.startsWith('.'))return this.classList.contains(selector.slice(1));
    if(selector.startsWith('['))return this.attributes[selector.slice(1,-1)]!==undefined;
    return this.tagName===selector;
  }
  querySelectorAll(selector){
    return this.children.flatMap(e=>[...(e.matches(selector)?[e]:[]),...e.querySelectorAll(selector)]);
  }
  querySelector(selector){
    return this.querySelectorAll(selector)[0]||null;
  }
  closest(selector){
    let e=this;
    while(e&&!e.matches(selector))e=e.parentElement;
    return e;
  }
  showModal(){
    this.open=true;
  }
  close(value){
    if(value!==undefined)this.returnValue=value;
    this.open=false;
    this.emit('close');
  }
  scrollIntoView(){
  }
  getBoundingClientRect(){
    return {
      left:0,top:0,right:390,bottom:429,width:390,height:429
    };
  }
  setPointerCapture(id){
    this.captured.add(id);
  }
  releasePointerCapture(id){
    this.captured.delete(id);
    this.emit('lostpointercapture');
  }
  hasPointerCapture(id){
    return this.captured.has(id);
  }
}
function buildFixture(tree){
  const e=new FixtureElement(tree.tag,tree.attrs);
  for(const child of tree.children)e.append(buildFixture(child));
  return e;
}
globalThis.__documentTree=buildFixture(__htmlTree);
globalThis.document={
  body:__documentTree.querySelector('body'),visibilityState:'visible',createElement:tag=>new FixtureElement(tag),createElementNS:(_,tag)=>new FixtureElement(tag),getElementById:id=>[__documentTree,...__documentTree.querySelectorAll('*')].find(e=>e.id===id),querySelectorAll:selector=>__documentTree.querySelectorAll(selector),listeners:{
  },addEventListener(type,fn){
    (this.listeners[type]??=[]).push(fn);
  }
};
// '*' needs to include every descendant for getElementById.
const originalMatches=FixtureElement.prototype.matches;
FixtureElement.prototype.matches=function(s){
  return s==='*'||originalMatches.call(this,s);
};
globalThis.window=globalThis;
globalThis.navigator={
  onLine:false,storage:{
    persist:async()=>false
  }
};
globalThis.location={
  href:'https://example.test/BiathlonTracker/',reload(){
    globalThis.__reloaded=true;
  }
};
globalThis.addEventListener=()=>{
};
globalThis.Blob=class{
};
globalThis.__downloads=[];
globalThis.__uiInitial=BiathlonDomain.create();
__uiInitial.meta.roster=[{
  id:'1',name:'Atleta A'
},{
  id:'2',name:'Atleta B'
}];
__uiInitial.meta.activeIds=['1','2'];
__uiInitial.meta.currentAthleteId='1';
globalThis.BiathlonRepository=class{
  constructor(){
    this.snapshot=BiathlonDomain.clone(__uiInitial);
    this.queue=Promise.resolve();
    globalThis.__uiRepo=this;
  }
  async initialize(){
    return BiathlonDomain.clone(this.snapshot);
  }
  async read(){
    return BiathlonDomain.clone(this.snapshot);
  }
  mutate(fn){
    const result=this.queue.then(()=>{
      if(this.failNext){
        this.failNext=false;
        throw Error('Simulated disk failure');
      }
      const next=BiathlonDomain.clone(this.snapshot);
      const value=fn(next);
      next.meta.revision++;
      this.snapshot=next;
      return {
        state:BiathlonDomain.clone(next),value
      };
    });
    this.queue=result.catch(()=>{
    });
    return result;
  }
  close(){
  }
};
