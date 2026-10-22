/* CHARRIAUT V15 – module des pompes réelles TESTO et VALUE.
   Pointages V14 conservés en local. Sessions et vidanges partagées via Firestore.
   Les compteurs réels sont initialisés : pas de remise à zéro de départ. */
import {initializeApp} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {
  getAuth,onAuthStateChanged,signInWithEmailAndPassword,createUserWithEmailAndPassword,
  sendEmailVerification,sendPasswordResetEmail,updatePassword,reload,
  signOut,setPersistence,browserLocalPersistence
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {
  getFirestore,doc,collection,getDoc,getDocFromServer,onSnapshot,runTransaction,
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
const app=initializeApp(cfg); // Auth partagée avec les pages de test sur ce domaine
const auth=getAuth(app);
auth.languageCode='fr';
// Chaque appareil garde sa propre session jusqu'à une déconnexion explicite.
// Safari et les PWA iOS ont des espaces de stockage différents.
const authPersistenceReady=setPersistence(auth,browserLocalPersistence).then(()=>true).catch(()=>false);
const requirePersistentAuth=async()=>{
  if(!await authPersistenceReady){
    throw Error('Impossible de mémoriser la connexion sur cet appareil. Vérifie que le stockage local est autorisé.');
  }
};
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
const secPart=s=>pad(Math.floor(Math.max(0,s)%60))+' s';
const durPrecise=s=>dur(s)+' '+secPart(s);
const durRecord=s=>{const n=Math.max(0,Math.floor(Number(s)||0)); return dur(n)+(n%60?' '+pad(n%60)+' s':'');};
const ms=ts=>ts?.toMillis?.()??0;
const PUMPS={testo:{name:'TESTO',color:'orange'},value:{name:'VALUE',color:'blue'}};
const state={selected:'testo',user:null,approved:false,isAdmin:false,authInitializing:true,authChecking:false,authScreenMode:'login',authError:'',authBusy:false,pumps:{},events:{testo:[],value:[]},archives:{testo:[],value:[]},unsub:[],busy:false};
const REFRESH_AFTER_STALE_STOP = true; // Resynchronisation après un arrêt déjà fait sur un autre appareil.
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
/* Profil du pointage V14 conservé : aucune migration ni suppression des heures. */
const userProfile=()=>{
  try{
    const s=JSON.parse(localStorage.getItem('pointage39h.v1')||'{}').settings||{};
    return {
      name:[s.firstName,s.lastName].filter(Boolean).join(' ').trim()||String(s.name||'').trim(),
      email:String(s.employeeEmail||'').trim().toLowerCase()
    };
  }catch(e){return {name:'',email:''};}
};
const PILOT_MODE = false; // Les deux pompes réelles, jamais les pompes de test.
const REAL_WRITES_ENABLED = true; // Utilisation et vidange des vraies pompes autorisées par les règles Firebase.
const REAL_INIT_ENABLED = false; // Initialisation réelle déjà effectuée séparément, jamais disponible ici.
async function createPilotPumps(){
  if(!PILOT_MODE){err(Error('La création de nouvelles pompes réelles est interdite depuis cette interface.'));return;}
  if(!state.isAdmin){err(Error('Réservé à l’administrateur.'));return;}
  if(!confirm('Créer deux compteurs DE TEST TESTO et VALUE dans Firebase ? Les véritables pompes restent inchangées.'))return;
  try {
    await runTransaction(db,async tx=>{
      const testo=refs('testo'),value=refs('value');
      const t=await tx.get(testo),v=await tx.get(value);
      const init=id=>({
        name:PUMPS[id].name,color:PUMPS[id].color,oilIntervalHours:10,
        usedSeconds:0,lifetimeSeconds:0,activeSession:null,
        createdAt:serverTimestamp(),createdBy:state.user.email.toLowerCase()
      });
      if(!t.exists())tx.set(testo,init('testo'));
      if(!v.exists())tx.set(value,init('value'));
    });
    message('Pompes de test prêtes. Initialise chaque compteur à 0 h 00 pour commencer.');
  } catch(e){err(e);}
}
document.addEventListener('click',e=>{if(e.target.closest('#createPilotPumps'))createPilotPumps();});
const authReady=()=>state.user&&state.approved;
const refs=id=>doc(db,PILOT_MODE?'pilotPumps':'pumps',id);
function stopListening(){
  state.unsub.splice(0).forEach(u=>{try{u();}catch(e){}});
  state.pumps={};state.events={testo:[],value:[]};state.archives={testo:[],value:[]};
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
// Affichage local uniquement : la durée officielle est écrite dans Firebase à la FIN.
function tickLive(){
  if(!modal.open||!authReady())return;
  const id=state.selected;
  const d=state.pumps[id];
  if(!d)return;
  const active=liveSeconds(id);
  const total=active.seconds;
  const setText=(name,value)=>{const el=$(name);if(el && el.textContent!==value)el.textContent=value;};
  setText('pumpElapsedTotal',dur(total));
  setText('pumpElapsedSeconds',secPart(total));
  if(d.activeSession)setText('pumpLiveSession',durPrecise(active.active));
  for(const otherId of ['testo','value']){
    setText('pumpTab-'+otherId,dur(liveSeconds(otherId).seconds)+' / 10 h');
  }
  const el=$('pumpProgress');
  const interval=(d.oilIntervalHours||10)*3600;
  if(el)el.style.width=Math.min(100,100*total/interval)+'%';
  const initialized=Number.isFinite(d.usedSeconds)&&!!d.trackingStartedAt;
  const status=!initialized?'SUIVI À INITIALISER':total>=interval?'10 H — VIDANGE À EFFECTUER':total>=interval*.8?'VIDANGE À PRÉVOIR':!d.lastOilAt?'HUILE À CONTRÔLER':'En service';
  setText('pumpStatus',status);
  const counter=$('pumpCounter');
  if(counter){
    counter.classList.toggle('overdue',total>=interval);
    counter.classList.toggle('soon',total<interval&&(!initialized||total>=interval*.8||!d.lastOilAt));
    counter.classList.toggle('ok',initialized&&total<interval*.8&&!!d.lastOilAt);
  }
}
function render(){
  if(!modal.open)return;
  if(state.authInitializing || state.authChecking){
    $('pumpsContent').innerHTML='<div class="pump-info"><p>Vérification de ta connexion CHARRIAUT…</p></div>';
    return;
  }
  if(!authReady()){
    const email=state.user?.email||userProfile().email;
    const authError=state.authError?'<p class="pump-muted">'+esc(state.authError)+'</p>':'';
    if(state.user && !state.user.emailVerified){
      $('pumpsContent').innerHTML=authError+"<div class=\"pump-info\">\n <strong>Adresse e-mail à vérifier</strong><p>Un mail de validation a été envoyé. Ouvre ce mail une seule fois, puis reviens ici et clique sur « J’ai validé mon e-mail ».</p>\n <button type=\"button\" class=\"pump-action start\" id=\"pumpCheckVerification\">J’ai validé mon e-mail</button>\n <button type=\"button\" class=\"pump-link-button\" id=\"pumpResendVerification\">Renvoyer le mail de validation</button>\n <button type=\"button\" class=\"pump-link-button\" id=\"pumpLogoutUnverified\">Changer de compte</button>\n </div>";
      return;
    }
    if(state.user){
      $('pumpsContent').innerHTML=authError+"<div class=\"pump-info\"><strong>Accès aux pompes non autorisé</strong><p>Ce compte ne figure pas parmi les salariés actifs autorisés par CHARRIAUT. Demande au bureau de vérifier ton adresse dans Firebase.</p><button type=\"button\" class=\"pump-link-button\" id=\"pumpLogoutUnverified\">Utiliser un autre compte</button></div>";
      return;
    }
    const mode=state.authScreenMode;
    const title=mode==='signup'?'Créer mon compte CHARRIAUT':mode==='reset'?'Définir ou retrouver mon mot de passe':'Connexion CHARRIAUT';
    const body=mode==='signup'?"<form id=\"pumpPasswordSignupForm\">\n  <label class=\"pump-login-label\">Adresse e-mail professionnelle autorisée<input type=\"email\" name=\"email\" autocomplete=\"username\" required></label>\n  <label class=\"pump-login-label\">Choisir mon mot de passe (12 caractères minimum)<input type=\"password\" name=\"password\" autocomplete=\"new-password\" minlength=\"12\" required></label>\n  <label class=\"pump-login-label\">Confirmer le mot de passe<input type=\"password\" name=\"confirmPassword\" autocomplete=\"new-password\" minlength=\"12\" required></label>\n  <button class=\"pump-action start\" type=\"submit\">Créer mon compte</button>\n</form>\n<p class=\"pump-muted\">Une seule validation par e-mail est nécessaire à la création du compte. Seules les adresses activées par CHARRIAUT dans Firebase peuvent utiliser les pompes.</p>\n<button type=\"button\" class=\"pump-link-button\" data-auth-screen=\"login\">J’ai déjà un mot de passe</button>\n<button type=\"button\" class=\"pump-link-button\" data-auth-screen=\"reset\">Mon compte existait déjà : définir mon mot de passe</button>":mode==='reset'?"<form id=\"pumpPasswordResetForm\">\n  <label class=\"pump-login-label\">Adresse e-mail du compte existant<input type=\"email\" name=\"email\" autocomplete=\"username\" required></label>\n  <button class=\"pump-action start\" type=\"submit\">Recevoir le mail pour choisir mon mot de passe</button>\n</form>\n<p class=\"pump-muted\">Pour les salariés déjà connectés auparavant par un lien e-mail : clique une seule fois, puis ouvre le mail de réinitialisation. Tu pourras choisir ton mot de passe sans changer ton compte Firebase.</p>\n<p class=\"pump-muted\">Si aucun compte Firebase n’existe encore à cette adresse, utilise « Créer mon accès ».</p>\n<button type=\"button\" class=\"pump-link-button\" data-auth-screen=\"login\">Retour à la connexion</button>\n<button type=\"button\" class=\"pump-link-button\" data-auth-screen=\"signup\">Créer mon accès</button>":"<form id=\"pumpPasswordLoginForm\">\n  <label class=\"pump-login-label\">Adresse e-mail<input type=\"email\" name=\"email\" autocomplete=\"username\" required></label>\n  <label class=\"pump-login-label\">Mot de passe personnel<input type=\"password\" name=\"password\" autocomplete=\"current-password\" required></label>\n  <button class=\"pump-action start\" type=\"submit\">Se connecter</button>\n</form>\n<p class=\"pump-muted\">La connexion reste mémorisée sur cet appareil, sauf déconnexion volontaire ou suppression de ses données.</p>\n<button type=\"button\" class=\"pump-link-button\" data-auth-screen=\"reset\">Première connexion avec un ancien compte ? / Mot de passe oublié</button>\n<button type=\"button\" class=\"pump-link-button\" data-auth-screen=\"signup\">Je suis nouveau : créer mon accès</button>";
    $('pumpsContent').innerHTML='<div class="pump-info"><h3>'+esc(title)+'</h3>'+authError+body+'</div>';
    // Chaque formulaire possède le même champ e-mail : le profil local facilite la saisie.
    const emailInput=$('pumpsContent').querySelector('input[name="email"]');
    if(emailInput && email)emailInput.value=email;
    return;
  }
  const id=state.selected,p=PUMPS[id],d=state.pumps[id]||{},run=d.activeSession;
  const total=liveSeconds(id).seconds;
  const interval=(d.oilIntervalHours||10)*3600;
  const initialized=Number.isFinite(d.usedSeconds) && !!d.trackingStartedAt;
  const oilVerified=!!d.lastOilAt;
  const status=!initialized?'SUIVI À INITIALISER':total>=interval?'10 H — VIDANGE À EFFECTUER':total>=interval*.8?'VIDANGE À PRÉVOIR':!oilVerified?'HUILE À CONTRÔLER':'En service';
  const cl=!initialized?'soon':total>=interval?'overdue':total>=interval*.8?'soon':!oilVerified?'soon':'ok';
  const pick=pumpId=>{
    const n=PUMPS[pumpId],v=state.pumps[pumpId];
    const sec=liveSeconds(pumpId).seconds;
    return '<button class="pump-tab '+n.color+' '+(pumpId===id?'selected':'')+'" data-pump="'+pumpId+'" type="button"><strong>'+n.name+'</strong><small id="pumpTab-'+pumpId+'">'+(v?dur(sec)+' / 10 h':'Chargement…')+'</small></button>';
  };
  const hist=(state.events[id]||[]).slice().sort((a,b)=>ms(b.at)-ms(a.at)).slice(0,45);
  const legacy=(state.archives[id]||[]).slice().sort((a,b)=>a.sourceRow-b.sourceRow);
  const legacyMin=legacy.filter(e=>e.type==='usage').reduce((n,e)=>n+(e.durationMinutes||0),0);
  $('pumpsContent').innerHTML='<div class="pump-user-line">Connecté : '+esc(state.user.email)+' · '+(PILOT_MODE?'APERÇU V15 / TEST':'POMPES RÉELLES · SUIVI ACTIF')+' <button type="button" id="pumpSetupPassword">Mot de passe</button> <button type="button" id="pumpLogout">Déconnexion</button></div>'+ 
  (state.authScreenMode==='setpassword'?"<div class=\"pump-info\">\n <strong>Définir ou changer mon mot de passe</strong>\n <form id=\"pumpSetPasswordForm\">\n  <label class=\"pump-login-label\">Nouveau mot de passe personnel (12 caractères minimum)<input type=\"password\" name=\"password\" autocomplete=\"new-password\" minlength=\"12\" required></label>\n  <label class=\"pump-login-label\">Confirmer le nouveau mot de passe<input type=\"password\" name=\"confirmPassword\" autocomplete=\"new-password\" minlength=\"12\" required></label>\n  <button class=\"pump-action start\" type=\"submit\">Enregistrer mon mot de passe</button>\n </form>\n <p class=\"pump-muted\">Si Firebase demande une connexion récente, utilise « Mot de passe oublié » après déconnexion. Ton accès aux pompes sera conservé.</p>\n <button type=\"button\" id=\"pumpCancelSetPassword\" class=\"pump-link-button\">Annuler</button></div>":'')+
  (!state.pumps.testo || !state.pumps.value?'<div class="pump-info"><p class="pump-muted">'+(PILOT_MODE?'Les compteurs de test sont à créer avant le premier essai.':'Document de pompe réelle absent : contacter l’administrateur.')+'</p>'+(PILOT_MODE&&state.isAdmin?'<button type="button" class="pump-action start" id="createPilotPumps">Créer les deux pompes de test</button>':'')+'</div>':'')+
  '<div class="pump-tabs">'+pick('testo')+pick('value')+'</div>'+
  '<section class="pump-counter '+cl+'" id="pumpCounter"><div class="pump-counter-top"><strong>'+p.name+'</strong><span id="pumpStatus">'+status+'</span></div><div class="pump-time"><span id="pumpElapsedTotal">'+dur(total)+'</span> <span class="pump-seconds" id="pumpElapsedSeconds">'+secPart(total)+'</span> <small>/ '+(d.oilIntervalHours||10)+' h</small></div><div class="pump-rail"><div id="pumpProgress" style="width:'+Math.min(100,100*total/interval)+'%"></div></div><small>'+(d.lastOilAt?'Dernière vidange réelle : '+dateTime(ms(d.lastOilAt)):'Date de la dernière vidange inconnue. Le zéro est uniquement le départ du suivi.')+'</small></section>'+
  (!initialized?'<div class="pump-info"><p class="pump-muted">Le nouvel historique commence à zéro, sans déclaration de vidange d’huile.</p>'+(state.isAdmin?'<button type="button" id="pumpInit" class="pump-action start">Initialiser le suivi à 0 h 00</button>':'<p class="pump-muted">En attente de l’initialisation par un administrateur.</p>')+'</div>':'')+
  (run?'<div class="pump-info"><p class="pump-active">⏱ En cours depuis '+(ms(run.startedAt)?dateTime(ms(run.startedAt)):'quelques instants')+' · '+esc(run.byName)+'</p><p class="pump-session-time">Temps de cette utilisation : <strong id="pumpLiveSession">'+durPrecise(liveSeconds(id).active)+'</strong></p><p class="pump-muted">Fluide : '+esc(run.gas)+' · '+esc(run.job)+'</p><button type="button" class="pump-action finish" id="pumpStop" '+(!ms(run.startedAt)||state.busy?'disabled':'')+'>'+(ms(run.startedAt)?'■ FIN D’UTILISATION':'Synchronisation du départ…')+'</button></div>':
  '<form class="pump-info" id="pumpStartForm"><div class="pump-fields"><label>Nature du fluide / gaz<select name="gas" required><option>R32</option><option>R410A</option><option>AZOTE</option><option>AZOTE HYDROGÉNÉ</option><option value="AUTRE">Autre</option></select></label><label>Si autre : préciser<input name="other" maxlength="80" placeholder="Gaz utilisé"></label><label>Opération<select name="job"><option>Tirage au vide</option><option>Contrôle</option><option>Entretien</option><option>Autre intervention</option></select></label><label>Observation<textarea name="note" maxlength="600" rows="2" placeholder="Chantier, remarque..."></textarea></label></div><button type="submit" class="pump-action start" '+(initialized&&!state.busy?'':'disabled title="Attendre la synchronisation ou l’initialisation du compteur"')+'>▶ DÉPART</button>'+(initialized?'':'<p class="pump-muted">L’administrateur doit initialiser le nouveau suivi avant le démarrage.</p>')+'</form>')+
  '<div class="pump-info"><button class="pump-oil" id="pumpOil" '+(run||!initialized||state.busy?'disabled':'')+' type="button">✓ Vidange effectuée — remettre le compteur à zéro</button><p class="pump-muted">Chaque utilisation et vidange est enregistrée dans l’historique partagé, avec le compte du salarié.</p></div>'+
  '<section class="pump-history"><div class="pump-history-head"><h3>Historique '+p.name+'</h3><span>'+hist.length+' opérations affichées</span></div>'+
  (hist.length?'<div class="pump-events">'+hist.map(e=>'<div class="pump-event"><span><strong>'+(e.type==='oil'?'🛢 Vidange':esc(e.job||'Utilisation'))+'</strong><small>'+esc(ms(e.at)?dateTime(ms(e.at)):'Date en cours de sauvegarde')+' · '+esc(e.person||e.byName||e.byEmail||'')+'</small>'+(e.gas?'<small>Fluide : '+esc(e.gas)+'</small>':'')+(e.note?'<small>'+esc(e.note)+'</small>':'')+'</span><b>'+(e.type==='oil'?'✓':dur(e.seconds||0))+'</b></div>').join('')+'</div>':'<p class="pump-muted">Aucune opération enregistrée.</p>')+'</section>'+
  '<section class="pump-history pump-legacy"><div class="pump-history-head"><h3>Archives 2026 · '+p.name+'</h3><span>'+dur(legacyMin*60)+' cumulées</span></div><p class="pump-muted">'+legacy.length+' anciennes opérations enregistrées séparément du compteur actuel.</p><div class="pump-events">'+legacy.map(e=>'<div class="pump-event"><span><strong>'+(e.type==='oil'?'🛢 Vidange':esc(e.operation||'Utilisation'))+'</strong><small>'+esc(e.dateAsWritten||'Date inconnue')+(e.client?' · Client : '+esc(e.client):'')+(e.gasAsWritten?' · Gaz : '+esc(e.gasAsWritten):'')+'</small></span><b>'+(e.type==='oil'?'✓':dur((e.durationMinutes||0)*60))+'</b></div>').join('')+'</div></section>'+
  '<div class="pump-report"><label>Mois du relevé <input id="pumpsMonth" type="month" value="'+date(Date.now()).slice(0,7)+'"></label><button type="button" id="pumpPDF">Imprimer / PDF mensuel (2 pompes)</button></div>';
  if(!PILOT_MODE && !REAL_WRITES_ENABLED){
    const content=$('pumpsContent');
    content.insertAdjacentHTML('afterbegin','<div class="pump-info"><strong>🔒 POMPES RÉELLES : UTILISATION ET VIDANGE BLOQUÉES</strong><p class="pump-muted">Aucune écriture n’est activée pour cette préparation intégrée au pointage. Départ, Fin, Vidange et Initialisation restent désactivés.</p></div>');
    // Les boutons bloqués doivent aussi paraître bloqués : ne jamais inviter à démarrer une vraie pompe.
    const stopButton=$('pumpStop');
    if(stopButton){stopButton.disabled=true;stopButton.textContent='🔒 FIN D’UTILISATION — INDISPONIBLE';}
    const oilButton=$('pumpOil');
    if(oilButton){oilButton.disabled=true;oilButton.textContent='🔒 VIDANGE — INDISPONIBLE';}
    const initButton=$('pumpInit');
    if(initButton){initButton.disabled=true;initButton.textContent='🔒 INITIALISATION — INDISPONIBLE';}
    const startButton=content.querySelector('#pumpStartForm button[type="submit"]');
    if(startButton){startButton.disabled=true;startButton.textContent='🔒 DÉPART — INDISPONIBLE';}
  }
  tickLive();
}
function startListening(){
  stopListening();
  Object.keys(PUMPS).forEach(id=>{
    state.unsub.push(onSnapshot(refs(id),snap=>{if(snap.exists())state.pumps[id]=snap.data();else message('Pompe '+id+' absente de Firebase',true);render();},e=>message('Lecture des pompes impossible : '+e.message,true)));
    state.unsub.push(onSnapshot(collection(doc(db,'pumps',id),'history'),snap=>{
      state.archives[id]=snap.docs.map(d=>d.data()).filter(d=>d.isHistorical===true);
      render();
    },e=>message('Archives inaccessibles : '+e.message,true)));
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
async function requireRun(fn, operation='usage'){
  if(!PILOT_MODE && !REAL_WRITES_ENABLED && !(operation==='init' && REAL_INIT_ENABLED && state.isAdmin)){
    err(Error('Démarrage, arrêt et vidange des pompes réelles bloqués dans cet aperçu.'));
    return;
  }
  if(PILOT_MODE&&!state.isAdmin){err(Error('Essai réservé à l’administrateur. Les salariés auront accès après validation.'));return;}
  if(state.busy)return;
  state.busy=true;
  ['pumpStop','pumpOil','pumpInit'].forEach(id=>{const button=$(id);if(button)button.disabled=true;});
  const startButton=$('pumpStartForm')?.querySelector('button[type="submit"]');
  if(startButton)startButton.disabled=true;
  try{
    if(!navigator.onLine)throw Error('Connexion internet indispensable pour démarrer, arrêter ou enregistrer une vidange.');
    if(!authReady())throw Error('Connecte-toi d’abord.');
    const name=readyName();
    const result=await fn(name);
    message(result?.alreadyStopped?'Cette utilisation avait déjà été arrêtée depuis un autre appareil. Compteur actualisé.':'Opération enregistrée et partagée.');
  }catch(e){err(e);}
  finally{state.busy=false;render();}
}
async function startSession(fd){
  const gas=fd.get('gas')==='AUTRE'?String(fd.get('other')||'').trim():String(fd.get('gas')||'').trim();
  if(!gas||gas.length>80)throw Error('Précise le fluide.');
  const job=String(fd.get('job')||'').slice(0,80);
  const note=String(fd.get('note')||'').trim().slice(0,600);
  const id=state.selected;
  await requireRun(async name=>{
    await runTransaction(db,async tx=>{
      const pump=refs(id);
      const snap=await tx.get(pump);
      if(!snap.exists())throw Error('Pompe absente de la base.');
      if(snap.data().activeSession)throw Error('Cette pompe est déjà en cours d’utilisation.');
      if(!snap.data().trackingStartedAt || typeof snap.data().usedSeconds!=='number')throw Error('Le nouveau compteur doit être initialisé par un administrateur avant de démarrer.');
      tx.update(pump,{
        activeSession:{byUid:state.user.uid,byEmail:state.user.email.toLowerCase(),byName:name,gas,job,note,startedAt:serverTimestamp()},
        lastActionAt:serverTimestamp()
      });
    });
  });
}
async function finishSession(){
  const id=state.selected;
  // Pas d'arrêt tant que le timestamp de départ n'est pas confirmé par Firebase.
  const visibleSession=state.pumps[id]?.activeSession;
  if(visibleSession && !ms(visibleSession.startedAt)){
    err(Error('Démarrage encore en cours de synchronisation. Patiente quelques secondes avant de terminer.'));
    return;
  }
  await requireRun(async name=>{
    const eventRef=doc(collection(refs(id),'events'));
    const result=await runTransaction(db,async tx=>{
      const pump=refs(id),snap=await tx.get(pump);
      if(!snap.exists())throw Error('Pompe inconnue.');
      const prev=snap.data(),session=prev.activeSession;
      // Un deuxième téléphone peut avoir terminé cette utilisation.
      if(!session)return {alreadyStopped:true};
      const started=ms(session.startedAt);
      if(!started)throw Error('Heure de départ encore non confirmée. Réessaie dans quelques secondes.');
      const seconds=Math.max(1,Math.round((Date.now()-started)/1000));
      if(seconds>48*3600)throw Error('Utilisation de plus de 48 heures : vérifier le compteur avec un responsable.');
      tx.update(pump,{
        activeSession:null,usedSeconds:(prev.usedSeconds||0)+seconds,
        lifetimeSeconds:(prev.lifetimeSeconds||0)+seconds,
        lastEventId:eventRef.id,lastActionAt:serverTimestamp()
      });
      tx.set(eventRef,{
        type:'usage',at:serverTimestamp(),startedAt:session.startedAt,
        person:session.byName,byEmail:session.byEmail,byUid:session.byUid,
        endedBy:name,endedByUid:state.user.uid,
        gas:session.gas,job:session.job,note:session.note,seconds
      });
      return {alreadyStopped:false};
    });
    if(result?.alreadyStopped && REFRESH_AFTER_STALE_STOP){
      // Force une lecture serveur afin d'effacer l'ancien état de l'interface.
      const fresh=await getDocFromServer(refs(id));
      if(fresh.exists())state.pumps[id]=fresh.data();
    }
    return result;
  });
}
async function initBaseline(){
  if(!PILOT_MODE && !REAL_INIT_ENABLED){err(Error('Initialisation réelle non disponible.'));return;}
  if(!state.isAdmin){err(Error('Initialisation réservée à l’administrateur.'));return;}
  if(!confirm('Initialiser '+PUMPS[state.selected].name+' à 0 h 00 ? Cela ne valide AUCUNE vidange réelle et conserve les archives.'))return;
  await requireRun(async ()=>{
    const id=state.selected;
    await runTransaction(db,async tx=>{
      const pump=refs(id),snap=await tx.get(pump);
      if(!snap.exists())throw Error('Pompe introuvable.');
      const data=snap.data();
      if(data.trackingStartedAt)throw Error('Le suivi est déjà initialisé : il est interdit de le remettre à zéro ici.');
      if(data.activeSession)throw Error('Une utilisation est en cours.');
      if((data.usedSeconds||0)!==0 || (data.lifetimeSeconds||0)!==0)throw Error('La pompe possède déjà du temps enregistré.');
      tx.update(pump,{
        usedSeconds:0,lifetimeSeconds:0,
        trackingStartedAt:serverTimestamp(),
        trackingInitializedBy:state.user.email.toLowerCase(),
        oilCondition:'unverified',
        lastActionAt:serverTimestamp()
      });
    });
  }, 'init');
}
async function oilChange(){
  const observation=prompt('Observation sur la vidange (facultatif) :','');
  if(observation===null)return;
  if(!confirm('Confirmer qu’une VRAIE vidange d’huile vient d’être effectuée sur '+PUMPS[state.selected].name+' ?\n\nCette action remettra son compteur des 10 heures à zéro. L’historique restera enregistré.'))return;
  await requireRun(async name=>{
    const id=state.selected,eventRef=doc(collection(refs(id),'events'));
    await runTransaction(db,async tx=>{
      const pump=refs(id),snap=await tx.get(pump);
      if(!snap.exists())throw Error('Pompe inconnue.');
      const p=snap.data();
      if(p.activeSession)throw Error('Termine l’utilisation avant la vidange.');
      tx.update(pump,{usedSeconds:0,lastOilAt:serverTimestamp(),oilCondition:'changed',lastActionAt:serverTimestamp(),lastEventId:eventRef.id});
      tx.set(eventRef,{type:'oil',at:serverTimestamp(),person:name,byEmail:state.user.email.toLowerCase(),byUid:state.user.uid,note:observation.slice(0,600),previousSeconds:p.usedSeconds||0});
    });
  });
}
function report(month){
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))return;
  const archiveForMonth=(r)=>{
    if(r.date && r.date.slice(0,7)===month)return true;
    const match=String(r.dateAsWritten||'').match(/^\.\.\/(\d{2})\/(\d{2})$/);
    return !r.date && !!match && month===('20'+match[2]+'-'+match[1]);
  };
  const rows=Object.keys(PUMPS).flatMap(id=>{
    const current=(state.events[id]||[]).filter(e=>ms(e.at)&&date(ms(e.at)).startsWith(month)).map(e=>({
      sort:e.at?.toMillis?.()||0,date:dateTime(ms(e.at)),pump:id,
      person:e.person||e.byName||'',op:e.type==='oil'?'VIDANGE':e.job||'Utilisation',
      client:'',gas:e.gas||'',seconds:e.type==='oil'?null:e.seconds||0,
      note:e.note||'',kind:'Nouveau suivi',old:false
    }));
    const archive=(state.archives[id]||[]).filter(archiveForMonth).map(e=>({
      sort:e.date?Date.parse(e.date+'T12:00:00'):Date.parse(month+'-28T12:00:00'),
      date:e.dateAsWritten||'Date non renseignée',pump:id,
      person:e.employee||'',op:e.type==='oil'?'VIDANGE':e.operation||'Utilisation',
      client:e.client||'',gas:e.gasAsWritten||'',seconds:e.type==='oil'?null:(e.durationMinutes||0)*60,
      note:e.date?'':"Date d'origine incomplète",
      kind:'Archive 2026',old:true
    }));
    return [...current,...archive];
  }).sort((a,b)=>a.sort-b.sort || a.pump.localeCompare(b.pump));
  const total=(id,old)=>rows.filter(e=>e.pump===id&&e.old===old&&e.seconds!==null).reduce((sum,e)=>sum+e.seconds,0);
  const totalText=old=>'TESTO : '+durRecord(total('testo',old))+' · VALUE : '+durRecord(total('value',old));
  const tableRows=rows.map(e=>'<tr><td>'+esc(e.date)+'</td><td>'+esc(PUMPS[e.pump].name)+'</td><td>'+esc(e.person||'—')+'</td><td>'+esc(e.op)+'</td><td>'+esc(e.client||'—')+'</td><td>'+esc(e.gas||'—')+'</td><td>'+(e.seconds===null?'—':durRecord(e.seconds))+'</td><td>'+esc(e.note||'')+'</td></tr>').join('');
  printArea.innerHTML='<div class="pump-print"><h1>CHARRIAUT · Entretien des pompes à vide</h1>'+
    '<p>Relevé mensuel '+esc(month)+' · Édité le '+date(Date.now())+'</p>'+
    '<div class="pump-print-summary"><strong>Nouveau suivi :</strong> '+totalText(false)+
    '<p><strong>Ancien historique importé :</strong> '+totalText(true)+'</p></div>'+
    '<table><thead><tr><th>Date</th><th>Pompe</th><th>Salarié</th><th>Opération</th><th>Client</th><th>Gaz</th><th>Durée</th><th>Observations</th></tr></thead><tbody>'+
    (rows.length?tableRows:'<tr><td colspan="8">Aucune intervention pour ce mois.</td></tr>')+
    '</tbody></table><p class="pump-foot">Ancien historique et nouveau suivi présentés séparément. Dates incomplètes conservées telles que saisies. Durée totale fondée sur les sessions terminées, sans compter les sessions actuellement actives. Le champ Salarié reste vide pour les anciennes opérations non attribuées.</p></div>';
  document.body.classList.add('pumps-print');
  window.print();
}
$('pumpsClose').addEventListener('click',()=>modal.close());
$('pumpsOpen')?.addEventListener('click',()=>{
  modal.showModal();message('');render();
});
// Reste volontairement séparé du code de pointage : ni mot de passe ni jeton stocké dans ses données.
function readableAuthError(e){
  const code=String(e?.code||'');
  if(code==='auth/email-already-in-use')return 'Ce compte existe déjà. Utilise « Première connexion avec un ancien compte ? » pour choisir ton mot de passe.';
  if(code==='auth/invalid-credential'||code==='auth/wrong-password'||code==='auth/user-not-found')return 'Adresse ou mot de passe incorrect. Si tu utilisais les liens e-mail, choisis « Première connexion avec un ancien compte ? ».';
  if(code==='auth/weak-password')return 'Mot de passe insuffisamment sécurisé : choisis au moins 12 caractères.';
  if(code==='auth/too-many-requests')return 'Trop de tentatives successives. Attends avant de réessayer.';
  if(code==='auth/operation-not-allowed')return 'Connexion e-mail/mot de passe à activer dans Firebase Authentication > Mode de connexion.';
  if(code==='auth/requires-recent-login')return 'Firebase demande une reconnexion récente. Déconnecte-toi puis utilise la récupération du mot de passe.';
  if(code==='auth/network-request-failed')return 'Connexion Internet indisponible. Réessaie avec le réseau.';
  if(code==='auth/invalid-email')return 'Adresse e-mail invalide.';
  return String(e?.message||'Une erreur est survenue.');
}
function securePassword(fd){
  const password=String(fd.get('password')||'');
  if(password.length<12)throw Error('Choisis un mot de passe personnel d’au moins 12 caractères.');
  if(password!==String(fd.get('confirmPassword')||''))throw Error('Les deux mots de passe ne correspondent pas.');
  return password;
}
function authEmail(fd){
  const email=String(fd.get('email')||'').trim().toLowerCase();
  if(!email||!email.includes('@'))throw Error('Adresse e-mail incorrecte.');
  return email;
}
async function authorizedUserCheck(user){
  state.approved=false;state.isAdmin=false;state.authChecking=true;render();
  try{
    if(!user.emailVerified)throw Error('Adresse e-mail non encore vérifiée.');
    const email=String(user.email||'').toLowerCase();
    const record=await getDoc(doc(db,'authorizedEmployees',email));
    if(state.user?.uid!==user.uid)return; // Un autre compte a pu se connecter entre-temps.
    if(!record.exists()||record.data().active!==true)throw Error('Adresse non autorisée ou désactivée par CHARRIAUT.');
    state.approved=true;
    state.isAdmin=record.data().role==='admin';
    state.authError='';
    startListening();
  }catch(e){if(state.user?.uid===user.uid)state.authError=String(e.message||e);}
  finally{if(state.user?.uid===user.uid){state.authChecking=false;render();}}
}
$('pumpsContent').addEventListener('click',async event=>{
  const tab=event.target.closest('[data-pump]');
  if(tab){state.selected=tab.dataset.pump;render();return;}
  const screen=event.target.closest('[data-auth-screen]');
  if(screen){state.authScreenMode=screen.dataset.authScreen;state.authError='';message('');render();return;}
  if(event.target.closest('#pumpLogout')||event.target.closest('#pumpLogoutUnverified')){
    await signOut(auth);state.authScreenMode='login';return;
  }
  if(event.target.closest('#pumpSetupPassword')){state.authScreenMode='setpassword';render();return;}
  if(event.target.closest('#pumpCancelSetPassword')){state.authScreenMode='login';render();return;}
  if(event.target.closest('#pumpCheckVerification')){
    try{
      await reload(state.user);
      await state.user.getIdToken(true);
      await authorizedUserCheck(state.user);
      if(!state.approved)message('Adresse pas encore validée ou non autorisée. Consulte le message ci-dessous.',true);
    }catch(e){message(readableAuthError(e),true);}
    return;
  }
  if(event.target.closest('#pumpResendVerification')){
    try{
      await sendEmailVerification(state.user);
      message('Mail de vérification envoyé. Consulte ta boîte de réception et les courriers indésirables.');
    }catch(e){message(readableAuthError(e),true);}
    return;
  }
  if(event.target.closest('#pumpInit')){await initBaseline();return;}
  if(event.target.closest('#pumpStop')){await finishSession();return;}
  if(event.target.closest('#pumpOil')){await oilChange();return;}
  if(event.target.closest('#pumpPDF')){report($('pumpsMonth').value);}
});
$('pumpsContent').addEventListener('submit',async event=>{
  const form=event.target;
  if(!['pumpPasswordLoginForm','pumpPasswordSignupForm','pumpPasswordResetForm','pumpSetPasswordForm','pumpStartForm'].includes(form.id))return;
  event.preventDefault();
  if(form.id==='pumpStartForm'){
    try{await startSession(new FormData(form));}catch(e){err(e);}return;
  }
  if(state.authBusy)return;
  state.authBusy=true;
  const buttons=form.querySelectorAll('button[type="submit"]');
  buttons.forEach(b=>b.disabled=true);
  try{
    const fd=new FormData(form);
    if(form.id==='pumpPasswordLoginForm'){
      const email=authEmail(fd),password=String(fd.get('password')||'');
      await requirePersistentAuth();
      await signInWithEmailAndPassword(auth,email,password);
      state.authScreenMode='login';
      message('Connexion enregistrée sur cet appareil.');
    }
    if(form.id==='pumpPasswordSignupForm'){
      const email=authEmail(fd),password=securePassword(fd);
      await requirePersistentAuth();
      const credential=await createUserWithEmailAndPassword(auth,email,password);
      await sendEmailVerification(credential.user);
      state.authScreenMode='login';
      message('Compte créé. Valide maintenant l’adresse e-mail via le message reçu. Les pompes restent bloquées tant que l’adresse n’est pas vérifiée et autorisée.');
    }
    if(form.id==='pumpPasswordResetForm'){
      const email=authEmail(fd);
      await sendPasswordResetEmail(auth,email);
      message('Si ce compte existe, un e-mail pour définir le mot de passe vient d’être demandé. Vérifie aussi les courriers indésirables, puis reviens te connecter ici.');
    }
    if(form.id==='pumpSetPasswordForm'){
      const password=securePassword(fd);
      if(!auth.currentUser)throw Error('Connecte-toi avant de définir ton mot de passe.');
      await updatePassword(auth.currentUser,password);
      state.authScreenMode='login';
      message('Ton mot de passe personnel a été enregistré. Ta connexion reste active sur cet appareil.');
      render();
    }
  }catch(e){message(readableAuthError(e),true);}
  finally{state.authBusy=false;buttons.forEach(b=>b.disabled=false);}
});
onAuthStateChanged(auth,async user=>{
  stopListening();state.user=user;state.approved=false;state.isAdmin=false;state.authError='';
  state.authInitializing=false;state.authChecking=!!user;render();
  if(user)await authorizedUserCheck(user);
});
// Rafraîchit la connexion restaurée par Firebase sans demander de nouvel e-mail.
window.addEventListener('online',()=>{if(state.user&&!state.approved)authorizedUserCheck(state.user);});
window.setInterval(tickLive,1000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)tickLive();});
window.addEventListener('afterprint',()=>document.body.classList.remove('pumps-print'));
window.addEventListener('beforeprint',()=>{if(!document.body.classList.contains('pumps-print'))printArea.innerHTML='';});
