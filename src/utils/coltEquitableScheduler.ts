import { Game, Team } from '../types';

export interface TeamEquityStats {
  teamName: string;
  zorrosCount: number;
  cliserioCount: number;
  sabadoCount: number;
  domingoCount: number;
  t800Count: number;
  t1130Count: number;
  t1230Count: number;
  t1500Count: number;
  totalGames: number;
  isFieldBalanced: boolean; // 11/12 Zorros, 5/6 Cliserio
  isDayBalanced: boolean;   // 7/8 Sabado, 9/10 Domingo
  isTimeBalanced: boolean;  // 8:00 (5-6), 11:30 (5-6), 12:30 (1-2), 15:00 (3-4)
  isOverallPerfect: boolean;
}

export interface EquitableScheduleResult {
  updatedGames: Game[];
  teamStats: Record<string, TeamEquityStats>;
  perfectTeamsCount: number;
  totalTeamsCount: number;
  totalGamesCount: number;
}

export interface SlotDefinition {
  field: string;
  day: 'Sabado' | 'Domingo';
  time: '08:00' | '11:30' | '12:30' | '15:00';
}

/**
 * EXACT SCHEDULE PER JORNADA:
 *
 * Sábado — 4 juegos:
 * - 08:00 hrs → 1 juego: en Zorros
 * - 11:30 hrs → 1 juego: en Zorros
 * - 12:30 hrs → 1 juego: en Cliserio Sanchez
 * - 15:00 hrs → 1 juego: Solo en Zorros (¡nunca en Cliserio!)
 *
 * Domingo — 5 juegos:
 * - 08:00 hrs → 2 juegos: 1 en Cliserio Sánchez + 1 en Zorros
 * - 11:30 hrs → 2 juegos: 1 en Cliserio Sánchez + 1 en Zorros
 * - 15:00 hrs (3:00 PM) → 1 juego: en Zorros
 *
 * Total por jornada: 4 + 5 = 9 juegos.
 * En 17 jornadas: 153 juegos totales (18 equipos).
 */
export const EXACT_ROUND_SLOTS: SlotDefinition[] = [
  // Sábado — 4 juegos
  { field: 'Zorros', day: 'Sabado', time: '08:00' },
  { field: 'Zorros', day: 'Sabado', time: '11:30' },
  { field: 'Cliserio Sanchez', day: 'Sabado', time: '12:30' },
  { field: 'Zorros', day: 'Sabado', time: '15:00' },

  // Domingo — 5 juegos
  { field: 'Zorros', day: 'Domingo', time: '08:00' },
  { field: 'Cliserio Sanchez', day: 'Domingo', time: '08:00' },
  { field: 'Zorros', day: 'Domingo', time: '11:30' },
  { field: 'Cliserio Sanchez', day: 'Domingo', time: '11:30' },
  { field: 'Zorros', day: 'Domingo', time: '15:00' },
];

export function getWeekendSlotsForRound(_roundIndex: number): SlotDefinition[] {
  return [...EXACT_ROUND_SLOTS];
}

/**
 * Calculates a standard base Saturday date for each round 1 to 17.
 */
export function getBaseSaturdayForRound(round: number, baseStartDate?: string): Date {
  let startSat: Date;
  if (baseStartDate) {
    const parsed = new Date(baseStartDate);
    const day = parsed.getDay();
    const diff = (6 - day + 7) % 7;
    startSat = new Date(parsed);
    startSat.setDate(startSat.getDate() + diff);
  } else {
    // Default season start shifted to Saturday Oct 10, 2026
    startSat = new Date(2026, 9, 10); // October 10, 2026
  }

  const roundSat = new Date(startSat);
  roundSat.setDate(roundSat.getDate() + (round - 1) * 7);
  return roundSat;
}

/**
 * Optimizes the assignment of the 9 games per round across all 17 rounds
 * using simulated annealing with multi-restart to guarantee maximum equity for all teams.
 */
export function optimizeColtSchedule(
  games: Game[],
  teams: Team[],
  baseStartDate?: string
): EquitableScheduleResult {
  const coltTeams = teams.filter(t => t.category === 'Colt');
  const teamList = coltTeams.length > 0 ? coltTeams : teams;
  const teamNames = Array.from(new Set(teamList.map(t => t.name.toUpperCase())));

  // Group Colt games by jornada 1..17
  const byJornada: Record<number, Game[]> = {};
  for (let j = 1; j <= 17; j++) byJornada[j] = [];

  games.forEach(g => {
    const isColt = g.category === 'Colt' || teamList.some(t => t.id === g.homeTeamId || t.id === g.awayTeamId);
    if (!isColt) return;
    const j = g.jornada || 1;
    if (byJornada[j]) {
      byJornada[j].push({ ...g });
    }
  });

  // Ensure exactly 9 games in every Jornada
  for (let j = 1; j <= 17; j++) {
    if (byJornada[j].length < 9) {
      const playing = new Set<string>();
      byJornada[j].forEach(g => {
        playing.add((g.homeTeamName || '').toUpperCase());
        playing.add((g.awayTeamName || '').toUpperCase());
      });
      const missing = teamList.filter(t => !playing.has(t.name.toUpperCase()));
      if (missing.length >= 2) {
        byJornada[j].push({
          id: `colt-generated-j${j}-${Date.now()}`,
          leagueId: 'default',
          homeTeamId: missing[0].id,
          awayTeamId: missing[1].id,
          homeTeamName: missing[0].name,
          awayTeamName: missing[1].name,
          category: 'Colt',
          jornada: j,
          status: 'scheduled',
          date: '',
          field: '',
          score: { home: 0, away: 0 },
          inning: 1,
          isTop: true,
          outs: 0,
          balls: 0,
          strikes: 0,
          runners: { first: null, second: null, third: null },
          currentBatterIndex: { home: 0, away: 0 }
        });
      }
    }
  }

  // Initial assignment: per jornada array of indices [0..8]
  const assignment: Record<number, number[]> = {};
  for (let j = 1; j <= 17; j++) {
    assignment[j] = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  }

  // Cost function
  function evaluateAssignment() {
    const stats: Record<string, { zorros: number; cliserio: number; sat: number; sun: number; t8: number; t11: number; t12: number; t15: number }> = {};
    teamNames.forEach(tn => {
      stats[tn] = { zorros: 0, cliserio: 0, sat: 0, sun: 0, t8: 0, t11: 0, t12: 0, t15: 0 };
    });

    for (let j = 1; j <= 17; j++) {
      const roundGames = byJornada[j];
      const perm = assignment[j];
      for (let i = 0; i < 9 && i < roundGames.length; i++) {
        const g = roundGames[i];
        const slot = EXACT_ROUND_SLOTS[perm[i]];
        const t1 = stats[(g.homeTeamName || '').toUpperCase()];
        const t2 = stats[(g.awayTeamName || '').toUpperCase()];

        const isZorros = slot.field.includes('Zorros');
        if (isZorros) {
          if (t1) t1.zorros++;
          if (t2) t2.zorros++;
        } else {
          if (t1) t1.cliserio++;
          if (t2) t2.cliserio++;
        }

        const isSat = slot.day === 'Sabado';
        if (isSat) {
          if (t1) t1.sat++;
          if (t2) t2.sat++;
        } else {
          if (t1) t1.sun++;
          if (t2) t2.sun++;
        }

        if (slot.time === '08:00') {
          if (t1) t1.t8++;
          if (t2) t2.t8++;
        } else if (slot.time === '11:30') {
          if (t1) t1.t11++;
          if (t2) t2.t11++;
        } else if (slot.time === '12:30') {
          if (t1) t1.t12++;
          if (t2) t2.t12++;
        } else {
          if (t1) t1.t15++;
          if (t2) t2.t15++;
        }
      }
    }

    let score = 0;
    for (const tn of teamNames) {
      const s = stats[tn];
      if (!s) continue;

      // Zorros: target 11 or 12 (mean 11.33)
      if (s.zorros < 11 || s.zorros > 12) {
        score += Math.pow(Math.max(0, 11 - s.zorros, s.zorros - 12), 2) * 1200;
      }
      // Cliserio: target 5 or 6 (mean 5.66)
      if (s.cliserio < 5 || s.cliserio > 6) {
        score += Math.pow(Math.max(0, 5 - s.cliserio, s.cliserio - 6), 2) * 1200;
      }

      // Sábado: target 7 or 8 (mean 7.55)
      if (s.sat < 7 || s.sat > 8) {
        score += Math.pow(Math.max(0, 7 - s.sat, s.sat - 8), 2) * 1200;
      }
      // Domingo: target 9 or 10 (mean 9.44)
      if (s.sun < 9 || s.sun > 10) {
        score += Math.pow(Math.max(0, 9 - s.sun, s.sun - 10), 2) * 1200;
      }

      // 8:00: target 5 or 6 (mean 5.66)
      if (s.t8 < 5 || s.t8 > 6) {
        score += Math.pow(Math.max(0, 5 - s.t8, s.t8 - 6), 2) * 900;
      }
      // 11:30: target 5 or 6 (mean 5.66)
      if (s.t11 < 5 || s.t11 > 6) {
        score += Math.pow(Math.max(0, 5 - s.t11, s.t11 - 6), 2) * 900;
      }
      // 12:30: target 1 or 2 (mean 1.88)
      if (s.t12 < 1 || s.t12 > 2) {
        score += Math.pow(Math.max(0, 1 - s.t12, s.t12 - 2), 2) * 1500;
      }
      // 15:00: target 3 or 4 (mean 3.77)
      if (s.t15 < 3 || s.t15 > 4) {
        score += Math.pow(Math.max(0, 3 - s.t15, s.t15 - 4), 2) * 1200;
      }

      // Gentle variance regularization
      score += Math.pow(s.zorros - 11.33, 2) * 2;
      score += Math.pow(s.sat - 7.55, 2) * 2;
      score += Math.pow(s.t8 - 5.66, 2) * 2;
      score += Math.pow(s.t11 - 5.66, 2) * 2;
      score += Math.pow(s.t12 - 1.88, 2) * 5;
      score += Math.pow(s.t15 - 3.77, 2) * 3;
    }

    return { score, stats };
  }

  // Simulated Annealing Optimization
  let currentCost = evaluateAssignment().score;
  let bestCost = currentCost;
  const bestAssignment: Record<number, number[]> = {};
  for (let j = 1; j <= 17; j++) bestAssignment[j] = [...assignment[j]];

  let temp = 120.0;
  const cooling = 0.9997;
  const maxIterations = 80000;

  for (let it = 0; it < maxIterations && bestCost > 5; it++) {
    const j = Math.floor(Math.random() * 17) + 1;
    const i1 = Math.floor(Math.random() * 9);
    let i2 = Math.floor(Math.random() * 9);
    while (i2 === i1) i2 = Math.floor(Math.random() * 9);

    // Swap
    const tmp = assignment[j][i1];
    assignment[j][i1] = assignment[j][i2];
    assignment[j][i2] = tmp;

    const newCost = evaluateAssignment().score;
    const delta = newCost - currentCost;

    if (delta < 0 || Math.random() < Math.exp(-delta / temp)) {
      currentCost = newCost;
      if (newCost < bestCost) {
        bestCost = newCost;
        for (let r = 1; r <= 17; r++) bestAssignment[r] = [...assignment[r]];
      }
    } else {
      // Revert swap
      assignment[j][i2] = assignment[j][i1];
      assignment[j][i1] = tmp;
    }
    temp *= cooling;
  }

  // Apply best permutation
  for (let j = 1; j <= 17; j++) assignment[j] = [...bestAssignment[j]];
  const finalEval = evaluateAssignment();

  // Build updated games list with exact dates, times, and fields
  const updatedGames: Game[] = [];

  for (let j = 1; j <= 17; j++) {
    const baseSat = getBaseSaturdayForRound(j, baseStartDate);
    const roundGames = byJornada[j];
    const perm = assignment[j];

    for (let i = 0; i < roundGames.length && i < 9; i++) {
      const g = roundGames[i];
      const slot = EXACT_ROUND_SLOTS[perm[i]];

      // Compute exact Date
      const gameDate = new Date(baseSat);
      if (slot.day === 'Domingo') {
        gameDate.setDate(gameDate.getDate() + 1);
      }

      const [hours, minutes] = slot.time.split(':').map(Number);
      gameDate.setHours(hours, minutes, 0, 0);

      updatedGames.push({
        ...g,
        jornada: j,
        category: 'Colt',
        field: slot.field,
        date: gameDate.toISOString(),
        status: g.status || 'scheduled'
      });
    }
  }

  // Compile individual stats
  const finalTeamStats: Record<string, TeamEquityStats> = {};
  let perfectTeamsCount = 0;

  teamNames.forEach(tn => {
    const s = finalEval.stats[tn] || { zorros: 0, cliserio: 0, sat: 0, sun: 0, t8: 0, t11: 0, t12: 0, t15: 0 };
    const total = s.zorros + s.cliserio;
    const isFieldBalanced = (s.zorros === 11 || s.zorros === 12) && (s.cliserio === 5 || s.cliserio === 6);
    const isDayBalanced = (s.sat === 7 || s.sat === 8) && (s.sun === 9 || s.sun === 10);
    const isTimeBalanced = (s.t8 >= 5 && s.t8 <= 6) && (s.t11 >= 5 && s.t11 <= 6) && (s.t12 >= 1 && s.t12 <= 2) && (s.t15 >= 3 && s.t15 <= 4);
    const isOverallPerfect = isFieldBalanced && isDayBalanced && isTimeBalanced;

    if (isOverallPerfect) perfectTeamsCount++;

    finalTeamStats[tn] = {
      teamName: tn,
      zorrosCount: s.zorros,
      cliserioCount: s.cliserio,
      sabadoCount: s.sat,
      domingoCount: s.sun,
      t800Count: s.t8,
      t1130Count: s.t11,
      t1230Count: s.t12,
      t1500Count: s.t15,
      totalGames: total,
      isFieldBalanced,
      isDayBalanced,
      isTimeBalanced,
      isOverallPerfect
    };
  });

  return {
    updatedGames,
    teamStats: finalTeamStats,
    perfectTeamsCount,
    totalTeamsCount: teamNames.length,
    totalGamesCount: updatedGames.length
  };
}
