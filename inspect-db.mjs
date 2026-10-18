import fs from 'fs';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';

const config = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(config);
const db = getFirestore(app, config.firestoreDatabaseId);

async function run() {
  const gamesSnap = await getDocs(collection(db, 'games'));
  console.log('Total games in db:', gamesSnap.docs.length);

  for (const d of gamesSnap.docs) {
    const data = d.data();
    if (data.boxScore || data.status === 'completed' || data.scorebookImages || data.scorebookUrl || data.homeTeam || data.awayTeam) {
      console.log('Game:', d.id, 'status:', data.status, 'home:', data.homeTeam, 'away:', data.awayTeam);
      if (data.boxScore) {
        console.log('  awayBatters count:', data.boxScore.awayBatters?.length);
        data.boxScore.awayBatters?.forEach((b) => {
          if (b.order > 0 || b.ab > 0 || b.battingLine) {
            console.log('    [Away]', b.order, b.name, 'line:', b.battingLine, 'ab:', b.ab, 'h:', b.h, 'notes:', b.extraNotes);
          }
        });
        console.log('  homeBatters count:', data.boxScore.homeBatters?.length);
        data.boxScore.homeBatters?.forEach((b) => {
          if (b.order > 0 || b.ab > 0 || b.battingLine) {
            console.log('    [Home]', b.order, b.name, 'line:', b.battingLine, 'ab:', b.ab, 'h:', b.h, 'notes:', b.extraNotes);
          }
        });
      }
    }
  }

  for (const d of gamesSnap.docs) {
    const subColSnap = await getDocs(collection(db, 'games', d.id, 'scorebook_files'));
    if (!subColSnap.empty) {
      console.log('Game', d.id, 'has scorebook_files:', subColSnap.docs.length);
      subColSnap.docs.forEach(s => {
        console.log('  file:', s.id, s.data().fileName, s.data().teamSide);
      });
    }
  }

  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
