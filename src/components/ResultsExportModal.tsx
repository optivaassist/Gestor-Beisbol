import React, { useState, useMemo } from 'react';
import { Game, Team, Category, CATEGORIES, Season, formatFieldName } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import {
  Trophy,
  X,
  Calendar,
  Layers,
  Filter,
  CheckCircle2,
  Download,
  Clock,
  MapPin,
  Sparkles,
  Users,
  Award,
  Flame,
  FileCheck,
  Loader2
} from 'lucide-react';
import { downloadResultsPDF, extractGameHomeRuns } from '../utils/resultsPdfExporter';
import { useTeams } from '../context/TeamsContext';
import TeamLogo from './TeamLogo';

interface ResultsExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  games: Game[];
  teams: Team[];
  seasons: Season[];
  initialCategory?: Category | 'All';
  initialJornada?: number | 'All';
}

export default function ResultsExportModal({
  isOpen,
  onClose,
  games,
  teams: propTeams,
  seasons,
  initialCategory = 'All',
  initialJornada = 'All'
}: ResultsExportModalProps) {
  const { teams: contextTeams } = useTeams();
  const teams = useMemo(() => {
    if (contextTeams && contextTeams.length > 0) return contextTeams;
    return propTeams || [];
  }, [contextTeams, propTeams]);

  const [selectedCategory, setSelectedCategory] = useState<Category | 'All'>(initialCategory);
  const [selectedJornada, setSelectedJornada] = useState<number | 'All'>(initialJornada);
  const [onlyCompleted, setOnlyCompleted] = useState(true);
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

  // Filtered games for preview & counts
  const matchingGames = useMemo(() => {
    return games.filter(g => {
      const homeTeam = teams.find(t => t.id === g.homeTeamId);
      const awayTeam = teams.find(t => t.id === g.awayTeamId);
      const gameCat = g.category || homeTeam?.category || awayTeam?.category;

      const catMatch = selectedCategory === 'All' || gameCat === selectedCategory;
      const jorMatch = selectedJornada === 'All' || Number(g.jornada) === Number(selectedJornada);

      const isFinished =
        g.status === 'completed' ||
        (g.score && (g.score.away !== undefined || g.score.home !== undefined) &&
          (Number(g.score.away) > 0 || Number(g.score.home) > 0 || g.winningPitcher || g.boxScore));

      const statusMatch = onlyCompleted ? isFinished : true;

      return catMatch && jorMatch && statusMatch;
    });
  }, [games, teams, selectedCategory, selectedJornada, onlyCompleted]);

  // Count of games with scores per jornada
  const jornadaResultsCount = useMemo(() => {
    const map = new Map<number, number>();
    games.forEach(g => {
      const isFinished =
        g.status === 'completed' ||
        (g.score && (Number(g.score.away) > 0 || Number(g.score.home) > 0 || g.winningPitcher));
      if (isFinished && g.jornada) {
        const jNum = Number(g.jornada);
        map.set(jNum, (map.get(jNum) || 0) + 1);
      }
    });
    return map;
  }, [games]);

  if (!isOpen) return null;

  const handleExportPDF = async () => {
    setIsExporting(true);
    try {
      const savedFileName = await downloadResultsPDF({
        games,
        teams,
        selectedCategory,
        selectedJornada,
        onlyCompleted,
        seasonName: activeSeason?.name || 'Temporada Oficial',
        leagueName: 'Liga de Béisbol Infantil y Juvenil'
      });

      setDownloadSuccessName(savedFileName);
      setTimeout(() => {
        setDownloadSuccessName(null);
        onClose();
      }, 2200);
    } catch (err) {
      console.error('Error generating Results PDF:', err);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 20 }}
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[2.5rem] p-6 sm:p-8 max-w-2xl w-full shadow-2xl space-y-6 text-slate-900 dark:text-white max-h-[92vh] overflow-y-auto"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-emerald-600 to-teal-600 text-white flex items-center justify-center shadow-lg shadow-emerald-600/30">
              <Trophy className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-xl font-black uppercase tracking-tight">
                Exportar Resultados a PDF
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                Genera el reporte oficial de marcadores con pitcher ganador, perdedor y HR.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Filters Form */}
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Jornada Selector Dropdown */}
            <div className="space-y-1.5 p-4 bg-emerald-50/60 dark:bg-emerald-950/20 border-2 border-emerald-300 dark:border-emerald-700/80 rounded-2xl">
              <label className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-emerald-800 dark:text-emerald-300">
                <Calendar className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <span>Jornada a Exportar:</span>
              </label>
              <select
                value={selectedJornada}
                onChange={(e) => {
                  const val = e.target.value;
                  setSelectedJornada(val === 'All' ? 'All' : Number(val));
                }}
                className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-800 border-2 border-emerald-400 dark:border-emerald-600 rounded-xl font-bold text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 shadow-sm cursor-pointer"
              >
                <option value="All">
                  ⚾ Todas las Jornadas ({Array.from(jornadaResultsCount.values()).reduce((a: number, b: number) => a + b, 0)} resultados)
                </option>
                {availableJornadas.map(j => (
                  <option key={j} value={j}>
                    Jornada {j} ({jornadaResultsCount.get(j) || 0} resultados registrados)
                  </option>
                ))}
              </select>
              <p className="text-[10px] text-emerald-700 dark:text-emerald-400 font-medium">
                Selecciona la jornada específica que deseas exportar o todas las jornadas.
              </p>
            </div>

            {/* Categoría Selector Dropdown */}
            <div className="space-y-1.5 p-4 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-2xl">
              <label className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300">
                <Layers className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                <span>Categoría:</span>
              </label>
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value as Category | 'All')}
                className="w-full px-3.5 py-2.5 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-xl font-bold text-xs text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm cursor-pointer"
              >
                <option value="All">Todas las Categorías</option>
                {CATEGORIES.map(cat => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
              <p className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">
                Filtra por categoría o incluye todas en el reporte.
              </p>
            </div>
          </div>

          {/* Only Completed Games Checkbox */}
          <div className="flex items-center gap-2 p-3 bg-slate-50 dark:bg-slate-800/30 border border-slate-200 dark:border-slate-700 rounded-2xl">
            <input
              type="checkbox"
              id="onlyCompletedResults"
              checked={onlyCompleted}
              onChange={(e) => setOnlyCompleted(e.target.checked)}
              className="w-4 h-4 rounded text-emerald-600 focus:ring-emerald-500 cursor-pointer"
            />
            <label htmlFor="onlyCompletedResults" className="text-xs font-bold text-slate-700 dark:text-slate-300 cursor-pointer select-none">
              Solo incluir partidos finalizados con marcador oficial
            </label>
          </div>
        </div>

        {/* Live Preview Section */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-black uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-emerald-500" />
              Vista Previa de Partidos a Exportar ({matchingGames.length})
            </span>
            <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-800/60">
              {matchingGames.length === 1 ? '1 partido' : `${matchingGames.length} partidos`}
            </span>
          </div>

          {matchingGames.length === 0 ? (
            <div className="p-8 text-center bg-slate-50 dark:bg-slate-800/40 rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-700 space-y-2">
              <Calendar className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto" />
              <p className="text-xs font-bold text-slate-500">
                No hay resultados finalizados que coincidan con la jornada y categoría seleccionada.
              </p>
              <p className="text-[10px] text-slate-400">
                Prueba seleccionando "Todas las Jornadas" o desmarcando la casilla de solo finalizados.
              </p>
            </div>
          ) : (
            <div className="max-h-56 overflow-y-auto space-y-2 pr-1 divide-y divide-slate-100 dark:divide-slate-800">
              {matchingGames.slice(0, 10).map(g => {
                const awayScore = g.score?.away ?? 0;
                const homeScore = g.score?.home ?? 0;
                const isCompleted = g.status === 'completed' || awayScore > 0 || homeScore > 0;
                const hrs = extractGameHomeRuns(g);

                return (
                  <div key={g.id} className="pt-2 first:pt-0 space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      {/* Away Team */}
                      <div className="flex items-center gap-2">
                        <TeamLogo teamId={g.awayTeamId} teamName={g.awayTeamName} size="sm" className="w-5 h-5 rounded" />
                        <span className={`font-black ${awayScore > homeScore ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-800 dark:text-slate-200'}`}>
                          {g.awayTeamName}
                        </span>
                        <span className="font-black px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-xs">
                          {awayScore}
                        </span>
                      </div>

                      <span className="text-[10px] text-slate-400 font-bold uppercase">vs</span>

                      {/* Home Team */}
                      <div className="flex items-center gap-2">
                        <span className="font-black px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-xs">
                          {homeScore}
                        </span>
                        <span className={`font-black ${homeScore > awayScore ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-800 dark:text-slate-200'}`}>
                          {g.homeTeamName}
                        </span>
                        <TeamLogo teamId={g.homeTeamId} teamName={g.homeTeamName} size="sm" className="w-5 h-5 rounded" />
                      </div>
                    </div>

                    {/* Metadata line: PG, PP, HR */}
                    <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-500 dark:text-slate-400 font-medium pl-1">
                      <span className="font-bold text-slate-400">J{g.jornada || '-'} • {g.category}</span>
                      {g.winningPitcher && (
                        <span className="text-amber-600 dark:text-amber-400 font-bold">
                          🏆 PG: {g.winningPitcher}
                        </span>
                      )}
                      {g.losingPitcher && (
                        <span className="text-slate-500">
                          ⚾ PP: {g.losingPitcher}
                        </span>
                      )}
                      {hrs.length > 0 && (
                        <span className="text-rose-600 dark:text-rose-400 font-bold">
                          💥 HR: {hrs.join(', ')}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
              {matchingGames.length > 10 && (
                <div className="pt-2 text-center text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                  ... y {matchingGames.length - 10} partidos más en el reporte
                </div>
              )}
            </div>
          )}
        </div>

        {/* Success Alert */}
        <AnimatePresence>
          {downloadSuccessName && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl text-xs font-bold text-emerald-600 dark:text-emerald-400"
            >
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>¡Archivo {downloadSuccessName} generado y descargado con éxito!</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Modal Actions */}
        <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100 dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 rounded-2xl text-xs font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all cursor-pointer"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={isExporting || matchingGames.length === 0}
            onClick={handleExportPDF}
            className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white rounded-2xl text-xs font-black uppercase tracking-wider transition-all shadow-xl shadow-emerald-600/30 active:scale-95 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isExporting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Generando PDF...</span>
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                <span>Descargar PDF de Resultados</span>
              </>
            )}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
