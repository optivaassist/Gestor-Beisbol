import React, { useState, useMemo } from 'react';
import { Game, Team, Category, CATEGORIES, Season } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import {
  X,
  Trophy,
  Download,
  Loader2,
  CheckCircle2,
  Shield,
  TrendingUp,
  FileDown,
  Layers,
  Sparkles,
  FileCheck
} from 'lucide-react';
import { downloadStandingsPDF, computeCategoryStandings } from '../utils/standingsPdfExporter';
import TeamLogo from './TeamLogo';

interface StandingsExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  teams: Team[];
  games: Game[];
  seasons?: Season[];
  initialCategory?: Category | 'All';
}

export default function StandingsExportModal({
  isOpen,
  onClose,
  teams,
  games,
  seasons = [],
  initialCategory = 'Colt',
}: StandingsExportModalProps) {
  const [selectedCategory, setSelectedCategory] = useState<Category | 'All'>(initialCategory);
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait');
  const [includeHighlights, setIncludeHighlights] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [downloadSuccessName, setDownloadSuccessName] = useState<string | null>(null);

  // Active Season
  const activeSeason = seasons.find(s => s.active);

  // Computed teams for the current category or all
  const previewCategory = selectedCategory === 'All' ? 'Colt' : selectedCategory;
  const previewStandings = useMemo(() => {
    return computeCategoryStandings(teams, games, previewCategory as Category);
  }, [teams, games, previewCategory]);

  const totalTeamsCount = useMemo(() => {
    if (selectedCategory === 'All') {
      return teams.length;
    }
    return teams.filter(t => t.category === selectedCategory).length;
  }, [teams, selectedCategory]);

  const handleDownload = async () => {
    setIsExporting(true);
    setDownloadSuccessName(null);
    try {
      const fileName = await downloadStandingsPDF({
        teams,
        games,
        selectedCategory,
        seasonName: activeSeason?.name || 'Temporada Oficial',
        orientation,
        includeHighlights,
      });

      setDownloadSuccessName(fileName);
      setTimeout(() => {
        setDownloadSuccessName(null);
      }, 5000);
    } catch (err) {
      console.error('Error generating standings PDF:', err);
    } finally {
      setIsExporting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 15 }}
        className="w-full max-w-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl overflow-hidden my-auto"
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 p-6 text-white relative">
          <button
            onClick={onClose}
            className="absolute top-5 right-5 p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-xl transition-all cursor-pointer"
            aria-label="Cerrar modal"
          >
            <X className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-indigo-600/30 border border-indigo-400/40 text-indigo-400 flex items-center justify-center font-bold shadow-md">
              <FileDown className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-indigo-400 bg-indigo-950/80 border border-indigo-800 px-2.5 py-0.5 rounded-md">
                  Exportación Oficial
                </span>
                {activeSeason && (
                  <span className="text-[10px] font-bold text-slate-300">
                    {activeSeason.name}
                  </span>
                )}
              </div>
              <h3 className="text-xl font-black uppercase tracking-tight text-white mt-1">
                Exportar Tabla de Posiciones a PDF
              </h3>
            </div>
          </div>
        </div>

        {/* Body content */}
        <div className="p-6 space-y-6">
          {/* Category selection */}
          <div className="space-y-2">
            <label className="text-xs font-black uppercase tracking-wider text-slate-600 dark:text-slate-300 flex items-center gap-2">
              <Layers className="w-4 h-4 text-indigo-600" />
              <span>Selecciona la Categoría a Exportar</span>
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setSelectedCategory('All')}
                className={`px-3.5 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all border-2 cursor-pointer ${
                  selectedCategory === 'All'
                    ? 'bg-indigo-600 border-indigo-600 text-white shadow-lg shadow-indigo-600/20 scale-105'
                    : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-indigo-400'
                }`}
              >
                Todas las Categorías
              </button>
              {CATEGORIES.map(cat => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-3.5 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all border-2 cursor-pointer ${
                    selectedCategory === cat
                      ? 'bg-indigo-600 border-indigo-600 text-white shadow-lg shadow-indigo-600/20 scale-105'
                      : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-indigo-400'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Configuration options */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Orientation */}
            <div className="p-4 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/60 rounded-2xl space-y-2">
              <span className="text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Orientación del Documento
              </span>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setOrientation('portrait')}
                  className={`px-3 py-2 rounded-xl text-xs font-bold transition-all border cursor-pointer text-center ${
                    orientation === 'portrait'
                      ? 'bg-indigo-600 text-white border-indigo-600 font-black shadow-sm'
                      : 'bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-600 hover:border-indigo-400'
                  }`}
                >
                  Vertical (Retrato)
                </button>
                <button
                  type="button"
                  onClick={() => setOrientation('landscape')}
                  className={`px-3 py-2 rounded-xl text-xs font-bold transition-all border cursor-pointer text-center ${
                    orientation === 'landscape'
                      ? 'bg-indigo-600 text-white border-indigo-600 font-black shadow-sm'
                      : 'bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-600 hover:border-indigo-400'
                  }`}
                >
                  Horizontal (Apaisado)
                </button>
              </div>
            </div>

            {/* Include Highlights */}
            <div className="p-4 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/60 rounded-2xl space-y-2">
              <span className="text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Resumen de Líderes
              </span>
              <button
                type="button"
                onClick={() => setIncludeHighlights(!includeHighlights)}
                className={`w-full px-3 py-2 rounded-xl text-xs font-bold transition-all border flex items-center justify-between cursor-pointer ${
                  includeHighlights
                    ? 'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border-indigo-300 dark:border-indigo-800'
                    : 'bg-white dark:bg-slate-700 text-slate-500 border-slate-200 dark:border-slate-600'
                }`}
              >
                <span>Incluir Tarjetas de Líderes</span>
                <span className="font-black">{includeHighlights ? 'SÍ ✓' : 'NO'}</span>
              </button>
            </div>
          </div>

          {/* Live Preview Box */}
          <div className="p-4 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/60 rounded-2xl space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-black uppercase tracking-wider text-slate-500">
                Vista previa del contenido
              </span>
              <span className="font-bold text-indigo-600 dark:text-indigo-400">
                {totalTeamsCount} equipos en total
              </span>
            </div>

            {previewStandings.length > 0 ? (
              <div className="space-y-2">
                <div className="text-[11px] font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <Trophy className="w-3.5 h-3.5 text-amber-500" />
                  <span>
                    Top clasificados ({previewCategory}):
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {previewStandings.slice(0, 3).map((team, idx) => (
                    <div
                      key={team.id}
                      className="p-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl flex items-center gap-2.5 shadow-sm"
                    >
                      <span className="font-black text-xs text-indigo-600 dark:text-indigo-400 w-4 text-center">
                        #{idx + 1}
                      </span>
                      <TeamLogo team={team} size="sm" className="w-7 h-7 rounded-lg" />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-black text-slate-900 dark:text-white truncate uppercase">
                          {team.name}
                        </p>
                        <p className="text-[10px] text-slate-400">
                          {team.wins}G - {team.losses}P ({team.pctStr})
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-400 italic">
                No hay equipos en la categoría seleccionada.
              </p>
            )}
          </div>

          {/* Success Toast / Notification */}
          <AnimatePresence>
            {downloadSuccessName && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="p-4 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 rounded-2xl flex items-center gap-3 text-xs font-bold"
              >
                <FileCheck className="w-5 h-5 text-emerald-600 shrink-0" />
                <div className="flex-1">
                  <p className="font-black">¡Documento PDF descargado exitosamente!</p>
                  <p className="text-[11px] font-normal opacity-90">{downloadSuccessName}</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer actions */}
        <div className="p-6 bg-slate-50 dark:bg-slate-900/60 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            Cerrar
          </button>

          <button
            type="button"
            disabled={isExporting}
            onClick={handleDownload}
            className="flex items-center gap-2.5 px-6 py-3 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white font-black text-xs uppercase tracking-wider rounded-xl transition-all shadow-xl shadow-indigo-600/25 active:scale-95 cursor-pointer disabled:opacity-50"
          >
            {isExporting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Generando PDF...</span>
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                <span>Descargar PDF Oficial</span>
              </>
            )}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
