import React, { useState, useEffect, useMemo, useRef } from 'react';
import * as XLSX from 'xlsx';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { collection, writeBatch, doc, getDocs, query, where } from 'firebase/firestore';
import { Team, Game, CATEGORIES, Category, CATEGORY_FIELDS, TournamentType, TOURNAMENTS, Season, formatFieldName } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { FileSpreadsheet, Upload, Loader2, CheckCircle2, AlertCircle, X, Trash2, Edit3, ArrowRight, Table, Sparkles, Filter, Calendar, MapPin, Clock, Eye, Sliders, Plus, RefreshCw } from 'lucide-react';

export interface ParsedRolGame {
  id: string;
  jornada: number;
  category: Category;
  homeTeamName: string;
  awayTeamName: string;
  homeTeamId?: string;
  awayTeamId?: string;
  isNewHomeTeam?: boolean;
  isNewAwayTeam?: boolean;
  dateStr: string;
  timeStr: string;
  field: string;
  tournament?: TournamentType;
  rawSource?: string;
}

interface RawSheetInfo {
  sheetName: string;
  rows: any[][];
}

interface ExcelScheduleModalProps {
  isOpen: boolean;
  onClose: () => void;
  teams: Team[];
  seasons: Season[];
  defaultCategory?: Category;
  onImportSuccess?: (count: number) => void;
  onNavigateToGames?: () => void;
}

const normalizeStr = (str: any): string => {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
};

const findCategory = (str: string): Category | null => {
  const norm = normalizeStr(str);
  if (!norm) return null;

  for (const cat of CATEGORIES) {
    const catNorm = normalizeStr(cat);
    if (norm.includes(catNorm)) return cat;
  }

  // Common aliases mapped to league categories
  if (norm.includes('1ra') || norm.includes('primera') || norm.includes('1era') || norm.includes('mayor')) return 'Colt';
  if (norm.includes('2da') || norm.includes('segunda') || norm.includes('pony')) return 'Pony';
  if (norm.includes('inf') || norm.includes('infantil')) return 'Infantil';
  if (norm.includes('pewee') || norm.includes('pewe') || norm.includes('piwi')) return 'Pewee';
  if (norm.includes('escuela') || norm.includes('escuelita') || norm.includes('prema')) return 'Escuelita';
  if (norm.includes('biberon') || norm.includes('biberones') || norm.includes('iniciacion')) return 'Biberon';
  if (norm.includes('zapetita') || norm.includes('zapeta')) return 'Zapetita';
  if (norm.includes('colt')) return 'Colt';

  return null;
};

const parseExcelDate = (val: any, fallbackDate: Date): { dateStr: string; timeStr: string } => {
  if (val === undefined || val === null || val === '') {
    const yyyy = fallbackDate.getFullYear();
    const mm = String(fallbackDate.getMonth() + 1).padStart(2, '0');
    const dd = String(fallbackDate.getDate()).padStart(2, '0');
    return { dateStr: `${yyyy}-${mm}-${dd}`, timeStr: '08:00' };
  }

  if (typeof val === 'number' && val > 30000 && val < 70000) {
    const utc_days = Math.floor(val - 25569);
    const utc_value = utc_days * 86400;
    const date_info = new Date(utc_value * 1000);
    const fractional_day = val - Math.floor(val) + 0.0000001;
    let total_seconds = Math.floor(86400 * fractional_day);
    const hours = Math.floor(total_seconds / 3600);
    total_seconds -= hours * 3600;
    const minutes = Math.floor(total_seconds / 60);

    const yyyy = date_info.getUTCFullYear();
    const mm = String(date_info.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(date_info.getUTCDate()).padStart(2, '0');
    const hh = String(hours).padStart(2, '0');
    const minStr = String(minutes).padStart(2, '0');
    return {
      dateStr: `${yyyy}-${mm}-${dd}`,
      timeStr: hours > 0 || minutes > 0 ? `${hh}:${minStr}` : '08:00'
    };
  }

  if (val instanceof Date && !isNaN(val.getTime())) {
    const yyyy = val.getFullYear();
    const mm = String(val.getMonth() + 1).padStart(2, '0');
    const dd = String(val.getDate()).padStart(2, '0');
    const hours = String(val.getHours()).padStart(2, '0');
    const mins = String(val.getMinutes()).padStart(2, '0');
    return { dateStr: `${yyyy}-${mm}-${dd}`, timeStr: `${hours}:${mins}` };
  }

  const str = String(val).trim();
  const timeMatch = str.match(/(\d{1,2}):(\d{2})(?:\s*([ap]\.?m\.?))?/i);
  let timeStr = '08:00';
  if (timeMatch) {
    let hours = parseInt(timeMatch[1], 10);
    const mins = timeMatch[2];
    const ampm = timeMatch[3]?.toLowerCase();
    if (ampm && ampm.startsWith('p') && hours < 12) hours += 12;
    if (ampm && ampm.startsWith('a') && hours === 12) hours = 0;
    timeStr = `${String(hours).padStart(2, '0')}:${mins}`;
  }

  let dateStr = '';
  const isoMatch = str.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (isoMatch) {
    dateStr = `${isoMatch[1]}-${String(isoMatch[2]).padStart(2, '0')}-${String(isoMatch[3]).padStart(2, '0')}`;
  } else {
    const ddmmyyyy = str.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
    if (ddmmyyyy) {
      let y = parseInt(ddmmyyyy[3], 10);
      if (y < 100) y += 2000;
      dateStr = `${y}-${String(ddmmyyyy[2]).padStart(2, '0')}-${String(ddmmyyyy[1]).padStart(2, '0')}`;
    }
  }

  if (!dateStr) {
    const yyyy = fallbackDate.getFullYear();
    const mm = String(fallbackDate.getMonth() + 1).padStart(2, '0');
    const dd = String(fallbackDate.getDate()).padStart(2, '0');
    dateStr = `${yyyy}-${mm}-${dd}`;
  }

  return { dateStr, timeStr };
};

const parseExcelTime = (val: any): string => {
  if (val === undefined || val === null || val === '') return '08:00';
  if (typeof val === 'number') {
    if (val >= 0 && val < 1) {
      const totalMinutes = Math.round(val * 24 * 60);
      const hours = Math.floor(totalMinutes / 60);
      const mins = totalMinutes % 60;
      return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
    }
  }
  const str = String(val).trim();
  const timeMatch = str.match(/(\d{1,2}):(\d{2})(?:\s*([ap]\.?m\.?))?/i);
  if (timeMatch) {
    let hours = parseInt(timeMatch[1], 10);
    const mins = timeMatch[2];
    const ampm = timeMatch[3]?.toLowerCase();
    if (ampm && ampm.startsWith('p') && hours < 12) hours += 12;
    if (ampm && ampm.startsWith('a') && hours === 12) hours = 0;
    return `${String(hours).padStart(2, '0')}:${mins}`;
  }
  return '08:00';
};

export default function ExcelScheduleModal({
  isOpen,
  onClose,
  teams,
  seasons,
  defaultCategory,
  onImportSuccess,
  onNavigateToGames,
}: ExcelScheduleModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState('');
  const [reading, setReading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [rawSheets, setRawSheets] = useState<RawSheetInfo[]>([]);
  const [selectedSheetIndex, setSelectedSheetIndex] = useState(0);
  const [parsedGames, setParsedGames] = useState<ParsedRolGame[]>([]);
  const [importTournament, setImportTournament] = useState<TournamentType>('Regular');
  const [selectedJornadaFilter, setSelectedJornadaFilter] = useState<number | 'All'>('All');
  const [viewMode, setViewMode] = useState<'preview' | 'mapper'>('preview');
  const [importSuccessCount, setImportSuccessCount] = useState<number | null>(null);
  const [parsingError, setParsingError] = useState<string | null>(null);
  const [skipDuplicatesInDb, setSkipDuplicatesInDb] = useState(true);
  const [clearPreviousSchedule, setClearPreviousSchedule] = useState(true);
  const [isClearingMemory, setIsClearingMemory] = useState(false);
  const [memoryClearedNotice, setMemoryClearedNotice] = useState(false);

  // Manual Column Mapper state
  const [mapperHomeCol, setMapperHomeCol] = useState<number | string>('auto');
  const [mapperAwayCol, setMapperAwayCol] = useState<number | string>('auto');
  const [mapperJornadaCol, setMapperJornadaCol] = useState<number | string>('auto');
  const [mapperFixedJornada, setMapperFixedJornada] = useState<number>(1);
  const [mapperFieldCol, setMapperFieldCol] = useState<number | string>('none');
  const [mapperTimeCol, setMapperTimeCol] = useState<number | string>('none');
  const [mapperCategory, setMapperCategory] = useState<Category>(defaultCategory || CATEGORIES[0]);
  const [mapperStartRow, setMapperStartRow] = useState<number>(1);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeSeason = useMemo(() => seasons.find(s => s.active) || seasons[0], [seasons]);
  const baseSeasonDate = useMemo(() => activeSeason?.startDate ? new Date(activeSeason.startDate) : new Date(), [activeSeason]);

  const allKnownFields = useMemo(() => {
    const fieldsSet = new Set<string>();
    Object.values(CATEGORY_FIELDS).forEach(arr => arr.forEach(f => fieldsSet.add(f)));
    fieldsSet.add('Campo Municipal 1');
    fieldsSet.add('Campo Municipal 2');
    fieldsSet.add('Campo Infantil 1');
    fieldsSet.add('Campo Infantil 2');
    fieldsSet.add('Parque Central');
    fieldsSet.add('Estadio Corona');
    return Array.from(fieldsSet);
  }, []);

  const findMatchingTeam = (rawName: string, categoryHint?: Category | null): { team: Team | null; cleanName: string } => {
    let cleanName = String(rawName || '').trim();
    cleanName = cleanName.replace(/^#?\d+[\.\-\)]\s*/, '').trim();
    if (!cleanName) return { team: null, cleanName: '' };
    const norm = normalizeStr(cleanName);

    // 1. Exact match in category
    let matched = teams.find(t => {
      const tNorm = normalizeStr(t.name);
      const catMatch = !categoryHint || t.category === categoryHint;
      return catMatch && tNorm === norm;
    });

    // 2. Exact match in any category
    if (!matched) {
      matched = teams.find(t => normalizeStr(t.name) === norm);
    }

    // STRICT: NEVER do fuzzy/substring replacement!
    // The user's team names from Excel are preserved 100% tal y como vienen.
    return { team: matched || null, cleanName };
  };

  const romanMap: Record<string, number> = {
    i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10,
    xi: 11, xii: 12, xiii: 13, xiv: 14, xv: 15, xvi: 16, xvii: 17, xviii: 18,
    xix: 19, xx: 20
  };

  const extractJornadaNum = (val: any): number | null => {
    if (val === undefined || val === null) return null;
    const str = String(val).trim();
    if (!str) return null;
    const norm = normalizeStr(str);
    if (!norm) return null;

    // 1. Explicit keyword + number: "jornada 1", "jornada #18", "fecha 1", "semana 1", "ronda 1", "jor 1", "jor. 18"
    const m1 = norm.match(/\b(?:jornada|fecha|semana|ronda|jor|sem|f)\.?\s*#?\s*(\d{1,2})\b/i);
    if (m1) {
      const num = parseInt(m1[1], 10);
      if (num >= 1 && num <= 60) return num;
    }

    // 2. Short code: "j1", "j 1", "j-1", "j#18"
    const m2 = norm.match(/^j\s*[-#]?\s*(\d{1,2})$/i) || norm.match(/\bj\s*[-#]?\s*(\d{1,2})\b/i);
    if (m2 && norm.length <= 10) {
      const num = parseInt(m2[1], 10);
      if (num >= 1 && num <= 60) return num;
    }

    // 3. Ordinal: "1ra jornada", "1a jornada", "1era jornada", "18a jornada"
    const m3 = norm.match(/^(\d{1,2})\s*(?:a|ra|da|era|ta|va)?\s*(?:jornada|fecha|semana)/i);
    if (m3) {
      const num = parseInt(m3[1], 10);
      if (num >= 1 && num <= 60) return num;
    }

    // 4. Roman numerals: "jornada iv", "jornada xviii", "j xviii"
    const m4 = norm.match(/\b(?:jornada|fecha|semana|ronda|jor|j)\.?\s*#?\s*(xviii|xvii|xvi|xv|xiv|xiii|xii|xi|x|ix|viii|vii|vi|v|iv|iii|ii|i)\b/i);
    if (m4 && romanMap[m4[1].toLowerCase()]) {
      return romanMap[m4[1].toLowerCase()];
    }

    return null;
  };

  const isHeaderWord = (name: string) => {
    const n = normalizeStr(name);
    if (!n) return true;
    // Registered team names are NEVER header words
    if (teams.some(t => normalizeStr(t.name) === n)) return false;
    return (
      n === 'vs' ||
      n === 'vs.' ||
      n === 'v/s' ||
      n === 'v.s.' ||
      n === 'contra' ||
      n === '@' ||
      n.includes('equipo') ||
      n.includes('team') ||
      n.includes('local') ||
      n.includes('visitante') ||
      n.includes('marcador') ||
      n.includes('jornada') ||
      n.includes('resultado') ||
      n.includes('total')
    );
  };

  // Automatic parser tailored for 17 Jornadas with 9 games each across grid blocks and tables
  const runAutoParser = (sheets: RawSheetInfo[]): ParsedRolGame[] => {
    const parsed: ParsedRolGame[] = [];

    sheets.forEach((sheet) => {
      const { sheetName, rows } = sheet;
      if (!rows || rows.length === 0) return;

      const sheetCategory = findCategory(sheetName);
      const sheetJMatch = sheetName.match(/jornada\s*#?\s*(\d+)/i) || sheetName.match(/\bj\s*#?\s*(\d+)\b/i) || sheetName.match(/semana\s*#?\s*(\d+)/i);
      const defaultJornada = sheetJMatch ? parseInt(sheetJMatch[1], 10) : 1;
      const maxCols = Math.max(...rows.map(r => (r ? r.length : 0)), 1);

      // STEP 1: Scan entire sheet for all Jornada Header cells across rows AND columns
      interface FoundHeader {
        jornada: number;
        row: number;
        col: number;
        text: string;
      }
      const foundHeaders: FoundHeader[] = [];

      for (let r = 0; r < rows.length; r++) {
        const row = rows[r];
        if (!row) continue;
        for (let c = 0; c < row.length; c++) {
          let jNum = extractJornadaNum(row[c]);
          if (!jNum) {
            const cellNorm = normalizeStr(row[c]);
            if (cellNorm === 'jornada' || cellNorm === 'jor' || cellNorm === 'fecha' || cellNorm === 'semana') {
              const nextCell = row[c + 1] !== undefined ? row[c + 1] : row[c + 2];
              if (nextCell !== undefined && nextCell !== null) {
                const nextVal = parseInt(String(nextCell).replace(/\D/g, ''), 10);
                if (!isNaN(nextVal) && nextVal >= 1 && nextVal <= 60) {
                  jNum = nextVal;
                }
              }
            }
          }

          if (jNum && jNum >= 1 && jNum <= 60) {
            const isDup = foundHeaders.some(h => h.jornada === jNum && Math.abs(h.row - r) <= 1 && Math.abs(h.col - c) <= 3);
            if (!isDup) {
              foundHeaders.push({ jornada: jNum, row: r, col: c, text: String(row[c] || '') });
            }
          }
        }
      }

      // STEP 2: Multi-Jornada Grid Block Extraction (17 Jornadas with 9 games each)
      if (foundHeaders.length >= 2) {
        // Sort headers by row, then col
        const sortedHeaders = [...foundHeaders].sort((a, b) => a.row !== b.row ? a.row - b.row : a.col - b.col);

        // Group into horizontal tiers (headers on roughly the same row band within 3 rows)
        const tiers: FoundHeader[][] = [];
        for (const h of sortedHeaders) {
          let placed = false;
          for (const tier of tiers) {
            if (Math.abs(tier[0].row - h.row) <= 3) {
              tier.push(h);
              placed = true;
              break;
            }
          }
          if (!placed) {
            tiers.push([h]);
          }
        }

        // Process each tier and block
        for (let t = 0; t < tiers.length; t++) {
          const tier = tiers[t];
          tier.sort((a, b) => a.col - b.col);

          const tierHeaderRow = Math.max(...tier.map(h => h.row));
          const rowStart = tierHeaderRow + 1;
          const rowEnd = t < tiers.length - 1 
            ? Math.min(...tiers[t + 1].map(h => h.row)) - 1 
            : rows.length - 1;

          for (let k = 0; k < tier.length; k++) {
            const header = tier[k];
            const colStart = k === 0 ? Math.max(0, Math.min(header.col - 1, 0)) : header.col;
            let colEnd = maxCols - 1;

            if (k < tier.length - 1) {
              colEnd = Math.max(colStart, tier[k + 1].col - 1);
            } else {
              if (tier.length > 1) {
                const avgW = Math.max(5, Math.round((tier[tier.length - 1].col - tier[0].col) / (tier.length - 1)));
                colEnd = Math.min(maxCols - 1, Math.max(header.col + 5, header.col + avgW - 1));
              } else {
                colEnd = maxCols - 1;
              }
            }

            if (colEnd - colStart < 4 && colStart + 5 < maxCols) {
              colEnd = colStart + 5;
            }

            let gamesForThisJornada = 0;
            let blockColMap: {
              local?: number;
              visitante?: number;
              campo?: number;
              hora?: number;
              fecha?: number;
              vs?: number;
            } | null = null;

            for (let r = rowStart; r <= rowEnd && gamesForThisJornada < 9; r++) {
              const row = rows[r];
              if (!row || row.length === 0) continue;

              const slice = row.slice(colStart, colEnd + 1);
              const nonBlank = slice
                .map((c, i) => ({ val: String(c !== undefined && c !== null ? c : '').trim(), idx: i }))
                .filter(c => c.val !== '');
              if (nonBlank.length === 0) continue;

              const sliceJoined = nonBlank.map(c => c.val).join(' ');
              const normSlice = normalizeStr(sliceJoined);

              // If another Jornada header appears, stop this set
              const jInside = extractJornadaNum(sliceJoined);
              if (jInside && jInside !== header.jornada) {
                break;
              }

              // Check if slice is a table subheader row
              const isSubHeader = (
                (normSlice.includes('local') || normSlice.includes('casa') || normSlice.includes('home') || normSlice.includes('eq 1')) &&
                (normSlice.includes('visit') || normSlice.includes('away') || normSlice.includes('visita') || normSlice.includes('eq 2'))
              ) || (
                (normSlice.includes('equipo') || normSlice.includes('club') || normSlice.includes('duelo')) &&
                (normSlice.includes('campo') || normSlice.includes('hora') || normSlice.includes('vs') || normSlice.includes('estadio'))
              );

              if (isSubHeader) {
                blockColMap = {};
                slice.forEach((cell, idx) => {
                  const vNorm = normalizeStr(cell);
                  if (vNorm.includes('visit') || vNorm.includes('visita') || vNorm.includes('away') || vNorm.includes('eq 2')) blockColMap!.visitante = idx;
                  else if (vNorm.includes('local') || vNorm.includes('casa') || vNorm.includes('home') || vNorm.includes('eq 1')) blockColMap!.local = idx;
                  else if (vNorm === 'vs' || vNorm === 'vs.' || vNorm === '@') blockColMap!.vs = idx;
                  else if (vNorm.includes('campo') || vNorm.includes('estadio') || vNorm.includes('parque')) blockColMap!.campo = idx;
                  else if (vNorm.includes('hora') || vNorm.includes('time') || vNorm === 'h') blockColMap!.hora = idx;
                  else if (vNorm.includes('fecha') || vNorm.includes('date') || vNorm === 'f') blockColMap!.fecha = idx;
                });
                continue;
              }

              let localName = '';
              let awayName = '';
              let rowField = '';
              let rowDateStr = '';
              let rowTimeStr = '';
              const rowJornada = header.jornada;
              let rowCategory: Category = sheetCategory || defaultCategory || CATEGORIES[0];

              // 1. Block Column Map
              if (blockColMap && (blockColMap.local !== undefined || blockColMap.visitante !== undefined)) {
                if (blockColMap.local !== undefined) localName = String(slice[blockColMap.local] || '').trim();
                if (blockColMap.visitante !== undefined) awayName = String(slice[blockColMap.visitante] || '').trim();
                if (blockColMap.campo !== undefined && slice[blockColMap.campo]) rowField = String(slice[blockColMap.campo] || '').trim();
                if (blockColMap.hora !== undefined && slice[blockColMap.hora]) rowTimeStr = parseExcelTime(slice[blockColMap.hora]);
                if (blockColMap.fecha !== undefined && slice[blockColMap.fecha]) {
                  const pd = parseExcelDate(slice[blockColMap.fecha], baseSeasonDate);
                  rowDateStr = pd.dateStr;
                  if (pd.timeStr !== '08:00') rowTimeStr = pd.timeStr;
                }
              }

              // 2. Dedicated "vs" cell in slice (e.g. [Atleticos, vs, Astros])
              if (!localName || !awayName) {
                const vsIdx = slice.findIndex(c => {
                  const v = normalizeStr(c);
                  return v === 'vs' || v === 'vs.' || v === 'v/s' || v === 'v.s.' || v === '@' || v === 'contra';
                });
                if (vsIdx >= 0) {
                  let leftTeam = '';
                  for (let i = vsIdx - 1; i >= 0; i--) {
                    const v = String(slice[i] || '').trim();
                    if (v && !/^\d+$/.test(v) && !/^\d{1,2}:\d{2}/.test(v) && !isHeaderWord(v)) {
                      leftTeam = v;
                      break;
                    }
                  }
                  let rightTeam = '';
                  for (let i = vsIdx + 1; i < slice.length; i++) {
                    const v = String(slice[i] || '').trim();
                    if (v && !/^\d+$/.test(v) && !/^\d{1,2}:\d{2}/.test(v) && !isHeaderWord(v)) {
                      rightTeam = v;
                      break;
                    }
                  }
                  if (leftTeam && rightTeam) {
                    awayName = leftTeam;
                    localName = rightTeam;
                  }
                }
              }

              // 3. In-cell separator or newlines (e.g. "Atleticos vs Astros")
              if (!localName || !awayName) {
                for (let cellIdx = 0; cellIdx < slice.length; cellIdx++) {
                  const cellVal = String(slice[cellIdx] || '').trim();
                  if (cellVal.length < 4) continue;

                  const lines = cellVal.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
                  if (lines.length === 2 && lines[0].length >= 2 && lines[1].length >= 2 && !isHeaderWord(lines[0]) && !isHeaderWord(lines[1])) {
                    awayName = lines[0];
                    localName = lines[1];
                    break;
                  }

                  const sepRegex = /\s*(?:\b(?:vs\.?|v\.s\.?|v\/s|contra|@|frente\s+a)\b|(?:\s+[-—/]\s+))\s*/i;
                  if (sepRegex.test(cellVal)) {
                    const parts = cellVal.split(sepRegex).map(p => p.trim()).filter(Boolean);
                    if (parts.length >= 2 && parts[0].length >= 2 && parts[1].length >= 2 && !isHeaderWord(parts[0]) && !isHeaderWord(parts[1])) {
                      awayName = parts[0];
                      localName = parts[1];
                      break;
                    }
                  }
                }
              }

              // 4. Two candidate text cells in slice
              if (!localName || !awayName) {
                const textCells = nonBlank.filter(c => {
                  const v = c.val;
                  const isNum = /^\d+$/.test(v);
                  const isTime = /^\d{1,2}:\d{2}/.test(v);
                  const isVsWord = /^(vs\.?|v\/s|v\.s\.?|@|contra)$/i.test(v.trim());
                  const isHeader = isHeaderWord(v);
                  const isField = allKnownFields.some(f => normalizeStr(f) === normalizeStr(v)) || normalizeStr(v).includes('campo') || normalizeStr(v).includes('estadio') || normalizeStr(v).includes('parque');
                  return (!isNum && !isTime && !isVsWord && !isHeader && !isField && v.length >= 2 && v.length <= 45);
                });
                if (textCells.length >= 2) {
                  awayName = textCells[0].val;
                  localName = textCells[1].val;
                }
              }

              // Scan slice for field, time, date, category
              slice.forEach((cell) => {
                const strVal = String(cell || '').trim();
                if (!strVal) return;
                const cat = findCategory(strVal);
                if (cat) {
                  rowCategory = cat;
                  return;
                }
                if (/^\d{1,2}:\d{2}/.test(strVal) && !rowTimeStr) {
                  rowTimeStr = parseExcelTime(cell);
                  return;
                }
                if (allKnownFields.some(f => normalizeStr(f) === normalizeStr(strVal)) || normalizeStr(strVal).includes('campo') || normalizeStr(strVal).includes('estadio') || normalizeStr(strVal).includes('cliserio') || normalizeStr(strVal).includes('zorros')) {
                  if (!rowField) rowField = strVal;
                  return;
                }
                if (typeof cell === 'number' && cell > 40000 && cell < 60000 && !rowDateStr) {
                  const d = parseExcelDate(cell, baseSeasonDate);
                  rowDateStr = d.dateStr;
                  return;
                }
              });

              if (!localName || !awayName || isHeaderWord(localName) || isHeaderWord(awayName)) {
                continue;
              }

              // Clean team names (strip leading numbers like "1.- ", "1. ", "#1 ")
              const cleanHome = localName.replace(/^#?\d+[\.\-\)]\s*/, '').trim();
              const cleanAway = awayName.replace(/^#?\d+[\.\-\)]\s*/, '').trim();

              if (!cleanHome || !cleanAway || cleanHome.toLowerCase() === cleanAway.toLowerCase()) {
                continue;
              }

              // STRICT: Only match existing DB teams by exact normalized name for linking team.id
              const matchHome = findMatchingTeam(cleanHome, rowCategory);
              const matchAway = findMatchingTeam(cleanAway, rowCategory);

              if (matchHome.team?.category) {
                rowCategory = matchHome.team.category;
              } else if (matchAway.team?.category) {
                rowCategory = matchAway.team.category;
              }

              if (!rowDateStr) {
                const jOffsetDays = Math.max(0, rowJornada - 1) * 7;
                const targetDate = new Date(baseSeasonDate);
                targetDate.setDate(targetDate.getDate() + jOffsetDays);
                const day = targetDate.getDay();
                const diff = (6 - day + 7) % 7;
                targetDate.setDate(targetDate.getDate() + diff);
                const yyyy = targetDate.getFullYear();
                const mm = String(targetDate.getMonth() + 1).padStart(2, '0');
                const dd = String(targetDate.getDate()).padStart(2, '0');
                rowDateStr = `${yyyy}-${mm}-${dd}`;
              }

              if (!rowTimeStr) rowTimeStr = '08:00';

              if (!rowField) {
                const defaultFields = CATEGORY_FIELDS[rowCategory];
                rowField = (rowJornada % 2 === 1) ? 'Zorros' : 'Cliserio Sanchez';
                if (defaultFields && defaultFields.length > 0 && !defaultFields.includes(rowField)) {
                  rowField = defaultFields[0];
                }
              } else {
                rowField = formatFieldName(rowField);
              }

              // CRITICAL: Team names must remain EXACTLY as written in the Excel file
              const finalHome = cleanHome;
              const finalAway = cleanAway;

              const alreadyParsed = parsed.some(g =>
                g.jornada === rowJornada &&
                ((normalizeStr(g.homeTeamName) === normalizeStr(finalHome) && normalizeStr(g.awayTeamName) === normalizeStr(finalAway)) ||
                 (normalizeStr(g.homeTeamName) === normalizeStr(finalAway) && normalizeStr(g.awayTeamName) === normalizeStr(finalHome)))
              );

              if (!alreadyParsed) {
                parsed.push({
                  id: `parsed_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
                  jornada: rowJornada,
                  category: rowCategory,
                  homeTeamName: finalHome,
                  awayTeamName: finalAway,
                  homeTeamId: matchHome.team?.id,
                  awayTeamId: matchAway.team?.id,
                  isNewHomeTeam: !matchHome.team,
                  isNewAwayTeam: !matchAway.team,
                  dateStr: rowDateStr,
                  timeStr: rowTimeStr,
                  field: rowField,
                  tournament: importTournament,
                  rawSource: `${sheetName} (Jornada ${rowJornada}, Juego ${gamesForThisJornada + 1})`,
                });

                gamesForThisJornada++;
              }
            }
          }
        }
      } else {
        // STEP 3: Fallback Single-Table Parser (Vertical Stream)
        let currentJornada = defaultJornada;
        let currentCategory: Category = sheetCategory || defaultCategory || CATEGORIES[0];
        const currentDate = new Date(baseSeasonDate);
        let gamesForCurrentJornada = 0;

        let colMap: {
          jornada?: number;
          category?: number;
          local?: number;
          visitante?: number;
          vs?: number;
          campo?: number;
          hora?: number;
          fecha?: number;
          matchup?: number;
        } | null = null;

        for (let r = 0; r < rows.length; r++) {
          const row = rows[r];
          if (!row || row.length === 0) continue;

          const nonBlank = row
            .map((c, i) => ({ val: String(c !== undefined && c !== null ? c : '').trim(), idx: i }))
            .filter(c => c.val !== '');
          if (nonBlank.length === 0) continue;

          const rowJoined = nonBlank.map(c => c.val).join(' ');
          const normRow = normalizeStr(rowJoined);

          // Check for Jornada banner
          const jMatch = normRow.match(/jornada\s*#?\s*(\d+)/i) || 
                         normRow.match(/fecha\s*#?\s*(\d+)/i) ||
                         normRow.match(/\bj\s*#?\s*(\d+)\b/i) ||
                         normRow.match(/semana\s*(\d+)/i) ||
                         normRow.match(/ronda\s*(\d+)/i);
          if (jMatch && (nonBlank.length <= 4 || normRow.includes('rol') || normRow.includes('jornada'))) {
            currentJornada = parseInt(jMatch[1], 10);
            gamesForCurrentJornada = 0;
          }

          const catInBanner = findCategory(rowJoined);
          if (catInBanner && nonBlank.length <= 4) {
            currentCategory = catInBanner;
          }

          // Check if row is a Table Header Row
          const isHeaderRow = (
            (normRow.includes('local') || normRow.includes('casa') || normRow.includes('home') || normRow.includes('equipo 1') || normRow.includes('eq 1')) &&
            (normRow.includes('visitante') || normRow.includes('visita') || normRow.includes('away') || normRow.includes('equipo 2') || normRow.includes('eq 2'))
          ) || (
            (normRow.includes('equipo') || normRow.includes('club') || normRow.includes('enfrentamiento') || normRow.includes('juego') || normRow.includes('partido')) &&
            (normRow.includes('campo') || normRow.includes('hora') || normRow.includes('vs') || normRow.includes('jornada') || normRow.includes('estadio'))
          );

          if (isHeaderRow) {
            colMap = {};
            row.forEach((cell, idx) => {
              const valNorm = normalizeStr(cell);
              if (valNorm.includes('jornada') || valNorm === 'j' || valNorm === 'jor' || valNorm === 'sem') colMap!.jornada = idx;
              else if (valNorm.includes('cat') || valNorm.includes('division') || valNorm.includes('fuerza')) colMap!.category = idx;
              else if (valNorm.includes('visitante') || valNorm.includes('visita') || valNorm.includes('away') || valNorm.includes('equipo 2') || valNorm.includes('eq 2') || valNorm.includes('huesped')) colMap!.visitante = idx;
              else if (valNorm.includes('local') || valNorm.includes('casa') || valNorm.includes('home') || valNorm.includes('equipo 1') || valNorm.includes('eq 1') || valNorm.includes('anfitrion')) colMap!.local = idx;
              else if (valNorm === 'vs' || valNorm === 'vs.' || valNorm === '@') colMap!.vs = idx;
              else if (valNorm.includes('campo') || valNorm.includes('estadio') || valNorm.includes('parque') || valNorm.includes('lugar') || valNorm.includes('diamante')) colMap!.campo = idx;
              else if (valNorm.includes('hora') || valNorm.includes('time') || valNorm.includes('horario') || valNorm === 'h') colMap!.hora = idx;
              else if (valNorm.includes('fecha') || valNorm.includes('date') || valNorm.includes('dia') || valNorm === 'f') colMap!.fecha = idx;
              else if (valNorm.includes('partido') || valNorm.includes('juego') || valNorm.includes('enfrentamiento') || valNorm.includes('match') || valNorm.includes('duelo')) colMap!.matchup = idx;
            });
            continue;
          }

          if (gamesForCurrentJornada >= 9) {
            continue;
          }

          let localName = '';
          let awayName = '';
          let rowField = '';
          let rowDateStr = '';
          let rowTimeStr = '';
          let rowJornada = currentJornada;
          let rowCategory = currentCategory;

          if (colMap && (colMap.local !== undefined || colMap.visitante !== undefined || colMap.matchup !== undefined)) {
            if (colMap.local !== undefined) localName = String(row[colMap.local] || '').trim();
            if (colMap.visitante !== undefined) awayName = String(row[colMap.visitante] || '').trim();
            if (colMap.campo !== undefined) rowField = String(row[colMap.campo] || '').trim();

            if (colMap.fecha !== undefined && row[colMap.fecha]) {
              const parsedD = parseExcelDate(row[colMap.fecha], currentDate);
              rowDateStr = parsedD.dateStr;
              if (parsedD.timeStr !== '08:00') rowTimeStr = parsedD.timeStr;
            }

            if (colMap.hora !== undefined && row[colMap.hora]) {
              rowTimeStr = parseExcelTime(row[colMap.hora]);
            }

            if (colMap.jornada !== undefined && row[colMap.jornada]) {
              const jVal = parseInt(String(row[colMap.jornada]).replace(/\D/g, ''), 10);
              if (!isNaN(jVal) && jVal > 0) rowJornada = jVal;
            }

            if (colMap.category !== undefined && row[colMap.category]) {
              const catVal = findCategory(String(row[colMap.category]));
              if (catVal) rowCategory = catVal;
            }

            if (colMap.matchup !== undefined && (!localName || !awayName)) {
              const matchText = String(row[colMap.matchup] || '');
              const parts = matchText.split(/\s+vs\.?\s+|\s+@\s+|\s+contra\s+|\s+-\s+/i);
              if (parts.length >= 2) {
                awayName = parts[0].trim();
                localName = parts[1].trim();
              }
            }
          }

          // Dedicated "vs" cell
          if (!localName || !awayName) {
            const vsIdx = row.findIndex(c => {
              const v = normalizeStr(c);
              return v === 'vs' || v === 'vs.' || v === 'v/s' || v === 'v.s.' || v === '@' || v === 'contra';
            });
            if (vsIdx >= 0) {
              let leftTeam = '';
              for (let i = vsIdx - 1; i >= 0; i--) {
                const v = String(row[i] || '').trim();
                if (v && !/^\d+$/.test(v) && !/^\d{1,2}:\d{2}/.test(v) && !isHeaderWord(v)) {
                  leftTeam = v;
                  break;
                }
              }
              let rightTeam = '';
              for (let i = vsIdx + 1; i < row.length; i++) {
                const v = String(row[i] || '').trim();
                if (v && !/^\d+$/.test(v) && !/^\d{1,2}:\d{2}/.test(v) && !isHeaderWord(v)) {
                  rightTeam = v;
                  break;
                }
              }
              if (leftTeam && rightTeam) {
                awayName = leftTeam;
                localName = rightTeam;
              }
            }
          }

          // Text cells in row
          if (!localName || !awayName) {
            const textCells = nonBlank.filter(c => {
              const v = c.val;
              const isNum = /^\d+$/.test(v);
              const isTime = /^\d{1,2}:\d{2}/.test(v);
              const isVsWord = /^(vs\.?|v\/s|v\.s\.?|@|contra)$/i.test(v.trim());
              const isHeaderWordItem = isHeaderWord(v);
              const isField = allKnownFields.some(f => normalizeStr(f) === normalizeStr(v)) || normalizeStr(v).includes('campo') || normalizeStr(v).includes('estadio');
              return (!isNum && !isTime && !isVsWord && !isHeaderWordItem && !isField && v.length >= 2 && v.length <= 40);
            });
            if (textCells.length >= 2) {
              awayName = textCells[0].val;
              localName = textCells[1].val;
            }
          }

          row.forEach((cell) => {
            const strVal = String(cell || '').trim();
            if (!strVal) return;
            const cat = findCategory(strVal);
            if (cat) {
              rowCategory = cat;
              return;
            }
            if (/^\d{1,2}:\d{2}/.test(strVal) && !rowTimeStr) {
              rowTimeStr = parseExcelTime(cell);
              return;
            }
            if (allKnownFields.some(f => normalizeStr(f) === normalizeStr(strVal)) || normalizeStr(strVal).includes('campo') || normalizeStr(strVal).includes('estadio')) {
              if (!rowField) rowField = strVal;
              return;
            }
            if (typeof cell === 'number' && cell > 40000 && cell < 60000 && !rowDateStr) {
              const d = parseExcelDate(cell, currentDate);
              rowDateStr = d.dateStr;
              return;
            }
          });

          if (!localName || !awayName || isHeaderWord(localName) || isHeaderWord(awayName)) {
            continue;
          }

          const cleanHome = localName.replace(/^#?\d+[\.\-\)]\s*/, '').trim();
          const cleanAway = awayName.replace(/^#?\d+[\.\-\)]\s*/, '').trim();

          if (!cleanHome || !cleanAway || cleanHome.toLowerCase() === cleanAway.toLowerCase()) {
            continue;
          }

          const matchHome = findMatchingTeam(cleanHome, rowCategory);
          const matchAway = findMatchingTeam(cleanAway, rowCategory);

          if (matchHome.team?.category) {
            rowCategory = matchHome.team.category;
          } else if (matchAway.team?.category) {
            rowCategory = matchAway.team.category;
          }

          if (!rowDateStr) {
            const jOffsetDays = Math.max(0, rowJornada - 1) * 7;
            const targetDate = new Date(baseSeasonDate);
            targetDate.setDate(targetDate.getDate() + jOffsetDays);
            const day = targetDate.getDay();
            const diff = (6 - day + 7) % 7;
            targetDate.setDate(targetDate.getDate() + diff);
            const yyyy = targetDate.getFullYear();
            const mm = String(targetDate.getMonth() + 1).padStart(2, '0');
            const dd = String(targetDate.getDate()).padStart(2, '0');
            rowDateStr = `${yyyy}-${mm}-${dd}`;
          }

          if (!rowTimeStr) rowTimeStr = '08:00';

          if (!rowField) {
            const defaultFields = CATEGORY_FIELDS[rowCategory];
            rowField = defaultFields && defaultFields.length > 0 ? defaultFields[0] : 'Campo Municipal 1';
          }

          const finalHome = cleanHome;
          const finalAway = cleanAway;

          parsed.push({
            id: `parsed_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            jornada: rowJornada,
            category: rowCategory,
            homeTeamName: finalHome,
            awayTeamName: finalAway,
            homeTeamId: matchHome.team?.id,
            awayTeamId: matchAway.team?.id,
            isNewHomeTeam: !matchHome.team,
            isNewAwayTeam: !matchAway.team,
            dateStr: rowDateStr,
            timeStr: rowTimeStr,
            field: rowField,
            tournament: importTournament,
            rawSource: sheetName,
          });

          gamesForCurrentJornada++;
        }
      }
    });

    // Sort all parsed games chronologically by Jornada, then Time
    parsed.sort((a, b) => {
      if (a.jornada !== b.jornada) return a.jornada - b.jornada;
      return a.timeStr.localeCompare(b.timeStr);
    });

    return parsed;
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setFile(selectedFile);
    setFileName(selectedFile.name);
    setReading(true);
    setParsingError(null);
    setImportSuccessCount(null);

    try {
      const buffer = await selectedFile.arrayBuffer();
      const wb = XLSX.read(new Uint8Array(buffer), { type: 'array', cellDates: true });

      const sheetsData: RawSheetInfo[] = wb.SheetNames.map(name => {
        const ws = wb.Sheets[name];
        const rows = ws ? (XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as any[][]) : [];
        return { sheetName: name, rows };
      });

      setRawSheets(sheetsData);
      setSelectedSheetIndex(0);

      // Run automatic parser
      const autoGames = runAutoParser(sheetsData);

      if (autoGames.length > 0) {
        setParsedGames(autoGames);
        setViewMode('preview');
      } else {
        // If 0 games were found automatically, switch to visual mapper so user can effortlessly pick columns!
        setParsedGames([]);
        setViewMode('mapper');
      }
    } catch (err: any) {
      console.error("Error reading Excel file:", err);
      setParsingError(err?.message || "Error al procesar el archivo Excel. Asegúrate de que no esté protegido con contraseña.");
      setViewMode('mapper');
    } finally {
      setReading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Run manual mapper extraction on current sheet
  const handleApplyMapper = () => {
    const currentSheet = rawSheets[selectedSheetIndex];
    if (!currentSheet || !currentSheet.rows || currentSheet.rows.length === 0) return;

    const extracted: ParsedRolGame[] = [];
    const rows = currentSheet.rows;

    for (let r = mapperStartRow; r < rows.length; r++) {
      const row = rows[r];
      if (!row || row.length === 0) continue;

      let home = '';
      let away = '';
      let jornada = mapperFixedJornada;
      let field = 'Campo Municipal 1';
      let dateStr = '';
      let timeStr = '08:00';
      const category = mapperCategory;

      // Local & Visitante extraction
      if (mapperHomeCol === 'vs_combined') {
        const cellVal = String(row[0] || '').trim();
        const parts = cellVal.split(/\s+(?:vs\.?|@|contra|-)\s+/i);
        if (parts.length >= 2) {
          away = parts[0].trim();
          home = parts[1].trim();
        }
      } else {
        const hIdx = typeof mapperHomeCol === 'number' ? mapperHomeCol : 0;
        const aIdx = typeof mapperAwayCol === 'number' ? mapperAwayCol : 1;
        home = String(row[hIdx] || '').trim();
        away = String(row[aIdx] || '').trim();
      }

      // Check if both teams are valid
      if (!home || !away || home.toLowerCase().includes('equipo') || away.toLowerCase().includes('equipo')) {
        continue;
      }

      // Jornada
      if (mapperJornadaCol !== 'auto' && mapperJornadaCol !== 'none') {
        const jVal = parseInt(String(row[Number(mapperJornadaCol)]).replace(/\D/g, ''), 10);
        if (!isNaN(jVal) && jVal > 0) jornada = jVal;
      }

      // Campo
      if (mapperFieldCol !== 'none') {
        const fVal = String(row[Number(mapperFieldCol)] || '').trim();
        if (fVal) field = fVal;
      }

      // Hora / Fecha
      if (mapperTimeCol !== 'none') {
        const cell = row[Number(mapperTimeCol)];
        const pd = parseExcelDate(cell, baseSeasonDate);
        if (pd.dateStr) dateStr = pd.dateStr;
        if (pd.timeStr) timeStr = pd.timeStr;
      }

      if (!dateStr) {
        const jOffsetDays = Math.max(0, jornada - 1) * 7;
        const targetDate = new Date(baseSeasonDate);
        targetDate.setDate(targetDate.getDate() + jOffsetDays);
        const day = targetDate.getDay();
        const diff = (6 - day + 7) % 7;
        targetDate.setDate(targetDate.getDate() + diff);
        const yyyy = targetDate.getFullYear();
        const mm = String(targetDate.getMonth() + 1).padStart(2, '0');
        const dd = String(targetDate.getDate()).padStart(2, '0');
        dateStr = `${yyyy}-${mm}-${dd}`;
      }

      const matchHome = findMatchingTeam(home, category);
      const matchAway = findMatchingTeam(away, category);

      extracted.push({
        id: `parsed_manual_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        jornada,
        category,
        homeTeamName: matchHome.team?.name || matchHome.cleanName,
        awayTeamName: matchAway.team?.name || matchAway.cleanName,
        homeTeamId: matchHome.team?.id,
        awayTeamId: matchAway.team?.id,
        isNewHomeTeam: !matchHome.team,
        isNewAwayTeam: !matchAway.team,
        dateStr,
        timeStr,
        field,
        tournament: importTournament,
        rawSource: currentSheet.sheetName,
      });
    }

    if (extracted.length > 0) {
      setParsedGames(prev => [...prev, ...extracted]);
      setViewMode('preview');
      setParsingError(null);
    } else {
      setParsingError('No se encontraron partidos con la selección de columnas actual. Intenta seleccionando otras columnas o verificando la fila inicial.');
    }
  };

  const uniqueJornadas = useMemo(() => {
    return Array.from(new Set(parsedGames.map(g => g.jornada))).sort((a, b) => Number(a) - Number(b));
  }, [parsedGames]);

  const uniqueCategories = useMemo(() => {
    return Array.from(new Set(parsedGames.map(g => g.category)));
  }, [parsedGames]);

  const newTeamsCount = useMemo(() => {
    const newTeamNames = new Set<string>();
    parsedGames.forEach(g => {
      if (g.isNewHomeTeam) newTeamNames.add(`${normalizeStr(g.homeTeamName)}_${g.category}`);
      if (g.isNewAwayTeam) newTeamNames.add(`${normalizeStr(g.awayTeamName)}_${g.category}`);
    });
    return newTeamNames.size;
  }, [parsedGames]);

  const filteredGames = useMemo(() => {
    if (selectedJornadaFilter === 'All') return parsedGames;
    return parsedGames.filter(g => g.jornada === selectedJornadaFilter);
  }, [parsedGames, selectedJornadaFilter]);

  const handleReScan = () => {
    if (!rawSheets || rawSheets.length === 0) return;
    setReading(true);
    try {
      const autoGames = runAutoParser(rawSheets);
      setParsedGames(autoGames);
      setViewMode(autoGames.length > 0 ? 'preview' : 'mapper');
      setParsingError(null);
    } catch (e: any) {
      setParsingError(e?.message || 'Error al re-analizar las hojas.');
    } finally {
      setReading(false);
    }
  };

  const handleAddManualGame = (customJornada?: number, customHome?: string, customAway?: string, customCat?: Category) => {
    const targetJ = customJornada || (selectedJornadaFilter === 'All' ? 1 : selectedJornadaFilter);
    const targetCat = customCat || defaultCategory || 'Colt';
    const homeName = customHome || 'Mets';
    const awayName = customAway || 'Culiacan';

    const matchHome = findMatchingTeam(homeName, targetCat);
    const matchAway = findMatchingTeam(awayName, targetCat);

    const jOffsetDays = Math.max(0, targetJ - 1) * 7;
    const targetDate = new Date(baseSeasonDate);
    targetDate.setDate(targetDate.getDate() + jOffsetDays);
    const day = targetDate.getDay();
    const diff = (6 - day + 7) % 7;
    targetDate.setDate(targetDate.getDate() + diff);
    const yyyy = targetDate.getFullYear();
    const mm = String(targetDate.getMonth() + 1).padStart(2, '0');
    const dd = String(targetDate.getDate()).padStart(2, '0');
    const defaultFields = CATEGORY_FIELDS[targetCat];
    const rowField = defaultFields && defaultFields.length > 0 ? defaultFields[0] : 'Zorros';

    const newG: ParsedRolGame = {
      id: `parsed_manual_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      jornada: targetJ,
      category: targetCat,
      homeTeamName: matchHome.team?.name || homeName,
      awayTeamName: matchAway.team?.name || awayName,
      homeTeamId: matchHome.team?.id,
      awayTeamId: matchAway.team?.id,
      isNewHomeTeam: !matchHome.team,
      isNewAwayTeam: !matchAway.team,
      dateStr: `${yyyy}-${mm}-${dd}`,
      timeStr: '08:00',
      field: rowField,
      tournament: importTournament,
      rawSource: 'Agregado manualmente / asistido'
    };

    setParsedGames(prev => [newG, ...prev]);
  };



  const handleDeleteParsedGame = (id: string) => {
    setParsedGames(prev => prev.filter(g => g.id !== id));
  };

  const handleUpdateParsedGame = (id: string, updates: Partial<ParsedRolGame>) => {
    setParsedGames(prev => prev.map(g => g.id === id ? { ...g, ...updates } : g));
  };

  const handleClearPreviousSchedule = async () => {
    const confirm = window.confirm("¿Estás seguro de que deseas borrar toda la memoria del rol previo? Se eliminarán todos los partidos programados actuales en la base de datos.");
    if (!confirm) return;

    setIsClearingMemory(true);
    try {
      const snap = await getDocs(query(collection(db, 'games'), where('status', '==', 'scheduled')));
      const chunks: typeof snap.docs[] = [];
      for (let i = 0; i < snap.docs.length; i += 350) {
        chunks.push(snap.docs.slice(i, i + 350));
      }
      for (const chunk of chunks) {
        const delBatch = writeBatch(db);
        chunk.forEach(d => delBatch.delete(d.ref));
        await delBatch.commit();
      }
      setMemoryClearedNotice(true);
      setTimeout(() => setMemoryClearedNotice(false), 5000);
    } catch (err) {
      console.error("Error clearing memory:", err);
      alert("Error al borrar memoria de partidos.");
    } finally {
      setIsClearingMemory(false);
    }
  };

  const handleConfirmImport = async () => {
    if (parsedGames.length === 0) return;
    setImporting(true);

    try {
      // 0. If "Borrar rol anterior al importar" is active, delete all previous scheduled games first
      if (clearPreviousSchedule) {
        try {
          const snap = await getDocs(query(collection(db, 'games'), where('status', '==', 'scheduled')));
          const chunks: typeof snap.docs[] = [];
          for (let i = 0; i < snap.docs.length; i += 350) {
            chunks.push(snap.docs.slice(i, i + 350));
          }
          for (const chunk of chunks) {
            const delBatch = writeBatch(db);
            chunk.forEach(d => delBatch.delete(d.ref));
            await delBatch.commit();
          }
        } catch (err) {
          console.warn("Could not delete previous scheduled games:", err);
        }
      }

      // 1. Fetch existing games from Firestore if duplicate avoidance is active
      let existingGamesList: any[] = [];
      if (skipDuplicatesInDb && !clearPreviousSchedule) {
        try {
          const snap = await getDocs(collection(db, 'games'));
          existingGamesList = snap.docs.map(d => d.data());
        } catch (err) {
          console.warn("Could not query existing games for deduplication:", err);
        }
      }

      const isGameDuplicate = (pg: ParsedRolGame) => {
        if (!skipDuplicatesInDb || clearPreviousSchedule) return false;
        return existingGamesList.some(eg => {
          if (Number(eg.jornada) !== Number(pg.jornada)) return false;
          const egH = normalizeStr(eg.homeTeamName);
          const egA = normalizeStr(eg.awayTeamName);
          const pgH = normalizeStr(pg.homeTeamName);
          const pgA = normalizeStr(pg.awayTeamName);
          return (egH === pgH && egA === pgA) || (egH === pgA && egA === pgH);
        });
      };

      const gamesToInsert = parsedGames.filter(pg => !isGameDuplicate(pg));

      if (gamesToInsert.length === 0 && parsedGames.length > 0) {
        setImportSuccessCount(0);
        if (onImportSuccess) onImportSuccess(0);
        setParsingError(null);
        return;
      }

      // 1. Prepare teams to create
      const createdTeamsMap = new Map<string, string>();
      const teamsToCreate = new Map<string, any>();

      for (const pg of gamesToInsert) {
        if (pg.isNewHomeTeam && !pg.homeTeamId) {
          const key = `${normalizeStr(pg.homeTeamName)}_${pg.category}`;
          if (!teamsToCreate.has(key)) {
            teamsToCreate.set(key, {
              name: pg.homeTeamName,
              category: pg.category,
              leagueId: 'default',
              coachId: '',
              wins: 0,
              losses: 0,
              runsScored: 0,
              runsAllowed: 0,
              tournament: importTournament,
            });
          }
        }

        if (pg.isNewAwayTeam && !pg.awayTeamId) {
          const key = `${normalizeStr(pg.awayTeamName)}_${pg.category}`;
          if (!teamsToCreate.has(key)) {
            teamsToCreate.set(key, {
              name: pg.awayTeamName,
              category: pg.category,
              leagueId: 'default',
              coachId: '',
              wins: 0,
              losses: 0,
              runsScored: 0,
              runsAllowed: 0,
              tournament: importTournament,
            });
          }
        }
      }

      // 2. Commit in chunks (Firestore limit is 500 ops per batch)
      const MAX_BATCH_OPS = 350;
      let currentBatch = writeBatch(db);
      let opCount = 0;

      for (const [key, teamData] of teamsToCreate.entries()) {
        const teamRef = doc(collection(db, 'teams'));
        currentBatch.set(teamRef, teamData);
        createdTeamsMap.set(key, teamRef.id);
        opCount++;
        if (opCount >= MAX_BATCH_OPS) {
          await currentBatch.commit();
          currentBatch = writeBatch(db);
          opCount = 0;
        }
      }

      for (const pg of gamesToInsert) {
        const [hours, minutes] = pg.timeStr.split(':');
        const [y, m, d] = pg.dateStr.split('-').map(Number);
        const gameDate = new Date(y, m - 1, d, parseInt(hours || '8', 10), parseInt(minutes || '0', 10), 0, 0);

        const homeKey = `${normalizeStr(pg.homeTeamName)}_${pg.category}`;
        const awayKey = `${normalizeStr(pg.awayTeamName)}_${pg.category}`;

        const homeId = pg.homeTeamId || createdTeamsMap.get(homeKey) || 'temp_home';
        const awayId = pg.awayTeamId || createdTeamsMap.get(awayKey) || 'temp_away';

        const gameRef = doc(collection(db, 'games'));
        currentBatch.set(gameRef, {
          homeTeamId: homeId,
          awayTeamId: awayId,
          homeTeamName: pg.homeTeamName,
          awayTeamName: pg.awayTeamName,
          category: pg.category,
          date: gameDate.toISOString(),
          field: formatFieldName(pg.field) || 'Zorros',
          status: 'scheduled',
          score: { home: 0, away: 0 },
          inning: 1,
          isTop: true,
          outs: 0,
          balls: 0,
          strikes: 0,
          runners: { first: null, second: null, third: null },
          currentBatterIndex: { home: 0, away: 0 },
          leagueId: 'default',
          tournament: importTournament,
          jornada: pg.jornada,
        });
        opCount++;
        if (opCount >= MAX_BATCH_OPS) {
          await currentBatch.commit();
          currentBatch = writeBatch(db);
          opCount = 0;
        }
      }

      if (opCount > 0) {
        await currentBatch.commit();
      }

      const totalAdded = gamesToInsert.length;
      setImportSuccessCount(totalAdded);
      if (onImportSuccess) onImportSuccess(totalAdded);
    } catch (error) {
      console.error("Error importing rol games:", error);
      handleFirestoreError(error, OperationType.CREATE, 'games');
      setParsingError("Error al guardar los partidos en la base de datos.");
    } finally {
      setImporting(false);
    }
  };

  const handleReset = () => {
    setFile(null);
    setFileName('');
    setRawSheets([]);
    setParsedGames([]);
    setViewMode('preview');
    setImportSuccessCount(null);
    setParsingError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  if (!isOpen) return null;

  const currentSheet = rawSheets[selectedSheetIndex];
  const maxCols = currentSheet?.rows?.reduce((acc, r) => Math.max(acc, r.length), 0) || 0;
  const colLetter = (idx: number) => String.fromCharCode(65 + (idx % 26));

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-md z-[100] flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 15 }}
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl w-full max-w-5xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden"
      >
        {/* Modal Header */}
        <div className="p-5 sm:p-6 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-900/50">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-emerald-500/10 text-emerald-600 rounded-2xl flex items-center justify-center border border-emerald-500/20">
              <FileSpreadsheet className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-xl font-black tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
                Subir Rol de Juegos (Excel)
                <span className="text-[10px] bg-emerald-500/10 text-emerald-600 px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider">
                  Por Jornada
                </span>
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {fileName ? `Archivo: ${fileName} • ${parsedGames.length} juegos listos` : 'Selecciona o arrastra tu archivo de rol (.xlsx, .xls o .csv)'}
              </p>
            </div>
          </div>
          <button
            onClick={() => { onClose(); handleReset(); }}
            className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-6">
          {/* File Picker State: If no file uploaded yet */}
          {!file && (
            <div className="py-12 px-6 flex flex-col items-center justify-center border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-3xl bg-slate-50/50 dark:bg-slate-950/30 text-center space-y-4">
              <input
                type="file"
                ref={fileInputRef}
                accept=".xlsx,.xls,.csv"
                onChange={handleFileChange}
                className="hidden"
                onClick={(e) => { (e.target as HTMLInputElement).value = ''; }}
              />
              <div className="w-20 h-20 bg-emerald-500/10 text-emerald-600 rounded-3xl flex items-center justify-center mx-auto shadow-inner">
                {reading ? <Loader2 className="w-10 h-10 animate-spin" /> : <Upload className="w-10 h-10" />}
              </div>
              <div className="max-w-md space-y-1">
                <h4 className="text-lg font-bold text-slate-900 dark:text-white">
                  {reading ? 'Analizando archivo Excel...' : 'Cargar Archivo de Rol de Juegos'}
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Detecta automáticamente hojas por jornada, columnas de local y visitante, fechas, horarios y campos.
                </p>
              </div>
              <button
                type="button"
                disabled={reading}
                onClick={() => fileInputRef.current?.click()}
                className="bg-emerald-600 hover:bg-emerald-700 text-white px-8 py-3.5 rounded-2xl font-bold transition-all shadow-lg shadow-emerald-600/25 active:scale-95 flex items-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {reading ? <Loader2 className="w-5 h-5 animate-spin" /> : <FileSpreadsheet className="w-5 h-5" />}
                <span>{reading ? 'Leyendo...' : 'Seleccionar Archivo Excel (.xlsx / .csv)'}</span>
              </button>
              <div className="flex flex-wrap items-center justify-center gap-2 pt-2 text-[11px] text-slate-400">
                <span className="bg-slate-200/50 dark:bg-slate-800 px-2.5 py-1 rounded-lg">✓ Soporta Jornadas múltiples</span>
                <span className="bg-slate-200/50 dark:bg-slate-800 px-2.5 py-1 rounded-lg">✓ Formato "Equipo 1 vs Equipo 2"</span>
                <span className="bg-slate-200/50 dark:bg-slate-800 px-2.5 py-1 rounded-lg">✓ Mapeo asistido si es necesario</span>
              </div>
            </div>
          )}

          {/* Success screen after import */}
          {importSuccessCount !== null && (
            <div className="py-10 text-center space-y-5">
              <div className="w-20 h-20 bg-emerald-500/10 text-emerald-600 rounded-3xl flex items-center justify-center mx-auto border-2 border-emerald-500/20">
                <CheckCircle2 className="w-10 h-10" />
              </div>
              <div className="space-y-1">
                <h4 className="text-2xl font-black text-slate-900 dark:text-white">¡Partidos Importados con Éxito!</h4>
                <p className="text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                  Se registraron <strong className="text-emerald-600 font-bold">{importSuccessCount} partidos programados</strong> organizados por jornada en la liga.
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-3 pt-4">
                {onNavigateToGames && (
                  <button
                    onClick={() => {
                      onClose();
                      handleReset();
                      onNavigateToGames();
                    }}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white px-7 py-3 rounded-2xl font-bold shadow-lg shadow-indigo-600/25 transition-all flex items-center gap-2 cursor-pointer"
                  >
                    <Calendar className="w-5 h-5" />
                    <span>Ver en Apartado de Partidos</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                )}
                <button
                  onClick={() => { onClose(); handleReset(); }}
                  className="bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-200 px-6 py-3 rounded-2xl font-bold transition-all cursor-pointer"
                >
                  Cerrar
                </button>
              </div>
            </div>
          )}

          {/* Parsing error notification */}
          {parsingError && (
            <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-2xl flex items-center gap-3 text-red-600 dark:text-red-400 text-xs font-semibold">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <p className="flex-1">{parsingError}</p>
              <button onClick={() => setParsingError(null)} className="p-1 hover:bg-red-500/10 rounded-lg">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Active File Content View (Preview or Mapper) */}
          {file && importSuccessCount === null && (
            <>
              {/* Top Control Bar */}
              <div className="flex flex-wrap items-center justify-between gap-4 bg-slate-50 dark:bg-slate-800/60 p-4 rounded-2xl border border-slate-200 dark:border-slate-700">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-emerald-500/10 text-emerald-600 rounded-xl">
                    <FileSpreadsheet className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="text-xs font-black uppercase text-slate-400 tracking-wider">Archivo cargado</span>
                    <p className="text-sm font-bold text-slate-800 dark:text-slate-200 truncate max-w-xs">{fileName}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setViewMode(viewMode === 'preview' ? 'mapper' : 'preview')}
                    className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 border cursor-pointer ${
                      viewMode === 'mapper'
                        ? 'bg-indigo-600 text-white border-indigo-600 shadow-md shadow-indigo-600/20'
                        : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-indigo-500'
                    }`}
                  >
                    <Sliders className="w-4 h-4" />
                    <span>{viewMode === 'mapper' ? 'Ver Juegos Extraídos' : 'Ajustar Columnas / Hojas'}</span>
                  </button>

                  <button
                    onClick={handleReset}
                    className="px-3 py-2 text-xs font-bold text-slate-500 hover:text-red-500 transition-colors cursor-pointer"
                  >
                    Cambiar archivo
                  </button>
                </div>
              </div>

              {/* VIEW MODE: PREVIEW OF DETECTED GAMES */}
              {viewMode === 'preview' && (
                <div className="space-y-6">
                  {/* Summary Metric Cards */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 p-4 rounded-2xl">
                      <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Total Partidos</span>
                      <p className="text-2xl font-black text-slate-900 dark:text-white mt-1">{parsedGames.length}</p>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 p-4 rounded-2xl">
                      <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Jornadas Detectadas</span>
                      <p className="text-2xl font-black text-indigo-600 mt-1">{uniqueJornadas.length || 1}</p>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 p-4 rounded-2xl">
                      <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Categorías</span>
                      <p className="text-2xl font-black text-emerald-600 mt-1">{uniqueCategories.length || 1}</p>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 p-4 rounded-2xl">
                      <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Equipos Nuevos</span>
                      <p className="text-2xl font-black text-amber-600 mt-1">{newTeamsCount}</p>
                    </div>
                  </div>

                  {/* Filter and Configuration Toolbar */}
                  <div className="space-y-3 bg-slate-50 dark:bg-slate-800/30 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      {/* Jornada Quick Select */}
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Jornada:</span>
                        <select
                          value={selectedJornadaFilter}
                          onChange={(e) => setSelectedJornadaFilter(e.target.value === 'All' ? 'All' : parseInt(e.target.value, 10))}
                          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-1.5 text-xs font-bold text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        >
                          <option value="All">Todas las Jornadas ({parsedGames.length} partidos)</option>
                          {uniqueJornadas.map(j => (
                            <option key={j} value={j}>
                              Jornada {j} ({parsedGames.filter(g => g.jornada === j).length} juegos)
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Tournament Selection and Actions */}
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Torneo:</span>
                          <select
                            value={importTournament}
                            onChange={(e) => setImportTournament(e.target.value as TournamentType)}
                            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-1.5 text-xs font-bold text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          >
                            {TOURNAMENTS.map(t => (
                              <option key={t} value={t}>{t}</option>
                            ))}
                          </select>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleAddManualGame()}
                          className="bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 border border-indigo-200 dark:border-indigo-800 px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer"
                          title="Agregar un juego manual o faltante"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>+ Partido</span>
                        </button>

                        <button
                          type="button"
                          onClick={handleReScan}
                          className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 border border-slate-200 dark:border-slate-700 px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer"
                          title="Volver a analizar las hojas del Excel buscando las 17 jornadas (9 juegos c/u)"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          <span>Volver a correr</span>
                        </button>

                        <button
                          type="button"
                          disabled={isClearingMemory}
                          onClick={handleClearPreviousSchedule}
                          className="bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 hover:bg-red-100 border border-red-200 dark:border-red-800 px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                          title="Borrar todos los partidos programados previos en la base de datos"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>{isClearingMemory ? 'Borrando...' : 'Borrar Memoria Previa'}</span>
                        </button>
                      </div>
                    </div>

                    {memoryClearedNotice && (
                      <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 rounded-xl text-xs font-bold flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        <span>¡Memoria de partidos previos borrada con éxito! La base de datos está limpia para el nuevo rol.</span>
                      </div>
                    )}

                    {/* Jornadas Fast Navigation Chips */}
                    <div className="flex flex-wrap items-center gap-1.5 max-h-24 overflow-y-auto pt-1 border-t border-slate-200/60 dark:border-slate-700/50">
                      <button
                        onClick={() => setSelectedJornadaFilter('All')}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                          selectedJornadaFilter === 'All'
                            ? 'bg-indigo-600 text-white shadow-sm'
                            : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-indigo-600'
                        }`}
                      >
                        Todas ({parsedGames.length})
                      </button>
                      {uniqueJornadas.map(j => (
                        <button
                          key={j}
                          onClick={() => setSelectedJornadaFilter(j)}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                            selectedJornadaFilter === j
                              ? 'bg-indigo-600 text-white shadow-sm'
                              : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-indigo-600'
                          }`}
                        >
                          J{j} <span className="opacity-70">({parsedGames.filter(g => g.jornada === j).length})</span>
                        </button>
                      ))}
                    </div>

                    {/* Import configuration checkboxes */}
                    <div className="space-y-2 pt-1 border-t border-slate-200/60 dark:border-slate-700/50 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <label className="flex items-center gap-2 text-indigo-700 dark:text-indigo-300 cursor-pointer font-bold select-none">
                          <input
                            type="checkbox"
                            checked={clearPreviousSchedule}
                            onChange={(e) => setClearPreviousSchedule(e.target.checked)}
                            className="w-4 h-4 rounded border-indigo-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                          />
                          <span>Borrar rol anterior al importar (Sobrescribir completamente la base de datos con este archivo)</span>
                        </label>
                        <span className="text-[10px] text-indigo-600 dark:text-indigo-400 font-bold uppercase tracking-wider bg-indigo-50 dark:bg-indigo-950/60 px-2 py-0.5 rounded-full">
                          {uniqueJornadas.length} Jornadas detectadas (9 juegos c/u)
                        </span>
                      </div>

                      {!clearPreviousSchedule && (
                        <label className="flex items-center gap-2 text-slate-600 dark:text-slate-300 cursor-pointer font-medium select-none pl-6">
                          <input
                            type="checkbox"
                            checked={skipDuplicatesInDb}
                            onChange={(e) => setSkipDuplicatesInDb(e.target.checked)}
                            className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                          />
                          <span>Evitar duplicar partidos que ya existan en la base de datos</span>
                        </label>
                      )}
                    </div>
                  </div>



                  {/* Games Table List */}
                  {filteredGames.length === 0 ? (
                    <div className="py-12 text-center space-y-3 bg-slate-50/50 dark:bg-slate-900/30 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800">
                      <AlertCircle className="w-8 h-8 text-amber-500 mx-auto" />
                      <p className="text-sm font-bold text-slate-600 dark:text-slate-300">
                        No se detectaron partidos con el formato estándar automático.
                      </p>
                      <button
                        onClick={() => setViewMode('mapper')}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl text-xs font-bold transition-all shadow-md cursor-pointer"
                      >
                        Abrir Asistente de Columnas para Seleccionar Manualmente
                      </button>
                    </div>
                  ) : (
                    <div className="border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm">
                      <div className="overflow-x-auto max-h-[380px]">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead className="bg-slate-100 dark:bg-slate-800/80 sticky top-0 z-10 text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                            <tr>
                              <th className="p-3">Jornada</th>
                              <th className="p-3">Categoría</th>
                              <th className="p-3">Equipo Local (Casa)</th>
                              <th className="p-3">Equipo Visitante</th>
                              <th className="p-3">Campo</th>
                              <th className="p-3">Fecha</th>
                              <th className="p-3">Hora</th>
                              <th className="p-3 text-right">Acción</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                            {filteredGames.map((g) => (
                              <tr key={g.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                                <td className="p-3">
                                  <input
                                    type="number"
                                    min="1"
                                    max="50"
                                    value={g.jornada}
                                    onChange={(e) => handleUpdateParsedGame(g.id, { jornada: parseInt(e.target.value) || 1 })}
                                    className="w-14 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 font-bold text-center"
                                  />
                                </td>
                                <td className="p-3">
                                  <select
                                    value={g.category}
                                    onChange={(e) => handleUpdateParsedGame(g.id, { category: e.target.value as Category })}
                                    className="bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 font-semibold text-[11px]"
                                  >
                                    {CATEGORIES.map(cat => (
                                      <option key={cat} value={cat}>{cat}</option>
                                    ))}
                                  </select>
                                </td>
                                <td className="p-3">
                                  <div className="space-y-0.5">
                                    <input
                                      type="text"
                                      value={g.homeTeamName}
                                      onChange={(e) => handleUpdateParsedGame(g.id, { homeTeamName: e.target.value })}
                                      className="font-bold bg-transparent border-b border-transparent hover:border-slate-300 focus:border-indigo-500 focus:outline-none w-full"
                                    />
                                    {g.isNewHomeTeam && (
                                      <span className="text-[9px] bg-amber-500/10 text-amber-600 px-1.5 py-0.5 rounded font-bold uppercase tracking-wider inline-block">
                                        Nuevo equipo
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td className="p-3">
                                  <div className="space-y-0.5">
                                    <input
                                      type="text"
                                      value={g.awayTeamName}
                                      onChange={(e) => handleUpdateParsedGame(g.id, { awayTeamName: e.target.value })}
                                      className="font-bold bg-transparent border-b border-transparent hover:border-slate-300 focus:border-indigo-500 focus:outline-none w-full"
                                    />
                                    {g.isNewAwayTeam && (
                                      <span className="text-[9px] bg-amber-500/10 text-amber-600 px-1.5 py-0.5 rounded font-bold uppercase tracking-wider inline-block">
                                        Nuevo equipo
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td className="p-3">
                                  <input
                                    type="text"
                                    value={g.field}
                                    onChange={(e) => handleUpdateParsedGame(g.id, { field: e.target.value })}
                                    className="bg-transparent border-b border-transparent hover:border-slate-300 focus:border-indigo-500 focus:outline-none w-full text-slate-600 dark:text-slate-300"
                                  />
                                </td>
                                <td className="p-3">
                                  <input
                                    type="date"
                                    value={g.dateStr}
                                    onChange={(e) => handleUpdateParsedGame(g.id, { dateStr: e.target.value })}
                                    className="bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 text-[11px]"
                                  />
                                </td>
                                <td className="p-3">
                                  <input
                                    type="time"
                                    value={g.timeStr}
                                    onChange={(e) => handleUpdateParsedGame(g.id, { timeStr: e.target.value })}
                                    className="bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 text-[11px] font-bold"
                                  />
                                </td>
                                <td className="p-3 text-right">
                                  <button
                                    onClick={() => handleDeleteParsedGame(g.id)}
                                    className="p-1 text-slate-400 hover:text-red-500 rounded-lg transition-colors cursor-pointer"
                                    title="Descartar partido"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* VIEW MODE: VISUAL COLUMN MAPPER & RAW SHEET INSPECTOR */}
              {viewMode === 'mapper' && (
                <div className="space-y-6">
                  {/* Sheet Selector Tabs */}
                  {rawSheets.length > 1 && (
                    <div className="flex items-center gap-2 overflow-x-auto pb-1 border-b border-slate-200 dark:border-slate-800">
                      <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Hojas de Excel:</span>
                      {rawSheets.map((sh, idx) => (
                        <button
                          key={sh.sheetName}
                          onClick={() => setSelectedSheetIndex(idx)}
                          className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${
                            selectedSheetIndex === idx
                              ? 'bg-indigo-600 text-white shadow-sm'
                              : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200'
                          }`}
                        >
                          {sh.sheetName} ({sh.rows.length} filas)
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Interactive Column Configuration */}
                  <div className="bg-slate-50 dark:bg-slate-800/40 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-4">
                    <div className="flex items-center gap-2">
                      <Sliders className="w-4 h-4 text-indigo-600" />
                      <h4 className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300">
                        Configurar Columnas para Hoja: <span className="text-indigo-600 font-bold">{currentSheet?.sheetName}</span>
                      </h4>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                      {/* Local Team Column */}
                      <div className="space-y-1">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider">
                          Columna Equipo Local (Casa)
                        </label>
                        <select
                          value={String(mapperHomeCol)}
                          onChange={(e) => setMapperHomeCol(e.target.value === 'vs_combined' ? 'vs_combined' : Number(e.target.value))}
                          className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs font-bold"
                        >
                          <option value="vs_combined">⚡ Ambas en 1 celda (Ej: Tigres vs Diablos)</option>
                          {Array.from({ length: maxCols }).map((_, i) => (
                            <option key={i} value={i}>Columna {colLetter(i)} (Col #{i + 1})</option>
                          ))}
                        </select>
                      </div>

                      {/* Away Team Column */}
                      {mapperHomeCol !== 'vs_combined' && (
                        <div className="space-y-1">
                          <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider">
                            Columna Equipo Visitante
                          </label>
                          <select
                            value={String(mapperAwayCol)}
                            onChange={(e) => setMapperAwayCol(Number(e.target.value))}
                            className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs font-bold"
                          >
                            {Array.from({ length: maxCols }).map((_, i) => (
                              <option key={i} value={i}>Columna {colLetter(i)} (Col #{i + 1})</option>
                            ))}
                          </select>
                        </div>
                      )}

                      {/* Jornada Column / Value */}
                      <div className="space-y-1">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider">
                          Jornada
                        </label>
                        <div className="flex items-center gap-2">
                          <select
                            value={String(mapperJornadaCol)}
                            onChange={(e) => setMapperJornadaCol(e.target.value === 'none' ? 'none' : Number(e.target.value))}
                            className="flex-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs font-bold"
                          >
                            <option value="none">Fijar Jornada manual 👉</option>
                            {Array.from({ length: maxCols }).map((_, i) => (
                              <option key={i} value={i}>Columna {colLetter(i)}</option>
                            ))}
                          </select>
                          {mapperJornadaCol === 'none' && (
                            <input
                              type="number"
                              min="1"
                              max="40"
                              value={mapperFixedJornada}
                              onChange={(e) => setMapperFixedJornada(parseInt(e.target.value) || 1)}
                              className="w-16 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-2 py-2 text-xs font-bold text-center"
                              title="Jornada para todos los partidos de esta hoja"
                            />
                          )}
                        </div>
                      </div>

                      {/* Category Selection */}
                      <div className="space-y-1">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider">
                          Categoría Asignada
                        </label>
                        <select
                          value={mapperCategory}
                          onChange={(e) => setMapperCategory(e.target.value as Category)}
                          className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs font-bold"
                        >
                          {CATEGORIES.map(cat => (
                            <option key={cat} value={cat}>{cat}</option>
                          ))}
                        </select>
                      </div>

                      {/* Field Column */}
                      <div className="space-y-1">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider">
                          Columna de Campo (Opcional)
                        </label>
                        <select
                          value={String(mapperFieldCol)}
                          onChange={(e) => setMapperFieldCol(e.target.value === 'none' ? 'none' : Number(e.target.value))}
                          className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs font-bold"
                        >
                          <option value="none">Por definir / Automático</option>
                          {Array.from({ length: maxCols }).map((_, i) => (
                            <option key={i} value={i}>Columna {colLetter(i)}</option>
                          ))}
                        </select>
                      </div>

                      {/* Time / Date Column */}
                      <div className="space-y-1">
                        <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider">
                          Columna Horario / Fecha (Opcional)
                        </label>
                        <select
                          value={String(mapperTimeCol)}
                          onChange={(e) => setMapperTimeCol(e.target.value === 'none' ? 'none' : Number(e.target.value))}
                          className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs font-bold"
                        >
                          <option value="none">Por definir / 08:00 AM</option>
                          {Array.from({ length: maxCols }).map((_, i) => (
                            <option key={i} value={i}>Columna {colLetter(i)}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-slate-200 dark:border-slate-700">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-slate-500 font-semibold">Comenzar desde la Fila:</span>
                        <input
                          type="number"
                          min="1"
                          max="20"
                          value={mapperStartRow + 1}
                          onChange={(e) => setMapperStartRow(Math.max(0, (parseInt(e.target.value) || 1) - 1))}
                          className="w-14 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1 text-xs font-bold text-center"
                        />
                        <span className="text-[10px] text-slate-400">(para saltar encabezados de título)</span>
                      </div>

                      <button
                        onClick={handleApplyMapper}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-xl text-xs font-bold shadow-md shadow-indigo-600/20 transition-all flex items-center gap-2 cursor-pointer"
                      >
                        <Sparkles className="w-4 h-4" />
                        <span>Extraer Partidos de esta Hoja</span>
                      </button>
                    </div>
                  </div>

                  {/* Raw Data Preview Grid (first 8 rows) */}
                  <div className="space-y-2">
                    <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider flex items-center gap-1.5">
                      <Eye className="w-3.5 h-3.5" />
                      Vista previa de filas en "{currentSheet?.sheetName}":
                    </span>
                    <div className="border border-slate-200 dark:border-slate-800 rounded-2xl overflow-x-auto shadow-inner bg-slate-50/50 dark:bg-slate-950/50">
                      <table className="w-full text-left border-collapse text-[11px]">
                        <thead>
                          <tr className="bg-slate-200/50 dark:bg-slate-800 text-[10px] font-black text-slate-500 uppercase tracking-widest border-b border-slate-200 dark:border-slate-700">
                            <th className="p-2 w-12 text-center">Fila</th>
                            {Array.from({ length: maxCols }).map((_, c) => (
                              <th key={c} className="p-2 border-l border-slate-200 dark:border-slate-700 min-w-[120px]">
                                Col {colLetter(c)}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200/50 dark:divide-slate-800 font-mono">
                          {currentSheet?.rows?.slice(0, 8).map((row, rIdx) => (
                            <tr key={rIdx} className={rIdx === mapperStartRow ? 'bg-indigo-50/60 dark:bg-indigo-950/30' : ''}>
                              <td className="p-2 text-center text-slate-400 font-bold bg-slate-100/50 dark:bg-slate-900">
                                {rIdx + 1}
                              </td>
                              {Array.from({ length: maxCols }).map((_, cIdx) => (
                                <td key={cIdx} className="p-2 border-l border-slate-200/50 dark:border-slate-800 truncate max-w-[200px] text-slate-700 dark:text-slate-300">
                                  {String(row[cIdx] !== undefined ? row[cIdx] : '')}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Modal Footer */}
        {file && importSuccessCount === null && (
          <div className="p-5 sm:p-6 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-slate-500">
              {parsedGames.length > 0 ? (
                <span>
                  <strong>{parsedGames.length} partidos</strong> listos para guardarse en el apartado de partidos.
                </span>
              ) : (
                <span>Usa el asistente de columnas arriba para extraer los juegos.</span>
              )}
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={() => { onClose(); handleReset(); }}
                className="px-5 py-2.5 rounded-xl font-bold text-xs text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                Cancelar
              </button>

              <button
                onClick={handleConfirmImport}
                disabled={importing || parsedGames.length === 0}
                className="bg-emerald-600 hover:bg-emerald-700 text-white px-7 py-2.5 rounded-xl font-bold text-xs shadow-lg shadow-emerald-600/20 active:scale-95 transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {importing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Guardando partidos...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Guardar y Agregar {parsedGames.length} Partidos</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}
