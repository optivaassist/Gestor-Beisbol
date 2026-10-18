import React, { useState, useMemo } from 'react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { collection, addDoc, doc, updateDoc, deleteDoc } from 'firebase/firestore';
import { Team, Player, BASEBALL_POSITIONS } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Users, 
  UserPlus, 
  Trash2, 
  Edit2, 
  Upload, 
  Search, 
  X, 
  Check, 
  AlertCircle, 
  Shield, 
  FileText, 
  CheckCircle2, 
  Sparkles,
  BarChart3
} from 'lucide-react';
import TeamLogo from './TeamLogo';
import { Game } from '../types';
import { calculatePlayerAccumulatedStats } from '../utils/playerStatsCalculator';

interface TeamRosterModalProps {
  isOpen: boolean;
  onClose: () => void;
  team: Team | null;
  players: Player[];
  games?: Game[];
  teams?: Team[];
  onOpenCedulaUpload: (teamId: string) => void;
  canEdit?: boolean;
  onViewPlayerStats?: (player: Player) => void;
}

export default function TeamRosterModal({
  isOpen,
  onClose,
  team,
  players,
  games = [],
  teams = [],
  onOpenCedulaUpload,
  canEdit = true,
  onViewPlayerStats,
}: TeamRosterModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [playerToEdit, setPlayerToEdit] = useState<Player | null>(null);
  const [playerToDelete, setPlayerToDelete] = useState<Player | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [notification, setNotification] = useState<{ type: 'success' | 'error', message: string } | null>(null);

  // New player form state
  const [newName, setNewName] = useState('');
  const [newNumber, setNewNumber] = useState('00');
  const [newPosition, setNewPosition] = useState('OF');
  const [newNotes, setNewNotes] = useState('');

  // Edit player form state
  const [editName, setEditName] = useState('');
  const [editNumber, setEditNumber] = useState('');
  const [editPosition, setEditPosition] = useState('');
  const [editNotes, setEditNotes] = useState('');

  if (!isOpen || !team) return null;

  const teamPlayers = players.filter(p => p.teamId === team.id);

  // Compute official accumulated statistics from matches/box scores
  const playerStatsMap = useMemo(() => {
    const map = new Map<string, ReturnType<typeof calculatePlayerAccumulatedStats>>();
    for (const p of teamPlayers) {
      map.set(p.id, calculatePlayerAccumulatedStats(p, games, teams));
    }
    return map;
  }, [teamPlayers, games, teams]);

  const filteredPlayers = teamPlayers.filter(p => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      p.name.toLowerCase().includes(q) ||
      p.number.toLowerCase().includes(q) ||
      p.position.toLowerCase().includes(q) ||
      (p.notes && p.notes.toLowerCase().includes(q))
    );
  });

  const handleCreatePlayer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;

    setIsSubmitting(true);
    try {
      await addDoc(collection(db, 'players'), {
        name: newName.trim(),
        number: newNumber.trim() || '00',
        teamId: team.id,
        position: newPosition.trim() || 'OF',
        notes: newNotes.trim() || '',
        stats: {
          atBats: 0,
          hits: 0,
          homeRuns: 0,
          runs: 0,
          rbis: 0,
          strikeouts: 0,
          walks: 0,
          battingAverage: 0,
        },
        createdAt: new Date().toISOString(),
      });

      setNewName('');
      setNewNumber('00');
      setNewPosition('OF');
      setNewNotes('');
      setShowAddForm(false);
      setNotification({ type: 'success', message: `¡Jugador "${newName}" agregado al roster de ${team.name}!` });
      setTimeout(() => setNotification(null), 3500);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'players');
      setNotification({ type: 'error', message: 'No se pudo agregar el jugador.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStartEdit = (player: Player) => {
    setPlayerToEdit(player);
    setEditName(player.name);
    setEditNumber(player.number);
    setEditPosition(player.position);
    setEditNotes(player.notes || '');
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!playerToEdit || !editName.trim()) return;

    setIsSubmitting(true);
    try {
      await updateDoc(doc(db, 'players', playerToEdit.id), {
        name: editName.trim(),
        number: editNumber.trim() || '00',
        position: editPosition.trim() || 'OF',
        notes: editNotes.trim(),
      });

      setPlayerToEdit(null);
      setNotification({ type: 'success', message: `Jugador "${editName}" actualizado con éxito.` });
      setTimeout(() => setNotification(null), 3500);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `players/${playerToEdit.id}`);
      setNotification({ type: 'error', message: 'Error al actualizar jugador.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!playerToDelete) return;
    const name = playerToDelete.name;
    setIsSubmitting(true);
    try {
      await deleteDoc(doc(db, 'players', playerToDelete.id));
      setPlayerToDelete(null);
      setNotification({ type: 'success', message: `"${name}" ha sido removido del equipo.` });
      setTimeout(() => setNotification(null), 3500);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `players/${playerToDelete.id}`);
      setNotification({ type: 'error', message: 'Error al eliminar jugador.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-md z-[90] flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 15 }}
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[2.5rem] max-w-4xl w-full shadow-2xl overflow-hidden flex flex-col max-h-[92vh]"
      >
        {/* Toast inside modal */}
        <AnimatePresence>
          {notification && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className={`px-4 py-2.5 text-xs font-bold flex items-center justify-between gap-2 text-white ${
                notification.type === 'success' ? 'bg-emerald-600' : 'bg-red-600'
              }`}
            >
              <div className="flex items-center gap-2">
                {notification.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                <span>{notification.message}</span>
              </div>
              <button onClick={() => setNotification(null)} className="p-1 hover:opacity-75">
                <X className="w-4 h-4" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Header */}
        <div className="p-6 pb-5 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-50/70 dark:bg-slate-950/40">
          <div className="flex items-center gap-4">
            <TeamLogo team={team} size="xl" className="w-14 h-14 rounded-2xl shadow-lg shadow-indigo-600/25 shrink-0" />
            <div>
              <div className="flex items-center gap-2.5">
                <h3 className="text-2xl font-black text-slate-900 dark:text-white uppercase tracking-tight">
                  {team.name}
                </h3>
                <span className="px-2.5 py-0.5 bg-indigo-600/10 text-indigo-600 dark:text-indigo-400 text-[10px] font-black uppercase tracking-wider rounded-full border border-indigo-600/20">
                  {team.category}
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Roster Oficial y Cédula • <strong>{teamPlayers.length}</strong> Jugadores Registrados
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 self-end sm:self-center">
            {/* Subir Cédula button */}
            <button
              type="button"
              onClick={() => onOpenCedulaUpload(team.id)}
              className="flex items-center gap-1.5 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white font-bold py-2 px-3.5 rounded-xl transition-all shadow-md text-xs uppercase tracking-wider cursor-pointer active:scale-95"
              title="Subir cédula en foto, PDF o Excel"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Subir Cédula</span>
            </button>

            {/* Close modal */}
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-xl hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {/* Action Row: Agregar Jugador Manualmente & Search Bar */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              {canEdit && (
                <button
                  type="button"
                  onClick={() => setShowAddForm(prev => !prev)}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-black text-xs uppercase tracking-wider transition-all cursor-pointer shadow-sm ${
                    showAddForm 
                      ? 'bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200' 
                      : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-600/20 active:scale-95'
                  }`}
                >
                  <UserPlus className="w-4 h-4" />
                  <span>{showAddForm ? 'Ocultar Formulario' : 'Agregar Jugador Manualmente'}</span>
                </button>
              )}
            </div>

            {/* Search */}
            <div className="relative flex-1 max-w-sm">
              <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar por nombre, número o posición..."
                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl pl-9 pr-4 py-2 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-600"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Inline Add Player Form */}
          <AnimatePresence>
            {showAddForm && (
              <motion.div
                initial={{ opacity: 0, height: 0, y: -10 }}
                animate={{ opacity: 1, height: 'auto', y: 0 }}
                exit={{ opacity: 0, height: 0, y: -10 }}
                className="overflow-hidden"
              >
                <form
                  onSubmit={handleCreatePlayer}
                  className="bg-indigo-50/40 dark:bg-slate-950/60 border border-indigo-200/60 dark:border-slate-800 rounded-2xl p-5 space-y-4"
                >
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-black uppercase tracking-wider text-indigo-700 dark:text-indigo-400 flex items-center gap-1.5">
                      <UserPlus className="w-4 h-4" />
                      <span>Nuevo Jugador para {team.name}</span>
                    </h4>
                    <button
                      type="button"
                      onClick={() => setShowAddForm(false)}
                      className="text-slate-400 hover:text-slate-600 text-xs font-bold"
                    >
                      Cancelar
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                    <div className="sm:col-span-2 space-y-1">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider"># Jersey</label>
                      <input
                        type="text"
                        required
                        value={newNumber}
                        onChange={(e) => setNewNumber(e.target.value)}
                        placeholder="00"
                        className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-bold text-center text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-600"
                      />
                    </div>

                    <div className="sm:col-span-5 space-y-1">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Nombre Completo</label>
                      <input
                        type="text"
                        required
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        placeholder="Ej. Dylan Alvarez"
                        className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-semibold text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-600"
                      />
                    </div>

                    <div className="sm:col-span-2 space-y-1">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Posición</label>
                      <select
                        value={newPosition}
                        onChange={(e) => setNewPosition(e.target.value)}
                        className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-xs font-semibold text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-600 cursor-pointer"
                      >
                        {BASEBALL_POSITIONS.map(pos => (
                          <option key={pos} value={pos}>{pos}</option>
                        ))}
                        <option value="OF">OF</option>
                        <option value="INF">INF</option>
                        <option value="UTIL">UTIL</option>
                      </select>
                    </div>

                    <div className="sm:col-span-3 space-y-1">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Info Cédula / Notas</label>
                      <input
                        type="text"
                        value={newNotes}
                        onChange={(e) => setNewNotes(e.target.value)}
                        placeholder="Edad, CURP o rol"
                        className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-600"
                      />
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setShowAddForm(false)}
                      className="px-4 py-2 rounded-xl text-xs font-bold text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 cursor-pointer"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      disabled={isSubmitting || !newName.trim()}
                      className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold uppercase tracking-wider shadow-md transition-all cursor-pointer active:scale-95 disabled:opacity-50"
                    >
                      {isSubmitting ? 'Guardando...' : 'Guardar Jugador'}
                    </button>
                  </div>
                </form>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Players Table / List */}
          {teamPlayers.length === 0 ? (
            <div className="bg-slate-50 dark:bg-slate-950/40 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-3xl p-12 text-center space-y-4">
              <Users className="w-14 h-14 text-slate-300 dark:text-slate-700 mx-auto" />
              <div className="space-y-1 max-w-md mx-auto">
                <h4 className="text-lg font-black text-slate-800 dark:text-slate-200">
                  No hay jugadores registrados para {team.name}
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Puedes subir la cédula del equipo (foto de la hoja, documento PDF o tabla de Excel) o agregarlos manualmente uno por uno.
                </p>
              </div>

              <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => onOpenCedulaUpload(team.id)}
                  className="flex items-center gap-2 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white font-bold py-2.5 px-5 rounded-2xl shadow-lg shadow-indigo-600/20 text-xs uppercase tracking-wider cursor-pointer active:scale-95"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>Subir Cédula del Equipo</span>
                </button>

                {canEdit && (
                  <button
                    type="button"
                    onClick={() => setShowAddForm(true)}
                    className="flex items-center gap-2 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-bold py-2.5 px-5 rounded-2xl text-xs uppercase tracking-wider cursor-pointer transition-all"
                  >
                    <UserPlus className="w-4 h-4" />
                    <span>Agregar Manualmente</span>
                  </button>
                )}
              </div>
            </div>
          ) : filteredPlayers.length === 0 ? (
            <div className="bg-slate-50 dark:bg-slate-950/40 border border-slate-200 dark:border-slate-800 rounded-2xl p-8 text-center text-xs text-slate-500">
              No se encontraron jugadores que coincidan con "{searchQuery}".
            </div>
          ) : (
            <div className="border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-100 dark:bg-slate-800/90 text-[10px] font-black uppercase text-slate-500 tracking-wider">
                  <tr>
                    <th className="py-3 px-4 w-16">#</th>
                    <th className="py-3 px-4">Jugador</th>
                    <th className="py-3 px-4 w-28">Posición</th>
                    <th className="py-3 px-4 hidden md:table-cell">Info Cédula / Notas</th>
                    <th className="py-3 px-4 w-20 text-center">AVG</th>
                    {canEdit && <th className="py-3 px-4 w-28 text-center">Acciones</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filteredPlayers.map((player, idx) => (
                    <tr 
                      key={player.id}
                      className="hover:bg-indigo-50/30 dark:hover:bg-slate-800/40 transition-colors group"
                    >
                      {/* Jersey Number */}
                      <td className="py-3 px-4 font-black">
                        <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 flex items-center justify-center font-black text-xs border border-slate-200 dark:border-slate-700">
                          #{player.number}
                        </div>
                      </td>

                      {/* Name */}
                      <td className="py-3 px-4">
                        <div className="font-bold text-slate-900 dark:text-slate-100 text-sm">
                          {player.name}
                        </div>
                        {player.notes && (
                          <div className="text-[10px] text-slate-400 md:hidden mt-0.5">
                            {player.notes}
                          </div>
                        )}
                      </td>

                      {/* Position */}
                      <td className="py-3 px-4">
                        <span className="px-2 py-0.5 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 rounded-md text-[10px] font-black uppercase tracking-wider">
                          {player.position}
                        </span>
                      </td>

                      {/* Notes / Info de la cédula */}
                      <td className="py-3 px-4 hidden md:table-cell text-slate-500 dark:text-slate-400 text-xs">
                        {player.notes ? (
                          <span className="italic">{player.notes}</span>
                        ) : (
                          <span className="text-slate-300 dark:text-slate-600 text-[10px]">—</span>
                        )}
                      </td>

                      {/* AVG */}
                      <td className="py-3 px-4 text-center">
                        {(() => {
                          const acc = playerStatsMap.get(player.id);
                          const ab = acc ? acc.atBats : (player.stats?.atBats || 0);
                          const h = acc ? acc.hits : (player.stats?.hits || 0);
                          const avgStr = acc ? acc.avgStr : (ab > 0 ? (h / ab).toFixed(3).replace(/^0/, '') : '.000');
                          return (
                            <>
                              <div className="font-black text-indigo-600 dark:text-indigo-400">
                                {avgStr}
                              </div>
                              <div className="text-[9px] text-slate-400 font-medium">
                                {h}H / {ab}VB
                              </div>
                            </>
                          );
                        })()}
                      </td>

                      {/* Actions: Ver Ficha, Editar & Quitar */}
                      <td className="py-3 px-4 text-center">
                        <div className="flex items-center justify-center gap-1">
                          {onViewPlayerStats && (
                            <button
                              type="button"
                              onClick={() => onViewPlayerStats(player)}
                              className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-slate-100 dark:hover:bg-slate-700/60 rounded-lg transition-colors cursor-pointer"
                              title="Ver ficha y estadísticas acumuladas"
                            >
                              <BarChart3 className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {canEdit && (
                            <>
                              <button
                                type="button"
                                onClick={() => handleStartEdit(player)}
                                className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-slate-100 dark:hover:bg-slate-700/60 rounded-lg transition-colors cursor-pointer"
                                title="Editar jugador"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setPlayerToDelete(player)}
                                className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg transition-colors cursor-pointer"
                                title="Quitar jugador del roster"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 px-6 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500 bg-slate-50/50 dark:bg-slate-950/40">
          <span>Mostrando <strong>{filteredPlayers.length}</strong> de <strong>{teamPlayers.length}</strong> jugadores</span>
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 transition-all cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      </motion.div>

      {/* Edit Player Modal */}
      {playerToEdit && (
        <div className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-3xl p-6 max-w-md w-full space-y-4 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-black text-slate-900 dark:text-white uppercase tracking-tight">
                Editar Jugador
              </h3>
              <button onClick={() => setPlayerToEdit(null)} className="p-1 text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="space-y-3">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase">Nombre Completo</label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-semibold text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-600"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase"># Uniforme</label>
                  <input
                    type="text"
                    required
                    value={editNumber}
                    onChange={(e) => setEditNumber(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-sm font-bold text-center text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-600"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase">Posición</label>
                  <select
                    value={editPosition}
                    onChange={(e) => setEditPosition(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-xs font-semibold text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-600 cursor-pointer"
                  >
                    {BASEBALL_POSITIONS.map(pos => (
                      <option key={pos} value={pos}>{pos}</option>
                    ))}
                    <option value="OF">OF</option>
                    <option value="INF">INF</option>
                    <option value="UTIL">UTIL</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-500 uppercase">Información / Notas de Cédula</label>
                <input
                  type="text"
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  placeholder="CURP, edad, rol"
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-600"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setPlayerToEdit(null)}
                  className="flex-1 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-200 font-bold py-2.5 rounded-xl text-xs uppercase cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 rounded-xl text-xs uppercase shadow-md cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting ? 'Guardando...' : 'Actualizar'}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* Delete Player Confirmation */}
      {playerToDelete && (
        <div className="fixed inset-0 bg-black/70 z-[100] flex items-center justify-center p-4">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-3xl p-6 max-w-sm w-full space-y-5 text-center shadow-2xl"
          >
            <div className="w-14 h-14 bg-red-500/10 text-red-500 rounded-2xl flex items-center justify-center mx-auto">
              <Trash2 className="w-7 h-7" />
            </div>
            <div className="space-y-1">
              <h3 className="text-xl font-black text-slate-900 dark:text-white">¿Quitar Jugador?</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                ¿Estás seguro de que deseas quitar a <strong className="text-slate-900 dark:text-white">{playerToDelete.name}</strong> (#{playerToDelete.number}) del roster de {team.name}?
              </p>
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setPlayerToDelete(null)}
                className="flex-1 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-200 font-bold py-2.5 rounded-xl text-xs uppercase cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={isSubmitting}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white font-bold py-2.5 rounded-xl text-xs uppercase shadow-lg shadow-red-600/20 cursor-pointer disabled:opacity-50"
              >
                {isSubmitting ? 'Quitando...' : 'Quitar'}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
