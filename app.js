'use strict';
(() => {
  // Keep v1 key to preserve all existing data when upgrading from v6.
  const STORAGE_KEY = 'pointage39h.v1';
  const LOCAL_MIRROR_KEY = 'pointage39h.v1.backupV13';
  const IDB_NAME = 'charriaut-heures-secours-v1';
  const IDB_STORE = 'copies';
  let writeProblem = false;
  let pendingMirror;
  let idbTail = Promise.resolve();
  const WEEKDAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
  const LONG_DAYS = ['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'];
  const MONTHS = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
  const GOALS = [480,480,480,480,420,0,0];
  const FIELD_LIST = [
    {key:'start', title:'Embauche',icon:'↗'},
    {key:'end', title:'Débauche',icon:'✓'}
  ];
  const $ = id => document.getElementById(id);
  const esc = (str) => String(str ?? '').replace(/[&<>"']/g, ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const pad = n => String(n).padStart(2,'0');
  const minutes = val => /^\d\d:\d\d$/.test(val || '') ? Number(val.slice(0,2))*60+Number(val.slice(3,5)) : null;
  const clock = n => `${pad(Math.floor(n / 60))}:${pad(n % 60)}`;
  const duration = (n) => n == null || !Number.isFinite(n) ? '—' : `${n < 0 ? '-' : ''}${Math.floor(Math.abs(n)/60)}h${pad(Math.abs(n)%60)}`;
  const signed = n => n == null ? '—' : `${n > 0 ? '+' : n < 0 ? '−' : ''}${duration(Math.abs(n))}`;
  const dateKey = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const dateFromKey = key => new Date(`${key}T12:00:00`);
  const plusDays = (d,n) => {const x=new Date(d);x.setDate(x.getDate()+n);return x;};
  const monday = d => {const x=new Date(d);x.setHours(12,0,0,0);x.setDate(x.getDate() - ((x.getDay()+6)%7));return x;};
  const mondayOfKey = key => dateKey(monday(dateFromKey(key)));
  const weekdayIndex = key => (dateFromKey(key).getDay()+6)%7;
  let todayKey = dateKey(new Date());
  const timeNow = () => {const d=new Date();return `${pad(d.getHours())}:${pad(d.getMinutes())}`;};
  // Saisie libre au clavier numérique (sans roulette iOS).
  // Exemples : 0800, 800, 16:20, 17h30 -> HH:MM.
  function normalizeManualTime(value){
    const text=String(value??'').trim().replace(/\s+/g,'').replace(/[hH.]/g,':');
    if(!text)return '';
    let hour,minute;
    if(/^\d{1,2}:\d{1,2}$/.test(text)){
      [hour,minute]=text.split(':').map(Number);
    }else if(/^\d{1,4}$/.test(text)){
      if(text.length<=2){hour=Number(text);minute=0;}
      else {hour=Number(text.slice(0,-2));minute=Number(text.slice(-2));}
    }else return null;
    return hour>=0&&hour<=23&&minute>=0&&minute<=59?`${pad(hour)}:${pad(minute)}`:null;
  }
  function manualTimeMarkup(field,value,attributes=''){
    return `<input class="manual-time-input" type="text" inputmode="numeric" enterkeyhint="done" maxlength="5" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="HHMM" ${attributes} value="${esc(value||'')}">`;
  }
  function bindManualTimeInputs(container,fieldAttribute){
    container.querySelectorAll(`[${fieldAttribute}]`).forEach(input=>{
      input.addEventListener('focus',()=>{
        // L'heure existante est sélectionnée pour pouvoir la remplacer en une saisie.
        input.select();
      });
      input.addEventListener('input',()=>{
        input.classList.remove('manual-time-invalid');
        input.removeAttribute('aria-invalid');
      });
      input.addEventListener('keydown',event=>{
        if(event.key==='Enter'){
          event.preventDefault();
          input.blur();
        }
      });
      input.addEventListener('blur',()=>{
        const parsed=normalizeManualTime(input.value);
        if(parsed===null){
          input.classList.add('manual-time-invalid');
          input.setAttribute('aria-invalid','true');
          toast('Heure invalide. Tape 4 chiffres, par exemple 0830.');
          return;
        }
        const field=input.getAttribute(fieldAttribute);
        input.value=parsed;
        if(parsed!==getDay(selected)[field]){
          // Sauvegarder sans reconstruire immédiatement les champs : sinon un clic
          // sur la seconde heure pourrait faire disparaître son clavier.
          const dayKey=selected;
          const existing=getDay(dayKey);
          logChange(dayKey,field,existing[field],parsed);
          state.days[dayKey]={...existing,[field]:parsed};
          const persisted=save();
          if(persisted)toast(parsed?`Heure enregistrée : ${parsed} ✓`:'Heure effacée ✓');
          setTimeout(()=>{
            if(selected!==dayKey)return;
            // L'autre horaire est en cours de saisie : ne pas lui voler le focus.
            if(document.activeElement?.matches('.manual-time-input'))return;
            render();
          },80);
        }
      });
    });
  }

  const blank = () => ({start:'',lunchOut:'',lunchIn:'',end:'',breakPlan:'',breakMode:'duration',breakMinutes:null,noBreak:false,note:'',off:false,meal:null,locations:{}});
  const defaults = () => ({version:1,settings:{name:'',firstName:'',lastName:'',employeeEmail:'',recipient:'contact@charriaut.fr',lastBackupAt:''},days:{},audit:{},leaves:[],vehicleChecks:{}});
  function validState(raw) {
    try {
      const obj=typeof raw==='string'?JSON.parse(raw):raw;
      if(!obj || obj.version!==1 || !obj.days || Array.isArray(obj.days) || typeof obj.days!=='object')return null;
      return {...defaults(), ...obj, settings:{...defaults().settings,...obj.settings},
        audit:obj.audit&&typeof obj.audit==='object'?obj.audit:{},
        leaves:Array.isArray(obj.leaves)?obj.leaves:[],
        vehicleChecks:obj.vehicleChecks&&typeof obj.vehicleChecks==='object'&&!Array.isArray(obj.vehicleChecks)?obj.vehicleChecks:{}};
    }catch(error){return null;}
  }
  function load() {
    try {
      const principal=validState(localStorage.getItem(STORAGE_KEY));
      if(principal)return principal;
      const reserve=validState(localStorage.getItem(LOCAL_MIRROR_KEY));
      if(reserve){
        try{localStorage.setItem(STORAGE_KEY,JSON.stringify(reserve));}catch(error){}
        return reserve;
      }
    } catch(error){console.warn('Lecture du stockage impossible',error);}
    return defaults();
  }
  function idbOpen(){
    return new Promise((resolve,reject)=>{
      if(!('indexedDB' in window)){reject(Error('IndexedDB indisponible'));return;}
      const req=indexedDB.open(IDB_NAME,1);
      req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(IDB_STORE))req.result.createObjectStore(IDB_STORE);};
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error||Error('IndexedDB'));
    });
  }
  async function idbRead(){
    const db=await idbOpen();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(IDB_STORE,'readonly');
      const req=tx.objectStore(IDB_STORE).get('dernier');
      req.onsuccess=()=>resolve(req.result||null);
      req.onerror=()=>reject(req.error||Error('Lecture secours'));
      tx.oncomplete=()=>db.close();
      tx.onerror=()=>db.close();
    });
  }
  async function idbWrite(json){
    const db=await idbOpen();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(IDB_STORE,'readwrite');
      tx.objectStore(IDB_STORE).put(json,'dernier');
      tx.oncomplete=()=>{db.close();resolve(true);};
      tx.onerror=()=>{db.close();reject(tx.error||Error('Écriture secours'));};
      tx.onabort=()=>{db.close();reject(tx.error||Error('Annulation secours'));};
    });
  }
  function mirrorToIndexedDB(json){
    clearTimeout(pendingMirror);
    pendingMirror=setTimeout(()=>{
      idbTail=idbTail.catch(()=>{}).then(()=>idbWrite(json)).catch(()=>{});
    },180);
  }

  let state=load();
  let activeWeek=mondayOfKey(todayKey);
  let selected=todayKey;
  let archiveMonth=todayKey.slice(0,7);
  let reportMonth=todayKey.slice(0,7);
  const profileName=()=>[state.settings.firstName,state.settings.lastName].filter(Boolean).join(' ')||state.settings.name||'';
  const monthPeriod=()=>{const keys=Array.from({length:7},(_,i)=>dateKey(plusDays(dateFromKey(activeWeek),i)));return [...new Set(keys.map(k=>{const d=dateFromKey(k);return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;}))].join(' / ');};
  const formatStamp=iso=>{const d=new Date(iso);return Number.isFinite(d.getTime())?`${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()} à ${pad(d.getHours())}:${pad(d.getMinutes())}`:'—';};
  let toastTimeout;
  function updateSaveStatus(ok=true){
    const el=$('saveStatus'),inline=$('backupInlineStatus');
    const txt=ok?`✓ Enregistré sur ce téléphone · ${state.savedAt?formatStamp(state.savedAt):'données locales'}`:
      '⚠ Enregistrement non confirmé. Exporte immédiatement une copie et vérifie l’espace disponible.';
    if(el){el.textContent=txt;el.classList.toggle('save-error',!ok);}
    if(inline){inline.textContent=ok?'✓ Pointages mémorisés sur cet appareil. Dernier enregistrement : '+(state.savedAt?formatStamp(state.savedAt):'aucun')+'.':'⚠ Enregistrement impossible : réalise une sauvegarde et libère de l’espace.';inline.classList.toggle('save-error',!ok);}
  }
  function save(){
    try{
      state.savedAt=new Date().toISOString();
      const json=JSON.stringify(state);
      localStorage.setItem(STORAGE_KEY,json);
      if(localStorage.getItem(STORAGE_KEY)!==json)throw Error('La lecture de confirmation a échoué');
      // Copie locale indépendante de la clé principale, utile en cas de contenu corrompu.
      try{localStorage.setItem(LOCAL_MIRROR_KEY,json);}catch(error){}
      mirrorToIndexedDB(json); // copie dans IndexedDB lorsque le système l'autorise.
      writeProblem=false;
      updateSaveStatus(true);
      return true;
    }catch(error){
      writeProblem=true;
      updateSaveStatus(false);
      toast('⚠ Pointage non enregistré sur le téléphone. Fais une sauvegarde.');
      console.warn('Erreur d’enregistrement',error);
      return false;
    }
  }
  function toast(message) {
    const element=$('toast');element.textContent=message;element.classList.add('show');
    clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>element.classList.remove('show'),3900);
  }
  function getDay(key){
    const stored=state.days[key];
    // Existing days had manual lunch stamps. Keep their original calculation until
    // the employee explicitly switches that day to the new duration-based entry.
    if(!stored)return blank();
    // Les anciens jours saisis à 0 minute restent à 0 minute après mise à jour.
    if(stored.noBreak&&!stored.breakMode)return {...blank(),...stored,breakMode:'duration',breakPlan:'custom',breakMinutes:0};
    return {...blank(),...stored,breakMode:stored.breakMode||'legacy',breakMinutes:stored.breakMode==='duration'?stored.breakMinutes:null};
  }
  const AUDIT_LABELS={start:'Embauche matin',lunchOut:'Débauche midi',lunchIn:'Reprise après-midi',end:'Débauche soir',breakMinutes:'Durée de pause (minutes)',breakMode:'Mode de saisie du midi',meal:'Panier repas'};
  function logChange(dayKey,field,previous,current){
    if(previous===current)return;
    const record={at:new Date().toISOString(),field,previous:String(previous||''),current:String(current||'')};
    if(!Array.isArray(state.audit[dayKey]))state.audit[dayKey]=[];
    state.audit[dayKey].push(record);
    if(state.audit[dayKey].length>80)state.audit[dayKey]=state.audit[dayKey].slice(-80);
  }
  function setDay(key,values){
    const before=getDay(key);
    for(const field of Object.keys(AUDIT_LABELS)){
      if(Object.hasOwn(values,field)&&values[field]!==before[field])logChange(key,field,before[field],values[field]);
    }
    state.days[key]={...before,...values};const persisted=save();render();return persisted;
  }
  function leaveOn(key){return state.leaves.find(l=>l && (l.type==='CP'||l.type==='RTT') && l.start<=key && l.end>=key)||null;}
  function leaveLabel(type){return type==='RTT'?'RTT':'Congés payés';}
  function dayLeaveName(key){const l=leaveOn(key);return l?leaveLabel(l.type):'';}
  function hasRecordedData(d){return !!(d.start||d.lunchOut||d.lunchIn||d.end||d.note||d.off||d.meal!==null&&d.meal!==undefined||(d.breakMode==='duration'&&d.breakMinutes!==null));}
  function editDate(key){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(key)||!Number.isFinite(dateFromKey(key).getTime()))return;
    selected=key;activeWeek=mondayOfKey(key);archiveMonth=key.slice(0,7);reportMonth=key.slice(0,7);
    render();$('todayCard').scrollIntoView({behavior:'smooth',block:'start'});
    toast('Date ouverte : touche une heure pour la corriger.');
  }
  function renderArchive(){
    const [yy,mm]=archiveMonth.split('-').map(Number);
    $('archiveLabel').textContent=`${MONTHS[mm-1].charAt(0).toUpperCase()+MONTHS[mm-1].slice(1)} ${yy}`;
    const [archiveYear,archiveM]=archiveMonth.split('-').map(Number);const archiveEnd=new Date(archiveYear,archiveM,0).getDate();
    const keys=Array.from({length:archiveEnd},(_,i)=>`${archiveMonth}-${pad(i+1)}`).filter(k=>hasRecordedData(getDay(k))||!!leaveOn(k)).sort().reverse();
    $('archiveCount').textContent=keys.length?`${keys.length} journée${keys.length>1?'s':''} enregistrée${keys.length>1?'s':''}`:'Aucune journée enregistrée';
    $('archiveList').innerHTML=keys.length?keys.map(key=>{
      const d=getDay(key),c=compute(key),dt=dateFromKey(key),a=(state.audit[key]||[]);
      const corrections=a.filter(e=>e.previous).length;
      const shown=c.off?(c.leaveType?leaveLabel(c.leaveType):'Non travaillée'):c.complete?duration(c.actual):'À compléter';
      const head=`${LONG_DAYS[dt.getDay()].charAt(0).toUpperCase()+LONG_DAYS[dt.getDay()].slice(1)} ${dt.getDate()}`;
      return `<button type="button" class="archive-entry" data-edit-date="${key}"><span class="archive-date">${head}<small>${esc(key)}</small></span><span class="archive-times">${esc(d.start||'--:--')} → ${esc(d.end||'--:--')}<small>${shown}${corrections?' · ✎ Corrigé':''}</small></span><span class="archive-edit">Modifier ›</span></button>`;
    }).join(''):'<div class="archive-empty">Aucun pointage pour ce mois. Utilise « Aller à une date » pour en ajouter un.</div>';
    $('archiveList').querySelectorAll('[data-edit-date]').forEach(el=>el.addEventListener('click',()=>editDate(el.dataset.editDate)));
  }
  function addMonth(month,amount){const [y,m]=month.split('-').map(Number),v=new Date(y,m-1+amount,1);return `${v.getFullYear()}-${pad(v.getMonth()+1)}`;}

  // Seules l'embauche du matin et la débauche du soir demandent un lieu.
  // Les lieux historiques du midi, s'ils existent, sont ignorés mais conservés en sauvegarde.
  const LOCATION_FIELDS=['start','end'];
  const needsLocation=field=>LOCATION_FIELDS.includes(field);
  const EMPTY_LOCATION=()=>({type:'',site:''});
  function getLocation(d,field){
    const raw=d.locations && d.locations[field];
    return {type:raw?.type==='bureau'||raw?.type==='client'?raw.type:'',site:typeof raw?.site==='string'?raw.site:''};
  }
  function locationReady(loc){return loc.type==='bureau'||(loc.type==='client'&&!!loc.site.trim());}
  function locationLabel(loc){return loc.type==='bureau'?'BUREAU':loc.type==='client'?`Chez le client – ${loc.site.trim()||'lieu à renseigner'}`:'Lieu non renseigné';}
  function trackedFields(d){return d.off?[]:FIELD_LIST.filter(f=>needsLocation(f.key) && !!d[f.key]);}
  function missingLocations(w){return w.rows.flatMap(r=>trackedFields(r.d).filter(f=>!locationReady(getLocation(r.d,f.key))).map(f=>`${WEEKDAYS[r.day]} : ${f.title.toLowerCase()}`));}
  function previousLocation(d,field){
    const index=FIELD_LIST.findIndex(f=>f.key===field);
    for(let i=index-1;i>=0;i--){
      const f=FIELD_LIST[i];
      if(!needsLocation(f.key))continue;
      const loc=getLocation(d,f.key);
      if(locationReady(loc))return loc;
    }
    return null;
  }
  function updateLocationReminder(d){
    const missingToday=trackedFields(d).filter(f=>!locationReady(getLocation(d,f.key)));
    $('locationReminder').textContent=missingToday.length?`📍 ${missingToday.length} lieu${missingToday.length>1?'x':''} de pointage à compléter pour ce jour.`:'';
    $('locationReminder').hidden=!missingToday.length;
  }
  function clientHistory(){
    const names=[];
    Object.values(state.days).forEach(d=>FIELD_LIST.filter(f=>needsLocation(f.key)).forEach(f=>{
      const loc=getLocation(d,f.key);const n=loc.site.trim();
      if(loc.type==='client'&&n&&!names.some(x=>x.toLowerCase()===n.toLowerCase()))names.push(n);
    }));
    return names.slice(-40).reverse();
  }
  function setLocation(field,type,site){
    const d=getDay(selected),old=getLocation(d,field);
    const next={type,site:site===undefined?old.site:site};
    setDay(selected,{locations:{...d.locations,[field]:next}});
  }
  function saveClientWhileTyping(field,value){
    const d=getDay(selected);state.days[selected]={...d,locations:{...d.locations,[field]:{type:'client',site:value.slice(0,160)}}};save();
  }
  function compute(key){
    const d=getDay(key);
    const goal=GOALS[weekdayIndex(key)];
    const leave=leaveOn(key);
    if(leave)return {off:true,leaveType:leave.type,complete:true,goal:0,actual:0,credit:0,effective:0,pause:null,delta:null,invalid:false};
    if(d.off)return {off:true,complete:true,goal:0,actual:0,credit:0,effective:0,pause:null,delta:null,invalid:false};
    const start=minutes(d.start),end=minutes(d.end),out=minutes(d.lunchOut),back=minutes(d.lunchIn);
    let complete=false,invalid=false,actual=null,pause=null;
    if(d.noBreak && (d.breakMode==='legacy'||d.breakMinutes===0)){
      complete=start!=null&&end!=null;
      if(complete){invalid=end<=start;if(!invalid){actual=end-start;pause=0;}}
    }else if(d.breakMode==='legacy'){
      complete=[start,out,back,end].every(v=>v!=null);
      if(complete){invalid=out<=start || back<out || end<=back;if(!invalid){actual=(out-start)+(end-back);pause=back-out;}}
    }else{
      // The employee supplies the actual break duration; no fictional lunch clock times.
      const choice=d.breakMinutes;
      const validBreak=Number.isInteger(choice)&&choice>=0&&choice<=600;
      complete=start!=null&&end!=null&&validBreak;
      if(complete){pause=choice;invalid=end<=start||pause>=end-start;if(!invalid)actual=end-start-pause;}
    }
    // Le relevé conserve uniquement l’heure de départ réellement saisie.
    const credit=0;
    return {off:false,complete:complete&&!invalid,goal,actual,credit,effective:actual,pause,delta:actual==null?null:actual-goal,invalid};
  }
  function weekData(startWeek=activeWeek){
    const rows=Array.from({length:7},(_,i)=>{const key=dateKey(plusDays(dateFromKey(startWeek),i));return {key,d:getDay(key),calc:compute(key),day:i};});
    const completeRows=rows.filter(x=>x.calc.complete&&!x.calc.off);
    const actual=completeRows.reduce((sum,x)=>sum+x.calc.actual,0);
    const credit=0;
    const effective=actual;
    const comparedGoal=rows.slice(0,5).filter(x=>x.calc.complete&&!x.calc.off).reduce((sum,x)=>sum+x.calc.goal,0);
    const weeklyReference=rows.slice(0,5).reduce((sum,x)=>sum+(x.calc.off?0:GOALS[x.day]),0);
    const gap=effective-weeklyReference;
    const allWeekdaysDone=rows.slice(0,5).every(x=>x.calc.complete);
    const anyOff=rows.slice(0,5).some(x=>x.calc.off);
    return {rows,actual,credit,effective,comparedGoal,weeklyReference,gap,allWeekdaysDone,anyOff,extra:allWeekdaysDone?Math.max(0,effective-2340):null};
  }
  function dateRange(){
    const a=dateFromKey(activeWeek),b=plusDays(a,6);
    return `${a.getDate()} ${a.getMonth()===b.getMonth()?'':MONTHS[a.getMonth()]+' '}– ${b.getDate()} ${MONTHS[b.getMonth()]}`;
  }
  function isoWeek(d){const t=new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate()));t.setUTCDate(t.getUTCDate()+4-(t.getUTCDay()||7));const yearStart=new Date(Date.UTC(t.getUTCFullYear(),0,1));return 1+Math.ceil(((t-yearStart)/86400000+1)/7);}
  function render(){
    const week=weekData();
    $('helloName').textContent=profileName()? (state.settings.firstName||profileName().split(/\s+/)[0])+' 👋':'👋';
    $('profileStatus').textContent=profileName()||'Renseigner mon identité';
    $('profileStatus').title=state.settings.employeeEmail||'Profil incomplet';
    updateBackupDisplay();
    $('weekActual').textContent=duration(week.actual);
    $('progressBar').style.width=`${Math.min(100,week.actual/2340*100)}%`;
    $('progressRail').setAttribute('aria-valuenow',String(Math.min(39,Math.round(week.actual/60*10)/10)));
    $('weekRange').textContent=dateRange();
    $('weekNumber').textContent=`Semaine ${isoWeek(dateFromKey(activeWeek))} • ${dateFromKey(activeWeek).getFullYear()}`;
    $('sumWeek').textContent=dateRange();
    renderDays(week);renderSelectedDay();renderSummary(week);renderArchive();renderMonthSummary();renderLeaves();renderReminder();
  }
  function renderDays(week){
    $('dayStrip').innerHTML=week.rows.map((row,i)=>{
      const date=dateFromKey(row.key),isSelected=selected===row.key,isToday=row.key===todayKey;
      return `<button type="button" class="day-btn ${isSelected?'selected':''}" data-date="${row.key}" aria-label="${LONG_DAYS[date.getDay()]} ${date.getDate()}${isToday?', aujourd’hui':''}" aria-pressed="${isSelected}"><span class="weekday">${WEEKDAYS[i]}${isToday?' •':''}</span><span class="daynum">${date.getDate()}</span>${row.calc.complete?'<span class="dot"></span>':''}</button>`;
    }).join('');
    $('dayStrip').querySelectorAll('[data-date]').forEach(btn=>btn.addEventListener('click',()=>{selected=btn.dataset.date;render();}));
  }
  function renderSelectedDay(){
    const d=getDay(selected),c=compute(selected),dt=dateFromKey(selected);
    const isLeave=!!c.leaveType,disabledDay=d.off||isLeave;
    $('selectedTitle').textContent=`${LONG_DAYS[dt.getDay()].slice(0,1).toUpperCase()+LONG_DAYS[dt.getDay()].slice(1)} ${dt.getDate()} ${MONTHS[dt.getMonth()]}`;
    const pill=$('dayState');
    pill.className='pill'+(c.complete?'':c.invalid?' warn':' waiting');
    pill.textContent=isLeave?leaveLabel(c.leaveType):d.off?'Repos / absence':c.invalid?'Horaires à corriger':c.complete?'Journée complète':'À compléter';
    $('clientSuggestions').innerHTML=clientHistory().map(n=>`<option value="${esc(n)}"></option>`).join('');
    $('pointGrid').innerHTML=FIELD_LIST.map(item=>{
      const isStart=item.key==='start';
      return `<div class="point-card ${isStart?'point-start':'point-end'} ${disabledDay?'disabled':''}" data-point-card="${item.key}">
        <button type="button" class="now-btn" data-now="${item.key}" ${disabledDay?'disabled':''}>
          <span class="tap-icon" aria-hidden="true">${isStart?'◷':'■'}</span>
          <span class="tap-label">${item.title}</span>
          <span class="tap-time">${esc(d[item.key]||'Appuyer pour pointer')}</span>
        </button>
        <label class="time-edit-label">${d[item.key]?'Modifier l’heure au clavier':'Saisir l’heure au clavier'}
          ${manualTimeMarkup(item.key,d[item.key],`aria-label="Heure de ${item.title} au clavier, par exemple 0830" data-field="${item.key}" ${disabledDay?'disabled':''}`)}</label>
      </div>`;
    }).join('');
    $('locationGrid').innerHTML=FIELD_LIST.map(item=>{
      const loc=getLocation(d,item.key);
      const reuse=!!previousLocation(d,item.key)&&!locationReady(loc)&&!disabledDay;
      const missing=!!d[item.key]&&!locationReady(loc);
      return `<section class="point-card location-card ${disabledDay?'disabled':''}" data-point-card="${item.key}">
        <h2 class="feature-heading"><span aria-hidden="true">●</span> Lieu ${item.key==='start'?'embauche':'débauche'} ${missing?'<small class="location-required">À renseigner</small>':''}</h2>
        <div class="location-actions" role="group" aria-label="Lieu de ${item.title}">
          <button type="button" class="location-choice ${loc.type==='bureau'?'active':''}" data-place="bureau" data-point="${item.key}" aria-pressed="${loc.type==='bureau'}" ${disabledDay?'disabled':''}>▥ &nbsp; Bureau</button>
          <button type="button" class="location-choice ${loc.type==='client'?'active':''}" data-place="client" data-point="${item.key}" aria-pressed="${loc.type==='client'}" ${disabledDay?'disabled':''}>● &nbsp; Client</button>
        </div>
        ${loc.type==='client'?`<input class="client-site ${missing?'site-missing':''}" type="text" data-site="${item.key}" maxlength="160" autocomplete="off" list="clientSuggestions" aria-label="Commune ou adresse du client pour ${item.title}" placeholder="Commune ou adresse du chantier" value="${esc(loc.site)}" ${disabledDay?'disabled':''}>`:''}
        ${reuse?`<button type="button" class="copy-location" data-copy-place="${item.key}">↳ Même lieu qu’à l’embauche</button>`:''}
      </section>`;
    }).join('');
    bindManualTimeInputs($('pointGrid'),'data-field');
    $('pointGrid').querySelectorAll('[data-now]').forEach(el=>el.addEventListener('click',()=>{
      const key=el.dataset.now;
      // A tap on "Maintenant" may only record the real current date.
      // Older days may be corrected with their editable time fields instead.
      const realToday=dateKey(new Date());
      if(selected!==realToday){
        if(confirm('Tu consultes une autre date. « Maintenant » pointe uniquement aujourd’hui. Aller à aujourd’hui ?')){
          selected=realToday;todayKey=realToday;activeWeek=mondayOfKey(realToday);archiveMonth=realToday.slice(0,7);reportMonth=realToday.slice(0,7);render();
        }
        return;
      }
      if(getDay(selected)[key] && !confirm('Remplacer l’heure '+getDay(selected)[key]+' par l’heure actuelle ?')) return;
      const persisted=setDay(selected,{[key]:timeNow()});
      if(persisted)toast(locationReady(getLocation(getDay(selected),key))?'Heure et lieu enregistrés ✓':'Heure enregistrée ✓ Pense au lieu de pointage.');
    }));
    $('locationGrid').querySelectorAll('[data-place]').forEach(el=>el.addEventListener('click',()=>{
      const {point,place}=el.dataset;
      setLocation(point,place);
      if(place==='client'&&!getLocation(getDay(selected),point).site.trim())$('locationGrid').querySelector(`[data-site="${point}"]`)?.focus();
    }));
    $('locationGrid').querySelectorAll('[data-site]').forEach(el=>el.addEventListener('input',()=>{
      saveClientWhileTyping(el.dataset.site,el.value);
      el.classList.toggle('site-missing',!el.value.trim());
      const card=el.closest('.point-card');
      const warn=card.querySelector('.location-required');
      if(warn)warn.style.display=el.value.trim()?'none':'';
      const copy=card.querySelector('[data-copy-place]');
      if(copy)copy.hidden=!!el.value.trim();
      updateLocationReminder(getDay(selected));
    }));
    $('locationGrid').querySelectorAll('[data-copy-place]').forEach(el=>el.addEventListener('click',()=>{
      const src=previousLocation(getDay(selected),el.dataset.copyPlace);
      if(src){setLocation(el.dataset.copyPlace,src.type,src.site);toast('Lieu précédent repris ✓');}
    }));
    const isLegacy=d.breakMode==='legacy';
    const currentPreset=d.breakMinutes===20?'20':d.breakMinutes===60?'60':d.breakMinutes===120?'120':'custom';
    $('pauseOptions').querySelectorAll('[data-break]').forEach(btn=>{
      const active=!isLegacy&&d.breakMinutes!==null&&btn.dataset.break===currentPreset || (!isLegacy&&d.breakPlan==='custom'&&d.breakMinutes===null&&btn.dataset.break==='custom');
      btn.classList.toggle('selected',active);btn.setAttribute('aria-pressed',String(active));btn.disabled=disabledDay;
    });
    const custom=$('customBreak');
    custom.hidden=disabledDay||isLegacy||!(d.breakPlan==='custom'||(d.breakMinutes!==null&&![20,60,120].includes(d.breakMinutes)));
    $('customBreakMinutes').value=d.breakMinutes==null?'':String(d.breakMinutes);
    const legacy=$('legacyBreak');
    legacy.hidden=!isLegacy||disabledDay;
    if(isLegacy&&!disabledDay){
      legacy.innerHTML=`<strong>Ancien pointage du midi</strong><p>Tu peux corriger les deux heures en les tapant au clavier, ou sélectionner une durée au-dessus.</p><div class="legacy-fields"><label>Sortie midi${manualTimeMarkup('lunchOut',d.lunchOut,'data-legacy-time="lunchOut" aria-label="Sortie midi, saisir 4 chiffres"')}</label><label>Reprise midi${manualTimeMarkup('lunchIn',d.lunchIn,'data-legacy-time="lunchIn" aria-label="Reprise midi, saisir 4 chiffres"')}</label></div>`;
      bindManualTimeInputs(legacy,'data-legacy-time');
    }else{legacy.innerHTML='';}
    const info=$('pauseInfo');
    if(disabledDay){info.className='pause-info';info.textContent=isLeave?`${leaveLabel(c.leaveType)} : aucun pointage nécessaire.`:'Cette journée est indiquée comme non travaillée.';}
    else if(isLegacy){info.className='pause-info';info.textContent='Ancienne saisie : le calcul utilise encore les heures exactes du midi. Choisis une durée pour simplifier cette journée.';}
    else if(d.breakMinutes===null){info.className='pause-info';info.textContent='Sélectionne la durée de pause réellement prise. Aucun horaire de midi à pointer.';}
    else if(d.breakMinutes===0){info.className='pause-info warning';info.textContent='Durée enregistrée : 0 minute. Vérifie cette saisie dans les observations si nécessaire.';}
    else{info.className='pause-info'+(d.breakMinutes<20?' warning':'');info.innerHTML=`Pause enregistrée : <strong>${duration(d.breakMinutes)}</strong>.${d.breakMinutes<20?' ⚠ Pause inférieure à 20 minutes.':''} Pour la corriger, choisis une autre durée.`;}
    if(c.complete&&!c.off){
      $('dayTotals').innerHTML=`<div class="total-item"><div class="total-label">Heures travaillées</div><div class="total-value">${duration(c.actual)}</div></div><div class="total-item"><div class="total-label">Écart / ${duration(c.goal)}</div><div class="total-value ${c.delta>0?'positive':c.delta<0?'negative':''}">${signed(c.delta)}</div></div><div class="wide">Pause déduite : <strong>${duration(c.pause)}</strong>. Travail réel : <strong>${duration(c.actual)}</strong>.</div>`;
    }else{
      $('dayTotals').innerHTML=`<div class="total-item"><div class="total-label">Objectif du jour</div><div class="total-value">${duration(c.goal)}</div></div><div class="total-item"><div class="total-label">Travail enregistré</div><div class="total-value">${d.off?'Repos':'—'}</div></div><div class="wide">${c.invalid?'⚠ Vérifie l’ordre des horaires.':d.off?'Aucune heure comptabilisée, sans préjuger des heures rémunérées pour une absence.':'Il faut les heures d’embauche et de débauche, puis la durée de pause réellement prise.'}</div>`;
    }
    const history=(state.audit[selected]||[]);
    const corrected=history.filter(e=>e.previous);
    $('correctionNotice').hidden=!corrected.length;
    $('correctionNotice').textContent=corrected.length?`✎ ${corrected.length} correction${corrected.length>1?'s':''} enregistrée${corrected.length>1?'s':''} · dernière modification ${formatStamp(corrected[corrected.length-1].at)}.`:'';
    $('viewAudit').disabled=!history.length;
    updateLocationReminder(d);
    $('dayNote').value=d.note || '';
    $('dayNoteStatus').textContent=d.note?'Observation enregistrée ✓':'Enregistrement automatique';
    $('offDay').disabled=isLeave;
    $('offDay').textContent=isLeave?'Absence enregistrée dans Congés & RTT':d.off?'Remettre cette journée en travail':'Marquer cette journée non travaillée';
    const mealButton=$('shortcutMeal');
    const mealSelected=d.meal===true;
    mealButton.classList.toggle('meal-active',mealSelected);
    mealButton.setAttribute('aria-pressed',String(mealSelected));
    mealButton.setAttribute('aria-label',mealSelected?'Panier repas : sélectionné. Appuyer pour annuler.':'Panier repas : non sélectionné. Appuyer pour ajouter.');
    mealButton.disabled=disabledDay;
  }
  function renderSummary(w){
    const tile = (label,val)=>`<div class="tile"><div class="tile-label">${label}</div><div class="tile-value">${val}</div></div>`;
    $('summaryTiles').innerHTML=tile('Heures travaillées',duration(w.actual))+tile('Objectif semaine',duration(w.weeklyReference))+tile('Solde semaine',w.allWeekdaysDone?signed(w.gap):'À compléter');
    $('weekRows').innerHTML=w.rows.map(({key,d,calc:c,day})=>{
      const pause=c.off?'—':c.pause===null?'—':duration(c.pause);
      const desc=`${WEEKDAYS[day]} ${dateFromKey(key).getDate()}`;
      const sheetEnd=c.off?'—':d.end||'—';
      return `<tr><td>${desc}</td><td>${c.off?'Repos':duration(c.actual)}</td><td>${pause}</td><td>${esc(sheetEnd)}</td><td class="${c.delta>0?'positive':c.delta<0?'negative':''}">${c.off?'—':signed(c.delta)}</td></tr>`;
    }).join('')+`<tr class="weekly-footer"><td><strong>Total</strong></td><td><strong>${duration(w.actual)}</strong></td><td>—</td><td>—</td><td class="${w.gap>0?'positive':w.gap<0?'negative':''}"><strong>${w.allWeekdaysDone?signed(w.gap):'À compléter'}¹</strong></td></tr>`;
    $('weekRows').parentElement.setAttribute('aria-label',`Semaine du ${dateRange()}`);
    let foot=$('weeklyBreakdown');
    if(!foot){foot=document.createElement('div');foot.id='weeklyBreakdown';foot.className='week-breakdown';foot.style.cssText='font-size:11px;color:#516f74;line-height:1.5;margin-top:12px';$('weekRows').parentElement.parentElement.insertAdjacentElement('afterend',foot);}
    const missing=w.rows.slice(0,5).filter(x=>!x.calc.complete).map(x=>WEEKDAYS[x.day]).join(', ');
    foot.innerHTML=`¹ Écart total <strong>${signed(w.gap)}</strong> par rapport aux objectifs des journées complètes enregistrées (${duration(w.comparedGoal)}). ${missing?`Jours à compléter : ${missing}. `:''}${w.allWeekdaysDone?`Total à comparer à <strong>${duration(w.weeklyReference)}</strong> (objectif ajusté pour les absences) : <strong>${duration(w.effective)}</strong>.`:'Le solde hebdomadaire attend les journées manquantes.'} Les heures supplémentaires sont appréciées sur la semaine et selon l’accord applicable.`;
  }
  function setBreak(picked){
    const d=getDay(selected);
    if(d.off||leaveOn(selected)){toast('Cette journée est non travaillée.');return;}
    const legacy=d.breakMode==='legacy'&&(d.lunchOut||d.lunchIn);
    if(legacy&&!confirm('Passer à une durée de pause remplacera les deux anciens horaires du midi dans le calcul. Les modifications seront tracées. Continuer ?'))return;
    const value=picked==='custom'?null:Number(picked);
    setDay(selected,{breakMode:'duration',breakPlan:picked,breakMinutes:value,noBreak:false});
    if(picked==='custom'){
      $('customBreakMinutes').focus();
      toast('Indique la durée réelle en minutes, puis valide.');
    }else toast(`Pause de ${duration(value)} enregistrée ✓`);
  }
  function dayText(row){
    const {key,d,calc:c,day}=row;
    const label=`${WEEKDAYS[day]} ${dateFromKey(key).getDate()}/${pad(dateFromKey(key).getMonth()+1)}`;
    const leave=leaveOn(key);if(leave)return `${label} : ${leaveLabel(leave.type)}${d.note?' — '+d.note:''}`;
    if(d.off)return `${label} : non travaillé${d.note?' — '+d.note:''}`;
    const start=`  Embauche : ${d.start||'—'}${d.start?' | '+locationLabel(getLocation(d,'start')):''}`;
    const end=`  Débauche réelle : ${d.end||'—'}${d.end?' | '+locationLabel(getLocation(d,'end')):''}`;
    const legacy=d.breakMode==='legacy'?` (horaires midi : ${d.lunchOut||'—'} / ${d.lunchIn||'—'})`:'';
    const result=c.complete?`Travail réel : ${duration(c.actual)} ; pause : ${duration(c.pause)}${legacy} ; écart journalier : ${signed(c.delta)}`:'Journée incomplète';
    return `${label}\n${start}\n${end}\n  ${result}\n  Panier repas : ${d.meal===true?'Oui':'Non'}${d.note?'\n  Note : '+d.note:''}`;
  }
  function monthData(month=reportMonth){
    const [year,monthNumber]=month.split('-').map(Number);
    const endDay=new Date(year,monthNumber,0).getDate();
    const rows=Array.from({length:endDay},(_,i)=>{
      const date=new Date(year,monthNumber-1,i+1);
      const key=dateKey(date);return {key,d:getDay(key),calc:compute(key),day:weekdayIndex(key)};
    });
    // Display all Mon-Fri dates, including blank days, and only recorded weekends.
    const printable=rows.filter(row=>row.day<5||hasRecordedData(row.d));
    const finished=rows.filter(row=>row.calc.complete&&!row.calc.off);
    const actual=finished.reduce((n,row)=>n+row.calc.actual,0);
    const comparedGoal=finished.reduce((n,row)=>n+row.calc.goal,0);
    const delta=actual-comparedGoal;
    const target=rows.reduce((n,row)=>n+(row.day<5&&!row.calc.off?GOALS[row.day]:0),0);
    const incomplete=rows.filter(row=>row.day<5&&!row.calc.complete);
    const meals=rows.filter(row=>row.d.meal===true&&!row.calc.off).length;
    const leaves=rows.filter(row=>row.calc.leaveType);
    const net=actual-target;
    const vehicle=state.vehicleChecks[month]||{done:null,note:'',at:''};
    const weeks=[...new Set(rows.map(row=>mondayOfKey(row.key)))].map(begin=>{
      const week=weekData(begin);
      const finish=dateKey(plusDays(dateFromKey(begin),6));
      return {...week,begin,finish,spansMonth:!begin.startsWith(month)||!finish.startsWith(month),weekNum:isoWeek(dateFromKey(begin))};
    });
    return {month,label:`${MONTHS[monthNumber-1]} ${year}`,year,monthNumber,rows,printable,actual,comparedGoal,delta,target,net,incomplete,meals,leaves,vehicle,weeks};
  }
  function renderMonthSummary(){
    const m=monthData();
    $('reportMonthInput').value=reportMonth;
    const tile=(label,val)=>`<div class="tile"><div class="tile-label">${label}</div><div class="tile-value">${val}</div></div>`;
    $('monthSummary').innerHTML=tile('Heures pointées',duration(m.actual))+tile('Paniers repas',String(m.meals))+tile('Solde indicatif',m.incomplete.length?'À compléter':signed(m.net));
    renderVehicle(m);
    const msg=[];
    if(m.vehicle.done===null)msg.push('Contrôle du véhicule à renseigner.');
    if(m.incomplete.length)msg.push(`${m.incomplete.length} jour(s) ouvré(s) sans pointage complet. Les heures totales peuvent évoluer.`);
    const missing=m.printable.flatMap(row=>LOCATION_FIELDS.filter(f=>row.d[f]&&!row.d.off&&!locationReady(getLocation(row.d,f))).map(f=>`${row.key} (${f==='start'?'matin':'soir'})`));
    if(missing.length)msg.push(`${missing.length} lieu(x) à renseigner : ${missing.slice(0,2).join(', ')}${missing.length>2?'…':''}`);
    $('monthWarning').textContent=msg.join(' ');
    $('monthWarning').hidden=!msg.length;
  }
  function monthlyDayText(row){return dayText(row);}
  function emailText(m){
    const weekly=m.weeks.map(w=>`S${pad(w.weekNum)} (${w.begin} au ${w.finish}) : ${duration(w.actual)} / référence ${duration(w.weeklyReference)}${w.allWeekdaysDone?` ; écart ${signed(w.gap)}`:' ; à compléter'}${w.spansMonth?' †':''}`).join('\n');
    return `Bonjour,\n\nVeuillez trouver ma feuille de pointage mensuelle pour ${m.label}.\nJ'ajouterai le PDF en pièce jointe avant l'envoi.\n\nSalarié : ${profileName()}\nE-mail : ${state.settings.employeeEmail}\nHeures travaillées : ${duration(m.actual)}\nRéférence du mois (ajustée pour congés / RTT) : ${duration(m.target)}\nSolde indicatif : ${m.incomplete.length?'À compléter':signed(m.net)}\nPaniers repas : ${m.meals}\nCongés : ${m.leaves.filter(r=>r.calc.leaveType==='CP').length} jour(s) ouvré(s)\nRTT : ${m.leaves.filter(r=>r.calc.leaveType==='RTT').length} jour(s) ouvré(s)\nContrôle véhicule : ${m.vehicle.done===true?'Oui':m.vehicle.done===false?'Non':'Non renseigné'}\n\nDétail hebdomadaire († semaine chevauchant deux mois) :\n${weekly}\n\nLa qualification d'heures supplémentaires sur la paie est à vérifier par le bureau selon le décompte hebdomadaire et les règles applicables.\n\nCordialement,\n${profileName()}`;
  }
  function download(name,body,type){
    const link=document.createElement('a');
    const url=URL.createObjectURL(new Blob([body],{type}));
    link.href=url;link.download=name;link.style.display='none';document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),15000);
  }
  function csvExport(m){
    const q=value=>{const raw=String(value??'');const safe=/^[=+@\-\t\r]/.test(raw)?"'"+raw:raw;return `"${safe.replace(/"/g,'""')}"`;};
    const rows=[['Date','Jour','Embauche','Lieu embauche','Pause (min)','Débauche','Lieu débauche','Heures travaillées (min)','Écart jour (min)','Panier repas','Statut','Note']];
    m.rows.forEach(({key,d,calc:c,day})=>rows.push([key,WEEKDAYS[day],c.off?'':d.start,c.off?'':locationLabel(getLocation(d,'start')),c.pause??'',c.off?'':d.end,c.off?'':locationLabel(getLocation(d,'end')),c.off?'':c.actual??'',c.off?'':c.delta??'',c.off?'':d.meal===true?'Oui':d.meal===false?'Non':'',c.leaveType?leaveLabel(c.leaveType):c.off?'Non travaillé':c.complete?'Complet':'Incomplet',d.note||'']));
    rows.push([]);
    rows.push(['TOTAL MOIS',m.label,'Heures travaillées (min)',m.actual,'Référence ajustée (min)',m.target,'Solde indicatif (min)',m.incomplete.length?'À compléter':m.net,'Paniers repas',m.meals,'Contrôle véhicule',m.vehicle.done===true?'Oui':m.vehicle.done===false?'Non':'Non renseigné']);
    rows.push(['Contrôle véhicule - observation',m.vehicle.note||'']);
    rows.push(['SEMAINE','Début','Fin','Temps travaillé (min)','Référence ajustée (min)','Écart (min)','Statut']);
    m.weeks.forEach(w=>rows.push([`S${w.weekNum}`,w.begin,w.finish,w.actual,w.weeklyReference,w.allWeekdaysDone?w.gap:'',w.allWeekdaysDone?'Complet':'À compléter']));
    return '\ufeff'+rows.map(row=>row.map(q).join(';')).join('\r\n');
  }
  // Génération locale directe d'un fichier PDF A4 paysage / exactement une page.
  // Aucun service externe, bibliothèque distante ou dialogue d'impression requis.
  async function logoJpeg(){
    const img=new Image();
    img.src='assets/logo-charriaut.png';
    await img.decode();
    const canvas=document.createElement('canvas');canvas.width=260;canvas.height=260;
    const ctx=canvas.getContext('2d');
    ctx.fillStyle='#fff';ctx.fillRect(0,0,260,260);
    ctx.drawImage(img,0,0,260,260);
    const b64=canvas.toDataURL('image/jpeg',.87).split(',')[1];
    return atob(b64);
  }
  function pdfWin1252(value){
    const extras={'−':45,'€':128,'‚':130,'ƒ':131,'„':132,'…':133,'†':134,'‡':135,'ˆ':136,'‰':137,'Š':138,'‹':139,'Œ':140,'Ž':142,'‘':145,'’':146,'“':147,'”':148,'•':149,'–':150,'—':151,'˜':152,'™':153,'š':154,'›':155,'œ':156,'ž':158,'Ÿ':159};
    return Array.from(String(value??'')).map(ch=>ch.charCodeAt(0)<=255?ch:(extras[ch]!==undefined?String.fromCharCode(extras[ch]):'?')).join('').replace(/[\x00-\x08\x0b-\x1f]/g,' ');
  }
  function pdfEscape(value){return pdfWin1252(value).replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)').replace(/[\r\n]/g,' ');}
  function pdfDataBlob(content,jpeg){
    // Produire des octets directs, car les flux PDF (JPEG et texte Windows-1252) ne sont pas UTF-8.
    const objects=[];
    objects[1]='<< /Type /Catalog /Pages 2 0 R >>';
    objects[2]='<< /Type /Pages /Kids [3 0 R] /Count 1 >>';
    objects[3]='<< /Type /Page /Parent 2 0 R /MediaBox [0 0 841.89 595.28] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> /XObject << /Im1 6 0 R >> >> /Contents 7 0 R >>';
    objects[4]='<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
    objects[5]='<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
    objects[6]=`<< /Type /XObject /Subtype /Image /Width 260 /Height 260 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n${jpeg}\nendstream`;
    objects[7]=`<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
    let raw='%PDF-1.4\n%\xE2\xE3\xCF\xD3\n',positions=[0];
    for(let i=1;i<=7;i++){
      positions[i]=raw.length;
      raw+=`${i} 0 obj\n${objects[i]}\nendobj\n`;
    }
    const xrefAt=raw.length;
    raw+='xref\n0 8\n0000000000 65535 f \n';
    for(let i=1;i<=7;i++)raw+=String(positions[i]).padStart(10,'0')+' 00000 n \n';
    raw+=`trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
    const bytes=new Uint8Array(raw.length);
    for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i)&255;
    return bytes;
  }
  async function generateMonthlyPdf(m){
    const jpeg=await logoJpeg();
    const cmds=[];
    const fmt=n=>Number(n).toFixed(2);
    function color(c){return c.map(v=>fmt(v/255)).join(' ');}
    function rect(x,y,w,h,fill,stroke){
      if(fill)cmds.push(`${color(fill)} rg ${fmt(x)} ${fmt(y)} ${fmt(w)} ${fmt(h)} re f`);
      if(stroke)cmds.push(`${color(stroke)} RG .45 w ${fmt(x)} ${fmt(y)} ${fmt(w)} ${fmt(h)} re S`);
    }
    function line(x1,y1,x2,y2,stroke=[211,225,236]){
      cmds.push(`${color(stroke)} RG .35 w ${fmt(x1)} ${fmt(y1)} m ${fmt(x2)} ${fmt(y2)} l S`);
    }
    const measureCanvas=document.createElement('canvas'),measureCtx=measureCanvas.getContext('2d');
    function fit(text,size,maxWidth,bold=false){
      let txt=String(text??'').replace(/[\r\n]+/g,' ').trim();
      measureCtx.font=`${bold?'bold ':''}${size}px Arial`;
      if(measureCtx.measureText(txt).width<=maxWidth*.82)return txt;
      while(txt.length>1&&measureCtx.measureText(txt+'…').width>maxWidth*.82)txt=txt.slice(0,-1);
      return txt+'…';
    }
    function text(value,x,y,size=7,bold=false,ink=[19,50,78],maxWidth){
      const v=maxWidth===undefined?String(value??''):fit(value,size,maxWidth,bold);
      cmds.push(`${color(ink)} rg BT /${bold?'F2':'F1'} ${fmt(size)} Tf 1 0 0 1 ${fmt(x)} ${fmt(y)} Tm (${pdfEscape(v)}) Tj ET`);
      return v;
    }
    const NAVY=[14,57,104],BLUE=[17,103,178],LIGHT=[224,239,251],MUTED=[75,102,125],GRID=[189,211,228],YELLOW=[255,238,186];
    // Bandeau avec logo et identification.
    rect(20,517,802,66,[255,255,255]);
    cmds.push(`q 48 0 0 48 22 528 cm /Im1 Do Q`);
    text('RELEVÉ MENSUEL DES HEURES',81,561,18,true,NAVY,430);
    text(`CHARRIAUT  •  ${m.label.toUpperCase()}`,82,542,10,true,BLUE,400);
    rect(567,531,251,49,[239,247,253],[202,222,236]);
    text(`NOM : ${state.settings.lastName||'À renseigner'}`,577,567,7.4,true,NAVY,230);
    text(`PRÉNOM : ${state.settings.firstName||'À renseigner'}`,577,557,7.4,false,NAVY,230);
    text(`E-MAIL : ${state.settings.employeeEmail||'À renseigner'}`,577,547,7,false,NAVY,230);
    text('DESTINATAIRE : contact@charriaut.fr',577,537,7,false,NAVY,230);
    line(22,520,819,520,[227,176,60]);
    // Largeurs réellement calibrées pour une feuille A4 paysage.
    const widths=[51,48,104,47,48,104,52,53,43,248];
    const xs=[21];for(const w of widths)xs.push(xs[xs.length-1]+w);
    const weeks=new Map();
    for(const row of m.printable){const key=mondayOfKey(row.key);if(!weeks.has(key))weeks.set(key,[]);weeks.get(key).push(row);}
    const startY=507;
    const headHeight=16, groupHeight=9.3, totalHeight=10;
    const actualWeeks=weeks.size;
    const maxTabular=397;
    const perRow=Math.min(12.2,Math.max(7.7,(maxTabular-headHeight-actualWeeks*(groupHeight+totalHeight))/Math.max(1,m.printable.length)));
    let top=startY;
    rect(xs[0],top-headHeight,800,headHeight,NAVY);
    const labels=['Date','Embauche','Lieu embauche','Pause','Débauche','Lieu débauche','Travail','Écart','Panier','Observation / Congés / RTT'];
    for(let i=0;i<labels.length;i++)text(labels[i],xs[i]+3,top-10.8,6.5,true,[255,255,255],widths[i]-5);
    top-=headHeight;
    let rIndex=0,notesAbr=false;
    function putRow(values,colors={}){
      const bottom=top-perRow;
      if(rIndex%2===0)rect(xs[0],bottom,800,perRow,[247,250,253]);
      for(let i=1;i<xs.length-1;i++)line(xs[i],bottom,xs[i],top,GRID);
      line(xs[0],bottom,xs[10],bottom,GRID);
      for(let i=0;i<10;i++){
        const s=i===9?6.3:6.7;
        const rendered=text(values[i],xs[i]+3,bottom+(perRow-s)/2+1,s,i===0||i===6,colors[i]||[26,57,83],widths[i]-6);
        if(i===9&&rendered!==String(values[i]).replace(/[\r\n]+/g,' ').trim())notesAbr=true;
      }
      top=bottom;rIndex++;
    }
    for(const [begin,rows] of weeks){
      rect(xs[0],top-groupHeight,800,groupHeight,[206,231,245]);
      const w=m.weeks.find(w=>w.begin===begin);
      text(`SEMAINE ${pad(w.weekNum)}  •  ${begin.slice(8)}/${begin.slice(5,7)} au ${w.finish.slice(8)}/${w.finish.slice(5,7)}`,xs[0]+4,top-6.8,6.5,true,NAVY);
      top-=groupHeight;
      for(const row of rows){
        const {key,d,calc:c,day}=row;
        const dt=dateFromKey(key),loc=(field)=>{
          const l=getLocation(d,field);
          if(!d[field]||c.off)return '—';
          return l.type==='bureau'?'BUREAU':l.type==='client'?`CLIENT : ${l.site||'À préciser'}`:'À renseigner';
        };
        const off=c.off;
        const stat=c.leaveType?leaveLabel(c.leaveType):d.off?'Non travaillé':c.invalid?'À corriger':!c.complete?'Incomplet':'';
        const note=[stat,d.note].filter(Boolean).join(' - ');
        putRow([`${WEEKDAYS[day]} ${pad(dt.getDate())}`,
          off?'—':d.start||'—',loc('start'),off?'—':duration(c.pause),off?'—':d.end||'—',loc('end'),
          off?'—':duration(c.actual),off?'—':signed(c.delta),off?'—':d.meal===true?'Oui':'Non',note],
          {7:c.delta>0?[16,125,78]:c.delta<0?[173,53,52]:[26,57,83]});
      }
      rect(xs[0],top-totalHeight,800,totalHeight,[235,244,250]);
      text(`TOTAL SEMAINE : ${duration(w.actual)}`,xs[0]+5,top-7,7,true,NAVY);
      text(`RÉFÉRENCE : ${duration(w.weeklyReference)}`,xs[3]+4,top-7,7,true,NAVY);
      text(`SOLDE : ${w.allWeekdaysDone?signed(w.gap):'À compléter'}`,xs[7]+6,top-7,7,true,w.gap<0?[173,53,52]:NAVY);
      top-=totalHeight;
    }
    // Les totaux tiennent dans un encart fixe. Aucun débordement possible hors de la page.
    const summaryTop=88;
    const boxes=[
      {x:21,w:188,label:'HEURES TRAVAILLÉES',value:duration(m.actual)},
      {x:214,w:180,label:'BASE AJUSTÉE (CONGÉS / RTT)',value:duration(m.target)},
      {x:399,w:263,label:m.incomplete.length?'RELEVÉ INCOMPLET':m.net>0?'SOLDE MENSUEL POSITIF':m.net<0?'SOLDE MENSUEL NÉGATIF':'SOLDE MENSUEL',value:m.incomplete.length?'À compléter':signed(m.net),highlight:true},
      {x:667,w:154,label:'PANIERS REPAS',value:String(m.meals)}
    ];
    for(const b of boxes){rect(b.x,55,b.w,33,b.highlight?YELLOW:LIGHT,[179,210,230]);text(b.label,b.x+8,76,7.2,true,NAVY,b.w-14);text(b.value,b.x+8,61,15.5,true,NAVY,b.w-14);}
    const vc=m.vehicle.done===true?'OUI':m.vehicle.done===false?'NON':'NON RENSEIGNÉ';
    text(`CONTRÔLE VÉHICULE : ${vc}   ${m.vehicle.note?'-  '+m.vehicle.note:''}`,23,43,6.8,true,NAVY,791);
    line(21,36,820,36);
    text(`Congés : ${m.leaves.filter(r=>r.calc.leaveType==='CP').length} j.    RTT : ${m.leaves.filter(r=>r.calc.leaveType==='RTT').length} j.    •    Écarts journaliers indicatifs ; le traitement des heures supplémentaires est validé par le bureau.`,23,27,6.2,false,MUTED,794);
    const extra=notesAbr?'Observations longues abrégées : texte intégral conservé dans l’application et le CSV.  ':' ';
    text(`${extra}Édité le ${formatStamp(new Date().toISOString())}.  •  Semaine chevauchant deux mois : total hebdomadaire complet.`,23,18,5.9,false,MUTED,794);
    // Calculer une seule page quel que soit le nombre de lignes ; le contenu court est garanti.
    if(top<89)throw Error('Nombre exceptionnel de lignes : export trop dense pour A4 unique.');
    const content=cmds.join('\n')+'\n';
    const pdf=pdfDataBlob(content,jpeg);
    download(`CHARRIAUT_Releve_${m.month}_${(state.settings.lastName||'salarie').replace(/[^a-zA-Z0-9À-ÿ-]/g,'_')}.pdf`,pdf,'application/pdf');
  }

  // Génération locale directe d'un fichier PDF A4 paysage / exactement une page.
  // Aucun service externe, bibliothèque distante ou dialogue d'impression requis.
  async function logoJpeg(){
    const img=new Image();
    img.src='assets/logo-charriaut.png';
    await img.decode();
    const canvas=document.createElement('canvas');canvas.width=260;canvas.height=260;
    const ctx=canvas.getContext('2d');
    ctx.fillStyle='#fff';ctx.fillRect(0,0,260,260);
    ctx.drawImage(img,0,0,260,260);
    const b64=canvas.toDataURL('image/jpeg',.87).split(',')[1];
    return atob(b64);
  }
  function pdfWin1252(value){
    const extras={'−':45,'€':128,'‚':130,'ƒ':131,'„':132,'…':133,'†':134,'‡':135,'ˆ':136,'‰':137,'Š':138,'‹':139,'Œ':140,'Ž':142,'‘':145,'’':146,'“':147,'”':148,'•':149,'–':150,'—':151,'˜':152,'™':153,'š':154,'›':155,'œ':156,'ž':158,'Ÿ':159};
    return Array.from(String(value??'')).map(ch=>ch.charCodeAt(0)<=255?ch:(extras[ch]!==undefined?String.fromCharCode(extras[ch]):'?')).join('').replace(/[\x00-\x08\x0b-\x1f]/g,' ');
  }
  function pdfEscape(value){return pdfWin1252(value).replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)').replace(/[\r\n]/g,' ');}
  function pdfDataBlob(content,jpeg){
    // Produire des octets directs, car les flux PDF (JPEG et texte Windows-1252) ne sont pas UTF-8.
    const objects=[];
    objects[1]='<< /Type /Catalog /Pages 2 0 R >>';
    objects[2]='<< /Type /Pages /Kids [3 0 R] /Count 1 >>';
    objects[3]='<< /Type /Page /Parent 2 0 R /MediaBox [0 0 841.89 595.28] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> /XObject << /Im1 6 0 R >> >> /Contents 7 0 R >>';
    objects[4]='<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
    objects[5]='<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
    objects[6]=`<< /Type /XObject /Subtype /Image /Width 260 /Height 260 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n${jpeg}\nendstream`;
    objects[7]=`<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
    let raw='%PDF-1.4\n%\xE2\xE3\xCF\xD3\n',positions=[0];
    for(let i=1;i<=7;i++){
      positions[i]=raw.length;
      raw+=`${i} 0 obj\n${objects[i]}\nendobj\n`;
    }
    const xrefAt=raw.length;
    raw+='xref\n0 8\n0000000000 65535 f \n';
    for(let i=1;i<=7;i++)raw+=String(positions[i]).padStart(10,'0')+' 00000 n \n';
    raw+=`trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
    const bytes=new Uint8Array(raw.length);
    for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i)&255;
    return bytes;
  }
  async function generateMonthlyPdf(m){
    const jpeg=await logoJpeg();
    const cmds=[];
    const fmt=n=>Number(n).toFixed(2);
    function color(c){return c.map(v=>fmt(v/255)).join(' ');}
    function rect(x,y,w,h,fill,stroke){
      if(fill)cmds.push(`${color(fill)} rg ${fmt(x)} ${fmt(y)} ${fmt(w)} ${fmt(h)} re f`);
      if(stroke)cmds.push(`${color(stroke)} RG .45 w ${fmt(x)} ${fmt(y)} ${fmt(w)} ${fmt(h)} re S`);
    }
    function line(x1,y1,x2,y2,stroke=[211,225,236]){
      cmds.push(`${color(stroke)} RG .35 w ${fmt(x1)} ${fmt(y1)} m ${fmt(x2)} ${fmt(y2)} l S`);
    }
    const measureCanvas=document.createElement('canvas'),measureCtx=measureCanvas.getContext('2d');
    function fit(text,size,maxWidth,bold=false){
      let txt=String(text??'').replace(/[\r\n]+/g,' ').trim();
      measureCtx.font=`${bold?'bold ':''}${size}px Arial`;
      if(measureCtx.measureText(txt).width<=maxWidth*.82)return txt;
      while(txt.length>1&&measureCtx.measureText(txt+'…').width>maxWidth*.82)txt=txt.slice(0,-1);
      return txt+'…';
    }
    function text(value,x,y,size=7,bold=false,ink=[19,50,78],maxWidth){
      const v=maxWidth===undefined?String(value??''):fit(value,size,maxWidth,bold);
      cmds.push(`${color(ink)} rg BT /${bold?'F2':'F1'} ${fmt(size)} Tf 1 0 0 1 ${fmt(x)} ${fmt(y)} Tm (${pdfEscape(v)}) Tj ET`);
      return v;
    }
    const NAVY=[14,57,104],BLUE=[17,103,178],LIGHT=[224,239,251],MUTED=[75,102,125],GRID=[189,211,228],YELLOW=[255,238,186];
    // Bandeau avec logo et identification.
    rect(20,517,802,66,[255,255,255]);
    cmds.push(`q 48 0 0 48 22 528 cm /Im1 Do Q`);
    text('RELEVÉ MENSUEL DES HEURES',81,561,18,true,NAVY,430);
    text(`CHARRIAUT  •  ${m.label.toUpperCase()}`,82,542,10,true,BLUE,400);
    rect(567,531,251,49,[239,247,253],[202,222,236]);
    text(`NOM : ${state.settings.lastName||'À renseigner'}`,577,567,7.4,true,NAVY,230);
    text(`PRÉNOM : ${state.settings.firstName||'À renseigner'}`,577,557,7.4,false,NAVY,230);
    text(`E-MAIL : ${state.settings.employeeEmail||'À renseigner'}`,577,547,7,false,NAVY,230);
    text('DESTINATAIRE : contact@charriaut.fr',577,537,7,false,NAVY,230);
    line(22,520,819,520,[227,176,60]);
    // Largeurs réellement calibrées pour une feuille A4 paysage.
    const widths=[51,48,104,47,48,104,52,53,43,248];
    const xs=[21];for(const w of widths)xs.push(xs[xs.length-1]+w);
    const weeks=new Map();
    for(const row of m.printable){const key=mondayOfKey(row.key);if(!weeks.has(key))weeks.set(key,[]);weeks.get(key).push(row);}
    const startY=507;
    const headHeight=16, groupHeight=9.3, totalHeight=10;
    const actualWeeks=weeks.size;
    const maxTabular=397;
    const perRow=Math.min(12.2,Math.max(7.7,(maxTabular-headHeight-actualWeeks*(groupHeight+totalHeight))/Math.max(1,m.printable.length)));
    let top=startY;
    rect(xs[0],top-headHeight,800,headHeight,NAVY);
    const labels=['Date','Embauche','Lieu embauche','Pause','Débauche','Lieu débauche','Travail','Écart','Panier','Observation / Congés / RTT'];
    for(let i=0;i<labels.length;i++)text(labels[i],xs[i]+3,top-10.8,6.5,true,[255,255,255],widths[i]-5);
    top-=headHeight;
    let rIndex=0,notesAbr=false;
    function putRow(values,colors={}){
      const bottom=top-perRow;
      if(rIndex%2===0)rect(xs[0],bottom,800,perRow,[247,250,253]);
      for(let i=1;i<xs.length-1;i++)line(xs[i],bottom,xs[i],top,GRID);
      line(xs[0],bottom,xs[10],bottom,GRID);
      for(let i=0;i<10;i++){
        const s=i===9?6.3:6.7;
        const rendered=text(values[i],xs[i]+3,bottom+(perRow-s)/2+1,s,i===0||i===6,colors[i]||[26,57,83],widths[i]-6);
        if(i===9&&rendered!==String(values[i]).replace(/[\r\n]+/g,' ').trim())notesAbr=true;
      }
      top=bottom;rIndex++;
    }
    for(const [begin,rows] of weeks){
      rect(xs[0],top-groupHeight,800,groupHeight,[206,231,245]);
      const w=m.weeks.find(w=>w.begin===begin);
      text(`SEMAINE ${pad(w.weekNum)}  •  ${begin.slice(8)}/${begin.slice(5,7)} au ${w.finish.slice(8)}/${w.finish.slice(5,7)}`,xs[0]+4,top-6.8,6.5,true,NAVY);
      top-=groupHeight;
      for(const row of rows){
        const {key,d,calc:c,day}=row;
        const dt=dateFromKey(key),loc=(field)=>{
          const l=getLocation(d,field);
          if(!d[field]||c.off)return '—';
          return l.type==='bureau'?'BUREAU':l.type==='client'?`CLIENT : ${l.site||'À préciser'}`:'À renseigner';
        };
        const off=c.off;
        const stat=c.leaveType?leaveLabel(c.leaveType):d.off?'Non travaillé':c.invalid?'À corriger':!c.complete?'Incomplet':'';
        const note=[stat,d.note].filter(Boolean).join(' - ');
        putRow([`${WEEKDAYS[day]} ${pad(dt.getDate())}`,
          off?'—':d.start||'—',loc('start'),off?'—':duration(c.pause),off?'—':d.end||'—',loc('end'),
          off?'—':duration(c.actual),off?'—':signed(c.delta),off?'—':d.meal===true?'Oui':'Non',note],
          {7:c.delta>0?[16,125,78]:c.delta<0?[173,53,52]:[26,57,83]});
      }
      rect(xs[0],top-totalHeight,800,totalHeight,[235,244,250]);
      text(`TOTAL SEMAINE : ${duration(w.actual)}`,xs[0]+5,top-7,7,true,NAVY);
      text(`RÉFÉRENCE : ${duration(w.weeklyReference)}`,xs[3]+4,top-7,7,true,NAVY);
      text(`SOLDE : ${w.allWeekdaysDone?signed(w.gap):'À compléter'}`,xs[7]+6,top-7,7,true,w.gap<0?[173,53,52]:NAVY);
      top-=totalHeight;
    }
    // Les totaux tiennent dans un encart fixe. Aucun débordement possible hors de la page.
    const summaryTop=88;
    const boxes=[
      {x:21,w:188,label:'HEURES TRAVAILLÉES',value:duration(m.actual)},
      {x:214,w:180,label:'BASE AJUSTÉE (CONGÉS / RTT)',value:duration(m.target)},
      {x:399,w:263,label:m.incomplete.length?'RELEVÉ INCOMPLET':m.net>0?'SOLDE MENSUEL POSITIF':m.net<0?'SOLDE MENSUEL NÉGATIF':'SOLDE MENSUEL',value:m.incomplete.length?'À compléter':signed(m.net),highlight:true},
      {x:667,w:154,label:'PANIERS REPAS',value:String(m.meals)}
    ];
    for(const b of boxes){rect(b.x,55,b.w,33,b.highlight?YELLOW:LIGHT,[179,210,230]);text(b.label,b.x+8,76,7.2,true,NAVY,b.w-14);text(b.value,b.x+8,61,15.5,true,NAVY,b.w-14);}
    const vc=m.vehicle.done===true?'OUI':m.vehicle.done===false?'NON':'NON RENSEIGNÉ';
    text(`CONTRÔLE VÉHICULE : ${vc}   ${m.vehicle.note?'-  '+m.vehicle.note:''}`,23,43,6.8,true,NAVY,791);
    line(21,36,820,36);
    text(`Congés : ${m.leaves.filter(r=>r.calc.leaveType==='CP').length} j.    RTT : ${m.leaves.filter(r=>r.calc.leaveType==='RTT').length} j.    •    Écarts journaliers indicatifs ; le traitement des heures supplémentaires est validé par le bureau.`,23,27,6.2,false,MUTED,794);
    const extra=notesAbr?'Observations longues abrégées : texte intégral conservé dans l’application et le CSV.  ':' ';
    text(`${extra}Édité le ${formatStamp(new Date().toISOString())}.  •  Semaine chevauchant deux mois : total hebdomadaire complet.`,23,18,5.9,false,MUTED,794);
    // Calculer une seule page quel que soit le nombre de lignes ; le contenu court est garanti.
    if(top<89)throw Error('Nombre exceptionnel de lignes : export trop dense pour A4 unique.');
    const content=cmds.join('\n')+'\n';
    const pdf=pdfDataBlob(content,jpeg);
    download(`CHARRIAUT_Releve_${m.month}_${(state.settings.lastName||'salarie').replace(/[^a-zA-Z0-9À-ÿ-]/g,'_')}.pdf`,pdf,'application/pdf');
  }

  // A compact, print-only one-page A4 landscape monthly timesheet.
  function renderPrint(m){
    const place=(d,field)=>{const l=getLocation(d,field);return !d[field]?'—':esc(l.type==='bureau'?'BUREAU':l.type==='client'?`CLIENT · ${l.site||'À préciser'}`:'À renseigner');};
    const rowHtml=({key,d,calc:c,day})=>{
      const dt=dateFromKey(key),edit=(state.audit[key]||[]).some(e=>e.previous)?' ✎':'';
      const isOff=c.off;
      const out=esc(d.end||'—');
      const statusBase=c.leaveType?leaveLabel(c.leaveType):d.off?'Non travaillé':c.invalid?'À corriger':!c.complete?'À compléter':'';
      const status=[statusBase,String(d.note||'').trim()].filter(Boolean).join(' · ');
      return `<tr class="${day>=5?'p-weekend':''} ${!c.complete&&!isOff?'p-unfinished':''}">
      <td class="p-date">${WEEKDAYS[day]} ${pad(dt.getDate())}${edit}</td>
      <td class="p-hour">${isOff?'—':esc(d.start||'—')}</td>
      <td class="p-place-cell">${isOff?'—':place(d,'start')}</td>
      <td class="p-pause">${isOff?'—':duration(c.pause)}</td>
      <td class="p-hour">${isOff?'—':out}</td>
      <td class="p-place-cell">${isOff?'—':place(d,'end')}</td>
      <td class="p-strong">${isOff?'—':duration(c.actual)}</td>
      <td class="${c.delta>0?'p-plus':c.delta<0?'p-minus':''}">${isOff?'—':signed(c.delta)}</td>
      <td class="p-meal">${isOff?'—':d.meal===true?'Oui':d.meal===false?'Non':'—'}</td>
      <td class="p-note">${esc(status)}</td></tr>`;
    };
    const groupByWeek=new Map();for(const row of m.printable){const id=mondayOfKey(row.key);if(!groupByWeek.has(id))groupByWeek.set(id,[]);groupByWeek.get(id).push(row);}
    const grid=[...groupByWeek.entries()].map(([begin,rows])=>{
      const w=m.weeks.find(x=>x.begin===begin);
      return `<tr class="p-week-heading"><td colspan="10">Semaine ${pad(w.weekNum)} · du ${begin.slice(8)}/${begin.slice(5,7)} au ${w.finish.slice(8)}/${w.finish.slice(5,7)}</td></tr>${rows.map(rowHtml).join('')}<tr class="p-week-total"><td colspan="4">Total semaine : <b>${duration(w.actual)}</b></td><td colspan="3">Référence ajustée : <b>${duration(w.weeklyReference)}</b></td><td colspan="3">Solde : <b>${w.allWeekdaysDone?signed(w.gap):'À compléter'}</b>${w.spansMonth?' †':''}</td></tr>`;
    }).join('');
    const vehicleText=m.vehicle.done===true?'☑ Oui  ☐ Non':m.vehicle.done===false?'☐ Oui  ☑ Non':'☐ Oui  ☐ Non';
    const netBox=m.incomplete.length?'À compléter':m.net>0?`+${duration(m.net)}`:m.net<0?signed(m.net):'0h00';
    const netLabel=m.net>0?'Solde horaire positif du mois':m.net<0?'Heures en moins (solde du mois)':'Solde du mois';
    $('printSheet').classList.toggle('p-dense',m.printable.length>22 || m.weeks.length>=6);
    $('printSheet').innerHTML=`<div class="p-month-header"><div class="p-month-brand"><img src="assets/logo-charriaut.png" alt="Logo Charriaut"><div><h1>RELEVÉ MENSUEL DES HEURES</h1><div class="p-month-title">CHARRIAUT · ${esc(m.label.toUpperCase())}</div></div></div><div class="p-month-person"><span><b>Nom :</b> ${esc(state.settings.lastName||'À renseigner')}</span><span><b>Prénom :</b> ${esc(state.settings.firstName||'À renseigner')}</span><span><b>E-mail :</b> ${esc(state.settings.employeeEmail||'À renseigner')}</span><span><b>Destinataire :</b> contact@charriaut.fr</span></div></div>
     <table class="p-month-table"><colgroup><col style="width:6%"><col style="width:8%"><col style="width:13%"><col style="width:7%"><col style="width:8%"><col style="width:13%"><col style="width:8%"><col style="width:8%"><col style="width:7%"><col style="width:22%"></colgroup><thead><tr><th>Date</th><th>Embauche</th><th>Lieu embauche</th><th>Pause</th><th>Débauche</th><th>Lieu débauche</th><th>Travail</th><th>Écart jour</th><th>Panier</th><th>Observation / Congés / RTT</th></tr></thead><tbody>${grid}</tbody></table>
     <div class="p-final-row"><div><small>Heures travaillées</small><b>${duration(m.actual)}</b></div><div><small>Base ajustée (congés / RTT)</small><b>${duration(m.target)}</b></div><div class="p-net"><small>${netLabel}</small><b>${netBox}</b></div><div><small>Paniers repas</small><b>${m.meals}</b></div></div>
     <div class="p-vehicle-row"><b>🚐 Contrôle des niveaux du véhicule en fin de mois :</b><span>${vehicleText}</span><span>Observation : ${esc(m.vehicle.note||'—')}</span></div>
     <div class="p-month-foot">Congés payés : ${m.leaves.filter(r=>r.calc.leaveType==='CP').length} jour(s) ouvré(s) · RTT : ${m.leaves.filter(r=>r.calc.leaveType==='RTT').length} jour(s) ouvré(s). † Les semaines chevauchant deux mois sont comptées intégralement. Les écarts journaliers sont indicatifs ; le solde mensuel est un suivi interne et ne remplace pas le calcul légal des heures supplémentaires sur la semaine. ${m.incomplete.length?'⚠ Relevé incomplet.':''} Édité le ${formatStamp(new Date().toISOString())}.</div>`;
  }
  function renderLeaves(){
    $('leaveStart').value||=selected;
    $('leaveEnd').value||=selected;
    const sorted=state.leaves.slice().sort((a,b)=>b.start.localeCompare(a.start));
    $('leaveList').innerHTML=sorted.length?sorted.map(l=>`<div class="leave-item"><div><strong>${esc(leaveLabel(l.type))}</strong><small>${esc(l.start.split('-').reverse().join('/'))} → ${esc(l.end.split('-').reverse().join('/'))}</small></div><button type="button" data-delete-leave="${esc(l.id)}">Supprimer</button></div>`).join(''):'<p class="leave-empty">Aucune période de congés ou RTT enregistrée.</p>';
    $('leaveList').querySelectorAll('[data-delete-leave]').forEach(el=>el.addEventListener('click',()=>{
      if(!confirm('Supprimer cette période de congés / RTT ?'))return;
      state.leaves=state.leaves.filter(l=>l.id!==el.dataset.deleteLeave);save();render();toast('Période supprimée.');
    }));
  }
  $('addLeave').addEventListener('click',()=>{
    const type=$('leaveType').value,start=$('leaveStart').value,end=$('leaveEnd').value;
    if(!['CP','RTT'].includes(type)||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(start)||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(end)||end<start){toast('Choisis deux dates correctes, dans l’ordre.');return;}
    const diff=Math.round((Date.parse(end+'T12:00:00')-Date.parse(start+'T12:00:00'))/86400000);
    if(diff>370){toast('Période limitée à un an.');return;}
    const keys=Array.from({length:diff+1},(_,i)=>dateKey(plusDays(dateFromKey(start),i))).filter(k=>weekdayIndex(k)<5);
    if(keys.some(k=>leaveOn(k))){toast('Cette période recoupe un congé ou RTT existant. Supprime d’abord l’ancienne période.');return;}
    if(keys.some(k=>{const d=getDay(k);return !!(d.start||d.end||d.lunchOut||d.lunchIn);})&&!confirm('Des pointages existent sur cette période. Ils seront conservés mais exclus du calcul tant que le congé / RTT est actif. Continuer ?'))return;
    state.leaves.push({id:String(Date.now())+'-'+state.leaves.length,type,start,end});save();render();toast(`${leaveLabel(type)} enregistrés du ${start} au ${end}.`);
  });
  function renderVehicle(m){
    $('vehicleMonth').textContent=m.label;
    $('vehicleChoices').querySelectorAll('[data-vehicle]').forEach(btn=>{const value=btn.dataset.vehicle==='yes';btn.classList.toggle('selected',m.vehicle.done===value);btn.setAttribute('aria-pressed',String(m.vehicle.done===value));});
    if(document.activeElement!==$('vehicleNote'))$('vehicleNote').value=m.vehicle.note||'';
  }
  function saveVehicle(change){
    const prev=state.vehicleChecks[reportMonth]||{done:null,note:'',at:''};
    state.vehicleChecks[reportMonth]={...prev,...change,at:new Date().toISOString()};save();renderMonthSummary();toast('Contrôle véhicule enregistré.');
  }
  $('vehicleChoices').querySelectorAll('[data-vehicle]').forEach(btn=>btn.addEventListener('click',()=>saveVehicle({done:btn.dataset.vehicle==='yes'})));
  $('vehicleNote').addEventListener('change',e=>saveVehicle({note:e.target.value.slice(0,180)}));
  function renderReminder(){
    const now=new Date();const last=new Date(now.getFullYear(),now.getMonth()+1,0).getDate();
    const isLast=now.getDate()===last;
    $('monthReminder').hidden=!isLast;
  }
  $('goToReport').addEventListener('click',()=>{reportMonth=dateKey(new Date()).slice(0,7);renderMonthSummary();$('monthCard').scrollIntoView({behavior:'smooth',block:'start'});});
  $('calendarReminder').addEventListener('click',()=>{
    const now=new Date();const year=now.getFullYear(),month=now.getMonth()+1,last=new Date(year,month,0).getDate();
    const date=`${year}${pad(month)}${pad(last)}`;
    const ics=[
      'BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//CHARRIAUT//POINTAGE//FR','CALSCALE:GREGORIAN','BEGIN:VEVENT',
      `UID:charriaut-envoi-pdf-mensuel-${year}@charriaut.fr`,`DTSTAMP:${now.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'')}`,
      `DTSTART:${date}T170000`,`DTEND:${date}T173000`,'RRULE:FREQ=MONTHLY;BYMONTHDAY=-1',
      'SUMMARY:CHARRIAUT - Envoyer PDF mensuel',
      'DESCRIPTION:Verifier les heures, paniers repas, conges, RTT et controle du vehicule. Envoyer le PDF a contact@charriaut.fr.',
      'BEGIN:VALARM','TRIGGER:-PT0M','ACTION:DISPLAY','DESCRIPTION:Envoyer le PDF mensuel a contact@charriaut.fr','END:VALARM','END:VEVENT','END:VCALENDAR'
    ].join('\r\n');
    download('CHARRIAUT_Rappel_PDF_fin_de_mois.ics',ics,'text/calendar;charset=utf-8');
    toast('Rappel calendrier téléchargé : importe-le puis active les alertes (17h, modifiable).');
  });
  $('prevMonth').addEventListener('click',()=>{archiveMonth=addMonth(archiveMonth,-1);renderArchive();});
  $('nextMonth').addEventListener('click',()=>{archiveMonth=addMonth(archiveMonth,1);renderArchive();});
  $('jumpDate').addEventListener('change',e=>{if(e.target.value)editDate(e.target.value);});
  $('viewAudit').addEventListener('click',()=>{
    const records=state.audit[selected]||[];
    $('auditTitle').textContent=`Modifications du ${selected.split('-').reverse().join('/')}`;
    $('auditRows').innerHTML=records.length?records.slice().reverse().map(e=>{
      const type=e.previous?'Correction':'Premier pointage';
      return `<div class="audit-item"><strong>${esc(AUDIT_LABELS[e.field]||e.field)} · ${type}</strong><small>${esc(formatStamp(e.at))}</small><div>${esc(e.previous||'Vide')} → <b>${esc(e.current||'Vide')}</b></div></div>`;
    }).join(''):'<p>Aucune correction enregistrée pour ce jour.</p>';
    $('auditDialog').showModal();
  });
  $('prevWeek').addEventListener('click',()=>moveWeek(-7));
  $('nextWeek').addEventListener('click',()=>moveWeek(7));
  function moveWeek(n){activeWeek=dateKey(plusDays(dateFromKey(activeWeek),n));selected=activeWeek===mondayOfKey(todayKey)?todayKey:activeWeek;render();}
  $('pauseOptions').querySelectorAll('[data-break]').forEach(btn=>btn.addEventListener('click',()=>setBreak(btn.dataset.break)));
  $('customBreakMinutes').addEventListener('change',e=>{
    const val=e.target.value.trim();
    if(val==='' || !/^\d+$/.test(val) || Number(val)>600){toast('Indique une durée entre 0 et 600 minutes.');return;}
    setDay(selected,{breakMode:'duration',breakPlan:'custom',breakMinutes:Number(val),noBreak:false});
    toast(`Pause personnalisée de ${duration(Number(val))} enregistrée ✓`);
  });
  $('dayNote').addEventListener('input',e=>{
    const text=e.target.value.slice(0,150);
    const before=getDay(selected);
    state.days[selected]={...before,note:text};
    save();
    $('dayNoteStatus').textContent=writeProblem?'⚠ Non enregistré':text?'Observation enregistrée ✓':'Enregistrement automatique';
  });
  $('offDay').addEventListener('click',()=>{
    const d=getDay(selected);
    if(!d.off&&(d.start||d.end||d.lunchOut||d.lunchIn)&&!confirm('Marquer non travaillée ? Les horaires saisis seront conservés, mais ignorés dans le calcul.'))return;
    setDay(selected,{off:!d.off});
  });
  function readyProfile(){
    const s=state.settings;
    if(s.firstName&&s.lastName&&s.employeeEmail&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.employeeEmail))return true;
    toast('Complète ton nom, prénom et e-mail dans les réglages.');openSettings();return false;
  }
  function confirmMonth(m){
    if(m.incomplete.length&&!confirm(`${m.incomplete.length} journée(s) ouvrée(s) incomplète(s) en ${m.label}. Préparer quand même le relevé ?`))return false;
    const missing=m.printable.flatMap(row=>LOCATION_FIELDS.filter(f=>row.d[f]&&!row.d.off&&!locationReady(getLocation(row.d,f))));
    if(missing.length&&!confirm(`${missing.length} lieu(x) manquant(s). Préparer le relevé quand même ?`))return false;
    return true;
  }
  $('prevReportMonth').addEventListener('click',()=>{reportMonth=addMonth(reportMonth,-1);renderMonthSummary();});
  $('nextReportMonth').addEventListener('click',()=>{reportMonth=addMonth(reportMonth,1);renderMonthSummary();});
  $('reportMonthInput').addEventListener('change',event=>{if(/^\d{4}-\d{2}$/.test(event.target.value)){reportMonth=event.target.value;renderMonthSummary();}});
  $('sendMail').addEventListener('click',()=>{
    if(!readyProfile())return;
    const m=monthData();if(!confirmMonth(m))return;
    const subj=`CHARRIAUT – Feuille d'heures – ${profileName()} – ${m.label}`;
    const to='contact@charriaut.fr';
    if(!to){toast('Renseigne l’adresse e-mail du bureau dans Mon profil.');openSettings();return;}
    // Only pre-fills an email draft; no attachment or sending is automatic.
    window.location.href=`mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subj)}&body=${encodeURIComponent(emailText(m))}`;
    toast('Mail mensuel préparé. Joins le PDF avant de l’envoyer.');
  });
  $('exportCsv').addEventListener('click',()=>{download(`pointage-charriaut-${reportMonth}.csv`,csvExport(monthData()),'text/csv;charset=utf-8');toast('CSV mensuel prêt.');});
  $('printPdf').addEventListener('click',async()=>{
    if(!readyProfile())return;
    const m=monthData();if(!confirmMonth(m))return;
    const btn=$('printPdf');btn.disabled=true;btn.textContent='Création du PDF en cours…';
    try{await generateMonthlyPdf(m);toast('PDF A4 paysage créé : cherche-le dans Téléchargements / Fichiers.');}
    catch(error){console.error(error);toast('PDF indisponible : réessaie ou utilise l’export CSV.');}
    finally{btn.disabled=false;btn.textContent='⬇ Télécharger mon PDF';}
  });
  function openSettings(){
    $('firstName').value=state.settings.firstName||'';
    $('lastName').value=state.settings.lastName||'';
    $('employeeEmail').value=state.settings.employeeEmail||'';
    $('legacyNameNotice').hidden=!!(state.settings.firstName||state.settings.lastName)||!state.settings.name;
    $('legacyNameNotice').textContent=state.settings.name?`Ancien nom enregistré : ${state.settings.name}. Répartis-le dans les deux champs ci-dessus.`:'';
    $('recipient').value='contact@charriaut.fr';
    const b=state.settings.lastBackupAt;
    $('backupState').textContent=b?`Dernier export demandé : ${formatStamp(b)}. Vérifie le fichier dans Fichiers / Drive.`:'Aucun export externe connu. Fais-en un chaque semaine.';
    $('settingsDialog').showModal();
  }
  $('settingsBtn').addEventListener('click',openSettings);
  $('editProfile').addEventListener('click',openSettings);
  $('settingsDialog').querySelector('form').addEventListener('submit',event=>{
    const nextFirst=$('firstName').value.trim().slice(0,90);
    const nextLast=$('lastName').value.trim().slice(0,90);
    const oldIdentity=[state.settings.firstName,state.settings.lastName].map(x=>String(x||'').trim().toLowerCase()).join('|');
    const newIdentity=[nextFirst,nextLast].map(x=>x.toLowerCase()).join('|');
    if(state.settings.firstName && state.settings.lastName && oldIdentity!==newIdentity && Object.keys(state.days).length && !confirm('Attention : changer de salarié sur le même appareil mélange les anciens pointages avec le nouveau profil. Continuer uniquement pour corriger une erreur de nom ?')){event.preventDefault();return;}
    state.settings.firstName=nextFirst;
    state.settings.lastName=nextLast;
    state.settings.employeeEmail=$('employeeEmail').value.trim().slice(0,180);
    state.settings.recipient='contact@charriaut.fr';
    save();render();
  });
  function updateBackupDisplay(){
    const b=state.settings.lastBackupAt;
    const stamp=b?new Date(b).getTime():0;
    const days=stamp?Math.floor((Date.now()-stamp)/86400000):null;
    const el=$('quickBackup');
    if(!el)return;
    el.textContent=days==null?'⬇ Faire ma première sauvegarde':days>=7?`⬇ Sauvegarde conseillée (${days} jours)`:'⬇ Sauvegarder une copie dans Fichiers';
    el.classList.toggle('backup-due',days==null||days>=7);
  }
  function backupNow(){
    const at=new Date().toISOString();
    const newState={...state,settings:{...state.settings,lastBackupAt:at}};
    download(`CHARRIAUT_sauvegarde_${dateKey(new Date())}_${(state.settings.lastName||'salarie').replace(/[^a-zA-ZÀ-ÿ0-9-]/g,'_').slice(0,24)}.json`,JSON.stringify({...newState,exportedAt:at},null,2),'application/json;charset=utf-8');
    state=newState;save();updateBackupDisplay();
    toast('Export lancé. Vérifie la présence du fichier dans Fichiers.');
  }
  $('backupBtn').addEventListener('click',backupNow);
  $('quickBackup').addEventListener('click',backupNow);
  $('quickRestore').addEventListener('click',()=>$('restoreFile').click());
  $('restoreBtn').addEventListener('click',()=>$('restoreFile').click());
  $('restoreFile').addEventListener('change',async e=>{
    const file=e.target.files&&e.target.files[0];if(!file)return;
    try{
      const data=JSON.parse(await file.text());
      if(file.size>5*1024*1024)throw Error('too big');
      if(data.version!==1||!data.days||Array.isArray(data.days)||typeof data.days!=='object'||!data.settings||typeof data.settings!=='object'||Array.isArray(data.settings))throw Error('format');
      if(Object.keys(data.days).some(k=>!/^\d{4}-\d{2}-\d{2}$/.test(k)))throw Error('days');
      if(!confirm('Remplacer les données de cette application par la sauvegarde choisie ?'))return;
      state={...defaults(),...data,settings:{...defaults().settings,...data.settings},audit:data.audit&&typeof data.audit==='object'?data.audit:{},leaves:Array.isArray(data.leaves)?data.leaves:[],vehicleChecks:data.vehicleChecks&&typeof data.vehicleChecks==='object'&&!Array.isArray(data.vehicleChecks)?data.vehicleChecks:{}};
      const ok=save();render();$('settingsDialog').close();if(ok)toast('Sauvegarde restaurée et enregistrée.');
    }catch(err){toast('Fichier de sauvegarde invalide.');}finally{e.target.value='';}
  });
  // Récupération d'une copie IndexedDB si la clé historique locale est vide.
  idbRead().then(json=>{
    const recovered=validState(json);
    if(!recovered)return;
    const currentHasData=Object.keys(state.days).length || state.leaves.length || Object.keys(state.vehicleChecks).length;
    if(!currentHasData && (Object.keys(recovered.days).length || recovered.leaves.length || Object.keys(recovered.vehicleChecks).length)){
      state=recovered;
      const ok=save();render();
      if(ok)toast('Une copie de secours locale a permis de retrouver les pointages.');
    }
  }).catch(()=>{});
  if('serviceWorker' in navigator && /^https?:$/.test(location.protocol)){
    window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
  }
  function updateConnection(){
    const offline=!navigator.onLine;
    $('connectionTip').textContent=offline?'📶 Hors ligne : les heures sont enregistrées sur cet appareil. Le mail nécessite Internet.':'';
    $('connectionTip').hidden=!offline;
  }
  window.addEventListener('online',updateConnection);
  window.addEventListener('offline',updateConnection);
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden)return;
    const now=dateKey(new Date());
    renderReminder();
    if(now!==todayKey){
      if(selected===todayKey){selected=now;activeWeek=mondayOfKey(now);archiveMonth=now.slice(0,7);reportMonth=now.slice(0,7);}
      todayKey=now;render();
    }
  });
  // V12 : raccourcis et bouton panier à sélection directe, sans double saisie.
  const toPanel=(id)=>{const el=$(id);if(!el)return;el.scrollIntoView({behavior:'smooth',block:'start'});};
  $('shortcutMeal').addEventListener('click',()=>{
    if(leaveOn(selected)||getDay(selected).off){toast('Cette journée est non travaillée.');return;}
    const active=getDay(selected).meal===true;
    setDay(selected,{meal:!active});
    toast(active?'Panier repas annulé.':'Panier repas ajouté ✓');
  });
  $('shortcutPdf').addEventListener('click',()=>toPanel('monthCard'));
  $('shortcutHistory').addEventListener('click',()=>toPanel('archiveCard'));
  $('shortcutLeave').addEventListener('click',()=>toPanel('leaveCard'));
  $('navHome').addEventListener('click',()=>toPanel('todayCard'));
  $('navHistory').addEventListener('click',()=>toPanel('archiveCard'));
  $('navDocs').addEventListener('click',()=>toPanel('monthCard'));
  $('menuBtn').addEventListener('click',()=>{const el=$('dateDisclosure');el.open=!el.open;if(el.open)toPanel('dateDisclosure');});
  document.querySelectorAll('[data-menu-target]').forEach(el=>el.addEventListener('click',()=>{$('menuPanel').hidden=true;$('menuBtn').setAttribute('aria-expanded','false');toPanel(el.dataset.menuTarget);}));
  render();updateConnection();updateSaveStatus(!writeProblem);
  const hasProfile=!!(state.settings.firstName&&state.settings.lastName&&state.settings.employeeEmail);
  if(!hasProfile){window.setTimeout(()=>{if(!$('settingsDialog').open)openSettings();},500);}
  // Export tested arithmetic to browser for optional on-device diagnostic (read-only).
  window.Pointage39hVersion='13.0.0-CHARRIAUT-PDF-Sauvegarde';
})();
