import React, { useState, useEffect, useRef } from 'react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { collection, onSnapshot, query, orderBy, addDoc, doc, updateDoc, deleteDoc, getDocs, where, writeBatch } from 'firebase/firestore';
import { Team, Player, Game, CATEGORIES, Category, UserProfile, TournamentType, TOURNAMENTS, BASEBALL_POSITIONS } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Users, 
  Plus, 
  Trash2, 
  Edit2, 
  ChevronRight, 
  UserPlus, 
  Trophy, 
  Shield, 
  BarChart3, 
  Lock, 
  Upload, 
  Sparkles, 
  Eye, 
  Search, 
  CheckCircle2, 
  AlertCircle, 
  X,
  FileSpreadsheet
} from 'lucide-react';
import CedulaUploadModal from './CedulaUploadModal';
import TeamRosterModal from './TeamRosterModal';
import PlayerDetailModal from './PlayerDetailModal';
import TeamLogo from './TeamLogo';
import TeamLogoModal from './TeamLogoModal';
import { useTeams } from '../context/TeamsContext';
import { calculatePlayerAccumulatedStats } from '../utils/playerStatsCalculator';

interface TeamManagerProps {
  userProfile: UserProfile | null;
}

export default function TeamManager({ userProfile }: TeamManagerProps) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [games, setGames] = useState<Game[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<Category | 'All'>('All');
  const [selectedTournament, setSelectedTournament] = useState<TournamentType | 'All'>('Regular');
  const [showAddTeam, setShowAddTeam] = useState(false);
  const [showAddPlayer, setShowAddPlayer] = useState(false);
  const [playerToEdit, setPlayerToEdit] = useState<Player | null>(null);
  const [playerToDelete, setPlayerToDelete] = useState<Player | null>(null);
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [loading, setLoading] = useState(true);
  const [teamToDelete, setTeamToDelete] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [playerSearchQuery, setPlayerSearchQuery] = useState('');

  // Cedula upload modal state
  const [showCedulaModal, setShowCedulaModal] = useState(false);
  const [cedulaInitialTeamId, setCedulaInitialTeamId] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ type: 'success' | 'error', message: string } | null>(null);

  // Dedicated Roster and Players Modal state
  const [rosterModalTeam, setRosterModalTeam] = useState<Team | null>(null);
  const [showRosterModal, setShowRosterModal] = useState(false);

  // Quick player management selector modal
  const [showQuickPlayerModal, setShowQuickPlayerModal] = useState(false);

  // Logo management state
  const { uploadTeamLogo } = useTeams();
  const [logoModalTeam, setLogoModalTeam] = useState<Team | null>(null);
  const quickLogoInputRef = useRef<HTMLInputElement>(null);
  const [targetUploadTeamId, setTargetUploadTeamId] = useState<string | null>(null);

  const handleQuickLogoSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !targetUploadTeamId) return;
    try {
      await uploadTeamLogo(targetUploadTeamId, file);
      setNotification({
        type: 'success',
        message: '¡Logotipo oficial actualizado y guardado correctamente!'
      });
      setTimeout(() => setNotification(null), 4000);
    } catch (err) {
      console.error('Error uploading logo:', err);
      setNotification({
        type: 'error',
        message: 'No se pudo subir el logotipo. Intenta con otra imagen.'
      });
      setTimeout(() => setNotification(null), 4000);
    } finally {
      e.target.value = '';
      setTargetUploadTeamId(null);
    }
  };

  const canEdit = (category: Category) => {
    if (!userProfile) return false;
    if (userProfile.role === 'admin' || userProfile.role === 'editor') return true;
    if (userProfile.role === 'jefe_categoria' && (!userProfile.category || userProfile.category === category)) return true;
    return false;
  };

  const isJefe = userProfile?.role === 'jefe_categoria';
  const userCategory = userProfile?.category;

  useEffect(() => {
    if (isJefe && userCategory) {
      setSelectedCategory(userCategory);
    }
  }, [isJefe, userCategory]);

  useEffect(() => {
    const teamsQuery = query(collection(db, 'teams'), orderBy('name', 'asc'));
    const unsubscribeTeams = onSnapshot(teamsQuery, (snapshot) => {
      const loadedTeams = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Team));
      setTeams(loadedTeams);
      setLoading(false);
      // Auto select first team if none selected
      if (!selectedTeamId && loadedTeams.length > 0) {
        setSelectedTeamId(loadedTeams[0].id);
      }
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'teams'));

    const playersQuery = query(collection(db, 'players'), orderBy('name', 'asc'));
    const unsubscribePlayers = onSnapshot(playersQuery, (snapshot) => {
      setPlayers(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Player)));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'players'));

    const gamesQuery = query(collection(db, 'games'));
    const unsubscribeGames = onSnapshot(gamesQuery, (snapshot) => {
      setGames(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Game)));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'games'));

    return () => {
      unsubscribeTeams();
      unsubscribePlayers();
      unsubscribeGames();
    };
  }, []);

  const handleAddTeam = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const name = formData.get('name') as string;
    const category = formData.get('category') as Category;
    const tournament = formData.get('tournament') as TournamentType;
    
    try {
      const docRef = await addDoc(collection(db, 'teams'), {
        name,
        category,
        tournament,
        leagueId: 'default',
        coachId: '',
        wins: 0,
        losses: 0,
        runsScored: 0,
        runsAllowed: 0,
      });
      setSelectedTeamId(docRef.id);
      setShowAddTeam(false);
      setNotification({ type: 'success', message: `Equipo "${name}" creado exitosamente.` });
      setTimeout(() => setNotification(null), 4000);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'teams');
    }
  };

  const handleDeleteTeam = async (teamId: string) => {
    setIsDeleting(true);
    try {
      const playersSnapshot = await getDocs(query(collection(db, 'players'), where('teamId', '==', teamId)));
      const batch = writeBatch(db);
      playersSnapshot.docs.forEach((d) => {
        batch.delete(d.ref);
      });
      batch.delete(doc(db, 'teams', teamId));
      await batch.commit();
      
      if (selectedTeamId === teamId) {
        const remaining = teams.filter(t => t.id !== teamId);
        setSelectedTeamId(remaining[0]?.id || null);
      }
      setTeamToDelete(null);
      setNotification({ type: 'success', message: 'Equipo y sus jugadores eliminados correctamente.' });
      setTimeout(() => setNotification(null), 4000);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'teams');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleAddPlayer = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedTeamId) return;
    const formData = new FormData(e.currentTarget);
    const name = formData.get('name') as string;
    const number = formData.get('number') as string;
    const position = formData.get('position') as string;

    try {
      await addDoc(collection(db, 'players'), {
        name: name.trim(),
        number: number.trim(),
        teamId: selectedTeamId,
        position: position.trim(),
        stats: {
          atBats: 0,
          hits: 0,
          homeRuns: 0,
          runs: 0,
          rbis: 0,
          strikeouts: 0,
          walks: 0,
          battingAverage: 0,
        }
      });
      setShowAddPlayer(false);
      setNotification({ type: 'success', message: `Jugador "${name}" agregado al roster.` });
      setTimeout(() => setNotification(null), 3500);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'players');
    }
  };

  const handleEditPlayerSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!playerToEdit) return;
    const formData = new FormData(e.currentTarget);
    const name = (formData.get('name') as string).trim();
    const number = (formData.get('number') as string).trim();
    const position = (formData.get('position') as string).trim();

    try {
      await updateDoc(doc(db, 'players', playerToEdit.id), {
        name,
        number,
        position,
      });
      setPlayerToEdit(null);
      setNotification({ type: 'success', message: `Datos de "${name}" actualizados.` });
      setTimeout(() => setNotification(null), 3500);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `players/${playerToEdit.id}`);
    }
  };

  const handleConfirmDeletePlayer = async () => {
    if (!playerToDelete) return;
    const pName = playerToDelete.name;
    try {
      await deleteDoc(doc(db, 'players', playerToDelete.id));
      setPlayerToDelete(null);
      setNotification({ type: 'success', message: `"${pName}" ha sido eliminado del equipo.` });
      setTimeout(() => setNotification(null), 3500);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `players/${playerToDelete.id}`);
    }
  };

  if (loading) return null;

  const selectedTeam = teams.find(t => t.id === selectedTeamId) || teams[0];
  const allTeamPlayers = players.filter(p => p.teamId === selectedTeam?.id);
  
  // Search filter
  const filteredTeamPlayers = allTeamPlayers.filter(p => {
    if (!playerSearchQuery.trim()) return true;
    const q = playerSearchQuery.toLowerCase();
    return p.name.toLowerCase().includes(q) || 
           p.number.toLowerCase().includes(q) || 
           p.position.toLowerCase().includes(q);
  });

  const filteredTeams = teams.filter(t => {
    const categoryMatch = selectedCategory === 'All' || t.category === selectedCategory;
    const tournamentMatch = selectedTournament === 'All' || t.tournament === selectedTournament || (!t.tournament && selectedTournament === 'Regular');
    return categoryMatch && tournamentMatch;
  });

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
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className={`fixed top-6 right-6 z-[100] px-5 py-3 rounded-2xl shadow-2xl flex items-center gap-3 text-xs font-bold ${
              notification.type === 'success'
                ? 'bg-emerald-600 text-white shadow-emerald-600/30'
                : 'bg-red-600 text-white shadow-red-600/30'
            }`}
          >
            {notification.type === 'success' ? <CheckCircle2 className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
            <span>{notification.message}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Header with Required Action Buttons */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-black tracking-tight text-slate-900 dark:text-white uppercase">Gestión de Equipos</h2>
          <p className="text-slate-500 dark:text-slate-400 text-sm">Administra los equipos de la liga, sube cédulas con IA y gestiona los jugadores para cada alineación.</p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Main Requested Button 1: Subir Cédula (Solo Admin / Jefe) */}
          {Boolean(userProfile && (userProfile.role === 'admin' || userProfile.role === 'editor' || isJefe)) && (
            <button
              onClick={() => {
                setCedulaInitialTeamId(selectedTeam?.id || teams[0]?.id || null);
                setShowCedulaModal(true);
              }}
              className="flex items-center gap-2 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white font-bold py-2.5 px-4 rounded-2xl transition-all shadow-lg shadow-indigo-600/25 active:scale-95 cursor-pointer text-xs uppercase tracking-wider"
            >
              <Sparkles className="w-4 h-4" />
              <span>Subir Cédula</span>
            </button>
          )}

          {/* Main Requested Button 2: Agregar o Quitar Jugadores (Solo Admin / Jefe) */}
          {Boolean(userProfile && (userProfile.role === 'admin' || userProfile.role === 'editor' || isJefe)) && (
            <button
              onClick={() => {
                const targetTeam = selectedTeam || teams[0];
                if (targetTeam) {
                  setSelectedTeamId(targetTeam.id);
                  setRosterModalTeam(targetTeam);
                  setShowRosterModal(true);
                }
              }}
              className="flex items-center gap-2 bg-slate-800 dark:bg-slate-700 hover:bg-slate-900 dark:hover:bg-slate-600 text-white font-bold py-2.5 px-4 rounded-2xl transition-all shadow-md active:scale-95 cursor-pointer text-xs uppercase tracking-wider"
            >
              <UserPlus className="w-4 h-4" />
              <span>Agregar o Quitar Jugadores</span>
            </button>
          )}

          {/* Nuevo Equipo (Admin / Jefe) */}
          {(userProfile?.role === 'admin' || (isJefe && selectedCategory !== 'All' && canEdit(selectedCategory as Category))) && (
            <button
              onClick={() => setShowAddTeam(true)}
              className="flex items-center gap-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-900 dark:text-white font-bold py-2.5 px-4 rounded-2xl transition-all cursor-pointer text-xs uppercase tracking-wider"
            >
              <Plus className="w-4 h-4" />
              <span>Nuevo Equipo</span>
            </button>
          )}
        </div>
      </div>

      {/* Filters Bar: Categoría & Torneo */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-4">
            {/* Categoría */}
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              <span className="font-bold uppercase tracking-wider text-[11px] text-slate-500">Categoría:</span>
              <select 
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value as any)}
                className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-600 cursor-pointer"
              >
                <option value="All">Todas las Categorías</option>
                {CATEGORIES.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>

            {/* Torneo */}
            <div className="flex items-center gap-2">
              <Trophy className="w-4 h-4 text-amber-500" />
              <span className="font-bold uppercase tracking-wider text-[11px] text-slate-500">Torneo:</span>
              <select 
                value={selectedTournament}
                onChange={(e) => setSelectedTournament(e.target.value as any)}
                className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3.5 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-600 cursor-pointer"
              >
                <option value="All">Todos los Torneos</option>
                {TOURNAMENTS.map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="text-xs font-bold text-slate-400">
            {filteredTeams.length} {filteredTeams.length === 1 ? 'equipo registrado' : 'equipos registrados'}
          </div>
        </div>
      </div>

      {/* Grid of Teams */}
      {filteredTeams.length === 0 ? (
        <div className="bg-slate-50 dark:bg-slate-900/50 border border-dashed border-slate-200 dark:border-slate-800 rounded-3xl p-16 text-center space-y-3">
          <Shield className="w-12 h-12 text-slate-400 mx-auto" />
          <p className="text-base font-bold text-slate-700 dark:text-slate-300">No hay equipos que coincidan con los filtros seleccionados.</p>
          <p className="text-xs text-slate-400">Prueba cambiando la categoría o torneo para ver los equipos registrados.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredTeams.map(team => {
            const teamPlayerCount = players.filter(p => p.teamId === team.id).length;
            const isSelected = selectedTeam?.id === team.id;
            return (
              <div
                key={team.id}
                onClick={() => setSelectedTeamId(team.id)}
                className={`bg-white dark:bg-slate-800/90 border rounded-3xl p-5 shadow-sm hover:shadow-md transition-all flex flex-col justify-between gap-4 group ${
                  isSelected ? 'border-indigo-500 ring-2 ring-indigo-500/20' : 'border-slate-200 dark:border-slate-700 hover:border-indigo-400 dark:hover:border-slate-600'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3.5 min-w-0">
                    <TeamLogo
                      team={team}
                      size="lg"
                      isEditable={canEdit(team.category)}
                      onEditClick={(e) => {
                        e.stopPropagation();
                        if (team.logoUrl) {
                          setLogoModalTeam(team);
                        } else {
                          setTargetUploadTeamId(team.id);
                          quickLogoInputRef.current?.click();
                        }
                      }}
                      className="w-14 h-14 rounded-full shadow-sm shrink-0"
                    />
                    <div className="min-w-0">
                      <h4 className="font-black text-slate-900 dark:text-slate-100 text-base leading-tight truncate group-hover:text-indigo-600 transition-colors">
                        {team.name}
                      </h4>
                      <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                        <span className="text-[10px] px-2.5 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 font-bold uppercase tracking-wider border border-indigo-200/50 dark:border-indigo-800/50">
                          {team.category}
                        </span>
                        <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400">
                          {teamPlayerCount} {teamPlayerCount === 1 ? 'jugador' : 'jugadores'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {canEdit(team.category) && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setTeamToDelete(team.id);
                      }}
                      className="p-1.5 text-slate-400 hover:text-red-500 rounded-lg transition-colors cursor-pointer shrink-0"
                      title={`Eliminar equipo ${team.name}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {/* Actions: 'Ver Jugadores' & 'Cédula' */}
                <div className="flex items-center gap-2 pt-3 border-t border-slate-100 dark:border-slate-700/60" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedTeamId(team.id);
                      setRosterModalTeam(team);
                      setShowRosterModal(true);
                    }}
                    className="flex-1 py-2.5 px-3 rounded-xl text-xs font-black uppercase tracking-wider bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white flex items-center justify-center gap-1.5 transition-all shadow-md shadow-indigo-600/20 cursor-pointer"
                  >
                    <Eye className="w-4 h-4" />
                    <span>Ver Jugadores</span>
                  </button>

                  {canEdit(team.category) && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedTeamId(team.id);
                        setCedulaInitialTeamId(team.id);
                        setShowCedulaModal(true);
                      }}
                      className="py-2.5 px-3 rounded-xl text-xs font-bold uppercase tracking-wider bg-slate-100 hover:bg-slate-200 dark:bg-slate-700/60 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 flex items-center justify-center gap-1 transition-all cursor-pointer"
                      title={`Subir cédula para ${team.name}`}
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>Cédula</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Cédula Upload & Extraction Modal */}
      <CedulaUploadModal
        isOpen={showCedulaModal}
        onClose={() => setShowCedulaModal(false)}
        teams={teams}
        initialTeamId={cedulaInitialTeamId || selectedTeamId}
        onSaveSuccess={(teamId, count, teamName) => {
          setSelectedTeamId(teamId);
          setNotification({
            type: 'success',
            message: `¡Se agregaron ${count} jugadores al roster de "${teamName}" correctamente!`
          });
          setTimeout(() => setNotification(null), 5000);
        }}
      />

      {/* Delete Team Modal */}
      <AnimatePresence>
        {teamToDelete && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-3xl p-8 max-w-md w-full shadow-2xl"
            >
              <div className="w-16 h-16 bg-red-500/10 rounded-2xl flex items-center justify-center mx-auto mb-6">
                <Trash2 className="w-8 h-8 text-red-500" />
              </div>
              <h3 className="text-2xl font-bold text-center mb-2 text-slate-900 dark:text-slate-100">¿Eliminar equipo?</h3>
              <p className="text-slate-500 dark:text-slate-400 text-center mb-8 text-sm">
                Esta acción eliminará permanentemente al equipo <span className="text-slate-900 dark:text-white font-bold">"{teams.find(t => t.id === teamToDelete)?.name}"</span> y a todos sus jugadores.
              </p>
              <div className="flex gap-4">
                <button
                  onClick={() => setTeamToDelete(null)}
                  disabled={isDeleting}
                  className="flex-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-900 dark:text-white font-bold py-3 rounded-xl transition-all disabled:opacity-50 text-xs uppercase cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => handleDeleteTeam(teamToDelete)}
                  disabled={isDeleting}
                  className="flex-1 bg-red-500 hover:bg-red-600 text-white font-bold py-3 rounded-xl transition-all shadow-lg shadow-red-500/20 flex items-center justify-center gap-2 disabled:opacity-50 text-xs uppercase cursor-pointer"
                >
                  {isDeleting ? (
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    'Eliminar'
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Delete Player Modal (Quitar jugador) */}
      <AnimatePresence>
        {playerToDelete && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-3xl p-8 max-w-sm w-full shadow-2xl space-y-6 text-center"
            >
              <div className="w-16 h-16 bg-red-500/10 rounded-2xl flex items-center justify-center mx-auto text-red-500">
                <Trash2 className="w-8 h-8" />
              </div>
              <div className="space-y-1">
                <h3 className="text-xl font-black text-slate-900 dark:text-white">¿Quitar Jugador?</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  ¿Deseas quitar a <strong className="text-slate-900 dark:text-white">{playerToDelete.name}</strong> (#{playerToDelete.number}) del roster de {selectedTeam?.name}?
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setPlayerToDelete(null)}
                  className="flex-1 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-200 font-bold py-3 rounded-xl transition-all text-xs uppercase cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleConfirmDeletePlayer}
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white font-bold py-3 rounded-xl transition-all text-xs uppercase shadow-lg shadow-red-600/20 cursor-pointer"
                >
                  Quitar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Add Player Modal */}
      {showAddPlayer && (
        <Modal title={`Añadir Jugador a ${selectedTeam?.name}`} onClose={() => setShowAddPlayer(false)}>
          <form onSubmit={handleAddPlayer} className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Nombre del Jugador</label>
              <input 
                name="name" 
                required 
                autoFocus 
                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-600 text-slate-900 dark:text-slate-100 text-sm font-semibold" 
                placeholder="Nombre Completo" 
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Jersey #</label>
                <input 
                  name="number" 
                  required 
                  defaultValue="00"
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-600 text-slate-900 dark:text-slate-100 text-sm font-bold text-center" 
                  placeholder="00" 
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Posición</label>
                <select 
                  name="position" 
                  required 
                  defaultValue="OF"
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-600 text-slate-900 dark:text-slate-100 text-sm font-semibold cursor-pointer"
                >
                  {BASEBALL_POSITIONS.map(pos => (
                    <option key={pos} value={pos}>{pos}</option>
                  ))}
                  <option value="OF">OF (Jardinero)</option>
                  <option value="INF">INF (Cuadro)</option>
                  <option value="UTIL">UTIL (Utility)</option>
                </select>
              </div>
            </div>
            <button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-6 rounded-xl transition-all shadow-lg shadow-indigo-600/20 text-xs uppercase tracking-wider cursor-pointer">
              Guardar Jugador
            </button>
          </form>
        </Modal>
      )}

      {/* Edit Player Modal */}
      {playerToEdit && (
        <Modal title={`Editar Jugador: ${playerToEdit.name}`} onClose={() => setPlayerToEdit(null)}>
          <form onSubmit={handleEditPlayerSubmit} className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Nombre Completo</label>
              <input 
                name="name" 
                required 
                defaultValue={playerToEdit.name}
                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-600 text-slate-900 dark:text-slate-100 text-sm font-semibold" 
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Jersey #</label>
                <input 
                  name="number" 
                  required 
                  defaultValue={playerToEdit.number}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-600 text-slate-900 dark:text-slate-100 text-sm font-bold text-center" 
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Posición</label>
                <select 
                  name="position" 
                  required 
                  defaultValue={playerToEdit.position}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-600 text-slate-900 dark:text-slate-100 text-sm font-semibold cursor-pointer"
                >
                  {BASEBALL_POSITIONS.map(pos => (
                    <option key={pos} value={pos}>{pos}</option>
                  ))}
                  <option value="OF">OF (Jardinero)</option>
                  <option value="INF">INF (Cuadro)</option>
                  <option value="UTIL">UTIL (Utility)</option>
                </select>
              </div>
            </div>
            <button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-6 rounded-xl transition-all shadow-lg shadow-indigo-600/20 text-xs uppercase tracking-wider cursor-pointer">
              Actualizar Jugador
            </button>
          </form>
        </Modal>
      )}

      {/* Create Team Modal */}
      {showAddTeam && (
        <Modal title="Crear Nuevo Equipo" onClose={() => setShowAddTeam(false)}>
          <form onSubmit={handleAddTeam} className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Nombre del Equipo</label>
              <input name="name" required autoFocus className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-600 text-slate-900 dark:text-slate-100" placeholder="ej. Tigres" />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Categoría</label>
              <select name="category" required className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-600 text-slate-900 dark:text-slate-100">
                {CATEGORIES.map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Torneo</label>
              <select name="tournament" required className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-600 text-slate-900 dark:text-slate-100">
                {TOURNAMENTS.map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 px-6 rounded-xl transition-all shadow-lg shadow-indigo-600/20">
              Crear Equipo
            </button>
          </form>
        </Modal>
      )}

      {/* Player Stats Modal with accumulated stats from match history */}
      {selectedPlayer && (
        <PlayerDetailModal
          stats={calculatePlayerAccumulatedStats(selectedPlayer, games, teams)}
          userProfile={userProfile}
          onClose={() => setSelectedPlayer(null)}
        />
      )}

      {/* Dedicated Team Roster and Cedula View Modal */}
      {showRosterModal && (rosterModalTeam || selectedTeam) && (
        <TeamRosterModal
          isOpen={showRosterModal}
          onClose={() => {
            setShowRosterModal(false);
            setRosterModalTeam(null);
          }}
          team={rosterModalTeam || selectedTeam}
          players={players}
          games={games}
          teams={teams}
          onViewPlayerStats={(p) => setSelectedPlayer(p)}
          onOpenCedulaUpload={(tId) => {
            setCedulaInitialTeamId(tId);
            setShowCedulaModal(true);
          }}
          canEdit={rosterModalTeam ? canEdit(rosterModalTeam.category) : Boolean(userProfile && (userProfile.role === 'admin' || userProfile.role === 'editor'))}
        />
      )}

      {/* Hidden File Input for Quick Logo Pick */}
      <input
        type="file"
        ref={quickLogoInputRef}
        accept="image/png,image/jpeg,image/webp,image/svg+xml,image/*"
        onChange={handleQuickLogoSelected}
        className="hidden"
      />

      {/* Team Logo Management Modal */}
      <TeamLogoModal
        isOpen={Boolean(logoModalTeam)}
        team={logoModalTeam}
        onClose={() => setLogoModalTeam(null)}
        onSuccess={(msg) => {
          setNotification({ type: 'success', message: msg });
          setTimeout(() => setNotification(null), 4000);
        }}
      />
    </motion.div>
  );
}

function StatItem({ label, value }: { label: string, value: string | number }) {
  return (
    <div className="bg-slate-50 dark:bg-slate-950 border border-slate-100 dark:border-slate-800 rounded-xl p-3 text-center">
      <div className="text-lg font-black text-slate-900 dark:text-white">{value}</div>
      <div className="text-[10px] text-slate-400 dark:text-slate-600 font-bold uppercase tracking-widest">{label}</div>
    </div>
  );
}

function Modal({ title, children, onClose }: { title: string, children: React.ReactNode, onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-3xl p-8 max-w-md w-full space-y-6 shadow-2xl"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-xl font-black text-slate-900 dark:text-slate-100 uppercase tracking-tight">{title}</h3>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-white transition-colors cursor-pointer rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700">
            <X className="w-5 h-5" />
          </button>
        </div>
        {children}
      </motion.div>
    </div>
  );
}
