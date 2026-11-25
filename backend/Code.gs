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
      return {name:records[i].name,id:records[i].id,admin:records[i].admin===true};
    }
  }
  // Existing personal keys remain valid until the administrator migrates them.
  var raw=props.getProperty('BIATHLON_COACH_KEYS'),keys=raw?JSON.parse(raw):{};
  if(Object.prototype.hasOwnProperty.call(keys,token)&&str_(keys[token],120))return {name:str_(keys[token],120),id:'',admin:false};
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
function isAdminToken_(data){
  var expected=PropertiesService.getScriptProperties().getProperty('BIATHLON_ADMIN_TOKEN');
  return Boolean(expected)&&String(data.token||'')===expected;
}
// Management is allowed with the recovery key or with the key of a coach marked as administrator
function adminActor_(data){
  if(isAdminToken_(data))return {master:true,id:''};
  var coach;
  try{coach=authorize_(data);}catch(error){coach=null;}
  if(!coach||!coach.admin)throw Error('Accesso amministratore non valido. Serve un allenatore amministratore o il collegamento di recupero del progetto Google.');
  return {master:false,id:coach.id};
}
function adminAction_(data){
  var actor=adminActor_(data);
  if(['admin.list','admin.create','admin.rotate','admin.revoke','admin.promote','admin.demote'].indexOf(data.action)<0)throw Error('Operazione amministratore non valida.');
  migrateCoachKeys_();
  if(data.action==='admin.create')createCoach_(data.name);
  if(['admin.rotate','admin.revoke','admin.promote','admin.demote'].indexOf(data.action)>=0){
    var id=identifier_(data.id),record=coachRecords_().filter(function(r){return r.id===id;})[0];
    if(!record)throw Error('Allenatore non trovato. Aggiorna l’elenco.');
    // An administrator cannot lock himself out from his own device
    if(record.id===actor.id&&(data.action==='admin.revoke'||data.action==='admin.demote'))throw Error('Non puoi revocare il tuo accesso o toglierti la gestione: chiedilo a un altro amministratore.');
    if(data.action==='admin.rotate'){
      record.token=Utilities.getUuid()+Utilities.getUuid();
      record.active=true;
    }else if(data.action==='admin.revoke')record.active=false;
    else record.admin=data.action==='admin.promote';
    record.updatedAt=new Date().toISOString();
    storeCoach_(record);
  }
  var coaches=coachRecords_().sort(function(a,b){return a.name.localeCompare(b.name);}).map(function(r){
    return {id:r.id,name:r.name,active:r.active,admin:r.admin===true,you:r.id===actor.id,createdAt:r.createdAt,updatedAt:r.updatedAt,keyHint:r.token.slice(-8),token:r.active?r.token:''};
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
/* Series index: one row per series, so writes never read every shot */
var BIATHLON_INDEX_SHEET='_BiathlonIndex',BIATHLON_INDEX_STATE='BIATHLON_INDEX_STATE';
var BIATHLON_INDEX_HEADERS=['ID','Allenatore','PrimaRiga','Righe','Eliminato'];
function indexSheet_(ss){
  var sheet=ss.getSheetByName(BIATHLON_INDEX_SHEET);
  if(!sheet){
    sheet=ss.insertSheet(BIATHLON_INDEX_SHEET);
    sheet.hideSheet();
  }
  return sheet;
}
function rebuildIndex_(ss,sheet,name){
  var idx=indexSheet_(ss),last=lastDataRow_(sheet),n=last-1,byId=Object.create(null),order=[];
  if(n>0){
    var ids=sheet.getRange(2,1,n,1).getValues(),coaches=sheet.getRange(2,4,n,1).getValues(),flags=sheet.getRange(2,15,n,1).getValues();
    for(var i=0;i<n;i++){
      var rid=String(ids[i][0]).trim();
      if(!rid)continue;
      var e=byId[rid];
      if(!e){
        e=byId[rid]={id:rid,coach:String(coaches[i][0]).replace(/^'/,'').trim(),first:i+2,last:i+2,deleted:false};
        order.push(e);
      }
      // A span with foreign rows inside fails verification and falls back to a scan
      e.last=i+2;
      if(String(flags[i][0]).toUpperCase()==='TRUE')e.deleted=true;
    }
  }
  idx.clearContents();
  var rows=[BIATHLON_INDEX_HEADERS].concat(order.map(function(e,k){
    e.indexRow=k+2;
    e.count=e.last-e.first+1;
    return [e.id,cell_(e.coach),e.first,e.count,e.deleted?'TRUE':'FALSE'];
  }));
  writeRows_(idx,1,rows,5);
  PropertiesService.getScriptProperties().setProperty(BIATHLON_INDEX_STATE,JSON.stringify({sheet:name,lastRow:last}));
  return {sheet:idx,byId:byId,lastRow:last,nextRow:order.length+2};
}
function seriesIndex_(ss,sheet,name){
  var raw=PropertiesService.getScriptProperties().getProperty(BIATHLON_INDEX_STATE),state=null;
  try{state=raw?JSON.parse(raw):null;}catch(error){state=null;}
  var idx=ss.getSheetByName(BIATHLON_INDEX_SHEET);
  var valid=Boolean(state&&idx&&state.sheet===name&&Number.isInteger(state.lastRow)&&state.lastRow>=1&&String(idx.getRange(1,1).getValue())==='ID');
  if(valid){
    // Rows added or removed by hand move the end of the data: rebuild in that case
    var probe=sheet.getRange(state.lastRow,1,2,1).getValues();
    valid=String(probe[0][0]).trim()!==''&&String(probe[1][0]).trim()==='';
  }
  if(!valid)return rebuildIndex_(ss,sheet,name);
  var last=idx.getLastRow(),rows=last>1?idx.getRange(2,1,last-1,5).getValues():[],byId=Object.create(null);
  rows.forEach(function(row,i){
    var rid=String(row[0]).trim();
    if(rid)byId[rid]={id:rid,coach:String(row[1]).replace(/^'/,'').trim(),first:Number(row[2]),count:Number(row[3]),deleted:String(row[4]).toUpperCase()==='TRUE',indexRow:i+2};
  });
  return {sheet:idx,byId:byId,lastRow:state.lastRow,nextRow:Math.max(2,last+1)};
}
// Rows of one series, verified by ID because the sheet may have been sorted by hand
function seriesRows_(sheet,entry){
  var result=[],i;
  if(entry.first>=2&&entry.count>=1){
    var values=sheet.getRange(entry.first,1,entry.count,1).getValues();
    if(values.every(function(v){return String(v[0])===entry.id;})){
      for(i=0;i<entry.count;i++)result.push(entry.first+i);
      return {rows:result,stale:false};
    }
  }
  var last=lastDataRow_(sheet),ids=last>1?sheet.getRange(2,1,last-1,1).getValues():[];
  for(i=0;i<ids.length;i++)if(String(ids[i][0])===entry.id)result.push(i+2);
  return {rows:result,stale:true};
}
var BIATHLON_ARCHIVE_PAGE=5000;
function isDate_(value){
  return Object.prototype.toString.call(value)==='[object Date]';
}
// Sheets may turn written dates into Date cells: send them back as text
function dayText_(value){
  if(isDate_(value))return Utilities.formatDate(value,Session.getScriptTimeZone(),'yyyy-MM-dd');
  return String(value==null?'':value).trim();
}
function timeText_(value){
  if(isDate_(value))return value.toISOString();
  return String(value==null?'':value).trim();
}
/* Shared archive for statistics: every authorized coach reads all series, page by page */
function archive_(ss,authorized,data){
  var name=databaseSheetName_(ss),sheet=database_(ss),index=seriesIndex_(ss,sheet,name),last=index.lastRow;
  var cursor=Number(data.cursor),reset=false;
  if(!Number.isInteger(cursor)||cursor<1)cursor=1;
  // The client remembers the ID of its last row: a sorted or shortened sheet restarts the download
  if(cursor>1&&(cursor>last||String(sheet.getRange(cursor,1).getValue())!==String(data.cursorId||''))){
    cursor=1;
    reset=true;
  }
  if(cursor===1&&Number(data.cursor)>1)reset=true;
  var end=Math.min(last,cursor+BIATHLON_ARCHIVE_PAGE),rows=[];
  if(end>cursor){
    rows=sheet.getRange(cursor+1,1,end-cursor,18).getValues().filter(function(r){return String(r[0]).trim();}).map(function(r){
      return [String(r[0]).trim(),dayText_(r[1]),String(r[2]),String(r[3]).replace(/^'/,''),String(r[4]).replace(/^'/,''),String(r[5]),String(r[6]),Number(r[7]),Number(r[8]),Number(r[9]),String(r[11]),String(r[12]),Number(r[13])||0,String(r[14]).toUpperCase()==='TRUE',String(r[15]||''),String(r[16]||''),timeText_(r[17])];
    });
  }
  var tomb=ss.getSheetByName('_BiathlonDeleted'),tombLast=tomb?tomb.getLastRow():1,tombCursor=Number(data.tombCursor),tombstones=[];
  if(!Number.isInteger(tombCursor)||tombCursor<1||tombCursor>tombLast||reset||cursor===1)tombCursor=1;
  if(tomb&&tombLast>tombCursor)tombstones=tomb.getRange(tombCursor+1,1,tombLast-tombCursor,1).getValues().map(function(r){return String(r[0]);}).filter(String);
  return json_({
    status:'success',protocolVersion:2,coach:authorized.name,admin:authorized.admin===true,reset:reset,rows:rows,
    cursor:end,cursorId:end>1?String(sheet.getRange(end,1).getValue()):'',done:end>=last,
    tombstones:tombstones,tombCursor:Math.max(1,tombLast)
  });
}
/** Run from the editor after editing the shots tab by hand: the next request rebuilds the index */
function ricostruisciIndiceBiathlon(){
  PropertiesService.getScriptProperties().deleteProperty(BIATHLON_INDEX_STATE);
}
function databaseSheetName_(ss){
  var name=PropertiesService.getScriptProperties().getProperty('BIATHLON_DATABASE_SHEET');
  if(!name)name=ss.getSheetByName('Database_Colpi')?'Database_Colpi':'Database';
  if(!ss.getSheetByName(name))throw Error('Tab '+name+' non trovato. Usa Database_Colpi o Database, oppure configura BIATHLON_DATABASE_SHEET.');
  return name;
}
function database_(ss){
  var name=databaseSheetName_(ss),sheet=ss.getSheetByName(name);
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
    // Statistics are readable with any verified access: coach key or administrator key
    if(data.action==='archive'&&isAdminToken_(data))return archive_(spreadsheet_(),{name:''},data);
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
    if(data.action==='connection')return json_({
      status:'success',protocolVersion:2,coach:authorized.name,admin:authorized.admin,databaseSheet:databaseSheetName_(ss)
    });
    if(data.action==='roster'){
      var listed=roster_(ss);
      SpreadsheetApp.flush();
      return json_({
        status:'success',protocolVersion:2,coach:authorized.name,admin:authorized.admin,roster:listed.roster
      });
    }
    if(data.action==='archive')return archive_(ss,authorized,data);
    var sheetName=databaseSheetName_(ss),sheet=database_(ss),index=seriesIndex_(ss,sheet,sheetName);
    packets.concat(deletes.map(function(value){return {id:value};})).forEach(function(p){
      var entry=index.byId[p.id];
      if(entry&&entry.coach!==authorized.name)throw Error('Non puoi modificare o cancellare le serie di un altro allenatore.');
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
    Object.keys(index.byId).forEach(function(rid){
      if(index.byId[rid].deleted)deleted[rid]=true;
    });
    var newTombs=[];
    deletes.forEach(function(value){
      if(!deleted[value])newTombs.push([value,new Date().toISOString()]);
    });
    // Persist tombstones first. A late/retried insert cannot resurrect a deleted series.
    writeRows_(tomb,tomb.getLastRow()+1,newTombs,2);
    SpreadsheetApp.flush();
    var ranges=[],stale=false,flagged=Object.create(null);
    deletes.forEach(function(value){
      var entry=index.byId[value];
      // Already flagged series need no write: the request is idempotent
      if(!entry||entry.deleted||flagged[value])return;
      var found=seriesRows_(sheet,entry);
      if(found.stale)stale=true;
      found.rows.forEach(function(row){ranges.push('O'+row);});
      if(!stale)index.sheet.getRange(entry.indexRow,5).setValue('TRUE');
      flagged[value]=true;
    });
    if(ranges.length)sheet.getRangeList(ranges).setValue('TRUE');
    deletes.forEach(function(value){
      deleted[value]=true;
    });
    var byId=Object.create(null),byName=Object.create(null);
    athletes.roster.forEach(function(a){
      byId[a.id]=a;
      byName[a.name.toLowerCase()]=a;
    });
    var newAthletes=[],toInsert=[],newEntries=[],start=index.lastRow+1;
    packets.forEach(function(p){
      // All shots of a series are written together, so a known ID is already complete
      if(deleted[p.id]||index.byId[p.id])return;
      var a=byId[p.athleteId]||byName[p.athlete.toLowerCase()];
      if(!a){
        a={
          id:p.athleteId||Utilities.getUuid(),name:p.athlete
        };
        newAthletes.push([cell_(a.name),'da_configurare@biathlon.local',cell_('Auto-creato dal campo ('+p.coach+')'),a.id]);
        byId[a.id]=a;
        byName[a.name.toLowerCase()]=a;
      }
      newEntries.push([p.id,cell_(p.coach),start+toInsert.length,p.shots.length,'FALSE']);
      p.shots.forEach(function(s){
        toInsert.push([p.id,p.localDate,cell_(p.type),cell_(p.coach),cell_(p.athlete),p.position,p.series,s.seq,s.x,s.y,s.distanza,s.esito,p.windDir,p.windInt,'FALSE',a.id,p.sessionId,p.timestamp]);
      });
      index.byId[p.id]={id:p.id,coach:p.coach};
    });
    writeRows_(athletes.sheet,athletes.sheet.getLastRow()+1,newAthletes,4);
    writeRows_(sheet,start,toInsert,18);
    // Index rows before the state property: a crash in between only causes a rebuild
    if(stale)rebuildIndex_(ss,sheet,sheetName);
    else if(toInsert.length){
      writeRows_(index.sheet,index.nextRow,newEntries,5);
      PropertiesService.getScriptProperties().setProperty(BIATHLON_INDEX_STATE,JSON.stringify({sheet:sheetName,lastRow:start+toInsert.length-1}));
    }
    SpreadsheetApp.flush();
    return json_({
      status:'success',protocolVersion:2,coach:authorized.name,admin:authorized.admin,ack:{
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
  SpreadsheetApp.getUi().createMenu('Biathlon').addItem('Apri gestione allenatori','configuraBiathlon').addItem('Scegli indirizzo del servizio','scegliServizioBiathlon').addItem('Ricostruisci indice serie','ricostruisciIndiceBiathlon').addToUi();
}
function normalizeServiceUrl_(value){
  var url=String(value||'').trim();
  // Google can include the signed-in account or Workspace domain in its URL.
  var match=/^https:\/\/script\.google\.com\/(?:macros\/(?:u\/\d+\/)?s|a\/(?:macros\/[^/?#]+|[^/?#]+\/macros)\/s)\/([A-Za-z0-9_-]+)\/exec\/?(?:\?[^#\s]*)?(?:#[^\s]*)?$/.exec(url);
  return match?'https://script.google.com/macros/s/'+match[1]+'/exec':'';
}
function deploymentUrl_(choose){
  var props=PropertiesService.getScriptProperties(),url=normalizeServiceUrl_(props.getProperty('BIATHLON_SERVICE_URL'));
  if(!choose&&url)return url;
  if(!choose){
    try{url=normalizeServiceUrl_(ScriptApp.getService().getUrl());}catch(error){url='';}
    if(url)return url;
  }
  var ui=SpreadsheetApp.getUi();
  var result=ui.prompt('Collega la web app Google','Incolla l’indirizzo dell’Applicazione web che trovi in Esegui deployment → Gestisci deployment, nello stesso progetto. Deve terminare con /exec. Questa finestra compare nel foglio Google.',ui.ButtonSet.OK_CANCEL);
  if(result.getSelectedButton()!==ui.Button.OK)return '';
  url=normalizeServiceUrl_(result.getResponseText());
  if(!url)throw Error('Indirizzo non riconosciuto. Riesegui la configurazione e incolla l’URL HTTPS dell’Applicazione web Google che termina con /exec.');
  return url;
}
function scegliServizioBiathlon(){
  configuraBiathlon(true);
}
/** Run once from the bound editor, after publishing the web app. Never called by HTTP handlers. */
function configuraBiathlon(choose){
  var ss=SpreadsheetApp.getActiveSpreadsheet();
  if(!ss)throw Error('Apri questo progetto dal foglio Google: Estensioni → Apps Script.');
  var props=PropertiesService.getScriptProperties(),id=props.getProperty('BIATHLON_SPREADSHEET_ID');
  if(id&&id!==ss.getId())throw Error('Il progetto è già configurato per un altro foglio. Verifica BIATHLON_SPREADSHEET_ID.');
  var serviceUrl=deploymentUrl_(choose===true);
  if(!serviceUrl)return;
  var lock=LockService.getScriptLock();
  if(!lock.tryLock(15000))throw Error('Archivio occupato. Riprova.');
  var token;
  try{
    props.setProperty('BIATHLON_SPREADSHEET_ID',ss.getId());
    props.setProperty('BIATHLON_SERVICE_URL',serviceUrl);
    token=props.getProperty('BIATHLON_ADMIN_TOKEN');
    if(!token){token=Utilities.getUuid()+Utilities.getUuid();props.setProperty('BIATHLON_ADMIN_TOKEN',token);}
    migrateCoachKeys_();
  }finally{lock.releaseLock();}
  var link='https://matfinco.github.io/BiathlonTracker/#gestione='+encodeURIComponent(JSON.stringify({v:1,url:serviceUrl,token:token}));
  var safe=link.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
  var html='<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="font:17px system-ui;padding:18px;line-height:1.5"><p>Apri questo collegamento sul tuo telefono o tablet per abilitare la gestione degli allenatori.</p><p><a target="_blank" rel="noreferrer noopener" href="'+safe+'">Apri l’app come amministratore</a></p><p>Collegamento riservato a te. Nell’app potrai creare quelli personali degli allenatori.</p><input aria-label="Collegamento amministratore" readonly style="width:100%;padding:10px;box-sizing:border-box" value="'+safe+'" onclick="this.select()"></body></html>';
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(html).setWidth(480).setHeight(340),'Configura Biathlon');
}
