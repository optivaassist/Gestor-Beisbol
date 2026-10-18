import React, { useState } from 'react';
import { Player, Game, Team, UserProfile } from '../types';
import { PlayerAccumulatedStats } from '../utils/playerStatsCalculator';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { motion, AnimatePresence } from 'motion/react';
import {
  X,
  Trophy,
  Target,
  Activity,
  Shield,
  Star,
  Zap,
  Calendar,
  Medal,
  Clock,
  History,
  TrendingUp,
  Flame,
  Award,
  Edit3,
  Save,
  CheckCircle2,
  AlertCircle,
  Loader2
} from 'lucide-react';

interface PlayerDetailModalProps {
  stats: PlayerAccumulatedStats;
  userProfile?: UserProfile | null;
  onClose: () => void;
  onUpdateSuccess?: () => void;
}

export default function PlayerDetailModal({
  stats,
  userProfile,
  onClose,
  onUpdateSuccess
}: PlayerDetailModalProps) {
  const [activeTab, setActiveTab] = useState<'overview' | 'batting' | 'pitching' | 'gamelog'>('overview');
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Editable fields state for Admin / Jefe
  const [editForm, setEditForm] = useState({
    atBats: stats.atBats,
    hits: stats.hits,
    doubles: stats.doubles,
    triples: stats.triples,
    homeRuns: stats.homeRuns,
    runs: stats.runs,
    rbis: stats.rbis,
    walks: stats.walks,
    strikeouts: stats.strikeouts,
    wins: stats.wins,
    losses: stats.losses,
    inningsPitched: stats.inningsPitched,
    earnedRuns: stats.earnedRuns,
    era: stats.era,
    pitches: stats.pitches,
    pitchingStrikeouts: stats.pitchingStrikeouts,
    pitchingWalks: stats.pitchingWalks,
  });

  const canEdit = userProfile?.role === 'admin' || userProfile?.role === 'editor' || userProfile?.role === 'jefe_categoria';

  const handleSaveStats = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const playerRef = doc(db, 'players', stats.player.id);
      
      const newBattingAvg = editForm.atBats > 0 ? (editForm.hits / editForm.atBats) : 0;
      const newEra = editForm.inningsPitched > 0 ? ((editForm.earnedRuns * 9) / editForm.inningsPitched) : editForm.era;

      await updateDoc(playerRef, {
        'stats.atBats': Number(editForm.atBats) || 0,
        'stats.hits': Number(editForm.hits) || 0,
        'stats.doubles': Number(editForm.doubles) || 0,
        'stats.triples': Number(editForm.triples) || 0,
        'stats.homeRuns': Number(editForm.homeRuns) || 0,
        'stats.runs': Number(editForm.runs) || 0,
        'stats.rbis': Number(editForm.rbis) || 0,
        'stats.walks': Number(editForm.walks) || 0,
        'stats.strikeouts': Number(editForm.strikeouts) || 0,
        'stats.battingAverage': Number(newBattingAvg) || 0,
        'stats.wins': Number(editForm.wins) || 0,
        'stats.losses': Number(editForm.losses) || 0,
        'stats.inningsPitched': Number(editForm.inningsPitched) || 0,
        'stats.earnedRuns': Number(editForm.earnedRuns) || 0,
        'stats.era': Number(newEra) || 0,
        'stats.pitches': Number(editForm.pitches) || 0,
        'stats.pitchingStrikeouts': Number(editForm.pitchingStrikeouts) || 0,
        'stats.pitchingWalks': Number(editForm.pitchingWalks) || 0,
      });

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
      setIsEditing(false);
      if (onUpdateSuccess) onUpdateSuccess();
    } catch (err) {
      console.error('Error saving player stats:', err);
      handleFirestoreError(err, OperationType.UPDATE, `players/${stats.player.id}`);
    } finally {
      setIsSaving(false);
    }
  };

  const isPitcher = stats.player.position?.toUpperCase() === 'P' || stats.wins > 0 || stats.pitches > 0 || stats.inningsPitched > 0;

  return (
    <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-md z-50 flex items-center justify-center p-3 sm:p-4 lg:p-6 overflow-y-auto">
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 15 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 15 }}
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[2.5rem] p-5 sm:p-8 max-w-4xl w-full shadow-2xl max-h-[92vh] flex flex-col space-y-6 text-slate-900 dark:text-white"
      >
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-5">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-indigo-600 to-blue-600 text-white flex items-center justify-center font-black text-2xl shadow-xl shadow-indigo-600/25">
              {stats.player.number ? `#${stats.player.number}` : stats.player.name.substring(0, 1)}
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-2xl font-black uppercase tracking-tight text-slate-900 dark:text-white">
                  {stats.player.name}
                </h3>
                <span className="px-2.5 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 text-[10px] font-black uppercase tracking-wider">
                  {stats.player.position || 'POS'}
                </span>
                <span className="px-2.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-[10px] font-black uppercase tracking-wider">
                  {stats.category}
                </span>
              </div>
              <p className="text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mt-0.5">
                {stats.teamName} • {stats.gamesPlayedCount} {stats.gamesPlayedCount === 1 ? 'partido jugado' : 'partidos jugados'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {canEdit && (
              <button
                type="button"
                onClick={() => setIsEditing(!isEditing)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                  isEditing 
                    ? 'bg-amber-500 text-white shadow-md shadow-amber-500/20' 
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200'
                }`}
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>{isEditing ? 'Cancelar Edición' : 'Editar Estadísticas'}</span>
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 transition-all cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {saveSuccess && (
          <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl flex items-center gap-2 text-xs font-bold text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="w-4 h-4" />
            <span>Estadísticas actualizadas con éxito en Firestore.</span>
          </div>
        )}

        {/* 7 Key Highlighted Metrics Bar (AVG, HR, RBI, IP, ERA, W, Pitches) */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5">
          {/* 1. AVG */}
          <div className="p-3.5 rounded-2xl bg-indigo-50/70 dark:bg-slate-800/60 border border-indigo-100 dark:border-slate-800 text-center space-y-1">
            <span className="text-[10px] font-black uppercase tracking-widest text-indigo-600 dark:text-indigo-400 flex items-center justify-center gap-1">
              <Star className="w-3 h-3" /> AVG
            </span>
            <div className="text-2xl font-black text-slate-900 dark:text-white">{stats.avgStr}</div>
            <span className="text-[9px] text-slate-400 font-bold block">{stats.hits} H / {stats.atBats} AB</span>
          </div>

          {/* 2. HR */}
          <div className="p-3.5 rounded-2xl bg-purple-50/70 dark:bg-slate-800/60 border border-purple-100 dark:border-slate-800 text-center space-y-1">
            <span className="text-[10px] font-black uppercase tracking-widest text-purple-600 dark:text-purple-400 flex items-center justify-center gap-1">
              <Trophy className="w-3 h-3" /> HR
            </span>
            <div className="text-2xl font-black text-slate-900 dark:text-white">{stats.homeRuns}</div>
            <span className="text-[9px] text-slate-400 font-bold block">Jonrones</span>
          </div>

          {/* 3. RBI */}
          <div className="p-3.5 rounded-2xl bg-emerald-50/70 dark:bg-slate-800/60 border border-emerald-100 dark:border-slate-800 text-center space-y-1">
            <span className="text-[10px] font-black uppercase tracking-widest text-emerald-600 dark:text-emerald-400 flex items-center justify-center gap-1">
              <Medal className="w-3 h-3" /> RBI
            </span>
            <div className="text-2xl font-black text-slate-900 dark:text-white">{stats.rbis}</div>
            <span className="text-[9px] text-slate-400 font-bold block">Impulsadas</span>
          </div>

          {/* 4. IP */}
          <div className="p-3.5 rounded-2xl bg-blue-50/70 dark:bg-slate-800/60 border border-blue-100 dark:border-slate-800 text-center space-y-1">
            <span className="text-[10px] font-black uppercase tracking-widest text-blue-600 dark:text-blue-400 flex items-center justify-center gap-1">
              <Clock className="w-3 h-3" /> IP
            </span>
            <div className="text-2xl font-black text-slate-900 dark:text-white">
              {stats.inningsPitched > 0 ? stats.inningsPitched.toFixed(1) : '0.0'}
            </div>
            <span className="text-[9px] text-slate-400 font-bold block">Entradas</span>
          </div>

          {/* 5. ERA */}
          <div className="p-3.5 rounded-2xl bg-amber-50/70 dark:bg-slate-800/60 border border-amber-100 dark:border-slate-800 text-center space-y-1">
            <span className="text-[10px] font-black uppercase tracking-widest text-amber-600 dark:text-amber-400 flex items-center justify-center gap-1">
              <Shield className="w-3 h-3" /> ERA
            </span>
            <div className="text-2xl font-black text-slate-900 dark:text-white">{stats.eraStr}</div>
            <span className="text-[9px] text-slate-400 font-bold block">Efectividad</span>
          </div>

          {/* 6. W (Juegos Ganados) */}
          <div className="p-3.5 rounded-2xl bg-rose-50/70 dark:bg-slate-800/60 border border-rose-100 dark:border-slate-800 text-center space-y-1">
            <span className="text-[10px] font-black uppercase tracking-widest text-rose-600 dark:text-rose-400 flex items-center justify-center gap-1">
              <Activity className="w-3 h-3" /> Ganados
            </span>
            <div className="text-2xl font-black text-slate-900 dark:text-white">{stats.wins}</div>
            <span className="text-[9px] text-slate-400 font-bold block">Juegos (P)</span>
          </div>

          {/* 7. Pitches (Pitchadas Lanzadas) */}
          <div className="p-3.5 rounded-2xl bg-cyan-50/70 dark:bg-slate-800/60 border border-cyan-100 dark:border-slate-800 text-center space-y-1 col-span-2 sm:col-span-1">
            <span className="text-[10px] font-black uppercase tracking-widest text-cyan-600 dark:text-cyan-400 flex items-center justify-center gap-1">
              <Flame className="w-3 h-3" /> Lanzamientos
            </span>
            <div className="text-2xl font-black text-slate-900 dark:text-white">{stats.pitches}</div>
            <span className="text-[9px] text-slate-400 font-bold block">Pitchadas</span>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-2xl">
          <button
            onClick={() => setActiveTab('overview')}
            className={`flex-1 py-2 text-xs font-black uppercase tracking-wider rounded-xl transition-all ${
              activeTab === 'overview'
                ? 'bg-white dark:bg-slate-900 text-indigo-600 shadow-sm'
                : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            Resumen General
          </button>
          <button
            onClick={() => setActiveTab('batting')}
            className={`flex-1 py-2 text-xs font-black uppercase tracking-wider rounded-xl transition-all ${
              activeTab === 'batting'
                ? 'bg-white dark:bg-slate-900 text-indigo-600 shadow-sm'
                : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            Bateo Detallado
          </button>
          <button
            onClick={() => setActiveTab('pitching')}
            className={`flex-1 py-2 text-xs font-black uppercase tracking-wider rounded-xl transition-all ${
              activeTab === 'pitching'
                ? 'bg-white dark:bg-slate-900 text-indigo-600 shadow-sm'
                : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            Labor de Pitcheo
          </button>
          <button
            onClick={() => setActiveTab('gamelog')}
            className={`flex-1 py-2 text-xs font-black uppercase tracking-wider rounded-xl transition-all ${
              activeTab === 'gamelog'
                ? 'bg-white dark:bg-slate-900 text-indigo-600 shadow-sm'
                : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            Historial de Juegos ({stats.gameLogs.length})
          </button>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 overflow-y-auto pr-1 space-y-6">
          {/* Edit Form Modal Mode */}
          {isEditing && (
            <form onSubmit={handleSaveStats} className="bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700/60 pb-3">
                <h4 className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                  <Edit3 className="w-4 h-4 text-indigo-600" />
                  Editar / Calibrar Estadísticas Acumuladas
                </h4>
                <span className="text-[10px] text-slate-400">Guarda directamente en el perfil del jugador</span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div>
                  <label className="text-[10px] font-bold text-slate-400 block mb-1">Turnos al Bat (AB)</label>
                  <input
                    type="number"
                    min="0"
                    value={editForm.atBats}
                    onChange={(e) => setEditForm({ ...editForm, atBats: Number(e.target.value) })}
                    className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-1.5 font-bold"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 block mb-1">Hits (H)</label>
                  <input
                    type="number"
                    min="0"
                    value={editForm.hits}
                    onChange={(e) => setEditForm({ ...editForm, hits: Number(e.target.value) })}
                    className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-1.5 font-bold"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 block mb-1">Jonrones (HR)</label>
                  <input
                    type="number"
                    min="0"
                    value={editForm.homeRuns}
                    onChange={(e) => setEditForm({ ...editForm, homeRuns: Number(e.target.value) })}
                    className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-1.5 font-bold"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 block mb-1">Impulsadas (RBI)</label>
                  <input
                    type="number"
                    min="0"
                    value={editForm.rbis}
                    onChange={(e) => setEditForm({ ...editForm, rbis: Number(e.target.value) })}
                    className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-1.5 font-bold"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 block mb-1">Carreras Anotadas (R)</label>
                  <input
                    type="number"
                    min="0"
                    value={editForm.runs}
                    onChange={(e) => setEditForm({ ...editForm, runs: Number(e.target.value) })}
                    className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-1.5 font-bold"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 block mb-1">Bases por Bola (BB)</label>
                  <input
                    type="number"
                    min="0"
                    value={editForm.walks}
                    onChange={(e) => setEditForm({ ...editForm, walks: Number(e.target.value) })}
                    className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-1.5 font-bold"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 block mb-1">Ponches (K)</label>
                  <input
                    type="number"
                    min="0"
                    value={editForm.strikeouts}
                    onChange={(e) => setEditForm({ ...editForm, strikeouts: Number(e.target.value) })}
                    className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-1.5 font-bold"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 block mb-1">Juegos Ganados (W Pitcher)</label>
                  <input
                    type="number"
                    min="0"
                    value={editForm.wins}
                    onChange={(e) => setEditForm({ ...editForm, wins: Number(e.target.value) })}
                    className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-1.5 font-bold text-indigo-600"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 block mb-1">Entradas Lanzadas (IP)</label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    value={editForm.inningsPitched}
                    onChange={(e) => setEditForm({ ...editForm, inningsPitched: Number(e.target.value) })}
                    className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-1.5 font-bold"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 block mb-1">Carreras Limpias (ER)</label>
                  <input
                    type="number"
                    min="0"
                    value={editForm.earnedRuns}
                    onChange={(e) => setEditForm({ ...editForm, earnedRuns: Number(e.target.value) })}
                    className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-1.5 font-bold"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 block mb-1">Pitchadas Lanzadas (Lanzamientos)</label>
                  <input
                    type="number"
                    min="0"
                    value={editForm.pitches}
                    onChange={(e) => setEditForm({ ...editForm, pitches: Number(e.target.value) })}
                    className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-1.5 font-bold text-cyan-600"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 block mb-1">Ponches Recetados (K Pitcher)</label>
                  <input
                    type="number"
                    min="0"
                    value={editForm.pitchingStrikeouts}
                    onChange={(e) => setEditForm({ ...editForm, pitchingStrikeouts: Number(e.target.value) })}
                    className="w-full bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl px-3 py-1.5 font-bold"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  className="px-4 py-2 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-200 transition-all"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="flex items-center gap-1.5 px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-600/20 transition-all cursor-pointer"
                >
                  {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  <span>Guardar Estadísticas</span>
                </button>
              </div>
            </form>
          )}

          {/* Tab 1: Overview */}
          {activeTab === 'overview' && (
            <div className="space-y-6">
              {/* Batting Summary Table */}
              <div className="border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden bg-white dark:bg-slate-900">
                <div className="p-4 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                  <h4 className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-slate-200 flex items-center gap-2">
                    <Target className="w-4 h-4 text-indigo-600" />
                    Resumen de Bateo
                  </h4>
                  <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 dark:bg-indigo-950/60 px-2 py-0.5 rounded-full">
                    AVG {stats.avgStr} • OBP {stats.obpStr} • SLG {stats.slgStr}
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-center text-xs">
                    <thead>
                      <tr className="bg-slate-100/60 dark:bg-slate-800/30 text-slate-500 font-black text-[10px] uppercase border-b border-slate-100 dark:border-slate-800">
                        <th className="py-2.5 px-3">VB (AB)</th>
                        <th className="py-2.5 px-3">C (R)</th>
                        <th className="py-2.5 px-3">H</th>
                        <th className="py-2.5 px-3">2B</th>
                        <th className="py-2.5 px-3">3B</th>
                        <th className="py-2.5 px-3 text-purple-600">HR</th>
                        <th className="py-2.5 px-3 text-emerald-600">CI (RBI)</th>
                        <th className="py-2.5 px-3">BB</th>
                        <th className="py-2.5 px-3">K (SO)</th>
                        <th className="py-2.5 px-3 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 font-black">AVG</th>
                        <th className="py-2.5 px-3">OPS</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="font-bold text-slate-800 dark:text-slate-200">
                        <td className="py-3 px-3">{stats.atBats}</td>
                        <td className="py-3 px-3 text-amber-600">{stats.runs}</td>
                        <td className="py-3 px-3 text-indigo-600">{stats.hits}</td>
                        <td className="py-3 px-3">{stats.doubles}</td>
                        <td className="py-3 px-3">{stats.triples}</td>
                        <td className="py-3 px-3 text-purple-600 font-black">{stats.homeRuns}</td>
                        <td className="py-3 px-3 text-emerald-600 font-black">{stats.rbis}</td>
                        <td className="py-3 px-3">{stats.walks}</td>
                        <td className="py-3 px-3">{stats.strikeouts}</td>
                        <td className="py-3 px-3 bg-indigo-50/70 dark:bg-indigo-950/40 text-indigo-600 font-black text-sm">{stats.avgStr}</td>
                        <td className="py-3 px-3 font-black">{stats.ops}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Pitching Summary Table */}
              <div className="border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden bg-white dark:bg-slate-900">
                <div className="p-4 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                  <h4 className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-slate-200 flex items-center gap-2">
                    <Activity className="w-4 h-4 text-cyan-600" />
                    Resumen de Pitcheo
                  </h4>
                  <span className="text-[10px] font-bold text-cyan-600 bg-cyan-50 dark:bg-cyan-950/60 px-2 py-0.5 rounded-full">
                    {stats.wins} Victorias • {stats.pitches} Pitchadas Lanzadas
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-center text-xs">
                    <thead>
                      <tr className="bg-slate-100/60 dark:bg-slate-800/30 text-slate-500 font-black text-[10px] uppercase border-b border-slate-100 dark:border-slate-800">
                        <th className="py-2.5 px-3 text-rose-600">W (Ganados)</th>
                        <th className="py-2.5 px-3">L (Derrotas)</th>
                        <th className="py-2.5 px-3">IP (Entradas)</th>
                        <th className="py-2.5 px-3 text-amber-600">ERA (Efectividad)</th>
                        <th className="py-2.5 px-3 text-cyan-600 font-black">Lanzamientos</th>
                        <th className="py-2.5 px-3">K (Ponches)</th>
                        <th className="py-2.5 px-3">BB (Boletos)</th>
                        <th className="py-2.5 px-3">CL (Limpias)</th>
                        <th className="py-2.5 px-3">WHIP</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="font-bold text-slate-800 dark:text-slate-200">
                        <td className="py-3 px-3 text-rose-600 font-black text-sm">{stats.wins}</td>
                        <td className="py-3 px-3">{stats.losses}</td>
                        <td className="py-3 px-3">{stats.inningsPitched > 0 ? stats.inningsPitched.toFixed(1) : '0.0'}</td>
                        <td className="py-3 px-3 text-amber-600 font-black text-sm">{stats.eraStr}</td>
                        <td className="py-3 px-3 text-cyan-600 font-black text-sm">{stats.pitches}</td>
                        <td className="py-3 px-3">{stats.pitchingStrikeouts}</td>
                        <td className="py-3 px-3">{stats.pitchingWalks}</td>
                        <td className="py-3 px-3">{stats.earnedRuns}</td>
                        <td className="py-3 px-3">{stats.whip}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Tab 2: Batting */}
          {activeTab === 'batting' && (
            <div className="space-y-4">
              <div className="border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden bg-white dark:bg-slate-900">
                <div className="p-4 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800">
                  <h4 className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-slate-200">
                    Estadísticas Detalladas de Bateo Acumuladas
                  </h4>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-5">
                  <div className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl space-y-1">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Turnos Oficiales (AB)</span>
                    <p className="text-xl font-black">{stats.atBats}</p>
                  </div>
                  <div className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl space-y-1">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Hits Totales (H)</span>
                    <p className="text-xl font-black text-indigo-600">{stats.hits}</p>
                  </div>
                  <div className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl space-y-1">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Dobles (2B)</span>
                    <p className="text-xl font-black">{stats.doubles}</p>
                  </div>
                  <div className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl space-y-1">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Triples (3B)</span>
                    <p className="text-xl font-black">{stats.triples}</p>
                  </div>
                  <div className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl space-y-1">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Jonrones (HR)</span>
                    <p className="text-xl font-black text-purple-600">{stats.homeRuns}</p>
                  </div>
                  <div className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl space-y-1">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Carreras Impulsadas (RBI)</span>
                    <p className="text-xl font-black text-emerald-600">{stats.rbis}</p>
                  </div>
                  <div className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl space-y-1">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Carreras Anotadas (R)</span>
                    <p className="text-xl font-black text-amber-600">{stats.runs}</p>
                  </div>
                  <div className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl space-y-1">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Bases por Bolas (BB)</span>
                    <p className="text-xl font-black">{stats.walks}</p>
                  </div>
                  <div className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl space-y-1">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Ponches (K)</span>
                    <p className="text-xl font-black text-rose-500">{stats.strikeouts}</p>
                  </div>
                  <div className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl space-y-1">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Promedio de Bateo (AVG)</span>
                    <p className="text-xl font-black text-indigo-600">{stats.avgStr}</p>
                  </div>
                  <div className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl space-y-1">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Porcentaje Embasado (OBP)</span>
                    <p className="text-xl font-black">{stats.obpStr}</p>
                  </div>
                  <div className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl space-y-1">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Slugging (SLG)</span>
                    <p className="text-xl font-black">{stats.slgStr}</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Tab 3: Pitching */}
          {activeTab === 'pitching' && (
            <div className="space-y-4">
              <div className="border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden bg-white dark:bg-slate-900">
                <div className="p-4 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800">
                  <h4 className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-slate-200">
                    Estadísticas Detalladas de Pitcheo y Lanzamientos
                  </h4>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-5">
                  <div className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl space-y-1">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Juegos Ganados (W)</span>
                    <p className="text-xl font-black text-rose-600">{stats.wins}</p>
                  </div>
                  <div className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl space-y-1">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Juegos Perdidos (L)</span>
                    <p className="text-xl font-black">{stats.losses}</p>
                  </div>
                  <div className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl space-y-1">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Entradas Lanzadas (IP)</span>
                    <p className="text-xl font-black">{stats.inningsPitched > 0 ? stats.inningsPitched.toFixed(1) : '0.0'}</p>
                  </div>
                  <div className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl space-y-1">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Efectividad (ERA)</span>
                    <p className="text-xl font-black text-amber-600">{stats.eraStr}</p>
                  </div>
                  <div className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl space-y-1">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Total Lanzamientos</span>
                    <p className="text-xl font-black text-cyan-600">{stats.pitches}</p>
                  </div>
                  <div className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl space-y-1">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Ponches Propinados (K)</span>
                    <p className="text-xl font-black">{stats.pitchingStrikeouts}</p>
                  </div>
                  <div className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl space-y-1">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Bases por Bola (BB)</span>
                    <p className="text-xl font-black">{stats.pitchingWalks}</p>
                  </div>
                  <div className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl space-y-1">
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Carreras Limpias (CL)</span>
                    <p className="text-xl font-black">{stats.earnedRuns}</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Tab 4: Game Log History */}
          {activeTab === 'gamelog' && (
            <div className="space-y-4">
              <div className="border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden bg-white dark:bg-slate-900">
                <div className="p-4 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                  <h4 className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-slate-200 flex items-center gap-2">
                    <History className="w-4 h-4 text-indigo-600" />
                    Historial de Partidos y Anotaciones
                  </h4>
                  <span className="text-[10px] text-slate-400 font-bold">
                    {stats.gameLogs.length} juegos registrados
                  </span>
                </div>

                {stats.gameLogs.length === 0 ? (
                  <div className="p-8 text-center text-slate-400 text-xs italic">
                    Aún no hay partidos programados o finalizados para este equipo.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100 dark:divide-slate-800">
                    {stats.gameLogs.map((log) => (
                      <div key={log.gameId} className="p-4 hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-black text-slate-900 dark:text-white uppercase">
                              {log.isHome ? 'vs' : '@'} {log.opponentName}
                            </span>
                            {log.jornada !== undefined && (
                              <span className="text-[9px] font-black bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 px-2 py-0.5 rounded-full uppercase">
                                J{log.jornada}
                              </span>
                            )}
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                              log.isWin === true ? 'bg-emerald-500/10 text-emerald-600' :
                              log.isWin === false ? 'bg-rose-500/10 text-rose-500' :
                              'bg-slate-100 dark:bg-slate-800 text-slate-400'
                            }`}>
                              {log.gameStatus === 'completed' 
                                ? (log.isWin ? `G ${log.teamScore}-${log.opponentScore}` : `P ${log.teamScore}-${log.opponentScore}`)
                                : 'Programado'}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-400">
                            {new Date(log.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                          </p>
                        </div>

                        {/* Player Performance in this game */}
                        <div className="flex items-center gap-2 self-start sm:self-auto">
                          {log.played ? (
                            <div className="flex items-center gap-2 bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-100 dark:border-indigo-800/60 px-3 py-1.5 rounded-xl">
                              <span className="font-black text-indigo-600 dark:text-indigo-400">
                                {log.battingLine}
                              </span>
                              {(log.hr > 0 || log.rbi > 0) && (
                                <span className="text-[10px] font-bold text-slate-600 dark:text-slate-300">
                                  {log.hr > 0 ? `${log.hr} HR ` : ''}{log.rbi > 0 ? `${log.rbi} CI` : ''}
                                </span>
                              )}
                              {log.extraNotes && (
                                <span className="text-[10px] text-slate-400 truncate max-w-[120px]" title={log.extraNotes}>
                                  ({log.extraNotes})
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-[10px] font-bold text-slate-400 bg-slate-100 dark:bg-slate-800 px-2.5 py-1 rounded-lg">
                              No jugó / 0
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-800 text-xs">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
            ID: {stats.player.id.substring(0, 10)}...
          </span>
          <button
            onClick={onClose}
            className="px-5 py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 font-bold rounded-xl transition-all cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      </motion.div>
    </div>
  );
}
