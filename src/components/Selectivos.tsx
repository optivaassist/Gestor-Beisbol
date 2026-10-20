import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, onSnapshot, query, orderBy, where } from 'firebase/firestore';
import { Team, CATEGORIES, Category, Game, TournamentType, formatFieldName } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { Trophy, Calendar, Hash, Shield, Star, Sun, Umbrella } from 'lucide-react';
import TeamLogo from './TeamLogo';

export default function Selectivos() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [games, setGames] = useState<Game[]>([]);
  const [selectedTournament, setSelectedTournament] = useState<TournamentType>('Semana Santa');
  const [selectedCategory, setSelectedCategory] = useState<Category>('Colt');
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'standings' | 'schedule'>('standings');

  useEffect(() => {
    setLoading(true);
    const teamsQuery = query(
      collection(db, 'teams'), 
      where('tournament', '==', selectedTournament)
    );
    const unsubscribeTeams = onSnapshot(teamsQuery, (snapshot) => {
      const teamsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Team));
      setTeams(teamsData);
      setLoading(false);
    }, (error) => {
      console.error("Error fetching teams:", error);
      setLoading(false);
    });

    const gamesQuery = query(
      collection(db, 'games'), 
      where('tournament', '==', selectedTournament)
    );
    const unsubscribeGames = onSnapshot(gamesQuery, (snapshot) => {
      const gamesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Game));
      setGames(gamesData);
      setLoading(false);
    }, (error) => {
      console.error("Error fetching games:", error);
      setLoading(false);
    });

    return () => {
      unsubscribeTeams();
      unsubscribeGames();
    };
  }, [selectedTournament]);

  const getHeadToHead = (teamAId: string, teamBId: string) => {
    const h2hGames = games.filter(g => 
      g.status === 'completed' &&
      ((g.homeTeamId === teamAId && g.awayTeamId === teamBId) ||
      (g.homeTeamId === teamBId && g.awayTeamId === teamAId))
    );
    
    let aWins = 0;
    let bWins = 0;
    
    h2hGames.forEach(g => {
      const aScore = g.homeTeamId === teamAId ? g.score.home : g.score.away;
      const bScore = g.homeTeamId === teamBId ? g.score.home : g.score.away;
      
      if (aScore > bScore) aWins++;
      else if (bScore > aScore) bWins++;
    });
    
    return aWins - bWins;
  };

  const filteredTeams = teams
    .filter(t => t.category === selectedCategory)
    .sort((a, b) => {
      const aGames = a.wins + a.losses + a.draws;
      const bGames = b.wins + b.losses + b.draws;
      const aPct = aGames === 0 ? 0 : a.wins / aGames;
      const bPct = bGames === 0 ? 0 : b.wins / bGames;
      
      // Criterio Principal: Porcentaje
      if (Math.abs(bPct - aPct) > 0.0001) {
        return bPct - aPct;
      }
      
      // Criterio 1: Mayor cantidad de juegos ganados (Wins)
      if (b.wins !== a.wins) {
        return b.wins - a.wins;
      }
      
      // Criterio 2: Head-to-Head en caso de mismos ganados y perdidos
      if (a.wins === b.wins && a.losses === b.losses) {
        const h2h = getHeadToHead(a.id, b.id);
        if (h2h !== 0) return -h2h;
      }
      
      // Criterio 3: Diferencia de carreras
      const aDiff = (a.runsScored || 0) - (a.runsAllowed || 0);
      const bDiff = (b.runsScored || 0) - (b.runsAllowed || 0);
      if (bDiff !== aDiff) return bDiff - aDiff;

      // Criterio 4: Mayor cantidad de carreras anotadas
      if ((b.runsScored || 0) !== (a.runsScored || 0)) {
        return (b.runsScored || 0) - (a.runsScored || 0);
      }

      return a.name.localeCompare(b.name);
    });

  const filteredGames = games
    .filter(g => {
      const homeTeam = teams.find(t => t.id === g.homeTeamId);
      return homeTeam?.category === selectedCategory;
    })
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

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

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-10"
    >
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-8">
        <div className="space-y-1">
          <h2 className="text-4xl font-black tracking-tight uppercase">Liga <span className="text-indigo-600">Selectivos</span></h2>
          <p className="text-slate-500 dark:text-slate-400 font-medium">Torneos especiales y representativos.</p>
        </div>
        
        <div className="flex bg-slate-50 dark:bg-slate-900 p-1.5 rounded-2xl border-2 border-slate-200 dark:border-slate-800 shadow-sm">
          <button
            onClick={() => setSelectedTournament('Semana Santa')}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
              selectedTournament === 'Semana Santa'
                ? 'bg-indigo-600 text-white shadow-xl shadow-indigo-600/20'
                : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-100'
            }`}
          >
            <Umbrella className="w-4 h-4" />
            Semana Santa
          </button>
          <button
            onClick={() => setSelectedTournament('Verano')}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
              selectedTournament === 'Verano'
                ? 'bg-indigo-600 text-white shadow-xl shadow-indigo-600/20'
                : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-100'
            }`}
          >
            <Sun className="w-4 h-4" />
            Verano
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {CATEGORIES.map(cat => (
          <button
            key={cat}
            onClick={() => setSelectedCategory(cat)}
            className={`px-5 py-2.5 rounded-2xl text-[10px] font-black uppercase tracking-[0.15em] transition-all border-2 ${
              selectedCategory === cat
                ? 'bg-indigo-600 border-indigo-600 text-white shadow-xl shadow-indigo-600/20'
                : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-500 hover:border-indigo-600/50'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      <div className="flex gap-8 border-b-2 border-slate-100 dark:border-slate-800">
        <button
          onClick={() => setView('standings')}
          className={`pb-4 text-xs font-black uppercase tracking-[0.2em] transition-all relative ${
            view === 'standings' ? 'text-indigo-600' : 'text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
          }`}
        >
          Posiciones
          {view === 'standings' && <motion.div layoutId="activeView" className="absolute bottom-[-2px] left-0 right-0 h-1 bg-indigo-600 rounded-full" />}
        </button>
        <button
          onClick={() => setView('schedule')}
          className={`pb-4 text-xs font-black uppercase tracking-[0.2em] transition-all relative ${
            view === 'schedule' ? 'text-indigo-600' : 'text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
          }`}
        >
          Calendario
          {view === 'schedule' && <motion.div layoutId="activeView" className="absolute bottom-[-2px] left-0 right-0 h-1 bg-indigo-600 rounded-full" />}
        </button>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={`${selectedTournament}-${selectedCategory}-${view}`}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          className="space-y-10"
        >
          {view === 'standings' ? (
            filteredTeams.length === 0 ? (
              <div className="bg-indigo-50/20 dark:bg-slate-900/50 border-2 border-dashed border-indigo-100 dark:border-slate-800 rounded-[2.5rem] p-16 text-center space-y-4">
                <div className="w-20 h-20 bg-white dark:bg-slate-800 rounded-3xl flex items-center justify-center mx-auto shadow-sm">
                  <Shield className="w-10 h-10 text-indigo-200 dark:text-slate-600" />
                </div>
                <p className="text-slate-500 font-bold text-lg">No hay equipos registrados en {selectedTournament} - {selectedCategory}.</p>
              </div>
            ) : (
              <div className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[2rem] overflow-hidden shadow-sm hover:shadow-2xl hover:shadow-indigo-600/5 transition-all duration-500">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50/50 dark:bg-slate-950/50 border-b border-slate-100 dark:border-slate-800">
                        <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest"><Hash className="w-4 h-4" /></th>
                        <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Equipo</th>
                        <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">V</th>
                        <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">D</th>
                        <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">E</th>
                        <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">PCT</th>
                        <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">DIF</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {filteredTeams.map((team, index) => {
                        const total = team.wins + team.losses + team.draws;
                        const pct = total === 0 ? ".000" : (team.wins / total).toFixed(3).replace(/^0/, '');
                        const diff = (team.runsScored || 0) - (team.runsAllowed || 0);
                        
                        return (
                          <tr key={team.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors group">
                            <td className="px-8 py-5 font-mono text-slate-400 dark:text-slate-600 font-bold">{index + 1}</td>
                            <td className="px-8 py-5">
                              <div className="flex items-center gap-4">
                                <TeamLogo team={team} size="md" className="w-10 h-10 rounded-xl shadow-sm" />
                                <span className="font-black text-slate-900 dark:text-slate-100 uppercase tracking-tight">{team.name}</span>
                              </div>
                            </td>
                            <td className="px-8 py-5 text-center font-black text-slate-700 dark:text-slate-300">{team.wins}</td>
                            <td className="px-8 py-5 text-center text-slate-500 dark:text-slate-500 font-medium">{team.losses}</td>
                            <td className="px-8 py-5 text-center text-slate-400 dark:text-slate-600 font-medium">{team.draws}</td>
                            <td className="px-8 py-5 text-center font-mono text-indigo-600 dark:text-indigo-400 font-black text-lg">{pct}</td>
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
            )
          ) : (
            filteredGames.length === 0 ? (
              <div className="bg-indigo-50/20 dark:bg-slate-900/50 border-2 border-dashed border-indigo-100 dark:border-slate-800 rounded-[2.5rem] p-16 text-center space-y-4">
                <div className="w-20 h-20 bg-white dark:bg-slate-800 rounded-3xl flex items-center justify-center mx-auto shadow-sm">
                  <Calendar className="w-10 h-10 text-indigo-200 dark:text-slate-600" />
                </div>
                <p className="text-slate-500 font-bold text-lg">No hay partidos programados en {selectedTournament} - {selectedCategory}.</p>
              </div>
            ) : (
              <div className="grid gap-6">
                {filteredGames.map((game) => (
                  <div key={game.id} className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-8 flex flex-col md:flex-row items-center justify-between gap-8 shadow-sm hover:shadow-xl transition-all group">
                    <div className="flex items-center gap-12 flex-1 justify-center md:justify-start">
                      <div className="text-center space-y-2">
                        <TeamLogo teamId={game.awayTeamId} teamName={game.awayTeamName} size="xl" className="w-16 h-16 rounded-2xl mx-auto shadow-md" />
                        <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{game.awayTeamName}</div>
                      </div>
                      <div className="text-4xl font-black text-slate-100 dark:text-slate-800 italic tracking-tighter">VS</div>
                      <div className="text-center space-y-2">
                        <TeamLogo teamId={game.homeTeamId} teamName={game.homeTeamName} size="xl" className="w-16 h-16 rounded-2xl mx-auto shadow-md" />
                        <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest">{game.homeTeamName}</div>
                      </div>
                    </div>
                    <div className="flex flex-col items-center md:items-end gap-3">
                      <div className="flex flex-col items-center md:items-end">
                        <div className="text-lg font-black text-slate-900 dark:text-slate-100 uppercase tracking-tight">{game.date}</div>
                        <div className="text-xs text-slate-500 font-bold uppercase tracking-widest">{formatFieldName(game.field) || 'Campo Principal'}</div>
                      </div>
                      <div className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest ${
                        game.status === 'completed' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20' :
                        game.status === 'in-progress' ? 'bg-rose-600 text-white shadow-lg shadow-rose-600/20 animate-pulse' :
                        'bg-slate-100 dark:bg-slate-800 text-slate-500'
                      }`}>
                        {game.status === 'completed' ? 'Finalizado' :
                         game.status === 'in-progress' ? 'En Juego' : 'Programado'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )
          )}
        </motion.div>
      </AnimatePresence>
    </motion.div>
  );
}
