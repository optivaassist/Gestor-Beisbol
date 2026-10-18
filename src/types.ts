export type Role = 'admin' | 'editor' | 'viewer' | 'jefe_categoria';
export type Category = 'Zapetita' | 'Biberon' | 'Escuelita' | 'Pewee' | 'Infantil' | 'Pony' | 'Colt';
export type TournamentType = 'Regular' | 'Semana Santa' | 'Verano';

export const CATEGORIES: Category[] = ['Zapetita', 'Biberon', 'Escuelita', 'Pewee', 'Infantil', 'Pony', 'Colt'];
export const TOURNAMENTS: TournamentType[] = ['Regular', 'Semana Santa', 'Verano'];

export const BASEBALL_POSITIONS = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'];

export const CATEGORY_FIELDS: Record<Category, string[]> = {
  'Zapetita': ['Campo Infantil 1', 'Campo Infantil 2'],
  'Biberon': ['Campo Infantil 1', 'Campo Infantil 2'],
  'Escuelita': ['Campo Municipal 1', 'Campo Municipal 2'],
  'Pewee': ['Campo Municipal 1', 'Campo Municipal 2'],
  'Infantil': ['Campo del Valle', 'Campo de la Loma'],
  'Pony': ['Campo del Valle', 'Campo de la Loma'],
  'Colt': ['Zorros', 'Cliserio Sanchez']
};

/**
 * Normalizes field names, ensuring 'El campo Zorros' is always formatted as 'Zorros'.
 */
export function formatFieldName(field?: string): string {
  if (!field) return '';
  if (/el\s+campo\s+zorros/i.test(field.trim())) {
    return 'Zorros';
  }
  return field;
}

/**
 * Normalizes team names to always be in UPPERCASE across all modules and sections.
 */
export function formatTeamName(name?: string): string {
  if (!name) return '';
  return name.trim().toUpperCase();
}

export interface Season {
  id: string;
  name: string;
  startDate?: string;
  active: boolean;
}

export type DayOfWeek = 'Sabado' | 'Domingo';
export type GameTime = '08:00' | '11:30' | '15:00';

export interface GameSlot {
  day: DayOfWeek;
  time: GameTime;
}

export const GAME_SLOTS: GameSlot[] = [
  { day: 'Sabado', time: '08:00' },
  { day: 'Sabado', time: '11:30' },
  { day: 'Sabado', time: '15:00' },
  { day: 'Domingo', time: '08:00' },
  { day: 'Domingo', time: '11:30' },
  { day: 'Domingo', time: '15:00' },
];

export interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  role: Role;
  teamId?: string;
  leagueId?: string;
  category?: Category;
  firstName?: string;
  lastName?: string;
}

export interface League {
  id: string;
  name: string;
  season: string;
  adminId: string;
}

export interface Team {
  id: string;
  name: string;
  category: Category;
  leagueId: string;
  coachId: string;
  wins: number;
  losses: number;
  runsScored: number;
  runsAllowed: number;
  tournament?: TournamentType;
  logoUrl?: string;
}

export interface Player {
  id: string;
  name: string;
  number: string;
  teamId: string;
  position: string;
  notes?: string;
  birthDate?: string;
  stats: {
    // Batting
    atBats: number;
    hits: number;
    doubles: number;
    triples: number;
    homeRuns: number;
    runs: number;
    rbis: number;
    strikeouts: number;
    walks: number;
    battingAverage: number;
    // Pitching
    inningsPitched: number;
    pitchingStrikeouts: number;
    pitchingWalks: number;
    earnedRuns: number;
    era: number;
    wins: number;
    losses: number;
    pitches?: number; // total lanzamientos / pitchadas lanzadas
    // Fielding
    putouts: number;
    assists: number;
    errors: number;
    fieldingPercentage: number;
  };
}

export interface LineupPlayer {
  playerId: string;
  position: string;
}

export interface Game {
  id: string;
  leagueId: string;
  homeTeamId: string;
  awayTeamId: string;
  homeTeamName: string;
  awayTeamName: string;
  date: string;
  field: string;
  status: 'scheduled' | 'in-progress' | 'completed';
  score: {
    home: number;
    away: number;
  };
  inning: number;
  isTop: boolean;
  outs: number;
  balls: number;
  strikes: number;
  runners: {
    first: string | null;
    second: string | null;
    third: string | null;
  };
  homeLineup?: LineupPlayer[];
  awayLineup?: LineupPlayer[];
  currentBatterIndex: {
    home: number;
    away: number;
  };
  batterHand?: 'right' | 'left';
  category?: Category;
  tournament?: TournamentType;
  jornada?: number;
  bookImageUrl?: string;
  bookUploadedAt?: string;
  bookUploadedBy?: string;
  bookFileName?: string;
  bookFileType?: 'image' | 'pdf' | 'excel';
  winningPitcher?: string; // Pitcher Ganador (PG / W)
  losingPitcher?: string; // Pitcher Perdedor (PP / L)
  savePitcher?: string; // Pitcher con Salvamento (SV / JS)
  scorebooks?: GameScorebooks;
  boxScore?: GameBoxScoreData;
  pitchingBoxScore?: GamePitchingData;
}

export type ScorebookCategory = 'batting' | 'pitching';

export interface ScorebookSheetRecord {
  fileUrl?: string;
  thumbnailUrl?: string;
  hasFile?: boolean;
  fileName: string;
  fileType: 'image' | 'pdf' | 'excel';
  uploadedAt: string;
  uploadedBy?: string;
  category: ScorebookCategory;
  teamType: 'home' | 'away';
  teamName: string;
  notes?: string;
}

export interface GameScorebooks {
  // Los 4 libros por juego:
  // 1. El bateo de un equipo (visitante)
  awayBatting?: ScorebookSheetRecord;
  // 2. El número de lanzamientos de los pitchers de un equipo (visitante)
  awayPitching?: ScorebookSheetRecord;
  // 3. El bateo del otro equipo (local)
  homeBatting?: ScorebookSheetRecord;
  // 4. El número de pitcheos de los pitchers del otro equipo (local)
  homePitching?: ScorebookSheetRecord;
}

export interface PitcherBoxScore {
  playerNumber?: string;
  name: string;
  decision?: string; // 'W', 'L', 'SV', 'H', '-'
  ip: string; // Entradas lanzadas ej: "5.0", "3.2"
  pitches: number; // Conteo de lanzamientos / pitcheos realizados
  strikes?: number;
  balls?: number;
  h: number;
  r: number;
  er: number;
  bb: number;
  so: number;
  notes?: string;
}

export interface TeamPitchingBoxScore {
  teamName: string;
  teamType?: 'home' | 'away';
  pitchers: PitcherBoxScore[];
  totalPitches: number;
  notes?: string;
}

export interface GamePitchingData {
  teams: TeamPitchingBoxScore[];
  detectedAt?: string;
  detectedBy?: string;
  generalNotes?: string;
  winningPitcher?: string;
  losingPitcher?: string;
  savePitcher?: string;
  finalScore?: {
    awayScore: number;
    homeScore: number;
  };
}

export interface BoxScoreBatter {
  order?: number;
  playerNumber?: string;
  name: string; // Nombre y apellido del jugador
  position?: string; // P, C, 1B, 2B, 3B, SS, LF, CF, RF, DH
  battingLine: string; // "de 4-2", "de 2-0", etc.
  ab: number; // Turnos al bat (at-bats) - Primer número con pluma
  r: number; // Carreras anotadas (runs)
  h: number; // Hits conectados - Segundo número con pluma
  rbi: number; // Carreras impulsadas (RBIs)
  bb: number; // Bases por bola (walks)
  so: number; // Ponches (strikeouts)
  hr?: number; // Jonrones (HR)
  avg?: string; // Promedio de bateo individual (H / AB)
  extraNotes?: string; // HR, 2B, 3B, etc.
}

export interface TeamBoxScore {
  teamName: string;
  teamType?: 'home' | 'away';
  batters: BoxScoreBatter[];
  totals: {
    ab: number;
    r: number;
    h: number;
    rbi: number;
    bb: number;
    so: number;
    hr?: number;
    avg?: string;
  };
  notes?: string;
}

export interface GameBoxScoreData {
  teams: TeamBoxScore[];
  detectedAt?: string;
  detectedBy?: string;
  generalNotes?: string;
  winningPitcher?: string;
  losingPitcher?: string;
  savePitcher?: string;
  finalScore?: {
    awayScore: number;
    homeScore: number;
  };
}

export interface Play {
  id: string;
  gameId: string;
  inning: number;
  isTop: boolean;
  batterId: string;
  pitcherId: string;
  description: string;
  result: string;
  timestamp: string;
}
