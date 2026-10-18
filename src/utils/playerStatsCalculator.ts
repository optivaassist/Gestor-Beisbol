import { Player, Game, Team } from '../types';
import { parseBattingPerformance } from './scorebookUtils';

export interface PlayerGameLog {
  gameId: string;
  date: string;
  jornada?: number;
  homeTeamName: string;
  awayTeamName: string;
  opponentName: string;
  isHome: boolean;
  teamScore: number;
  opponentScore: number;
  gameStatus: string;
  isWin?: boolean;
  
  played: boolean;
  battingLine?: string; // "de 4-2"
  ab: number;
  r: number;
  h: number;
  doubles?: number;
  triples?: number;
  hr: number;
  rbi: number;
  bb: number;
  so: number;
  extraNotes?: string;

  pitched?: boolean;
  ip?: number;
  pitchesThrown?: number;
  earnedRunsAllowed?: number;
  pitcherSO?: number;
  pitcherBB?: number;
  isWinningPitcher?: boolean;
  isLosingPitcher?: boolean;
}

export interface PlayerAccumulatedStats {
  player: Player;
  teamName: string;
  category: string;
  
  // Batting
  atBats: number;
  hits: number;
  doubles: number;
  triples: number;
  homeRuns: number;
  runs: number;
  rbis: number;
  walks: number;
  strikeouts: number;
  battingAverage: number;
  avgStr: string;
  obp: number;
  obpStr: string;
  slg: number;
  slgStr: string;
  ops: string;

  // Pitching
  wins: number;
  losses: number;
  inningsPitched: number;
  earnedRuns: number;
  era: number;
  eraStr: string;
  pitches: number; // Pitchadas lanzadas
  pitchingStrikeouts: number;
  pitchingWalks: number;
  whip: string;

  // Game log
  gamesPlayedCount: number;
  gameLogs: PlayerGameLog[];
}

export const normalizeStr = (s: any): string => {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

/**
 * Robust matching between a Player profile and a BoxScoreBatter.
 * Prevents false matches where players sharing common surnames/first names
 * (e.g. Lopez, Garcia, Luis, Jorge) incorrectly inherit stats from another batter.
 */
export function matchBatterToPlayer(player: Player, batters: any[]): any {
  if (!batters || batters.length === 0) return null;
  const pNorm = normalizeStr(player.name);
  const pTokens = pNorm.split(' ').filter(t => t.length > 0);
  if (pTokens.length === 0) return null;

  let bestBatter: any = null;
  let bestScore = -1;

  for (const b of batters) {
    const bNorm = normalizeStr(b.name);
    const bTokens = bNorm.split(' ').filter(t => t.length > 0);
    if (bTokens.length === 0) continue;

    let score = 0;

    // 1. Exact full normalized string match
    if (bNorm === pNorm) {
      score = 1000;
    } else {
      // Overlap tokens
      let matchedTokens = 0;
      for (const pt of pTokens) {
        if (bTokens.includes(pt)) {
          matchedTokens += 1;
        } else if (pt.length >= 4 && bTokens.some(bt => bt.length >= 4 && (bt.slice(0, 4) === pt.slice(0, 4) || bt.startsWith(pt) || pt.startsWith(bt)))) {
          matchedTokens += 0.85;
        } else if (pt.length === 1 && bTokens.some(bt => bt.startsWith(pt))) {
          matchedTokens += 0.7;
        } else if (bTokens.some(bt => bt.length === 1 && pt.startsWith(bt))) {
          matchedTokens += 0.7;
        }
      }

      const totalTokens = Math.max(pTokens.length, bTokens.length);
      const ratio = matchedTokens / totalTokens;

      if (pTokens.length === 1 && bTokens.length === 1 && pTokens[0] === bTokens[0]) {
        score = 800;
      } else if (matchedTokens >= 2 && ratio >= 0.55) {
        score = 500 + Math.round(ratio * 300);
      }
    }

    // Prefer active batters in lineup (order > 0) who actually had at-bats/played
    if (score > 0) {
      if (b.order > 0 && b.battingLine && !b.battingLine.toLowerCase().includes('no jugo')) {
        score += 50;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestBatter = b;
    }
  }

  // Minimum threshold to accept a match
  if (bestScore >= 500) {
    return bestBatter;
  }
  return null;
}

/**
 * Robust matching between a Player profile and a Pitcher record.
 */
export function matchPitcherToPlayer(player: Player, pitchers: any[]): any {
  if (!pitchers || pitchers.length === 0) return null;
  const pNorm = normalizeStr(player.name);
  const pTokens = pNorm.split(' ').filter(t => t.length > 0);
  if (pTokens.length === 0) return null;

  let bestPitcher: any = null;
  let bestScore = -1;

  for (const p of pitchers) {
    const ptNorm = normalizeStr(p.name);
    const ptTokens = ptNorm.split(' ').filter(t => t.length > 0);
    if (ptTokens.length === 0) continue;

    let score = 0;
    if (ptNorm === pNorm) {
      score = 1000;
    } else {
      let matchedTokens = 0;
      for (const pt of pTokens) {
        if (ptTokens.includes(pt)) {
          matchedTokens += 1;
        } else if (pt.length >= 4 && ptTokens.some(bt => bt.length >= 4 && (bt.slice(0, 4) === pt.slice(0, 4) || bt.startsWith(pt) || pt.startsWith(bt)))) {
          matchedTokens += 0.85;
        } else if (pt.length === 1 && ptTokens.some(bt => bt.startsWith(pt))) {
          matchedTokens += 0.7;
        }
      }
      const totalTokens = Math.max(pTokens.length, ptTokens.length);
      const ratio = matchedTokens / totalTokens;
      if (matchedTokens >= 1.7 || (matchedTokens >= 1.5 && ratio >= 0.4)) {
        score = 500 + Math.round(ratio * 300);
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestPitcher = p;
    }
  }

  if (bestScore >= 500) {
    return bestPitcher;
  }
  return null;
}

/**
 * Calculates accumulated player statistics combining player document stats
 * with the match scoring history (box scores and games log).
 */
export function calculatePlayerAccumulatedStats(
  player: Player,
  allGames: Game[],
  teams: Team[]
): PlayerAccumulatedStats {
  const playerTeam = teams.find(t => t.id === player.teamId);
  const teamName = playerTeam?.name || 'Equipo';
  const category = playerTeam?.category || 'General';

  const playerNorm = normalizeStr(player.name);
  const gameLogs: PlayerGameLog[] = [];

  let boxScoreAB = 0;
  let boxScoreH = 0;
  let boxScoreR = 0;
  let boxScoreRBI = 0;
  let boxScoreBB = 0;
  let boxScoreSO = 0;
  let boxScoreHR = 0;
  let boxScore2B = 0;
  let boxScore3B = 0;
  let gamesPlayedInBoxScore = 0;

  // Find all games involving player's team
  const playerGames = allGames.filter(g => 
    g.homeTeamId === player.teamId || 
    g.awayTeamId === player.teamId ||
    normalizeStr(g.homeTeamName) === normalizeStr(teamName) ||
    normalizeStr(g.awayTeamName) === normalizeStr(teamName)
  );

  // Sort games chronologically
  playerGames.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  for (const game of playerGames) {
    const isHome = game.homeTeamId === player.teamId || normalizeStr(game.homeTeamName) === normalizeStr(teamName);
    const opponentName = isHome ? game.awayTeamName : game.homeTeamName;
    const teamScore = isHome ? (game.score?.home ?? 0) : (game.score?.away ?? 0);
    const opponentScore = isHome ? (game.score?.away ?? 0) : (game.score?.home ?? 0);
    const isCompleted = game.status === 'completed';
    const isWin = isCompleted ? teamScore > opponentScore : undefined;

    let played = false;
    let battingLine = 'No jugó';
    let ab = 0;
    let r = 0;
    let h = 0;
    let rbi = 0;
    let bb = 0;
    let so = 0;
    let hr = 0;
    let doubles = 0;
    let triples = 0;
    let extraNotes = '';
    let pitched = false;
    let ip = 0;
    let pitchesThrown = 0;
    let earnedRunsAllowed = 0;
    let pitcherSO = 0;
    let pitcherBB = 0;
    let isWinningPitcher = false;
    let isLosingPitcher = false;

    // 1. Check box score if game has digitized scorebook and is completed
    if (isCompleted && game.boxScore?.teams) {
      const gameTeam = game.boxScore.teams.find(t => 
        (isHome && t.teamType === 'home') || 
        (!isHome && t.teamType === 'away') ||
        normalizeStr(t.teamName).includes(normalizeStr(teamName)) ||
        normalizeStr(teamName).includes(normalizeStr(t.teamName))
      );

      if (gameTeam?.batters) {
        const foundBatter = matchBatterToPlayer(player, gameTeam.batters);

        if (foundBatter) {
          const parsed = parseBattingPerformance(
            foundBatter.battingLine,
            foundBatter.ab,
            foundBatter.h,
            foundBatter.extraNotes,
            foundBatter.hr
          );

          if (!parsed.isDnp && foundBatter.order !== 0) {
            played = true;
            gamesPlayedInBoxScore++;
            battingLine = parsed.battingLine;
            ab = parsed.ab;
            h = parsed.h;
            hr = parsed.hr;
            r = Number(foundBatter.r) || 0;
            rbi = Number(foundBatter.rbi) || 0;
            bb = Number(foundBatter.bb) || 0;
            so = Number(foundBatter.so) || 0;
            extraNotes = foundBatter.extraNotes || '';

            const notesUpper = `${extraNotes} ${battingLine}`.toUpperCase();
            if (notesUpper.includes('2B') || notesUpper.includes('DOBLE')) doubles = 1;
            if (notesUpper.includes('3B') || notesUpper.includes('TRIPLE')) triples = 1;

            boxScoreAB += ab;
            boxScoreH += h;
            boxScoreR += r;
            boxScoreRBI += rbi;
            boxScoreBB += bb;
            boxScoreSO += so;
            boxScoreHR += hr;
            boxScore2B += doubles;
            boxScore3B += triples;
          }
        }
      }
    }

    // 2. Check pitching box score if game has pitching data and is completed
    if (isCompleted && game.pitchingBoxScore?.teams) {
      const pTeam = game.pitchingBoxScore.teams.find(t => 
        (isHome && t.teamType === 'home') || 
        (!isHome && t.teamType === 'away') ||
        normalizeStr(t.teamName).includes(normalizeStr(teamName)) ||
        normalizeStr(teamName).includes(normalizeStr(t.teamName))
      );
      if (pTeam?.pitchers) {
        const foundPitcher = matchPitcherToPlayer(player, pTeam.pitchers);
        if (foundPitcher) {
          pitched = true;
          played = true;
          pitchesThrown = Number(foundPitcher.pitches) || 0;
          ip = parseFloat(foundPitcher.ip) || 0;
          earnedRunsAllowed = Number(foundPitcher.er) || 0;
          pitcherSO = Number(foundPitcher.so) || 0;
          pitcherBB = Number(foundPitcher.bb) || 0;
          const dec = String(foundPitcher.decision || '').toUpperCase().trim();
          if (['W', 'G', 'PG'].includes(dec)) {
            isWinningPitcher = true;
          }
          if (['L', 'P', 'PP'].includes(dec)) {
            isLosingPitcher = true;
          }
        }
      }
    }

    // Also check if game.winningPitcher or game.losingPitcher explicitly matches this player in a completed game
    if (isCompleted && game.winningPitcher) {
      const matched = matchPitcherToPlayer(player, [{ name: game.winningPitcher }]);
      if (matched) {
        isWinningPitcher = true;
      }
    }
    if (isCompleted && game.losingPitcher) {
      const matched = matchPitcherToPlayer(player, [{ name: game.losingPitcher }]);
      if (matched) {
        isLosingPitcher = true;
      }
    }

    // 3. Check lineup if game was live scored
    const lineup = isHome ? game.homeLineup : game.awayLineup;
    const inLineup = lineup?.some(lp => lp.playerId === player.id);
    const posInLineup = lineup?.find(lp => lp.playerId === player.id)?.position;

    if (inLineup && !played && isCompleted) {
      played = true;
    }

    if (posInLineup === 'P' || player.position === 'P') {
      pitched = true;
    }

    gameLogs.push({
      gameId: game.id,
      date: game.date,
      jornada: game.jornada,
      homeTeamName: game.homeTeamName,
      awayTeamName: game.awayTeamName,
      opponentName,
      isHome,
      teamScore,
      opponentScore,
      gameStatus: game.status,
      isWin,
      played,
      battingLine,
      ab,
      r,
      h,
      doubles,
      triples,
      hr,
      rbi,
      bb,
      so,
      extraNotes,
      pitched,
      ip,
      pitchesThrown,
      earnedRunsAllowed,
      isWinningPitcher,
      isLosingPitcher,
    });
  }

  // Official source of truth: ONLY digitized scorebooks and matches in «Partidos»
  // If no books have been uploaded for this player's team, stats remain strictly 0.
  const atBats = gamesPlayedInBoxScore > 0 ? boxScoreAB : 0;
  const hits = gamesPlayedInBoxScore > 0 ? boxScoreH : 0;
  const doubles = gamesPlayedInBoxScore > 0 ? boxScore2B : 0;
  const triples = gamesPlayedInBoxScore > 0 ? boxScore3B : 0;
  const homeRuns = gamesPlayedInBoxScore > 0 ? boxScoreHR : 0;
  const runs = gamesPlayedInBoxScore > 0 ? boxScoreR : 0;
  const rbis = gamesPlayedInBoxScore > 0 ? boxScoreRBI : 0;
  const walks = gamesPlayedInBoxScore > 0 ? boxScoreBB : 0;
  const strikeouts = gamesPlayedInBoxScore > 0 ? boxScoreSO : 0;

  const battingAverage = atBats > 0 ? (hits / atBats) : 0;
  const avgStr = atBats > 0 ? battingAverage.toFixed(3).replace(/^0/, '') : '.000';

  // On-base percentage (OBP): (H + BB) / (AB + BB)
  const plateAppearances = atBats + walks;
  const obp = plateAppearances > 0 ? ((hits + walks) / plateAppearances) : 0;
  const obpStr = plateAppearances > 0 ? obp.toFixed(3).replace(/^0/, '') : '.000';

  // Slugging percentage (SLG): Total bases / AB
  const singles = Math.max(0, hits - doubles - triples - homeRuns);
  const totalBases = singles + (2 * doubles) + (3 * triples) + (4 * homeRuns);
  const slg = atBats > 0 ? (totalBases / atBats) : 0;
  const slgStr = atBats > 0 ? slg.toFixed(3).replace(/^0/, '') : '.000';
  const ops = (obp + slg).toFixed(3).replace(/^0/, '');

  // Pitching: accumulate wins, losses, ip, pitches, so, bb from games
  const boxScoreWins = gameLogs.filter(g => g.isWinningPitcher).length;
  const boxScoreLosses = gameLogs.filter(g => g.isLosingPitcher).length;
  const boxScorePitches = gameLogs.reduce((acc, g) => acc + (g.pitchesThrown || 0), 0);
  const boxScoreIP = gameLogs.reduce((acc, g) => acc + (g.ip || 0), 0);
  const boxScoreER = gameLogs.reduce((acc, g) => acc + (g.earnedRunsAllowed || 0), 0);

  const wins = boxScoreWins;
  const losses = boxScoreLosses;
  const inningsPitched = boxScoreIP;
  const earnedRuns = boxScoreER;
  const pitches = boxScorePitches; // Total pitchadas lanzadas
  const pitchingStrikeouts = 0;
  const pitchingWalks = 0;

  // ERA = (Earned Runs * 9) / IP
  const era = inningsPitched > 0 ? (earnedRuns * 9) / inningsPitched : 0;
  const eraStr = inningsPitched > 0 ? era.toFixed(2) : '0.00';

  // WHIP = (Walks + Hits) / IP
  const whip = inningsPitched > 0 ? ((pitchingWalks + earnedRuns) / inningsPitched).toFixed(2) : '-';

  const gamesPlayedCount = Math.max(gamesPlayedInBoxScore, gameLogs.filter(g => g.played).length, atBats > 0 ? 1 : 0);

  return {
    player,
    teamName,
    category,
    atBats,
    hits,
    doubles,
    triples,
    homeRuns,
    runs,
    rbis,
    walks,
    strikeouts,
    battingAverage,
    avgStr,
    obp,
    obpStr,
    slg,
    slgStr,
    ops,
    wins,
    losses,
    inningsPitched,
    earnedRuns,
    era,
    eraStr,
    pitches,
    pitchingStrikeouts,
    pitchingWalks,
    whip,
    gamesPlayedCount,
    gameLogs
  };
}
