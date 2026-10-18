import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../firebase';
import { collection, onSnapshot, query } from 'firebase/firestore';
import { Team, Player, Game, CATEGORIES, Category, UserProfile } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import {
  Trophy,
  Star,
  Target,
  Activity,
  Shield,
  Medal,
  Flame,
  Clock,
  BarChart3,
  Search,
  ArrowUpDown,
  ChevronUp,
  ChevronDown,
  Eye,
  Users,
  CheckCircle2,
  Sparkles,
  Zap
} from 'lucide-react';
import { calculatePlayerAccumulatedStats, PlayerAccumulatedStats } from '../utils/playerStatsCalculator';
import PlayerDetailModal from './PlayerDetailModal';

interface LeadersProps {
  userProfile?: UserProfile | null;
}

type StatTab = 'leaders' | 'detailed';
type DetailedFilter = 'batting' | 'pitching' | 'all';

export default function Leaders({ userProfile }: LeadersProps) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [games, setGames] = useState<Game[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<Category | 'Todas'>('Todas');
  const [activeTab, setActiveTab] = useState<StatTab>('leaders');
  const [detailedFilter, setDetailedFilter] = useState<DetailedFilter>('batting');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<string>('avg');
  const [sortAsc, setSortAsc] = useState<boolean>(false);
  const [selectedPlayerStats, setSelectedPlayerStats] = useState<PlayerAccumulatedStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const teamsQuery = query(collection(db, 'teams'));
    const unsubscribeTeams = onSnapshot(teamsQuery, (snapshot) => {
      setTeams(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Team)));
    }, (error) => {
      console.error("Error fetching teams:", error);
    });

    const playersQuery = query(collection(db, 'players'));
    const unsubscribePlayers = onSnapshot(playersQuery, (snapshot) => {
      setPlayers(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Player)));
    }, (error) => {
      console.error("Error fetching players:", error);
    });

    const gamesQuery = query(collection(db, 'games'));
    const unsubscribeGames = onSnapshot(gamesQuery, (snapshot) => {
      setGames(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Game)));
      setLoading(false);
    }, (error) => {
      console.error("Error fetching games:", error);
      setLoading(false);
    });

    return () => {
      unsubscribeTeams();
      unsubscribePlayers();
      unsubscribeGames();
    };
  }, []);

  // Compute accumulated stats combining player document + game history (box scores & scorekeeper)
  const allPlayerStats = useMemo(() => {
    return players.map(p => calculatePlayerAccumulatedStats(p, games, teams));
  }, [players, games, teams]);

  // Filter by category
  const categoryStats = useMemo(() => {
    if (selectedCategory === 'Todas') return allPlayerStats;
    const teamIdsInCat = teams.filter(t => t.category === selectedCategory).map(t => t.id);
    return allPlayerStats.filter(s => teamIdsInCat.includes(s.player.teamId) || s.category === selectedCategory);
  }, [allPlayerStats, selectedCategory, teams]);

  // Department leaders helper
  const getDepartmentLeaders = (
    statKey: 'avg' | 'hr' | 'rbi' | 'hits' | 'wins' | 'era' | 'pitches',
    limitCount = 8
  ): PlayerAccumulatedStats[] => {
    return [...categoryStats]
      .filter(s => {
        if (statKey === 'avg') return s.atBats > 0 && s.hits > 0;
        if (statKey === 'hr') return s.homeRuns > 0;
        if (statKey === 'rbi') return s.rbis > 0;
        if (statKey === 'hits') return s.hits > 0;
        if (statKey === 'wins') return s.wins > 0;
        if (statKey === 'era') return s.inningsPitched > 0;
        if (statKey === 'pitches') return s.pitches > 0;
        return true;
      })
      .sort((a, b) => {
        if (statKey === 'avg') {
          if (b.battingAverage !== a.battingAverage) return b.battingAverage - a.battingAverage;
          if (b.hits !== a.hits) return b.hits - a.hits;
          return b.atBats - a.atBats;
        }
        if (statKey === 'hits') {
          if (b.hits !== a.hits) return b.hits - a.hits;
          return b.battingAverage - a.battingAverage;
        }
        if (statKey === 'hr') {
          if (b.homeRuns !== a.homeRuns) return b.homeRuns - a.homeRuns;
          return b.rbis - a.rbis;
        }
        if (statKey === 'rbi') {
          if (b.rbis !== a.rbis) return b.rbis - a.rbis;
          return b.hits - a.hits;
        }
        if (statKey === 'wins') {
          if (b.wins !== a.wins) return b.wins - a.wins;
          return a.era - b.era;
        }
        if (statKey === 'era') {
          // Lowest ERA is best
          const aEra = a.inningsPitched > 0 ? a.era : 99;
          const bEra = b.inningsPitched > 0 ? b.era : 99;
          if (aEra !== bEra) return aEra - bEra;
          return b.inningsPitched - a.inningsPitched;
        }
        if (statKey === 'pitches') return b.pitches - a.pitches;
        return 0;
      })
      .slice(0, limitCount);
  };

  // Detailed statistics filter & sort
  const filteredAndSortedStats = useMemo(() => {
    let list = [...categoryStats];

    // Filter by detailed role type
    if (detailedFilter === 'batting') {
      list = list.filter(s => s.atBats > 0 || s.hits > 0 || s.gamesPlayedCount > 0);
    } else if (detailedFilter === 'pitching') {
      list = list.filter(s => s.player.position === 'P' || s.pitches > 0 || s.wins > 0 || s.inningsPitched > 0);
    }

    // Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(s => 
        s.player.name.toLowerCase().includes(q) ||
        s.teamName.toLowerCase().includes(q) ||
        (s.player.number && String(s.player.number).includes(q))
      );
    }

    // Sort
    list.sort((a, b) => {
      let valA: any = 0;
      let valB: any = 0;

      switch (sortField) {
        case 'name':
          valA = a.player.name;
          valB = b.player.name;
          return sortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
        case 'team':
          valA = a.teamName;
          valB = b.teamName;
          return sortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
        case 'avg':
          valA = a.battingAverage;
          valB = b.battingAverage;
          break;
        case 'hr':
          valA = a.homeRuns;
          valB = b.homeRuns;
          break;
        case 'rbi':
          valA = a.rbis;
          valB = b.rbis;
          break;
        case 'hits':
          valA = a.hits;
          valB = b.hits;
          break;
        case 'runs':
          valA = a.runs;
          valB = b.runs;
          break;
        case 'atBats':
          valA = a.atBats;
          valB = b.atBats;
          break;
        case 'obp':
          valA = a.obp;
          valB = b.obp;
          break;
        case 'slg':
          valA = a.slg;
          valB = b.slg;
          break;
        case 'ops':
          valA = a.obp + a.slg;
          valB = b.obp + b.slg;
          break;
        case 'wins':
          valA = a.wins;
          valB = b.wins;
          break;
        case 'era':
          valA = a.inningsPitched > 0 ? a.era : 999;
          valB = b.inningsPitched > 0 ? b.era : 999;
          break;
        case 'ip':
          valA = a.inningsPitched;
          valB = b.inningsPitched;
          break;
        case 'pitches':
          valA = a.pitches;
          valB = b.pitches;
          break;
        case 'strikeouts':
          valA = detailedFilter === 'pitching' ? a.pitchingStrikeouts : a.strikeouts;
          valB = detailedFilter === 'pitching' ? b.pitchingStrikeouts : b.strikeouts;
          break;
        case 'walks':
          valA = detailedFilter === 'pitching' ? a.pitchingWalks : a.walks;
          valB = detailedFilter === 'pitching' ? b.pitchingWalks : b.walks;
          break;
        case 'games':
          valA = a.gamesPlayedCount;
          valB = b.gamesPlayedCount;
          break;
        default:
          valA = a.battingAverage;
          valB = b.battingAverage;
      }

      if (sortAsc) {
        return valA > valB ? 1 : valA < valB ? -1 : 0;
      } else {
        return valA < valB ? 1 : valA > valB ? -1 : 0;
      }
    });

    return list;
  }, [categoryStats, detailedFilter, searchQuery, sortField, sortAsc]);

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      // For ERA, default to ascending (lowest is best); for others, descending
      setSortAsc(field === 'era');
    }
  };

  const renderSortIcon = (field: string) => {
    if (sortField !== field) {
      return <ArrowUpDown className="w-3 h-3 text-slate-300 dark:text-slate-600 inline ml-1" />;
    }
    return sortAsc ? (
      <ChevronUp className="w-3.5 h-3.5 text-indigo-600 inline ml-1" />
    ) : (
      <ChevronDown className="w-3.5 h-3.5 text-indigo-600 inline ml-1" />
    );
  };

  const renderDepartmentCard = (
    title: string,
    icon: React.ReactNode,
    leaders: PlayerAccumulatedStats[],
    statLabel: string,
    statFn: (s: PlayerAccumulatedStats) => string | number,
    colorTheme: { bg: string; text: string; border: string; badge: string }
  ) => (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[2rem] overflow-hidden flex flex-col shadow-sm hover:shadow-xl transition-all group/card">
      <div className={`p-4 ${colorTheme.bg} border-b border-slate-100 dark:border-slate-800 flex items-center justify-between`}>
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded-xl ${colorTheme.badge} flex items-center justify-center font-black`}>
            {icon}
          </div>
          <h4 className="font-black uppercase tracking-[0.12em] text-xs text-slate-900 dark:text-white">
            {title}
          </h4>
        </div>
        <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full ${colorTheme.badge}`}>
          {statLabel}
        </span>
      </div>

      <div className="flex-1 p-2 space-y-1">
        {leaders.length === 0 ? (
          <div className="py-10 text-center m-2 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800">
            <p className="text-slate-400 dark:text-slate-600 text-xs italic font-medium">
              Sin datos registrados en partidos
            </p>
          </div>
        ) : (
          leaders.map((statItem, index) => (
            <div
              key={statItem.player.id}
              onClick={() => setSelectedPlayerStats(statItem)}
              className="flex items-center justify-between p-3 rounded-2xl hover:bg-indigo-50/50 dark:hover:bg-slate-800/60 transition-all cursor-pointer group"
              title="Haz clic para ver la ficha completa y juego por juego"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className={`w-7 h-7 rounded-xl flex items-center justify-center text-[10px] font-black shrink-0 ${
                    index === 0
                      ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                      : index === 1
                      ? 'bg-amber-500 text-white'
                      : index === 2
                      ? 'bg-slate-300 dark:bg-slate-700 text-slate-700 dark:text-slate-300'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-400'
                  }`}
                >
                  {index + 1}
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-black text-slate-900 dark:text-slate-100 group-hover:text-indigo-600 transition-colors uppercase tracking-tight truncate flex items-center gap-1.5">
                    <span className="truncate">{statItem.player.name}</span>
                    <span className="text-[9px] px-1 py-0.2 bg-slate-100 dark:bg-slate-800 text-slate-500 rounded font-bold">
                      {statItem.player.position || 'POS'}
                    </span>
                  </div>
                  <div className="text-[9px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-wider truncate">
                    {statItem.teamName}
                  </div>
                </div>
              </div>

              <div className="text-right shrink-0 pl-3">
                <div className={`text-base font-black ${colorTheme.text} group-hover:scale-105 transition-transform`}>
                  {statFn(statItem)}
                </div>
                <div className="text-[8px] text-slate-400 dark:text-slate-600 font-black uppercase tracking-widest">
                  {statLabel}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="p-3 bg-slate-50/50 dark:bg-slate-950/40 border-t border-slate-100 dark:border-slate-800 text-center">
        <button
          onClick={() => {
            setActiveTab('detailed');
            if (['wins', 'era', 'pitches'].includes(statLabel.toLowerCase()) || title.includes('Pitcheo') || title.includes('Efectividad') || title.includes('Lanzamientos') || title.includes('Ganados')) {
              setDetailedFilter('pitching');
              setSortField(statLabel === 'W' ? 'wins' : statLabel === 'ERA' ? 'era' : 'pitches');
            } else {
              setDetailedFilter('batting');
              setSortField(statLabel === 'AVG' ? 'avg' : statLabel === 'HR' ? 'hr' : statLabel === 'RBI' ? 'rbi' : 'hits');
            }
          }}
          className="text-[10px] font-black uppercase tracking-wider text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 inline-flex items-center gap-1 transition-colors cursor-pointer"
        >
          <span>Ver Tabla Completa</span>
          <Eye className="w-3 h-3" />
        </button>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full"
        />
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-8"
    >
      {/* Header and Controls */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h2 className="text-4xl font-black tracking-tight uppercase">
              Líderes & <span className="text-indigo-600">Estadísticas</span>
            </h2>
            <span className="hidden sm:inline-flex items-center gap-1 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-[10px] font-black uppercase tracking-wider">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Cédulas Oficiales
            </span>
          </div>
          <p className="text-slate-500 dark:text-slate-400 font-medium text-sm">
            Rendimiento individual acumulado de los jugadores y lanzadores en cada partido.
          </p>
        </div>

        {/* View Mode Switcher: Líderes vs Estadísticas Detalladas */}
        <div className="flex bg-slate-100 dark:bg-slate-800 p-1.5 rounded-2xl border border-slate-200 dark:border-slate-700/60 shadow-sm self-start lg:self-auto">
          <button
            onClick={() => setActiveTab('leaders')}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer ${
              activeTab === 'leaders'
                ? 'bg-white dark:bg-slate-900 text-indigo-600 shadow-md'
                : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <Trophy className="w-4 h-4" />
            <span>Líderes por Depto</span>
          </button>
          <button
            onClick={() => setActiveTab('detailed')}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer ${
              activeTab === 'detailed'
                ? 'bg-white dark:bg-slate-900 text-indigo-600 shadow-md'
                : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            <BarChart3 className="w-4 h-4" />
            <span>Estadísticas Detalladas</span>
          </button>
        </div>
      </div>

      {/* Category selector */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setSelectedCategory('Todas')}
            className={`px-4 py-2 rounded-2xl text-[10px] font-black uppercase tracking-[0.15em] transition-all border-2 cursor-pointer ${
              selectedCategory === 'Todas'
                ? 'bg-indigo-600 border-indigo-600 text-white shadow-xl shadow-indigo-600/20'
                : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-500 hover:border-indigo-600/50'
            }`}
          >
            Todas
          </button>
          {CATEGORIES.map(cat => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-4 py-2 rounded-2xl text-[10px] font-black uppercase tracking-[0.15em] transition-all border-2 cursor-pointer ${
                selectedCategory === cat
                  ? 'bg-indigo-600 border-indigo-600 text-white shadow-xl shadow-indigo-600/20'
                  : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-500 hover:border-indigo-600/50'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="text-xs text-slate-400 font-bold uppercase tracking-wider">
          {categoryStats.length} {categoryStats.length === 1 ? 'jugador registrado' : 'jugadores registrados'}
        </div>
      </div>

      {/* TAB 1: Líderes por Departamento */}
      {activeTab === 'leaders' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {/* 1. AVG */}
          {renderDepartmentCard(
            "Promedio de Bateo",
            <Star className="w-4 h-4 text-indigo-600" />,
            getDepartmentLeaders('avg'),
            "AVG",
            s => s.avgStr,
            {
              bg: 'bg-indigo-50/60 dark:bg-indigo-950/30',
              text: 'text-indigo-600 dark:text-indigo-400',
              border: 'border-indigo-200 dark:border-indigo-800',
              badge: 'bg-indigo-600/10 text-indigo-600 dark:text-indigo-400'
            }
          )}

          {/* 2. Jonrones HR */}
          {renderDepartmentCard(
            "Jonrones Conectados",
            <Trophy className="w-4 h-4 text-purple-600" />,
            getDepartmentLeaders('hr'),
            "HR",
            s => s.homeRuns,
            {
              bg: 'bg-purple-50/60 dark:bg-purple-950/30',
              text: 'text-purple-600 dark:text-purple-400',
              border: 'border-purple-200 dark:border-purple-800',
              badge: 'bg-purple-600/10 text-purple-600 dark:text-purple-400'
            }
          )}

          {/* 3. Carreras Impulsadas RBI */}
          {renderDepartmentCard(
            "Carreras Impulsadas",
            <Medal className="w-4 h-4 text-emerald-600" />,
            getDepartmentLeaders('rbi'),
            "RBI",
            s => s.rbis,
            {
              bg: 'bg-emerald-50/60 dark:bg-emerald-950/30',
              text: 'text-emerald-600 dark:text-emerald-400',
              border: 'border-emerald-200 dark:border-emerald-800',
              badge: 'bg-emerald-600/10 text-emerald-600 dark:text-emerald-400'
            }
          )}

          {/* 4. Hits Conectados */}
          {renderDepartmentCard(
            "Hits Conectados",
            <Target className="w-4 h-4 text-blue-600" />,
            getDepartmentLeaders('hits'),
            "HITS",
            s => s.hits,
            {
              bg: 'bg-blue-50/60 dark:bg-blue-950/30',
              text: 'text-blue-600 dark:text-blue-400',
              border: 'border-blue-200 dark:border-blue-800',
              badge: 'bg-blue-600/10 text-blue-600 dark:text-blue-400'
            }
          )}

          {/* 5. Juegos Ganados Pitcher W */}
          {renderDepartmentCard(
            "Juegos Ganados (Pitcher)",
            <Activity className="w-4 h-4 text-rose-600" />,
            getDepartmentLeaders('wins'),
            "W",
            s => s.wins,
            {
              bg: 'bg-rose-50/60 dark:bg-rose-950/30',
              text: 'text-rose-600 dark:text-rose-400',
              border: 'border-rose-200 dark:border-rose-800',
              badge: 'bg-rose-600/10 text-rose-600 dark:text-rose-400'
            }
          )}

          {/* 6. Efectividad ERA */}
          {renderDepartmentCard(
            "Efectividad de Pitcheo",
            <Shield className="w-4 h-4 text-amber-600" />,
            getDepartmentLeaders('era'),
            "ERA",
            s => s.eraStr,
            {
              bg: 'bg-amber-50/60 dark:bg-amber-950/30',
              text: 'text-amber-600 dark:text-amber-400',
              border: 'border-amber-200 dark:border-amber-800',
              badge: 'bg-amber-600/10 text-amber-600 dark:text-amber-400'
            }
          )}

          {/* 7. Pitchadas Lanzadas */}
          {renderDepartmentCard(
            "Pitchadas Lanzadas",
            <Flame className="w-4 h-4 text-cyan-600" />,
            getDepartmentLeaders('pitches'),
            "LANZ",
            s => s.pitches,
            {
              bg: 'bg-cyan-50/60 dark:bg-cyan-950/30',
              text: 'text-cyan-600 dark:text-cyan-400',
              border: 'border-cyan-200 dark:border-cyan-800',
              badge: 'bg-cyan-600/10 text-cyan-600 dark:text-cyan-400'
            }
          )}
        </div>
      )}

      {/* TAB 2: Estadísticas Detalladas (Tabla Completa e Interactiva) */}
      {activeTab === 'detailed' && (
        <div className="space-y-6">
          {/* Subfilter Bar & Search */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm">
            {/* Filter pills */}
            <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-2xl">
              <button
                onClick={() => {
                  setDetailedFilter('batting');
                  setSortField('avg');
                  setSortAsc(false);
                }}
                className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer ${
                  detailedFilter === 'batting'
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
                    : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                Bateo (Ofensiva)
              </button>
              <button
                onClick={() => {
                  setDetailedFilter('pitching');
                  setSortField('wins');
                  setSortAsc(false);
                }}
                className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer ${
                  detailedFilter === 'pitching'
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
                    : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                Pitcheo (Lanzadores)
              </button>
              <button
                onClick={() => {
                  setDetailedFilter('all');
                  setSortField('avg');
                  setSortAsc(false);
                }}
                className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer ${
                  detailedFilter === 'all'
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
                    : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                Todos los Jugadores
              </button>
            </div>

            {/* Search input */}
            <div className="relative max-w-xs w-full">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Buscar por jugador o equipo..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-2xl pl-10 pr-4 py-2 text-xs font-bold text-slate-800 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:border-indigo-600"
              />
            </div>
          </div>

          {/* Table Container */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[2rem] overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-slate-100/80 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-800 text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    <th className="py-3.5 px-4 w-12 text-center">#</th>
                    <th
                      onClick={() => handleSort('name')}
                      className="py-3.5 px-4 cursor-pointer hover:text-indigo-600 select-none"
                    >
                      Jugador {renderSortIcon('name')}
                    </th>
                    <th
                      onClick={() => handleSort('team')}
                      className="py-3.5 px-4 cursor-pointer hover:text-indigo-600 select-none"
                    >
                      Equipo {renderSortIcon('team')}
                    </th>
                    <th className="py-3.5 px-3 text-center">Pos</th>

                    {/* Columns based on detailedFilter */}
                    {detailedFilter === 'pitching' ? (
                      <>
                        <th
                          onClick={() => handleSort('wins')}
                          className="py-3.5 px-3 text-center cursor-pointer hover:text-indigo-600 select-none bg-rose-50/50 dark:bg-rose-950/20 text-rose-600 dark:text-rose-400 font-black"
                        >
                          JG (W) {renderSortIcon('wins')}
                        </th>
                        <th className="py-3.5 px-3 text-center">JP (L)</th>
                        <th
                          onClick={() => handleSort('ip')}
                          className="py-3.5 px-3 text-center cursor-pointer hover:text-indigo-600 select-none"
                        >
                          IP {renderSortIcon('ip')}
                        </th>
                        <th className="py-3.5 px-3 text-center">ER</th>
                        <th
                          onClick={() => handleSort('era')}
                          className="py-3.5 px-3 text-center cursor-pointer hover:text-indigo-600 select-none bg-amber-50/50 dark:bg-amber-950/20 text-amber-600 dark:text-amber-400 font-black"
                        >
                          ERA {renderSortIcon('era')}
                        </th>
                        <th
                          onClick={() => handleSort('pitches')}
                          className="py-3.5 px-3 text-center cursor-pointer hover:text-indigo-600 select-none bg-cyan-50/50 dark:bg-cyan-950/20 text-cyan-600 dark:text-cyan-400 font-black"
                        >
                          Lanzamientos {renderSortIcon('pitches')}
                        </th>
                        <th
                          onClick={() => handleSort('strikeouts')}
                          className="py-3.5 px-3 text-center cursor-pointer hover:text-indigo-600 select-none"
                        >
                          K {renderSortIcon('strikeouts')}
                        </th>
                        <th className="py-3.5 px-3 text-center">BB</th>
                        <th className="py-3.5 px-3 text-center">WHIP</th>
                      </>
                    ) : (
                      <>
                        <th
                          onClick={() => handleSort('games')}
                          className="py-3.5 px-3 text-center cursor-pointer hover:text-indigo-600 select-none"
                        >
                          JJ {renderSortIcon('games')}
                        </th>
                        <th
                          onClick={() => handleSort('atBats')}
                          className="py-3.5 px-3 text-center cursor-pointer hover:text-indigo-600 select-none"
                        >
                          VB {renderSortIcon('atBats')}
                        </th>
                        <th
                          onClick={() => handleSort('hits')}
                          className="py-3.5 px-3 text-center cursor-pointer hover:text-indigo-600 select-none"
                        >
                          H {renderSortIcon('hits')}
                        </th>
                        <th
                          onClick={() => handleSort('hr')}
                          className="py-3.5 px-3 text-center cursor-pointer hover:text-indigo-600 select-none text-purple-600 dark:text-purple-400 font-black"
                        >
                          HR {renderSortIcon('hr')}
                        </th>
                        <th
                          onClick={() => handleSort('rbi')}
                          className="py-3.5 px-3 text-center cursor-pointer hover:text-indigo-600 select-none text-emerald-600 dark:text-emerald-400 font-black"
                        >
                          CI (RBI) {renderSortIcon('rbi')}
                        </th>
                        <th
                          onClick={() => handleSort('runs')}
                          className="py-3.5 px-3 text-center cursor-pointer hover:text-indigo-600 select-none"
                        >
                          C {renderSortIcon('runs')}
                        </th>
                        <th className="py-3.5 px-3 text-center">BB</th>
                        <th className="py-3.5 px-3 text-center">SO</th>
                        <th
                          onClick={() => handleSort('avg')}
                          className="py-3.5 px-3 text-center cursor-pointer hover:text-indigo-600 select-none bg-indigo-50/70 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 font-black"
                        >
                          AVG {renderSortIcon('avg')}
                        </th>
                        <th
                          onClick={() => handleSort('obp')}
                          className="py-3.5 px-3 text-center cursor-pointer hover:text-indigo-600 select-none"
                        >
                          OBP {renderSortIcon('obp')}
                        </th>
                        <th
                          onClick={() => handleSort('slg')}
                          className="py-3.5 px-3 text-center cursor-pointer hover:text-indigo-600 select-none"
                        >
                          SLG {renderSortIcon('slg')}
                        </th>
                        <th
                          onClick={() => handleSort('ops')}
                          className="py-3.5 px-3 text-center cursor-pointer hover:text-indigo-600 select-none"
                        >
                          OPS {renderSortIcon('ops')}
                        </th>
                      </>
                    )}
                    <th className="py-3.5 px-4 text-center">Ficha</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filteredAndSortedStats.length === 0 ? (
                    <tr>
                      <td colSpan={15} className="py-12 text-center text-slate-400 font-medium italic">
                        No se encontraron jugadores que coincidan con los criterios seleccionados.
                      </td>
                    </tr>
                  ) : (
                    filteredAndSortedStats.map((item, index) => (
                      <tr
                        key={item.player.id}
                        onClick={() => setSelectedPlayerStats(item)}
                        className="hover:bg-indigo-50/40 dark:hover:bg-slate-800/50 transition-colors cursor-pointer group"
                      >
                        <td className="py-3 px-4 text-center font-black text-slate-400 text-xs">
                          {index + 1}
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            {item.player.number && (
                              <span className="w-6 h-6 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-black text-[10px] flex items-center justify-center shrink-0">
                                #{item.player.number}
                              </span>
                            )}
                            <div className="font-bold text-slate-900 dark:text-white group-hover:text-indigo-600 transition-colors">
                              {item.player.name}
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-4 font-bold text-slate-500 dark:text-slate-400 text-xs">
                          {item.teamName}
                        </td>
                        <td className="py-3 px-3 text-center">
                          <span className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold text-[10px]">
                            {item.player.position || 'POS'}
                          </span>
                        </td>

                        {/* Stats cells based on filter */}
                        {detailedFilter === 'pitching' ? (
                          <>
                            <td className="py-3 px-3 text-center font-black text-rose-600 dark:text-rose-400 bg-rose-50/30 dark:bg-rose-950/10">
                              {item.wins}
                            </td>
                            <td className="py-3 px-3 text-center text-slate-500 font-bold">
                              {item.losses}
                            </td>
                            <td className="py-3 px-3 text-center font-bold">
                              {item.inningsPitched > 0 ? item.inningsPitched.toFixed(1) : '0.0'}
                            </td>
                            <td className="py-3 px-3 text-center text-slate-500 font-bold">
                              {item.earnedRuns}
                            </td>
                            <td className="py-3 px-3 text-center font-black text-amber-600 dark:text-amber-400 bg-amber-50/30 dark:bg-amber-950/10">
                              {item.eraStr}
                            </td>
                            <td className="py-3 px-3 text-center font-black text-cyan-600 dark:text-cyan-400 bg-cyan-50/30 dark:bg-cyan-950/10">
                              {item.pitches}
                            </td>
                            <td className="py-3 px-3 text-center font-bold">
                              {item.pitchingStrikeouts}
                            </td>
                            <td className="py-3 px-3 text-center text-slate-500 font-bold">
                              {item.pitchingWalks}
                            </td>
                            <td className="py-3 px-3 text-center text-slate-500 font-bold">
                              {item.whip}
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="py-3 px-3 text-center text-slate-500 font-bold">
                              {item.gamesPlayedCount}
                            </td>
                            <td className="py-3 px-3 text-center font-bold">
                              {item.atBats}
                            </td>
                            <td className="py-3 px-3 text-center font-bold">
                              {item.hits}
                            </td>
                            <td className="py-3 px-3 text-center font-black text-purple-600 dark:text-purple-400">
                              {item.homeRuns}
                            </td>
                            <td className="py-3 px-3 text-center font-black text-emerald-600 dark:text-emerald-400">
                              {item.rbis}
                            </td>
                            <td className="py-3 px-3 text-center font-bold text-amber-600">
                              {item.runs}
                            </td>
                            <td className="py-3 px-3 text-center text-slate-500 font-bold">
                              {item.walks}
                            </td>
                            <td className="py-3 px-3 text-center text-slate-500 font-bold">
                              {item.strikeouts}
                            </td>
                            <td className="py-3 px-3 text-center font-black text-indigo-600 dark:text-indigo-400 bg-indigo-50/40 dark:bg-indigo-950/20 text-sm">
                              {item.avgStr}
                            </td>
                            <td className="py-3 px-3 text-center text-slate-500 font-bold">
                              {item.obpStr}
                            </td>
                            <td className="py-3 px-3 text-center text-slate-500 font-bold">
                              {item.slgStr}
                            </td>
                            <td className="py-3 px-3 text-center text-slate-700 dark:text-slate-300 font-bold">
                              {item.ops}
                            </td>
                          </>
                        )}

                        <td className="py-3 px-4 text-center">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedPlayerStats(item);
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-indigo-600 hover:text-white transition-all text-[10px] font-black uppercase tracking-wider"
                          >
                            <Eye className="w-3 h-3" />
                            <span>Ver</span>
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Table footer info */}
            <div className="p-4 bg-slate-50/60 dark:bg-slate-950/40 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
              <span className="font-medium">
                Mostrando {filteredAndSortedStats.length} jugadores • Clic en cualquier fila para ver el desglose partido por partido.
              </span>
              <div className="flex items-center gap-4 text-[10px] font-black uppercase tracking-wider">
                <span className="flex items-center gap-1 text-indigo-600">
                  <Star className="w-3 h-3" /> AVG = Bateo
                </span>
                <span className="flex items-center gap-1 text-purple-600">
                  <Trophy className="w-3 h-3" /> HR = Jonrones
                </span>
                <span className="flex items-center gap-1 text-emerald-600">
                  <Medal className="w-3 h-3" /> CI = Impulsadas
                </span>
                <span className="flex items-center gap-1 text-amber-600">
                  <Shield className="w-3 h-3" /> ERA = Efectividad
                </span>
                <span className="flex items-center gap-1 text-rose-600">
                  <Activity className="w-3 h-3" /> JG = Ganados
                </span>
                <span className="flex items-center gap-1 text-cyan-600">
                  <Flame className="w-3 h-3" /> Lanzamientos
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Player Detail View with accumulated stats and match game logs */}
      {selectedPlayerStats && (
        <PlayerDetailModal
          stats={selectedPlayerStats}
          userProfile={userProfile}
          onClose={() => setSelectedPlayerStats(null)}
          onUpdateSuccess={() => {
            // Stats will refresh automatically via onSnapshot
          }}
        />
      )}
    </motion.div>
  );
}
