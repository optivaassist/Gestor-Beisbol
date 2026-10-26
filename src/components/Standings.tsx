import React, { useState, useEffect, useMemo } from 'react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { collection, onSnapshot, query, orderBy, where } from 'firebase/firestore';
import { Team, CATEGORIES, Category, Game, Season, formatTeamName } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { Trophy, TrendingUp, Hash, Activity, Shield, FileDown } from 'lucide-react';
import TeamLogo from './TeamLogo';
import StandingsExportModal from './StandingsExportModal';

import { matchTeamNameWithAliases } from '../utils/scorebookUtils';

const normalizeStr = (str: any): string => {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
};

const isTeamMatch = (gameTeamId: string | undefined, gameTeamName: string | undefined, team: Team): boolean => {
  // If both IDs exist, they are the unique identifier of the team
  if (gameTeamId && team.id) {
    return gameTeamId === team.id;
  }
  if (!gameTeamName || !team.name) return false;
  const gNorm = normalizeStr(gameTeamName);
  const tNorm = normalizeStr(team.name);
  if (gNorm === tNorm) return true;
  return matchTeamNameWithAliases(gameTeamName, team.name);
};

const getGameScores = (g: Game) => {
  const homeBoxR = g.boxScore?.teams?.find(t => t.teamType === 'home')?.totals?.r;
  const awayBoxR = g.boxScore?.teams?.find(t => t.teamType === 'away')?.totals?.r;

  let homeScore = 0;
  let awayScore = 0;

  if (g.score && (Number(g.score.home) > 0 || Number(g.score.away) > 0)) {
    homeScore = Number(g.score.home) || 0;
    awayScore = Number(g.score.away) || 0;
  } else if (typeof homeBoxR === 'number' || typeof awayBoxR === 'number') {
    homeScore = Number(homeBoxR) || 0;
    awayScore = Number(awayBoxR) || 0;
  } else if (g.score && (g.score.home !== undefined || g.score.away !== undefined)) {
    homeScore = Number(g.score.home) || 0;
    awayScore = Number(g.score.away) || 0;
  }

  const isFinished =
    g.status === 'completed' ||
    homeScore > 0 ||
    awayScore > 0 ||
    Boolean(g.boxScore && g.boxScore.teams && g.boxScore.teams.length > 0);

  return { homeScore, awayScore, isFinished };
};

export default function Standings() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [games, setGames] = useState<Game[]>([]);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<Category>('Colt');
  const [loading, setLoading] = useState(true);
  const [showExportModal, setShowExportModal] = useState(false);

  useEffect(() => {
    setLoading(true);
    const teamsQuery = query(collection(db, 'teams'), orderBy('name', 'asc'));
    const unsubscribeTeams = onSnapshot(teamsQuery, (snapshot) => {
      const teamsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Team));
      setTeams(teamsData);
      setLoading(false);
    }, (error) => {
      console.error("Error fetching teams:", error);
      setLoading(false);
    });

    const gamesQuery = query(collection(db, 'games'));
    const unsubscribeGames = onSnapshot(gamesQuery, (snapshot) => {
      const gamesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Game));
      setGames(gamesData);
      setLoading(false);
    }, (error) => {
      console.error("Error fetching games:", error);
      setLoading(false);
    });

    const seasonsQuery = query(collection(db, 'seasons'));
    const unsubscribeSeasons = onSnapshot(seasonsQuery, (snapshot) => {
      const seasonsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Season));
      setSeasons(seasonsData);
    }, (error) => {
      console.error("Error fetching seasons:", error);
    });

    return () => {
      unsubscribeTeams();
      unsubscribeGames();
      unsubscribeSeasons();
    };
  }, []);

  // Compute standings dynamically from games officially recorded in «Partidos»
  const standingsTeams = useMemo(() => {
    return teams.map(team => {
      const teamGames = games.filter(g => {
        const { isFinished } = getGameScores(g);
        if (!isFinished) return false;
        return isTeamMatch(g.homeTeamId, g.homeTeamName, team) || isTeamMatch(g.awayTeamId, g.awayTeamName, team);
      });

      let calculatedWins = 0;
      let calculatedLosses = 0;
      let calculatedRS = 0;
      let calculatedRA = 0;

      teamGames.forEach(g => {
        const { homeScore, awayScore } = getGameScores(g);
        const isHome = isTeamMatch(g.homeTeamId, g.homeTeamName, team);

        const myScore = isHome ? homeScore : awayScore;
        const oppScore = isHome ? awayScore : homeScore;

        calculatedRS += myScore;
        calculatedRA += oppScore;

        if (myScore > oppScore) {
          calculatedWins++;
        } else if (oppScore > myScore) {
          calculatedLosses++;
        }
      });

      const hasGames = teamGames.length > 0;
      const wins = hasGames ? calculatedWins : (team.wins || 0);
      const losses = hasGames ? calculatedLosses : (team.losses || 0);
      const runsScored = hasGames ? calculatedRS : (team.runsScored || 0);
      const runsAllowed = hasGames ? calculatedRA : (team.runsAllowed || 0);

      return {
        ...team,
        wins,
        losses,
        runsScored,
        runsAllowed,
      };
    });
  }, [teams, games]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
          className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full"
        />
      </div>
    );
  }

  const getHeadToHead = (teamA: Team, teamB: Team): number => {
    const h2hGames = games.filter(g => {
      const { isFinished } = getGameScores(g);
      if (!isFinished) return false;

      const aIsHome = isTeamMatch(g.homeTeamId, g.homeTeamName, teamA);
      const bIsAway = isTeamMatch(g.awayTeamId, g.awayTeamName, teamB);
      const bIsHome = isTeamMatch(g.homeTeamId, g.homeTeamName, teamB);
      const aIsAway = isTeamMatch(g.awayTeamId, g.awayTeamName, teamA);

      return (aIsHome && bIsAway) || (bIsHome && aIsAway);
    });

    let aWins = 0;
    let bWins = 0;

    h2hGames.forEach(g => {
      const { homeScore, awayScore } = getGameScores(g);
      const aIsHome = isTeamMatch(g.homeTeamId, g.homeTeamName, teamA);

      const aScore = aIsHome ? homeScore : awayScore;
      const bScore = aIsHome ? awayScore : homeScore;

      if (aScore > bScore) aWins++;
      else if (bScore > aScore) bWins++;
    });

    if (aWins > bWins) return 1; // Team A won head to head
    if (bWins > aWins) return -1; // Team B won head to head
    return 0; // Tied head to head
  };

  const filteredTeams = standingsTeams
    .filter(t => t.category === selectedCategory)
    .sort((a, b) => {
      const aGames = a.wins + a.losses;
      const bGames = b.wins + b.losses;
      const aPct = aGames === 0 ? 0 : a.wins / aGames;
      const bPct = bGames === 0 ? 0 : b.wins / bGames;

      // Criterio Principal: Porcentaje de ganados vs perdidos
      if (Math.abs(bPct - aPct) > 0.0001) {
        return bPct - aPct;
      }

      // Criterio 1: En caso de mismo porcentaje, mayor cantidad de juegos ganados (Wins)
      // Ejemplo: Yankees (2 ganados) va arriba de Dodgers (1 ganado) aunque ambos tengan 1.000
      if (b.wins !== a.wins) {
        return b.wins - a.wins;
      }

      // Criterio 2: En caso de mismos ganados y perdidos, Head-to-Head (Enfrentamiento directo)
      // Pon arriba al que haya ganado el head-to-head
      if (a.wins === b.wins && a.losses === b.losses) {
        const h2h = getHeadToHead(a, b);
        if (h2h !== 0) {
          return h2h > 0 ? -1 : 1;
        }
      }

      // Criterio 3: Diferencia de carreras (Run Differential = CA - CP)
      const aDiff = (a.runsScored || 0) - (a.runsAllowed || 0);
      const bDiff = (b.runsScored || 0) - (b.runsAllowed || 0);
      if (bDiff !== aDiff) {
        return bDiff - aDiff;
      }

      // Criterio 4: Mayor cantidad de carreras anotadas (CA)
      if ((b.runsScored || 0) !== (a.runsScored || 0)) {
        return (b.runsScored || 0) - (a.runsScored || 0);
      }

      // Criterio 5: Menor cantidad de carreras permitidas (CP)
      if ((a.runsAllowed || 0) !== (b.runsAllowed || 0)) {
        return (a.runsAllowed || 0) - (b.runsAllowed || 0);
      }

      // Criterio 6: Alfabético por nombre
      return a.name.localeCompare(b.name);
    });

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-10"
    >
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-4xl font-black tracking-tight uppercase">
              Tabla <span className="text-indigo-600">Posiciones</span>
            </h2>
            <button
              onClick={() => setShowExportModal(true)}
              className="inline-flex items-center gap-2 bg-gradient-to-r from-indigo-600 via-indigo-500 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white font-black px-4 py-2.5 rounded-2xl transition-all shadow-lg shadow-indigo-600/25 active:scale-95 cursor-pointer text-xs uppercase tracking-wider"
              title="Exportar tabla de posiciones oficial a documento PDF"
            >
              <FileDown className="w-4 h-4" />
              <span>Exportar PDF</span>
            </button>
          </div>
          <p className="text-slate-500 dark:text-slate-400 font-medium">Clasificaciones actuales por categoría.</p>
        </div>
        
        <div className="flex flex-wrap items-center gap-2">
          {CATEGORIES.map(cat => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-5 py-2.5 rounded-2xl text-[10px] font-black uppercase tracking-[0.15em] transition-all border-2 cursor-pointer ${
                selectedCategory === cat
                  ? 'bg-indigo-600 border-indigo-600 text-white shadow-xl shadow-indigo-600/20'
                  : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-500 hover:border-indigo-600/50'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={selectedCategory}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          className="space-y-10"
        >
          {filteredTeams.length === 0 ? (
            <div className="bg-indigo-50/20 dark:bg-slate-900/50 border-2 border-dashed border-indigo-100 dark:border-slate-800 rounded-[2.5rem] p-16 text-center space-y-4">
              <div className="w-20 h-20 bg-white dark:bg-slate-800 rounded-3xl flex items-center justify-center mx-auto shadow-sm">
                <Shield className="w-10 h-10 text-indigo-200 dark:text-slate-600" />
              </div>
              <p className="text-slate-500 font-bold text-lg">No hay equipos registrados en la categoría {selectedCategory}.</p>
            </div>
          ) : (
            <>
              <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[2rem] overflow-hidden shadow-sm hover:shadow-2xl hover:shadow-indigo-600/5 transition-all duration-500">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50/50 dark:bg-slate-950/50 border-b border-slate-100 dark:border-slate-800">
                        <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest"><Hash className="w-4 h-4" /></th>
                        <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Equipo</th>
                        <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">V</th>
                        <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">D</th>
                        <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">PCT</th>
                        <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">CA</th>
                        <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">CP</th>
                        <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">DIF</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {filteredTeams.map((team, index) => {
                        const games = team.wins + team.losses;
                        const pct = games === 0 ? ".000" : (team.wins / games).toFixed(3).replace(/^0/, '');
                        const diff = (team.runsScored || 0) - (team.runsAllowed || 0);
                        
                        return (
                          <tr key={team.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors group">
                            <td className="px-8 py-5 font-mono text-slate-400 dark:text-slate-600 font-bold">{index + 1}</td>
                            <td className="px-8 py-5">
                              <div className="flex items-center gap-3">
                                <TeamLogo team={team} size="md" className="w-10 h-10 rounded-xl shadow-sm" />
                                <span className="font-black text-slate-900 dark:text-slate-100 uppercase tracking-tight">{team.name}</span>
                              </div>
                            </td>
                            <td className="px-8 py-5 text-center font-black text-slate-700 dark:text-slate-300">{team.wins}</td>
                            <td className="px-8 py-5 text-center text-slate-500 dark:text-slate-500 font-medium">{team.losses}</td>
                            <td className="px-8 py-5 text-center font-mono text-indigo-600 dark:text-indigo-400 font-black text-lg">{pct}</td>
                            <td className="px-8 py-5 text-center text-slate-500 dark:text-slate-500 font-medium">{team.runsScored || 0}</td>
                            <td className="px-8 py-5 text-center text-slate-500 dark:text-slate-500 font-medium">{team.runsAllowed || 0}</td>
                            <td className={`px-8 py-5 text-center font-black text-lg ${diff > 0 ? 'text-indigo-600 dark:text-indigo-400' : diff < 0 ? 'text-rose-600 dark:text-rose-500' : 'text-slate-400 dark:text-slate-600'}`}>
                              {diff > 0 ? `+${diff}` : diff}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="grid md:grid-cols-3 gap-6">
                <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-8 space-y-6 shadow-sm hover:shadow-xl transition-all group">
                  <div className="flex items-center gap-3 text-indigo-600">
                    <div className="w-10 h-10 bg-indigo-600/10 rounded-xl flex items-center justify-center">
                      <Trophy className="w-5 h-5" />
                    </div>
                    <h4 className="font-black uppercase tracking-[0.2em] text-[10px]">Líder de {selectedCategory}</h4>
                  </div>
                  {filteredTeams[0] && (
                    <div className="flex items-center gap-4">
                      <TeamLogo team={filteredTeams[0]} size="lg" className="w-14 h-14 rounded-2xl shadow-md" />
                      <div className="space-y-1">
                        <div className="text-2xl font-black text-slate-900 dark:text-white uppercase tracking-tight group-hover:text-indigo-600 transition-colors">{filteredTeams[0].name}</div>
                        <p className="text-slate-500 text-sm font-medium">Dominando la categoría con {filteredTeams[0].wins} victorias.</p>
                      </div>
                    </div>
                  )}
                </div>
                
                <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-8 space-y-6 shadow-sm hover:shadow-xl transition-all group">
                  <div className="flex items-center gap-3 text-amber-500">
                    <div className="w-10 h-10 bg-amber-500/10 rounded-xl flex items-center justify-center">
                      <TrendingUp className="w-5 h-5" />
                    </div>
                    <h4 className="font-black uppercase tracking-[0.2em] text-[10px]">Mejor Ofensiva</h4>
                  </div>
                  {filteredTeams.length > 0 && (() => {
                    const bestOffense = [...filteredTeams].sort((a, b) => (b.runsScored || 0) - (a.runsScored || 0))[0];
                    return (
                      <div className="flex items-center gap-4">
                        <TeamLogo team={bestOffense} size="lg" className="w-14 h-14 rounded-2xl shadow-md" />
                        <div className="space-y-1">
                          <div className="text-2xl font-black text-slate-900 dark:text-white uppercase tracking-tight group-hover:text-amber-500 transition-colors">
                            {bestOffense.name}
                          </div>
                          <p className="text-slate-500 text-sm font-medium">Más carreras anotadas en {selectedCategory}.</p>
                        </div>
                      </div>
                    );
                  })()}
                </div>

                <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-8 space-y-6 shadow-sm hover:shadow-xl transition-all group">
                  <div className="flex items-center gap-3 text-emerald-500">
                    <div className="w-10 h-10 bg-emerald-500/10 rounded-xl flex items-center justify-center">
                      <Shield className="w-5 h-5" />
                    </div>
                    <h4 className="font-black uppercase tracking-[0.2em] text-[10px]">Mejor Defensiva</h4>
                  </div>
                  {filteredTeams.length > 0 && (() => {
                    const bestDefense = [...filteredTeams].sort((a, b) => (a.runsAllowed || 0) - (b.runsAllowed || 0))[0];
                    return (
                      <div className="flex items-center gap-4">
                        <TeamLogo team={bestDefense} size="lg" className="w-14 h-14 rounded-2xl shadow-md" />
                        <div className="space-y-1">
                          <div className="text-2xl font-black text-slate-900 dark:text-white uppercase tracking-tight group-hover:text-emerald-500 transition-colors">
                            {bestDefense.name}
                          </div>
                          <p className="text-slate-500 text-sm font-medium">Menos carreras permitidas en {selectedCategory}.</p>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            </>
          )}
        </motion.div>
      </AnimatePresence>

      <StandingsExportModal
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
        teams={teams}
        games={games}
        seasons={seasons}
        initialCategory={selectedCategory}
      />
    </motion.div>
  );
}
