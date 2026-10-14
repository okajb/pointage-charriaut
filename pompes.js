'use strict';
/* CHARRIAUT - Module pompes à vide autonome.
   Les données des pointages V14 ne sont jamais modifiées.
   ATTENTION : mode local de préfiguration ; synchronisation d'équipe non activée. */
(() => {
  const KEY = 'charriaut.pompes.v1.local';
  const MAX = 36000; // 10 h en secondes
  const pumps = {testo:{name:'TESTO',color:'orange'},value:{name:'VALUE',color:'blue'}};
  const $ = id => document.getElementById(id);
  const h = v => String(v == null ? '' : v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const pad = n => String(n).padStart(2,'0');
  const localDate = t => { const d=new Date(t);return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate()); };
  const localTime = t => { const d=new Date(t);return localDate(t)+' '+pad(d.getHours())+':'+pad(d.getMinutes()); };
  const duration = secs => {secs=Math.max(0,Math.round(secs));return Math.floor(secs/3600)+' h '+pad(Math.floor(secs%3600/60))+' min';};
  const empty = () => ({testo:{events:[],running:null},value:{events:[],running:null}});
  const save = () => {
    try {localStorage.setItem(KEY,JSON.stringify(data));return true;}
    catch(e){alert("Impossible d'enregistrer l'opération sur ce téléphone. Vérifier l'espace de stockage.");return false;}
  };
  let data=empty();
  try {
    const read=JSON.parse(localStorage.getItem(KEY)||'null');
    if(read&&read.testo&&read.value&&Array.isArray(read.testo.events)&&Array.isArray(read.value.events))data=read;
  }catch(e){}
  let selected='testo';
  const profile = () => {
    try {
      const s=JSON.parse(localStorage.getItem('pointage39h.v1')||'{}').settings||{};
      return [s.firstName,s.lastName].filter(Boolean).join(' ').trim()||s.name||'';
    }catch(e){return '';}
  };
  const records = id => data[id].events.slice().sort((a,b)=>b.at-a.at);
  const elapsed = id => {
    const sorted=records(id), oil=sorted.find(e=>e.type==='oil');
    const from=oil?oil.at:0;
    return sorted.filter(e=>e.type==='usage'&&e.at>=from).reduce((v,e)=>v+Math.max(0,e.seconds||0),0);
  };
  const oilLabel = id => {
    const e=records(id).find(x=>x.type==='oil');
    return e?localTime(e.at):'Aucune vidange enregistrée';
  };
  const status = id => {
    const sec=elapsed(id)+(data[id].running?Math.max(0,Math.floor((Date.now()-data[id].running.start)/1000)):0);
    return {secs:sec,label:sec>=MAX?'VIDANGE À FAIRE':sec>=28800?'VIDANGE À PRÉVOIR':'Entretien à jour',
      color:sec>=MAX?'overdue':sec>=28800?'soon':'ok'};
  };
  const modal=document.createElement('dialog');
  modal.id='pumpsDialog';modal.className='pump-dialog';
  modal.setAttribute('aria-label','Entretien des pompes à vide');
  modal.innerHTML='<div class="pump-layout"><header class="pump-header"><div><small>CHARRIAUT · SUIVI MATÉRIEL</small><h2>Entretien des pompes à vide</h2></div><button type="button" id="pumpsClose" class="pump-close" aria-label="Fermer">✕</button></header><div class="pump-local-warning" role="status"><strong>Version de préparation :</strong> ce suivi est enregistré uniquement sur ce téléphone. Ne pas utiliser en équipe avant activation de la synchronisation et des accès sécurisés.</div><div id="pumpsContent"></div></div>';
  document.body.appendChild(modal);
  const printArea=document.createElement('section');
  printArea.id='pumpsPrintSheet';printArea.setAttribute('aria-hidden','true');
  document.body.appendChild(printArea);
  const choice = (id) => {
    const p=pumps[id], d=data[id], s=status(id);
    return '<button type="button" data-pump="'+id+'" class="pump-tab '+(selected===id?'selected ':'')+p.color+'"><strong>'+p.name+'</strong><small>'+h(s.label)+'</small></button>';
  };
  function render(){
    if(!modal.open)return;
    const p=pumps[selected], d=data[selected], s=status(selected);
    const running=d.running;
    const liveEvents=records(selected).slice(0,60);
    const button=running?'<button class="pump-action finish" type="button" id="pumpsStop">■ FIN D’UTILISATION</button>':'<button class="pump-action start" type="button" id="pumpsStart">▶ DÉPART</button>';
    const active=running?'<p class="pump-active">⏱ Pompe en fonctionnement depuis '+h(localTime(running.start))+' · '+h(running.person)+'</p>':'<p class="pump-muted">Pompe actuellement disponible sur cet appareil</p>';
    $('pumpsContent').innerHTML='<div class="pump-tabs">'+choice('testo')+choice('value')+'</div>'+
      '<section class="pump-counter '+s.color+'"><div class="pump-counter-top"><strong>'+p.name+'</strong><span>'+s.label+'</span></div><div class="pump-time">'+duration(s.secs)+' <small>/ 10 h</small></div><div class="pump-rail"><div style="width:'+Math.min(100,s.secs/MAX*100)+'%"></div></div><small>Dernière vidange : '+h(oilLabel(selected))+'</small></section>'+
      '<div class="pump-info">'+active+'<div class="pump-fields"><label>Nature du fluide / gaz<select id="pumpsGas" '+(running?'disabled':'')+'><option value="R32">R32</option><option value="R410A">R410A</option><option value="AZOTE">AZOTE</option><option value="AZOTE HYDROGÉNÉ">AZOTE HYDROGÉNÉ</option><option value="AUTRE">Autre</option></select></label><label id="pumpsOtherWrap" hidden>Préciser le fluide<input id="pumpsOther" type="text" maxlength="80" placeholder="Autre fluide"></label><label>Opération<select id="pumpsJob" '+(running?'disabled':'')+'><option>Tirage au vide</option><option>Contrôle</option><option>Entretien</option><option>Autre intervention</option></select></label><label>Observation<textarea id="pumpsNote" rows="2" maxlength="600" placeholder="Chantier, remarque... " '+(running?'disabled':'')+'></textarea></label></div>'+
      (running?'<p class="pump-muted">Le gaz, l’opération et l’observation ont été enregistrés lors du départ.</p>':'<p class="pump-muted">Le prénom sera repris automatiquement depuis le profil salarié Charriaut.</p>')+
      button+'<button class="pump-oil" id="pumpsOil" type="button" '+(running?'disabled':'')+'>✓ Vidange effectuée — remise à zéro du compteur</button></div>'+
      '<section class="pump-history"><div class="pump-history-head"><h3>Historique '+p.name+'</h3><span>'+liveEvents.length+' dernières opérations</span></div>'+
      (liveEvents.length?'<div class="pump-events">'+liveEvents.map(e=>'<div class="pump-event"><span><strong>'+(e.type==='oil'?'🛢 Vidange':h(e.job||'Utilisation'))+'</strong><small>'+h(localTime(e.at))+' · '+h(e.person||'Salarié')+'</small>'+(e.gas?'<small>Fluide : '+h(e.gas)+'</small>':'')+(e.note?'<small>'+h(e.note)+'</small>':'')+'</span><b>'+(e.type==='usage'?duration(e.seconds):'✓')+'</b></div>').join('')+'</div>':'<p class="pump-muted">Aucune utilisation enregistrée.</p>')+'</section>'+
      '<div class="pump-report"><label>Mois du relevé <input id="pumpsMonth" type="month" value="'+localDate(Date.now()).slice(0,7)+'"></label><button type="button" id="pumpsReport">Imprimer / PDF mensuel (2 pompes)</button></div>';
  }
  function formInfo(){
    const person=profile();
    if(!person){alert('Commence par renseigner ton prénom et ton nom dans « Mon profil » de Charriaut.');return null;}
    let gas=$('pumpsGas').value;
    if(gas==='AUTRE'){gas=$('pumpsOther').value.trim();if(!gas){alert('Précise le nom du fluide.');return null;}}
    return {person,gas,job:$('pumpsJob').value,note:$('pumpsNote').value.trim()};
  }
  function open(){
    if(typeof modal.showModal==='function')modal.showModal();
    else modal.setAttribute('open','');
    render();
  }
  const entry=$('pumpsOpen');
  if(entry)entry.addEventListener('click',open);
  $('pumpsClose').addEventListener('click',()=>modal.close());
  $('pumpsContent').addEventListener('click',event=>{
    const tab=event.target.closest('[data-pump]');
    if(tab){selected=tab.dataset.pump;render();return;}
    const start=event.target.closest('#pumpsStart');
    if(start){
      if(data[selected].running)return;
      const info=formInfo();if(!info)return;
      data[selected].running={start:Date.now(),...info};
      if(save())render();else data[selected].running=null;
      return;
    }
    const stop=event.target.closest('#pumpsStop');
    if(stop){
      const r=data[selected].running;if(!r)return;
      const at=Date.now();const seconds=Math.max(1,Math.floor((at-r.start)/1000));
      data[selected].events.push({id:'u'+at+'-'+Math.random().toString(36).slice(2),type:'usage',at,seconds,person:r.person,gas:r.gas,job:r.job,note:r.note,startedAt:r.start});
      data[selected].running=null;
      if(save()){render();}else{data[selected].events.pop();data[selected].running=r;}
      return;
    }
    if(event.target.closest('#pumpsOil')){
      if(data[selected].running){alert('Termine d’abord l’utilisation en cours.');return;}
      const person=profile();if(!person){alert('Renseigne ton profil salarié avant une vidange.');return;}
      if(!confirm('Confirmer la vidange '+pumps[selected].name+' ? Le compteur depuis vidange repartira de zéro ; l’historique sera conservé.'))return;
      const note=prompt('Observation éventuelle sur la vidange (facultatif) :','');
      if(note===null)return;
      const at=Date.now();
      data[selected].events.push({id:'o'+at,type:'oil',at,person,note:note.slice(0,600)});
      if(save())render();else data[selected].events.pop();
      return;
    }
    if(event.target.closest('#pumpsReport'))printMonth($('pumpsMonth').value);
  });
  $('pumpsContent').addEventListener('change',event=>{
    if(event.target.id==='pumpsGas')$('pumpsOtherWrap').hidden=event.target.value!=='AUTRE';
  });
  function printMonth(month){
    if(!/^\d{4}-\d{2}$/.test(month)){alert('Sélectionne un mois valide.');return;}
    const all=['testo','value'].flatMap(id=>records(id).filter(e=>localDate(e.at).startsWith(month)).map(e=>({...e,pump:id})));
    all.sort((a,b)=>a.at-b.at);
    const sum=id=>all.filter(e=>e.pump===id&&e.type==='usage').reduce((v,e)=>v+e.seconds,0);
    const tr=all.map(e=>'<tr><td>'+h(localDate(e.at))+'</td><td>'+h(pumps[e.pump].name)+'</td><td>'+h(e.person||'')+'</td><td>'+h(e.type==='oil'?'VIDANGE':e.job||'Utilisation')+'</td><td>'+h(e.gas||'—')+'</td><td>'+h(e.type==='oil'?'—':duration(e.seconds))+'</td><td>'+h(e.note||'')+'</td></tr>').join('');
    printArea.innerHTML='<div class="pump-print"><h1>CHARRIAUT · Entretien des pompes à vide</h1><p>Relevé mensuel : '+h(month)+' · Édité le '+h(localDate(Date.now()))+'</p><div class="pump-print-summary"><strong>TESTO :</strong> '+duration(sum('testo'))+' d’utilisation sur le mois · <strong>VALUE :</strong> '+duration(sum('value'))+' d’utilisation sur le mois</div><table><thead><tr><th>Date</th><th>Pompe</th><th>Salarié</th><th>Opération</th><th>Fluide</th><th>Durée</th><th>Observations</th></tr></thead><tbody>'+(tr||'<tr><td colspan="7">Aucune opération ce mois-ci.</td></tr>')+'</tbody></table><p class="pump-foot">Compteur depuis dernière vidange (au moment de l’édition) : TESTO '+duration(status('testo').secs)+' · VALUE '+duration(status('value').secs)+'. Suivi local de préfiguration, non synchronisé.</p></div>';
    document.body.classList.add('pumps-print');
    window.print();
  }
  window.addEventListener('afterprint',()=>document.body.classList.remove('pumps-print'));
  window.addEventListener('beforeprint',()=>{if(!document.body.classList.contains('pumps-print'))printArea.innerHTML='';});
  window.setInterval(()=>{if(modal.open&&data[selected].running)render();},60000);
})();