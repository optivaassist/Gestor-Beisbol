import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { collection, writeBatch, doc, getDocs, query, where } from 'firebase/firestore';
import { Team, Category, CATEGORIES, Season, TournamentType, TOURNAMENTS, formatTeamName, CATEGORY_FIELDS, Game } from '../types';
import { optimizeColtSchedule, EXACT_ROUND_SLOTS } from '../utils/coltEquitableScheduler';
import { Sparkles, Calendar, Trophy, Users, CheckCircle2, AlertTriangle, X, Loader2, ShieldCheck, Scale, Check } from 'lucide-react';
import TeamLogo from './TeamLogo';

interface AutoGenerateScheduleModalProps {
  isOpen: boolean;
  onClose: () => void;
  teams: Team[];
  seasons: Season[];
  currentCategory: Category | 'All';
  onGenerateSuccess: (message: string) => void;
}

export default function AutoGenerateScheduleModal({
  isOpen,
  onClose,
  teams,
  seasons,
  currentCategory,
  onGenerateSuccess
}: AutoGenerateScheduleModalProps) {
  const activeSeason = seasons.find(s => s.active);

  const [selectedCategory, setSelectedCategory] = useState<Category>(
    currentCategory !== 'All' ? currentCategory : 'Colt'
  );
  const [selectedTournament, setSelectedTournament] = useState<TournamentType | 'All'>('All');

  // Starting date for Jornada 1: default to active season start date or upcoming Saturday
  const [startDate, setStartDate] = useState<string>(() => {
    if (activeSeason?.startDate) {
      return activeSeason.startDate.split('T')[0];
    }
    const now = new Date();
    const day = now.getDay();
    const daysUntilSaturday = (6 - day + 7) % 7 || 7;
    now.setDate(now.getDate() + daysUntilSaturday);
    return now.toISOString().split('T')[0];
  });

  const [replaceExisting, setReplaceExisting] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Filter teams for selected category & tournament
  const categoryTeams = teams.filter(
    t => t.category === selectedCategory && (selectedTournament === 'All' || t.tournament === selectedTournament || (!t.tournament && selectedTournament === 'Regular'))
  );

  const teamCount = categoryTeams.length;
  // If team count is odd, 1 virtual team for bye
  const effectiveCount = teamCount % 2 !== 0 ? teamCount + 1 : teamCount;
  const calculatedRounds = effectiveCount > 0 ? effectiveCount - 1 : 0;
  const gamesPerRound = effectiveCount / 2;
  const totalGamesToGenerate = (teamCount * (teamCount - 1)) / 2;

  const handleGenerate = async () => {
    if (teamCount < 2) {
      setErrorMsg(`Se necesitan al menos 2 equipos en ${selectedCategory} para generar el rol.`);
      return;
    }

    setIsGenerating(true);
    setErrorMsg(null);

    try {
      // 1. Generate Round-Robin pairings (Circle / Berger algorithm)
      // Every team plays exactly once per round, facing every other team exactly once across all rounds.
      const pool: (Team & { isBye?: boolean })[] = categoryTeams.map(t => ({ ...t }));
      if (pool.length % 2 !== 0) {
        pool.push({
          id: 'bye-virtual',
          name: 'DESCANSO',
          category: selectedCategory,
          leagueId: 'default',
          isBye: true
        } as any);
      }

      const n = pool.length;
      const roundsCount = n - 1;
      const half = n / 2;
      const roundsMatchups: { home: Team; away: Team }[][] = [];

      for (let r = 0; r < roundsCount; r++) {
        const roundGames: { home: Team; away: Team }[] = [];
        for (let i = 0; i < half; i++) {
          const t1 = pool[i];
          const t2 = pool[n - 1 - i];

          if (!t1.isBye && !t2.isBye) {
            // Alternate home/away for fair local / visitante distribution
            if ((r + i) % 2 === 0) {
              roundGames.push({ home: t1, away: t2 });
            } else {
              roundGames.push({ home: t2, away: t1 });
            }
          }
        }
        roundsMatchups.push(roundGames);
        // Standard Circle rotation: keep pool[0] fixed, rotate the rest
        pool.splice(1, 0, pool.pop()!);
      }

      // 2. Base Saturday for Jornada 1
      const [sy, sm, sd] = startDate.split('-').map(Number);
      const baseSat = new Date(sy, sm - 1, sd);
      // Ensure starting on Saturday (or keep selected day)
      const dayOfWeek = baseSat.getDay();
      if (dayOfWeek !== 6) {
        // Adjust to the closest Saturday
        const diff = (6 - dayOfWeek + 7) % 7;
        baseSat.setDate(baseSat.getDate() + diff);
      }

      // 3. Create provisional Game objects
      let provisionalGames: Game[] = [];

      if (selectedCategory === 'Colt' && teamCount === 18) {
        // Build initial scheduled games and use specialized Colt Equitable Scheduler
        // which assigns exactly the 9 slots per jornada:
        // Sábado (4 juegos: Zorros 08:00, 11:30, 15:00; Cliserio 12:30)
        // Domingo (5 juegos: Zorros 08:00, 11:30, 15:00; Cliserio 08:00, 11:30)
        roundsMatchups.forEach((roundGames, rIdx) => {
          const j = rIdx + 1;
          roundGames.forEach(match => {
            provisionalGames.push({
              id: `generated-${j}-${match.home.id}-${match.away.id}`,
              leagueId: match.home.leagueId || 'default',
              homeTeamId: match.home.id,
              awayTeamId: match.away.id,
              homeTeamName: formatTeamName(match.home.name),
              awayTeamName: formatTeamName(match.away.name),
              category: 'Colt',
              jornada: j,
              tournament: selectedTournament === 'All' ? 'Regular' : selectedTournament,
              status: 'scheduled',
              date: '',
              field: '',
              score: { home: 0, away: 0 },
              inning: 1,
              isTop: true,
              outs: 0,
              balls: 0,
              strikes: 0,
              runners: { first: null, second: null, third: null },
              currentBatterIndex: { home: 0, away: 0 }
            });
          });
        });

        const yyyy = baseSat.getFullYear();
        const mm = String(baseSat.getMonth() + 1).padStart(2, '0');
        const dd = String(baseSat.getDate()).padStart(2, '0');
        const baseSatStr = `${yyyy}-${mm}-${dd}`;

        const optResult = optimizeColtSchedule(provisionalGames, categoryTeams, baseSatStr);
        provisionalGames = optResult.updatedGames;
      } else {
        // Generic Category slot assignment
        const catFields = CATEGORY_FIELDS[selectedCategory] || ['Campo del Valle', 'Campo de la Loma'];
        const standardSlots = [
          { day: 'Sabado', time: '08:00', field: catFields[0] },
          { day: 'Sabado', time: '11:30', field: catFields[0] },
          { day: 'Sabado', time: '15:00', field: catFields[0] },
          { day: 'Sabado', time: '08:00', field: catFields[1] || catFields[0] },
          { day: 'Sabado', time: '11:30', field: catFields[1] || catFields[0] },
          { day: 'Domingo', time: '08:00', field: catFields[0] },
          { day: 'Domingo', time: '11:30', field: catFields[0] },
          { day: 'Domingo', time: '15:00', field: catFields[0] },
          { day: 'Domingo', time: '08:00', field: catFields[1] || catFields[0] },
          { day: 'Domingo', time: '11:30', field: catFields[1] || catFields[0] },
        ];

        roundsMatchups.forEach((roundGames, rIdx) => {
          const j = rIdx + 1;
          const roundSat = new Date(baseSat);
          roundSat.setDate(roundSat.getDate() + (rIdx * 7));

          roundGames.forEach((match, gIdx) => {
            const slot = standardSlots[gIdx % standardSlots.length];
            const gameDate = new Date(roundSat);
            if (slot.day === 'Domingo') {
              gameDate.setDate(gameDate.getDate() + 1);
            }
            const [hh, mm] = slot.time.split(':').map(Number);
            gameDate.setHours(hh, mm, 0, 0);

            provisionalGames.push({
              id: `generated-${j}-${match.home.id}-${match.away.id}`,
              leagueId: match.home.leagueId || 'default',
              homeTeamId: match.home.id,
              awayTeamId: match.away.id,
              homeTeamName: formatTeamName(match.home.name),
              awayTeamName: formatTeamName(match.away.name),
              category: selectedCategory,
              jornada: j,
              tournament: selectedTournament === 'All' ? 'Regular' : selectedTournament,
              status: 'scheduled',
              date: gameDate.toISOString(),
              field: slot.field,
              score: { home: 0, away: 0 },
              inning: 1,
              isTop: true,
              outs: 0,
              balls: 0,
              strikes: 0,
              runners: { first: null, second: null, third: null },
              currentBatterIndex: { home: 0, away: 0 }
            });
          });
        });
      }

      // 4. If replaceExisting, delete previous scheduled games for this category
      if (replaceExisting) {
        const existingSnap = await getDocs(
          query(
            collection(db, 'games'),
            where('category', '==', selectedCategory),
            where('status', '==', 'scheduled')
          )
        );
        let delBatch = writeBatch(db);
        let delCount = 0;
        for (const docSnap of existingSnap.docs) {
          delBatch.delete(docSnap.ref);
          delCount++;
          if (delCount % 400 === 0) {
            await delBatch.commit();
            delBatch = writeBatch(db);
          }
        }
        if (delCount % 400 !== 0) {
          await delBatch.commit();
        }
      }

      // 5. Commit all new games to Firestore in batches of up to 400
      let saveBatch = writeBatch(db);
      let saveCount = 0;

      for (const game of provisionalGames) {
        const newRef = doc(collection(db, 'games'));
        saveBatch.set(newRef, {
          leagueId: game.leagueId || 'default',
          homeTeamId: game.homeTeamId,
          awayTeamId: game.awayTeamId,
          homeTeamName: formatTeamName(game.homeTeamName),
          awayTeamName: formatTeamName(game.awayTeamName),
          category: selectedCategory,
          jornada: game.jornada,
          tournament: game.tournament || (selectedTournament === 'All' ? 'Regular' : selectedTournament),
          status: 'scheduled',
          date: game.date,
          field: game.field || 'Zorros',
          score: { home: 0, away: 0 },
          inning: 1,
          isTop: true,
          outs: 0,
          balls: 0,
          strikes: 0,
          runners: { first: null, second: null, third: null },
          currentBatterIndex: { home: 0, away: 0 }
        });
        saveCount++;
        if (saveCount % 400 === 0) {
          await saveBatch.commit();
          saveBatch = writeBatch(db);
        }
      }

      if (saveCount % 400 !== 0) {
        await saveBatch.commit();
      }

      onGenerateSuccess(
        `¡Rol Round-Robin generado exitosamente! Se crearon ${provisionalGames.length} partidos en ${calculatedRounds} jornadas para ${teamCount} equipos (cada equipo juega 1 partido por jornada sin repetir rival).`
      );
      onClose();
    } catch (err) {
      console.error("Error generating schedule:", err);
      handleFirestoreError(err, OperationType.WRITE, 'games');
      setErrorMsg("Ocurrió un error al guardar los partidos en la base de datos.");
    } finally {
      setIsGenerating(false);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[75] flex items-center justify-center p-4 overflow-y-auto">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 sm:p-8 max-w-xl w-full space-y-6 shadow-2xl relative text-left"
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-indigo-600 to-purple-600 text-white flex items-center justify-center shadow-lg shadow-indigo-600/30 flex-shrink-0">
                <Sparkles className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-xl font-black text-slate-900 dark:text-white tracking-tight">
                  Generar Rol Automático
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Algoritmo Round-Robin oficial: cada equipo se enfrentará a un equipo cada jornada sin repetir equipos (ej. si son 18 equipos, jugarán 17 juegos en 17 jornadas).
                </p>
              </div>
            </div>

            <button
              onClick={onClose}
              disabled={isGenerating}
              className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-white rounded-xl transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {errorMsg && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-xs font-bold rounded-xl flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Form controls */}
          <div className="space-y-4">
            {/* Category and Tournament Selector */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Trophy className="w-3.5 h-3.5 text-indigo-500" />
                  Categoría
                </label>
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value as Category)}
                  disabled={isGenerating}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3.5 py-2.5 text-sm font-bold text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
                >
                  {CATEGORIES.map(cat => (
                    <option key={cat} value={cat}>
                      {cat} ({teams.filter(t => t.category === cat).length} equipos)
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-indigo-500" />
                  Torneo
                </label>
                <select
                  value={selectedTournament}
                  onChange={(e) => setSelectedTournament(e.target.value as any)}
                  disabled={isGenerating}
                  className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3.5 py-2.5 text-sm font-bold text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
                >
                  <option value="All">Todos los Torneos ({teams.filter(t => t.category === selectedCategory).length} equipos)</option>
                  {TOURNAMENTS.map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Starting Date */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-indigo-500" />
                Fecha de Inicio (Jornada 1)
              </label>
              <input
                type="date"
                required
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                disabled={isGenerating}
                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <p className="text-[10px] text-slate-400">
                Las jornadas subsecuentes se programarán automáticamente cada fin de semana consecutivo (+7 días).
              </p>
            </div>

            {/* Dynamic Schedule Calculation Box */}
            <div className="p-4 bg-indigo-50/60 dark:bg-indigo-950/40 rounded-2xl border border-indigo-100 dark:border-indigo-900/60 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-black uppercase tracking-wider text-indigo-600 dark:text-indigo-400 flex items-center gap-1.5">
                  <Scale className="w-4 h-4" />
                  Estructura del Torneo
                </span>
                <span className="text-xs font-black text-indigo-600 dark:text-indigo-400 bg-white dark:bg-slate-900 px-2 py-0.5 rounded-lg border border-indigo-200 dark:border-indigo-800">
                  {teamCount} Equipos Registrados
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-white/80 dark:bg-slate-900/80 p-2.5 rounded-xl border border-indigo-100 dark:border-indigo-900/40">
                  <div className="text-lg font-black text-slate-900 dark:text-white">{calculatedRounds}</div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-tight">Jornadas</div>
                </div>
                <div className="bg-white/80 dark:bg-slate-900/80 p-2.5 rounded-xl border border-indigo-100 dark:border-indigo-900/40">
                  <div className="text-lg font-black text-slate-900 dark:text-white">{gamesPerRound}</div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-tight">Juegos / Jornada</div>
                </div>
                <div className="bg-white/80 dark:bg-slate-900/80 p-2.5 rounded-xl border border-indigo-100 dark:border-indigo-900/40">
                  <div className="text-lg font-black text-indigo-600 dark:text-indigo-400">{totalGamesToGenerate}</div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-tight">Total Juegos</div>
                </div>
              </div>

              {/* Guarantees List */}
              <div className="space-y-1.5 text-xs text-slate-600 dark:text-slate-300 pt-1">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                  <span><strong>1 partido por equipo cada jornada:</strong> Cada equipo se enfrenta a un equipo cada jornada sin duplicados.</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                  <span><strong>Sin repetir equipos:</strong> Todos contra todos una sola vez ({calculatedRounds} jornadas para {teamCount} equipos).</span>
                </div>
                {selectedCategory === 'Colt' && (
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />
                    <span><strong>Sedes oficiales Colt:</strong> Sábado (4 juegos) y Domingo (5 juegos) balanceados en Zorros y Cliserio Sánchez.</span>
                  </div>
                )}
              </div>
            </div>

            {/* Checkbox: Replace Existing Scheduled Games */}
            <label className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={replaceExisting}
                onChange={(e) => setReplaceExisting(e.target.checked)}
                disabled={isGenerating}
                className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500 cursor-pointer"
              />
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                Reemplazar rol programado existente de la categoría {selectedCategory}
              </span>
            </label>
          </div>

          {/* Footer Actions */}
          <div className="flex gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              disabled={isGenerating}
              className="flex-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold py-3.5 rounded-xl transition-all text-sm cursor-pointer disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleGenerate}
              disabled={isGenerating || teamCount < 2}
              className="flex-1 bg-gradient-to-r from-indigo-600 via-indigo-500 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white font-black py-3.5 rounded-xl transition-all text-sm shadow-lg shadow-indigo-600/30 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 active:scale-95"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Generando {calculatedRounds} Jornadas...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 text-amber-300" />
                  <span>Generar Rol ({calculatedRounds} Jornadas)</span>
                </>
              )}
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
