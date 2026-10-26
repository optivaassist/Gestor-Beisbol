import React, { useState, useEffect, useRef } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Game, GameBoxScoreData, TeamBoxScore, BoxScoreBatter, UserProfile, formatFieldName, Player } from '../types';
import { useTeams } from '../context/TeamsContext';
import { motion, AnimatePresence } from 'motion/react';
import {
  BookOpen,
  Upload,
  Download,
  X,
  Loader2,
  Sparkles,
  Edit3,
  Check,
  RefreshCw,
  Columns,
  Image as ImageIcon,
  Table as TableIcon,
  AlertCircle,
  Save,
  Plus,
  Trash2,
  FileCheck,
  FileText,
  FileSpreadsheet,
  Users,
  CheckCircle2,
  Award,
  ArrowLeftRight,
  Ban
} from 'lucide-react';
import { fetchTeamRoster, reconcileBoxScore, mergeBoxScores, processScorebookFile, cleanFirestoreData, loadScorebookFile, deleteGameScorebookFiles, hasUploadedBooks, getUploadedSheetsCount, normalizeStr } from '../utils/scorebookUtils';
import { parseApiResponse } from '../utils/apiHelper';

interface ScorebookModalProps {
  game: Game;
  isJefe: boolean;
  userProfile?: UserProfile | null;
  onClose: () => void;
  onUploadBook?: (gameId: string, file: File) => Promise<void>;
  isUploading?: boolean;
}

export default function ScorebookModal({
  game,
  isJefe,
  userProfile,
  onClose,
  onUploadBook,
  isUploading = false,
}: ScorebookModalProps) {
  const [viewMode, setViewMode] = useState<'split' | 'boxscore' | 'image'>(
    game.boxScore ? 'boxscore' : 'image'
  );
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [savingBoxScore, setSavingBoxScore] = useState(false);
  const [activeTeamIdx, setActiveTeamIdx] = useState(0);

  // Local editable copy of box score
  const [editableBoxScore, setEditableBoxScore] = useState<GameBoxScoreData | null>(
    game.boxScore || null
  );
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [activeSheetKey, setActiveSheetKey] = useState<string>(() => {
    if (game.scorebooks?.awayBatting) return 'awayBatting';
    if (game.scorebooks?.homeBatting) return 'homeBatting';
    return 'default';
  });
  const [activeStatsTab, setActiveStatsTab] = useState<'batting' | 'pitching'>('batting');
  const [loadedFileUrl, setLoadedFileUrl] = useState<string | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);

  // Quick batter adjustment modal state
  const [adjustingModal, setAdjustingModal] = useState<{
    teamIdx: number;
    batterIdx: number;
    batter: BoxScoreBatter;
    originalIdentity?: {
      playerId?: string;
      name: string;
      playerNumber?: string;
      position?: string;
    };
  } | null>(null);
  const [adjustSuccessToast, setAdjustSuccessToast] = useState<string | null>(null);
  const [savingAdjust, setSavingAdjust] = useState(false);

  // Official cédula team rosters for dropdown assignment
  const { teams } = useTeams();
  const [homeRoster, setHomeRoster] = useState<Player[]>([]);
  const [awayRoster, setAwayRoster] = useState<Player[]>([]);
  const [loadingRosters, setLoadingRosters] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const loadRosters = async () => {
      setLoadingRosters(true);
      try {
        const [home, away] = await Promise.all([
          fetchTeamRoster(game.homeTeamId, game.homeTeamName, teams),
          fetchTeamRoster(game.awayTeamId, game.awayTeamName, teams),
        ]);
        if (isMounted) {
          setHomeRoster(home);
          setAwayRoster(away);
        }
      } catch (err) {
        console.error('Error fetching rosters for ScorebookModal:', err);
      } finally {
        if (isMounted) setLoadingRosters(false);
      }
    };
    loadRosters();
    return () => {
      isMounted = false;
    };
  }, [game.id, game.homeTeamId, game.awayTeamId, game.homeTeamName, game.awayTeamName, teams]);

  const getTeamRoster = (teamIdx: number) => {
    if (!editableBoxScore || !editableBoxScore.teams || !editableBoxScore.teams[teamIdx]) {
      return {
        roster: homeRoster,
        teamName: game.homeTeamName,
        otherRoster: awayRoster,
        otherTeamName: game.awayTeamName,
      };
    }
    const t = editableBoxScore.teams[teamIdx];
    const tType = t.teamType;
    const isAway =
      tType === 'away' ||
      (tType !== 'home' &&
        (normalizeStr(t.teamName).includes(normalizeStr(game.awayTeamName)) ||
         normalizeStr(game.awayTeamName).includes(normalizeStr(t.teamName))));

    if (isAway) {
      return {
        roster: awayRoster,
        teamName: game.awayTeamName || t.teamName,
        otherRoster: homeRoster,
        otherTeamName: game.homeTeamName,
      };
    } else {
      return {
        roster: homeRoster,
        teamName: game.homeTeamName || t.teamName,
        otherRoster: awayRoster,
        otherTeamName: game.awayTeamName,
      };
    }
  };

  const handleDeleteBook = async () => {
    setDeleting(true);
    try {
      // 1. Delete all subcollection files in games/{game.id}/scorebook_files
      await deleteGameScorebookFiles(game.id);

      // 2. Completely clean the game document
      await updateDoc(doc(db, 'games', game.id), {
        bookImageUrl: '',
        bookFileName: '',
        bookFileType: null,
        bookUploadedAt: null,
        bookUploadedBy: null,
        boxScore: null,
        pitchingBoxScore: null,
        scorebooks: null,
        winningPitcher: null,
        losingPitcher: null,
        savePitcher: null,
        homeRuns: null,
      });

      setLoadedFileUrl(null);
      setEditableBoxScore(null);
      onClose();
    } catch (err: any) {
      console.error('Error deleting scorebook:', err);
      setAnalysisError('Error al borrar los libros del partido.');
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Synchronize when game prop changes
  useEffect(() => {
    if (game.boxScore) {
      setEditableBoxScore(game.boxScore);
    }
  }, [game.boxScore]);

  // Load full scorebook file from dedicated subcollection
  useEffect(() => {
    let isMounted = true;
    const fetchScorebook = async () => {
      setLoadingFile(true);
      try {
        const url = await loadScorebookFile(game.id, activeSheetKey);
        if (isMounted) {
          if (url) {
            setLoadedFileUrl(url);
          } else if (game.bookImageUrl && game.bookImageUrl.startsWith('data:')) {
            setLoadedFileUrl(game.bookImageUrl);
          } else {
            const defUrl = await loadScorebookFile(game.id, 'default');
            if (isMounted) setLoadedFileUrl(defUrl || null);
          }
        }
      } catch (err) {
        console.warn('Error loading scorebook file from subcollection:', err);
      } finally {
        if (isMounted) setLoadingFile(false);
      }
    };
    fetchScorebook();
    return () => { isMounted = false; };
  }, [game.id, activeSheetKey]);

  const activeDocumentUrl = loadedFileUrl || (game.bookImageUrl && game.bookImageUrl.length > 5 ? game.bookImageUrl : null);

  // Trigger analysis with Gemini via /api/analyze-scorebook
  const handleAnalyzeWithAI = async (customImage?: string) => {
    const targetImage = customImage || activeDocumentUrl;
    if (!targetImage) {
      setAnalysisError('No hay imagen o archivo cargado para analizar.');
      return;
    }

    setAnalyzing(true);
    setAnalysisError(null);

    try {
      // 1. Fetch official cédula rosters for both teams
      const [homeRoster, awayRoster] = await Promise.all([
        fetchTeamRoster(game.homeTeamId, game.homeTeamName),
        fetchTeamRoster(game.awayTeamId, game.awayTeamName)
      ]);

      const targetTeamType: 'away' | 'home' | undefined =
        activeSheetKey === 'awayBatting' || activeSheetKey === 'awayPitching'
          ? 'away'
          : activeSheetKey === 'homeBatting' || activeSheetKey === 'homePitching'
          ? 'home'
          : undefined;

      const response = await fetch('/api/analyze-scorebook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          image: targetImage,
          fileName: game.bookFileName || 'scorebook',
          homeTeamName: game.homeTeamName,
          awayTeamName: game.awayTeamName,
          homeRoster: homeRoster.map(p => ({ id: p.id, name: p.name, number: p.number, position: p.position, notes: p.notes })),
          awayRoster: awayRoster.map(p => ({ id: p.id, name: p.name, number: p.number, position: p.position, notes: p.notes })),
          targetTeamType,
        }),
      });

      const result = await parseApiResponse(response, 'Error al procesar el libro con IA');

      let boxScoreData: GameBoxScoreData = {
        teams: result.data.teams || [],
        detectedAt: new Date().toISOString(),
        detectedBy: userProfile?.displayName || userProfile?.email || 'Jefe de Categoría',
        generalNotes: result.data.generalNotes || '',
        finalScore: result.data.finalScore || undefined,
        winningPitcher: result.data.winningPitcher?.name || undefined,
        losingPitcher: result.data.losingPitcher?.name || undefined,
        savePitcher: result.data.savePitcher?.name || undefined,
      };

      // Guaranteed reconciliation with 100% of cédula players
      boxScoreData = reconcileBoxScore(
        boxScoreData,
        game.homeTeamName,
        game.awayTeamName,
        homeRoster,
        awayRoster
      );

      // Merge with existing box score so re-analyzing one sheet never wipes out the other team!
      boxScoreData = mergeBoxScores(editableBoxScore || game.boxScore, boxScoreData, targetTeamType);

      const updatePayload: Record<string, any> = {
        boxScore: cleanFirestoreData(boxScoreData),
      };

      // 1. Final score extraction
      const extScore = result.data.finalScore;
      if (
        extScore &&
        typeof extScore.awayScore === 'number' &&
        typeof extScore.homeScore === 'number' &&
        extScore.awayScore >= 0 &&
        extScore.homeScore >= 0
      ) {
        updatePayload.score = {
          away: extScore.awayScore,
          home: extScore.homeScore,
        };
        updatePayload.status = 'completed';
      } else if (boxScoreData.teams) {
        const awayT = boxScoreData.teams.find(t => t.teamType === 'away');
        const homeT = boxScoreData.teams.find(t => t.teamType === 'home');
        if (awayT && homeT && (awayT.totals?.r > 0 || homeT.totals?.r > 0)) {
          updatePayload.score = {
            away: awayT.totals?.r || 0,
            home: homeT.totals?.r || 0,
          };
          updatePayload.status = 'completed';
        }
      }

      // 2. Winning pitcher extraction
      const extWin = result.data.winningPitcher?.name || boxScoreData.winningPitcher;
      if (extWin && extWin !== '-' && !extWin.toLowerCase().includes('no ident')) {
        updatePayload.winningPitcher = extWin;
      }
      if (result.data.losingPitcher?.name) {
        updatePayload.losingPitcher = result.data.losingPitcher.name;
      }
      if (result.data.savePitcher?.name) {
        updatePayload.savePitcher = result.data.savePitcher.name;
      }

      // Save into Firestore under game
      await updateDoc(doc(db, 'games', game.id), cleanFirestoreData(updatePayload));

      setEditableBoxScore(boxScoreData);
      setViewMode('boxscore');
      setIsEditing(false);
    } catch (err: any) {
      console.error('Error analyzing scorebook:', err);
      setAnalysisError(err.message || 'Error al analizar el libro de anotación.');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (onUploadBook) {
      await onUploadBook(game.id, file);
    }
    e.target.value = '';
  };

  // Recalculate totals for a team including HR and AVG
  const recalculateTeamTotals = (team: TeamBoxScore) => {
    const ab = team.batters.reduce((acc, b) => acc + (Number(b.ab) || 0), 0);
    const r = team.batters.reduce((acc, b) => acc + (Number(b.r) || 0), 0);
    const h = team.batters.reduce((acc, b) => acc + (Number(b.h) || 0), 0);
    const rbi = team.batters.reduce((acc, b) => acc + (Number(b.rbi) || 0), 0);
    const bb = team.batters.reduce((acc, b) => acc + (Number(b.bb) || 0), 0);
    const so = team.batters.reduce((acc, b) => acc + (Number(b.so) || 0), 0);
    const hr = team.batters.reduce((acc, b) => acc + (Number(b.hr) || 0), 0);
    const avgVal = ab > 0 ? (h / ab).toFixed(3).replace(/^0\./, '.') : '.000';

    return { ab, r, h, rbi, bb, so, hr, avg: avgVal };
  };

  // Direct assignment from roster with automatic player swap to prevent duplicates
  const handleAssignPlayerWithSwap = (
    teamIdx: number,
    batterIdx: number,
    selectedPlayer: { id: string; name: string; number?: string; position?: string }
  ) => {
    if (!editableBoxScore) return;
    const newTeams = [...editableBoxScore.teams];
    const targetTeam = { ...newTeams[teamIdx] };
    const targetBatters = [...targetTeam.batters];
    const currentBatter = targetBatters[batterIdx];
    if (!currentBatter) return;

    // Original identity of the row being edited
    const originalIdentity = {
      playerId: currentBatter.playerId || '',
      name: currentBatter.name,
      playerNumber: currentBatter.playerNumber || '',
      position: currentBatter.position || '',
    };

    // Find if another row in the same team has selectedPlayer
    const otherIdx = targetBatters.findIndex(
      (b, idx) =>
        idx !== batterIdx &&
        ((selectedPlayer.id && b.playerId === selectedPlayer.id) ||
          normalizeStr(b.name) === normalizeStr(selectedPlayer.name))
    );

    const formattedNumber = selectedPlayer.number
      ? (selectedPlayer.number.startsWith('#') ? selectedPlayer.number : `#${selectedPlayer.number}`)
      : currentBatter.playerNumber;

    if (otherIdx !== -1) {
      // SWAP: other row takes currentBatter's original identity, keeping all its existing stats intact
      const otherBatter = targetBatters[otherIdx];
      targetBatters[otherIdx] = {
        ...otherBatter,
        playerId: originalIdentity.playerId,
        name: originalIdentity.name,
        playerNumber: originalIdentity.playerNumber,
        position: originalIdentity.position || otherBatter.position,
      };
      setAdjustSuccessToast(`¡Intercambio realizado! ${selectedPlayer.name} y ${originalIdentity.name} intercambiaron posiciones conservando sus estadísticas.`);
      setTimeout(() => setAdjustSuccessToast(null), 4000);
    }

    // Current row takes selectedPlayer's identity, keeping all its stats intact
    targetBatters[batterIdx] = {
      ...currentBatter,
      playerId: selectedPlayer.id,
      name: selectedPlayer.name,
      playerNumber: formattedNumber,
      position: selectedPlayer.position || currentBatter.position,
    };

    targetTeam.batters = targetBatters;
    targetTeam.totals = recalculateTeamTotals(targetTeam);
    newTeams[teamIdx] = targetTeam;

    setEditableBoxScore({
      ...editableBoxScore,
      teams: newTeams,
    });
  };

  const handleBatterChange = (
    teamIdx: number,
    batterIdx: number,
    field: keyof BoxScoreBatter,
    value: any
  ) => {
    if (!editableBoxScore) return;

    const newTeams = [...editableBoxScore.teams];
    const targetTeam = { ...newTeams[teamIdx] };
    const targetBatters = [...targetTeam.batters];

    let updatedValue = value;
    if (['ab', 'r', 'h', 'rbi', 'bb', 'so', 'hr', 'order'].includes(field)) {
      updatedValue = Math.max(0, parseInt(value, 10) || 0);
    }

    const updatedBatter = {
      ...targetBatters[batterIdx],
      [field]: updatedValue,
    };

    // Auto-update batting line, AVG and HR if AB, H or HR change
    if (field === 'ab' || field === 'h') {
      const curAb = field === 'ab' ? updatedValue : updatedBatter.ab;
      const curH = field === 'h' ? updatedValue : updatedBatter.h;
      updatedBatter.battingLine = `de ${curAb}-${curH}`;
      updatedBatter.avg = curAb > 0 ? (curH / curAb).toFixed(3).replace(/^0\./, '.') : '.000';
    }

    if (field === 'hr') {
      const curHr = Number(updatedValue) || 0;
      if (curHr > 0 && !updatedBatter.extraNotes?.toUpperCase().includes('HR')) {
        updatedBatter.extraNotes = updatedBatter.extraNotes ? `${updatedBatter.extraNotes}, HR` : 'HR';
      }
    }

    if (field === 'name') {
      const typedName = String(value || '').trim();
      updatedBatter.name = typedName;
      if (typedName) {
        // If the typed name exactly matches another row in this team, swap them!
        const otherIdx = targetBatters.findIndex(
          (b, idx) => idx !== batterIdx && normalizeStr(b.name) === normalizeStr(typedName)
        );
        if (otherIdx !== -1) {
          const originalName = targetBatters[batterIdx].name;
          const otherBatter = targetBatters[otherIdx];
          targetBatters[otherIdx] = {
            ...otherBatter,
            name: originalName,
          };
          setAdjustSuccessToast(`¡Intercambio realizado! ${typedName} y ${originalName} intercambiaron posiciones.`);
          setTimeout(() => setAdjustSuccessToast(null), 4000);
        }
      }
    }

    if (field === 'battingLine') {
      const strVal = String(updatedValue || '').trim();
      const lower = strVal.toLowerCase();

      if (lower.includes('no jug')) {
        updatedBatter.battingLine = 'No jugó';
        updatedBatter.order = 0;
        updatedBatter.ab = 0;
        updatedBatter.h = 0;
        updatedBatter.r = 0;
        updatedBatter.rbi = 0;
        updatedBatter.bb = 0;
        updatedBatter.so = 0;
        updatedBatter.hr = 0;
        updatedBatter.avg = '.000';
        updatedBatter.extraNotes = '';
      } else if (lower.includes('dato no disponible') || lower.includes('no disponible')) {
        updatedBatter.ab = 0;
        updatedBatter.h = 0;
        updatedBatter.avg = '.000';
        updatedBatter.battingLine = 'Dato no disponible';
      } else if (lower.includes('no legible') || lower.includes('ilegible')) {
        updatedBatter.ab = 0;
        updatedBatter.h = 0;
        updatedBatter.avg = '.000';
        updatedBatter.battingLine = 'No legible';
      } else {
        const match = strVal.match(/(?:de\s+)?(\d+)\s*(?:[xX\-\/\*:\.]|por|a)\s*(\d+)/i);
        if (match) {
          let parsedAb = parseInt(match[1], 10) || 0;
          let parsedH = parseInt(match[2], 10) || 0;
          if (parsedH > parsedAb) {
            const temp = parsedAb;
            parsedAb = parsedH;
            parsedH = temp;
          }
          updatedBatter.ab = parsedAb;
          updatedBatter.h = parsedH;
          updatedBatter.avg = parsedAb > 0 ? (parsedH / parsedAb).toFixed(3).replace(/^0\./, '.') : '.000';
          if (!updatedBatter.order || updatedBatter.order === 0) {
            updatedBatter.order = batterIdx + 1;
          }
        }
      }
    }

    targetBatters[batterIdx] = updatedBatter;
    targetTeam.batters = targetBatters;
    targetTeam.totals = recalculateTeamTotals(targetTeam);
    newTeams[teamIdx] = targetTeam;

    setEditableBoxScore({
      ...editableBoxScore,
      teams: newTeams,
    });
  };

  const handleAddBatter = (teamIdx: number) => {
    if (!editableBoxScore) return;
    const newTeams = [...editableBoxScore.teams];
    const targetTeam = { ...newTeams[teamIdx] };
    const nextOrder = targetTeam.batters.length + 1;

    targetTeam.batters = [
      ...targetTeam.batters,
      {
        order: nextOrder,
        name: 'Nuevo Jugador',
        position: 'DH',
        battingLine: 'de 0-0',
        ab: 0,
        r: 0,
        h: 0,
        rbi: 0,
        bb: 0,
        so: 0,
        hr: 0,
        avg: '.000',
      },
    ];

    targetTeam.totals = recalculateTeamTotals(targetTeam);
    newTeams[teamIdx] = targetTeam;
    setEditableBoxScore({ ...editableBoxScore, teams: newTeams });
  };

  const handleRemoveBatter = (teamIdx: number, batterIdx: number) => {
    if (!editableBoxScore) return;
    const newTeams = [...editableBoxScore.teams];
    const targetTeam = { ...newTeams[teamIdx] };
    targetTeam.batters = targetTeam.batters.filter((_, idx) => idx !== batterIdx);
    targetTeam.totals = recalculateTeamTotals(targetTeam);
    newTeams[teamIdx] = targetTeam;
    setEditableBoxScore({ ...editableBoxScore, teams: newTeams });
  };

  const handleStartAdjusting = (teamIdx: number, batterIdx: number, batter: BoxScoreBatter) => {
    setAdjustingModal({
      teamIdx,
      batterIdx,
      batter: { ...batter },
      originalIdentity: {
        playerId: batter.playerId || '',
        name: batter.name,
        playerNumber: batter.playerNumber || '',
        position: batter.position || '',
      },
    });
  };

  const handleAdjustFieldChange = (field: keyof BoxScoreBatter, value: any) => {
    if (!adjustingModal) return;
    const cur = { ...adjustingModal.batter };

    if (field === 'battingLine') {
      const strVal = String(value || '').trim();
      const lower = strVal.toLowerCase();

      if (lower.includes('no jug')) {
        cur.battingLine = 'No jugó';
        cur.order = 0;
        cur.ab = 0;
        cur.h = 0;
        cur.r = 0;
        cur.rbi = 0;
        cur.bb = 0;
        cur.so = 0;
        cur.hr = 0;
        cur.avg = '.000';
        cur.extraNotes = '';
      } else if (lower.includes('dato no disponible') || lower.includes('no disponible')) {
        cur.ab = 0;
        cur.h = 0;
        cur.avg = '.000';
        cur.battingLine = 'Dato no disponible';
      } else if (lower.includes('no legible') || lower.includes('ilegible')) {
        cur.ab = 0;
        cur.h = 0;
        cur.avg = '.000';
        cur.battingLine = 'No legible';
      } else {
        cur.battingLine = value;
        const match = strVal.match(/(?:de\s+)?(\d+)\s*(?:[xX\-\/\*:\.]|por|a)\s*(\d+)/i);
        if (match) {
          let parsedAb = parseInt(match[1], 10) || 0;
          let parsedH = parseInt(match[2], 10) || 0;
          if (parsedH > parsedAb) {
            const temp = parsedAb;
            parsedAb = parsedH;
            parsedH = temp;
          }
          cur.ab = parsedAb;
          cur.h = parsedH;
          cur.avg = parsedAb > 0 ? (parsedH / parsedAb).toFixed(3).replace(/^0\./, '.') : '.000';
          if (!cur.order || cur.order === 0) {
            cur.order = adjustingModal.batterIdx + 1;
          }
        }
      }
    } else if (field === 'ab' || field === 'h') {
      const numVal = Math.max(0, parseInt(value, 10) || 0);
      cur[field] = numVal;
      const curAb = field === 'ab' ? numVal : cur.ab;
      const curH = field === 'h' ? numVal : cur.h;
      cur.battingLine = `de ${curAb}-${curH}`;
      cur.avg = curAb > 0 ? (curH / curAb).toFixed(3).replace(/^0\./, '.') : '.000';
      if (!cur.order || cur.order === 0) {
        cur.order = adjustingModal.batterIdx + 1;
      }
    } else if (['r', 'rbi', 'bb', 'so', 'hr', 'order'].includes(field)) {
      cur[field] = Math.max(0, parseInt(value, 10) || 0);
    } else {
      (cur as any)[field] = value;
    }

    setAdjustingModal({
      ...adjustingModal,
      batter: cur,
    });
  };

  const handleSaveBatterAdjustment = async () => {
    if (!adjustingModal || !editableBoxScore) return;
    setSavingAdjust(true);
    try {
      const { teamIdx, batterIdx, batter, originalIdentity } = adjustingModal;
      const newTeams = [...editableBoxScore.teams];
      const targetTeam = { ...newTeams[teamIdx] };
      const targetBatters = [...targetTeam.batters];

      const isDnp = 
        String(batter.battingLine || '').toLowerCase().includes('no jug') || 
        batter.battingLine === 'No jugó' ||
        batter.order === 0;

      const finalAb = isDnp ? 0 : Math.max(0, Number(batter.ab) || 0);
      const finalH = isDnp ? 0 : Math.max(0, Number(batter.h) || 0);
      const finalR = isDnp ? 0 : Math.max(0, Number(batter.r) || 0);
      const finalRbi = isDnp ? 0 : Math.max(0, Number(batter.rbi) || 0);
      const finalBb = isDnp ? 0 : Math.max(0, Number(batter.bb) || 0);
      const finalSo = isDnp ? 0 : Math.max(0, Number(batter.so) || 0);
      const finalHr = isDnp ? 0 : Math.max(0, Number(batter.hr) || 0);
      const finalAvg = !isDnp && finalAb > 0 ? (finalH / finalAb).toFixed(3).replace(/^0\./, '.') : '.000';
      const finalOrder = isDnp ? 0 : (batter.order ? Number(batter.order) : (batterIdx + 1));
      const finalNotes = isDnp ? '' : (batter.extraNotes || '');

      const finalBatter: BoxScoreBatter = {
        ...batter,
        battingLine: isDnp ? 'No jugó' : batter.battingLine,
        order: finalOrder,
        ab: finalAb,
        h: finalH,
        r: finalR,
        rbi: finalRbi,
        bb: finalBb,
        so: finalSo,
        hr: finalHr,
        avg: finalAvg,
        extraNotes: finalNotes,
      };

      // 1. Detect if the selected player is already assigned in another row of this team
      const otherIdx = targetBatters.findIndex(
        (b, idx) =>
          idx !== batterIdx &&
          ((finalBatter.playerId && b.playerId === finalBatter.playerId) ||
            normalizeStr(b.name) === normalizeStr(finalBatter.name))
      );

      let successMessage = `¡Ajustes de ${finalBatter.name} guardados correctamente!`;

      if (otherIdx !== -1 && originalIdentity) {
        // AUTOMATIC PLAYER SWAP:
        // The other row takes the original identity of batterIdx,
        // while preserving 100% of its own stats, turns, and performance.
        const otherBatter = targetBatters[otherIdx];
        targetBatters[otherIdx] = {
          ...otherBatter,
          playerId: originalIdentity.playerId || '',
          name: originalIdentity.name,
          playerNumber: originalIdentity.playerNumber || '',
          position: originalIdentity.position || otherBatter.position || '',
        };
        successMessage = `¡Intercambio realizado! ${finalBatter.name} y ${originalIdentity.name} intercambiaron posiciones conservando sus estadísticas.`;
      }

      targetBatters[batterIdx] = finalBatter;
      targetTeam.batters = targetBatters;
      targetTeam.totals = recalculateTeamTotals(targetTeam);
      newTeams[teamIdx] = targetTeam;

      const newBoxScoreData: GameBoxScoreData = {
        ...editableBoxScore,
        teams: newTeams,
        detectedAt: new Date().toISOString(),
        detectedBy: userProfile?.displayName || userProfile?.email || 'Jefe de Categoría',
      };

      const awayT = newTeams.find(t => t.teamType === 'away');
      const homeT = newTeams.find(t => t.teamType === 'home');
      const updatePayload: Record<string, any> = {
        boxScore: cleanFirestoreData(newBoxScoreData),
      };

      if (awayT && homeT) {
        updatePayload.score = {
          away: awayT.totals?.r || 0,
          home: homeT.totals?.r || 0,
        };
        updatePayload.status = 'completed';
      }

      await updateDoc(doc(db, 'games', game.id), cleanFirestoreData(updatePayload));

      setEditableBoxScore(newBoxScoreData);
      setAdjustingModal(null);
      setAdjustSuccessToast(successMessage);
      setTimeout(() => setAdjustSuccessToast(null), 4000);
    } catch (err: any) {
      console.error('Error saving batter adjustment:', err);
      handleFirestoreError(err, OperationType.UPDATE, `games/${game.id}`);
    } finally {
      setSavingAdjust(false);
    }
  };

  const handleSaveBoxScore = async () => {
    if (!editableBoxScore) return;
    setSavingBoxScore(true);
    try {
      // Ensure all teams and batters are sanitized (e.g. No jugó players strictly have 0 stats)
      const sanitizedTeams = editableBoxScore.teams.map(team => {
        const sanitizedBatters = team.batters.map(b => {
          const isDnp = 
            String(b.battingLine || '').toLowerCase().includes('no jug') || 
            b.battingLine === 'No jugó' || 
            b.order === 0;

          if (isDnp) {
            return {
              ...b,
              battingLine: 'No jugó',
              order: 0,
              ab: 0,
              h: 0,
              r: 0,
              rbi: 0,
              bb: 0,
              so: 0,
              hr: 0,
              avg: '.000',
              extraNotes: '',
            };
          }
          return b;
        });

        const updatedTeam = {
          ...team,
          batters: sanitizedBatters,
        };
        updatedTeam.totals = recalculateTeamTotals(updatedTeam);
        return updatedTeam;
      });

      const awayT = sanitizedTeams.find(t => t.teamType === 'away');
      const homeT = sanitizedTeams.find(t => t.teamType === 'home');
      const updatePayload: Record<string, any> = {
        boxScore: cleanFirestoreData({
          ...editableBoxScore,
          teams: sanitizedTeams,
          detectedAt: new Date().toISOString(),
          detectedBy: userProfile?.displayName || userProfile?.email || 'Jefe de Categoría',
        }),
      };
      // Keep game.score and status synchronized so «Partidos» section reflects final score
      if (awayT && homeT && (awayT.totals?.r > 0 || homeT.totals?.r > 0)) {
        updatePayload.score = {
          away: awayT.totals.r,
          home: homeT.totals.r,
        };
        updatePayload.status = 'completed';
      }
      if (editableBoxScore.winningPitcher && editableBoxScore.winningPitcher !== '-' && !editableBoxScore.winningPitcher.toLowerCase().includes('no ident')) {
        updatePayload.winningPitcher = editableBoxScore.winningPitcher;
      }
      if (editableBoxScore.losingPitcher && editableBoxScore.losingPitcher !== '-' && !editableBoxScore.losingPitcher.toLowerCase().includes('no ident')) {
        updatePayload.losingPitcher = editableBoxScore.losingPitcher;
      }
      await updateDoc(doc(db, 'games', game.id), cleanFirestoreData(updatePayload));
      setEditableBoxScore({
        ...editableBoxScore,
        teams: sanitizedTeams,
      });
      setIsEditing(false);
    } catch (err) {
      console.error('Error saving box score:', err);
      handleFirestoreError(err, OperationType.UPDATE, `games/${game.id}`);
    } finally {
      setSavingBoxScore(false);
    }
  };

  const currentTeam = editableBoxScore?.teams?.[activeTeamIdx] || editableBoxScore?.teams?.[0];

  const renderDocumentViewer = (url?: string | null, extraClass: string = "max-h-[68vh]") => {
    if (loadingFile) {
      return (
        <div className="flex flex-col items-center justify-center p-12 text-indigo-600 space-y-2">
          <Loader2 className="w-8 h-8 animate-spin" />
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Cargando documento del libro...</p>
        </div>
      );
    }

    if (!url) {
      return (
        <div className="text-center p-8 text-slate-400 space-y-2">
          <ImageIcon className="w-10 h-10 mx-auto mb-2 opacity-50" />
          <p className="text-xs uppercase font-bold tracking-wider">Sin documento del libro</p>
        </div>
      );
    }

    const isPdf = game.bookFileType === 'pdf' || url.startsWith('data:application/pdf') || game.bookFileName?.toLowerCase().endsWith('.pdf');
    const isExcel = game.bookFileType === 'excel' || url.includes('spreadsheet') || game.bookFileName?.toLowerCase().endsWith('.xlsx') || game.bookFileName?.toLowerCase().endsWith('.xls') || game.bookFileName?.toLowerCase().endsWith('.csv');

    if (isPdf) {
      return (
        <iframe
          src={url}
          title="Libro PDF"
          className="w-full h-full min-h-[480px] rounded-xl border border-slate-200 dark:border-slate-800"
        />
      );
    }

    if (isExcel) {
      return (
        <div className="flex flex-col items-center justify-center p-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl space-y-4 text-center max-w-sm">
          <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
            <FileSpreadsheet className="w-8 h-8" />
          </div>
          <div>
            <h4 className="font-bold text-sm text-slate-900 dark:text-white truncate max-w-xs">{game.bookFileName || 'Libro_Anotacion.xlsx'}</h4>
            <p className="text-xs text-slate-400">Hoja de cálculo Excel oficial del partido</p>
          </div>
          <a
            href={url}
            download={game.bookFileName || `libro_${game.awayTeamName}_vs_${game.homeTeamName}.xlsx`}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-emerald-600/20"
          >
            <Download className="w-4 h-4" />
            <span>Descargar Archivo Excel</span>
          </a>
        </div>
      );
    }

    return (
      <img
        src={url}
        alt="Libro de Anotación"
        className={`${extraClass} w-auto max-w-full rounded-xl object-contain shadow-md`}
      />
    );
  };

  return (
    <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-md z-50 flex items-center justify-center p-3 sm:p-4 lg:p-6">
      <motion.div
        initial={{ scale: 0.96, opacity: 0, y: 15 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.96, opacity: 0, y: 15 }}
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-4 sm:p-6 lg:p-7 max-w-6xl w-full space-y-4 shadow-2xl max-h-[92vh] flex flex-col text-slate-900 dark:text-white"
      >
        {/* Hidden file input for uploading scorebook */}
        <input
          type="file"
          ref={fileInputRef}
          accept="image/*,application/pdf,.pdf,.xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          className="hidden"
          onChange={handleFileChange}
        />

        {/* Modal Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-600/10 text-indigo-600 flex items-center justify-center">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg sm:text-xl font-black uppercase tracking-tight">
                  Libro de Anotación <span className="text-indigo-600">& Box Score</span>
                </h3>
                {editableBoxScore && (
                  <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-black uppercase tracking-wider">
                    <FileCheck className="w-3 h-3" />
                    Digitalizado con IA
                  </span>
                )}
              </div>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest truncate max-w-md">
                {game.awayTeamName} ({game.score?.away ?? 0}) vs ({game.score?.home ?? 0}) {game.homeTeamName} • {formatFieldName(game.field) || 'Campo Principal'}
              </p>
            </div>
          </div>

          {/* View Toggles & Actions */}
          <div className="flex flex-wrap items-center gap-2">
            {/* View Switchers */}
            <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
              <button
                type="button"
                onClick={() => setViewMode('boxscore')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  viewMode === 'boxscore'
                    ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-300 shadow-sm'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <TableIcon className="w-3.5 h-3.5" />
                <span>Box Score</span>
              </button>

              <button
                type="button"
                onClick={() => setViewMode('image')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  viewMode === 'image'
                    ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-300 shadow-sm'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <ImageIcon className="w-3.5 h-3.5" />
                <span>Foto Libro</span>
              </button>

              <button
                type="button"
                onClick={() => setViewMode('split')}
                className={`hidden lg:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  viewMode === 'split'
                    ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-300 shadow-sm'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
                title="Vista dividida: Comparar foto y box score lado a lado"
              >
                <Columns className="w-3.5 h-3.5" />
                <span>Dividido</span>
              </button>
            </div>

            {/* AI Analysis Button */}
            {(activeDocumentUrl || hasUploadedBooks(game)) && isJefe && (
              <button
                type="button"
                disabled={analyzing || isUploading || loadingFile}
                onClick={() => handleAnalyzeWithAI()}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all shadow-md shadow-indigo-600/20 active:scale-95 disabled:opacity-50"
                title="Escanear nombres, de cuánto a cuánto se fue, y generar el Box Score"
              >
                {analyzing ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Analizando con IA...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>{editableBoxScore ? 'Re-analizar con IA' : 'Generar Box Score con IA'}</span>
                  </>
                )}
              </button>
            )}

            {/* Delete Book Button (Borrar Libro) */}
            {isJefe && (activeDocumentUrl || hasUploadedBooks(game)) && (
              <button
                type="button"
                disabled={deleting}
                onClick={() => setConfirmDelete(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/30 rounded-xl text-xs font-bold transition-all cursor-pointer active:scale-95"
                title="Borrar los libros de anotación de este partido"
              >
                <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                <span>Borrar Libro</span>
              </button>
            )}

            {/* Download Image Button */}
            {activeDocumentUrl && (
              <a
                href={activeDocumentUrl}
                download={game.bookFileName || `libro_${game.awayTeamName}_vs_${game.homeTeamName}.${game.bookFileType === 'pdf' ? 'pdf' : game.bookFileType === 'excel' ? 'xlsx' : 'jpg'}`}
                className="p-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-xl transition-all"
                title="Descargar archivo del libro"
              >
                <Download className="w-4 h-4" />
              </a>
            )}

            {/* Close Button */}
            <button
              onClick={onClose}
              className="p-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 rounded-xl transition-all"
              title="Cerrar"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Error Alert if any */}
        {analysisError && (
          <div className="p-3.5 bg-rose-500/10 border border-rose-500/20 rounded-2xl flex flex-wrap items-center justify-between gap-3 text-xs text-rose-600 dark:text-rose-400 font-medium">
            <div className="flex items-center gap-2.5 flex-1 min-w-[240px]">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-500" />
              <span>{analysisError}</span>
            </div>
            <div className="flex items-center gap-2">
              {(activeDocumentUrl || hasUploadedBooks(game)) && (
                <button
                  type="button"
                  onClick={() => handleAnalyzeWithAI()}
                  disabled={analyzing}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-bold transition-all shadow-sm disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${analyzing ? 'animate-spin' : ''}`} />
                  <span>{analyzing ? 'Reintentando...' : 'Reintentar Ahora'}</span>
                </button>
              )}
              <button
                onClick={() => setAnalysisError(null)}
                className="text-rose-400 hover:text-rose-600 p-1 rounded-lg"
                title="Cerrar aviso"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Match Result & Winning Pitcher Summary Banner */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700/60 rounded-2xl text-xs shrink-0">
          <div className="flex items-center gap-3">
            <span className="font-black text-slate-400 uppercase text-[10px] tracking-wider">Marcador Oficial:</span>
            <div className="flex items-center gap-2 font-black text-slate-900 dark:text-white">
              <span className="text-slate-700 dark:text-slate-300">{game.awayTeamName}</span>
              <span className="px-2 py-0.5 rounded-lg bg-indigo-600 text-white font-black text-xs">
                {game.score?.away ?? 0}
              </span>
              <span className="text-slate-400 font-bold">-</span>
              <span className="px-2 py-0.5 rounded-lg bg-indigo-600 text-white font-black text-xs">
                {game.score?.home ?? 0}
              </span>
              <span className="text-slate-700 dark:text-slate-300">{game.homeTeamName}</span>
            </div>
            {game.status === 'completed' && (
              <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 font-black text-[10px] uppercase">
                Finalizado
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-4 text-xs">
            {game.winningPitcher ? (
              <span className="flex items-center gap-1.5">
                <Award className="w-3.5 h-3.5 text-amber-500" />
                <span className="text-slate-400 font-bold uppercase text-[10px]">Pitcher Ganador:</span>
                <strong className="text-emerald-600 dark:text-emerald-400 font-bold">{game.winningPitcher}</strong>
              </span>
            ) : (
              <span className="text-slate-400 text-[10px] font-bold uppercase">
                Pitcher Ganador: <span className="italic">Pendiente de confirmar</span>
              </span>
            )}
            {game.losingPitcher && (
              <span className="flex items-center gap-1.5">
                <span className="text-slate-400 font-bold uppercase text-[10px]">Pitcher Perdedor:</span>
                <strong className="text-rose-500 font-bold">{game.losingPitcher}</strong>
              </span>
            )}
          </div>
        </div>

        {/* Modal Main Body */}
        <div className="flex-1 overflow-hidden flex flex-col min-h-0 space-y-3">
          {/* Sheet Selector (Las hojas del libro para ambos equipos) */}
          <div className="flex flex-wrap items-center gap-1.5 p-2 bg-slate-100 dark:bg-slate-800/80 rounded-2xl shrink-0">
            <span className="text-[10px] font-black uppercase text-slate-400 px-2 tracking-wider">Hojas del Libro:</span>
            {[
              { key: 'awayBatting', label: `⚾ 1. Bateo ${game.awayTeamName} (Visitante)`, exists: Boolean(game.scorebooks?.awayBatting), teamType: 'away' },
              { key: 'homeBatting', label: `⚾ 2. Bateo ${game.homeTeamName} (Local)`, exists: Boolean(game.scorebooks?.homeBatting), teamType: 'home' },
              { key: 'awayPitching', label: `3. Pitcheo ${game.awayTeamName}`, exists: Boolean(game.scorebooks?.awayPitching), teamType: 'away' },
              { key: 'homePitching', label: `4. Pitcheo ${game.homeTeamName}`, exists: Boolean(game.scorebooks?.homePitching), teamType: 'home' },
            ].filter(sheet => sheet.exists || sheet.key === 'awayBatting' || sheet.key === 'homeBatting' || activeSheetKey === sheet.key).map(sheet => {
              const isSelected = activeSheetKey === sheet.key;
              return (
                <button
                  key={sheet.key}
                  type="button"
                  onClick={() => {
                    setActiveSheetKey(sheet.key);
                    if (editableBoxScore?.teams) {
                      const idx = editableBoxScore.teams.findIndex(t => t.teamType === sheet.teamType);
                      if (idx !== -1) setActiveTeamIdx(idx);
                    }
                  }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
                    isSelected
                      ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/30'
                      : 'bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600'
                  }`}
                >
                  <span>{sheet.label}</span>
                  {sheet.exists ? (
                    <span className="flex items-center gap-1 px-1.5 py-0.5 text-[9px] rounded-md bg-emerald-500/20 text-emerald-600 dark:text-emerald-300 font-black">
                      <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                      Subido
                    </span>
                  ) : (
                    <span className="text-[9px] text-amber-500 font-bold px-1.5 py-0.5 rounded-md bg-amber-500/10">
                      Pendiente
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {viewMode === 'split' ? (
            /* Split View: Photo Left, Box Score Right */
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 h-full overflow-hidden">
              <div className="h-full overflow-auto rounded-2xl bg-slate-950/5 dark:bg-slate-950/40 p-2 border border-slate-100 dark:border-slate-800 flex items-center justify-center">
                {renderDocumentViewer(activeDocumentUrl, "max-h-[68vh]")}
              </div>

              <div className="h-full overflow-y-auto pr-1">
                {renderBoxScoreContent()}
              </div>
            </div>
          ) : viewMode === 'boxscore' ? (
            /* Box Score View */
            <div className="h-full overflow-y-auto pr-1">
              {renderBoxScoreContent()}
            </div>
          ) : (
            /* Document / Photo View */
            <div className="flex-1 overflow-auto rounded-2xl bg-slate-950/5 dark:bg-slate-950/50 p-3 flex items-center justify-center min-h-[350px]">
              {activeDocumentUrl || loadingFile ? (
                renderDocumentViewer(activeDocumentUrl, "max-h-[70vh]")
              ) : (
                <div className="text-center space-y-3 p-8">
                  <ImageIcon className="w-12 h-12 text-slate-400 mx-auto" />
                  <p className="text-sm font-bold text-slate-500 uppercase tracking-wider">
                    No hay imagen o documento cargado para este partido
                  </p>
                  {isJefe && (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all shadow-md shadow-indigo-600/20"
                    >
                      <Upload className="w-4 h-4" />
                      <span>Subir Libro (Foto, PDF o Excel)</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer Info */}
        <div className="flex flex-wrap items-center justify-between text-[11px] font-bold text-slate-400 uppercase tracking-widest pt-2 border-t border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <span>Fecha: {new Date(game.date).toLocaleDateString()}</span>
            {game.bookUploadedBy && (
              <span>
                Libro cargado por: <strong className="text-slate-700 dark:text-slate-200">{game.bookUploadedBy}</strong>
              </span>
            )}
          </div>
          {editableBoxScore?.detectedAt && (
            <span>
              Último análisis: {new Date(editableBoxScore.detectedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
      </motion.div>

      {/* Confirm Delete Book Modal */}
      <AnimatePresence>
        {confirmDelete && (
          <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[70] flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 max-w-sm w-full space-y-4 text-center shadow-2xl"
            >
              <div className="w-14 h-14 bg-rose-500/10 text-rose-500 rounded-2xl flex items-center justify-center mx-auto">
                <Trash2 className="w-7 h-7" />
              </div>
              <div className="space-y-1">
                <h4 className="text-base font-black uppercase tracking-tight text-slate-900 dark:text-white">
                  ¿Borrar Libros de Anotación?
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Se eliminarán todos los libros cargados y las estadísticas digitalizadas de este partido.
                </p>
              </div>
              <div className="flex gap-2.5 pt-2">
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => setConfirmDelete(false)}
                  className="flex-1 px-4 py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold transition-all cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={deleting}
                  onClick={handleDeleteBook}
                  className="flex-1 px-4 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all shadow-md shadow-rose-600/20 active:scale-95 cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  {deleting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Borrando...</span>
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Sí, Borrar</span>
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Toast Notification for Adjustment */}
      <AnimatePresence>
        {adjustSuccessToast && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-12 left-1/2 -translate-x-1/2 z-[90] flex items-center gap-3 bg-emerald-600 text-white px-5 py-3 rounded-2xl shadow-2xl text-xs font-bold"
          >
            <CheckCircle2 className="w-4 h-4 text-emerald-100" />
            <span>{adjustSuccessToast}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modal: Ajustar Manualmente Jugador / Captura */}
      <AnimatePresence>
        {adjustingModal && (
          <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-[85] flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 15 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 15 }}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 sm:p-7 max-w-xl w-full shadow-2xl space-y-5 text-slate-900 dark:text-white max-h-[92vh] overflow-y-auto"
            >
              {/* Header */}
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-indigo-600/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shadow-inner">
                    <Edit3 className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-base sm:text-lg font-black uppercase tracking-tight">
                      Ajustar Captura de Jugador
                    </h3>
                    <p className="text-xs text-slate-400 font-bold uppercase tracking-wider">
                      {editableBoxScore?.teams[adjustingModal.teamIdx]?.teamName || 'Equipo'} • Orden #{adjustingModal.batter.order || adjustingModal.batterIdx + 1}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setAdjustingModal(null)}
                  className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Instructions badge */}
              <div className="p-3 bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800/60 rounded-2xl text-xs space-y-1 text-indigo-900 dark:text-indigo-200">
                <p className="font-bold">Ajuste manual de captura o corrección de datos no legibles</p>
                <p className="text-[11px] opacity-90 leading-relaxed">
                  Puedes corregir el nombre, dorsal, posición y la anotación de pluma (ej. 2x0, 3x1, Dato no disponible). Las estadísticas se sincronizan automáticamente.
                </p>
              </div>

              {/* Form fields */}
              <div className="space-y-4 text-xs">
                {/* Roster Dropdown: Seleccionar jugador de la cédula oficial */}
                {(() => {
                  const { roster: teamRoster, teamName: currentTName, otherRoster, otherTeamName: otherTName } = getTeamRoster(adjustingModal.teamIdx);
                  const sortedRoster = [...teamRoster].sort((a, b) => a.name.localeCompare(b.name));
                  const sortedOther = [...otherRoster].sort((a, b) => a.name.localeCompare(b.name));

                  const matchedInTeam = teamRoster.find(p => 
                    (adjustingModal.batter.playerId && p.id === adjustingModal.batter.playerId) ||
                    normalizeStr(p.name) === normalizeStr(adjustingModal.batter.name)
                  );
                  const matchedInOther = !matchedInTeam && otherRoster.find(p => 
                    (adjustingModal.batter.playerId && p.id === adjustingModal.batter.playerId) ||
                    normalizeStr(p.name) === normalizeStr(adjustingModal.batter.name)
                  );
                  const currentSelectedId = matchedInTeam?.id || matchedInOther?.id || adjustingModal.batter.playerId || '';

                  return (
                    <div className="space-y-2.5 p-4 bg-gradient-to-br from-indigo-50/90 via-slate-50 to-blue-50/60 dark:from-indigo-950/40 dark:via-slate-900/50 dark:to-slate-800/50 border-2 border-indigo-200 dark:border-indigo-800/80 rounded-2xl shadow-sm">
                      <div className="flex items-center justify-between">
                        <label className="flex items-center gap-2 font-black text-indigo-900 dark:text-indigo-200 uppercase text-xs tracking-wider">
                          <Users className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                          <span>Asignar Jugador del Roster Oficial</span>
                        </label>
                        {loadingRosters ? (
                          <span className="flex items-center gap-1.5 text-[10px] text-indigo-600 dark:text-indigo-400 font-bold">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            <span>Cargando cédula...</span>
                          </span>
                        ) : (
                          <span className="text-[10px] font-black uppercase tracking-wider text-indigo-600 dark:text-indigo-400 bg-indigo-100/80 dark:bg-indigo-900/60 px-2 py-0.5 rounded-md">
                            {teamRoster.length} en roster ({currentTName})
                          </span>
                        )}
                      </div>

                      <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-snug">
                        Si en el libro la letra es confusa o el sistema asignó los turnos al jugador equivocado, despliega y selecciona aquí al jugador correcto:
                      </p>

                      <div className="relative">
                        <select
                          value={currentSelectedId}
                          onChange={(e) => {
                            const selectedId = e.target.value;
                            if (!selectedId) return;
                            const chosen = [...teamRoster, ...otherRoster].find(p => p.id === selectedId);
                            if (chosen) {
                              setAdjustingModal(prev => prev ? {
                                ...prev,
                                batter: {
                                  ...prev.batter,
                                  playerId: chosen.id,
                                  name: chosen.name,
                                  playerNumber: chosen.number ? (chosen.number.startsWith('#') ? chosen.number : `#${chosen.number}`) : prev.batter.playerNumber,
                                  position: chosen.position || prev.batter.position || ''
                                }
                              } : null);
                            }
                          }}
                          className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-800 border-2 border-indigo-400 dark:border-indigo-600 rounded-xl font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xs shadow-sm cursor-pointer"
                        >
                          <option value="">
                            {teamRoster.length > 0 
                              ? `-- Seleccionar jugador del roster (${currentTName} - ${teamRoster.length} jugadores) --`
                              : `-- No hay jugadores en cédula para ${currentTName} --`}
                          </option>

                          {teamRoster.length > 0 && (
                            <optgroup label={`⚾ Roster Oficial: ${currentTName} (${teamRoster.length} jugadores)`}>
                              {sortedRoster.map(p => {
                                const currentTeamBatters = editableBoxScore?.teams[adjustingModal.teamIdx]?.batters || [];
                                const assignedIdx = currentTeamBatters.findIndex(
                                  (b, idx) =>
                                    (b.playerId && b.playerId === p.id) ||
                                    normalizeStr(b.name) === normalizeStr(p.name)
                                );
                                const isHere = assignedIdx === adjustingModal.batterIdx;
                                const isOther = assignedIdx !== -1 && !isHere;
                                const suffix = isHere ? ' ✓ (Fila actual)' : isOther ? ` 🔄 (En fila ${assignedIdx + 1} - Intercambiar)` : '';

                                return (
                                  <option key={p.id} value={p.id}>
                                    {p.number ? `#${p.number.replace(/^#/, '')} - ` : ''}{p.name} {p.position ? `(${p.position})` : ''}{suffix}
                                  </option>
                                );
                              })}
                            </optgroup>
                          )}

                          {otherRoster.length > 0 && (
                            <optgroup label={`🔄 Roster del otro equipo: ${otherTName} (${otherRoster.length} jugadores)`}>
                              {sortedOther.map(p => {
                                const currentTeamBatters = editableBoxScore?.teams[adjustingModal.teamIdx]?.batters || [];
                                const assignedIdx = currentTeamBatters.findIndex(
                                  (b, idx) =>
                                    (b.playerId && b.playerId === p.id) ||
                                    normalizeStr(b.name) === normalizeStr(p.name)
                                );
                                const isHere = assignedIdx === adjustingModal.batterIdx;
                                const isOther = assignedIdx !== -1 && !isHere;
                                const suffix = isHere ? ' ✓ (Fila actual)' : isOther ? ` 🔄 (En fila ${assignedIdx + 1} - Intercambiar)` : '';

                                return (
                                  <option key={p.id} value={p.id}>
                                    {p.number ? `#${p.number.replace(/^#/, '')} - ` : ''}{p.name} {p.position ? `(${p.position})` : ''}{suffix}
                                  </option>
                                );
                              })}
                            </optgroup>
                          )}
                        </select>
                      </div>

                      {/* Detection of automatic swap if the selected player is currently on another row */}
                      {(() => {
                        const currentTeamBatters = editableBoxScore?.teams[adjustingModal.teamIdx]?.batters || [];
                        const otherAssignedRow = currentTeamBatters.map((b, idx) => ({ b, idx })).find(
                          item =>
                            item.idx !== adjustingModal.batterIdx &&
                            ((adjustingModal.batter.playerId && item.b.playerId === adjustingModal.batter.playerId) ||
                              normalizeStr(item.b.name) === normalizeStr(adjustingModal.batter.name))
                        );

                        if (!otherAssignedRow) return null;

                        return (
                          <div className="flex items-start gap-2.5 text-[11px] font-bold text-amber-900 dark:text-amber-200 bg-amber-100/90 dark:bg-amber-950/70 border-2 border-amber-400 dark:border-amber-600/80 p-3 rounded-xl shadow-sm">
                            <ArrowLeftRight className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                            <div>
                              <p className="font-black text-amber-900 dark:text-amber-200 uppercase tracking-wide">
                                🔄 Intercambio automático de jugadores activado
                              </p>
                              <p className="font-semibold text-amber-950 dark:text-amber-100 mt-0.5">
                                <strong>{adjustingModal.batter.name}</strong> ya está asignado en la <strong>fila #{otherAssignedRow.idx + 1}</strong>.
                              </p>
                              <p className="text-[10px] text-amber-800/90 dark:text-amber-300/90 mt-1">
                                Al guardar, las posiciones se intercambiarán automáticamente: esta fila quedará como <strong>{adjustingModal.batter.name}</strong> y la fila #{otherAssignedRow.idx + 1} pasará a ser <strong>{adjustingModal.originalIdentity?.name || 'el jugador anterior'}</strong>. Las estadísticas de cada fila se mantendrán intactas y no habrá nombres duplicados.
                              </p>
                            </div>
                          </div>
                        );
                      })()}

                      {/* Verification Status Banner */}
                      {matchedInTeam ? (
                        <div className="flex items-center gap-2 text-[11px] font-bold text-emerald-800 dark:text-emerald-200 bg-emerald-100/70 dark:bg-emerald-950/50 border border-emerald-300 dark:border-emerald-800/80 px-3 py-2 rounded-xl">
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                          <span>
                            Asignado a jugador de cédula: <strong className="underline">{matchedInTeam.name}</strong> {matchedInTeam.number ? `(#${matchedInTeam.number})` : ''} {matchedInTeam.position ? `• Pos: ${matchedInTeam.position}` : ''}
                          </span>
                        </div>
                      ) : matchedInOther ? (
                        <div className="flex items-center gap-2 text-[11px] font-bold text-blue-800 dark:text-blue-200 bg-blue-100/70 dark:bg-blue-950/50 border border-blue-300 dark:border-blue-800/80 px-3 py-2 rounded-xl">
                          <CheckCircle2 className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                          <span>
                            Asignado a jugador de <strong>{otherTName}</strong>: {matchedInOther.name}
                          </span>
                        </div>
                      ) : (
                        <div className="flex items-start gap-2 text-[11px] font-medium text-amber-900 dark:text-amber-200 bg-amber-100/70 dark:bg-amber-950/50 border border-amber-300 dark:border-amber-800/80 px-3 py-2 rounded-xl">
                          <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                          <div>
                            <p className="font-bold">El nombre actual ("{adjustingModal.batter.name}") no coincide con el roster oficial.</p>
                            <p className="text-[10px] opacity-90 mt-0.5">Elige arriba en el menú desplegable al jugador que le corresponden estos turnos al bat.</p>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Row 1: Nombre & Dorsal & Posicion */}
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                  <div className="sm:col-span-6 space-y-1">
                    <label className="font-bold text-slate-500 uppercase text-[10px] tracking-wider">
                      Nombre y Apellido
                    </label>
                    <input
                      type="text"
                      value={adjustingModal.batter.name}
                      onChange={(e) => {
                        const val = e.target.value;
                        setAdjustingModal(prev => prev ? {
                          ...prev,
                          batter: { ...prev.batter, name: val }
                        } : null);
                      }}
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xs"
                      placeholder="Nombre del jugador"
                    />
                  </div>

                  <div className="sm:col-span-3 space-y-1">
                    <label className="font-bold text-slate-500 uppercase text-[10px] tracking-wider">
                      Número / #
                    </label>
                    <input
                      type="text"
                      value={adjustingModal.batter.playerNumber || ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        setAdjustingModal(prev => prev ? {
                          ...prev,
                          batter: { ...prev.batter, playerNumber: val }
                        } : null);
                      }}
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-bold text-slate-900 dark:text-white text-center focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xs"
                      placeholder="#10"
                    />
                  </div>

                  <div className="sm:col-span-3 space-y-1">
                    <label className="font-bold text-slate-500 uppercase text-[10px] tracking-wider">
                      Posición
                    </label>
                    <input
                      type="text"
                      value={adjustingModal.batter.position || ''}
                      onChange={(e) => {
                        const val = e.target.value.toUpperCase();
                        setAdjustingModal(prev => prev ? {
                          ...prev,
                          batter: { ...prev.batter, position: val }
                        } : null);
                      }}
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-bold text-slate-900 dark:text-white text-center uppercase focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xs"
                      placeholder="P, C, 1B..."
                    />
                  </div>
                </div>

                {/* Row 2: De cuánto a cuánto (Pluma) + Presets */}
                <div className="space-y-1.5 p-3.5 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/60 rounded-2xl">
                  <div className="flex items-center justify-between">
                    <label className="font-black text-indigo-600 dark:text-indigo-400 uppercase text-[10px] tracking-wider">
                      Anotación de Pluma ("De cuánto a cuánto"):
                    </label>
                    <span className="text-[10px] text-slate-400">
                      Ej: 2x0 = 2 VB, 0 Hits
                    </span>
                  </div>
                  <input
                    type="text"
                    value={adjustingModal.batter.battingLine}
                    onChange={(e) => handleAdjustFieldChange('battingLine', e.target.value)}
                    className="w-full px-3 py-2 bg-white dark:bg-slate-900 border-2 border-indigo-500/30 rounded-xl font-black text-indigo-600 dark:text-indigo-400 focus:outline-none focus:border-indigo-500 text-sm"
                    placeholder="2x0, 3x1, Dato no disponible, No jugó..."
                  />

                  {/* Quick Preset Chips */}
                  <div className="flex flex-wrap items-center gap-1.5 pt-1.5">
                    <span className="text-[10px] font-bold text-slate-400 mr-1">Rápido:</span>
                    {['2x0', '2x1', '3x0', '3x1', '3x2', '4x0', '4x1', '4x2', 'Dato no disponible', 'No jugó'].map(preset => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => handleAdjustFieldChange('battingLine', preset)}
                        className={`px-2 py-0.5 rounded-lg text-[10px] font-black uppercase transition-all cursor-pointer ${
                          adjustingModal.batter.battingLine === preset
                            ? 'bg-indigo-600 text-white shadow-sm'
                            : 'bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600 hover:border-indigo-500'
                        }`}
                      >
                        {preset}
                      </button>
                    ))}
                  </div>

                  {/* Status Banner & One-Click Toggle for "No jugó" / "Jugó" */}
                  {(() => {
                    const isDnp = adjustingModal.batter.battingLine === 'No jugó' || adjustingModal.batter.order === 0 || String(adjustingModal.batter.battingLine || '').toLowerCase().includes('no jug');
                    if (isDnp) {
                      return (
                        <div className="flex items-center justify-between p-2.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-300 dark:border-rose-800 rounded-xl mt-2">
                          <div className="flex items-center gap-2">
                            <Ban className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
                            <span className="text-xs font-black text-rose-700 dark:text-rose-300">
                              Marcado como «No jugó» (Todas las estadísticas en 0)
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleAdjustFieldChange('battingLine', 'de 0-0')}
                            className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-[10px] font-black uppercase transition-colors cursor-pointer shadow-sm"
                          >
                            ⚾ Cambiar a «Jugó»
                          </button>
                        </div>
                      );
                    }
                    return (
                      <div className="flex items-center justify-between p-2 bg-slate-100/90 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl mt-2">
                        <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                          ¿El jugador no vio acción en este partido?
                        </span>
                        <button
                          type="button"
                          onClick={() => handleAdjustFieldChange('battingLine', 'No jugó')}
                          className="px-2.5 py-1 bg-white hover:bg-rose-50 dark:bg-slate-700 dark:hover:bg-rose-950/50 text-rose-600 dark:text-rose-400 border border-rose-300 dark:border-rose-800/60 rounded-lg text-[10px] font-black uppercase transition-colors cursor-pointer shadow-sm"
                        >
                          🚫 Establecer «No jugó» (Ceros)
                        </button>
                      </div>
                    );
                  })()}
                </div>

                {/* Row 3: Numeric Stats Grid */}
                <div className="grid grid-cols-4 sm:grid-cols-7 gap-2 text-center">
                  <div className="space-y-1">
                    <label className="font-bold text-slate-500 text-[10px] uppercase">VB (AB)</label>
                    <input
                      type="number"
                      min="0"
                      value={adjustingModal.batter.ab}
                      onChange={(e) => handleAdjustFieldChange('ab', e.target.value)}
                      className="w-full px-2 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-black text-center text-xs"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="font-bold text-emerald-600 text-[10px] uppercase">Hits (H)</label>
                    <input
                      type="number"
                      min="0"
                      value={adjustingModal.batter.h}
                      onChange={(e) => handleAdjustFieldChange('h', e.target.value)}
                      className="w-full px-2 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-black text-emerald-600 text-center text-xs"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="font-bold text-amber-600 text-[10px] uppercase">Carr (C)</label>
                    <input
                      type="number"
                      min="0"
                      value={adjustingModal.batter.r}
                      onChange={(e) => handleAdjustFieldChange('r', e.target.value)}
                      className="w-full px-2 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-black text-amber-600 text-center text-xs"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="font-bold text-indigo-600 text-[10px] uppercase">CI (RBI)</label>
                    <input
                      type="number"
                      min="0"
                      value={adjustingModal.batter.rbi}
                      onChange={(e) => handleAdjustFieldChange('rbi', e.target.value)}
                      className="w-full px-2 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-black text-indigo-600 text-center text-xs"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="font-bold text-amber-500 text-[10px] uppercase">Jonrón (HR)</label>
                    <input
                      type="number"
                      min="0"
                      value={adjustingModal.batter.hr || 0}
                      onChange={(e) => handleAdjustFieldChange('hr', e.target.value)}
                      className="w-full px-2 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-black text-amber-500 text-center text-xs"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="font-bold text-slate-500 text-[10px] uppercase">BB</label>
                    <input
                      type="number"
                      min="0"
                      value={adjustingModal.batter.bb}
                      onChange={(e) => handleAdjustFieldChange('bb', e.target.value)}
                      className="w-full px-2 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-black text-slate-700 dark:text-slate-300 text-center text-xs"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="font-bold text-slate-500 text-[10px] uppercase">Ponches (K)</label>
                    <input
                      type="number"
                      min="0"
                      value={adjustingModal.batter.so}
                      onChange={(e) => handleAdjustFieldChange('so', e.target.value)}
                      className="w-full px-2 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-black text-slate-700 dark:text-slate-300 text-center text-xs"
                    />
                  </div>
                </div>

                {/* Row 4: Notas / Extrabase + chips */}
                <div className="space-y-1.5">
                  <label className="font-bold text-slate-500 uppercase text-[10px] tracking-wider">
                    Notas Extrabase (ej. 2B, 3B, BB, SAC F)
                  </label>
                  <input
                    type="text"
                    value={adjustingModal.batter.extraNotes || ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      setAdjustingModal(prev => prev ? {
                        ...prev,
                        batter: { ...prev.batter, extraNotes: val }
                      } : null);
                    }}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 text-xs"
                    placeholder="2B, 3B, HR, 2BB..."
                  />

                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <span className="text-[10px] font-bold text-slate-400 mr-1">Extrabases:</span>
                    {['2B', '3B', 'HR', 'BB', '2BB', '3BB', 'SAC F', 'Ponche'].map(tag => (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => {
                          const cur = adjustingModal.batter.extraNotes || '';
                          const next = cur ? (cur.includes(tag) ? cur : `${cur}, ${tag}`) : tag;
                          setAdjustingModal(prev => prev ? {
                            ...prev,
                            batter: { ...prev.batter, extraNotes: next }
                          } : null);
                        }}
                        className="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 cursor-pointer"
                      >
                        +{tag}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  disabled={savingAdjust}
                  onClick={() => setAdjustingModal(null)}
                  className="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={savingAdjust}
                  onClick={handleSaveBatterAdjustment}
                  className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all shadow-lg shadow-indigo-600/20 active:scale-95 cursor-pointer disabled:opacity-50"
                >
                  {savingAdjust ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Guardando...</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>Guardar Ajustes</span>
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );

  /* Helper function to render the digital Box Score */
  function renderBoxScoreContent() {
    if (!editableBoxScore || !editableBoxScore.teams || editableBoxScore.teams.length === 0) {
      return (
        <div className="h-full flex flex-col items-center justify-center p-8 text-center bg-slate-50 dark:bg-slate-800/30 border border-dashed border-slate-200 dark:border-slate-800 rounded-3xl space-y-4">
          <div className="w-14 h-14 rounded-3xl bg-indigo-600/10 text-indigo-600 flex items-center justify-center">
            <Sparkles className="w-7 h-7" />
          </div>
          <div className="max-w-md space-y-1">
            <h4 className="text-base font-black uppercase tracking-tight text-slate-900 dark:text-white">
              Box Score aún no generado
            </h4>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
              El sistema con inteligencia artificial puede leer la hoja de anotación manuscrita, detectar nombres de jugadores, turnos al bat y de cuánto a cuánto se fueron (ej: "de 4-2", "de 2-0").
            </p>
          </div>

          {(activeDocumentUrl || hasUploadedBooks(game)) && isJefe && (
            <button
              type="button"
              disabled={analyzing}
              onClick={() => handleAnalyzeWithAI()}
              className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl text-xs font-black uppercase tracking-wider transition-all shadow-lg shadow-indigo-600/20 active:scale-95"
            >
              {analyzing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Procesando imagen con IA...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>Generar Box Score Ahora</span>
                </>
              )}
            </button>
          )}

          {!activeDocumentUrl && !hasUploadedBooks(game) && (
            <p className="text-xs text-amber-500 font-bold uppercase tracking-wider">
              Primero sube una foto o escaneo del libro de anotación.
            </p>
          )}
        </div>
      );
    }

    return (
      <div className="space-y-4">
        {/* Team Tabs Selector (if multiple teams detected, e.g. Away and Home) */}
        <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50 dark:bg-slate-800/60 p-2.5 rounded-2xl border border-slate-100 dark:border-slate-800">
          <div className="flex flex-wrap items-center gap-2">
            {editableBoxScore.teams.map((team, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => {
                  setActiveTeamIdx(idx);
                  const targetSheet = team.teamType === 'away' ? 'awayBatting' : 'homeBatting';
                  if (game.scorebooks && game.scorebooks[targetSheet]) {
                    setActiveSheetKey(targetSheet);
                  }
                }}
                className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer ${
                  activeTeamIdx === idx
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
                    : 'bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-600'
                }`}
              >
                <span>{team.teamName || `Equipo ${idx + 1}`}</span>
                {team.totals?.avg && (
                  <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                    activeTeamIdx === idx ? 'bg-indigo-700 text-white' : 'bg-slate-100 dark:bg-slate-600 text-slate-600 dark:text-slate-300'
                  }`}>
                    AVG {team.totals.avg}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Edit / Save controls for Jefe */}
          {isJefe && (
            <div className="flex items-center gap-2">
              {isEditing ? (
                <>
                  <button
                    type="button"
                    onClick={() => handleAddBatter(activeTeamIdx)}
                    className="flex items-center gap-1 px-3 py-1.5 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-100 rounded-xl text-xs font-bold transition-all"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Agregar Bateador</span>
                  </button>
                  <button
                    type="button"
                    disabled={savingBoxScore}
                    onClick={handleSaveBoxScore}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all shadow-md shadow-emerald-600/20"
                  >
                    {savingBoxScore ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Save className="w-3.5 h-3.5" />
                    )}
                    <span>Guardar Cambios</span>
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsEditing(true)}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold transition-all"
                  title="Editar nombres o corregir estadísticas"
                >
                  <Edit3 className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                  <span>Editar Box Score</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Cédula status badge */}
        {currentTeam && (
          <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-slate-50 dark:bg-slate-800/50 rounded-xl text-xs">
            <div className="flex items-center gap-2">
              <Users className="w-3.5 h-3.5 text-indigo-600" />
              <span className="font-bold text-slate-700 dark:text-slate-300">
                Cédula oficial de {currentTeam.teamName}:
              </span>
              <span className="font-black text-indigo-600 dark:text-indigo-400">
                {currentTeam.batters.length}/{currentTeam.batters.length} jugadores en Box Score
              </span>
            </div>
            <div className="flex items-center gap-3 text-[11px] font-bold">
              <span className="text-emerald-600 dark:text-emerald-400">
                {currentTeam.batters.filter(b => b.battingLine !== 'No jugó' && b.order !== 0).length} alinearon
              </span>
              <span className="text-slate-300 dark:text-slate-700">•</span>
              <span className="text-slate-400">
                {currentTeam.batters.filter(b => b.battingLine === 'No jugó' || b.order === 0).length} No jugaron (0)
              </span>
            </div>
          </div>
        )}

        {/* Box Score Table */}
        {currentTeam && (
          <div className="border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden bg-white dark:bg-slate-900 shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-slate-100/80 dark:bg-slate-800/80 text-slate-500 dark:text-slate-400 font-black uppercase tracking-wider border-b border-slate-200 dark:border-slate-800 text-[10px]">
                    <th className="py-2.5 px-3 w-8 text-center">#</th>
                    <th className="py-2.5 px-3">Jugador (Nombre y Apellido)</th>
                    <th className="py-2.5 px-2 w-12 text-center">Pos</th>
                    <th className="py-2.5 px-3 text-center bg-indigo-50/70 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-300">
                      De cuánto a cuánto
                    </th>
                    <th className="py-2.5 px-2 w-10 text-center" title="Turnos Oficiales al Bat (AB)">VB</th>
                    <th className="py-2.5 px-2 w-10 text-center" title="Carreras Anotadas (R)">C</th>
                    <th className="py-2.5 px-2 w-10 text-center" title="Hits Conectados (H)">H</th>
                    <th className="py-2.5 px-2 w-12 text-center bg-emerald-50/70 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300" title="Promedio de Bateo (AVG = H / VB)">AVG</th>
                    <th className="py-2.5 px-2 w-10 text-center text-amber-600 dark:text-amber-400 font-black" title="Jonrones (HR)">HR</th>
                    <th className="py-2.5 px-2 w-10 text-center" title="Carreras Impulsadas (CI)">CI</th>
                    <th className="py-2.5 px-2 w-10 text-center" title="Bases por Bolas (BB)">BB</th>
                    <th className="py-2.5 px-2 w-10 text-center" title="Ponches (K)">K</th>
                    <th className="py-2.5 px-3">Notas / Extrabase</th>
                    <th className="py-2.5 px-2 text-center w-14 text-indigo-600 dark:text-indigo-400 font-black" title="Ajustar manualmente cualquier falla en la captura o algo no legible">
                      Editar
                    </th>
                    {isEditing && <th className="py-2.5 px-2 w-8"></th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {currentTeam.batters.map((batter, bIdx) => {
                    const isDidNotPlay = batter.battingLine === 'No jugó' || batter.order === 0;
                    return (
                    <tr
                      key={bIdx}
                      className={isDidNotPlay ? "hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors opacity-75 bg-slate-50/30 dark:bg-slate-900/30" : "hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"}
                    >
                      {/* Order */}
                      <td className="py-2 px-3 text-center font-bold text-slate-400">
                        {isDidNotPlay ? (
                          <span className="px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-400 font-bold text-[9px] uppercase tracking-wider">
                            No jugó
                          </span>
                        ) : (
                          batter.order || bIdx + 1
                        )}
                      </td>

                      {/* Player Name and Surname */}
                      <td className="py-2 px-3">
                        {isEditing ? (
                          <div className="space-y-1 min-w-[150px]">
                            <select
                              value={
                                (() => {
                                  const { roster: teamRoster, otherRoster } = getTeamRoster(activeTeamIdx);
                                  const match = [...teamRoster, ...otherRoster].find(
                                    p => (batter.playerId && p.id === batter.playerId) || normalizeStr(p.name) === normalizeStr(batter.name)
                                  );
                                  return match ? match.id : '';
                                })()
                              }
                              onChange={(e) => {
                                const selId = e.target.value;
                                if (!selId) return;
                                const { roster: teamRoster, otherRoster } = getTeamRoster(activeTeamIdx);
                                const selPlayer = [...teamRoster, ...otherRoster].find(p => p.id === selId);
                                if (selPlayer) {
                                  handleAssignPlayerWithSwap(activeTeamIdx, bIdx, selPlayer);
                                }
                              }}
                              className="w-full px-2 py-1 bg-white dark:bg-slate-800 border border-indigo-300 dark:border-indigo-600 rounded-lg text-xs font-bold text-slate-900 dark:text-white"
                            >
                              <option value="">-- Asignar del roster --</option>
                              {getTeamRoster(activeTeamIdx).roster.map(p => {
                                const currentTeamBatters = editableBoxScore?.teams[activeTeamIdx]?.batters || [];
                                const assignedIdx = currentTeamBatters.findIndex(
                                  (b, idx) => (b.playerId && b.playerId === p.id) || normalizeStr(b.name) === normalizeStr(p.name)
                                );
                                const isHere = assignedIdx === bIdx;
                                const isOther = assignedIdx !== -1 && !isHere;
                                return (
                                  <option key={p.id} value={p.id}>
                                    {p.number ? `#${p.number.replace(/^#/, '')} ` : ''}{p.name}
                                    {isHere ? ' ✓' : isOther ? ` 🔄 (Fila ${assignedIdx + 1})` : ''}
                                  </option>
                                );
                              })}
                            </select>
                            <input
                              type="text"
                              value={batter.name}
                              onChange={(e) =>
                                handleBatterChange(activeTeamIdx, bIdx, 'name', e.target.value)
                              }
                              placeholder="O nombre manual..."
                              className="w-full px-2 py-1 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-bold text-slate-900 dark:text-white"
                            />
                          </div>
                        ) : (
                          <div
                            onClick={() => isJefe && handleStartAdjusting(activeTeamIdx, bIdx, batter)}
                            className={`flex items-center gap-2 ${isJefe ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}`}
                            title={isJefe ? "Click para editar turnos al bat y asignar jugador del roster" : undefined}
                          >
                            {batter.playerNumber && (
                              <span className="text-[10px] font-black text-slate-400 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
                                {batter.playerNumber.startsWith('#') || batter.playerNumber === '-' ? batter.playerNumber : `#${batter.playerNumber}`}
                              </span>
                            )}
                            <span className={`font-bold ${
                              batter.name === 'Jugador no identificado'
                                ? 'text-amber-600 dark:text-amber-400 italic'
                                : isDidNotPlay
                                ? 'text-slate-600 dark:text-slate-400'
                                : 'text-slate-900 dark:text-white'
                            }`}>
                              {batter.name}
                            </span>
                            {batter.name === 'Jugador no identificado' && (
                              <span className="text-[9px] px-1.5 py-0.5 bg-amber-500/10 text-amber-600 dark:text-amber-400 rounded border border-amber-500/20 font-bold uppercase">
                                No legible
                              </span>
                            )}
                          </div>
                        )}
                      </td>

                      {/* Position */}
                      <td className="py-2 px-2 text-center">
                        {isEditing ? (
                          <input
                            type="text"
                            value={batter.position || ''}
                            onChange={(e) =>
                              handleBatterChange(activeTeamIdx, bIdx, 'position', e.target.value)
                            }
                            className="w-10 px-1 py-1 text-center bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-bold uppercase"
                          />
                        ) : (
                          <span className="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded font-bold text-[10px] uppercase">
                            {batter.position || '-'}
                          </span>
                        )}
                      </td>

                      {/* Batting Line: "de 4-2", "de 2-0", etc. */}
                      <td className={`py-2 px-3 text-center ${isDidNotPlay ? '' : 'bg-indigo-50/40 dark:bg-indigo-950/20'}`}>
                        {isEditing ? (
                          <input
                            type="text"
                            value={batter.battingLine}
                            onChange={(e) =>
                              handleBatterChange(activeTeamIdx, bIdx, 'battingLine', e.target.value)
                            }
                            className="w-24 px-2 py-1 text-center bg-white dark:bg-slate-800 border border-indigo-300 dark:border-indigo-700 rounded-lg text-xs font-black text-indigo-600 dark:text-indigo-400"
                          />
                        ) : isDidNotPlay ? (
                          <span className="text-slate-400 font-bold italic text-xs">
                            No jugó
                          </span>
                        ) : batter.battingLine === 'Dato no disponible' || batter.battingLine === 'No disponible' || batter.battingLine === 'No legible' ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 font-bold text-[11px] border border-amber-500/20">
                            {batter.battingLine}
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-indigo-600/10 dark:bg-indigo-400/10 text-indigo-600 dark:text-indigo-400 font-black text-xs uppercase tracking-wide">
                            {batter.battingLine || `de ${batter.ab}-${batter.h}`}
                          </span>
                        )}
                      </td>

                      {/* At-bats (VB) */}
                      <td className="py-2 px-2 text-center">
                        {isEditing ? (
                          <input
                            type="number"
                            min="0"
                            value={batter.ab}
                            onChange={(e) =>
                              handleBatterChange(activeTeamIdx, bIdx, 'ab', e.target.value)
                            }
                            className="w-10 px-1 py-1 text-center bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-bold"
                          />
                        ) : (
                          <span className="font-bold text-slate-700 dark:text-slate-200">
                            {batter.ab}
                          </span>
                        )}
                      </td>

                      {/* Runs (C) */}
                      <td className="py-2 px-2 text-center">
                        {isEditing ? (
                          <input
                            type="number"
                            min="0"
                            value={batter.r}
                            onChange={(e) =>
                              handleBatterChange(activeTeamIdx, bIdx, 'r', e.target.value)
                            }
                            className="w-10 px-1 py-1 text-center bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-bold"
                          />
                        ) : (
                          <span className={`font-bold ${batter.r > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-400'}`}>
                            {batter.r}
                          </span>
                        )}
                      </td>

                      {/* Hits (H) */}
                      <td className="py-2 px-2 text-center">
                        {isEditing ? (
                          <input
                            type="number"
                            min="0"
                            value={batter.h}
                            onChange={(e) =>
                              handleBatterChange(activeTeamIdx, bIdx, 'h', e.target.value)
                            }
                            className="w-10 px-1 py-1 text-center bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-bold"
                          />
                        ) : (
                          <span className={`font-black ${batter.h > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}`}>
                            {batter.h}
                          </span>
                        )}
                      </td>

                      {/* Individual AVG (H / VB) */}
                      <td className="py-2 px-2 text-center bg-emerald-50/30 dark:bg-emerald-950/20">
                        <span className="font-black text-emerald-600 dark:text-emerald-400 text-xs">
                          {batter.avg || (batter.ab > 0 ? (batter.h / batter.ab).toFixed(3).replace(/^0/, '') : '.000')}
                        </span>
                      </td>

                      {/* Home Runs (HR) */}
                      <td className="py-2 px-2 text-center">
                        {isEditing ? (
                          <input
                            type="number"
                            min="0"
                            value={batter.hr || 0}
                            onChange={(e) =>
                              handleBatterChange(activeTeamIdx, bIdx, 'hr', e.target.value)
                            }
                            className="w-10 px-1 py-1 text-center bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-bold text-amber-600"
                          />
                        ) : (
                          <span className={`font-black ${(batter.hr || 0) > 0 ? 'text-amber-600 dark:text-amber-400 px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 text-xs' : 'text-slate-400'}`}>
                            {batter.hr || 0}
                          </span>
                        )}
                      </td>

                      {/* RBIs (CI) */}
                      <td className="py-2 px-2 text-center">
                        {isEditing ? (
                          <input
                            type="number"
                            min="0"
                            value={batter.rbi}
                            onChange={(e) =>
                              handleBatterChange(activeTeamIdx, bIdx, 'rbi', e.target.value)
                            }
                            className="w-10 px-1 py-1 text-center bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-bold"
                          />
                        ) : (
                          <span className={`font-bold ${batter.rbi > 0 ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400'}`}>
                            {batter.rbi}
                          </span>
                        )}
                      </td>

                      {/* BB */}
                      <td className="py-2 px-2 text-center">
                        {isEditing ? (
                          <input
                            type="number"
                            min="0"
                            value={batter.bb}
                            onChange={(e) =>
                              handleBatterChange(activeTeamIdx, bIdx, 'bb', e.target.value)
                            }
                            className="w-10 px-1 py-1 text-center bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-bold"
                          />
                        ) : (
                          <span className="font-bold text-slate-500">
                            {batter.bb}
                          </span>
                        )}
                      </td>

                      {/* SO / K */}
                      <td className="py-2 px-2 text-center">
                        {isEditing ? (
                          <input
                            type="number"
                            min="0"
                            value={batter.so}
                            onChange={(e) =>
                              handleBatterChange(activeTeamIdx, bIdx, 'so', e.target.value)
                            }
                            className="w-10 px-1 py-1 text-center bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-xs font-bold"
                          />
                        ) : (
                          <span className="font-bold text-slate-500">
                            {batter.so}
                          </span>
                        )}
                      </td>

                      {/* Extra Notes */}
                      <td className="py-2 px-3">
                        {isEditing ? (
                          <input
                            type="text"
                            value={batter.extraNotes || ''}
                            onChange={(e) =>
                              handleBatterChange(activeTeamIdx, bIdx, 'extraNotes', e.target.value)
                            }
                            placeholder="ej. HR, 2B..."
                            className="w-full px-2 py-1 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-xs"
                          />
                        ) : (
                          <div className="flex items-center justify-between gap-1 group/note">
                            <span className="text-slate-500 dark:text-slate-400 text-[11px] font-medium">
                              {batter.extraNotes || '-'}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleStartAdjusting(activeTeamIdx, bIdx, batter)}
                              className="opacity-0 group-hover/note:opacity-100 p-1 text-indigo-500 hover:text-indigo-700 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 rounded transition-all cursor-pointer"
                              title="Ajustar notas de este bateador"
                            >
                              <Edit3 className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                      </td>

                      {/* Icono de Editar a la derecha de Notas Extrabase */}
                      <td className="py-2 px-2 text-center whitespace-nowrap">
                        {isJefe ? (
                          <button
                            type="button"
                            onClick={() => handleStartAdjusting(activeTeamIdx, bIdx, batter)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/60 dark:hover:bg-indigo-900/80 text-indigo-600 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/80 rounded-xl text-xs font-bold transition-all shadow-sm hover:scale-105 active:scale-95 cursor-pointer group"
                            title="Editar turnos al bat y asignar jugador del roster oficial"
                          >
                            <Edit3 className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 group-hover:rotate-12 transition-transform" />
                            <span className="text-[10px] font-black uppercase tracking-wider">Editar</span>
                          </button>
                        ) : (
                          <span className="text-slate-300 dark:text-slate-700 text-xs">-</span>
                        )}
                      </td>

                      {/* Delete button if in edit mode */}
                      {isEditing && (
                        <td className="py-2 px-2 text-center">
                          <button
                            type="button"
                            onClick={() => handleRemoveBatter(activeTeamIdx, bIdx)}
                            className="text-red-400 hover:text-red-600 p-1 rounded hover:bg-red-50 dark:hover:bg-red-950/30 transition-all"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      )}
                    </tr>
                    );
                  })}
                </tbody>

                {/* Team Totals Footer Row */}
                <tfoot>
                  <tr className="bg-slate-100 dark:bg-slate-800 font-black text-slate-900 dark:text-white border-t-2 border-slate-200 dark:border-slate-700 text-xs">
                    <td colSpan={3} className="py-3 px-3 uppercase tracking-wider">
                      TOTALES DEL EQUIPO
                    </td>
                    <td className="py-3 px-3 text-center">
                      <span className="px-2.5 py-1 rounded bg-indigo-600 text-white font-black text-xs">
                        AVG {currentTeam.totals?.avg || '.000'}
                      </span>
                    </td>
                    <td className="py-3 px-2 text-center font-black">{currentTeam.totals?.ab || 0}</td>
                    <td className="py-3 px-2 text-center font-black text-amber-600 dark:text-amber-400">{currentTeam.totals?.r || 0}</td>
                    <td className="py-3 px-2 text-center font-black text-emerald-600 dark:text-emerald-400">{currentTeam.totals?.h || 0}</td>
                    <td className="py-3 px-2 text-center font-black text-emerald-600 dark:text-emerald-400 bg-emerald-50/40 dark:bg-emerald-950/30">
                      {currentTeam.totals?.avg || '.000'}
                    </td>
                    <td className="py-3 px-2 text-center font-black text-amber-600 dark:text-amber-400">
                      {currentTeam.totals?.hr || currentTeam.batters.reduce((acc, b) => acc + (Number(b.hr) || 0), 0)}
                    </td>
                    <td className="py-3 px-2 text-center font-black text-indigo-600 dark:text-indigo-400">{currentTeam.totals?.rbi || 0}</td>
                    <td className="py-3 px-2 text-center font-black text-slate-600 dark:text-slate-300">{currentTeam.totals?.bb || 0}</td>
                    <td className="py-3 px-2 text-center font-black text-slate-600 dark:text-slate-300">{currentTeam.totals?.so || 0}</td>
                    <td className="py-3 px-3 text-[11px] text-slate-400 font-normal">
                      {currentTeam.notes || ''}
                    </td>
                    <td className="py-3 px-3"></td>
                    {isEditing && <td></td>}
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

        {/* General Notes from Scorebook */}
        {editableBoxScore.generalNotes && (
          <div className="p-3 bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 rounded-2xl text-xs space-y-1">
            <span className="font-bold text-slate-400 uppercase tracking-widest text-[10px]">
              Observaciones de la Hoja de Anotación:
            </span>
            <p className="text-slate-700 dark:text-slate-300 font-medium">
              {editableBoxScore.generalNotes}
            </p>
          </div>
        )}
      </div>
    );
  }
}
