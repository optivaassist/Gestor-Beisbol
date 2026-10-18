import { db } from '../firebase';
import { collection, getDocs, query, where, doc, getDoc, setDoc } from 'firebase/firestore';
import { Player, Team, GameBoxScoreData, TeamBoxScore, BoxScoreBatter, GamePitchingData, TeamPitchingBoxScore, PitcherBoxScore, Game, GameScorebooks, ScorebookSheetRecord } from '../types';

export const normalizeStr = (s: any): string => {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
};

/**
 * Fetch official cédula roster from Firestore for a given team
 */
export async function fetchTeamRoster(teamId: string, teamName: string, allTeams?: Team[]): Promise<Player[]> {
  try {
    let resolvedTeamId = teamId;

    if (!resolvedTeamId && allTeams && teamName) {
      const targetNorm = normalizeStr(teamName);
      const match = allTeams.find(t => {
        const tn = normalizeStr(t.name);
        return tn === targetNorm || tn.includes(targetNorm) || targetNorm.includes(tn);
      });
      if (match) resolvedTeamId = match.id;
    }

    if (!resolvedTeamId && teamName) {
      const teamsSnap = await getDocs(collection(db, 'teams'));
      const targetNorm = normalizeStr(teamName);
      const match = teamsSnap.docs.find(d => {
        const tn = normalizeStr(d.data().name);
        return tn === targetNorm || tn.includes(targetNorm) || targetNorm.includes(tn);
      });
      if (match) resolvedTeamId = match.id;
    }

    if (resolvedTeamId) {
      const q = query(collection(db, 'players'), where('teamId', '==', resolvedTeamId));
      const snap = await getDocs(q);
      if (!snap.empty) {
        return snap.docs.map(d => ({ id: d.id, ...d.data() } as Player));
      }
    }

    // Secondary fallback: scan players
    const allPlayersSnap = await getDocs(collection(db, 'players'));
    const matched = allPlayersSnap.docs.filter(d => {
      const data = d.data();
      return resolvedTeamId && data.teamId === resolvedTeamId;
    });
    return matched.map(d => ({ id: d.id, ...d.data() } as Player));
  } catch (err) {
    console.error(`Error fetching roster for team ${teamName} (${teamId}):`, err);
    return [];
  }
}

export interface ProcessedScorebookFile {
  dataUrl: string; // Full compressed resolution for Gemini and full viewing
  thumbnailUrl: string; // Very compact thumbnail (< 15 KB)
  fileType: 'image' | 'pdf' | 'excel';
  fileName: string;
}

/**
 * Universal file processor for Scorebook (Photo/Image, PDF, Excel)
 * Ensures images are compressed to safely fit in Firestore and prevent 1MB overflow.
 */
export async function processScorebookFile(file: File): Promise<ProcessedScorebookFile> {
  const fileName = file.name;
  const isPdf = file.type === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf');
  const isExcel =
    file.type.includes('spreadsheet') ||
    file.type.includes('excel') ||
    fileName.toLowerCase().endsWith('.xlsx') ||
    fileName.toLowerCase().endsWith('.xls') ||
    fileName.toLowerCase().endsWith('.csv');

  if (isPdf) {
    const dataUrl = await readFileAsDataURL(file);
    return { dataUrl, thumbnailUrl: '', fileType: 'pdf', fileName };
  }

  if (isExcel) {
    const dataUrl = await readFileAsDataURL(file);
    return { dataUrl, thumbnailUrl: '', fileType: 'excel', fileName };
  }

  // Image file: apply intelligent compression + thumbnail
  const { dataUrl, thumbnailUrl } = await compressImageToDataUrl(file);
  return { dataUrl, thumbnailUrl: '', fileType: 'image', fileName };
}

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });
}

function compressImageToDataUrl(file: File): Promise<{ dataUrl: string; thumbnailUrl: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (e) => {
      const img = new Image();
      img.src = e.target?.result as string;
      img.onload = () => {
        // 1. Full image for OCR and viewing (max 1280px)
        const MAX_WIDTH = 1280;
        const MAX_HEIGHT = 1280;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height = Math.round((height * MAX_WIDTH) / width);
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width = Math.round((width * MAX_HEIGHT) / height);
            height = MAX_HEIGHT;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          const raw = e.target?.result as string;
          resolve({ dataUrl: raw, thumbnailUrl: raw });
          return;
        }
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        let quality = 0.68;
        let dataUrl = canvas.toDataURL('image/jpeg', quality);

        // If dataUrl exceeds ~350KB (which can approach Firestore limit if duplicated), step down quality
        if (dataUrl.length > 400000) {
          quality = 0.52;
          dataUrl = canvas.toDataURL('image/jpeg', quality);
        }
        if (dataUrl.length > 480000) {
          const sCanvas = document.createElement('canvas');
          sCanvas.width = Math.round(width * 0.75);
          sCanvas.height = Math.round(height * 0.75);
          const sCtx = sCanvas.getContext('2d');
          if (sCtx) {
            sCtx.fillStyle = '#FFFFFF';
            sCtx.fillRect(0, 0, sCanvas.width, sCanvas.height);
            sCtx.drawImage(img, 0, 0, sCanvas.width, sCanvas.height);
            dataUrl = sCanvas.toDataURL('image/jpeg', 0.50);
          }
        }

        // 2. Generate ultra-compact thumbnail (< 15 KB)
        const THUMB_MAX = 260;
        let tWidth = img.width;
        let tHeight = img.height;
        if (tWidth > tHeight) {
          if (tWidth > THUMB_MAX) {
            tHeight = Math.round((tHeight * THUMB_MAX) / tWidth);
            tWidth = THUMB_MAX;
          }
        } else {
          if (tHeight > THUMB_MAX) {
            tWidth = Math.round((tWidth * THUMB_MAX) / tHeight);
            tHeight = THUMB_MAX;
          }
        }
        const thumbCanvas = document.createElement('canvas');
        thumbCanvas.width = tWidth;
        thumbCanvas.height = tHeight;
        const tCtx = thumbCanvas.getContext('2d');
        let thumbnailUrl = dataUrl;
        if (tCtx) {
          tCtx.fillStyle = '#FFFFFF';
          tCtx.fillRect(0, 0, tWidth, tHeight);
          tCtx.drawImage(img, 0, 0, tWidth, tHeight);
          thumbnailUrl = thumbCanvas.toDataURL('image/jpeg', 0.45);
        }

        resolve({ dataUrl, thumbnailUrl });
      };
      img.onerror = () => {
        const raw = e.target?.result as string;
        resolve({ dataUrl: raw, thumbnailUrl: raw });
      };
    };
    reader.onerror = (err) => reject(err);
  });
}

/**
 * Reconciles Box Score data with official cédula rosters.
/**
 * Recursively cleans any object or array for Firestore, deleting all `undefined`
 * values and normalizing invalid numbers (NaN, Infinity).
 */
export function cleanFirestoreData<T>(obj: T): T {
  if (obj === undefined) {
    return null as any;
  }
  if (obj === null) {
    return null as any;
  }
  if (typeof obj !== 'object') {
    if (typeof obj === 'number' && !Number.isFinite(obj)) {
      return 0 as any;
    }
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(item => cleanFirestoreData(item)) as any;
  }
  const clean: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      clean[key] = cleanFirestoreData(value);
    }
  }
  return clean as T;
}

// Helper for illegible / missing string
export const formatSafeStr = (val: any, fallback: string = '-'): string => {
  if (val === undefined || val === null) return fallback;
  const s = String(val).trim();
  if (!s || s.toLowerCase() === 'null' || s.toLowerCase() === 'undefined' || s.toLowerCase().includes('ilegible')) {
    return fallback;
  }
  return s;
};

// Helper to safely parse numbers
export const formatSafeNum = (val: any, fallback: number = 0): number => {
  const n = Number(val);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : fallback;
};

/**
 * Common baseball team abbreviations, nicknames, and aliases
 * Handles cases like: Cardenales -> "cards", Rangers -> "texas" / "txs", Athletics -> "a's" / "oak", etc.
 */
export const TEAM_ALIASES_MAP: Record<string, string[]> = {
  cardenales: ['cards', 'cardinals', 'cdls', 'crd', 'slc', 'san luis'],
  cardinals: ['cards', 'cardenales', 'cdls', 'crd', 'slc'],
  rangers: ['texas', 'txs', 'tex', 'rng', 'tejas'],
  texas: ['rangers', 'txs', 'tex', 'rng'],
  atleticos: ['oak', 'oakland', 'as', "a's", 'athletics', 'atleticos de oakland'],
  athletics: ['oak', 'oakland', 'as', "a's", 'atleticos'],
  astros: ['hou', 'houston', 'ast', 'astros de houston'],
  houston: ['astros', 'hou', 'ast'],
  yankees: ['nyy', 'ny', 'yank', 'nueva york'],
  dodgers: ['lad', 'la', 'dodg', 'los angeles'],
  redsox: ['bos', 'boston', 'sox', 'medias rojas'],
  whitesox: ['cws', 'chicago', 'medias blancas'],
  cubs: ['chc', 'cachorros'],
  cachorros: ['chc', 'cubs'],
  braves: ['atl', 'atlanta', 'bravos'],
  bravos: ['atl', 'atlanta', 'braves'],
  giants: ['sf', 'san francisco', 'gigantes'],
  gigantes: ['sf', 'san francisco', 'giants'],
  padres: ['sd', 'san diego'],
  phillies: ['phi', 'filadelfia', 'filis'],
  mets: ['nym', 'metropolitanos'],
  bluejays: ['tor', 'toronto', 'jays', 'azulejos'],
  orioles: ['bal', 'baltimore', 'oropendolas'],
  rays: ['tb', 'tampa', 'tampa bay', 'rayas'],
  marlins: ['mia', 'miami', 'marlines'],
  pirates: ['pit', 'pittsburgh', 'piratas'],
  piratas: ['pit', 'pittsburgh', 'pirates'],
  reds: ['cin', 'cincinnati', 'rojos'],
  rojos: ['cin', 'cincinnati', 'reds'],
  brewers: ['mil', 'milwaukee', 'cerveceros'],
  cerveceros: ['mil', 'milwaukee', 'brewers'],
  royals: ['kc', 'kansas', 'kansas city', 'reales'],
  reales: ['kc', 'kansas', 'kansas city', 'royals'],
  tigers: ['det', 'detroit', 'tigres'],
  tigres: ['det', 'detroit', 'tigers'],
  twins: ['min', 'minnesota', 'mellizos'],
  mellizos: ['min', 'minnesota', 'twins'],
  guardians: ['cle', 'cleveland', 'indios'],
  indios: ['cle', 'cleveland', 'guardians'],
  mariners: ['sea', 'seattle', 'marineros'],
  marineros: ['sea', 'seattle', 'mariners'],
  angels: ['laa', 'angelinos', 'anaheim'],
  angelinos: ['laa', 'angels', 'anaheim'],
  diamondbacks: ['ari', 'arizona', 'dbacks', 'serpientes'],
  rockies: ['col', 'colorado'],
  nationals: ['wsh', 'washington', 'nacionales'],
  nacionales: ['wsh', 'washington', 'nationals'],
  // Mexican & regional leagues
  diablos: ['diablos rojos', 'mex', 'mexico', 'diab'],
  sultanes: ['sultanes de monterrey', 'mty', 'monterrey', 'sult'],
  tomateros: ['cln', 'culiacan', 'tom'],
  naranjeros: ['her', 'hermosillo', 'nar'],
  venados: ['maz', 'mazatlan', 'ven'],
  yaquis: ['obr', 'obregon', 'yaq'],
  caneros: ['lm', 'los mochis', 'mochis', 'can'],
  mayos: ['nav', 'navojoa', 'may'],
  charros: ['gdl', 'jalisco', 'guadalajara', 'char'],
  algodoneros: ['gsv', 'guasave', 'alg', 'union laguna'],
  toros: ['tij', 'tijuana', 'tor'],
  acereros: ['mva', 'monclova', 'ace'],
  tecolotes: ['nl', 'dos laredos', 'laredo', 'tec'],
  saraperos: ['slw', 'saltillo', 'sar'],
  rieleros: ['ags', 'aguascalientes', 'rie'],
  pericos: ['pue', 'puebla', 'per'],
  aguila: ['ver', 'veracruz', 'el aguila'],
};

/**
 * Checks if an extracted team name matches an official team name taking
 * aliases, nicknames, abbreviations and partial tokens into account.
 */
export function matchTeamNameWithAliases(extracted: string, official: string): boolean {
  if (!extracted || !official) return false;
  const extNorm = normalizeStr(extracted).replace(/[^a-z0-9]/g, '');
  const offNorm = normalizeStr(official).replace(/[^a-z0-9]/g, '');
  if (!extNorm || !offNorm) return false;

  // Exact or direct substring
  if (extNorm === offNorm) return true;
  if (extNorm.includes(offNorm) || offNorm.includes(extNorm)) return true;

  // Check alias dictionary
  for (const [key, aliases] of Object.entries(TEAM_ALIASES_MAP)) {
    const keyNorm = normalizeStr(key).replace(/[^a-z0-9]/g, '');
    const isOfficialThisKey = offNorm.includes(keyNorm) || aliases.some(a => offNorm.includes(normalizeStr(a).replace(/[^a-z0-9]/g, '')));
    if (isOfficialThisKey) {
      if (extNorm.includes(keyNorm) || keyNorm.includes(extNorm)) return true;
      if (aliases.some(a => {
        const aNorm = normalizeStr(a).replace(/[^a-z0-9]/g, '');
        return extNorm === aNorm || extNorm.includes(aNorm) || aNorm.includes(extNorm);
      })) {
        return true;
      }
    }
  }

  // Multi-word token overlap
  const extWords = normalizeStr(extracted).split(/\s+/).filter(w => w.length >= 3);
  const offWords = normalizeStr(official).split(/\s+/).filter(w => w.length >= 3);
  if (extWords.some(ew => offWords.some(ow => ew === ow || ew.startsWith(ow) || ow.startsWith(ew)))) {
    return true;
  }

  return false;
}

/**
 * Parses batting performance notation written on the right of each batter row in scorebooks
 * (e.g. "2x0", "de 4-0", "4-2", "3x1", "2-0", "de 2x0")
 * where the first number before 'x' or '-' is At-Bats (AB / turnos al bat)
 * and the second number after 'x' or '-' is Hits (H / imparables).
 *
 * Rules:
 * 1. Formats "2-0" and "2x0" produce identical results (AB: 2, H: 0).
 * 2. AB is strictly the FIRST number, H is strictly the SECOND number.
 * 3. Hits can never exceed at-bats (if inverted, automatically corrects).
 * 4. Detects HR ("HR", "Jonrón", "Cuadrangular") and counts in HR and Hits.
 * 5. Computes individual Batting Average (AVG = H / AB).
 */
export function parseBattingPerformance(
  rawBattingLine?: string,
  rawAb?: any,
  rawH?: any,
  rawNotes?: string,
  rawHr?: any
): { ab: number; h: number; hr: number; avg: string; battingLine: string; isDnp: boolean } {
  const lineStr = String(rawBattingLine || '').trim();
  const notesStr = String(rawNotes || '').trim();
  const combined = `${lineStr} ${notesStr}`.trim();

  // Check for explicit "No jugó" / DNP
  const isDnpText =
    lineStr.toLowerCase().includes('no jug') ||
    lineStr.toLowerCase().includes('dnp') ||
    notesStr.toLowerCase().includes('no jug');

  // Check for explicit "Dato no disponible" / no disponible
  const isNotAvailable =
    lineStr.toLowerCase().includes('dato no disponible') ||
    lineStr.toLowerCase().includes('no disponible') ||
    notesStr.toLowerCase().includes('dato no disponible') ||
    notesStr.toLowerCase().includes('no disponible');

  // Check for explicit "No legible" / illegible
  const isNoLegible =
    lineStr.toLowerCase().includes('no legible') ||
    lineStr.toLowerCase().includes('ilegible') ||
    notesStr.toLowerCase().includes('no legible') ||
    notesStr.toLowerCase().includes('ilegible');

  if (isNotAvailable) {
    return { ab: 0, h: 0, hr: 0, avg: '.000', battingLine: 'Dato no disponible', isDnp: false };
  }

  if (isNoLegible) {
    return { ab: 0, h: 0, hr: 0, avg: '.000', battingLine: 'No legible', isDnp: false };
  }

  // Match notations like "2x0", "4-2", "de 4-0", "3X1", "2-0", "1x1", "4x2", "2*0", "2:0"
  // Group 1: AB (turnos al bat), Group 2: H (hits conectados)
  // Check notesStr first if it contains a pen correction, otherwise combined
  const penRegex = /(?:de\s+)?(\d+)\s*(?:[xX\-\/\*:\.]|por|a)\s*(\d+)/i;
  const match = notesStr.match(penRegex) || lineStr.match(penRegex) || combined.match(penRegex);

  let ab = formatSafeNum(rawAb);
  let h = formatSafeNum(rawH);

  if (match) {
    const matchedAb = parseInt(match[1], 10);
    const matchedH = parseInt(match[2], 10);
    if (!isNaN(matchedAb)) {
      ab = matchedAb;
    }
    if (!isNaN(matchedH)) {
      h = matchedH;
    }
  }

  // Safety check: In baseball, hits can never exceed turnos al bat (AB)
  if (h > ab) {
    const temp = ab;
    ab = h;
    h = temp;
  }

  // HR detection: check explicit field or text in line / notes
  const hasHrText = /(\bhr\b|\bjonron\b|\bjonrón\b|\bcuadrangular\b)/i.test(combined);
  let hr = Number.isFinite(Number(rawHr)) && Number(rawHr) > 0 ? Number(rawHr) : (hasHrText ? 1 : 0);

  // If HR is detected, it must count towards hits and at-bats
  if (hr > 0) {
    h = Math.max(h, hr);
    ab = Math.max(ab, h);
  }

  const isDnp = isDnpText || (ab === 0 && h === 0 && (lineStr === 'No jugó' || lineStr === '-' || lineStr === ''));

  let formattedLine = 'No jugó';
  if (!isDnp) {
    if (lineStr.includes('x') || lineStr.includes('X')) {
      formattedLine = `${ab}x${h}`;
    } else {
      formattedLine = `de ${ab}-${h}`;
    }
  }

  const avg = (!isDnp && ab > 0) ? (h / ab).toFixed(3).replace(/^0/, '') : '.000';

  return { ab, h, hr, avg, battingLine: formattedLine, isDnp };
}

/**
 * Reconciles Box Score data with official cédula rosters.
 * Rules:
 * 1. Strictly uses names from cédula when matching.
 * 2. If a player or handwriting is illegible / unidentified, label as 'Jugador no identificado'.
 * 3. If numbers (jersey, order) or positions are illegible, use '-' or appropriate defaults.
 * 4. 100% of cédula players appear (unplayed as order: 0, 'No jugó', 0 stats).
 * 5. Active players appear first ordered by batting order.
 * 6. ZERO undefined values returned to guarantee Firestore updateDoc never fails.
 */
export function reconcileBoxScore(
  boxScore: GameBoxScoreData,
  homeTeamName: string,
  awayTeamName: string,
  homeRoster: Player[],
  awayRoster: Player[]
): GameBoxScoreData {
  if (!boxScore || !boxScore.teams) return boxScore;

  const updatedTeams: TeamBoxScore[] = boxScore.teams.map((team, idx): TeamBoxScore => {
    const isHome =
      team.teamType === 'home' ||
      matchTeamNameWithAliases(team.teamName, homeTeamName) ||
      (!team.teamType && idx === 1);

    const officialRoster = isHome ? homeRoster : awayRoster;
    const officialTeamName = isHome ? (homeTeamName || team.teamName || 'Equipo Local') : (awayTeamName || team.teamName || 'Equipo Visitante');

    const matchedOfficialIds = new Set<string>();
    const reconciledBatters: BoxScoreBatter[] = [];

    // 1. Process AI detected batters
    for (const aiBatter of (team.batters || [])) {
      const rawName = String(aiBatter.name || '').trim();
      const isIllegibleName =
        !rawName ||
        rawName.toLowerCase().includes('ilegible') ||
        rawName.toLowerCase().includes('desconocido') ||
        rawName.toLowerCase().includes('no legible') ||
        rawName === '?' ||
        rawName === '-';

      const aiBatterNorm = normalizeStr(rawName);

      // Try matching with official roster
      let matched: Player | undefined = undefined;
      if (!isIllegibleName && officialRoster && officialRoster.length > 0) {
        matched = officialRoster.find((op) => {
          if (matchedOfficialIds.has(op.id || op.name)) return false;
          const opNorm = normalizeStr(op.name);
          if (opNorm === aiBatterNorm) return true;

          // Substring / word match
          const opParts = opNorm.split(' ').filter(p => p.length >= 3);
          const aiParts = aiBatterNorm.split(' ').filter(p => p.length >= 3);
          if (opParts.some(p => aiBatterNorm.includes(p))) return true;
          if (aiParts.some(p => opNorm.includes(p))) return true;

          // Jersey match with initial
          if (aiBatter.playerNumber && op.number && String(aiBatter.playerNumber).replace('#','').trim() === String(op.number).replace('#','').trim()) {
            if (aiBatterNorm[0] === opNorm[0]) return true;
          }

          return false;
        });
      }

      const {
        ab: abVal,
        h: hVal,
        hr: hrVal,
        avg: avgVal,
        battingLine: parsedBattingLine,
        isDnp
      } = parseBattingPerformance(
        aiBatter.battingLine,
        aiBatter.ab,
        aiBatter.h,
        aiBatter.extraNotes,
        aiBatter.hr
      );

      let notesClean = String(aiBatter.extraNotes || (isDnp ? 'No jugó' : '')).trim();
      if (hrVal > 0 && !notesClean.toUpperCase().includes('HR') && !notesClean.toUpperCase().includes('JONRON')) {
        notesClean = notesClean && notesClean !== '-' ? `${notesClean}, HR` : 'HR';
      }

      if (matched) {
        matchedOfficialIds.add(matched.id || matched.name);
        const jerseyNum = formatSafeStr(matched.number || aiBatter.playerNumber, '-');
        const pos = formatSafeStr(aiBatter.position || matched.position, '-');

        reconciledBatters.push({
          order: isDnp ? 0 : (formatSafeNum(aiBatter.order) || reconciledBatters.length + 1),
          playerNumber: jerseyNum,
          name: matched.name, // Strictly official name from cédula
          position: pos,
          battingLine: isDnp ? 'No jugó' : parsedBattingLine,
          ab: isDnp ? 0 : abVal,
          r: isDnp ? 0 : formatSafeNum(aiBatter.r),
          h: isDnp ? 0 : hVal,
          rbi: isDnp ? 0 : formatSafeNum(aiBatter.rbi),
          bb: isDnp ? 0 : formatSafeNum(aiBatter.bb),
          so: isDnp ? 0 : formatSafeNum(aiBatter.so),
          hr: isDnp ? 0 : hrVal,
          avg: isDnp ? '.000' : avgVal,
          extraNotes: notesClean,
        });
      } else {
        // Player not in official roster or name was illegible
        const assignedName = isIllegibleName ? 'Jugador no identificado' : rawName;
        const jerseyNum = formatSafeStr(aiBatter.playerNumber, '-');
        const pos = formatSafeStr(aiBatter.position, '-');

        reconciledBatters.push({
          order: isDnp ? 0 : (formatSafeNum(aiBatter.order) || reconciledBatters.length + 1),
          playerNumber: jerseyNum,
          name: assignedName,
          position: pos,
          battingLine: isDnp ? 'No jugó' : parsedBattingLine,
          ab: isDnp ? 0 : abVal,
          r: isDnp ? 0 : formatSafeNum(aiBatter.r),
          h: isDnp ? 0 : hVal,
          rbi: isDnp ? 0 : formatSafeNum(aiBatter.rbi),
          bb: isDnp ? 0 : formatSafeNum(aiBatter.bb),
          so: isDnp ? 0 : formatSafeNum(aiBatter.so),
          hr: isDnp ? 0 : hrVal,
          avg: isDnp ? '.000' : avgVal,
          extraNotes: notesClean,
        });
      }
    }

    // 2. Guarantee 100% of remaining cédula players are added as "No jugó" / 0
    if (officialRoster && officialRoster.length > 0) {
      for (const op of officialRoster) {
        if (!matchedOfficialIds.has(op.id || op.name)) {
          reconciledBatters.push({
            order: 0,
            playerNumber: formatSafeStr(op.number, '-'),
            name: op.name, // Strictly official name from cédula
            position: formatSafeStr(op.position, '-'),
            battingLine: 'No jugó',
            ab: 0,
            r: 0,
            h: 0,
            rbi: 0,
            bb: 0,
            so: 0,
            hr: 0,
            avg: '.000',
            extraNotes: 'No jugó',
          });
        }
      }
    }

    // 3. Sort: players who played (order > 0) in batting order, then unplayed (order: 0)
    reconciledBatters.sort((a, b) => {
      const orderA = a.order || 0;
      const orderB = b.order || 0;
      if (orderA > 0 && orderB > 0) return orderA - orderB;
      if (orderA > 0) return -1;
      if (orderB > 0) return 1;
      return a.name.localeCompare(b.name);
    });

    // 4. Calculate team totals from active players only
    const playingBatters = reconciledBatters.filter(b => b.battingLine !== 'No jugó');
    const abTotal = playingBatters.reduce((acc, b) => acc + (b.ab || 0), 0);
    const rTotal = playingBatters.reduce((acc, b) => acc + (b.r || 0), 0);
    const hTotal = playingBatters.reduce((acc, b) => acc + (b.h || 0), 0);
    const rbiTotal = playingBatters.reduce((acc, b) => acc + (b.rbi || 0), 0);
    const bbTotal = playingBatters.reduce((acc, b) => acc + (b.bb || 0), 0);
    const soTotal = playingBatters.reduce((acc, b) => acc + (b.so || 0), 0);
    const hrTotal = playingBatters.reduce((acc, b) => acc + (b.hr || 0), 0);
    const avg = abTotal > 0 ? (hTotal / abTotal).toFixed(3).replace(/^0/, '') : '.000';

    return {
      teamName: officialTeamName,
      teamType: isHome ? ('home' as const) : ('away' as const),
      batters: reconciledBatters,
      totals: {
        ab: abTotal,
        r: rTotal,
        h: hTotal,
        rbi: rbiTotal,
        bb: bbTotal,
        so: soTotal,
        hr: hrTotal,
        avg,
      },
      notes: String(team.notes || '').trim(),
    };
  });

  // Detect winning pitcher from box score or from decisions
  let winPitcher = boxScore.winningPitcher;
  if (
    winPitcher &&
    (winPitcher.toLowerCase().includes('no ident') ||
      winPitcher.toLowerCase().includes('desconocido') ||
      winPitcher === '-' ||
      winPitcher === '?')
  ) {
    winPitcher = undefined;
  }
  let losePitcher = boxScore.losingPitcher;
  let svPitcher = boxScore.savePitcher;

  // Calculate finalScore if available
  let calculatedFinalScore = boxScore.finalScore;
  if (!calculatedFinalScore) {
    const awayTeam = updatedTeams.find(t => t.teamType === 'away');
    const homeTeam = updatedTeams.find(t => t.teamType === 'home');
    if (awayTeam && homeTeam && (awayTeam.totals.r > 0 || homeTeam.totals.r > 0)) {
      calculatedFinalScore = {
        awayScore: awayTeam.totals.r,
        homeScore: homeTeam.totals.r,
      };
    }
  }

  const finalBox: GameBoxScoreData = {
    teams: updatedTeams,
    detectedAt: boxScore.detectedAt || new Date().toISOString(),
    detectedBy: boxScore.detectedBy || 'Jefe de Categoría',
    generalNotes: String(boxScore.generalNotes || '').trim(),
    winningPitcher: winPitcher || undefined,
    losingPitcher: losePitcher || undefined,
    savePitcher: svPitcher || undefined,
    finalScore: calculatedFinalScore || undefined,
  };

  return cleanFirestoreData(finalBox);
}


/**
 * Reconciles Pitching Data (conteo de lanzamientos) with official rosters
 */
export function reconcilePitchingBoxScore(
  pitchingData: GamePitchingData,
  homeTeamName: string,
  awayTeamName: string,
  homeRoster: Player[],
  awayRoster: Player[]
): GamePitchingData {
  const rawTeams = pitchingData.teams || [];

  const teamsToProcess = [
    { type: 'away' as const, name: awayTeamName, roster: awayRoster },
    { type: 'home' as const, name: homeTeamName, roster: homeRoster },
  ];

  let detectedWinPitcher = pitchingData.winningPitcher;
  let detectedLosePitcher = pitchingData.losingPitcher;
  let detectedSavePitcher = pitchingData.savePitcher;

  const updatedTeams: TeamPitchingBoxScore[] = teamsToProcess.map(({ type, name: officialTeamName, roster: officialRoster }) => {
    // Find matching team in AI results with alias awareness
    const foundTeam = rawTeams.find(t => {
      if (type === 'home' && (t.teamType === 'home' || matchTeamNameWithAliases(t.teamName, homeTeamName))) return true;
      if (type === 'away' && (t.teamType === 'away' || matchTeamNameWithAliases(t.teamName, awayTeamName))) return true;
      return false;
    }) || rawTeams.find(t => (type === 'away' ? t.teamType !== 'home' : t.teamType === 'home'));

    const rawPitchers: PitcherBoxScore[] = foundTeam?.pitchers || [];
    const reconciledPitchers: PitcherBoxScore[] = [];

    for (const p of rawPitchers) {
      const rawName = String(p.name || '').trim();
      const pNorm = normalizeStr(rawName);

      // Match with cédula
      let matchedPlayer: Player | undefined;
      if (officialRoster && officialRoster.length > 0) {
        matchedPlayer = officialRoster.find(op => {
          const opNorm = normalizeStr(op.name);
          return opNorm === pNorm || opNorm.includes(pNorm) || (pNorm.length > 4 && pNorm.includes(opNorm));
        });
      }

      const finalName = matchedPlayer ? matchedPlayer.name : (pNorm ? rawName : 'Jugador no identificado');
      const finalNumber = formatSafeStr(matchedPlayer?.number || p.playerNumber, '-');
      const pitchesVal = formatSafeNum(p.pitches);
      const dec = formatSafeStr(p.decision, '-').toUpperCase();

      if ((dec === 'W' || dec === 'G' || dec === 'PG') && !detectedWinPitcher && finalName !== 'Jugador no identificado') {
        detectedWinPitcher = finalName;
      } else if ((dec === 'L' || dec === 'P' || dec === 'PP') && !detectedLosePitcher && finalName !== 'Jugador no identificado') {
        detectedLosePitcher = finalName;
      } else if ((dec === 'SV' || dec === 'S' || dec === 'JS') && !detectedSavePitcher && finalName !== 'Jugador no identificado') {
        detectedSavePitcher = finalName;
      }

      reconciledPitchers.push({
        playerNumber: finalNumber,
        name: finalName,
        decision: dec,
        ip: formatSafeStr(p.ip, '0.0'),
        pitches: pitchesVal,
        strikes: formatSafeNum(p.strikes),
        balls: formatSafeNum(p.balls),
        h: formatSafeNum(p.h),
        r: formatSafeNum(p.r),
        er: formatSafeNum(p.er),
        bb: formatSafeNum(p.bb),
        so: formatSafeNum(p.so),
        notes: String(p.notes || '').trim(),
      });
    }

    const totalPitches = reconciledPitchers.reduce((acc, p) => acc + (p.pitches || 0), 0);

    return {
      teamName: officialTeamName,
      teamType: type,
      pitchers: reconciledPitchers,
      totalPitches,
      notes: String(foundTeam?.notes || '').trim(),
    };
  });

  const finalPitching: GamePitchingData = {
    teams: updatedTeams,
    detectedAt: pitchingData.detectedAt || new Date().toISOString(),
    detectedBy: pitchingData.detectedBy || 'Jefe de Categoría',
    generalNotes: String(pitchingData.generalNotes || '').trim(),
    winningPitcher: detectedWinPitcher || undefined,
    losingPitcher: detectedLosePitcher || undefined,
    savePitcher: detectedSavePitcher || undefined,
    finalScore: pitchingData.finalScore || undefined,
  };

  return cleanFirestoreData(finalPitching);
}

/**
 * Saves full scorebook file in subcollection games/{gameId}/scorebook_files/{sheetKey}
 * so each document has its own dedicated 1MB Firestore limit and never bloats the main game doc.
 */
/**
 * Strips all heavy base64 strings (fileUrl, thumbnailUrl) from a ScorebookSheetRecord
 * ensuring it contains only lightweight metadata (~150 bytes) for storage in the main Game document.
 */
export function sanitizeScorebookSheetForMainDoc(sheet: any): ScorebookSheetRecord {
  return {
    hasFile: true,
    fileName: sheet?.fileName || 'libro',
    fileType: sheet?.fileType || 'image',
    uploadedAt: sheet?.uploadedAt || new Date().toISOString(),
    uploadedBy: sheet?.uploadedBy || 'Jefe de Categoría',
    category: sheet?.category || 'batting',
    teamType: sheet?.teamType || 'away',
    teamName: sheet?.teamName || '',
    notes: sheet?.notes || '',
  };
}

/**
 * Sanitizes all sheets in GameScorebooks so NO base64 strings (fileUrl, thumbnailUrl)
 * are ever stored inside the main Game document, preventing 1MB Firestore overflow.
 */
export function sanitizeScorebooksForMainDoc(scorebooks?: GameScorebooks | null): GameScorebooks {
  if (!scorebooks) return {};
  const cleaned: GameScorebooks = {};
  for (const [key, sheet] of Object.entries(scorebooks)) {
    if (sheet && (sheet.hasFile || sheet.fileUrl || sheet.thumbnailUrl || sheet.fileName)) {
      cleaned[key as keyof GameScorebooks] = sanitizeScorebookSheetForMainDoc(sheet);
    }
  }
  return cleaned;
}

/**
 * Saves full scorebook file in subcollection games/{gameId}/scorebook_files/{sheetKey}
 * so each document has its own dedicated 1MB Firestore limit and never bloats the main game doc.
 */
export async function saveScorebookFile(
  gameId: string,
  sheetKey: string,
  record: {
    fileUrl: string;
    thumbnailUrl?: string;
    fileName: string;
    fileType: string;
    uploadedAt: string;
    uploadedBy?: string;
    category?: string;
    teamType?: string;
    teamName?: string;
  }
): Promise<void> {
  try {
    const fileDocRef = doc(db, 'games', gameId, 'scorebook_files', sheetKey);
    await setDoc(fileDocRef, cleanFirestoreData(record));

    // Also write to default for quick fallback
    const defaultDocRef = doc(db, 'games', gameId, 'scorebook_files', 'default');
    await setDoc(defaultDocRef, cleanFirestoreData(record));
  } catch (err) {
    console.error(`Error saving scorebook file to subcollection for game ${gameId}:`, err);
  }
}

/**
 * Loads full scorebook file dataUrl from subcollection games/{gameId}/scorebook_files/{sheetKey}
 */
export async function loadScorebookFile(gameId: string, sheetKey: string = 'default'): Promise<string | null> {
  try {
    if (sheetKey && sheetKey !== 'default') {
      const fileDocRef = doc(db, 'games', gameId, 'scorebook_files', sheetKey);
      const snap = await getDoc(fileDocRef);
      if (snap.exists() && snap.data()?.fileUrl) {
        return snap.data().fileUrl;
      }
    }
    const defSnap = await getDoc(doc(db, 'games', gameId, 'scorebook_files', 'default'));
    if (defSnap.exists() && defSnap.data()?.fileUrl) {
      return defSnap.data().fileUrl;
    }
    // Also try any other sheet if target or default is empty
    const otherKeys = ['awayBatting', 'homeBatting', 'awayPitching', 'homePitching'];
    for (const k of otherKeys) {
      if (k !== sheetKey) {
        const otherSnap = await getDoc(doc(db, 'games', gameId, 'scorebook_files', k));
        if (otherSnap.exists() && otherSnap.data()?.fileUrl) {
          return otherSnap.data().fileUrl;
        }
      }
    }
    return null;
  } catch (err) {
    console.warn(`Could not load scorebook file from subcollection:`, err);
    return null;
  }
}

/**
 * Counts how many of the 4 scorebook sheets are uploaded for a game
 */
export function getUploadedSheetsCount(game?: Game | null): number {
  if (!game) return 0;
  if (!game.scorebooks) {
    return (game.bookImageUrl || game.bookUploadedAt) ? 1 : 0;
  }
  const count = Object.values(game.scorebooks).filter(s => Boolean(s?.hasFile || s?.fileUrl || s?.thumbnailUrl || s?.fileName)).length;
  return Math.max(count, (game.bookImageUrl || game.bookUploadedAt) ? 1 : 0);
}

/**
 * Checks if a game has any book uploaded
 */
export function hasUploadedBooks(game?: Game | null): boolean {
  if (!game) return false;
  if (game.bookImageUrl && game.bookImageUrl.trim() !== '') return true;
  if (game.bookUploadedAt) return true;
  if (!game.scorebooks) return false;
  return Boolean(
    game.scorebooks.awayBatting?.hasFile ||
    game.scorebooks.awayBatting?.fileUrl ||
    game.scorebooks.awayBatting?.thumbnailUrl ||
    game.scorebooks.awayBatting?.fileName ||
    game.scorebooks.awayPitching?.hasFile ||
    game.scorebooks.awayPitching?.fileUrl ||
    game.scorebooks.awayPitching?.thumbnailUrl ||
    game.scorebooks.awayPitching?.fileName ||
    game.scorebooks.homeBatting?.hasFile ||
    game.scorebooks.homeBatting?.fileUrl ||
    game.scorebooks.homeBatting?.thumbnailUrl ||
    game.scorebooks.homeBatting?.fileName ||
    game.scorebooks.homePitching?.hasFile ||
    game.scorebooks.homePitching?.fileUrl ||
    game.scorebooks.homePitching?.thumbnailUrl ||
    game.scorebooks.homePitching?.fileName
  );
}

/**
 * Merges a newly analyzed Box Score with the existing Box Score.
 * This ensures that uploading/analyzing the scorebook for one team (e.g. Home / Rangers)
 * NEVER overwrites or deletes the already uploaded scorebook data of the other team (e.g. Away / Cardenales).
 */
export function mergeBoxScores(
  existingBoxScore?: GameBoxScoreData | null,
  newBoxScore?: GameBoxScoreData | null,
  targetTeamType?: 'away' | 'home'
): GameBoxScoreData {
  if (!existingBoxScore || !existingBoxScore.teams || existingBoxScore.teams.length === 0) {
    return newBoxScore || { teams: [] };
  }
  if (!newBoxScore || !newBoxScore.teams || newBoxScore.teams.length === 0) {
    return existingBoxScore;
  }

  const existingAway = existingBoxScore.teams.find(t => t.teamType === 'away');
  const existingHome = existingBoxScore.teams.find(t => t.teamType === 'home');
  const newAway = newBoxScore.teams.find(t => t.teamType === 'away');
  const newHome = newBoxScore.teams.find(t => t.teamType === 'home');

  const countActive = (t?: TeamBoxScore) =>
    (t?.batters || []).filter(
      b => b.battingLine !== 'No jugó' && b.order !== 0 && (b.ab > 0 || b.h > 0 || b.bb > 0 || b.battingLine.includes('x') || b.battingLine.includes('-'))
    ).length;

  let mergedAway = newAway;
  let mergedHome = newHome;

  if (targetTeamType === 'home') {
    // We explicitly uploaded/analyzed the Home team sheet!
    // Keep existing Away team if it had active batters or uploaded data:
    if (existingAway && countActive(existingAway) > 0) {
      mergedAway = existingAway;
    }
  } else if (targetTeamType === 'away') {
    // We explicitly uploaded/analyzed the Away team sheet!
    // Keep existing Home team if it had active batters or uploaded data:
    if (existingHome && countActive(existingHome) > 0) {
      mergedHome = existingHome;
    }
  } else {
    // Target team type not explicitly given:
    // If newAway has no active batters but existingAway does, keep existingAway:
    if (existingAway && countActive(existingAway) > 0 && countActive(newAway) === 0) {
      mergedAway = existingAway;
    }
    // If newHome has no active batters but existingHome does, keep existingHome:
    if (existingHome && countActive(existingHome) > 0 && countActive(newHome) === 0) {
      mergedHome = existingHome;
    }
  }

  const mergedTeams: TeamBoxScore[] = [];
  if (mergedAway) mergedTeams.push(mergedAway);
  if (mergedHome) mergedTeams.push(mergedHome);

  // Recalculate final score if both teams exist
  const awayRuns = mergedAway?.totals?.r ?? existingBoxScore.finalScore?.awayScore ?? newBoxScore.finalScore?.awayScore;
  const homeRuns = mergedHome?.totals?.r ?? existingBoxScore.finalScore?.homeScore ?? newBoxScore.finalScore?.homeScore;

  const finalScore =
    awayRuns !== undefined && homeRuns !== undefined
      ? { awayScore: awayRuns, homeScore: homeRuns }
      : (newBoxScore.finalScore || existingBoxScore.finalScore);

  return {
    ...existingBoxScore,
    ...newBoxScore,
    teams: mergedTeams,
    finalScore,
    winningPitcher: newBoxScore.winningPitcher || existingBoxScore.winningPitcher,
    losingPitcher: newBoxScore.losingPitcher || existingBoxScore.losingPitcher,
    savePitcher: newBoxScore.savePitcher || existingBoxScore.savePitcher,
    generalNotes: [existingBoxScore.generalNotes, newBoxScore.generalNotes].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' | '),
  };
}

/**
 * Merges a newly analyzed Pitching Box Score with the existing Pitching Box Score.
 */
export function mergePitchingBoxScores(
  existingPitching?: GamePitchingData | null,
  newPitching?: GamePitchingData | null,
  targetTeamType?: 'away' | 'home'
): GamePitchingData {
  if (!existingPitching || !existingPitching.teams || existingPitching.teams.length === 0) {
    return newPitching || { teams: [] };
  }
  if (!newPitching || !newPitching.teams || newPitching.teams.length === 0) {
    return existingPitching;
  }

  const existingAway = existingPitching.teams.find(t => t.teamType === 'away');
  const existingHome = existingPitching.teams.find(t => t.teamType === 'home');
  const newAway = newPitching.teams.find(t => t.teamType === 'away');
  const newHome = newPitching.teams.find(t => t.teamType === 'home');

  const countPitchers = (t?: TeamPitchingBoxScore) =>
    (t?.pitchers || []).filter(p => (p.pitches || 0) > 0 || (p.ip && p.ip !== '0.0')).length;

  let mergedAway = newAway;
  let mergedHome = newHome;

  if (targetTeamType === 'home') {
    if (existingAway && countPitchers(existingAway) > 0) mergedAway = existingAway;
  } else if (targetTeamType === 'away') {
    if (existingHome && countPitchers(existingHome) > 0) mergedHome = existingHome;
  } else {
    if (existingAway && countPitchers(existingAway) > 0 && countPitchers(newAway) === 0) mergedAway = existingAway;
    if (existingHome && countPitchers(existingHome) > 0 && countPitchers(newHome) === 0) mergedHome = existingHome;
  }

  const mergedTeams: TeamPitchingBoxScore[] = [];
  if (mergedAway) mergedTeams.push(mergedAway);
  if (mergedHome) mergedTeams.push(mergedHome);

  return {
    ...existingPitching,
    ...newPitching,
    teams: mergedTeams,
  };
}

