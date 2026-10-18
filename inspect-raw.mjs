import fs from 'fs';
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc } from 'firebase/firestore';

const config = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(config);
const db = getFirestore(app, config.firestoreDatabaseId);

async function inspectRaw() {
  const gSnap = await getDoc(doc(db, 'games', 'EFZbsTdrs7ZMuuzZ8Wxj'));
  const data = gSnap.data();
  console.log('Game root keys:', Object.keys(data));
  console.log('boxScore keys:', Object.keys(data.boxScore || {}));
  console.log('teams in boxScore:', data.boxScore?.teams?.map(t => ({ teamName: t.teamName, teamType: t.teamType, battersCount: t.batters?.length })));
  
  data.boxScore?.teams?.forEach(t => {
    console.log(`\n--- TEAM: ${t.teamName} (${t.teamType}) ---`);
    t.batters?.forEach(b => {
      console.log(`  order: ${b.order} | ${b.name}: line='${b.battingLine}', ab=${b.ab}, h=${b.h}, r=${b.r}, bb=${b.bb}, notes='${b.extraNotes}'`);
    });
  });

  process.exit(0);
}

inspectRaw().catch(e => { console.error(e); process.exit(1); });
