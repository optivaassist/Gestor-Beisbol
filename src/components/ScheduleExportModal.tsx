import React, { useState, useMemo } from 'react';
import { Game, Team, Category, CATEGORIES, TournamentType, TOURNAMENTS, Season, formatFieldName } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import {
  FileDown,
  X,
  Calendar,
  Layers,
  Trophy,
  Filter,
  CheckCircle2,
  Download,
  Clock,
  MapPin,
  Sparkles,
  Users
} from 'lucide-react';
import { downloadSchedulePDF } from '../utils/schedulePdfExporter';
import { useTeams } from '../context/TeamsContext';
import TeamLogo from './TeamLogo';

interface ScheduleExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  games: Game[];
  teams: Team[];
  seasons: Season[];
  initialCategory?: Category | 'All';
  initialJornada?: number | 'All';
  initialTournament?: TournamentType | 'All';
}

export default function ScheduleExportModal({
  isOpen,
  onClose,
  games,
  teams: propTeams,
  seasons,
  initialCategory = 'All',
  initialJornada = 'All',
  initialTournament = 'All'
}: ScheduleExportModalProps) {
  const { teams: contextTeams } = useTeams();
  // Prefer contextTeams which has the real-time logo updates from Firestore
  const teams = useMemo(() => {
    if (contextTeams && contextTeams.length > 0) return contextTeams;
    return propTeams || [];
  }, [contextTeams, propTeams]);

  const [selectedCategory, setSelectedCategory] = useState<Category | 'All'>(initialCategory);
  const [selectedJornada, setSelectedJornada] = useState<number | 'All'>(initialJornada);
  const [selectedTournament, setSelectedTournament] = useState<TournamentType | 'All'>(initialTournament);
  const [filterStatus, setFilterStatus] = useState<'all' | 'assigned' | 'pending'>('all');
  const [isExporting, setIsExporting] = useState(false);
  const [downloadSuccessName, setDownloadSuccessName] = useState<string | null>(null);

  // Distinct jornadas from games
  const availableJornadas = useMemo(() => {
    const set = new Set<number>();
    games.forEach(g => {
      if (g.jornada && !isNaN(Number(g.jornada))) {
        set.add(Number(g.jornada));
      }
    });
    return Array.from(set).sort((a, b) => a - b);
  }, [games]);

  // Active Season
  const activeSeason = seasons.find(s => s.active);

  // Matching games count and preview
  const matchingGames = useMemo(() => {
    return games.filter(g => {
      const homeTeam = teams.find(t => t.id === g.homeTeamId);
      const awayTeam = teams.find(t => t.id === g.awayTeamId);
      const gameCat = g.category || homeTeam?.category || awayTeam?.category;

      const catMatch = selectedCategory === 'All' || gameCat === selectedCategory;
      const tourMatch = selectedTournament === 'All' || g.tournament === selectedTournament || (!g.tournament && selectedTournament === 'Regular');
      const jorMatch = selectedJornada === 'All' || Number(g.jornada) === Number(selectedJornada);

      let statusMatch = true;
      if (filterStatus === 'assigned') {
        statusMatch = Boolean(g.field && g.date && !g.field.toLowerCase().includes('por definir'));
      } else if (filterStatus === 'pending') {
        statusMatch = !g.field || g.field.toLowerCase().includes('por definir');
      }

      return catMatch && tourMatch && jorMatch && statusMatch;
    });
  }, [games, teams, selectedCategory, selectedTournament, selectedJornada, filterStatus]);

  if (!isOpen) return null;

  const handleExportPDF = async () => {
    setIsExporting(true);
    try {
      const savedFileName = await downloadSchedulePDF({
        games,
        teams,
        selectedCategory,
        selectedJornada,
        selectedTournament,
        filterStatus,
        seasonName: activeSeason?.name || 'Temporada Oficial',
        leagueName: 'Liga de Béisbol Infantil y Juvenil'
      });

      setDownloadSuccessName(savedFileName);
      setTimeout(() => {
        setDownloadSuccessName(null);
        onClose();
      }, 2000);
    } catch (err) {
      console.error('Error generating PDF:', err);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-md z-50 flex items-center justify-center p-3 sm:p-4">
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 15 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 15 }}
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[2.5rem] p-6 sm:p-8 max-w-xl w-full shadow-2xl max-h-[92vh] flex flex-col space-y-6 text-slate-900 dark:text-white"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-indigo-600/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
              <FileDown className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-xl font-black uppercase tracking-tight">
                Exportar Rol <span className="text-indigo-600">en PDF</span>
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                Selecciona la categoría y jornada para generar el archivo imprimible.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 transition-all cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Success Alert */}
        <AnimatePresence>
          {downloadSuccessName && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="p-3.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 rounded-2xl text-xs font-bold flex items-center gap-2"
            >
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>¡PDF generado y descargado con éxito: {downloadSuccessName}!</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Selection Form */}
        <div className="space-y-4 overflow-y-auto pr-1">
          {/* Categoría Selector */}
          <div className="space-y-2">
            <label className="text-[11px] font-black uppercase tracking-widest text-slate-400 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-indigo-600" />
                Categoría
              </span>
              <span className="text-[10px] text-indigo-600 font-bold">
                {selectedCategory === 'All' ? 'Todas las categorías' : selectedCategory}
              </span>
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <button
                type="button"
                onClick={() => setSelectedCategory('All')}
                className={`py-2 px-3 rounded-xl text-xs font-black uppercase tracking-wider transition-all border cursor-pointer ${
                  selectedCategory === 'All'
                    ? 'bg-indigo-600 border-indigo-600 text-white shadow-md shadow-indigo-600/20'
                    : 'bg-slate-50 dark:bg-slate-800/80 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-indigo-600/40'
                }`}
              >
                Todas
              </button>
              {CATEGORIES.map(cat => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedCategory(cat)}
                  className={`py-2 px-3 rounded-xl text-xs font-black uppercase tracking-wider transition-all border cursor-pointer ${
                    selectedCategory === cat
                      ? 'bg-indigo-600 border-indigo-600 text-white shadow-md shadow-indigo-600/20'
                      : 'bg-slate-50 dark:bg-slate-800/80 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-indigo-600/40'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Jornada Selector */}
          <div className="space-y-2">
            <label className="text-[11px] font-black uppercase tracking-widest text-slate-400 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-indigo-600" />
                Jornada
              </span>
              <span className="text-[10px] text-indigo-600 font-bold">
                {selectedJornada === 'All' ? 'Todas las jornadas' : `Jornada ${selectedJornada}`}
              </span>
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setSelectedJornada('All')}
                className={`py-2 px-3.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all border cursor-pointer ${
                  selectedJornada === 'All'
                    ? 'bg-indigo-600 border-indigo-600 text-white shadow-md shadow-indigo-600/20'
                    : 'bg-slate-50 dark:bg-slate-800/80 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-indigo-600/40'
                }`}
              >
                Todas
              </button>
              {availableJornadas.length === 0 ? (
                <span className="text-xs text-slate-400 py-2">Sin jornadas numeradas en partidos</span>
              ) : (
                availableJornadas.map(j => (
                  <button
                    key={j}
                    type="button"
                    onClick={() => setSelectedJornada(j)}
                    className={`py-2 px-3.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all border cursor-pointer ${
                      selectedJornada === j
                        ? 'bg-indigo-600 border-indigo-600 text-white shadow-md shadow-indigo-600/20'
                        : 'bg-slate-50 dark:bg-slate-800/80 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-indigo-600/40'
                    }`}
                  >
                    Jornada {j}
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Optional Torneo and Estado Filter */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1">
                <Trophy className="w-3 h-3 text-indigo-600" /> Torneo
              </label>
              <select
                value={selectedTournament}
                onChange={(e) => setSelectedTournament(e.target.value as any)}
                className="w-full bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 focus:outline-none focus:border-indigo-600"
              >
                <option value="All">Todos los Torneos</option>
                {TOURNAMENTS.map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1">
                <Filter className="w-3 h-3 text-indigo-600" /> Estado de Asignación
              </label>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value as any)}
                className="w-full bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 focus:outline-none focus:border-indigo-600"
              >
                <option value="all">Todos los partidos</option>
                <option value="assigned">Solo con campo y horario</option>
                <option value="pending">Solo por definir</option>
              </select>
            </div>
          </div>

          {/* Summary / Preview Badge */}
          <div className="p-4 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 rounded-2xl space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-slate-600 dark:text-slate-300">Partidos que se incluirán en el PDF:</span>
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-black ${
                matchingGames.length > 0 
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' 
                  : 'bg-rose-500/10 text-rose-500'
              }`}>
                {matchingGames.length} {matchingGames.length === 1 ? 'partido' : 'partidos'}
              </span>
            </div>

            {matchingGames.length > 0 ? (
              <div className="space-y-1.5 pt-1 text-[11px] text-slate-500 max-h-28 overflow-y-auto pr-1">
                {matchingGames.slice(0, 5).map((g, idx) => (
                  <div key={g.id || idx} className="flex items-center justify-between py-1.5 border-b border-slate-100 dark:border-slate-800/60 last:border-none">
                    <div className="flex items-center gap-2 truncate max-w-[280px]">
                      <TeamLogo teamId={g.awayTeamId} teamName={g.awayTeamName} size="xs" />
                      <span className="font-bold text-slate-700 dark:text-slate-200 truncate">
                        {g.awayTeamName}
                      </span>
                      <span className="text-[10px] text-slate-400 font-normal">vs</span>
                      <TeamLogo teamId={g.homeTeamId} teamName={g.homeTeamName} size="xs" />
                      <span className="font-bold text-slate-700 dark:text-slate-200 truncate">
                        {g.homeTeamName}
                      </span>
                    </div>
                    <span className="text-[10px] text-slate-400 shrink-0">
                      {formatFieldName(g.field) || 'Campo por def.'} • J{g.jornada || 1}
                    </span>
                  </div>
                ))}
                {matchingGames.length > 5 && (
                  <div className="text-[10px] text-center text-slate-400 italic pt-0.5">
                    ... y {matchingGames.length - 5} partidos más
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-rose-500 italic">
                No hay partidos que coincidan con esta categoría y jornada.
              </p>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all cursor-pointer"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={isExporting || matchingGames.length === 0}
            onClick={handleExportPDF}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 px-6 rounded-xl transition-all shadow-lg shadow-indigo-600/25 active:scale-95 disabled:opacity-50 cursor-pointer text-xs uppercase tracking-wider"
          >
            <Download className="w-4 h-4" />
            <span>{isExporting ? 'Generando PDF...' : 'Descargar PDF'}</span>
          </button>
        </div>
      </motion.div>
    </div>
  );
}
