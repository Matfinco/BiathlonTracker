/** Biathlon Tracker, protocol 2. A:O stay compatible with the existing Looker source. */
var BIATHLON_HEADERS = ['ID','Data','Tipo','Allenatore','Atleta','Posizione','Serie','Colpo','X','Y','Distanza','Esito','VentoDir','VentoInt','Eliminato','AtletaID','SessioneID','Timestamp'];
function json_(value){
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
function str_(value,max){
  var result=String(value==null?'':value).trim();
  if(result.length>(max||180))throw Error('Testo troppo lungo.');
  return result;
}
function cell_(value){
  var v=String(value==null?'':value);
  return /^[=+@-]/.test(v)?"'"+v:v;
}
function authorize_(data){
  var props=PropertiesService.getScriptProperties(),token=String(data.token||'');
  if(!token||token.length>250)throw Error('Accesso allenatore non valido o revocato.');
  var records=coachRecords_();
  for(var i=0;i<records.length;i++){
    if(records[i].token===token){
      if(!records[i].active)throw Error('Accesso allenatore revocato. Chiedi un nuovo collegamento all’amministratore.');
      return {name:records[i].name};
    }
  }
  // Existing personal keys remain valid until the administrator migrates them.
  var raw=props.getProperty('BIATHLON_COACH_KEYS'),keys=raw?JSON.parse(raw):{};
  if(Object.prototype.hasOwnProperty.call(keys,token)&&str_(keys[token],120))return {name:str_(keys[token],120)};
  throw Error('Accesso allenatore non valido o revocato.');
}
var BIATHLON_COACH_PREFIX='BIATHLON_COACH_RECORD_';
function coachRecords_(){
  var all=PropertiesService.getScriptProperties().getProperties();
  return Object.keys(all).filter(function(k){return k.indexOf(BIATHLON_COACH_PREFIX)===0;}).map(function(k){return JSON.parse(all[k]);});
}
function storeCoach_(record){
  PropertiesService.getScriptProperties().setProperty(BIATHLON_COACH_PREFIX+record.id,JSON.stringify(record));
  return record;
}
function migrateCoachKeys_(){
  var props=PropertiesService.getScriptProperties(),raw=props.getProperty('BIATHLON_COACH_KEYS');
  if(!raw)return;
  var keys=JSON.parse(raw),records=coachRecords_();
  Object.keys(keys).forEach(function(token){
    if(records.some(function(r){return r.token===token;}))return;
    var name=str_(keys[token],120);
    if(name)storeCoach_({id:Utilities.getUuid(),name:name,token:token,active:true,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
  });
  // Remove the legacy source only after every key has been preserved.
  props.deleteProperty('BIATHLON_COACH_KEYS');
}
function createCoach_(name){
  name=str_(name,120);
  if(!name)throw Error('Inserisci nome e cognome dell’allenatore.');
  if(coachRecords_().some(function(r){return r.name.toLowerCase()===name.toLowerCase();}))throw Error('Allenatore già presente: usa il suo accesso nell’elenco oppure rigeneralo.');
  var now=new Date().toISOString();
  return storeCoach_({id:Utilities.getUuid(),name:name,token:Utilities.getUuid()+Utilities.getUuid(),active:true,createdAt:now,updatedAt:now});
}
function authorizeAdmin_(data){
  var expected=PropertiesService.getScriptProperties().getProperty('BIATHLON_ADMIN_TOKEN');
  if(!expected||String(data.token||'')!==expected)throw Error('Accesso amministratore non valido. Usa il collegamento amministratore generato dal progetto Google.');
}
function adminAction_(data){
  authorizeAdmin_(data);
  if(['admin.list','admin.create','admin.rotate','admin.revoke'].indexOf(data.action)<0)throw Error('Operazione amministratore non valida.');
  migrateCoachKeys_();
  if(data.action==='admin.create')createCoach_(data.name);
  if(data.action==='admin.rotate'||data.action==='admin.revoke'){
    var id=identifier_(data.id),record=coachRecords_().filter(function(r){return r.id===id;})[0];
    if(!record)throw Error('Allenatore non trovato. Aggiorna l’elenco.');
    if(data.action==='admin.rotate'){
      record.token=Utilities.getUuid()+Utilities.getUuid();
      record.active=true;
    }else record.active=false;
    record.updatedAt=new Date().toISOString();
    storeCoach_(record);
  }
  var coaches=coachRecords_().sort(function(a,b){return a.name.localeCompare(b.name);}).map(function(r){
    return {id:r.id,name:r.name,active:r.active,createdAt:r.createdAt,updatedAt:r.updatedAt,keyHint:r.token.slice(-8),token:r.active?r.token:''};
  });
  return json_({status:'success',protocolVersion:2,coaches:coaches});
}
function identifier_(value,optional){
  var v=str_(value);
  if(optional&&!v)return '';
  if(!/^[A-Za-z0-9_.:-]{1,180}$/.test(v))throw Error('Identificativo non valido.');
  return v;
}
function spreadsheet_(){
  // Web app requests have no active spreadsheet; open the configured file explicitly.
  var id=String(PropertiesService.getScriptProperties().getProperty('BIATHLON_SPREADSHEET_ID')||'').trim();
  if(!/^[A-Za-z0-9_-]+$/.test(id))throw Error('Configura BIATHLON_SPREADSHEET_ID nelle Proprietà script con il solo ID del foglio Google.');
  return SpreadsheetApp.openById(id);
}
function lastDataRow_(sheet){
  var last=sheet.getLastRow();if(last<2)return 1;
  var ids=sheet.getRange(2,1,last-1,1).getValues();
  for(var i=ids.length-1;i>=0;i--)if(String(ids[i][0]).trim())return i+2;
  return 1;
}
function writeRows_(sheet,start,rows,width){
  if(!rows.length)return;
  var required=start+rows.length-1;
  if(required>sheet.getMaxRows())sheet.insertRowsAfter(sheet.getMaxRows(),required-sheet.getMaxRows());
  sheet.getRange(start,1,rows.length,width).setValues(rows);
}
function database_(ss){
  var name=PropertiesService.getScriptProperties().getProperty('BIATHLON_DATABASE_SHEET')||'Database',sheet=ss.getSheetByName(name);
  if(!sheet)throw Error('Tab '+name+' non trovato. Nessun altro foglio è stato modificato.');
  if(sheet.getMaxColumns()<18)sheet.insertColumnsAfter(sheet.getMaxColumns(),18-sheet.getMaxColumns());
  if(sheet.getLastRow()===0)sheet.getRange(1,1,1,18).setValues([BIATHLON_HEADERS]);
  else{
    var added=sheet.getRange(1,16,1,3).getValues()[0];
    for(var i=0;i<3;i++)if(!added[i])sheet.getRange(1,16+i).setValue(BIATHLON_HEADERS[15+i]);
  }
  return sheet;
}
function roster_(ss){
  var sheet=ss.getSheetByName('Anagrafica');
  if(!sheet)throw Error('Tab Anagrafica non trovato.');
  if(sheet.getMaxColumns()<4)sheet.insertColumnsAfter(sheet.getMaxColumns(),4-sheet.getMaxColumns());
  if(!sheet.getRange(1,4).getValue())sheet.getRange(1,4).setValue('AtletaID');
  var last=sheet.getLastRow(),rows=last>1?sheet.getRange(2,1,last-1,4).getValues():[],seen={
  },roster=[],ids=[];
  for(var i=0;i<rows.length;i++){
    var name=str_(rows[i][0],120),athleteId=str_(rows[i][3]);
    if(name&&(!athleteId||seen[athleteId]))athleteId=Utilities.getUuid();
    ids.push([athleteId]);
    if(name){
      seen[athleteId]=true;
      roster.push({
        id:athleteId,name:name
      });
    }
  }
  if(ids.length)sheet.getRange(2,4,ids.length,1).setValues(ids);
  return {
    sheet:sheet,roster:roster
  };
}
function normalizePacket_(input){
  if(!input||typeof input!=='object')throw Error('Serie non valida.');
  var p={
    id:identifier_(input.id),athleteId:identifier_(input.athleteId,true),sessionId:identifier_(input.sessionId,true),athlete:str_(input.athlete,120),coach:str_(input.coach,120),type:str_(input.type,80),position:input.position,series:str_(input.series,30),timestamp:str_(input.timestamp,40),localDate:str_(input.localDate,10),windDir:str_(input.windDir,2),windInt:input.windInt
  };
  if(!p.id||!p.athlete||!p.coach||!p.type||['T','P'].indexOf(p.position)<0||!/^\d+[TP]$/.test(p.series)||!Number.isFinite(Date.parse(p.timestamp)))throw Error('Metadati della serie incompleti o non validi.');
  if(!p.localDate)p.localDate=p.timestamp.split('T')[0];
  if(!/^\d{4}-\d{2}-\d{2}$/.test(p.localDate))throw Error('Data non valida.');
  if(['C','N','NE','E','SE','S','SW','W','NW'].indexOf(p.windDir)<0||!Number.isInteger(p.windInt)||p.windInt<0||p.windInt>5)throw Error('Vento non valido.');
  if(!Array.isArray(input.shots)||input.shots.length<1||input.shots.length>50)throw Error('Una serie deve contenere da 1 a 50 colpi.');
  var seq={
  };
  p.shots=input.shots.map(function(s){
    if(!s||!Number.isInteger(s.seq)||s.seq<1||s.seq>50||seq[s.seq]||!Number.isFinite(s.x)||!Number.isFinite(s.y)||s.x<0||s.x>400||s.y<0||s.y>440)throw Error('Colpo non valido.');
    seq[s.seq]=true;
    var distance=Math.hypot(s.x-200,s.y-220);
    return {
      seq:s.seq,x:s.x,y:s.y,distanza:distance,esito:distance<=(p.position==='T'?70.4:180)?'Bersaglio':'Errore'
    };
  });
  return p;
}
function doPost(e){
  var lock=null;
  try{
    if(!e||!e.postData||!e.postData.contents||e.postData.contents.length>2000000)throw Error('Richiesta assente o troppo grande.');
    var data=JSON.parse(e.postData.contents);
    lock=LockService.getScriptLock();
    if(!lock.tryLock(15000))throw Error('Archivio occupato. Riprova: le operazioni sono conservate sul dispositivo.');
    if(typeof data.action==='string'&&data.action.indexOf('admin.')===0)return adminAction_(data);
    var authorized=authorize_(data);
    var input=data.inserts||[],deletes=data.deletes||[];
    if(!Array.isArray(input)||input.length>100||!Array.isArray(deletes)||deletes.length>500)throw Error('Troppe operazioni nella richiesta.');
    // Validate the entire batch before changing any sheet.
    var packets=input.map(normalizePacket_);
    deletes=deletes.map(function(value){
      return identifier_(value);
    });
    packets.forEach(function(p){
      if(p.coach!==authorized.name)throw Error('La firma deve corrispondere all’allenatore autorizzato: '+authorized.name);
    });
    var ss=spreadsheet_();
    if(data.action==='roster'){
      var listed=roster_(ss);
      SpreadsheetApp.flush();
      return json_({
        status:'success',protocolVersion:2,coach:authorized.name,roster:listed.roster
      });
    }
    var sheet=database_(ss),last=lastDataRow_(sheet),rows=last>1?sheet.getRange(2,1,last-1,18).getValues():[],existing=Object.create(null);
    var requestedIds=Object.create(null);
    packets.forEach(function(p){
      requestedIds[p.id]=true;
    });
    deletes.forEach(function(value){
      requestedIds[value]=true;
    });
    rows.forEach(function(row){
      if(requestedIds[String(row[0])]&&String(row[3]).replace(/^'/,'').trim()!==authorized.name)throw Error('Non puoi modificare o cancellare le serie di un altro allenatore.');
    });
    var athletes=roster_(ss);
    var tomb=ss.getSheetByName('_BiathlonDeleted');
    if(!tomb){
      tomb=ss.insertSheet('_BiathlonDeleted');
      tomb.getRange(1,1,1,2).setValues([['ID','DeletedAt']]);
      tomb.hideSheet();
    }
    var tombLast=tomb.getLastRow(),tombRows=tombLast>1?tomb.getRange(2,1,tombLast-1,1).getValues():[],deleted=Object.create(null);
    tombRows.forEach(function(row){
      deleted[String(row[0])]=true;
    });
    rows.forEach(function(row,index){
      var rid=String(row[0]);
      if(rid){
        existing[rid+'_'+row[7]]=index+2;
        if(String(row[14]).toUpperCase()==='TRUE')deleted[rid]=true;
      }
    });
    var newTombs=[];
    deletes.forEach(function(value){
      if(!deleted[value])newTombs.push([value,new Date().toISOString()]);
      deleted[value]=true;
    });
    // Persist tombstones first. A late/retried insert cannot resurrect a deleted series.
    writeRows_(tomb,tomb.getLastRow()+1,newTombs,2);
    SpreadsheetApp.flush();
    var deleteSet=Object.create(null);
    deletes.forEach(function(value){
      deleteSet[value]=true;
    });
    var ranges=[];
    rows.forEach(function(row,index){
      if(deleteSet[String(row[0])])ranges.push('O'+(index+2));
    });
    if(ranges.length)sheet.getRangeList(ranges).setValue('TRUE');
    var byId=Object.create(null),byName=Object.create(null);
    athletes.roster.forEach(function(a){
      byId[a.id]=a;
      byName[a.name.toLowerCase()]=a;
    });
    var newAthletes=[],toInsert=[];
    packets.forEach(function(p){
      if(deleted[p.id])return;
      var a=byId[p.athleteId]||byName[p.athlete.toLowerCase()];
      if(!a){
        a={
          id:p.athleteId||Utilities.getUuid(),name:p.athlete
        };
        newAthletes.push([cell_(a.name),'da_configurare@biathlon.local',cell_('Auto-creato dal campo ('+p.coach+')'),a.id]);
        byId[a.id]=a;
        byName[a.name.toLowerCase()]=a;
      }
      p.shots.forEach(function(s){
        var key=p.id+'_'+s.seq;
        if(existing[key])return;
        toInsert.push([p.id,p.localDate,cell_(p.type),cell_(p.coach),cell_(p.athlete),p.position,p.series,s.seq,s.x,s.y,s.distanza,s.esito,p.windDir,p.windInt,'FALSE',a.id,p.sessionId,p.timestamp]);
        existing[key]=true;
      });
    });
    writeRows_(athletes.sheet,athletes.sheet.getLastRow()+1,newAthletes,4);
    writeRows_(sheet,lastDataRow_(sheet)+1,toInsert,18);
    SpreadsheetApp.flush();
    return json_({
      status:'success',protocolVersion:2,coach:authorized.name,ack:{
        inserts:packets.map(function(p){
          return p.id;
        }),deletes:deletes
      }
    });
  }catch(error){
    return json_({
      status:'error',error:String(error.message||error)
    });
  }finally{
    if(lock&&lock.hasLock())lock.releaseLock();
  }
}
function doGet(e){
  var lock=null;
  try{
    var authorized=authorize_({
      token:e&&e.parameter?e.parameter.token:''
    });
    lock=LockService.getScriptLock();
    if(!lock.tryLock(15000))throw Error('Archivio occupato. Riprova.');
    var result=roster_(spreadsheet_());
    SpreadsheetApp.flush();
    return json_({
      status:'success',protocolVersion:2,coach:authorized.name,roster:result.roster
    });
  }catch(error){
    return json_({
      status:'error',error:String(error.message||error)
    });
  }finally{
    if(lock&&lock.hasLock())lock.releaseLock();
  }
}
function onOpen(){
  SpreadsheetApp.getUi().createMenu('Biathlon').addItem('Apri gestione allenatori','configuraBiathlon').addToUi();
}
/** Run once from the bound editor, after publishing the web app. Never called by HTTP handlers. */
function configuraBiathlon(){
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  if(!ss)throw Error('Apri questo progetto dal foglio Google: Estensioni → Apps Script.');
  var props=PropertiesService.getScriptProperties(),id=props.getProperty('BIATHLON_SPREADSHEET_ID');
  if(id&&id!==ss.getId())throw Error('Il progetto è già configurato per un altro foglio. Verifica BIATHLON_SPREADSHEET_ID.');
  var serviceUrl=ScriptApp.getService().getUrl();
  if(!serviceUrl||!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(serviceUrl))throw Error('Pubblica prima il progetto come web app, poi esegui nuovamente configuraBiathlon.');
  var lock=LockService.getScriptLock();
  if(!lock.tryLock(15000))throw Error('Archivio occupato. Riprova.');
  var token;
  try{
    props.setProperty('BIATHLON_SPREADSHEET_ID',ss.getId());
    token=props.getProperty('BIATHLON_ADMIN_TOKEN');
    if(!token){token=Utilities.getUuid()+Utilities.getUuid();props.setProperty('BIATHLON_ADMIN_TOKEN',token);}
    migrateCoachKeys_();
  }finally{lock.releaseLock();}
  var link='https://matfinco.github.io/BiathlonTracker/#gestione='+encodeURIComponent(JSON.stringify({v:1,url:serviceUrl,token:token}));
  var safe=link.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
  var html='<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="font:17px system-ui;padding:18px;line-height:1.5"><p>Apri questo collegamento sul tuo telefono o tablet per abilitare la gestione degli allenatori.</p><p><a target="_blank" rel="noreferrer noopener" href="'+safe+'">Apri l’app come amministratore</a></p><p>Collegamento riservato a te. Nell’app potrai creare quelli personali degli allenatori.</p><input aria-label="Collegamento amministratore" readonly style="width:100%;padding:10px;box-sizing:border-box" value="'+safe+'" onclick="this.select()"></body></html>';
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(html).setWidth(480).setHeight(340),'Configura Biathlon');
}
