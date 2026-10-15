import {initializeApp} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import {getAuth,onAuthStateChanged,isSignInWithEmailLink,signInWithEmailLink,sendSignInLinkToEmail} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import {getFirestore,doc,getDoc,collection,getDocs,Timestamp} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
const app=initializeApp({
 apiKey:"AIzaSyAtm8CARaeWyh_ncvjcxATTOJQS3ppyZNc",
 authDomain:"charriaut-entretien.firebaseapp.com",
 projectId:"charriaut-entretien",
 storageBucket:"charriaut-entretien.firebasestorage.app",
 messagingSenderId:"878437191970",appId:"1:878437191970:web:f2a2ac7319d48b9113957b"
});
const auth=getAuth(app), db=getFirestore(app);
const $=id=>document.getElementById(id);
const backupButton=$('backup'),authState=$('authState'),status=$('status'),summary=$('summary'),loginForm=$('loginForm');
const localKey='charriaut.backup.email';
function say(t){status.textContent=t;}
function serialize(v){
 if(v instanceof Timestamp)return {type:'firestore-timestamp',seconds:v.seconds,nanoseconds:v.nanoseconds,iso:v.toDate().toISOString()};
 if(Array.isArray(v))return v.map(serialize);
 if(v&&typeof v==='object'){const r={};for(const [k,x] of Object.entries(v))r[k]=serialize(x);return r;}
 return v;
}
async function authorize(user){
 backupButton.disabled=true;
 const email=user?.email?.trim()?.toLowerCase();
 if(!email||!user.emailVerified){authState.textContent='Un e-mail vérifié est indispensable.';return;}
 const docRef=doc(db,'authorizedEmployees',email);
 const access=await getDoc(docRef);
 if(!access.exists()||access.data().active!==true||access.data().role!=='admin'){
  authState.textContent='Connecté : '+email+' — sauvegarde réservée à un administrateur autorisé.';return;
 }
 authState.textContent='✅ Administrateur autorisé : '+email;
 loginForm.hidden=true;backupButton.disabled=false;
}
onAuthStateChanged(auth,user=>{
 if(user){authorize(user).catch(e=>{backupButton.disabled=true;say('Autorisation non vérifiée : '+e.message);});}
 else{authState.textContent='Connecte-toi par e-mail pour sauvegarder.';loginForm.hidden=false;backupButton.disabled=true;}
});
loginForm.addEventListener('submit',async e=>{
 e.preventDefault();const email=$('email').value.trim().toLowerCase();
 if(!email)return;
 try{
  localStorage.setItem(localKey,email);
  await sendSignInLinkToEmail(auth,email,{url:'https://okajb.github.io/pointage-charriaut/sauvegarde-pompes/',handleCodeInApp:true});
  say('Lien envoyé. Consulte ta boîte mail et ouvre-le sur ce Mac.');
 }catch(e){say('Échec d\'envoi : '+e.message);}
});
(async()=>{
 if(!isSignInWithEmailLink(auth,location.href))return;
 const email=localStorage.getItem(localKey)||prompt('Adresse e-mail utilisée pour la connexion :');
 if(!email){say('La connexion n\'a pas été terminée.');return;}
 try{await signInWithEmailLink(auth,email,location.href);localStorage.removeItem(localKey);history.replaceState(null,'',location.pathname);}
 catch(e){say('Connexion non terminée : '+e.message);}
})();
backupButton.addEventListener('click',async()=>{
 backupButton.disabled=true;say('Lecture des documents et des anciennes opérations en cours…');summary.hidden=true;
 try{
  const data={
   backupType:'charriaut-pompes-manual-readonly',exportedAt:new Date().toISOString(),
   project:'charriaut-entretien',realPumps:{},pilotPumps:{}
  };
  for(const id of ['testo','value']){
   const real=await getDoc(doc(db,'pumps',id));
   if(!real.exists())throw Error('La pompe réelle '+id+' est introuvable : sauvegarde interrompue.');
   const history=await getDocs(collection(db,'pumps',id,'history'));
   data.realPumps[id]={document:serialize(real.data()),history:history.docs.map(d=>({id:d.id,data:serialize(d.data())}))};
   const pilot=await getDoc(doc(db,'pilotPumps',id));
   if(pilot.exists()){
    const events=await getDocs(collection(db,'pilotPumps',id,'events'));
    data.pilotPumps[id]={document:serialize(pilot.data()),events:events.docs.map(d=>({id:d.id,data:serialize(d.data())}))};
   }
  }
  const count=Object.values(data.realPumps).reduce((n,p)=>n+p.history.length,0);
  const json=JSON.stringify(data,null,2);
  const filename='CHARRIAUT-sauvegarde-pompes-'+new Date().toISOString().slice(0,10)+'.json';
  const link=document.createElement('a');
  const blob=new Blob([json],{type:'application/json'});
  const url=URL.createObjectURL(blob);link.href=url;link.download=filename;
  document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
  say('✅ Téléchargement lancé : '+filename+'\nConserve ce fichier en lieu sûr. Vérifie dans le dossier Téléchargements du Mac.');
  summary.hidden=false;
  summary.textContent='Anciennes opérations : '+count+' (TESTO '+data.realPumps.testo.history.length+', VALUE '+data.realPumps.value.history.length+').\nDeux vrais documents de pompe sauvegardés.\nDeux compteurs de test : '+Object.keys(data.pilotPumps).length+'.'+(count!==23?'\n⚠️ Le total diffère des 23 anciennes opérations attendues : vérifier avant toute activation.':'\n✅ Les 23 archives attendues sont présentes.');
 }catch(e){say('❌ Sauvegarde non terminée : '+e.message);}
 finally{backupButton.disabled=false;}
});