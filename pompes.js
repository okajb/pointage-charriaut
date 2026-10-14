/* CHARRIAUT – module pompes à vide V15 pilote Firebase
   Module autonome : ne modifie aucune donnée de pointage V14.
   Sessions et vidanges partagées via Firestore. Pas de fonctionnement hors ligne pour les opérations. */
import {initializeApp} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
  getAuth,onAuthStateChanged,sendSignInLinkToEmail,isSignInWithEmailLink,
  signInWithEmailLink,signOut
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
  getFirestore,doc,collection,getDoc,onSnapshot,runTransaction,
  serverTimestamp,Timestamp
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

const cfg={
  apiKey:"AIzaSyAtm8CARaeWyh_ncvjcxATTOJQS3ppyZNc",
  authDomain:"charriaut-entretien.firebaseapp.com",
  projectId:"charriaut-entretien",
  storageBucket:"charriaut-entretien.firebasestorage.app",
  messagingSenderId:"878437191970",
  appId:"1:878437191970:web:f2a2ac7319d48b9113957b"
};
const app=initializeApp(cfg,"charriaut-pompes");
const auth=getAuth(app);
const db=getFirestore(app);
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
const pad=n=>String(n).padStart(2,'0');
const date=t=>{
  const d=new Date(t);
  return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
};
const dateTime=t=>new Date(t).toLocaleString('fr-FR',{dateStyle:'short',timeStyle:'short'});
const dur=s=>Math.floor(Math.max(0,s)/3600)+' h '+pad(Math.floor(Math.max(0,s)%3600/60))+' min';
const ms=ts=>ts?.toMillis?.()??0;
const PUMPS={testo:{name:'TESTO',color:'orange'},value:{name:'VALUE',color:'blue'}};
const state={selected:'testo',user:null,approved:false,pumps:{},events:{testo:[],value:[]},unsub:[],busy:false};
const modal=document.createElement('dialog');
modal.id='pumpsDialog';
modal.className='pump-dialog';
modal.setAttribute('aria-label','Entretien des pompes à vide');
modal.innerHTML='<div class="pump-layout"><header class="pump-header"><div><small>CHARRIAUT · MODULE PARTAGÉ FIREBASE</small><h2>Entretien des pompes à vide</h2></div><button type="button" id="pumpsClose" class="pump-close" aria-label="Fermer">✕</button></header><div id="pumpsMessage" aria-live="polite"></div><div id="pumpsContent"></div></div>';
document.body.appendChild(modal);
const printArea=document.createElement('section');
printArea.id='pumpsPrintSheet';
printArea.setAttribute('aria-hidden','true');
document.body.appendChild(printArea);
const message=(t,error=false)=>{const el=$('pumpsMessage'); if(el)el.innerHTML=t?'<p class="pump-message '+(error?'error':'')+'">'+esc(t)+'</p>':'';};
const userProfile=()=>{
  try{
    const s=JSON.parse(localStorage.getItem('pointage39h.v1')||'{}').settings||{};
    return {name:[s.firstName,s.lastName].filter(Boolean).join(' ').trim()||s.name||'',email:String(s.employeeEmail||'').trim().toLowerCase()};
  }catch(e){return {name:'',email:''};}
};
const authReady=()=>state.user&&state.approved;
const refs=id=>doc(db,'pumps',id);
function stopListening(){
  state.unsub.splice(0).forEach(u=>{try{u();}catch(e){}});
  state.pumps={};state.events={testo:[],value:[]};
}
const readyName=()=>{
  const p=userProfile();
  if(!p.name||!p.email){throw Error('Renseigne d’abord ton nom, ton prénom et ton e-mail dans « Mon profil » Charriaut.');}
  if(p.email!==state.user?.email?.toLowerCase()){throw Error('L’adresse e-mail du profil Charriaut doit être la même que celle de ta connexion Firebase.');}
  return p.name;
};
function liveSeconds(id){
  const d=state.pumps[id]||{};
  const x=d.activeSession?.startedAt;
  const live=x?Math.max(0,Math.floor((Date.now()-ms(x))/1000)):0;
  return {seconds:Math.max(0,d.usedSeconds||0)+live,active:live};
}
function render(){
  if(!modal.open)return;
  if(!authReady()){
    const email=userProfile().email;
    const authState=state.user?'<p>Connecté : <strong>'+esc(state.user.email)+'</strong>. '+(state.approved?'':'Compte non autorisé ou e-mail non vérifié.')+'</p>':'<p>Pour consulter les compteurs communs, connecte-toi une fois grâce au lien envoyé par e-mail.</p>';
    $('pumpsContent').innerHTML='<div class="pump-info">'+authState+
      '<form id="pumpLoginForm"><label class="pump-login-label">Adresse e-mail du salarié<input type="email" id="pumpLoginEmail" required value="'+esc(email)+'" placeholder="prenom.nom@exemple.fr"></label><button type="submit" class="pump-action start">Recevoir mon lien de connexion</button></form>'+
      '<p class="pump-muted">Connexion sans mot de passe. Le projet gratuit Spark limite l’envoi à 5 liens par jour. Le lien doit être ouvert sur ce téléphone, idéalement dans le même navigateur.</p></div>';
    return;
  }
  const id=state.selected,p=PUMPS[id],d=state.pumps[id]||{},run=d.activeSession;
  const total=liveSeconds(id).seconds;
  const interval=(d.oilIntervalHours||10)*3600;
  const status=total>=interval?'VIDANGE À EFFECTUER':total>=interval*.8?'VIDANGE À PRÉVOIR':'En service';
  const cl=total>=interval?'overdue':total>=interval*.8?'soon':'ok';
  const pick=pumpId=>{
    const n=PUMPS[pumpId],v=state.pumps[pumpId];
    const sec=liveSeconds(pumpId).seconds;
    return '<button class="pump-tab '+n.color+' '+(pumpId===id?'selected':'')+'" data-pump="'+pumpId+'" type="button"><strong>'+n.name+'</strong><small>'+(v?dur(sec)+' / 10 h':'Chargement…')+'</small></button>';
  };
  const hist=(state.events[id]||[]).slice().sort((a,b)=>ms(b.at)-ms(a.at)).slice(0,45);
  $('pumpsContent').innerHTML='<div class="pump-user-line">Connecté : '+esc(state.user.email)+' <button type="button" id="pumpLogout">Déconnexion</button></div>'+
  '<div class="pump-tabs">'+pick('testo')+pick('value')+'</div>'+
  '<section class="pump-counter '+cl+'"><div class="pump-counter-top"><strong>'+p.name+'</strong><span>'+status+'</span></div><div class="pump-time">'+dur(total)+' <small>/ '+(d.oilIntervalHours||10)+' h</small></div><div class="pump-rail"><div style="width:'+Math.min(100,100*total/interval)+'%"></div></div><small>'+(d.lastOilAt?'Dernière vidange : '+dateTime(ms(d.lastOilAt)):'Dernière vidange non renseignée — état de l’huile à confirmer')+'</small></section>'+
  (run?'<div class="pump-info"><p class="pump-active">⏱ En cours depuis '+(ms(run.startedAt)?dateTime(ms(run.startedAt)):'quelques instants')+' · '+esc(run.byName)+'</p><p class="pump-muted">Fluide : '+esc(run.gas)+' · '+esc(run.job)+'</p><button type="button" class="pump-action finish" id="pumpStop">■ FIN D’UTILISATION</button></div>':
  '<form class="pump-info" id="pumpStartForm"><div class="pump-fields"><label>Nature du fluide / gaz<select name="gas" required><option>R32</option><option>R410A</option><option>AZOTE</option><option>AZOTE HYDROGÉNÉ</option><option value="AUTRE">Autre</option></select></label><label>Si autre : préciser<input name="other" maxlength="80" placeholder="Gaz utilisé"></label><label>Opération<select name="job"><option>Tirage au vide</option><option>Contrôle</option><option>Entretien</option><option>Autre intervention</option></select></label><label>Observation<textarea name="note" maxlength="600" rows="2" placeholder="Chantier, remarque..."></textarea></label></div><button type="submit" class="pump-action start">▶ DÉPART</button></form>')+
  '<div class="pump-info"><button class="pump-oil" id="pumpOil" '+(run?'disabled':'')+' type="button">✓ Vidange effectuée — remettre le compteur à zéro</button><p class="pump-muted">Chaque utilisation et vidange est enregistrée dans l’historique partagé, avec le compte du salarié.</p></div>'+
  '<section class="pump-history"><div class="pump-history-head"><h3>Historique '+p.name+'</h3><span>'+hist.length+' opérations affichées</span></div>'+
  (hist.length?'<div class="pump-events">'+hist.map(e=>'<div class="pump-event"><span><strong>'+(e.type==='oil'?'🛢 Vidange':esc(e.job||'Utilisation'))+'</strong><small>'+esc(ms(e.at)?dateTime(ms(e.at)):'Date en cours de sauvegarde')+' · '+esc(e.person||e.byName||e.byEmail||'')+'</small>'+(e.gas?'<small>Fluide : '+esc(e.gas)+'</small>':'')+(e.note?'<small>'+esc(e.note)+'</small>':'')+'</span><b>'+(e.type==='oil'?'✓':dur(e.seconds||0))+'</b></div>').join('')+'</div>':'<p class="pump-muted">Aucune opération enregistrée.</p>')+'</section>'+
  '<div class="pump-report"><label>Mois du relevé <input id="pumpsMonth" type="month" value="'+date(Date.now()).slice(0,7)+'"></label><button type="button" id="pumpPDF">Imprimer / PDF mensuel (2 pompes)</button></div>';
}
function startListening(){
  stopListening();
  Object.keys(PUMPS).forEach(id=>{
    state.unsub.push(onSnapshot(refs(id),snap=>{if(snap.exists())state.pumps[id]=snap.data();else message('Pompe '+id+' absente de Firebase',true);render();},e=>message('Lecture des pompes impossible : '+e.message,true)));
    state.unsub.push(onSnapshot(collection(refs(id),'events'),snap=>{
      state.events[id]=snap.docs.map(d=>({id:d.id,...d.data()}));
      render();
    },e=>message('Historique inaccessible : '+e.message,true)));
  });
}
function err(e){
  const m=String(e?.message||e||'Erreur inconnue');
  message('Action non enregistrée : '+m,true);
  alert('Action non enregistrée.\n'+m);
}
async function requireRun(fn){
  if(state.busy)return;
  state.busy=true;
  try{
    if(!navigator.onLine)throw Error('Connexion internet indispensable pour démarrer, arrêter ou enregistrer une vidange.');
    if(!authReady())throw Error('Connecte-toi d’abord.');
    const name=readyName();
    await fn(name);
    message('Opération enregistrée et partagée.');
  }catch(e){err(e);}
  finally{state.busy=false;}
}
async function startSession(fd){
  const gas=fd.get('gas')==='AUTRE'?String(fd.get('other')||'').trim():String(fd.get('gas')||'').trim();
  if(!gas||gas.length>80)throw Error('Précise le fluide.');
  const job=String(fd.get('job')||'').slice(0,80);
  const note=String(fd.get('note')||'').trim().slice(0,600);
  await requireRun(async name=>{
    await runTransaction(db,async tx=>{
      const pump=refs(state.selected);
      const snap=await tx.get(pump);
      if(!snap.exists())throw Error('Pompe absente de la base.');
      if(snap.data().activeSession)throw Error('Cette pompe est déjà en cours d’utilisation.');
      tx.update(pump,{
        activeSession:{byUid:state.user.uid,byEmail:state.user.email.toLowerCase(),byName:name,gas,job,note,startedAt:serverTimestamp()},
        lastActionAt:serverTimestamp()
      });
    });
  });
}
async function finishSession(){
  await requireRun(async name=>{
    const id=state.selected;
    const eventRef=doc(collection(refs(id),'events'));
    await runTransaction(db,async tx=>{
      const pump=refs(id),snap=await tx.get(pump);
      if(!snap.exists())throw Error('Pompe inconnue.');
      const prev=snap.data(),s=prev.activeSession;
      if(!s||!ms(s.startedAt))throw Error('Aucune session à arrêter. Réessaie après la synchronisation.');
      const seconds=Math.max(1,Math.round((Date.now()-ms(s.startedAt))/1000));
      if(seconds>48*3600)throw Error('Utilisation de plus de 48 heures : vérifier le compteur avec un responsable.');
      tx.update(pump,{
        activeSession:null,usedSeconds:(prev.usedSeconds||0)+seconds,
        lifetimeSeconds:(prev.lifetimeSeconds||0)+seconds,
        lastEventId:eventRef.id,lastActionAt:serverTimestamp()
      });
      tx.set(eventRef,{
        type:'usage',at:serverTimestamp(),startedAt:s.startedAt,
        person:s.byName,byEmail:s.byEmail,byUid:s.byUid,
        endedBy:name,endedByUid:state.user.uid,
        gas:s.gas,job:s.job,note:s.note,seconds
      });
    });
  });
}
async function oilChange(){
  const observation=prompt('Observation sur la vidange (facultatif) :','');
  if(observation===null)return;
  if(!confirm('Confirmer la vidange et remettre le compteur à zéro ? L’historique restera enregistré.'))return;
  await requireRun(async name=>{
    const id=state.selected,eventRef=doc(collection(refs(id),'events'));
    await runTransaction(db,async tx=>{
      const pump=refs(id),snap=await tx.get(pump);
      if(!snap.exists())throw Error('Pompe inconnue.');
      const p=snap.data();
      if(p.activeSession)throw Error('Termine l’utilisation avant la vidange.');
      tx.update(pump,{usedSeconds:0,lastOilAt:serverTimestamp(),lastActionAt:serverTimestamp(),lastEventId:eventRef.id});
      tx.set(eventRef,{type:'oil',at:serverTimestamp(),person:name,byEmail:state.user.email.toLowerCase(),byUid:state.user.uid,note:observation.slice(0,600),previousSeconds:p.usedSeconds||0});
    });
  });
}
function report(month){
  if(!/^\d{4}-\d{2}$/.test(month))return;
  const all=Object.keys(PUMPS).flatMap(id=>(state.events[id]||[]).filter(e=>ms(e.at)&&date(ms(e.at)).startsWith(month)).map(e=>({...e,pump:id}))).sort((a,b)=>ms(a.at)-ms(b.at));
  const total=id=>all.filter(e=>e.pump===id&&e.type==='usage').reduce((x,e)=>x+(e.seconds||0),0);
  printArea.innerHTML='<div class="pump-print"><h1>CHARRIAUT · Entretien des pompes à vide</h1><p>Relevé mensuel '+esc(month)+' · Édité le '+date(Date.now())+'</p><div class="pump-print-summary">TESTO : '+dur(total('testo'))+' · VALUE : '+dur(total('value'))+'</div><table><thead><tr><th>Date</th><th>Pompe</th><th>Salarié</th><th>Opération</th><th>Fluide</th><th>Durée</th><th>Observations</th></tr></thead><tbody>'+
    (all.length?all.map(e=>'<tr><td>'+esc(dateTime(ms(e.at)))+'</td><td>'+PUMPS[e.pump].name+'</td><td>'+esc(e.person||'')+'</td><td>'+esc(e.type==='oil'?'VIDANGE':e.job||'Utilisation')+'</td><td>'+esc(e.gas||'—')+'</td><td>'+(e.type==='oil'?'—':dur(e.seconds||0))+'</td><td>'+esc(e.note||'')+'</td></tr>').join(''):'<tr><td colspan="7">Aucune intervention pour ce mois.</td></tr>')+
    '</tbody></table><p class="pump-foot">Relevé des actions enregistrées sur Firebase. Les compteurs tiennent compte des sessions terminées et du temps de la session active.</p></div>';
  document.body.classList.add('pumps-print');
  window.print();
}
$('pumpsClose').addEventListener('click',()=>modal.close());
$('pumpsOpen')?.addEventListener('click',()=>{
  modal.showModal();message('');render();
});
$('pumpsContent').addEventListener('click',async event=>{
  const tab=event.target.closest('[data-pump]');
  if(tab){state.selected=tab.dataset.pump;render();return;}
  if(event.target.closest('#pumpLogout')){await signOut(auth);return;}
  if(event.target.closest('#pumpStop')){await finishSession();return;}
  if(event.target.closest('#pumpOil')){await oilChange();return;}
  if(event.target.closest('#pumpPDF')){report($('pumpsMonth').value);}
});
$('pumpsContent').addEventListener('submit',async event=>{
  if(event.target.id==='pumpLoginForm'){
    event.preventDefault();
    const email=String($('pumpLoginEmail').value||'').trim().toLowerCase();
    if(!email||!email.includes('@'))return;
    try{
      await sendSignInLinkToEmail(auth,email,{url:'https://okajb.github.io/pointage-charriaut/',handleCodeInApp:true});
      localStorage.setItem('charriaut.pompes.loginEmail',email);
      message('Lien envoyé. Ouvre-le depuis ton téléphone. Il peut être nécessaire de revenir au navigateur.');
    }catch(e){err(e);}
  }
  if(event.target.id==='pumpStartForm'){
    event.preventDefault();
    try{await startSession(new FormData(event.target));}catch(e){err(e);}
  }
});
onAuthStateChanged(auth,async user=>{
  stopListening();state.user=user;state.approved=false;render();
  if(!user)return;
  try{
    const email=String(user.email||'').toLowerCase();
    if(!user.emailVerified)throw Error('Adresse e-mail non vérifiée.');
    const record=await getDoc(doc(db,'authorizedEmployees',email));
    if(!record.exists()||record.data().active!==true)throw Error('Adresse non encore autorisée par Charriaut.');
    state.approved=true;
    startListening();
  }catch(e){message(e.message,true);}finally{render();}
});
(async()=>{
  if(!isSignInWithEmailLink(auth,window.location.href))return;
  const email=localStorage.getItem('charriaut.pompes.loginEmail')||prompt('Confirme ton adresse e-mail pour terminer la connexion :');
  if(!email)return;
  try{
    await signInWithEmailLink(auth,email,window.location.href);
    localStorage.removeItem('charriaut.pompes.loginEmail');
    history.replaceState(null,'',window.location.origin+window.location.pathname);
  }catch(e){message('Lien de connexion impossible : '+e.message,true);}
})();
window.setInterval(()=>{if(modal.open&&authReady()&&state.pumps[state.selected]?.activeSession)render();},30000);
window.addEventListener('afterprint',()=>document.body.classList.remove('pumps-print'));
window.addEventListener('beforeprint',()=>{if(!document.body.classList.contains('pumps-print'))printArea.innerHTML='';});
