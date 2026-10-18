import fs from 'fs';
import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, updateDoc } from 'firebase/firestore';

const config = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(config);
const db = getFirestore(app, config.firestoreDatabaseId);

async function updateGameWithPenData() {
  const gRef = doc(db, 'games', 'EFZbsTdrs7ZMuuzZ8Wxj');
  const gSnap = await getDoc(gRef);
  if (!gSnap.exists()) {
    console.error('Game EFZbsTdrs7ZMuuzZ8Wxj not found');
    process.exit(1);
  }

  const data = gSnap.data();
  const boxScore = data.boxScore || {};
  const teams = boxScore.teams || [];

  const cardenalesTeam = teams.find(t => t.teamName === 'CARDENALES' || t.teamType === 'away');
  if (!cardenalesTeam) {
    console.error('Cardenales team not found');
    process.exit(1);
  }

  // Official pen-written data from WhatsApp Image 2026-10-12 at 20.10.54.jpeg:
  // Row 1: JORGE COTA: "2 X 0" | 3 BB
  // Row 2: BERNARDO PARTIDA: "4 X 0"
  // Row 3: AXEL VALLES: "3 X 0" | BB
  // Row 4: MARCO FELIX: "3 X 1" | BB
  // Row 5: EZRA BETANCOURT: "4 X 0"
  // Row 6: JORGE FIERROS: "3 X 1"
  // Row 7: SANTY SANTOS: "1 X 0" | 2 BB
  // Row 8: ISACC GUERRERO: "3 X 0"
  // Row 9: SEBAS MARQUEZ: "1 X 0" | 2 BB
  // Row 10: TIAN VANEGAS: "3 X 0"
  // Row 11: ALVARO QUIRIO: "2 X 1" | SAC, F RBI
  // Row 12: EDUARDO MENDOZA: "2 X 0" | BB

  const penDataByOrder = {
    1: { ab: 2, h: 0, bb: 3, battingLine: '2x0', extraNotes: '3 BB' },
    2: { ab: 4, h: 0, bb: 0, battingLine: '4x0', extraNotes: '' },
    3: { ab: 3, h: 0, bb: 1, battingLine: '3x0', extraNotes: 'BB' },
    4: { ab: 3, h: 1, bb: 1, battingLine: '3x1', extraNotes: 'BB' },
    5: { ab: 4, h: 0, bb: 0, battingLine: '4x0', extraNotes: '' },
    6: { ab: 3, h: 1, bb: 0, battingLine: '3x1', extraNotes: '' },
    7: { ab: 1, h: 0, bb: 2, battingLine: '1x0', extraNotes: '2 BB' },
    8: { ab: 3, h: 0, bb: 0, battingLine: '3x0', extraNotes: '' },
    9: { ab: 1, h: 0, bb: 2, battingLine: '1x0', extraNotes: '2 BB' },
    10: { ab: 3, h: 0, bb: 0, battingLine: '3x0', extraNotes: '' },
    11: { ab: 2, h: 1, bb: 0, battingLine: '2x1', extraNotes: 'SAC, F RBI' },
    12: { ab: 2, h: 0, bb: 1, battingLine: '2x0', extraNotes: 'BB' },
  };

  cardenalesTeam.batters = cardenalesTeam.batters.map((b) => {
    const pen = penDataByOrder[b.order];
    if (pen) {
      return {
        ...b,
        ab: pen.ab,
        h: pen.h,
        bb: pen.bb,
        battingLine: pen.battingLine,
        avg: pen.ab > 0 ? (pen.h / pen.ab).toFixed(3).replace(/^0/, '') : '.000',
        extraNotes: pen.extraNotes || b.extraNotes || '',
      };
    }
    return b;
  });

  // Recalculate totals
  const playing = cardenalesTeam.batters.filter(b => b.order > 0);
  const totalAb = playing.reduce((acc, b) => acc + (b.ab || 0), 0);
  const totalH = playing.reduce((acc, b) => acc + (b.h || 0), 0);
  const totalR = playing.reduce((acc, b) => acc + (b.r || 0), 0);
  const totalRbi = playing.reduce((acc, b) => acc + (b.rbi || 0), 0);
  const totalBb = playing.reduce((acc, b) => acc + (b.bb || 0), 0);
  const totalSo = playing.reduce((acc, b) => acc + (b.so || 0), 0);

  cardenalesTeam.totals = {
    ab: totalAb,
    h: totalH,
    r: totalR || 6,
    rbi: totalRbi,
    bb: totalBb,
    so: totalSo,
    hr: 0,
    avg: totalAb > 0 ? (totalH / totalAb).toFixed(3).replace(/^0/, '') : '.000'
  };

  // Ensure game root fields match
  const updatedData = {
    boxScore: {
      ...boxScore,
      teams,
      winningPitcher: 'Axel Joyany Valles Ordas',
      finalScore: {
        awayScore: 6,
        homeScore: 0
      }
    },
    winningPitcher: 'Axel Joyany Valles Ordas',
    score: {
      away: 6,
      home: 0
    }
  };

  await updateDoc(gRef, updatedData);
  console.log('Successfully updated game EFZbsTdrs7ZMuuzZ8Wxj with pen data!');
  console.log('CARDENALES totals:', cardenalesTeam.totals);

  process.exit(0);
}

updateGameWithPenData().catch(e => {
  console.error(e);
  process.exit(1);
});
