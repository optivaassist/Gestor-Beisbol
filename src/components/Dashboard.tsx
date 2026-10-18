import React, { useState, useEffect, useRef } from 'react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { collection, onSnapshot, query, orderBy, limit, addDoc, updateDoc, doc, deleteDoc } from 'firebase/firestore';
import { Game, Team, Category, CATEGORIES, UserProfile, GameBoxScoreData, Season, formatFieldName, formatTeamName } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { Calendar, Plus, Trophy, ChevronRight, Clock, MapPin, BookOpen, Upload, Eye, X, Download, FileCheck, Loader2, Image as ImageIcon, Sparkles, Table as TableIcon, FileSpreadsheet, AlertCircle, Users, FileDown, Edit3, Trash2, Target, Activity } from 'lucide-react';
import ScorebookModal from './ScorebookModal';
import ScorebookUploadModal from './ScorebookUploadModal';
import ExcelScheduleModal from './ExcelScheduleModal';
import ScheduleExportModal from './ScheduleExportModal';
import TeamLogo from './TeamLogo';
import {
  processScorebookFile,
  fetchTeamRoster,
  reconcileBoxScore,
  mergeBoxScores,
  cleanFirestoreData,
  getUploadedSheetsCount,
  hasUploadedBooks,
  saveScorebookFile,
  sanitizeScorebooksForMainDoc
} from '../utils/scorebookUtils';

interface DashboardProps {
  userRole: string;
  userProfile?: UserProfile | null;
  onSelectGame: (id: string, initialTab?: 'score' | 'lineup') => void;
  onNavigateToSchedule?: () => void;
}

export default function Dashboard({ userRole, userProfile, onSelectGame }: DashboardProps) {
  const [games, setGames] = useState<Game[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddGame, setShowAddGame] = useState(false);
  const [showExcelUploadModal, setShowExcelUploadModal] = useState(false);
  const [showScorebookUploadModal, setShowScorebookUploadModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [uploadModalInitialGameId, setUploadModalInitialGameId] = useState<string | null>(null);
  const [uploadModalCategory, setUploadModalCategory] = useState<'batting' | 'pitching'>('batting');
  const [gameToDeleteBooks, setGameToDeleteBooks] = useState<Game | null>(null);
  const [deletingBooks, setDeletingBooks] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<Category | 'Todas'>('Todas');
  const [selectedJornada, setSelectedJornada] = useState<number | 'All'>('All');
  const [statusFilter, setStatusFilter] = useState<'all' | 'scheduled' | 'completed'>('all');
  const [uploadingGameId, setUploadingGameId] = useState<string | null>(null);
  const [selectedBookGame, setSelectedBookGame] = useState<Game | null>(null);
  const [uploadSuccessMessage, setUploadSuccessMessage] = useState<string | null>(null);
  const [editingGame, setEditingGame] = useState<Game | null>(null);
  const [editFormData, setEditFormData] = useState<{ awayTeamId: string; homeTeamId: string; date: string; time: string; field: string; jornada?: number }>({ awayTeamId: '', homeTeamId: '', date: '', time: '08:00', field: '' });
  const [confirmDeleteSingleGame, setConfirmDeleteSingleGame] = useState<Game | null>(null);
  const [isDeletingGame, setIsDeletingGame] = useState(false);

  useEffect(() => {
    setLoading(true);
    const gamesQuery = query(collection(db, 'games'), orderBy('date', 'asc'));
    const unsubscribeGames = onSnapshot(gamesQuery, (snapshot) => {
      const loadedGames = snapshot.docs.map(doc => {
        const d = doc.data();
        return {
          id: doc.id,
          ...d,
          homeTeamName: formatTeamName(d.homeTeamName),
          awayTeamName: formatTeamName(d.awayTeamName)
        } as Game;
      });
      setGames(loadedGames);
      // Keep selectedBookGame updated if it was edited
      setSelectedBookGame(prev => prev ? (loadedGames.find(g => g.id === prev.id) || prev) : null);
      setLoading(false);

      // Clean up any legacy lowercase/mixedcase team names and Zorros fields in existing game documents
      if (userRole === 'admin' || userProfile?.email === 'llorch7@gmail.com') {
        snapshot.docs.forEach(docSnap => {
          const d = docSnap.data();
          const updates: any = {};
          if (d.field && /el\s+campo\s+zorros/i.test(d.field)) {
            updates.field = 'Zorros';
          }
          if (d.homeTeamName && d.homeTeamName !== formatTeamName(d.homeTeamName)) {
            updates.homeTeamName = formatTeamName(d.homeTeamName);
          }
          if (d.awayTeamName && d.awayTeamName !== formatTeamName(d.awayTeamName)) {
            updates.awayTeamName = formatTeamName(d.awayTeamName);
          }
          if (Object.keys(updates).length > 0) {
            updateDoc(docSnap.ref, updates).catch(() => {});
          }
        });
      }
    }, (error) => {
      console.error("Error fetching games:", error);
      setLoading(false);
    });

    const teamsQuery = query(collection(db, 'teams'), orderBy('name', 'asc'));
    const unsubscribeTeams = onSnapshot(teamsQuery, (snapshot) => {
      setTeams(snapshot.docs.map(doc => {
        const d = doc.data();
        return { id: doc.id, ...d, name: formatTeamName(d.name) } as Team;
      }));

      // Background migration to ensure all team names in Firestore are permanently UPPERCASE
      if (userRole === 'admin' || userProfile?.email === 'llorch7@gmail.com') {
        snapshot.docs.forEach(docSnap => {
          const d = docSnap.data();
          if (d.name && d.name !== formatTeamName(d.name)) {
            updateDoc(docSnap.ref, { name: formatTeamName(d.name) }).catch(() => {});
          }
        });
      }
    }, (error) => {
      console.error("Error fetching teams:", error);
      setLoading(false);
    });

    const seasonsQuery = query(collection(db, 'seasons'));
    const unsubscribeSeasons = onSnapshot(seasonsQuery, (snapshot) => {
      setSeasons(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Season)));
    }, (error) => {
      console.error("Error fetching seasons:", error);
    });

    return () => {
      unsubscribeGames();
      unsubscribeTeams();
      unsubscribeSeasons();
    };
  }, []);

  const filteredGames = games.filter(game => {
    const homeTeam = teams.find(t => t.id === game.homeTeamId);
    const awayTeam = teams.find(t => t.id === game.awayTeamId);
    const gameCat = game.category || homeTeam?.category || awayTeam?.category;
    const categoryMatch = selectedCategory === 'Todas' || gameCat === selectedCategory;
    const jornadaMatch = selectedJornada === 'All' || Number(game.jornada) === Number(selectedJornada);
    const statusMatch = 
      statusFilter === 'all' ? true :
      statusFilter === 'scheduled' ? (game.status === 'scheduled' || game.status === 'in-progress') :
      game.status === 'completed';
    return categoryMatch && jornadaMatch && statusMatch;
  });

  const jornadas = Array.from(new Set(games.map(g => g.jornada).filter(Boolean) as number[])).sort((a, b) => a - b);

  // Compress image to safe Firestore Data URL (under 300KB)
  const compressImage = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (e) => {
        const img = new Image();
        img.src = e.target?.result as string;
        img.onload = () => {
          const MAX_WIDTH = 1400;
          const MAX_HEIGHT = 1400;
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
            resolve(e.target?.result as string);
            return;
          }
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
          resolve(dataUrl);
        };
        img.onerror = (err) => reject(err);
      };
      reader.onerror = (err) => reject(err);
    });
  };

  const isJefe = userProfile?.role === 'jefe_categoria' || userRole === 'jefe_categoria' || userProfile?.role === 'admin' || userRole === 'admin';

  const handleUploadBook = async (gameId: string, file: File) => {
    if (!file) return;
    setUploadingGameId(gameId);
    try {
      const targetGame = games.find(g => g.id === gameId);
      if (!targetGame) throw new Error('Partido no encontrado');

      setUploadSuccessMessage('Procesando archivo del libro (foto, PDF o Excel)...');
      const processed = await processScorebookFile(file);
      const uploaderName = userProfile?.displayName || userProfile?.email || 'Jefe de Categoría';

      setUploadSuccessMessage('Analizando libro y cruzando con cédulas oficiales con IA...');

      // Fetch official rosters for both teams
      const [homeRoster, awayRoster] = await Promise.all([
        fetchTeamRoster(targetGame.homeTeamId, targetGame.homeTeamName, teams),
        fetchTeamRoster(targetGame.awayTeamId, targetGame.awayTeamName, teams)
      ]);

      const response = await fetch('/api/analyze-scorebook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: processed.dataUrl,
          fileName: processed.fileName,
          homeTeamName: targetGame.homeTeamName,
          awayTeamName: targetGame.awayTeamName,
          homeRoster: homeRoster.map(p => ({ id: p.id, name: p.name, number: p.number, position: p.position, notes: p.notes })),
          awayRoster: awayRoster.map(p => ({ id: p.id, name: p.name, number: p.number, position: p.position, notes: p.notes })),
        })
      });

      const result = await response.json();

      let boxScoreData: GameBoxScoreData = {
        teams: result.data?.teams || [],
        detectedAt: new Date().toISOString(),
        detectedBy: uploaderName,
        generalNotes: result.data?.generalNotes || '',
        finalScore: result.data?.finalScore || undefined,
        winningPitcher: result.data?.winningPitcher?.name || undefined,
        losingPitcher: result.data?.losingPitcher?.name || undefined,
        savePitcher: result.data?.savePitcher?.name || undefined,
      };

      // Strict client reconciliation
      boxScoreData = reconcileBoxScore(
        boxScoreData,
        targetGame.homeTeamName,
        targetGame.awayTeamName,
        homeRoster,
        awayRoster
      );
      boxScoreData = mergeBoxScores(targetGame.boxScore, boxScoreData);

      // Save full-resolution file into dedicated scorebook_files subcollection (each file gets its own 1MB quota)
      await saveScorebookFile(gameId, 'default', {
        fileUrl: processed.dataUrl,
        fileName: processed.fileName || 'libro_anotacion',
        fileType: processed.fileType || 'image',
        uploadedAt: new Date().toISOString(),
        uploadedBy: uploaderName,
      });

      const cleanScorebooks = sanitizeScorebooksForMainDoc(targetGame.scorebooks);
      cleanScorebooks.awayBatting = cleanScorebooks.awayBatting || {
        hasFile: true,
        fileName: processed.fileName || 'libro_anotacion',
        fileType: processed.fileType || 'image',
        uploadedAt: new Date().toISOString(),
        uploadedBy: uploaderName,
        category: 'batting',
        teamType: 'away',
        teamName: targetGame.awayTeamName,
      };

      const updatePayload: Partial<Game> = {
        bookImageUrl: '', // Empty in main doc to avoid 1MB Firestore limit!
        bookFileName: processed.fileName || 'libro_anotacion',
        bookFileType: processed.fileType || 'image',
        bookUploadedAt: new Date().toISOString(),
        bookUploadedBy: uploaderName,
        scorebooks: cleanFirestoreData(cleanScorebooks),
        boxScore: cleanFirestoreData(boxScoreData)
      };

      // 1. EXTRACT FINAL SCORE
      const extScore = result.data?.finalScore;
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

      // 2. EXTRACT WINNING PITCHER
      const extWin = result.data?.winningPitcher?.name || boxScoreData.winningPitcher;
      if (extWin && extWin !== '-' && !extWin.toLowerCase().includes('no ident')) {
        updatePayload.winningPitcher = extWin;
      }
      if (result.data?.losingPitcher?.name) {
        updatePayload.losingPitcher = result.data.losingPitcher.name;
      }
      if (result.data?.savePitcher?.name) {
        updatePayload.savePitcher = result.data.savePitcher.name;
      }

      await updateDoc(doc(db, 'games', gameId), cleanFirestoreData(updatePayload));

      const updatedGame: Game = {
        ...targetGame,
        ...updatePayload
      };

      setSelectedBookGame(updatedGame);
      setUploadSuccessMessage('¡Libro digitalizado y Box Score generado con éxito usando las cédulas oficiales!');
      setTimeout(() => setUploadSuccessMessage(null), 5000);
    } catch (error: any) {
      console.error("Error uploading book:", error);
      handleFirestoreError(error, OperationType.UPDATE, `games/${gameId}`);
      setUploadSuccessMessage(null);
    } finally {
      setUploadingGameId(null);
    }
  };

  const handleConfirmDeleteBooks = async (sheetKey?: string) => {
    if (!gameToDeleteBooks) return;
    setDeletingBooks(true);
    try {
      if (sheetKey && gameToDeleteBooks.scorebooks) {
        // Delete a specific sheet from the 4 sheets
        const updatedScorebooks = { ...gameToDeleteBooks.scorebooks };
        delete (updatedScorebooks as any)[sheetKey];
        const remainingKeys = Object.keys(updatedScorebooks).filter(k => Boolean((updatedScorebooks as any)[k]));
        const updates: any = {
          scorebooks: cleanFirestoreData(updatedScorebooks),
          bookImageUrl: '',
        };
        if (remainingKeys.length === 0) {
          updates.bookFileName = '';
          updates.bookFileType = null;
          updates.bookUploadedAt = null;
          updates.bookUploadedBy = null;
          updates.boxScore = null;
          updates.pitchingBoxScore = null;
        } else if (sheetKey === 'awayBatting' || sheetKey === 'homeBatting') {
          if (!updatedScorebooks.awayBatting && !updatedScorebooks.homeBatting) {
            updates.boxScore = null;
          }
        } else if (sheetKey === 'awayPitching' || sheetKey === 'homePitching') {
          if (!updatedScorebooks.awayPitching && !updatedScorebooks.homePitching) {
            updates.pitchingBoxScore = null;
          }
        }
        await updateDoc(doc(db, 'games', gameToDeleteBooks.id), cleanFirestoreData(updates));
      } else {
        // Delete all books and digitalized stats
        await updateDoc(doc(db, 'games', gameToDeleteBooks.id), {
          bookImageUrl: '',
          bookFileName: '',
          bookFileType: null,
          bookUploadedAt: null,
          bookUploadedBy: null,
          boxScore: null,
          pitchingBoxScore: null,
          scorebooks: null,
        });
      }
      setUploadSuccessMessage('Libro(s) de anotación borrado(s) exitosamente.');
      setTimeout(() => setUploadSuccessMessage(null), 4000);
      setGameToDeleteBooks(null);
    } catch (err) {
      console.error('Error deleting scorebooks:', err);
      setUploadSuccessMessage('Error al borrar los libros.');
    } finally {
      setDeletingBooks(false);
    }
  };

  const normalizeStr = (str: any): string => {
    return String(str || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
  };



  const handleAddGame = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const homeId = formData.get('homeTeamId') as string;
    const awayId = formData.get('awayTeamId') as string;
    const homeTeam = teams.find(t => t.id === homeId);
    const awayTeam = teams.find(t => t.id === awayId);

    if (!homeTeam || !awayTeam) return;

    const newGame: Partial<Game> = {
      leagueId: 'default',
      homeTeamId: homeId,
      awayTeamId: awayId,
      homeTeamName: homeTeam.name,
      awayTeamName: awayTeam.name,
      date: formData.get('date') as string || new Date().toISOString(),
      field: formData.get('field') as string || 'Campo Principal',
      status: 'scheduled',
      score: { home: 0, away: 0 },
      inning: 1,
      isTop: true,
      outs: 0,
      balls: 0,
      strikes: 0,
      runners: { first: null, second: null, third: null },
      jornada: formData.get('jornada') ? parseInt(formData.get('jornada') as string) : undefined,
    };

    try {
      await addDoc(collection(db, 'games'), newGame);
      setShowAddGame(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'games');
    }
  };

  const canEditGame = (g: Game) => {
    if (userRole === 'admin' || userRole === 'editor') return true;
    if (isJefe) {
      const home = teams.find(t => t.id === g.homeTeamId);
      const cat = g.category || home?.category;
      if (!userProfile?.category || userProfile?.category === cat) return true;
    }
    return false;
  };

  const handleOpenEditGame = (game: Game) => {
    setEditingGame(game);
    const d = new Date(game.date);
    const yyyy = !isNaN(d.getTime()) ? d.getFullYear() : new Date().getFullYear();
    const mm = !isNaN(d.getTime()) ? String(d.getMonth() + 1).padStart(2, '0') : String(new Date().getMonth() + 1).padStart(2, '0');
    const dd = !isNaN(d.getTime()) ? String(d.getDate()).padStart(2, '0') : String(new Date().getDate()).padStart(2, '0');
    const hours = !isNaN(d.getTime()) ? String(d.getHours()).padStart(2, '0') : '08';
    const mins = !isNaN(d.getTime()) ? String(d.getMinutes()).padStart(2, '0') : '00';

    const matchedAway = teams.find(t => t.id === game.awayTeamId || t.name.trim().toLowerCase() === game.awayTeamName?.trim().toLowerCase());
    const matchedHome = teams.find(t => t.id === game.homeTeamId || t.name.trim().toLowerCase() === game.homeTeamName?.trim().toLowerCase());

    setEditFormData({
      awayTeamId: matchedAway?.id || game.awayTeamId || '',
      homeTeamId: matchedHome?.id || game.homeTeamId || '',
      date: `${yyyy}-${mm}-${dd}`,
      time: `${hours}:${mins}`,
      field: formatFieldName(game.field) || '',
      jornada: game.jornada
    });
  };

  const handleSaveEditGame = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingGame) return;
    const [hours, minutes] = editFormData.time.split(':');
    const [y, m, d] = editFormData.date.split('-').map(Number);
    const newDate = new Date(y, m - 1, d, parseInt(hours, 10), parseInt(minutes, 10), 0, 0);

    const awayTeam = teams.find(t => t.id === editFormData.awayTeamId);
    const homeTeam = teams.find(t => t.id === editFormData.homeTeamId);
    const awayTeamName = formatTeamName(awayTeam?.name || editingGame.awayTeamName);
    const homeTeamName = formatTeamName(homeTeam?.name || editingGame.homeTeamName);
    const resolvedCat = awayTeam?.category || homeTeam?.category || editingGame.category;

    try {
      const gameRef = doc(db, 'games', editingGame.id);
      await updateDoc(gameRef, {
        awayTeamId: editFormData.awayTeamId,
        awayTeamName: awayTeamName,
        homeTeamId: editFormData.homeTeamId,
        homeTeamName: homeTeamName,
        ...(resolvedCat ? { category: resolvedCat } : {}),
        date: newDate.toISOString(),
        field: formatFieldName(editFormData.field.trim()) || 'Campo Principal',
        ...(editFormData.jornada !== undefined ? { jornada: Number(editFormData.jornada) } : {})
      });
      setEditingGame(null);
      setUploadSuccessMessage(`Partido actualizado correctamente (${awayTeamName} vs ${homeTeamName}).`);
      setTimeout(() => setUploadSuccessMessage(null), 4000);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `games/${editingGame.id}`);
    }
  };

  const handleDeleteSingleGame = async () => {
    if (!confirmDeleteSingleGame) return;
    setIsDeletingGame(true);
    try {
      const matchText = `${confirmDeleteSingleGame.awayTeamName} vs ${confirmDeleteSingleGame.homeTeamName}`;
      await deleteDoc(doc(db, 'games', confirmDeleteSingleGame.id));
      setConfirmDeleteSingleGame(null);
      setEditingGame(null);
      setUploadSuccessMessage(`El partido (${matchText}) fue borrado permanentemente de todos los apartados.`);
      setTimeout(() => setUploadSuccessMessage(null), 5000);
    } catch (err) {
      console.error("Error deleting game:", err);
      handleFirestoreError(err, OperationType.DELETE, `games/${confirmDeleteSingleGame.id}`);
    } finally {
      setIsDeletingGame(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
          className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full"
        />
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-10"
    >
      {/* Toast Notification */}
      <AnimatePresence>
        {uploadSuccessMessage && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-20 right-6 z-50 flex items-center gap-3 bg-emerald-600 text-white px-5 py-3 rounded-2xl shadow-xl shadow-emerald-600/30 text-xs font-bold"
          >
            <FileCheck className="w-4 h-4 text-emerald-100" />
            <span>{uploadSuccessMessage}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-1">
          <h2 className="text-4xl font-black tracking-tight uppercase">Calendario <span className="text-indigo-600">Partidos</span></h2>
          <p className="text-slate-500 dark:text-slate-400 font-medium">Próximos y recientes encuentros de la liga por jornada.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {/* Exportar Rol a PDF */}
          <button
            onClick={() => setShowExportModal(true)}
            className="flex items-center justify-center gap-2 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white font-bold py-3 px-5 rounded-2xl transition-all shadow-xl shadow-indigo-600/20 active:scale-95 cursor-pointer"
            title="Exportar rol de juegos a PDF con selección de categoría y jornada"
          >
            <FileDown className="w-5 h-5" />
            <span>Exportar Rol (PDF)</span>
          </button>

          {(userRole === 'admin' || isJefe) && (
            <button
              onClick={() => setShowExcelUploadModal(true)}
              className="flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 px-6 rounded-2xl transition-all shadow-xl shadow-emerald-600/20 active:scale-95 cursor-pointer"
              title="Subir archivo de Excel con los juegos por jornada"
            >
              <FileSpreadsheet className="w-5 h-5" />
              Subir Rol (Excel)
            </button>
          )}
          {userRole === 'admin' && (
            <button
              onClick={() => setShowAddGame(true)}
              className="flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 dark:bg-slate-700 dark:hover:bg-slate-600 text-white font-bold py-3 px-6 rounded-2xl transition-all shadow-lg active:scale-95 cursor-pointer"
            >
              <Plus className="w-5 h-5" />
              Nuevo Partido
            </button>
          )}
        </div>
      </div>



      <div className="flex flex-wrap items-center justify-between gap-4 pb-2">
        {/* Categories Bar */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setSelectedCategory('Todas')}
            className={`px-5 py-2.5 rounded-2xl text-[10px] font-black uppercase tracking-[0.15em] transition-all border-2 cursor-pointer ${
              selectedCategory === 'Todas'
                ? 'bg-indigo-600 border-indigo-600 text-white shadow-xl shadow-indigo-600/20'
                : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-500 hover:border-indigo-600/50'
            }`}
          >
            Todas
          </button>
          {CATEGORIES.map(cat => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-5 py-2.5 rounded-2xl text-[10px] font-black uppercase tracking-[0.15em] transition-all border-2 cursor-pointer ${
                selectedCategory === cat
                  ? 'bg-indigo-600 border-indigo-600 text-white shadow-xl shadow-indigo-600/20'
                  : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-500 hover:border-indigo-600/50'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Filters: Status & Jornada */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Status Tabs */}
          <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-2xl border border-slate-200 dark:border-slate-700/60">
            <button
              onClick={() => setStatusFilter('all')}
              className={`px-3.5 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all ${
                statusFilter === 'all'
                  ? 'bg-white dark:bg-slate-900 text-indigo-600 shadow-sm'
                  : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              Todos
            </button>
            <button
              onClick={() => setStatusFilter('scheduled')}
              className={`px-3.5 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all ${
                statusFilter === 'scheduled'
                  ? 'bg-white dark:bg-slate-900 text-indigo-600 shadow-sm'
                  : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              Próximos
            </button>
            <button
              onClick={() => setStatusFilter('completed')}
              className={`px-3.5 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all ${
                statusFilter === 'completed'
                  ? 'bg-white dark:bg-slate-900 text-indigo-600 shadow-sm'
                  : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              Resultados
            </button>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Jornada:</span>
            <select
              value={selectedJornada}
              onChange={(e) => setSelectedJornada(e.target.value === 'All' ? 'All' : parseInt(e.target.value))}
              className="bg-slate-50 dark:bg-slate-900 border-2 border-slate-200 dark:border-slate-800 rounded-2xl px-4 py-2 text-[10px] font-black uppercase tracking-widest text-slate-600 dark:text-slate-300 focus:outline-none focus:border-indigo-600 transition-all"
            >
              <option value="All">Todas</option>
              {jornadas.map(j => (
                <option key={j} value={j}>Jornada {j}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {showAddGame && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <motion.div 
            initial={{ scale: 0.95, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[2.5rem] p-10 max-w-md w-full space-y-8 shadow-[0_32px_64px_-12px_rgba(0,0,0,0.3)]"
          >
            <div className="space-y-2">
              <h3 className="text-3xl font-black text-slate-900 dark:text-white uppercase tracking-tight">Programar <span className="text-indigo-600">Partido</span></h3>
              <p className="text-slate-500 text-sm font-medium">Completa los detalles del nuevo encuentro.</p>
            </div>
            
            <form onSubmit={handleAddGame} className="space-y-6">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Equipo Local</label>
                <select name="homeTeamId" required className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl px-5 py-4 font-bold focus:outline-none focus:ring-4 focus:ring-indigo-600/20 text-slate-900 dark:text-white transition-all appearance-none">
                  <option value="">Seleccionar Equipo</option>
                  {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Equipo Visitante</label>
                <select name="awayTeamId" required className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl px-5 py-4 font-bold focus:outline-none focus:ring-4 focus:ring-indigo-600/20 text-slate-900 dark:text-white transition-all appearance-none">
                  <option value="">Seleccionar Equipo</option>
                  {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Fecha y Hora</label>
                  <input name="date" type="datetime-local" required className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl px-4 py-4 font-bold focus:outline-none focus:ring-4 focus:ring-indigo-600/20 text-slate-900 dark:text-white transition-all" />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Campo</label>
                  <input name="field" required placeholder="Nombre del campo" className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl px-5 py-4 font-bold focus:outline-none focus:ring-4 focus:ring-indigo-600/20 text-slate-900 dark:text-white transition-all" />
                </div>
              </div>
              
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Jornada (Opcional)</label>
                <input name="jornada" type="number" placeholder="Ej. 1" className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl px-5 py-4 font-bold focus:outline-none focus:ring-4 focus:ring-indigo-600/20 text-slate-900 dark:text-white transition-all" />
              </div>
              
              <div className="flex gap-4 pt-4">
                <button
                  type="button"
                  onClick={() => setShowAddGame(false)}
                  className="flex-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-900 dark:text-white font-bold py-4 px-6 rounded-2xl transition-all"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-4 px-6 rounded-2xl transition-all shadow-xl shadow-indigo-600/20"
                >
                  Crear Partido
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* Games Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {filteredGames.length === 0 ? (
          <div className="col-span-full bg-gradient-to-br from-indigo-500/10 via-purple-500/5 to-blue-500/10 dark:from-indigo-500/20 dark:via-purple-500/10 dark:to-blue-500/20 border-2 border-dashed border-indigo-200 dark:border-slate-700 rounded-[2.5rem] p-16 text-center space-y-6 shadow-inner">
            <div className="w-24 h-24 bg-white dark:bg-slate-800 rounded-[2rem] flex items-center justify-center mx-auto shadow-xl shadow-indigo-500/10 rotate-3">
              <Calendar className="w-12 h-12 text-indigo-500 dark:text-indigo-400" />
            </div>
            <div className="space-y-2">
              <p className="text-slate-900 dark:text-white font-black text-xl uppercase tracking-tight">
                {statusFilter === 'completed' ? 'No hay resultados registrados' : 'No hay partidos programados'}
              </p>
              <p className="text-slate-500 dark:text-slate-400 font-medium max-w-xs mx-auto">
                {statusFilter === 'completed' 
                  ? 'Aún no se han finalizado partidos en esta categoría o jornada.' 
                  : 'Selecciona otra categoría o crea un nuevo partido para comenzar.'}
              </p>
            </div>
          </div>
        ) : (
          filteredGames.map(game => (
            <GameCard 
              key={game.id} 
              game={game} 
              onClick={() => onSelectGame(game.id)} 
              onOpenLineup={() => onSelectGame(game.id, 'lineup')}
              canEdit={canEditGame(game)}
              onEdit={() => handleOpenEditGame(game)}
              teams={teams}
              isJefe={isJefe}
              isUploading={uploadingGameId === game.id}
              onOpenUploadModal={(cat = 'batting') => {
                setUploadModalInitialGameId(game.id);
                setUploadModalCategory(cat);
                setShowScorebookUploadModal(true);
              }}
              onDeleteBook={() => setGameToDeleteBooks(game)}
              onUploadBook={(file) => handleUploadBook(game.id, file)}
              onViewBook={() => setSelectedBookGame(game)}
            />
          ))
        )}
      </div>

      {/* Scorebook Upload Modal (Exclusivo Jefe de Categoría) */}
      <AnimatePresence>
        {showScorebookUploadModal && (
          <ScorebookUploadModal
            games={games}
            teams={teams}
            userProfile={userProfile}
            initialGameId={uploadModalInitialGameId}
            initialCategory={uploadModalCategory}
            onClose={() => {
              setShowScorebookUploadModal(false);
              setUploadModalInitialGameId(null);
            }}
            onSuccess={(updatedGame) => {
              setShowScorebookUploadModal(false);
              setUploadModalInitialGameId(null);
              setSelectedBookGame(updatedGame);
              setUploadSuccessMessage('¡Libro digitalizado y Box Score generado con éxito usando las cédulas oficiales!');
              setTimeout(() => setUploadSuccessMessage(null), 5000);
            }}
          />
        )}
      </AnimatePresence>

      {/* Scorebook & Box Score Modal */}
      <AnimatePresence>
        {selectedBookGame && (
          <ScorebookModal
            game={selectedBookGame}
            isJefe={isJefe}
            userProfile={userProfile}
            onClose={() => setSelectedBookGame(null)}
            onUploadBook={handleUploadBook}
            isUploading={uploadingGameId === selectedBookGame.id}
          />
        )}
      </AnimatePresence>

      {/* Modal Confirmación Borrar Libros de Anotación */}
      <AnimatePresence>
        {gameToDeleteBooks && (
          <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 sm:p-7 max-w-md w-full shadow-2xl space-y-5 text-slate-900 dark:text-white"
            >
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-rose-500/10 text-rose-500 flex items-center justify-center">
                  <Trash2 className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-base sm:text-lg font-black uppercase tracking-tight">
                    Borrar Libros de Anotación
                  </h3>
                  <p className="text-xs text-slate-400 font-bold uppercase tracking-wider">
                    {gameToDeleteBooks.awayTeamName} vs {gameToDeleteBooks.homeTeamName}
                  </p>
                </div>
              </div>

              <div className="p-3.5 bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/40 rounded-2xl text-xs space-y-1.5 text-rose-800 dark:text-rose-300">
                <p className="font-bold">¿Estás seguro de que deseas borrar los libros de este partido?</p>
                <p className="text-[11px] opacity-90 leading-relaxed">
                  Esta acción eliminará las hojas cargadas (bateo, lanzamientos) y los datos digitalizados de Box Score y conteo de lanzamientos de este partido.
                </p>
              </div>

              {/* Si hay hojas individuales cargadas, mostrarlas */}
              {gameToDeleteBooks.scorebooks && (
                <div className="space-y-2">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                    Hojas registradas en este partido:
                  </p>
                  <div className="space-y-1 text-xs">
                    {gameToDeleteBooks.scorebooks.awayBatting && (
                      <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60">
                        <span className="font-bold">⚾ 1. Bateo {gameToDeleteBooks.awayTeamName}</span>
                        <button
                          type="button"
                          disabled={deletingBooks}
                          onClick={() => handleConfirmDeleteBooks('awayBatting')}
                          className="text-[10px] font-bold text-rose-600 hover:underline cursor-pointer"
                        >
                          Borrar sólo esta
                        </button>
                      </div>
                    )}
                    {gameToDeleteBooks.scorebooks.awayPitching && (
                      <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60">
                        <span className="font-bold">🎯 2. Lanzamientos {gameToDeleteBooks.awayTeamName}</span>
                        <button
                          type="button"
                          disabled={deletingBooks}
                          onClick={() => handleConfirmDeleteBooks('awayPitching')}
                          className="text-[10px] font-bold text-rose-600 hover:underline cursor-pointer"
                        >
                          Borrar sólo esta
                        </button>
                      </div>
                    )}
                    {gameToDeleteBooks.scorebooks.homeBatting && (
                      <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60">
                        <span className="font-bold">⚾ 3. Bateo {gameToDeleteBooks.homeTeamName}</span>
                        <button
                          type="button"
                          disabled={deletingBooks}
                          onClick={() => handleConfirmDeleteBooks('homeBatting')}
                          className="text-[10px] font-bold text-rose-600 hover:underline cursor-pointer"
                        >
                          Borrar sólo esta
                        </button>
                      </div>
                    )}
                    {gameToDeleteBooks.scorebooks.homePitching && (
                      <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60">
                        <span className="font-bold">🎯 4. Lanzamientos {gameToDeleteBooks.homeTeamName}</span>
                        <button
                          type="button"
                          disabled={deletingBooks}
                          onClick={() => handleConfirmDeleteBooks('homePitching')}
                          className="text-[10px] font-bold text-rose-600 hover:underline cursor-pointer"
                        >
                          Borrar sólo esta
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  disabled={deletingBooks}
                  onClick={() => setGameToDeleteBooks(null)}
                  className="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={deletingBooks}
                  onClick={() => handleConfirmDeleteBooks()}
                  className="flex items-center gap-2 px-5 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all shadow-lg shadow-rose-600/20 active:scale-95 cursor-pointer disabled:opacity-50"
                >
                  {deletingBooks ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Borrando...</span>
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Borrar Todos los Libros</span>
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      {/* Excel Schedule Upload Modal */}
      <ExcelScheduleModal
        isOpen={showExcelUploadModal}
        onClose={() => setShowExcelUploadModal(false)}
        teams={teams}
        seasons={seasons}
        onImportSuccess={(count) => {
          setUploadSuccessMessage(`¡Se agregaron ${count} partidos al calendario correctamente!`);
          setTimeout(() => setUploadSuccessMessage(null), 6000);
        }}
      />

      {/* Schedule PDF Export Modal */}
      <ScheduleExportModal
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
        games={games}
        teams={teams}
        seasons={seasons}
        initialCategory={selectedCategory === 'Todas' ? 'All' : selectedCategory}
        initialJornada={selectedJornada}
      />

      {/* Modal: Editar Partido & Borrar Juego */}
      <AnimatePresence>
        {editingGame && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[70] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-3xl p-6 sm:p-8 max-w-md w-full space-y-6 shadow-2xl text-slate-900 dark:text-white"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100">Editar Partido</h3>
                  <div className="flex items-center gap-2 mt-1">
                    <TeamLogo teamId={editFormData.awayTeamId} size="xs" />
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                      {formatTeamName(teams.find(t => t.id === editFormData.awayTeamId)?.name || editingGame.awayTeamName)}
                    </span>
                    <span className="text-xs text-slate-400 font-normal">vs</span>
                    <TeamLogo teamId={editFormData.homeTeamId} size="xs" />
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                      {formatTeamName(teams.find(t => t.id === editFormData.homeTeamId)?.name || editingGame.homeTeamName)}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => setEditingGame(null)}
                  className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-white rounded-xl transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleSaveEditGame} className="space-y-4">
                {/* Equipos */}
                <div className="p-3.5 bg-slate-50 dark:bg-slate-900/60 rounded-2xl border border-slate-100 dark:border-slate-800 space-y-3">
                  <div className="text-[10px] font-black uppercase tracking-wider text-slate-400 flex items-center justify-between">
                    <span>Equipos Contendientes</span>
                    <button
                      type="button"
                      onClick={() => {
                        setEditFormData(prev => ({
                          ...prev,
                          awayTeamId: prev.homeTeamId,
                          homeTeamId: prev.awayTeamId
                        }));
                      }}
                      className="text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 font-bold hover:underline cursor-pointer flex items-center gap-1"
                    >
                      ⇄ Intercambiar (Local / Visitante)
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                        <TeamLogo teamId={editFormData.awayTeamId} size="xs" />
                        <span>Visitante (1)</span>
                      </label>
                      <select
                        value={editFormData.awayTeamId}
                        onChange={(e) => setEditFormData({ ...editFormData, awayTeamId: e.target.value })}
                        className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
                      >
                        {teams.map(t => (
                          <option key={t.id} value={t.id}>{formatTeamName(t.name)} ({t.category})</option>
                        ))}
                        {!teams.some(t => t.id === editFormData.awayTeamId) && editFormData.awayTeamId && (
                          <option value={editFormData.awayTeamId}>{formatTeamName(editingGame.awayTeamName || editFormData.awayTeamId)}</option>
                        )}
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                        <TeamLogo teamId={editFormData.homeTeamId} size="xs" />
                        <span>Local (2)</span>
                      </label>
                      <select
                        value={editFormData.homeTeamId}
                        onChange={(e) => setEditFormData({ ...editFormData, homeTeamId: e.target.value })}
                        className="w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-xs font-bold text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
                      >
                        {teams.map(t => (
                          <option key={t.id} value={t.id}>{formatTeamName(t.name)} ({t.category})</option>
                        ))}
                        {!teams.some(t => t.id === editFormData.homeTeamId) && editFormData.homeTeamId && (
                          <option value={editFormData.homeTeamId}>{formatTeamName(editingGame.homeTeamName || editFormData.homeTeamId)}</option>
                        )}
                      </select>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Fecha</label>
                    <input
                      type="date"
                      required
                      value={editFormData.date}
                      onChange={(e) => setEditFormData({ ...editFormData, date: e.target.value })}
                      className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Jornada</label>
                    <input
                      type="number"
                      min={1}
                      max={35}
                      value={editFormData.jornada || ''}
                      onChange={(e) => setEditFormData({ ...editFormData, jornada: e.target.value ? parseInt(e.target.value, 10) : undefined })}
                      className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Horario</label>
                    <input
                      type="time"
                      required
                      value={editFormData.time}
                      onChange={(e) => setEditFormData({ ...editFormData, time: e.target.value })}
                      className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Campo</label>
                    <input
                      type="text"
                      required
                      value={editFormData.field}
                      onChange={(e) => setEditFormData({ ...editFormData, field: e.target.value })}
                      className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      placeholder="Ej. Zorros"
                    />
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-2">
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => setEditingGame(null)}
                      className="flex-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold py-3 rounded-xl transition-all text-sm cursor-pointer"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-xl transition-all text-sm shadow-lg shadow-indigo-600/20 cursor-pointer"
                    >
                      Guardar Cambios
                    </button>
                  </div>

                  {/* Borrar Juego Option */}
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteSingleGame(editingGame)}
                    className="w-full bg-red-500/10 hover:bg-red-500/20 text-red-600 dark:text-red-400 font-bold py-2.5 rounded-xl transition-all text-xs flex items-center justify-center gap-2 cursor-pointer border border-red-500/20"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>Borrar este partido permanentemente</span>
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal: Confirm Delete Single Game */}
      <AnimatePresence>
        {confirmDeleteSingleGame && (
          <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-[80] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 sm:p-8 max-w-md w-full space-y-5 text-center shadow-2xl"
            >
              <div className="w-16 h-16 bg-red-500/10 text-red-600 dark:text-red-400 rounded-2xl flex items-center justify-center mx-auto">
                <Trash2 className="w-8 h-8" />
              </div>
              <div className="space-y-1">
                <h3 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-tight">
                  ¿Borrar Partido?
                </h3>
                <p className="text-sm font-bold text-indigo-600 dark:text-indigo-400">
                  {formatTeamName(confirmDeleteSingleGame.awayTeamName)} vs {formatTeamName(confirmDeleteSingleGame.homeTeamName)}
                  {confirmDeleteSingleGame.jornada ? ` • Jornada ${confirmDeleteSingleGame.jornada}` : ''}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 pt-2">
                  Esta acción eliminará este partido de forma permanente de la base de datos y desaparecerá de todos los apartados (Partidos, Rol de Juego, Posiciones y PDF).
                </p>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  disabled={isDeletingGame}
                  onClick={() => setConfirmDeleteSingleGame(null)}
                  className="flex-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold py-3 rounded-xl transition-all text-xs uppercase tracking-wider cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={isDeletingGame}
                  onClick={handleDeleteSingleGame}
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white font-bold py-3 rounded-xl transition-all text-xs uppercase tracking-wider shadow-lg shadow-red-600/25 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  {isDeletingGame ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Trash2 className="w-4 h-4" />
                  )}
                  <span>{isDeletingGame ? 'Borrando...' : 'Sí, Borrar'}</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

interface GameCardProps {
  game: Game;
  onClick: () => void;
  onOpenLineup: () => void;
  canEdit?: boolean;
  onEdit?: () => void;
  teams: Team[];
  isJefe: boolean;
  isUploading: boolean;
  onOpenUploadModal: (category?: 'batting' | 'pitching') => void;
  onDeleteBook: () => void;
  onUploadBook: (file: File) => void;
  onViewBook: () => void;
}

const GameCard: React.FC<GameCardProps> = ({ 
  game, 
  onClick, 
  onOpenLineup,
  canEdit,
  onEdit,
  teams, 
  isJefe, 
  isUploading, 
  onOpenUploadModal,
  onDeleteBook,
  onUploadBook, 
  onViewBook 
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isLive = game.status === 'in-progress';
  const isCompleted = game.status === 'completed';
  const homeTeam = teams.find(t => t.id === game.homeTeamId);
  const hasBooks = hasUploadedBooks(game);
  const sheetCount = getUploadedSheetsCount(game);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onUploadBook(file);
    }
    e.target.value = '';
  };

  return (
    <div
      onClick={onClick}
      className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-indigo-600/50 rounded-[2rem] p-6 transition-all group text-left relative overflow-hidden shadow-sm hover:shadow-2xl hover:shadow-indigo-600/5 dark:shadow-none flex flex-col h-full cursor-pointer"
    >
      {/* Hidden file input for uploading scorebook */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept="image/*,application/pdf,.pdf,.xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
        className="hidden"
      />

      {isLive && (
        <div className="absolute top-0 left-0 w-full h-1 bg-indigo-600 animate-pulse" />
      )}
      
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
            {isLive ? (
              <span className="text-rose-500 flex items-center gap-1">
                <div className="w-1.5 h-1.5 bg-rose-500 rounded-full animate-pulse" />
                En Vivo • {game.inning}ª
              </span>
            ) : isCompleted ? (
              <span className="text-emerald-500 dark:text-emerald-400 font-black">Finalizado</span>
            ) : (
              new Date(game.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            )}
          </span>
          {game.jornada !== undefined && (
            <span className="text-[9px] font-black bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 px-2 py-0.5 rounded-full uppercase tracking-wider">
              Jornada {game.jornada}
            </span>
          )}
        </div>
        <span className="text-[10px] font-black text-indigo-600/80 dark:text-indigo-400 uppercase tracking-widest bg-slate-100 dark:bg-slate-800/80 px-2 py-0.5 rounded-md">
          {game.category || homeTeam?.category || 'General'}
        </span>
      </div>

      <div className="space-y-4 flex-1">
        {/* Away Team */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <TeamLogo
              teamId={game.awayTeamId}
              teamName={game.awayTeamName}
              size="sm"
              className="w-8 h-8 rounded-lg shadow-sm"
            />
            <h4 className="text-sm font-black tracking-tight text-slate-900 dark:text-white uppercase truncate max-w-[100px]">{formatTeamName(game.awayTeamName)}</h4>
          </div>
          {isCompleted || isLive || hasBooks || ((game.score?.away ?? 0) > 0 || (game.score?.home ?? 0) > 0) ? (
            <span className={`text-xl font-black ${(game.score?.away ?? 0) > (game.score?.home ?? 0) ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400 dark:text-slate-600'}`}>
              {game.score?.away ?? 0}
            </span>
          ) : (
            <span className="text-base font-bold text-slate-300 dark:text-slate-600 px-2">
              -
            </span>
          )}
        </div>

        {/* Home Team */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <TeamLogo
              teamId={game.homeTeamId}
              teamName={game.homeTeamName}
              size="sm"
              className="w-8 h-8 rounded-lg shadow-sm"
            />
            <h4 className="text-sm font-black tracking-tight text-slate-900 dark:text-white uppercase truncate max-w-[100px]">{formatTeamName(game.homeTeamName)}</h4>
          </div>
          {isCompleted || isLive || hasBooks || ((game.score?.away ?? 0) > 0 || (game.score?.home ?? 0) > 0) ? (
            <span className={`text-xl font-black ${(game.score?.home ?? 0) > (game.score?.away ?? 0) ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400 dark:text-slate-600'}`}>
              {game.score?.home ?? 0}
            </span>
          ) : (
            <span className="text-base font-bold text-slate-300 dark:text-slate-600 px-2">
              -
            </span>
          )}
        </div>

        {game.winningPitcher && (
          <div className="flex items-center gap-1.5 pt-2 border-t border-slate-100/80 dark:border-slate-800/80 text-[10px] text-amber-600 dark:text-amber-400 font-bold truncate">
            <Trophy className="w-3 h-3 text-amber-500 shrink-0" />
            <span className="truncate">PG: {game.winningPitcher}</span>
            {game.losingPitcher && (
              <span className="text-slate-400 dark:text-slate-500 font-medium truncate">
                • PP: {game.losingPitcher}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Card Footer */}
      <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
        <div className="flex flex-col">
          <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">
            {new Date(game.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
          </span>
          <span className="text-[8px] font-black text-indigo-600/50 uppercase tracking-widest truncate max-w-[80px]">
            {formatFieldName(game.field) || 'Campo Principal'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {canEdit && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onEdit?.();
              }}
              className="p-1.5 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 rounded-xl transition-all cursor-pointer"
              title="Editar o borrar este partido"
            >
              <Edit3 className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Ver Libro si ya tiene archivo cargado */}
          {hasBooks && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onViewBook();
              }}
              className="flex items-center gap-1 px-2.5 py-1 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer"
              title={game.boxScore ? "Ver Box Score y libros de anotación" : "Ver libro de anotación"}
            >
              {game.boxScore ? <TableIcon className="w-3 h-3 text-emerald-500" /> : <FileCheck className="w-3 h-3 text-emerald-500" />}
              <span>Ver Libro {sheetCount > 1 ? `(${sheetCount}/4)` : ''}</span>
            </button>
          )}

          {/* Botón Borrar Libro en lugar de Cambiar Libro */}
          {isJefe && hasBooks && (
            <button
              type="button"
              disabled={isUploading}
              onClick={(e) => {
                e.stopPropagation();
                onDeleteBook();
              }}
              className="flex items-center gap-1 px-2.5 py-1 bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/30 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all shadow-sm cursor-pointer active:scale-95"
              title="Borrar los libros de anotación de este partido"
            >
              <Trash2 className="w-3 h-3 text-rose-500" />
              <span>Borrar Libro</span>
            </button>
          )}

          {/* Botones Subir Libro Bateo y Subir Libro Lanzamientos a un costado de Lineup */}
          {isJefe && (
            <>
              <button
                type="button"
                disabled={isUploading}
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenUploadModal('batting');
                }}
                className="flex items-center gap-1 px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all shadow-sm shadow-indigo-600/20 cursor-pointer active:scale-95"
                title="Subir libro de bateo de un equipo (1. Visitante o 3. Local)"
              >
                {isUploading ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <BookOpen className="w-3 h-3" />
                )}
                <span>Subir Libro Bateo</span>
              </button>

              <button
                type="button"
                disabled={isUploading}
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenUploadModal('pitching');
                }}
                className="flex items-center gap-1 px-2.5 py-1 bg-violet-600 hover:bg-violet-700 text-white rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all shadow-sm shadow-violet-600/20 cursor-pointer active:scale-95"
                title="Subir libro de lanzamientos de los pitchers (2. Visitante o 4. Local)"
              >
                {isUploading ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Activity className="w-3 h-3" />
                )}
                <span>Subir Libro Lanzamientos</span>
              </button>
            </>
          )}

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenLineup();
            }}
            className="flex items-center gap-1 px-2.5 py-1 bg-indigo-50 dark:bg-indigo-950/60 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all cursor-pointer"
            title="Abrir la pestaña de Lineup de este partido"
          >
            <Users className="w-3 h-3" />
            <span>Lineup</span>
          </button>
          <div className="w-8 h-8 rounded-xl bg-slate-50 dark:bg-slate-800 flex items-center justify-center group-hover:bg-indigo-600 transition-all duration-300">
            <ChevronRight className="w-4 h-4 text-slate-300 dark:text-slate-600 group-hover:text-white transition-colors" />
          </div>
        </div>
      </div>
    </div>
  );
};
