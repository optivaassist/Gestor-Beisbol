import React, { useState, useMemo } from 'react';
import { Game, Team, Category } from '../types';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { doc, writeBatch, collection } from 'firebase/firestore';
import { motion, AnimatePresence } from 'motion/react';
import {
  Sparkles,
  X,
  CheckCircle2,
  Scale,
  Calendar,
  Clock,
  MapPin,
  RefreshCw,
  Loader2,
  Check,
  AlertCircle
} from 'lucide-react';
import { optimizeColtSchedule, TeamEquityStats } from '../utils/coltEquitableScheduler';

interface ColtEquityModalProps {
  isOpen: boolean;
  onClose: () => void;
  games: Game[];
  teams: Team[];
  onScheduleUpdated?: () => void;
  canEdit?: boolean;
}

export default function ColtEquityModal({
  isOpen,
  onClose,
  games,
  teams,
  onScheduleUpdated,
  canEdit = true
}: ColtEquityModalProps) {
  const [isApplying, setIsApplying] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Filter Colt games & teams
  const coltTeams = useMemo(() => teams.filter(t => t.category === 'Colt'), [teams]);
  const coltGames = useMemo(() => {
    return games.filter(g => g.category === 'Colt' || coltTeams.some(t => t.id === g.homeTeamId || t.id === g.awayTeamId));
  }, [games, coltTeams]);

  // Compute live current stats for all Colt teams based on games
  const currentStats = useMemo(() => {
    const stats: Record<string, TeamEquityStats> = {};
    const teamNames = coltTeams.map(t => t.name.toUpperCase());

    teamNames.forEach(tn => {
      stats[tn] = {
        teamName: tn,
        zorrosCount: 0,
        cliserioCount: 0,
        sabadoCount: 0,
        domingoCount: 0,
        t800Count: 0,
        t1130Count: 0,
        t1230Count: 0,
        t1500Count: 0,
        totalGames: 0,
        isFieldBalanced: false,
        isDayBalanced: false,
        isTimeBalanced: false,
        isOverallPerfect: false
      };
    });

    coltGames.forEach(g => {
      const t1 = (g.homeTeamName || '').toUpperCase();
      const t2 = (g.awayTeamName || '').toUpperCase();

      const isZorros = (g.field || '').includes('Zorros');
      const isCliserio = (g.field || '').includes('Cliserio');

      let day = '';
      let time = '';
      if (g.date) {
        try {
          const d = new Date(g.date);
          if (!isNaN(d.getTime())) {
            day = d.getDay() === 0 ? 'domingo' : 'sabado';
            const h = d.getHours();
            const m = d.getMinutes();
            if (h === 8) time = '8:00';
            else if (h === 11) time = '11:30';
            else if (h === 12 && m >= 20) time = '12:30';
            else if (h === 15) time = '15:00';
          }
        } catch (e) {
          // ignore
        }
      }

      [t1, t2].forEach(tn => {
        const s = stats[tn];
        if (!s) return;
        s.totalGames++;
        if (isZorros) s.zorrosCount++;
        else if (isCliserio) s.cliserioCount++;

        if (day === 'sabado') s.sabadoCount++;
        else if (day === 'domingo') s.domingoCount++;

        if (time === '8:00') s.t800Count++;
        else if (time === '11:30') s.t1130Count++;
        else if (time === '12:30') s.t1230Count++;
        else if (time === '15:00') s.t1500Count++;
      });
    });

    // Check balances
    Object.values(stats).forEach(s => {
      s.isFieldBalanced = (s.zorrosCount === 11 || s.zorrosCount === 12) && (s.cliserioCount === 5 || s.cliserioCount === 6);
      s.isDayBalanced = (s.sabadoCount === 7 || s.sabadoCount === 8) && (s.domingoCount === 9 || s.domingoCount === 10);
      s.isTimeBalanced = (s.t800Count >= 5 && s.t800Count <= 6) && (s.t1130Count >= 5 && s.t1130Count <= 6) && (s.t1230Count >= 1 && s.t1230Count <= 2) && (s.t1500Count >= 3 && s.t1500Count <= 4);
      s.isOverallPerfect = s.isFieldBalanced && s.isDayBalanced && s.isTimeBalanced;
    });

    return stats;
  }, [coltGames, coltTeams]);

  const statsList: TeamEquityStats[] = Object.values(currentStats);
  const perfectCount = statsList.filter((s: TeamEquityStats) => s.isOverallPerfect).length;

  if (!isOpen) return null;

  const handleApplyOptimizer = async () => {
    setIsApplying(true);
    setSuccessMessage(null);
    try {
      const result = optimizeColtSchedule(coltGames, coltTeams);

      const batch = writeBatch(db);
      for (const g of result.updatedGames) {
        if (g.id && !g.id.startsWith('colt-generated-')) {
          const gRef = doc(db, 'games', g.id);
          batch.update(gRef, {
            date: g.date,
            field: g.field,
            jornada: g.jornada,
            category: 'Colt'
          });
        } else {
          const newRef = doc(collection(db, 'games'));
          batch.set(newRef, {
            homeTeamId: g.homeTeamId,
            awayTeamId: g.awayTeamId,
            homeTeamName: g.homeTeamName,
            awayTeamName: g.awayTeamName,
            category: 'Colt',
            jornada: g.jornada,
            date: g.date,
            field: g.field,
            status: 'scheduled',
            score: { home: 0, away: 0 },
            inning: 1,
            isTop: true,
            outs: 0,
            balls: 0,
            strikes: 0,
            runners: { first: null, second: null, third: null },
            leagueId: 'default'
          });
        }
      }

      await batch.commit();
      setSuccessMessage('¡Rol de juegos de Categoría Colt generado y balanceado con éxito según la especificación exacta!');
      if (onScheduleUpdated) onScheduleUpdated();
      setTimeout(() => setSuccessMessage(null), 5000);
    } catch (err: any) {
      console.error('Error applying optimizer:', err);
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
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[2.5rem] p-6 sm:p-8 max-w-4xl w-full shadow-2xl max-h-[92vh] flex flex-col space-y-6 text-slate-900 dark:text-white"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-indigo-600/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
              <Scale className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-xl font-black uppercase tracking-tight">
                  Randomizer Categoría Colt <span className="text-indigo-600">(17 Jornadas)</span>
                </h3>
                <span className="px-2.5 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 text-[10px] font-black uppercase tracking-wider">
                  153 Juegos Totales
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                Sábado 5 juegos (8:00, 11:30 y 15:00 solo Zorros) • Domingo 4 juegos (8:00 y 11:30) • Máxima equidad.
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

        {/* 3 Key Equity Principles Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="p-3.5 rounded-2xl bg-indigo-50/70 dark:bg-slate-800/60 border border-indigo-100 dark:border-slate-800 space-y-1">
            <span className="text-[10px] font-black uppercase tracking-wider text-indigo-600 dark:text-indigo-400 flex items-center gap-1">
              <Calendar className="w-3 h-3" /> Sábado — 5 Juegos
            </span>
            <div className="text-sm font-black text-slate-900 dark:text-white">
              8:00 (2), 11:30 (2), 15:00 (1)
            </div>
            <p className="text-[10px] text-slate-400 font-medium">
              8:00 y 11:30: 1 Cliserio + 1 Zorros. 15:00: <strong className="text-indigo-600 dark:text-indigo-400">Solo Zorros</strong> (nunca en Cliserio).
            </p>
          </div>

          <div className="p-3.5 rounded-2xl bg-purple-50/70 dark:bg-slate-800/60 border border-purple-100 dark:border-slate-800 space-y-1">
            <span className="text-[10px] font-black uppercase tracking-wider text-purple-600 dark:text-purple-400 flex items-center gap-1">
              <Calendar className="w-3 h-3" /> Domingo — 4 Juegos
            </span>
            <div className="text-sm font-black text-slate-900 dark:text-white">
              8:00 (2) y 11:30 (2)
            </div>
            <p className="text-[10px] text-slate-400 font-medium">
              8:00 y 11:30: 1 Cliserio + 1 Zorros cada hora. Sin juegos a las 15:00 en domingo.
            </p>
          </div>

          <div className="p-3.5 rounded-2xl bg-amber-50/70 dark:bg-slate-800/60 border border-amber-100 dark:border-slate-800 space-y-1">
            <span className="text-[10px] font-black uppercase tracking-wider text-amber-600 dark:text-amber-400 flex items-center gap-1">
              <Clock className="w-3 h-3" /> Equidad en 17 Jornadas
            </span>
            <div className="text-sm font-black text-slate-900 dark:text-white">
              Sáb 15:00: solo 1-2 veces
            </div>
            <p className="text-[10px] text-slate-400 font-medium">
              8:00 (7-8 juegos) • 11:30 (7-8 juegos) • Sáb 15:00 (1-2 juegos). Sin repeticiones excesivas.
            </p>
          </div>
        </div>

        {/* Live Score status banner */}
        <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 rounded-2xl text-xs">
          <div className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full ${perfectCount === coltTeams.length ? 'bg-emerald-500' : 'bg-amber-500'} animate-pulse`} />
            <span className="font-bold text-slate-700 dark:text-slate-300">
              Estado de Equidad Actual:
            </span>
            <span className="font-black text-indigo-600 dark:text-indigo-400">
              {perfectCount} de {coltTeams.length} equipos con balance perfecto (100% equidad)
            </span>
          </div>

          {canEdit && (
            <button
              type="button"
              disabled={isApplying}
              onClick={handleApplyOptimizer}
              className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white rounded-xl text-xs font-black uppercase tracking-wider shadow-md transition-all cursor-pointer active:scale-95 disabled:opacity-50"
            >
              {isApplying ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Optimizando...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Re-calcular y Aplicar Randomizer</span>
                </>
              )}
            </button>
          )}
        </div>

        {/* Team By Team Table */}
        <div className="border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm flex-1 overflow-y-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-100 dark:bg-slate-800/90 text-[10px] font-black uppercase text-slate-500 tracking-wider sticky top-0 z-10 backdrop-blur-md">
              <tr>
                <th className="py-3 px-4">Equipo</th>
                <th className="py-3 px-3 text-center">Juegos</th>
                <th className="py-3 px-3 text-center">Zorros</th>
                <th className="py-3 px-3 text-center">Cliserio</th>
                <th className="py-3 px-3 text-center">Sábado</th>
                <th className="py-3 px-3 text-center">Domingo</th>
                <th className="py-3 px-3 text-center">8:00</th>
                <th className="py-3 px-3 text-center">11:30</th>
                <th className="py-3 px-3 text-center">12:30</th>
                <th className="py-3 px-3 text-center">15:00</th>
                <th className="py-3 px-4 text-center">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {statsList.map(s => (
                <tr key={s.teamName} className="hover:bg-indigo-50/30 dark:hover:bg-slate-800/40 transition-colors">
                  <td className="py-2.5 px-4 font-bold text-slate-900 dark:text-white">
                    {s.teamName}
                  </td>
                  <td className="py-2.5 px-3 text-center font-bold text-slate-500">
                    {s.totalGames}
                  </td>
                  <td className="py-2.5 px-3 text-center font-black text-indigo-600 dark:text-indigo-400">
                    {s.zorrosCount}
                  </td>
                  <td className="py-2.5 px-3 text-center font-black text-indigo-600 dark:text-indigo-400">
                    {s.cliserioCount}
                  </td>
                  <td className="py-2.5 px-3 text-center font-black text-purple-600 dark:text-purple-400">
                    {s.sabadoCount}
                  </td>
                  <td className="py-2.5 px-3 text-center font-black text-purple-600 dark:text-purple-400">
                    {s.domingoCount}
                  </td>
                  <td className="py-2.5 px-3 text-center font-bold text-slate-700 dark:text-slate-300">
                    {s.t800Count}
                  </td>
                  <td className="py-2.5 px-3 text-center font-bold text-slate-700 dark:text-slate-300">
                    {s.t1130Count}
                  </td>
                  <td className="py-2.5 px-3 text-center font-bold text-slate-700 dark:text-slate-300">
                    {s.t1230Count}
                  </td>
                  <td className="py-2.5 px-3 text-center font-bold text-slate-700 dark:text-slate-300">
                    {s.t1500Count}
                  </td>
                  <td className="py-2.5 px-4 text-center">
                    {s.isOverallPerfect ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-black uppercase">
                        <Check className="w-3 h-3" /> Equitativo
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[10px] font-black uppercase">
                        Ajustable
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
          <span className="text-slate-400">
            Total de {coltTeams.length} equipos • 17 jornadas • 9 juegos por jornada (153 partidos).
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      </motion.div>
    </div>
  );
}
