import React, { useState, useEffect, useMemo, useRef } from 'react';
import { db, auth, handleFirestoreError, OperationType } from '../firebase';
import { collection, onSnapshot, query, addDoc, writeBatch, doc, getDocs, where, orderBy, updateDoc, deleteDoc } from 'firebase/firestore';
import { Team, Game, CATEGORIES, Category, CATEGORY_FIELDS, Season, GAME_SLOTS, GameSlot, UserProfile, TournamentType, TOURNAMENTS, DayOfWeek, GameTime, formatFieldName, formatTeamName } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { Calendar, Plus, Play, Trash2, CheckCircle2, AlertCircle, MapPin, Settings2, User, Cpu, Lock, Trophy, GripVertical, Clock, Check, Edit3, X, Sparkles, Search, Filter, FileSpreadsheet, Loader2, ArrowRight, FileDown, Scale, CalendarClock, CloudRain } from 'lucide-react';
import ExcelScheduleModal from './ExcelScheduleModal';
import ScheduleExportModal from './ScheduleExportModal';
import ColtEquityModal from './ColtEquityModal';
import RecorrerJornadaModal from './RecorrerJornadaModal';
import AutoGenerateScheduleModal from './AutoGenerateScheduleModal';
import TeamLogo from './TeamLogo';

export default function ScheduleManager({ 
  userProfile,
  onNavigateToDashboard 
}: { 
  userProfile: UserProfile | null;
  onNavigateToDashboard?: () => void;
}) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewSeason, setShowNewSeason] = useState(false);
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const [viewCategory, setViewCategory] = useState<Category | 'All'>('All');
  const [viewTournament, setViewTournament] = useState<TournamentType | 'All'>('All');
  const [viewJornada, setViewJornada] = useState<number | 'All'>('All');
  const [filterScheduleStatus, setFilterScheduleStatus] = useState<'all' | 'assigned' | 'pending'>('all');
  const [searchTeam, setSearchTeam] = useState('');

  // Drag and Drop & Assignment State
  const [selectedWeekendBase, setSelectedWeekendBase] = useState<string>('2026-10-10');

  const [selectedAssignmentField, setSelectedAssignmentField] = useState<string>('auto');
  const [customFieldInput, setCustomFieldInput] = useState<string>('');
  const [isCustomField, setIsCustomField] = useState<boolean>(false);
  const [activeSlot, setActiveSlot] = useState<GameSlot | null>(null);
  const [draggedSlot, setDraggedSlot] = useState<{ day: DayOfWeek; time: GameTime; date: string; field: string } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOverGameId, setDragOverGameId] = useState<string | null>(null);
  const [recentlyUpdatedGameId, setRecentlyUpdatedGameId] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [editingGame, setEditingGame] = useState<Game | null>(null);
  const [editFormData, setEditFormData] = useState<{ awayTeamId: string; homeTeamId: string; date: string; time: string; field: string; jornada?: number }>({ awayTeamId: '', homeTeamId: '', date: '', time: '08:00', field: '' });
  const [confirmDeleteSingleGame, setConfirmDeleteSingleGame] = useState<Game | null>(null);
  const [isDeletingGame, setIsDeletingGame] = useState(false);
  const [seasonToDelete, setSeasonToDelete] = useState<Season | null>(null);
  const [isDeletingSeason, setIsDeletingSeason] = useState(false);

  // Excel Schedule Upload Modal State
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showColtEquityModal, setShowColtEquityModal] = useState(false);
  const [showRecorrerModal, setShowRecorrerModal] = useState(false);
  const [showAutoGenerateModal, setShowAutoGenerateModal] = useState(false);
  const [isCustomEditField, setIsCustomEditField] = useState(false);
  const [isCustomEditTime, setIsCustomEditTime] = useState(false);

  const canEdit = (category: Category) => {
    if (!userProfile) return false;
    if (userProfile.role === 'admin') return true;
    if (userProfile.role === 'jefe_categoria' && userProfile.category === category) return true;
    return false;
  };

  const isJefe = userProfile?.role === 'jefe_categoria';
  const userCategory = userProfile?.category;

  const normalizeStr = (str: any): string => {
    return String(str || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
  };



  useEffect(() => {
    if (isJefe && userCategory) {
      setViewCategory(userCategory);
    }
  }, [isJefe, userCategory]);

  useEffect(() => {
    const teamsQuery = query(collection(db, 'teams'));
    const unsubscribeTeams = onSnapshot(teamsQuery, (snapshot) => {
      setTeams(snapshot.docs.map(doc => {
        const d = doc.data();
        return { id: doc.id, ...d, name: formatTeamName(d.name) } as Team;
      }));

      // Background migration to ensure all team names in Firestore are permanently UPPERCASE
      if (userProfile?.role === 'admin' || userProfile?.email === 'llorch7@gmail.com') {
        snapshot.docs.forEach(docSnap => {
          const d = docSnap.data();
          if (d.name && d.name !== formatTeamName(d.name)) {
            updateDoc(docSnap.ref, { name: formatTeamName(d.name) }).catch(() => {});
          }
        });
      }
    }, (error) => {
      console.error("Error fetching teams in ScheduleManager:", error);
    });

    const seasonsQuery = query(collection(db, 'seasons'));
    const unsubscribeSeasons = onSnapshot(seasonsQuery, (snapshot) => {
      setSeasons(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Season)));
    }, (error) => {
      console.error("Error fetching seasons in ScheduleManager:", error);
    });

    const gamesQuery = query(collection(db, 'games'), orderBy('date', 'asc'));
    const unsubscribeGames = onSnapshot(gamesQuery, (snapshot) => {
      const loaded = snapshot.docs.map(doc => {
        const d = doc.data();
        return {
          id: doc.id,
          ...d,
          homeTeamName: formatTeamName(d.homeTeamName),
          awayTeamName: formatTeamName(d.awayTeamName)
        } as Game;
      });
      setGames(loaded);
      setLoading(false);

      // Clean up legacy lowercase/mixedcase team names and Zorros fields in existing game documents
      if (userProfile?.role === 'admin' || userProfile?.email === 'llorch7@gmail.com') {
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
      console.error("Error fetching games in ScheduleManager:", error);
      setLoading(false);
    });

    return () => {
      unsubscribeTeams();
      unsubscribeSeasons();
      unsubscribeGames();
    };
  }, []);

  // Auto-sync selectedWeekendBase with current games or viewed jornada
  useEffect(() => {
    if (viewJornada !== 'All') {
      const jornadaGames = games.filter(g => g.jornada === viewJornada && g.date);
      if (jornadaGames.length > 0) {
        const firstDate = new Date(jornadaGames[0].date);
        if (!isNaN(firstDate.getTime())) {
          const day = firstDate.getDay();
          const sat = new Date(firstDate);
          if (day === 0) sat.setDate(sat.getDate() - 1);
          const yyyy = sat.getFullYear();
          const mm = String(sat.getMonth() + 1).padStart(2, '0');
          const dd = String(sat.getDate()).padStart(2, '0');
          setSelectedWeekendBase(`${yyyy}-${mm}-${dd}`);
        }
      }
    }
  }, [viewJornada, games]);

  // Compute all available fields from categories and existing games
  const allKnownFields = useMemo(() => {
    const setOfFields = new Set<string>();
    Object.values(CATEGORY_FIELDS).forEach(fields => {
      fields.forEach(f => setOfFields.add(formatFieldName(f)));
    });
    games.forEach(g => {
      if (g.field && g.field.trim()) setOfFields.add(formatFieldName(g.field.trim()));
    });
    return Array.from(setOfFields).sort();
  }, [games]);

  // Helper to calculate exact date string (YYYY-MM-DD) for a slot given the base date
  const getSlotDate = (slotDay: DayOfWeek, baseDateStr: string): { dateStr: string; displayStr: string } => {
    if (!baseDateStr) return { dateStr: '', displayStr: '' };
    const [y, m, d] = baseDateStr.split('-').map(Number);
    const base = new Date(y, m - 1, d);
    const baseDay = base.getDay(); // 0 is Sunday, 6 is Saturday
    const target = new Date(base);

    if (slotDay === 'Sabado') {
      if (baseDay === 6) {
        // already Saturday
      } else if (baseDay === 0) {
        target.setDate(target.getDate() - 1);
      } else {
        target.setDate(target.getDate() + (6 - baseDay));
      }
    } else {
      // Domingo
      if (baseDay === 0) {
        // already Sunday
      } else if (baseDay === 6) {
        target.setDate(target.getDate() + 1);
      } else {
        target.setDate(target.getDate() + (7 - baseDay));
      }
    }

    const yyyy = target.getFullYear();
    const mm = String(target.getMonth() + 1).padStart(2, '0');
    const dd = String(target.getDate()).padStart(2, '0');
    const dateStr = `${yyyy}-${mm}-${dd}`;
    const displayStr = target.toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' });
    return { dateStr, displayStr };
  };

  const formatGameDateTime = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return { day: '', date: dateStr, time: '' };
      const dayName = d.toLocaleDateString('es-MX', { weekday: 'long' });
      const capitalizedDay = dayName.charAt(0).toUpperCase() + dayName.slice(1);
      const dateFormatted = d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
      const timeFormatted = d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: true });
      return {
        day: capitalizedDay,
        date: dateFormatted,
        time: timeFormatted,
        isWeekend: d.getDay() === 0 || d.getDay() === 6
      };
    } catch (e) {
      return { day: '', date: dateStr, time: '', isWeekend: false };
    }
  };

  // ==========================================
  // EXCEL SCHEDULE (ROL POR JORNADA) PARSING
  // ==========================================

  const handleCreateSeason = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const startDate = formData.get('startDate') as string;
    const newSeason = {
      name: formData.get('name') as string,
      startDate: startDate || new Date().toISOString().split('T')[0],
      active: true,
    };

    try {
      await addDoc(collection(db, 'seasons'), newSeason);
      setShowNewSeason(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'seasons');
    }
  };

  const handleDeleteSeason = (season: Season) => {
    setSeasonToDelete(season);
  };

  const executeDeleteSeason = async () => {
    if (!seasonToDelete) return;
    setIsDeletingSeason(true);

    try {
      const targetId = seasonToDelete.id;
      const targetName = seasonToDelete.name;
      await deleteDoc(doc(db, 'seasons', targetId));
      setSeasons(prev => prev.filter(s => s.id !== targetId));
      setNotification({
        type: 'success',
        message: `Temporada "${targetName}" eliminada correctamente de la base de datos.`
      });
      setTimeout(() => setNotification(null), 4000);
      setSeasonToDelete(null);
    } catch (error) {
      console.error("Error deleting season:", error);
      handleFirestoreError(error, OperationType.DELETE, 'seasons');
      setNotification({
        type: 'error',
        message: 'No se pudo eliminar la temporada de la base de datos.'
      });
    } finally {
      setIsDeletingSeason(false);
    }
  };

  const clearGames = async () => {
    try {
      const snapshot = await getDocs(query(collection(db, 'games'), where('status', '==', 'scheduled')));
      const batch = writeBatch(db);
      snapshot.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
      setShowConfirmDelete(false);
      setNotification({
        type: 'success',
        message: 'Todos los partidos programados han sido eliminados.'
      });
      setTimeout(() => setNotification(null), 4000);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'games');
    }
  };

  // Assign a slot (day, time, date, field) to a specific game document
  const assignSlotToGame = async (
    game: Game,
    slotData: { day: string; time: string; date: string; field: string }
  ) => {
    const gameCategory = (teams.find(t => t.id === game.homeTeamId)?.category || 'Infantil') as Category;
    if (!canEdit(gameCategory)) {
      setNotification({
        type: 'error',
        message: `No tienes permisos para modificar partidos de la categoría ${gameCategory}.`
      });
      setTimeout(() => setNotification(null), 4000);
      return;
    }

    const [hours, minutes] = slotData.time.split(':');
    const [y, m, d] = slotData.date.split('-').map(Number);
    const gameDate = new Date(y, m - 1, d, parseInt(hours, 10), parseInt(minutes, 10), 0, 0);

    let targetField = slotData.field;
    if (!targetField || targetField === 'auto') {
      const defaultFields = CATEGORY_FIELDS[gameCategory];
      targetField = defaultFields && defaultFields.length > 0 ? defaultFields[0] : (game.field || 'Campo Municipal 1');
    }

    try {
      const gameRef = doc(db, 'games', game.id);
      await updateDoc(gameRef, {
        date: gameDate.toISOString(),
        field: targetField
      });

      setRecentlyUpdatedGameId(game.id);
      setTimeout(() => setRecentlyUpdatedGameId(null), 3500);

      const formattedTime = gameDate.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: true });
      const formattedDate = gameDate.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'short' });
      setNotification({
        type: 'success',
        message: `¡Asignado! ${game.awayTeamName} vs ${game.homeTeamName} ➔ ${formattedDate} a las ${formattedTime} en ${targetField}`
      });
      setTimeout(() => setNotification(null), 5000);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'games');
      setNotification({
        type: 'error',
        message: 'Error al actualizar el horario del partido.'
      });
      setTimeout(() => setNotification(null), 4000);
    }
  };

  // Drag start handler on slots
  const handleDragStartSlot = (e: React.DragEvent, slot: GameSlot) => {
    const slotDateInfo = getSlotDate(slot.day, selectedWeekendBase);
    const resolvedField = isCustomField ? (customFieldInput.trim() || 'Campo Principal') : selectedAssignmentField;
    const payload = {
      day: slot.day,
      time: slot.time,
      date: slotDateInfo.dateStr,
      field: resolvedField,
    };
    e.dataTransfer.setData('application/json', JSON.stringify(payload));
    e.dataTransfer.setData('text/plain', JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'copyMove';
    setIsDragging(true);
    setDraggedSlot(payload);
  };

  const handleDragEndSlot = () => {
    setIsDragging(false);
    setDraggedSlot(null);
    setDragOverGameId(null);
  };

  // Drop handler on scheduled game card
  const handleDropOnGame = async (e: React.DragEvent, game: Game) => {
    e.preventDefault();
    setDragOverGameId(null);
    setIsDragging(false);
    setDraggedSlot(null);

    const rawData = e.dataTransfer.getData('application/json') || e.dataTransfer.getData('text/plain');
    if (!rawData) return;
    try {
      const slotData = JSON.parse(rawData);
      await assignSlotToGame(game, slotData);
    } catch (err) {
      console.error('Error parsing dropped slot:', err);
    }
  };

  // Category & fields for the currently edited game
  const editingCategory = useMemo(() => {
    if (!editingGame) return 'Colt' as Category;
    if (editingGame.category) return editingGame.category;
    const home = teams.find(t => t.id === editingGame.homeTeamId);
    return (home?.category || 'Colt') as Category;
  }, [editingGame, teams]);

  const editingCategoryFields = useMemo(() => {
    const fields = CATEGORY_FIELDS[editingCategory] ? [...CATEGORY_FIELDS[editingCategory]] : ['Zorros', 'Cliserio Sanchez'];
    if (editingCategory === 'Colt') {
      if (!fields.includes('Zorros')) fields.unshift('Zorros');
      if (!fields.includes('Cliserio Sanchez')) fields.push('Cliserio Sanchez');
    }
    return fields.map(f => formatFieldName(f));
  }, [editingCategory]);

  const editingCategoryTeams = useMemo(() => {
    const list = teams.filter(t => t.category === editingCategory);
    return list.length > 0 ? list : teams;
  }, [teams, editingCategory]);

  const RANDOMIZER_TIMES = useMemo(() => [
    { value: '08:00', label: '08:00 hrs (Mañana)' },
    { value: '11:30', label: '11:30 hrs (Mediodía)' },
    { value: '12:30', label: '12:30 hrs (Tarde Cliserio)' },
    { value: '15:00', label: '15:00 hrs (3:00 PM Tarde)' },
  ], []);

  // Manual Edit Game handlers
  const handleOpenEditGame = (game: Game) => {
    setEditingGame(game);
    setIsCustomEditField(false);
    setIsCustomEditTime(false);
    const d = new Date(game.date);
    const yyyy = !isNaN(d.getTime()) ? d.getFullYear() : new Date().getFullYear();
    const mm = !isNaN(d.getTime()) ? String(d.getMonth() + 1).padStart(2, '0') : String(new Date().getMonth() + 1).padStart(2, '0');
    const dd = !isNaN(d.getTime()) ? String(d.getDate()).padStart(2, '0') : String(new Date().getDate()).padStart(2, '0');
    const hours = !isNaN(d.getTime()) ? String(d.getHours()).padStart(2, '0') : '08';
    const mins = !isNaN(d.getTime()) ? String(d.getMinutes()).padStart(2, '0') : '00';

    // Ensure robust team ID lookup even if game only had names
    const matchedAway = teams.find(t => t.id === game.awayTeamId || t.name.trim().toLowerCase() === game.awayTeamName?.trim().toLowerCase());
    const matchedHome = teams.find(t => t.id === game.homeTeamId || t.name.trim().toLowerCase() === game.homeTeamName?.trim().toLowerCase());

    setEditFormData({
      awayTeamId: matchedAway?.id || game.awayTeamId || '',
      homeTeamId: matchedHome?.id || game.homeTeamId || '',
      date: `${yyyy}-${mm}-${dd}`,
      time: `${hours}:${mins}`,
      field: game.field || '',
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
        field: editFormData.field.trim() || 'Campo Principal',
        ...(editFormData.jornada !== undefined ? { jornada: Number(editFormData.jornada) } : {})
      });
      setRecentlyUpdatedGameId(editingGame.id);
      setTimeout(() => setRecentlyUpdatedGameId(null), 3500);
      setEditingGame(null);
      setNotification({
        type: 'success',
        message: `Partido actualizado correctamente (${awayTeamName} vs ${homeTeamName}).`
      });
      setTimeout(() => setNotification(null), 4000);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'games');
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
      setNotification({
        type: 'success',
        message: `El partido (${matchText}) fue borrado permanentemente de todos los apartados.`
      });
      setTimeout(() => setNotification(null), 5000);
    } catch (err) {
      console.error("Error deleting game:", err);
      handleFirestoreError(err, OperationType.DELETE, `games/${confirmDeleteSingleGame.id}`);
      setNotification({
        type: 'error',
        message: 'No se pudo borrar el partido. Intenta de nuevo.'
      });
      setTimeout(() => setNotification(null), 4000);
    } finally {
      setIsDeletingGame(false);
    }
  };

  // Compute distinct jornadas in games
  const uniqueJornadasInGames = useMemo(() => {
    const set = new Set<number>();
    games.forEach(g => {
      if (g.jornada && !isNaN(Number(g.jornada))) set.add(Number(g.jornada));
    });
    return Array.from(set).sort((a, b) => a - b);
  }, [games]);

  // Filter games
  const filteredGames = games.filter(g => {
    const homeTeam = teams.find(t => t.id === g.homeTeamId);
    const awayTeam = teams.find(t => t.id === g.awayTeamId);
    const gameCat = g.category || homeTeam?.category || awayTeam?.category;
    const categoryMatch = viewCategory === 'All' || gameCat === viewCategory;
    const tournamentMatch = viewTournament === 'All' || g.tournament === viewTournament || (!g.tournament && viewTournament === 'Regular');
    const jornadaMatch = viewJornada === 'All' || Number(g.jornada) === Number(viewJornada);
    
    let scheduleMatch = true;
    if (filterScheduleStatus === 'assigned') {
      scheduleMatch = Boolean(g.field && g.date);
    } else if (filterScheduleStatus === 'pending') {
      scheduleMatch = !g.field || g.field.toLowerCase().includes('por definir');
    }

    let searchMatch = true;
    if (searchTeam.trim()) {
      const q = searchTeam.toLowerCase().trim();
      searchMatch = (g.homeTeamName && g.homeTeamName.toLowerCase().includes(q)) || 
                    (g.awayTeamName && g.awayTeamName.toLowerCase().includes(q)) ||
                    (g.field && g.field.toLowerCase().includes(q));
    }

    return categoryMatch && tournamentMatch && scheduleMatch && searchMatch && jornadaMatch;
  });

  // Group and sort filtered games by Jornada & date
  const gamesByJornada = useMemo(() => {
    const sorted = [...filteredGames].sort((a, b) => {
      const jA = a.jornada || 0;
      const jB = b.jornada || 0;
      if (jA !== jB) return jA - jB;
      const tA = a.date ? new Date(a.date).getTime() : 0;
      const tB = b.date ? new Date(b.date).getTime() : 0;
      return tA - tB;
    });

    const groups: { jornada: number; games: Game[]; dateSpan: string }[] = [];
    const map = new Map<number, Game[]>();

    sorted.forEach(g => {
      const j = g.jornada || 1;
      if (!map.has(j)) map.set(j, []);
      map.get(j)!.push(g);
    });

    Array.from(map.keys()).sort((a, b) => a - b).forEach(j => {
      const jGames = map.get(j)!;
      const validDates = jGames
        .map(g => g.date ? new Date(g.date) : null)
        .filter((d): d is Date => d !== null && !isNaN(d.getTime()))
        .sort((a, b) => a.getTime() - b.getTime());

      let dateSpan = 'Fechas por definir';
      if (validDates.length > 0) {
        const minD = validDates[0];
        const maxD = validDates[validDates.length - 1];
        const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
        const s1 = minD.toLocaleDateString('es-MX', opts);
        const s2 = maxD.toLocaleDateString('es-MX', opts);
        dateSpan = s1 === s2 ? s1 : `${s1} y ${s2}`;
      }

      groups.push({ jornada: j, games: jGames, dateSpan });
    });

    return groups;
  }, [filteredGames]);

  if (loading) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-8"
    >
      {/* Toast Notification */}
      <AnimatePresence>
        {notification && (
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            className={`fixed top-6 right-6 z-[100] max-w-md p-4 rounded-2xl shadow-2xl flex items-center gap-3 border ${
              notification.type === 'success'
                ? 'bg-emerald-600 text-white border-emerald-500 shadow-emerald-600/30'
                : 'bg-red-600 text-white border-red-500 shadow-red-600/30'
            }`}
          >
            {notification.type === 'success' ? (
              <Check className="w-5 h-5 flex-shrink-0" />
            ) : (
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
            )}
            <p className="text-sm font-semibold flex-1 leading-snug">{notification.message}</p>
            <button
              onClick={() => setNotification(null)}
              className="p-1 hover:bg-white/20 rounded-lg transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Roles de Juego</h2>
          <p className="text-slate-500 dark:text-slate-400">Genera y asigna campos, días y horarios a los partidos programados.</p>
        </div>
        
        <div className="flex flex-wrap items-center gap-3">
          {/* Botón: Generar Rol Automático */}
          {(userProfile?.role === 'admin' || isJefe) && (
            <button
              onClick={() => setShowAutoGenerateModal(true)}
              className="flex items-center gap-2 bg-gradient-to-r from-indigo-600 via-indigo-500 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white font-black px-5 py-3 rounded-2xl transition-all shadow-lg shadow-indigo-600/30 active:scale-95 cursor-pointer"
              title="Generar Rol de Juego Automático Round-Robin (cada equipo se enfrentará a un equipo cada jornada sin repetir equipos)"
            >
              <Sparkles className="w-5 h-5 text-amber-300" />
              <span>Generar Rol Automático</span>
            </button>
          )}

          {/* Equidad y Balance Colt */}
          <button
            onClick={() => setShowColtEquityModal(true)}
            className="flex items-center gap-2 bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 dark:hover:bg-slate-700 text-white px-5 py-3 rounded-2xl font-bold transition-all shadow-lg active:scale-95 cursor-pointer border border-slate-700/60"
            title="Ver métricas de balance y equidad de campos, días y horarios de Categoría Colt"
          >
            <Scale className="w-5 h-5 text-indigo-400" />
            <span>Equidad Colt</span>
          </button>

          {/* Recorrer Jornada por Clima */}
          <button
            onClick={() => setShowRecorrerModal(true)}
            className="flex items-center gap-2 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-slate-950 font-black px-5 py-3 rounded-2xl transition-all shadow-lg shadow-amber-500/25 active:scale-95 cursor-pointer"
            title="Recorrer una semana la jornada completa por retraso de clima o lluvia"
          >
            <CalendarClock className="w-5 h-5 text-slate-950" />
            <span>Recorrer Jornada</span>
          </button>

          {/* Exportar Rol a PDF */}
          <button
            onClick={() => setShowExportModal(true)}
            className="flex items-center gap-2 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white px-5 py-3 rounded-2xl font-bold transition-all shadow-lg shadow-indigo-600/25 active:scale-95 cursor-pointer"
            title="Exportar rol oficial de juegos a PDF (filtrar por categoría y jornada)"
          >
            <FileDown className="w-5 h-5" />
            <span>Exportar Rol (PDF)</span>
          </button>

          {(userProfile?.role === 'admin' || isJefe) && (
            <button
              onClick={() => setShowUploadModal(true)}
              className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-3 rounded-2xl font-bold transition-all shadow-lg shadow-emerald-600/20 active:scale-95 cursor-pointer"
              title="Subir archivo de Excel con los juegos por jornada"
            >
              <FileSpreadsheet className="w-5 h-5" />
              <span>Subir Rol (Excel)</span>
            </button>
          )}

          {userProfile?.role === 'admin' && (
            <button
              onClick={() => setShowNewSeason(true)}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 rounded-2xl font-bold transition-all shadow-lg shadow-indigo-600/20 cursor-pointer"
            >
              <Plus className="w-5 h-5" />
              Nueva Temporada
            </button>
          )}
        </div>
      </div>



      {/* Temporada Activa Banner */}
      {seasons.length > 0 && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold shadow-sm">
              <Trophy className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Temporada Oficial:</span>
                <span className="text-base font-black text-slate-900 dark:text-white">
                  {seasons.find(s => s.active)?.name || seasons[0].name}
                </span>
                {seasons.some(s => s.active) && (
                  <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full uppercase">
                    Activa
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Inicia: {seasons.find(s => s.active)?.startDate ? new Date(seasons.find(s => s.active)!.startDate!).toLocaleDateString('es-MX', { dateStyle: 'long' }) : 'Sin fecha configurada'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {(userProfile?.role === 'admin' || isJefe) && (
              <button
                type="button"
                onClick={() => setShowConfirmDelete(true)}
                className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-xl border border-red-500/20 transition-all cursor-pointer"
                title="Borrar todos los partidos programados"
              >
                <Trash2 className="w-4 h-4" />
                <span>Borrar Programados</span>
              </button>
            )}

            {userProfile?.role === 'admin' && seasons.length > 0 && (
              <button
                type="button"
                onClick={() => handleDeleteSeason(seasons.find(s => s.active) || seasons[0])}
                className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-xl border border-slate-200 dark:border-slate-800 transition-all cursor-pointer"
                title="Eliminar Temporada"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Main Section: Partidos Programados (Full Width) */}
      <div className="w-full space-y-6">
        <div className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-3xl p-6 shadow-sm dark:shadow-none space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Partidos Programados</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Rol oficial de juegos por jornada con fecha, horario y campo asignado.
              </p>
            </div>

              {/* Filters */}
              <div className="flex flex-wrap items-center gap-2">
                <select 
                  value={viewTournament}
                  onChange={(e) => setViewTournament(e.target.value as any)}
                  className="bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-slate-800 rounded-lg px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-600 dark:text-slate-300 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="All">Torneos: Todos</option>
                  {TOURNAMENTS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <select 
                  value={viewCategory}
                  onChange={(e) => setViewCategory(e.target.value as any)}
                  className="bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-slate-800 rounded-lg px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-600 dark:text-slate-300 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="All">Categorías: Todas</option>
                  {CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                </select>
                <select 
                  value={viewJornada}
                  onChange={(e) => setViewJornada(e.target.value === 'All' ? 'All' : parseInt(e.target.value, 10))}
                  className="bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-slate-800 rounded-lg px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-600 dark:text-slate-300 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="All">Jornadas: Todas</option>
                  {uniqueJornadasInGames.map(j => <option key={j} value={j}>Jornada {j}</option>)}
                </select>
                <select 
                  value={filterScheduleStatus}
                  onChange={(e) => setFilterScheduleStatus(e.target.value as any)}
                  className="bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-slate-800 rounded-lg px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-600 dark:text-slate-300 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  <option value="all">Estado: Todos</option>
                  <option value="assigned">Con horario y campo</option>
                  <option value="pending">Por definir</option>
                </select>
                <button
                  type="button"
                  onClick={() => setShowRecorrerModal(true)}
                  className="flex items-center gap-1.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/30 rounded-lg px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-widest transition-all cursor-pointer active:scale-95"
                  title="Recorrer fechas por retraso de clima (+1 semana)"
                >
                  <CloudRain className="w-3.5 h-3.5" />
                  <span>Recorrer por Clima</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowExportModal(true)}
                  className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest transition-all shadow-sm cursor-pointer active:scale-95"
                  title="Exportar rol filtrado a PDF"
                >
                  <FileDown className="w-3.5 h-3.5" />
                  <span>Exportar PDF</span>
                </button>
              </div>
            </div>

            {/* Banner Equidad Colt */}
            {(viewCategory === 'Colt' || viewCategory === 'All') && (
              <div className="p-4 bg-gradient-to-r from-indigo-500/10 via-purple-500/10 to-indigo-500/10 border border-indigo-200 dark:border-indigo-800/60 rounded-2xl flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center shrink-0 shadow-md shadow-indigo-600/20">
                    <Scale className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-black text-slate-900 dark:text-white uppercase tracking-tight">
                        Categoría Colt: Randomizer 100% Equitativo Activo
                      </span>
                      <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-black uppercase">
                        18/18 Equipos Balanceados
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      17 Jornadas (153 juegos) • Sáb: Zorros (8:00, 11:30, 15:00) + Cliserio (12:30) • Dom: Zorros & Cliserio (8:00, 11:30) + Zorros (15:00) • 100% Equitativo.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowColtEquityModal(true)}
                  className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-black text-[10px] uppercase tracking-wider transition-all shadow-md shadow-indigo-600/20 cursor-pointer active:scale-95"
                >
                  Ver Métricas de Balance
                </button>
              </div>
            )}

            {/* Search input */}
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Buscar por equipo o campo..."
                value={searchTeam}
                onChange={(e) => setSearchTeam(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-slate-800 rounded-xl text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            {/* Active Drag Helper banner */}
            <AnimatePresence>
              {isDragging && draggedSlot && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="p-3 bg-indigo-600 text-white rounded-2xl flex items-center justify-between text-xs shadow-lg"
                >
                  <div className="flex items-center gap-2 font-bold">
                    <Sparkles className="w-4 h-4 animate-spin text-amber-300" />
                    <span>Arrastrando: {draggedSlot.day} {draggedSlot.time} • {draggedSlot.field === 'auto' ? 'Campo según categoría' : draggedSlot.field}</span>
                  </div>
                  <span className="text-[10px] bg-white/20 px-2 py-0.5 rounded-full uppercase tracking-wider font-extrabold">
                    Suelta en un partido
                  </span>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Games List */}
            <div className="space-y-4 max-h-[720px] overflow-y-auto pr-2 custom-scrollbar">
              {gamesByJornada.length === 0 ? (
                <div className="bg-indigo-50/20 dark:bg-slate-950/50 border border-dashed border-indigo-100 dark:border-slate-800 rounded-2xl p-12 text-center">
                  <p className="text-slate-400 dark:text-slate-600 text-sm italic">No hay partidos programados con los filtros seleccionados.</p>
                </div>
              ) : (
                gamesByJornada.map(group => (
                  <div key={group.jornada} className="space-y-3 pt-1">
                    {/* Jornada Header */}
                    <div className="sticky top-0 z-10 flex items-center justify-between p-3 rounded-2xl bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border border-slate-200 dark:border-slate-800 shadow-sm">
                      <div className="flex items-center gap-2.5">
                        <span className="w-7 h-7 rounded-xl bg-indigo-600 text-white flex items-center justify-center font-black text-xs shadow-sm shadow-indigo-600/30">
                          J{group.jornada}
                        </span>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-black text-slate-900 dark:text-white text-xs uppercase tracking-tight">
                              Jornada {group.jornada}
                            </span>
                            <span className="text-[11px] font-black text-indigo-600 dark:text-indigo-400">
                              • {group.dateSpan}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-2.5 py-0.5 rounded-full border border-slate-200 dark:border-slate-700">
                          {group.games.length} partidos
                        </span>
                      </div>
                    </div>

                    {/* Games inside this Jornada */}
                    <div className="space-y-3">
                      {group.games.map(game => {
                        const homeTeam = teams.find(t => t.id === game.homeTeamId);
                        const gameCategory = (homeTeam?.category || 'Infantil') as Category;
                        const userCanEditThisGame = canEdit(gameCategory);
                        const isHoveredTarget = dragOverGameId === game.id;
                        const isJustUpdated = recentlyUpdatedGameId === game.id;
                        const dateTimeInfo = formatGameDateTime(game.date);

                        return (
                          <div
                            key={game.id}
                            onDragOver={(e) => {
                              e.preventDefault();
                              if (userCanEditThisGame) {
                                e.dataTransfer.dropEffect = 'copy';
                                if (dragOverGameId !== game.id) {
                                  setDragOverGameId(game.id);
                                }
                              }
                            }}
                            onDragLeave={(e) => {
                              if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                              setDragOverGameId(null);
                            }}
                            onDrop={(e) => {
                              if (userCanEditThisGame) {
                                handleDropOnGame(e, game);
                              }
                            }}
                            className={`relative p-4 rounded-2xl border-2 transition-all duration-200 ${
                              isJustUpdated
                                ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-500 ring-2 ring-emerald-500/20 shadow-lg'
                                : isHoveredTarget
                                  ? 'bg-indigo-100 dark:bg-indigo-900/60 border-indigo-600 ring-4 ring-indigo-500/30 scale-[1.01] shadow-xl'
                                  : isDragging && userCanEditThisGame
                                    ? 'bg-slate-50 dark:bg-slate-950 border-indigo-300 dark:border-indigo-800/80 border-dashed hover:border-indigo-500'
                                    : 'bg-slate-50 dark:bg-slate-950 border-slate-100 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                            }`}
                          >
                            {/* Drop Overlay when dragged over */}
                            {isHoveredTarget && (
                              <div className="absolute inset-0 bg-indigo-600/90 backdrop-blur-sm rounded-2xl z-20 flex items-center justify-center text-white px-4 text-center">
                                <div className="space-y-1">
                                  <div className="text-sm font-black flex items-center justify-center gap-2">
                                    <Sparkles className="w-5 h-5 text-amber-300 animate-bounce" />
                                    ¡Soltar aquí para asignar horario!
                                  </div>
                                  <div className="text-xs font-medium opacity-90">
                                    {draggedSlot?.day} {draggedSlot?.time} en {draggedSlot?.field === 'auto' ? (CATEGORY_FIELDS[gameCategory]?.[0] || 'Campo oficial') : draggedSlot?.field}
                                  </div>
                                </div>
                              </div>
                            )}

                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                              <div className="flex-1 space-y-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-[10px] font-black text-indigo-600 dark:text-indigo-400 uppercase tracking-widest bg-indigo-500/10 px-2 py-0.5 rounded-md">
                                    {gameCategory}
                                  </span>
                                  {game.tournament && (
                                    <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 bg-slate-200/50 dark:bg-slate-800 px-2 py-0.5 rounded-md uppercase">
                                      {game.tournament}
                                    </span>
                                  )}
                                  {game.jornada && (
                                    <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-md uppercase">
                                      Jornada {game.jornada}
                                    </span>
                                  )}
                                  {isJustUpdated && (
                                    <span className="text-[10px] font-black text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-md flex items-center gap-1">
                                      <Check className="w-3 h-3" /> ¡Horario y Campo Asignados!
                                    </span>
                                  )}
                                </div>

                                {/* Teams Matchup */}
                                <div className="flex flex-wrap items-center gap-3">
                                  <div className="flex items-center gap-2">
                                    <TeamLogo
                                      teamId={game.awayTeamId}
                                      teamName={game.awayTeamName}
                                      size="sm"
                                      className="w-7 h-7 rounded-lg shadow-sm"
                                    />
                                    <span className="text-base font-black text-slate-900 dark:text-white tracking-tight">
                                      {formatTeamName(game.awayTeamName)}
                                    </span>
                                  </div>
                                  <span className="text-xs font-black text-indigo-500 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/60 px-2 py-0.5 rounded-full">
                                    VS
                                  </span>
                                  <div className="flex items-center gap-2">
                                    <TeamLogo
                                      teamId={game.homeTeamId}
                                      teamName={game.homeTeamName}
                                      size="sm"
                                      className="w-7 h-7 rounded-lg shadow-sm"
                                    />
                                    <span className="text-base font-black text-slate-900 dark:text-white tracking-tight">
                                      {formatTeamName(game.homeTeamName)}
                                    </span>
                                  </div>
                                </div>

                                {/* Scheduled Day, Time & Field Details */}
                                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-600 dark:text-slate-400 pt-1">
                                  <div className="flex items-center gap-1.5 font-semibold text-slate-800 dark:text-slate-200">
                                    <Calendar className="w-3.5 h-3.5 text-indigo-500" />
                                    <span>{dateTimeInfo.day ? `${dateTimeInfo.day}, ${dateTimeInfo.date}` : dateTimeInfo.date}</span>
                                  </div>

                                  <div className="flex items-center gap-1.5 font-semibold text-indigo-600 dark:text-indigo-400">
                                    <Clock className="w-3.5 h-3.5 text-indigo-500" />
                                    <span>{dateTimeInfo.time || 'Hora pendiente'}</span>
                                  </div>

                                  <div className="flex items-center gap-1.5 font-semibold text-emerald-600 dark:text-emerald-400">
                                    <MapPin className="w-3.5 h-3.5 text-emerald-500" />
                                    <span>{formatFieldName(game.field) || 'Campo por definir'}</span>
                                  </div>
                                </div>
                              </div>

                              {/* Right side actions */}
                              <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center gap-2 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100 dark:border-slate-800">
                                {/* 1-click assign if activeSlot is selected */}
                                {activeSlot && userCanEditThisGame && (
                                  <button
                                    onClick={() => {
                                      const slotDateInfo = getSlotDate(activeSlot.day, selectedWeekendBase);
                                      const resolvedField = isCustomField 
                                        ? (customFieldInput.trim() || 'Campo Principal')
                                        : selectedAssignmentField;
                                      assignSlotToGame(game, {
                                        day: activeSlot.day,
                                        time: activeSlot.time,
                                        date: slotDateInfo.dateStr,
                                        field: resolvedField,
                                      });
                                    }}
                                    className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all shadow-md flex items-center gap-1.5 animate-pulse"
                                  >
                                    <Sparkles className="w-3.5 h-3.5" />
                                    <span>Asignar {activeSlot.day} {activeSlot.time}</span>
                                  </button>
                                )}

                                {userCanEditThisGame && (
                                  <button
                                    onClick={() => handleOpenEditGame(game)}
                                    className="p-2 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 rounded-xl transition-all"
                                    title="Editar fecha, hora o campo manualmente"
                                  >
                                    <Edit3 className="w-4 h-4" />
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

      {/* Modal: Manual Game Edit */}
      <AnimatePresence>
        {editingGame && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[70] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-3xl p-6 sm:p-8 max-w-md w-full space-y-6 shadow-2xl"
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
                  className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-white rounded-xl transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleSaveEditGame} className="space-y-4">
                {/* Selección de Equipos (Visitante y Local) */}
                <div className="p-3.5 bg-slate-50 dark:bg-slate-900/60 rounded-2xl border border-slate-100 dark:border-slate-800 space-y-3">
                  <div className="text-[10px] font-black uppercase tracking-wider text-slate-400 flex items-center justify-between">
                    <span>Equipos Contendientes ({editingCategory})</span>
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
                    {/* Equipo Visitante */}
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
                        <optgroup label={`Equipos ${editingCategory}`}>
                          {editingCategoryTeams.map(t => (
                            <option key={t.id} value={t.id}>{formatTeamName(t.name)}</option>
                          ))}
                        </optgroup>
                        {teams.filter(t => t.category !== editingCategory).length > 0 && (
                          <optgroup label="Todos los demás equipos">
                            {teams.filter(t => t.category !== editingCategory).map(t => (
                              <option key={t.id} value={t.id}>{formatTeamName(t.name)} ({t.category})</option>
                            ))}
                          </optgroup>
                        )}
                        {!teams.some(t => t.id === editFormData.awayTeamId) && editFormData.awayTeamId && (
                          <option value={editFormData.awayTeamId}>{formatTeamName(editingGame.awayTeamName || editFormData.awayTeamId)}</option>
                        )}
                      </select>
                    </div>

                    {/* Equipo Local */}
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
                        <optgroup label={`Equipos ${editingCategory}`}>
                          {editingCategoryTeams.map(t => (
                            <option key={t.id} value={t.id}>{formatTeamName(t.name)}</option>
                          ))}
                        </optgroup>
                        {teams.filter(t => t.category !== editingCategory).length > 0 && (
                          <optgroup label="Todos los demás equipos">
                            {teams.filter(t => t.category !== editingCategory).map(t => (
                              <option key={t.id} value={t.id}>{formatTeamName(t.name)} ({t.category})</option>
                            ))}
                          </optgroup>
                        )}
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

                {/* Horario Dropdown (08:00, 11:30, 12:30, 15:00) */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                      Horario
                    </label>
                    <button
                      type="button"
                      onClick={() => setIsCustomEditTime(!isCustomEditTime)}
                      className="text-[10px] text-indigo-600 dark:text-indigo-400 font-bold hover:underline cursor-pointer"
                    >
                      {isCustomEditTime ? 'Elegir de lista' : '+ Horario libre'}
                    </button>
                  </div>
                  {isCustomEditTime ? (
                    <input
                      type="time"
                      required
                      value={editFormData.time}
                      onChange={(e) => setEditFormData({ ...editFormData, time: e.target.value })}
                      className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  ) : (
                    <select
                      value={editFormData.time}
                      onChange={(e) => setEditFormData({ ...editFormData, time: e.target.value })}
                      className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      {RANDOMIZER_TIMES.map(t => (
                        <option key={t.value} value={t.value}>{t.label}</option>
                      ))}
                      {!RANDOMIZER_TIMES.some(t => t.value === editFormData.time) && editFormData.time && (
                        <option value={editFormData.time}>{editFormData.time} hrs (Actual)</option>
                      )}
                    </select>
                  )}
                </div>

                {/* Campo Dropdown (Campos asignados a la categoría, ej. Colt: Zorros y Cliserio Sánchez) */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                      Campo ({editingCategory})
                    </label>
                    <button
                      type="button"
                      onClick={() => setIsCustomEditField(!isCustomEditField)}
                      className="text-[10px] text-indigo-600 dark:text-indigo-400 font-bold hover:underline cursor-pointer"
                    >
                      {isCustomEditField ? 'Elegir de lista' : '+ Otro campo'}
                    </button>
                  </div>
                  {isCustomEditField ? (
                    <input
                      type="text"
                      required
                      placeholder="Ej. Campo del Valle"
                      list="fields-datalist"
                      value={editFormData.field}
                      onChange={(e) => setEditFormData({ ...editFormData, field: e.target.value })}
                      className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  ) : (
                    <select
                      value={editFormData.field}
                      onChange={(e) => setEditFormData({ ...editFormData, field: e.target.value })}
                      className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      {editingCategoryFields.map(f => (
                        <option key={f} value={f}>{f}</option>
                      ))}
                      {editFormData.field && !editingCategoryFields.includes(editFormData.field) && (
                        <option value={editFormData.field}>{editFormData.field} (Actual)</option>
                      )}
                    </select>
                  )}
                  <datalist id="fields-datalist">
                    {allKnownFields.map(f => <option key={f} value={f} />)}
                  </datalist>
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

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {showConfirmDelete && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-3xl p-8 max-w-sm w-full space-y-6 text-center shadow-2xl"
            >
              <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto">
                <AlertCircle className="w-8 h-8 text-red-500" />
              </div>
              <div className="space-y-2">
                <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100">¿Borrar Partidos?</h3>
                <p className="text-slate-500 dark:text-slate-400 text-sm">Esta acción eliminará todos los partidos con estado "Programado". No se puede deshacer.</p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowConfirmDelete(false)}
                  className="flex-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-900 dark:text-white font-bold py-3 rounded-xl transition-all"
                >
                  Cancelar
                </button>
                <button
                  onClick={clearGames}
                  className="flex-1 bg-red-500 hover:bg-red-600 text-white font-bold py-3 rounded-xl transition-all shadow-lg shadow-red-500/20"
                >
                  Borrar Todo
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Delete Season Confirmation Modal */}
      <AnimatePresence>
        {seasonToDelete && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-3xl p-8 max-w-sm w-full space-y-6 text-center shadow-2xl"
            >
              <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto text-red-500">
                <Trash2 className="w-8 h-8" />
              </div>
              <div className="space-y-2">
                <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100">¿Eliminar Temporada?</h3>
                <p className="text-slate-600 dark:text-slate-300 text-sm">
                  ¿Estás seguro de que deseas eliminar la temporada <strong className="text-slate-900 dark:text-white font-bold">"{seasonToDelete.name}"</strong>?
                </p>
                <p className="text-xs text-slate-400 dark:text-slate-500">
                  Esta acción eliminará la temporada de la base de datos de manera permanente.
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  disabled={isDeletingSeason}
                  onClick={() => setSeasonToDelete(null)}
                  className="flex-1 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-200 font-bold py-3 rounded-xl transition-all text-sm cursor-pointer disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={isDeletingSeason}
                  onClick={executeDeleteSeason}
                  className="flex-1 bg-red-600 hover:bg-red-700 active:scale-95 text-white font-bold py-3 rounded-xl transition-all text-sm shadow-lg shadow-red-600/20 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  {isDeletingSeason ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  <span>{isDeletingSeason ? 'Eliminando...' : 'Eliminar'}</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Modal: Subir Rol de Juegos (Excel) */}
      <ExcelScheduleModal
        isOpen={showUploadModal}
        onClose={() => setShowUploadModal(false)}
        teams={teams}
        seasons={seasons}
        defaultCategory={viewCategory !== 'All' ? viewCategory : 'Colt'}
        onImportSuccess={(count) => {
          setNotification({
            type: 'success',
            message: `¡Éxito! Se agregaron ${count} partidos programados organizados por jornada.`
          });
          setTimeout(() => setNotification(null), 6000);
        }}
        onNavigateToGames={onNavigateToDashboard}
      />

      {/* New Season Modal */}
      {showNewSeason && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-3xl p-8 max-w-md w-full space-y-6 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-bold text-slate-900 dark:text-slate-100">Nueva Temporada</h3>
              <button onClick={() => setShowNewSeason(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-white transition-colors">
                <Plus className="w-6 h-6 rotate-45" />
              </button>
            </div>

            <form onSubmit={handleCreateSeason} className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Nombre de la Temporada</label>
                <input
                  name="name"
                  required
                  placeholder="Ej. Primavera 2026"
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-900 dark:text-slate-100"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Fecha de Inicio (Opcional)</label>
                <input
                  name="startDate"
                  type="date"
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-900 dark:text-slate-100"
                />
              </div>
              <button
                type="submit"
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-4 rounded-xl transition-all shadow-lg shadow-indigo-600/20"
              >
                Crear Temporada
              </button>
            </form>
          </motion.div>
        </div>
      )}

      {/* Schedule PDF Export Modal */}
      <ScheduleExportModal
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
        games={games}
        teams={teams}
        seasons={seasons}
        initialCategory={viewCategory}
        initialJornada={viewJornada}
        initialTournament={viewTournament}
      />

      {/* Colt Equity and Balance Modal */}
      <ColtEquityModal
        isOpen={showColtEquityModal}
        onClose={() => setShowColtEquityModal(false)}
        games={games}
        teams={teams}
        canEdit={userProfile?.role === 'admin' || isJefe}
      />

      {/* Recorrer Jornada por Clima Modal */}
      <RecorrerJornadaModal
        isOpen={showRecorrerModal}
        onClose={() => setShowRecorrerModal(false)}
        games={games}
        teams={teams}
        initialCategory={viewCategory}
        initialJornada={viewJornada !== 'All' ? viewJornada : 1}
        canEdit={userProfile?.role === 'admin' || isJefe}
        onSuccess={(count, summary) => {
          setNotification({
            type: 'success',
            message: `¡Éxito! ${summary} (${count} partidos reprogramados).`
          });
          setTimeout(() => setNotification(null), 6000);
        }}
      />

      {/* Auto Generate Schedule Modal (Round-Robin sin repetir equipos) */}
      <AutoGenerateScheduleModal
        isOpen={showAutoGenerateModal}
        onClose={() => setShowAutoGenerateModal(false)}
        teams={teams}
        seasons={seasons}
        currentCategory={viewCategory}
        onGenerateSuccess={(msg) => {
          setNotification({
            type: 'success',
            message: msg
          });
          setTimeout(() => setNotification(null), 8000);
        }}
      />
    </motion.div>
  );
}
