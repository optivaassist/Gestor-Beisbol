import React, { useState, useRef, useEffect } from 'react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { Game, Team, Player, UserProfile, GameBoxScoreData, GamePitchingData } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import {
  Upload,
  BookOpen,
  X,
  FileCheck,
  Loader2,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  AlertCircle,
  Sparkles,
  CheckCircle2,
  Users,
  Calendar,
  MapPin,
  RefreshCw
} from 'lucide-react';
import {
  processScorebookFile,
  fetchTeamRoster,
  reconcileBoxScore,
  reconcilePitchingBoxScore,
  mergeBoxScores,
  mergePitchingBoxScores,
  cleanFirestoreData,
  saveScorebookFile,
  sanitizeScorebooksForMainDoc,
  hasUploadedBooks
} from '../utils/scorebookUtils';
import { Target, Activity } from 'lucide-react';

interface ScorebookUploadModalProps {
  games: Game[];
  teams: Team[];
  userProfile?: UserProfile | null;
  initialGameId?: string | null;
  initialCategory?: 'batting' | 'pitching';
  initialTeamType?: 'away' | 'home';
  onClose: () => void;
  onSuccess: (game: Game) => void;
}

export default function ScorebookUploadModal({
  games,
  teams,
  userProfile,
  initialGameId,
  initialCategory = 'batting',
  initialTeamType = 'away',
  onClose,
  onSuccess
}: ScorebookUploadModalProps) {
  const [selectedGameId, setSelectedGameId] = useState<string>(initialGameId || (games[0]?.id || ''));
  const [showGamePicker, setShowGamePicker] = useState<boolean>(!initialGameId);
  const [category, setCategory] = useState<'batting' | 'pitching'>(initialCategory);
  const [targetTeam, setTargetTeam] = useState<'away' | 'home'>(initialTeamType);
  const [file, setFile] = useState<File | null>(null);
  const [filePreviewUrl, setFilePreviewUrl] = useState<string | null>(null);
  const [fileType, setFileType] = useState<'image' | 'pdf' | 'excel' | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStep, setProcessingStep] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Roster counts for preview
  const [homeRoster, setHomeRoster] = useState<Player[]>([]);
  const [awayRoster, setAwayRoster] = useState<Player[]>([]);
  const [loadingRosters, setLoadingRosters] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Available games: all games so any game can have scorebook uploaded
  const availableGames = games;

  // Auto-select game if initialGameId is given or default to first
  useEffect(() => {
    if (initialGameId && games.some(g => g.id === initialGameId)) {
      setSelectedGameId(initialGameId);
      setShowGamePicker(false);
    } else if (!selectedGameId && availableGames.length > 0) {
      setSelectedGameId(availableGames[0].id);
    }
  }, [availableGames, selectedGameId, initialGameId, games]);

  useEffect(() => {
    if (initialCategory) {
      setCategory(initialCategory);
    }
    if (initialTeamType) {
      setTargetTeam(initialTeamType);
    }
  }, [initialCategory, initialTeamType]);

  const selectedGame = games.find(g => g.id === selectedGameId);

  // Fetch rosters when selected game changes
  useEffect(() => {
    if (!selectedGame) {
      setHomeRoster([]);
      setAwayRoster([]);
      return;
    }

    let isMounted = true;
    setLoadingRosters(true);

    Promise.all([
      fetchTeamRoster(selectedGame.homeTeamId, selectedGame.homeTeamName, teams),
      fetchTeamRoster(selectedGame.awayTeamId, selectedGame.awayTeamName, teams)
    ]).then(([home, away]) => {
      if (isMounted) {
        setHomeRoster(home);
        setAwayRoster(away);
        setLoadingRosters(false);
      }
    }).catch(err => {
      console.warn('Error loading rosters for game:', err);
      if (isMounted) setLoadingRosters(false);
    });

    return () => {
      isMounted = false;
    };
  }, [selectedGame, teams]);

  const handleSelectFile = (selectedFile: File) => {
    setFile(selectedFile);
    setErrorMessage(null);

    const name = selectedFile.name.toLowerCase();
    if (selectedFile.type === 'application/pdf' || name.endsWith('.pdf')) {
      setFileType('pdf');
      setFilePreviewUrl(null);
    } else if (
      selectedFile.type.includes('spreadsheet') ||
      selectedFile.type.includes('excel') ||
      name.endsWith('.xlsx') ||
      name.endsWith('.xls') ||
      name.endsWith('.csv')
    ) {
      setFileType('excel');
      setFilePreviewUrl(null);
    } else {
      setFileType('image');
      const reader = new FileReader();
      reader.onload = (e) => setFilePreviewUrl(e.target?.result as string);
      reader.readAsDataURL(selectedFile);
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleSelectFile(e.dataTransfer.files[0]);
    }
  };

  const handleProcessAndUpload = async () => {
    if (!selectedGame) {
      setErrorMessage('Por favor selecciona el partido correspondiente.');
      return;
    }
    if (!file) {
      setErrorMessage('Por favor selecciona o arrastra el archivo del libro (foto, PDF o Excel).');
      return;
    }

    setIsProcessing(true);
    setErrorMessage(null);

    try {
      // Step 1: Process file
      setProcessingStep('1/3 Procesando archivo del libro (imagen, PDF o Excel)...');
      const processed = await processScorebookFile(file);

      // Step 2: Ensure rosters & send to AI
      const isPitch = category === 'pitching';
      setProcessingStep(
        isPitch
          ? '2/3 Analizando conteo de lanzamientos y pitcheo de lanzadores con IA...'
          : '2/3 Extrayendo jugadores y cruzando con cédulas oficiales con IA...'
      );
      const uploaderName = userProfile?.displayName || userProfile?.email || 'Jefe de Categoría';

      // Send to /api/analyze-scorebook with official rosters and category
      const response = await fetch('/api/analyze-scorebook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: processed.dataUrl,
          fileName: processed.fileName,
          homeTeamName: selectedGame.homeTeamName,
          awayTeamName: selectedGame.awayTeamName,
          homeRoster: homeRoster.map(p => ({ id: p.id, name: p.name, number: p.number, position: p.position, notes: p.notes })),
          awayRoster: awayRoster.map(p => ({ id: p.id, name: p.name, number: p.number, position: p.position, notes: p.notes })),
          bookCategory: category,
          targetTeamType: targetTeam,
        }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Error al analizar el libro de anotación.');
      }

      setProcessingStep(
        isPitch
          ? '3/3 Verificando conteo de lanzamientos y enlazando con cédula oficial...'
          : '3/3 Verificando que el 100% de los jugadores de las cédulas aparezcan...'
      );

      const targetSheetKey = category === 'batting'
        ? (targetTeam === 'away' ? 'awayBatting' : 'homeBatting')
        : (targetTeam === 'away' ? 'awayPitching' : 'homePitching');

      // 1. Save full-resolution file into dedicated scorebook_files subcollection (each file gets its own 1MB quota)
      await saveScorebookFile(selectedGame.id, targetSheetKey, {
        fileUrl: processed.dataUrl,
        fileName: processed.fileName || `libro_${category}_${targetTeam}`,
        fileType: processed.fileType || 'image',
        uploadedAt: new Date().toISOString(),
        uploadedBy: uploaderName,
        category,
        teamType: targetTeam,
        teamName: targetTeam === 'away' ? selectedGame.awayTeamName : selectedGame.homeTeamName,
      });

      // 2. Prepare lightweight scorebook metadata for main game doc (ZERO base64 strings to stay under 50KB)
      const cleanScorebooksForMainDoc: Record<string, any> = sanitizeScorebooksForMainDoc(selectedGame.scorebooks);

      // Add or update the target sheet with pure metadata (no base64)
      cleanScorebooksForMainDoc[targetSheetKey] = {
        hasFile: true,
        fileName: processed.fileName || `libro_${category}_${targetTeam}`,
        fileType: processed.fileType || 'image',
        uploadedAt: new Date().toISOString(),
        uploadedBy: uploaderName,
        category,
        teamType: targetTeam,
        teamName: targetTeam === 'away' ? selectedGame.awayTeamName : selectedGame.homeTeamName,
      };

      const updatePayload: Partial<Game> = {
        bookImageUrl: '', // ALWAYS empty in main game doc: overwrites & removes any legacy huge base64 strings!
        bookUploadedAt: new Date().toISOString(),
        bookUploadedBy: uploaderName || 'Jefe de Categoría',
        bookFileName: processed.fileName || 'libro_anotacion',
        bookFileType: processed.fileType || 'image',
        scorebooks: cleanFirestoreData(cleanScorebooksForMainDoc),
      };

      if (category === 'batting') {
        let finalBoxScore: GameBoxScoreData = {
          teams: result.data?.teams || [],
          detectedAt: new Date().toISOString(),
          detectedBy: uploaderName,
          generalNotes: result.data?.generalNotes || '',
          finalScore: result.data?.finalScore || undefined,
          winningPitcher: result.data?.winningPitcher?.name || undefined,
          losingPitcher: result.data?.losingPitcher?.name || undefined,
          savePitcher: result.data?.savePitcher?.name || undefined,
        };

        finalBoxScore = reconcileBoxScore(
          finalBoxScore,
          selectedGame.homeTeamName,
          selectedGame.awayTeamName,
          homeRoster,
          awayRoster
        );

        // Never erase the other team's scorebook! Merge faithfully with existing box score.
        finalBoxScore = mergeBoxScores(selectedGame.boxScore, finalBoxScore, targetTeam);

        updatePayload.boxScore = cleanFirestoreData(finalBoxScore);

        // If pitch count data appears in batting sheet, save it too
        if (Array.isArray(result.data?.pitchers) && result.data.pitchers.length > 0) {
          const battingPitchingData: GamePitchingData = {
            teams: [
              {
                teamName: selectedGame.awayTeamName,
                teamType: 'away',
                pitchers: result.data.pitchers.filter((p: any) => p.teamType === 'away' || !p.teamType),
                totalPitches: result.data.pitchers.filter((p: any) => p.teamType === 'away' || !p.teamType).reduce((acc: number, p: any) => acc + (p.pitches || 0), 0)
              },
              {
                teamName: selectedGame.homeTeamName,
                teamType: 'home',
                pitchers: result.data.pitchers.filter((p: any) => p.teamType === 'home'),
                totalPitches: result.data.pitchers.filter((p: any) => p.teamType === 'home').reduce((acc: number, p: any) => acc + (p.pitches || 0), 0)
              }
            ],
            detectedAt: new Date().toISOString(),
            detectedBy: uploaderName,
          };
          let reconciledFromBatting = reconcilePitchingBoxScore(
            battingPitchingData,
            selectedGame.homeTeamName,
            selectedGame.awayTeamName,
            homeRoster,
            awayRoster
          );
          reconciledFromBatting = mergePitchingBoxScores(selectedGame.pitchingBoxScore, reconciledFromBatting, targetTeam);
          updatePayload.pitchingBoxScore = cleanFirestoreData(reconciledFromBatting);
        }
      } else {
        let finalPitching: GamePitchingData = {
          teams: result.data?.teams || [],
          detectedAt: new Date().toISOString(),
          detectedBy: uploaderName,
          generalNotes: result.data?.generalNotes || '',
          finalScore: result.data?.finalScore || undefined,
          winningPitcher: result.data?.winningPitcher?.name || undefined,
          losingPitcher: result.data?.losingPitcher?.name || undefined,
          savePitcher: result.data?.savePitcher?.name || undefined,
        };

        let reconciledPitching = reconcilePitchingBoxScore(
          finalPitching,
          selectedGame.homeTeamName,
          selectedGame.awayTeamName,
          homeRoster,
          awayRoster
        );

        reconciledPitching = mergePitchingBoxScores(selectedGame.pitchingBoxScore, reconciledPitching, targetTeam);
        updatePayload.pitchingBoxScore = cleanFirestoreData(reconciledPitching);
      }

      // 1. EXTRACT AND SET FINAL SCORE ON THE GAME
      const extFinalScore = result.data?.finalScore;
      if (
        extFinalScore &&
        typeof extFinalScore.awayScore === 'number' &&
        typeof extFinalScore.homeScore === 'number' &&
        (extFinalScore.awayScore > 0 || extFinalScore.homeScore > 0)
      ) {
        updatePayload.score = {
          away: extFinalScore.awayScore,
          home: extFinalScore.homeScore,
        };
        updatePayload.status = 'completed';
      } else if (category === 'batting' && updatePayload.boxScore?.teams) {
        const awayT = updatePayload.boxScore.teams.find(t => t.teamType === 'away');
        const homeT = updatePayload.boxScore.teams.find(t => t.teamType === 'home');
        if (awayT && homeT && (awayT.totals?.r > 0 || homeT.totals?.r > 0)) {
          updatePayload.score = {
            away: awayT.totals?.r || 0,
            home: homeT.totals?.r || 0,
          };
          updatePayload.status = 'completed';
        } else if (targetTeam === 'away' && awayT && typeof awayT.totals?.r === 'number') {
          updatePayload.score = {
            away: awayT.totals.r,
            home: selectedGame.score?.home ?? 0,
          };
        } else if (targetTeam === 'home' && homeT && typeof homeT.totals?.r === 'number') {
          updatePayload.score = {
            away: selectedGame.score?.away ?? 0,
            home: homeT.totals.r,
          };
        }
      }

      // 2. EXTRACT AND SET WINNING PITCHER ON THE GAME (Strict validation, no assumptions)
      const extractedWinPitcher =
        result.data?.winningPitcher?.name ||
        updatePayload.pitchingBoxScore?.winningPitcher ||
        updatePayload.boxScore?.winningPitcher;

      if (
        extractedWinPitcher &&
        extractedWinPitcher !== '-' &&
        extractedWinPitcher !== '?' &&
        !extractedWinPitcher.toLowerCase().includes('no ident') &&
        !extractedWinPitcher.toLowerCase().includes('desconocido') &&
        !extractedWinPitcher.toLowerCase().includes('ilegible')
      ) {
        updatePayload.winningPitcher = extractedWinPitcher;
      }

      const extractedLosePitcher =
        result.data?.losingPitcher?.name ||
        updatePayload.pitchingBoxScore?.losingPitcher ||
        updatePayload.boxScore?.losingPitcher;

      if (
        extractedLosePitcher &&
        extractedLosePitcher !== '-' &&
        extractedLosePitcher !== '?' &&
        !extractedLosePitcher.toLowerCase().includes('no ident') &&
        !extractedLosePitcher.toLowerCase().includes('desconocido') &&
        !extractedLosePitcher.toLowerCase().includes('ilegible')
      ) {
        updatePayload.losingPitcher = extractedLosePitcher;
      }

      const extractedSavePitcher =
        result.data?.savePitcher?.name ||
        updatePayload.pitchingBoxScore?.savePitcher ||
        updatePayload.boxScore?.savePitcher;

      if (extractedSavePitcher && extractedSavePitcher !== '-' && !extractedSavePitcher.toLowerCase().includes('no ident')) {
        updatePayload.savePitcher = extractedSavePitcher;
      }

      // Step 3: Save to Firestore
      const gameRef = doc(db, 'games', selectedGame.id);
      await updateDoc(gameRef, cleanFirestoreData(updatePayload));

      const updatedGame: Game = {
        ...selectedGame,
        ...updatePayload,
        bookImageUrl: processed.dataUrl,
      };

      onSuccess(updatedGame);
    } catch (err: any) {
      console.error('Error uploading and processing scorebook:', err);
      setErrorMessage(err.message || 'Error inesperado al procesar el libro de anotación.');
    } finally {
      setIsProcessing(false);
      setProcessingStep('');
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-md z-50 flex items-center justify-center p-3 sm:p-4">
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 15 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 15 }}
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[2.5rem] p-6 sm:p-8 max-w-2xl w-full shadow-2xl max-h-[92vh] flex flex-col space-y-6 text-slate-900 dark:text-white"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-indigo-600/10 text-indigo-600 flex items-center justify-center">
              <BookOpen className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-xl font-black uppercase tracking-tight">
                  Subir Libro <span className="text-indigo-600">de Anotación</span>
                </h3>
                <span className="px-2.5 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400 text-[10px] font-black uppercase tracking-wider">
                  Jefe de Categoría
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                Genera el Box Score oficial vinculado al 100% con las cédulas de Equipos.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isProcessing}
            className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 transition-all cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-6 overflow-y-auto pr-1">
          {/* 1. Game Selection */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-indigo-600" />
                <span>1. Partido Seleccionado para Subir Libro</span>
              </label>
              {availableGames.length > 1 && (
                <button
                  type="button"
                  onClick={() => setShowGamePicker(!showGamePicker)}
                  className="text-[10px] font-bold text-indigo-600 hover:text-indigo-700 underline cursor-pointer"
                >
                  {showGamePicker ? 'Ocultar selector' : 'Cambiar de partido'}
                </button>
              )}
            </div>

            {selectedGame && (
              <div className="p-3.5 bg-gradient-to-r from-indigo-50/90 to-violet-50/90 dark:from-indigo-950/40 dark:to-violet-950/40 border-2 border-indigo-500/30 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm">
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-full bg-indigo-600 text-white text-[10px] font-black uppercase tracking-wider">
                      {selectedGame.category || 'Categoría'}
                    </span>
                    <span className="text-xs font-bold text-slate-600 dark:text-slate-300">
                      Jornada {selectedGame.jornada || 1}
                    </span>
                    {selectedGame.field && (
                      <span className="text-xs text-slate-400">
                        • {selectedGame.field}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2.5 text-sm sm:text-base font-black text-slate-900 dark:text-white truncate">
                    <span className="truncate">{selectedGame.awayTeamName}</span>
                    <span className="text-[10px] text-indigo-600 dark:text-indigo-400 font-black uppercase px-1.5 py-0.5 bg-indigo-100 dark:bg-indigo-900/60 rounded">VS</span>
                    <span className="truncate">{selectedGame.homeTeamName}</span>
                  </div>
                </div>
                {hasUploadedBooks(selectedGame) && (
                  <span className="self-start sm:self-center px-2 py-0.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 text-[10px] font-black uppercase">
                    Libro cargado
                  </span>
                )}
              </div>
            )}

            {(!selectedGame || showGamePicker) && (
              <select
                value={selectedGameId}
                onChange={(e) => setSelectedGameId(e.target.value)}
                disabled={isProcessing}
                className="w-full bg-slate-50 dark:bg-slate-800/80 border-2 border-slate-200 dark:border-slate-700/80 rounded-2xl px-4 py-3 text-xs font-bold focus:outline-none focus:border-indigo-600 transition-all text-slate-800 dark:text-white"
              >
                {availableGames.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.awayTeamName} vs {g.homeTeamName} • {g.category || 'Categoría'} • Jornada {g.jornada || 1} {g.status === 'completed' ? `(Marcador: ${g.score?.away ?? 0}-${g.score?.home ?? 0})` : '(Programado)'} {hasUploadedBooks(g) ? '✓ (Tiene Libro)' : ''}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Roster Match Preview */}
          {selectedGame && (
            <div className="bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                <span className="flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-indigo-600" />
                  Cédulas Oficiales Registradas
                </span>
                {loadingRosters ? (
                  <span className="flex items-center gap-1 text-indigo-600 text-[10px]">
                    <Loader2 className="w-3 h-3 animate-spin" /> Cargando...
                  </span>
                ) : (
                  <span className="text-emerald-600 dark:text-emerald-400 text-[10px]">
                    {awayRoster.length + homeRoster.length} jugadores en total
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                {/* Away Team Cédula */}
                <div className="p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-bold truncate text-slate-900 dark:text-white">{selectedGame.awayTeamName} (Visitante)</span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${awayRoster.length > 0 ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-rose-500/10 text-rose-500'}`}>
                      {awayRoster.length} en cédula
                    </span>
                  </div>
                  {awayRoster.length === 0 ? (
                    <p className="text-[10px] text-rose-500 font-medium">Sin cédula en Equipos. Sube su cédula en Equipos para enlazar nombres.</p>
                  ) : (
                    <p className="text-[10px] text-slate-400 truncate">
                      {awayRoster.slice(0, 3).map(p => p.name).join(', ')}{awayRoster.length > 3 ? '...' : ''}
                    </p>
                  )}
                </div>

                {/* Home Team Cédula */}
                <div className="p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-bold truncate text-slate-900 dark:text-white">{selectedGame.homeTeamName} (Local)</span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${homeRoster.length > 0 ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-rose-500/10 text-rose-500'}`}>
                      {homeRoster.length} en cédula
                    </span>
                  </div>
                  {homeRoster.length === 0 ? (
                    <p className="text-[10px] text-rose-500 font-medium">Sin cédula en Equipos. Sube su cédula en Equipos para enlazar nombres.</p>
                  ) : (
                    <p className="text-[10px] text-slate-400 truncate">
                      {homeRoster.slice(0, 3).map(p => p.name).join(', ')}{homeRoster.length > 3 ? '...' : ''}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* 2. Selector de los 4 Libros por Partido */}
          {selectedGame && (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
                  <BookOpen className="w-3.5 h-3.5 text-indigo-600" />
                  <span>2. Selecciona la Hoja a Subir (4 Libros por Partido)</span>
                </label>
                <span className="text-[10px] font-black uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                  {category === 'batting' ? '⚾ Bateo' : '🎯 Conteo de Lanzamientos'}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {/* 1. Bateo Visitante */}
                <button
                  type="button"
                  onClick={() => {
                    setCategory('batting');
                    setTargetTeam('away');
                  }}
                  className={`p-3 rounded-2xl border-2 text-left transition-all flex flex-col justify-between cursor-pointer ${
                    category === 'batting' && targetTeam === 'away'
                      ? 'border-indigo-600 bg-indigo-50/90 dark:bg-indigo-950/50 shadow-md shadow-indigo-600/10'
                      : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 hover:border-slate-300 dark:hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <span className="text-base">⚾</span>
                      <span className="text-xs font-black uppercase text-slate-900 dark:text-white">1. Bateo Visitante</span>
                    </div>
                    {selectedGame.scorebooks?.awayBatting ? (
                      <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                        ✓ Subido
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase bg-slate-100 dark:bg-slate-800 text-slate-400">
                        Pendiente
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 truncate mt-1">
                    {selectedGame.awayTeamName}
                  </p>
                </button>

                {/* 2. Lanzamientos Visitante */}
                <button
                  type="button"
                  onClick={() => {
                    setCategory('pitching');
                    setTargetTeam('away');
                  }}
                  className={`p-3 rounded-2xl border-2 text-left transition-all flex flex-col justify-between cursor-pointer ${
                    category === 'pitching' && targetTeam === 'away'
                      ? 'border-indigo-600 bg-indigo-50/90 dark:bg-indigo-950/50 shadow-md shadow-indigo-600/10'
                      : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 hover:border-slate-300 dark:hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <span className="text-base">🎯</span>
                      <span className="text-xs font-black uppercase text-slate-900 dark:text-white">2. Lanzamientos Visitante</span>
                    </div>
                    {selectedGame.scorebooks?.awayPitching ? (
                      <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                        ✓ Subido
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase bg-slate-100 dark:bg-slate-800 text-slate-400">
                        Pendiente
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 truncate mt-1">
                    Lanzadores de {selectedGame.awayTeamName}
                  </p>
                </button>

                {/* 3. Bateo Local */}
                <button
                  type="button"
                  onClick={() => {
                    setCategory('batting');
                    setTargetTeam('home');
                  }}
                  className={`p-3 rounded-2xl border-2 text-left transition-all flex flex-col justify-between cursor-pointer ${
                    category === 'batting' && targetTeam === 'home'
                      ? 'border-indigo-600 bg-indigo-50/90 dark:bg-indigo-950/50 shadow-md shadow-indigo-600/10'
                      : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 hover:border-slate-300 dark:hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <span className="text-base">⚾</span>
                      <span className="text-xs font-black uppercase text-slate-900 dark:text-white">3. Bateo Local</span>
                    </div>
                    {selectedGame.scorebooks?.homeBatting ? (
                      <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                        ✓ Subido
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase bg-slate-100 dark:bg-slate-800 text-slate-400">
                        Pendiente
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 truncate mt-1">
                    {selectedGame.homeTeamName}
                  </p>
                </button>

                {/* 4. Lanzamientos Local */}
                <button
                  type="button"
                  onClick={() => {
                    setCategory('pitching');
                    setTargetTeam('home');
                  }}
                  className={`p-3 rounded-2xl border-2 text-left transition-all flex flex-col justify-between cursor-pointer ${
                    category === 'pitching' && targetTeam === 'home'
                      ? 'border-indigo-600 bg-indigo-50/90 dark:bg-indigo-950/50 shadow-md shadow-indigo-600/10'
                      : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 hover:border-slate-300 dark:hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <span className="text-base">🎯</span>
                      <span className="text-xs font-black uppercase text-slate-900 dark:text-white">4. Lanzamientos Local</span>
                    </div>
                    {selectedGame.scorebooks?.homePitching ? (
                      <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                        ✓ Subido
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase bg-slate-100 dark:bg-slate-800 text-slate-400">
                        Pendiente
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 truncate mt-1">
                    Lanzadores de {selectedGame.homeTeamName}
                  </p>
                </button>
              </div>
            </div>
          )}

          {/* 3. File Selection Zone */}
          <div className="space-y-2">
            <label className="text-[11px] font-black uppercase tracking-widest text-slate-400 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Upload className="w-3.5 h-3.5 text-indigo-600" />
                3. Archivo de la Hoja ({category === 'batting' ? 'Bateo' : 'Lanzamientos'} • {targetTeam === 'away' ? selectedGame?.awayTeamName : selectedGame?.homeTeamName})
              </span>
              <span className="text-[10px] text-indigo-600 font-bold">Acepta JPG, PNG, PDF, XLSX, XLS</span>
            </label>

            <input
              type="file"
              ref={fileInputRef}
              onChange={(e) => {
                if (e.target.files && e.target.files[0]) {
                  handleSelectFile(e.target.files[0]);
                }
              }}
              accept="image/*,application/pdf,.pdf,.xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              className="hidden"
            />

            {!file ? (
              <div
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-3xl p-8 text-center cursor-pointer transition-all flex flex-col items-center justify-center space-y-3 ${
                  dragActive
                    ? 'border-indigo-600 bg-indigo-50/50 dark:bg-indigo-950/20 scale-[0.99]'
                    : 'border-slate-200 dark:border-slate-800 hover:border-indigo-600/50 bg-slate-50/50 dark:bg-slate-800/20'
                }`}
              >
                <div className="flex items-center justify-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-indigo-600/10 text-indigo-600 flex items-center justify-center">
                    <ImageIcon className="w-6 h-6" />
                  </div>
                  <div className="w-12 h-12 rounded-2xl bg-rose-600/10 text-rose-600 flex items-center justify-center">
                    <FileText className="w-6 h-6" />
                  </div>
                  <div className="w-12 h-12 rounded-2xl bg-emerald-600/10 text-emerald-600 flex items-center justify-center">
                    <FileSpreadsheet className="w-6 h-6" />
                  </div>
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-black uppercase tracking-tight text-slate-800 dark:text-slate-200">
                    Haz clic o arrastra tu archivo aquí
                  </p>
                  <p className="text-xs text-slate-400 font-medium">
                    Foto o escaneo del libro físico, documento PDF o archivo de Excel
                  </p>
                </div>
                <span className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-600/20">
                  Explorar Archivos
                </span>
              </div>
            ) : (
              <div className="border border-slate-200 dark:border-slate-800 rounded-2xl p-4 bg-slate-50 dark:bg-slate-800/40 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${
                    fileType === 'pdf' ? 'bg-rose-500/10 text-rose-600' :
                    fileType === 'excel' ? 'bg-emerald-500/10 text-emerald-600' :
                    'bg-indigo-500/10 text-indigo-600'
                  }`}>
                    {fileType === 'pdf' ? <FileText className="w-6 h-6" /> :
                     fileType === 'excel' ? <FileSpreadsheet className="w-6 h-6" /> :
                     filePreviewUrl ? (
                       <img src={filePreviewUrl} alt="Preview" className="w-10 h-10 object-cover rounded-xl" />
                     ) : (
                       <ImageIcon className="w-6 h-6" />
                     )}
                  </div>
                  <div className="min-w-0">
                    <h5 className="text-xs font-bold truncate text-slate-900 dark:text-white">{file.name}</h5>
                    <p className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">
                      {(file.size / 1024).toFixed(1)} KB • {fileType?.toUpperCase()}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setFile(null);
                    setFilePreviewUrl(null);
                    setFileType(null);
                  }}
                  className="px-3 py-1.5 text-xs font-bold text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 rounded-xl transition-all"
                >
                  Cambiar
                </button>
              </div>
            )}
          </div>

          {/* Golden Rule Notice */}
          <div className="p-3.5 bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800/60 rounded-2xl text-xs space-y-2 text-indigo-950 dark:text-indigo-200">
            <div className="flex items-center gap-1.5 font-bold uppercase tracking-wider text-[10px] text-indigo-700 dark:text-indigo-400">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Regla Oficial de Lectura del Libro (Anotaciones con Pluma)</span>
            </div>
            <ul className="text-[11px] leading-relaxed opacity-95 list-disc list-inside space-y-1">
              <li>
                <strong>Fuente oficial:</strong> Se toman los datos escritos con pluma en el lado derecho de la hoja (ej. <code className="px-1 py-0.5 bg-white dark:bg-slate-800 rounded font-black text-indigo-600">2-0</code> o <code className="px-1 py-0.5 bg-white dark:bg-slate-800 rounded font-black text-indigo-600">2x0</code> = 2 turnos al bat y 0 hits).
              </li>
              <li>
                <strong>Cálculo:</strong> Turnos (AB) es el 1.ᵉʳ número, Hits (H) el 2.º número, y AVG = H / AB. Se detectan marcas de <strong>HR</strong> o jonrón.
              </li>
              <li>
                <strong>Actualización integral:</strong> El escore final y el pitcher ganador se actualizan automáticamente en <em>Partidos</em>, <em>Resultados</em> y estadísticas individuales sin duplicar registros.
              </li>
            </ul>
          </div>

          {/* Error Message */}
          {errorMessage && (
            <div className="p-3.5 bg-rose-500/10 border border-rose-500/20 rounded-2xl flex items-center gap-2.5 text-xs text-rose-600 dark:text-rose-400 font-bold">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-500" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Processing Status */}
          {isProcessing && (
            <div className="p-4 bg-indigo-600/10 border border-indigo-600/20 rounded-2xl space-y-2 text-center">
              <div className="flex items-center justify-center gap-2 text-indigo-600 dark:text-indigo-400 font-bold text-xs uppercase tracking-wider">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>{processingStep}</span>
              </div>
              <p className="text-[10px] text-slate-400">
                La inteligencia artificial está leyendo las líneas de bateo y cruzándolas con las cédulas oficiales...
              </p>
            </div>
          )}
        </div>

        {/* Modal Footer Actions */}
        <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
          <button
            type="button"
            disabled={isProcessing}
            onClick={onClose}
            className="px-5 py-3 rounded-2xl text-xs font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all cursor-pointer"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={!file || !selectedGame || isProcessing}
            onClick={handleProcessAndUpload}
            className="flex items-center gap-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-2xl text-xs font-black uppercase tracking-wider transition-all shadow-xl shadow-indigo-600/20 active:scale-95 cursor-pointer"
          >
            {isProcessing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>{category === 'batting' ? 'Procesando Bateo...' : 'Procesando Lanzamientos...'}</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                <span>{category === 'batting' ? 'Subir Libro de Bateo' : 'Subir Libro de Lanzamientos'}</span>
              </>
            )}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
