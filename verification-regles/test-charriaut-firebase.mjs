/**
 * CHARRIAUT V15 - tests de securite Firestore (EMULATEUR LOCAL UNIQUEMENT)
 * N'effectue aucun deploiement. Projet fictif : demo-charriaut-regles.
 * Execute depuis ~/charriaut-regles-test, dans Google Cloud Shell.
 */
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import {
  collection, doc, getDoc, setDoc, updateDoc, deleteDoc,
  runTransaction, serverTimestamp, Timestamp
} from 'firebase/firestore';

const PROJECT = 'demo-charriaut-regles';
const HOST = '127.0.0.1';
const PORT = 8080;
const RULES = readFileSync('./firestore.rules', 'utf8');

// Garde-fou : ne jamais utiliser le projet Firebase reel.
if (PROJECT !== 'demo-charriaut-regles' || HOST !== '127.0.0.1') {
  throw Error('Projet ou hote non conforme : tests annules');
}

let env;
let passed = 0;
let failed = 0;
async function test(label, action, shouldWork = true) {
  try {
    const operation = action();
    if (shouldWork) await assertSucceeds(operation);
    else await assertFails(operation);
    console.log(`✅ ${label}`);
    passed++;
  } catch (error) {
    console.log(`❌ ${label}`);
    console.log('   ' + String(error?.message ?? error).slice(0, 360));
    failed++;
  }
}

function start(db, root, by) {
  const pump = doc(db, root, 'testo');
  return runTransaction(db, async tx => {
    const snapshot = await tx.get(pump);
    const previous = snapshot.data();
    if (!previous || previous.activeSession) throw Error('Pompe absente ou deja utilisee');
    tx.update(pump, {
      activeSession: {
        byUid: by.uid,
        byEmail: by.email,
        byName: by.name,
        gas: 'R32', job: 'Tirage au vide', note: 'TEST EMULATEUR',
        startedAt: serverTimestamp()
      },
      lastActionAt: serverTimestamp()
    });
  });
}

function stop(db, root, by) {
  const pump = doc(db, root, 'testo');
  const event = doc(collection(db, root, 'testo', 'events'));
  return runTransaction(db, async tx => {
    const snapshot = await tx.get(pump);
    const before = snapshot.data();
    const session = before?.activeSession;
    if (!session?.startedAt?.toMillis) throw Error('Session de test absente');
    const seconds = Math.max(1, Math.round((Date.now() - session.startedAt.toMillis()) / 1000));
    tx.update(pump, {
      activeSession: null,
      usedSeconds: before.usedSeconds + seconds,
      lifetimeSeconds: before.lifetimeSeconds + seconds,
      lastEventId: event.id,
      lastActionAt: serverTimestamp()
    });
    tx.set(event, {
      type: 'usage', at: serverTimestamp(), startedAt: session.startedAt,
      person: session.byName, byEmail: session.byEmail, byUid: session.byUid,
      endedBy: by.name, endedByUid: by.uid,
      gas: session.gas, job: session.job, note: session.note, seconds
    });
  });
}

function drain(db, root, by) {
  const pump = doc(db, root, 'testo');
  const event = doc(collection(db, root, 'testo', 'events'));
  return runTransaction(db, async tx => {
    const snapshot = await tx.get(pump);
    const before = snapshot.data();
    if (!before || before.activeSession) throw Error('Pompe active ou absente');
    tx.update(pump, {
      usedSeconds: 0, lastOilAt: serverTimestamp(), oilCondition: 'changed',
      lastActionAt: serverTimestamp(), lastEventId: event.id
    });
    tx.set(event, {
      type: 'oil', at: serverTimestamp(), person: by.name,
      byEmail: by.email, byUid: by.uid,
      note: 'VIDANGE FICTIVE - EMULATEUR', previousSeconds: before.usedSeconds
    });
  });
}

try {
  env = await initializeTestEnvironment({
    projectId: PROJECT,
    firestore: { host: HOST, port: PORT, rules: RULES }
  });
  // Efface UNIQUEMENT les documents fictifs dans l'emulateur demo.
  await env.clearFirestore();

  const admin = { uid: 'uid-admin-fictif', email: 'admin-test@example.com', name: 'Admin Test' };
  const employee = { uid: 'uid-salarie-fictif', email: 'salarie-test@example.com', name: 'Salarie Test' };
  const outsider = { uid: 'uid-inconnu-fictif', email: 'inconnu-test@example.com', name: 'Inconnu' };

  // Donnees 100 % fictives, ecrites uniquement dans l'emulateur local.
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, 'authorizedEmployees', admin.email), { active: true, role: 'admin' }),
      setDoc(doc(db, 'authorizedEmployees', employee.email), { active: true, role: 'employee' }),
      setDoc(doc(db, 'pumps', 'testo'), {
        name: 'TESTO', color: 'orange', oilIntervalHours: 10,
        usedSeconds: 0, lifetimeSeconds: 0, activeSession: null
      }),
      setDoc(doc(db, 'pumps', 'value'), {
        name: 'VALUE', color: 'blue', oilIntervalHours: 10,
        usedSeconds: 0, lifetimeSeconds: 0, activeSession: null
      }),
      setDoc(doc(db, 'pilotPumps', 'testo'), {
        name: 'TESTO', color: 'orange', oilIntervalHours: 10,
        usedSeconds: 0, lifetimeSeconds: 0, activeSession: null,
        trackingStartedAt: Timestamp.fromMillis(Date.now() - 60_000)
      }),
      setDoc(doc(db, 'pilotPumps', 'value'), {
        name: 'VALUE', color: 'blue', oilIntervalHours: 10,
        usedSeconds: 0, lifetimeSeconds: 0, activeSession: null,
        trackingStartedAt: Timestamp.fromMillis(Date.now() - 60_000)
      }),
      setDoc(doc(db, 'pumps', 'testo', 'history', 'legacy-2026-sheet-r002-testo'), {
        type: 'usage', operation: 'ARCHIVE FICTIVE', durationMinutes: 25, isHistorical: true
      })
    ]);
  });

  const adminDb = env.authenticatedContext(admin.uid, { email: admin.email, email_verified: true }).firestore();
  const empDb = env.authenticatedContext(employee.uid, { email: employee.email, email_verified: true }).firestore();
  const outsiderDb = env.authenticatedContext(outsider.uid, { email: outsider.email, email_verified: true }).firestore();
  const unverifiedDb = env.authenticatedContext(employee.uid, { email: employee.email, email_verified: false }).firestore();
  const archivePath = ['pumps', 'testo', 'history', 'legacy-2026-sheet-r002-testo'];

  console.log('\nCHARRIAUT V15 - TEST DES REGLES EN LOCAL UNIQUEMENT');
  console.log(`Projet FICTIF : ${PROJECT} / Emulateur ${HOST}:${PORT}\n`);

  await test('Salarie : lecture pompe reelle', () => getDoc(doc(empDb, 'pumps', 'testo')));
  await test('Exterieur : lecture refusee', () => getDoc(doc(outsiderDb, 'pumps', 'testo')), false);
  await test('Email non verifie : lecture refusee', () => getDoc(doc(unverifiedDb, 'pumps', 'testo')), false);
  await test('Admin : lecture archive', () => getDoc(doc(adminDb, ...archivePath)));
  await test('Admin : suppression archive interdite', () => deleteDoc(doc(adminDb, ...archivePath)), false);
  await test('Admin : modification archive interdite', () => updateDoc(doc(adminDb, ...archivePath), { operation: 'FALSIFIE' }), false);
  await test('Salarie : falsification compteur interdite', () => updateDoc(doc(empDb, 'pumps', 'testo'), { usedSeconds: 10_000 }), false);
  await test('Exterieur : modification compteur interdite', () => updateDoc(doc(outsiderDb, 'pumps', 'testo'), { usedSeconds: 1 }), false);

  const initFields = () => ({
    usedSeconds: 0, lifetimeSeconds: 0, trackingStartedAt: serverTimestamp(),
    trackingInitializedBy: admin.email, oilCondition: 'unverified', lastActionAt: serverTimestamp()
  });
  await test('Salarie : initialisation reelle interdite', () => updateDoc(doc(empDb, 'pumps', 'testo'), initFields()), false);
  await test('Admin : initialisation reelle autorisee', () => updateDoc(doc(adminDb, 'pumps', 'testo'), initFields()));
  await test('Salarie : depart reelle autorise', () => start(empDb, 'pumps', employee));
  await test('Salarie : arret reelle + evenement atomique autorises', () => stop(empDb, 'pumps', employee));
  await test('Salarie : vidange reelle + evenement atomique autorises', () => drain(empDb, 'pumps', employee));
  await test('Archive toujours consultable apres les tests', () => getDoc(doc(adminDb, ...archivePath)));
  await test('Salarie : depart pilote interdit', () => start(empDb, 'pilotPumps', employee), false);
  await test('Admin : depart pilote autorise', () => start(adminDb, 'pilotPumps', admin));
  await test('Admin : arret pilote + evenement atomique autorises', () => stop(adminDb, 'pilotPumps', admin));
  await test('Admin : vidange pilote + evenement atomique autorises', () => drain(adminDb, 'pilotPumps', admin));

  await test('Compteur reel remis a zero apres vidange', async () => {
    const snap = await getDoc(doc(empDb, 'pumps', 'testo'));
    if (snap.data().usedSeconds !== 0 || snap.data().oilCondition !== 'changed') {
      throw Error('Compteur non remis a zero');
    }
  });
  await test('Compteur pilote remis a zero apres vidange', async () => {
    const snap = await getDoc(doc(adminDb, 'pilotPumps', 'testo'));
    if (snap.data().usedSeconds !== 0 || snap.data().oilCondition !== 'changed') {
      throw Error('Compteur pilote non remis a zero');
    }
  });

  console.log(`\nRESULTAT : ${passed} TESTS REUSSIS / ${failed} TESTS EN ECHEC`);
  if (failed) {
    console.log('Des corrections sont necessaires AVANT toute publication Firebase.');
    process.exitCode = 1;
  } else {
    console.log('Tests de base valides dans l emulateur. Publication NON automatique.');
  }
} catch (error) {
  console.error('\nERREUR DE PREPARATION :', error?.message ?? error);
  process.exitCode = 1;
} finally {
  if (env) await env.cleanup();
}