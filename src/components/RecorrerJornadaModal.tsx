import React, { useState, useMemo } from 'react';
import { Game, Team, Category, CATEGORIES } from '../types';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { doc, writeBatch } from 'firebase/firestore';
import { motion, AnimatePresence } from 'motion/react';
import {
  CalendarClock,
  CloudRain,
  X,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  FastForward,
  Loader2,
  Calendar,
  Layers
} from 'lucide-react';

interface RecorrerJornadaModalProps {
  isOpen: boolean;
  onClose: () => void;
  games: Game[];
  teams?: Team[];
  initialCategory?: Category | 'All';
  initialJornada?: number | 'All';
  onSuccess?: (count: number, summary: string) => void;
  canEdit?: boolean;
}

export default function RecorrerJornadaModal({
  isOpen,
  onClose,
  games,
  teams = [],
  initialCategory = 'Colt',
  initialJornada = 1,
  onSuccess,
  canEdit = true
}: RecorrerJornadaModalProps) {
  const [selectedCategory, setSelectedCategory] = useState<Category | 'All'>(
    initialCategory !== 'All' ? initialCategory : 'Colt'
  );

  const [selectedJornada, setSelectedJornada] = useState<number>(
    typeof initialJornada === 'number' && initialJornada >= 1 ? initialJornada : 1
  );

  const [shiftMode, setShiftMode] = useState<'cascade' | 'single'>('cascade');
  const [weeksToShift, setWeeksToShift] = useState<number>(1); // 1 week (+7 days)
  const [isApplying, setIsApplying] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Available jornadas for the selected category
  const availableJornadas = useMemo(() => {
    const jSet = new Set<number>();
    games.forEach(g => {
      const homeTeam = teams.find(t => t.id === g.homeTeamId);
      const awayTeam = teams.find(t => t.id === g.awayTeamId);
      const gameCat = g.category || homeTeam?.category || awayTeam?.category;
      if (selectedCategory === 'All' || gameCat === selectedCategory) {
        if (g.jornada && g.jornada > 0) jSet.add(g.jornada);
      }
    });
    const list = Array.from(jSet).sort((a, b) => a - b);
    return list.length > 0 ? list : Array.from({ length: 17 }, (_, i) => i + 1);
  }, [games, teams, selectedCategory]);

  // Games that will be affected by the shift
  const affectedGames = useMemo(() => {
    return games.filter(g => {
      // Category filter
      if (selectedCategory !== 'All') {
        const homeTeam = teams.find(t => t.id === g.homeTeamId);
        const awayTeam = teams.find(t => t.id === g.awayTeamId);
        const gameCat = g.category || homeTeam?.category || awayTeam?.category;
        if (gameCat !== selectedCategory) return false;
      }
      // Must have date
      if (!g.date) return false;

      // Jornada filter
      const j = g.jornada || 0;
      if (shiftMode === 'single') {
        return j === selectedJornada;
      } else {
        // Cascade: from selectedJornada onwards
        return j >= selectedJornada;
      }
    });
  }, [games, selectedCategory, selectedJornada, shiftMode]);

  // Preview date changes by grouping by jornada
  const previewByJornada = useMemo(() => {
    const daysToAdd = weeksToShift * 7;
    const groups: Record<number, { count: number; oldDates: Date[]; newDates: Date[] }> = {};

    affectedGames.forEach(g => {
      const j = g.jornada || 1;
      if (!groups[j]) {
        groups[j] = { count: 0, oldDates: [], newDates: [] };
      }
      groups[j].count++;
      try {
        const oldD = new Date(g.date);
        if (!isNaN(oldD.getTime())) {
          const newD = new Date(oldD);
          newD.setDate(newD.getDate() + daysToAdd);
          groups[j].oldDates.push(oldD);
          groups[j].newDates.push(newD);
        }
      } catch (e) {
        // ignore
      }
    });

    return Object.entries(groups)
      .map(([jStr, data]) => {
        const j = Number(jStr);
        data.oldDates.sort((a, b) => a.getTime() - b.getTime());
        data.newDates.sort((a, b) => a.getTime() - b.getTime());

        const minOld = data.oldDates[0];
        const maxOld = data.oldDates[data.oldDates.length - 1];
        const minNew = data.newDates[0];
        const maxNew = data.newDates[data.newDates.length - 1];

        const formatDateSpan = (d1?: Date, d2?: Date) => {
          if (!d1) return 'Sin fecha';
          const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
          const s1 = d1.toLocaleDateString('es-MX', opts);
          if (!d2 || d1.toDateString() === d2.toDateString()) return s1;
          const s2 = d2.toLocaleDateString('es-MX', opts);
          return `${s1} - ${s2}`;
        };

        return {
          jornada: j,
          count: data.count,
          oldSpan: formatDateSpan(minOld, maxOld),
          newSpan: formatDateSpan(minNew, maxNew)
        };
      })
      .sort((a, b) => a.jornada - b.jornada);
  }, [affectedGames, weeksToShift]);

  if (!isOpen) return null;

  const handleApplyShift = async () => {
    if (!canEdit || affectedGames.length === 0) return;

    setIsApplying(true);
    setSuccessMessage(null);
    try {
      const daysToAdd = weeksToShift * 7;
      const batch = writeBatch(db);

      affectedGames.forEach(g => {
        if (!g.id) return;
        const d = new Date(g.date);
        d.setDate(d.getDate() + daysToAdd);

        const gRef = doc(db, 'games', g.id);
        batch.update(gRef, {
          date: d.toISOString()
        });
      });

      await batch.commit();

      const summary = shiftMode === 'cascade'
        ? `Jornada ${selectedJornada} y posteriores recorridas ${weeksToShift} semana(s) (+${daysToAdd} días)`
        : `Jornada ${selectedJornada} recorrida ${weeksToShift} semana(s) (+${daysToAdd} días)`;

      setSuccessMessage(`¡Éxito! Se actualizaron las fechas de ${affectedGames.length} partidos por retraso de clima.`);

      if (onSuccess) {
        onSuccess(affectedGames.length, summary);
      }

      setTimeout(() => {
        setSuccessMessage(null);
        onClose();
      }, 2000);
    } catch (err: any) {
      console.error('Error shifting games:', err);
      handleFirestoreError(err, OperationType.UPDATE, 'games');
    } finally {
      setIsApplying(false);
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
            <div className="w-12 h-12 rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center">
              <CalendarClock className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-xl font-black uppercase tracking-tight">
                  Recorrer Jornada <span className="text-amber-600 dark:text-amber-400">(Retraso por Clima)</span>
                </h3>
                <span className="px-2.5 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 text-[10px] font-black uppercase tracking-wider flex items-center gap-1">
                  <CloudRain className="w-3 h-3" /> Clima / Lluvia
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                Posterga una semana completa (o más) los partidos programados conservando campos, horarios y turnos exactos.
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
          {successMessage && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="p-4 bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 rounded-2xl text-xs font-bold flex items-center gap-2"
            >
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{successMessage}</span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Form Options */}
        <div className="space-y-4 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Category Select */}
            <div className="space-y-1.5">
              <label className="font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider text-[11px]">
                Categoría
              </label>
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value as any)}
                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3.5 py-2.5 font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
              >
                <option value="Colt">Categoría Colt</option>
                <option value="All">Todas las Categorías</option>
                {CATEGORIES.filter(c => c !== 'Colt').map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            {/* Jornada Select */}
            <div className="space-y-1.5">
              <label className="font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider text-[11px]">
                Jornada Afectada
              </label>
              <select
                value={selectedJornada}
                onChange={(e) => setSelectedJornada(Number(e.target.value))}
                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3.5 py-2.5 font-bold text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
              >
                {availableJornadas.map(j => (
                  <option key={j} value={j}>Jornada {j}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Shift Mode: Cascade vs Single */}
          <div className="space-y-2">
            <label className="font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider text-[11px]">
              Alcance del Recorrido
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setShiftMode('cascade')}
                className={`p-3.5 rounded-2xl border text-left transition-all cursor-pointer ${
                  shiftMode === 'cascade'
                    ? 'border-amber-500 bg-amber-500/10 text-amber-900 dark:text-amber-200 shadow-sm'
                    : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40 text-slate-700 dark:text-slate-300'
                }`}
              >
                <div className="flex items-center gap-2 font-black text-xs">
                  <FastForward className="w-4 h-4 text-amber-500" />
                  <span>En cascada (Recomendado)</span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-snug">
                  Recorre la <strong>Jornada {selectedJornada} y todas las siguientes</strong> +{weeksToShift * 7} días para evitar empalmes.
                </p>
              </button>

              <button
                type="button"
                onClick={() => setShiftMode('single')}
                className={`p-3.5 rounded-2xl border text-left transition-all cursor-pointer ${
                  shiftMode === 'single'
                    ? 'border-amber-500 bg-amber-500/10 text-amber-900 dark:text-amber-200 shadow-sm'
                    : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40 text-slate-700 dark:text-slate-300'
                }`}
              >
                <div className="flex items-center gap-2 font-black text-xs">
                  <Calendar className="w-4 h-4 text-amber-500" />
                  <span>Solo Jornada {selectedJornada}</span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-snug">
                  Mueve únicamente los partidos de la Jornada {selectedJornada} sin alterar las demás jornadas.
                </p>
              </button>
            </div>
          </div>

          {/* Weeks to shift */}
          <div className="flex items-center justify-between p-3.5 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-200 dark:border-slate-800">
            <div>
              <span className="font-bold text-slate-800 dark:text-slate-200 block text-xs">
                Tiempo de Desplazamiento
              </span>
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                Cada juego avanza exactamente {weeksToShift * 7} días (Sábado sigue siendo Sábado, Domingo sigue siendo Domingo).
              </span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => setWeeksToShift(1)}
                className={`px-3 py-1.5 rounded-xl font-bold text-xs transition-all cursor-pointer ${
                  weeksToShift === 1
                    ? 'bg-amber-500 text-white shadow-sm'
                    : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-800'
                }`}
              >
                +1 Semana
              </button>
              <button
                type="button"
                onClick={() => setWeeksToShift(2)}
                className={`px-3 py-1.5 rounded-xl font-bold text-xs transition-all cursor-pointer ${
                  weeksToShift === 2
                    ? 'bg-amber-500 text-white shadow-sm'
                    : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-800'
                }`}
              >
                +2 Semanas
              </button>
            </div>
          </div>
        </div>

        {/* Live Preview List */}
        <div className="space-y-2 flex-1 overflow-hidden flex flex-col">
          <div className="flex items-center justify-between text-xs font-bold text-slate-500 dark:text-slate-400">
            <span>Vista Previa del Calendario ({affectedGames.length} juegos afectados):</span>
            <span className="text-amber-600 dark:text-amber-400 font-bold">
              +{weeksToShift * 7} días por partido
            </span>
          </div>

          <div className="border border-slate-200 dark:border-slate-800 rounded-2xl overflow-y-auto max-h-48 divide-y divide-slate-100 dark:divide-slate-800 text-xs">
            {previewByJornada.length === 0 ? (
              <div className="p-4 text-center text-slate-400">
                No hay partidos programados que coincidan con estos criterios.
              </div>
            ) : (
              previewByJornada.map(p => (
                <div key={p.jornada} className="p-3 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/50">
                  <div className="flex items-center gap-2 font-bold text-slate-900 dark:text-white">
                    <span className="w-6 h-6 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center text-[10px] font-black">
                      J{p.jornada}
                    </span>
                    <span>Jornada {p.jornada}</span>
                    <span className="text-[10px] font-normal text-slate-400">
                      ({p.count} partidos)
                    </span>
                  </div>

                  <div className="flex items-center gap-2 font-semibold">
                    <span className="text-slate-400 line-through">
                      {p.oldSpan}
                    </span>
                    <ArrowRight className="w-3.5 h-3.5 text-amber-500" />
                    <span className="text-emerald-600 dark:text-emerald-400 font-bold">
                      {p.newSpan}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-800 text-xs">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all cursor-pointer"
          >
            Cancelar
          </button>

          <button
            type="button"
            disabled={isApplying || affectedGames.length === 0 || !canEdit}
            onClick={handleApplyShift}
            className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white rounded-xl font-black uppercase tracking-wider shadow-lg shadow-amber-500/25 transition-all cursor-pointer active:scale-95 disabled:opacity-50"
          >
            {isApplying ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Recorriendo Fechas...</span>
              </>
            ) : (
              <>
                <CalendarClock className="w-4 h-4" />
                <span>Confirmar y Recorrer Fechas</span>
              </>
            )}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
