import React, { useState } from 'react';
import * as XLSX from 'xlsx';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { collection, addDoc, writeBatch, doc, getDocs, query, where, increment } from 'firebase/firestore';
import { Team, Game, CATEGORIES, Category } from '../types';
import { motion } from 'motion/react';
import { Upload, FileSpreadsheet, CheckCircle2, AlertCircle, Loader2, Trophy } from 'lucide-react';

const INITIAL_PLAYER_STATS = {
  atBats: 0,
  hits: 0,
  doubles: 0,
  triples: 0,
  homeRuns: 0,
  runs: 0,
  rbis: 0,
  strikeouts: 0,
  walks: 0,
  battingAverage: 0,
  inningsPitched: 0,
  pitchingStrikeouts: 0,
  pitchingWalks: 0,
  earnedRuns: 0,
  era: 0,
  wins: 0,
  losses: 0,
  putouts: 0,
  assists: 0,
  errors: 0,
  fieldingPercentage: 0
};

export default function ExcelUploader() {
  const [loading, setLoading] = useState(false);
  const [previewData, setPreviewData] = useState<{
    games: any[];
    results: any[];
  } | null>(null);
  const [status, setStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const handleResetAll = async () => {
    setLoading(true);
    try {
      const batch = writeBatch(db);
      
      // 1. Delete all games
      const gamesSnapshot = await getDocs(collection(db, 'games'));
      gamesSnapshot.docs.forEach(d => batch.delete(d.ref));
      
      // 2. Reset team stats
      const teamsSnapshot = await getDocs(collection(db, 'teams'));
      teamsSnapshot.docs.forEach(d => {
        batch.update(d.ref, {
          wins: 0,
          losses: 0,
          draws: 0,
          runsScored: 0,
          runsAllowed: 0
        });
      });
      
      // 3. Reset player stats
      const playersSnapshot = await getDocs(collection(db, 'players'));
      playersSnapshot.docs.forEach(d => {
        batch.update(d.ref, {
          'stats.atBats': 0,
          'stats.hits': 0,
          'stats.doubles': 0,
          'stats.triples': 0,
          'stats.homeRuns': 0,
          'stats.runs': 0,
          'stats.rbis': 0,
          'stats.strikeouts': 0,
          'stats.walks': 0,
          'stats.battingAverage': 0,
          'stats.inningsPitched': 0,
          'stats.pitchingStrikeouts': 0,
          'stats.pitchingWalks': 0,
          'stats.earnedRuns': 0,
          'stats.era': 0,
          'stats.wins': 0,
          'stats.losses': 0,
          'stats.putouts': 0,
          'stats.assists': 0,
          'stats.errors': 0,
          'stats.fieldingPercentage': 0
        });
      });
      
      await batch.commit();
      setStatus({ type: 'success', message: '¡Datos reseteados! Todos los juegos y estadísticas han vuelto a cero.' });
      setShowResetConfirm(false);
    } catch (err) {
      console.error(err);
      setStatus({ type: 'error', message: 'Error al resetear los datos.' });
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        
        // Flexible sheet finding
        const findSheet = (keywords: string[]) => {
          const name = wb.SheetNames.find(n => 
            keywords.some(k => n.toLowerCase().includes(k.toLowerCase()))
          );
          return name ? wb.Sheets[name] : null;
        };

        const gamesSheet = findSheet(['rol', 'sched', 'program', 'calendario']);
        const resultsSheet = findSheet(['result', 'marcador', 'final']);

        // If only one sheet exists, try to use it for both or detect content
        const fallbackSheet = wb.Sheets[wb.SheetNames[0]];
        
        const parseSheet = (sheet: XLSX.WorkSheet | null) => {
          if (!sheet) return [];
          // Use header: 'A' to get column letters as keys
          return XLSX.utils.sheet_to_json(sheet, { header: 'A' });
        };

        const games = parseSheet(gamesSheet || (!resultsSheet ? fallbackSheet : null));
        const results = parseSheet(resultsSheet);

        setPreviewData({ games, results });
        setStatus(null);
      } catch (err) {
        setStatus({ type: 'error', message: 'Error al interpretar el archivo. Asegúrate de que las columnas B, C, D, E y F contengan la información correcta.' });
      } finally {
        setLoading(false);
      }
    };
    reader.readAsBinaryString(file);
  };

  const applyData = async () => {
    if (!previewData) return;
    setLoading(true);

    try {
      const teamsSnapshot = await getDocs(collection(db, 'teams'));
      const teams = teamsSnapshot.docs.map(d => ({ id: d.id, ...d.data() } as Team));

      // Helper to find team by flexible name and aliases
      const findTeam = (name: any) => {
        if (!name) return null;
        let searchName = String(name).toLowerCase().trim();
        
        // Handle aliases
        if (searchName === 'dbacks' || searchName === 'd-backs') searchName = 'diamondbacks';
        
        return teams.find(t => 
          t.name.toLowerCase().trim() === searchName || 
          t.name.toLowerCase().trim().includes(searchName)
        );
      };

      const batch = writeBatch(db);

      // 1. Process Roles (Scheduled Games)
      // Skip first row if it's headers (check if 'C' is a team name or the word "Equipo")
      const gamesToProcess = previewData.games.filter(row => {
        const val = String(row['C'] || '').toLowerCase();
        return val && !val.includes('equipo') && !val.includes('team');
      });

      for (const g of gamesToProcess) {
        const homeTeam = findTeam(g['C']); // Column C
        const awayTeam = findTeam(g['F']); // Column F

        if (homeTeam && awayTeam) {
          const dateVal = g['A']; // Assuming Date might be in A or another column, but user didn't specify. Let's stick to user's B-F.
          // If user didn't specify date column, we'll try to find it or use today
          let gameDate = new Date();
          
          const gameRef = doc(collection(db, 'games'));
          batch.set(gameRef, {
            homeTeamId: homeTeam.id,
            awayTeamId: awayTeam.id,
            homeTeamName: homeTeam.name,
            awayTeamName: awayTeam.name,
            date: gameDate.toISOString(),
            field: 'Por definir',
            status: 'scheduled',
            score: { home: 0, away: 0 },
            inning: 1,
            isTop: true,
            outs: 0,
            balls: 0,
            strikes: 0,
            leagueId: homeTeam.leagueId || 'default'
          });
        }
      }

      // 2. Process Results
      const resultsToProcess = previewData.results.filter(row => {
        const val = String(row['C'] || '').toLowerCase();
        return val && !val.includes('equipo') && !val.includes('team');
      });

      // Fetch all players to match names
      const playersSnapshot = await getDocs(collection(db, 'players'));
      const allPlayers = playersSnapshot.docs.map(d => ({ id: d.id, ...d.data() } as any));
      const newlyCreatedPlayers = new Map<string, string>(); // name_teamId -> playerId

      const findPlayer = (name: any, teamId?: string) => {
        if (!name) return null;
        const searchName = String(name).toLowerCase().trim();
        
        // Check in already existing players
        let player = allPlayers.find(p => 
          p.name.toLowerCase().trim() === searchName &&
          (!teamId || p.teamId === teamId)
        );
        
        if (!player) {
          player = allPlayers.find(p => 
            p.name.toLowerCase().trim().includes(searchName) &&
            (!teamId || p.teamId === teamId)
          );
        }

        // Check in newly created players in this batch
        if (!player && teamId) {
          const key = `${searchName}_${teamId}`;
          const id = newlyCreatedPlayers.get(key);
          if (id) return { id, name: searchName, teamId };
        }

        return player;
      };

      for (const r of resultsToProcess) {
        const homeTeam = findTeam(r['C']); // Column C
        const awayTeam = findTeam(r['F']); // Column F
        const score1 = parseInt(r['D'] || '0'); // Column D
        const score2 = parseInt(r['E'] || '0'); // Column E
        
        const winnerPitcherName = r['G']; // Column G
        const hrNames = [r['H'], r['I'], r['J']].filter(Boolean); // Columns H, I, J

        if (homeTeam && awayTeam) {
          const gameRef = doc(collection(db, 'games'));
          batch.set(gameRef, {
            homeTeamId: homeTeam.id,
            awayTeamId: awayTeam.id,
            homeTeamName: homeTeam.name,
            awayTeamName: awayTeam.name,
            date: new Date().toISOString(),
            field: 'Importado',
            status: 'completed',
            score: { home: score1, away: score2 },
            inning: 7,
            isTop: false,
            outs: 3,
            balls: 0,
            strikes: 0,
            leagueId: homeTeam.leagueId || 'default'
          });

          // Process Winning Pitcher
          if (winnerPitcherName && winnerPitcherName !== '-' && score1 !== score2) {
            const winnerTeam = score1 > score2 ? homeTeam : awayTeam;
            const pitcher = findPlayer(winnerPitcherName, winnerTeam.id);
            if (pitcher && !newlyCreatedPlayers.has(`${winnerPitcherName.toLowerCase().trim()}_${winnerTeam.id}`)) {
              batch.update(doc(db, 'players', pitcher.id), {
                'stats.wins': increment(1),
                position: 'P'
              });
            } else if (pitcher) {
              batch.update(doc(db, 'players', pitcher.id), {
                'stats.wins': increment(1),
                position: 'P'
              });
            } else {
              const newPlayerRef = doc(collection(db, 'players'));
              batch.set(newPlayerRef, {
                name: winnerPitcherName,
                number: '00',
                teamId: winnerTeam.id,
                position: 'P',
                stats: { ...INITIAL_PLAYER_STATS, wins: 1 }
              });
              newlyCreatedPlayers.set(`${winnerPitcherName.toLowerCase().trim()}_${winnerTeam.id}`, newPlayerRef.id);
            }
          }

          // Process Home Runs
          hrNames.forEach(name => {
            if (name === '-') return;
            const searchName = name.toLowerCase().trim();
            const player = findPlayer(name, homeTeam.id) || findPlayer(name, awayTeam.id);
            
            if (player) {
              batch.update(doc(db, 'players', player.id), {
                'stats.homeRuns': increment(1),
                'stats.hits': increment(1),
                'stats.runs': increment(1),
                'stats.rbis': increment(1)
              });
            } else {
              const newPlayerRef = doc(collection(db, 'players'));
              batch.set(newPlayerRef, {
                name: name,
                number: '00',
                teamId: homeTeam.id,
                position: 'IF',
                stats: { ...INITIAL_PLAYER_STATS, homeRuns: 1, hits: 1, runs: 1, rbis: 1 }
              });
              newlyCreatedPlayers.set(`${searchName}_${homeTeam.id}`, newPlayerRef.id);
            }
          });
        }
      }

      await batch.commit();

      // 3. Recalculate Standings (La Tabla)
      // We fetch ALL completed games to ensure the table is perfectly accurate
      const allGamesSnapshot = await getDocs(query(collection(db, 'games'), where('status', '==', 'completed')));
      const allCompletedGames = allGamesSnapshot.docs.map(d => d.data() as Game);

      const finalBatch = writeBatch(db);
      for (const team of teams) {
        const teamGames = allCompletedGames.filter(g => g.homeTeamId === team.id || g.awayTeamId === team.id);
        
        let wins = 0;
        let losses = 0;
        let draws = 0;
        let runsScored = 0;
        let runsAllowed = 0;

        teamGames.forEach(g => {
          const isHome = g.homeTeamId === team.id;
          const myScore = isHome ? g.score.home : g.score.away;
          const oppScore = isHome ? g.score.away : g.score.home;

          runsScored += myScore;
          runsAllowed += oppScore;

          if (myScore > oppScore) wins++;
          else if (oppScore > myScore) losses++;
          else draws++;
        });

        finalBatch.update(doc(db, 'teams', team.id), {
          wins, losses, draws, runsScored, runsAllowed
        });
      }

      await finalBatch.commit();
      
      setStatus({ type: 'success', message: '¡Interpretación exitosa! Se han actualizado los roles, los resultados y la tabla de posiciones.' });
      setPreviewData(null);
    } catch (err) {
      console.error(err);
      setStatus({ type: 'error', message: 'Error al procesar los datos. Revisa el formato de las columnas.' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-8 text-center space-y-4 shadow-sm dark:shadow-none">
        <div className="w-16 h-16 bg-indigo-600/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <FileSpreadsheet className="w-8 h-8 text-indigo-600" />
        </div>
        <h3 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">Importar desde Excel</h3>
        <p className="text-slate-500 dark:text-slate-400 max-w-md mx-auto text-sm">
          Sube un archivo Excel con las pestañas <span className="text-indigo-600 font-bold">"Roles"</span> y <span className="text-indigo-600 font-bold">"Resultados"</span> para actualizar la liga masivamente.
        </p>
        
        <div className="pt-4">
          <label className="inline-flex items-center gap-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-900 dark:text-white font-semibold py-3 px-6 rounded-xl transition-all cursor-pointer">
            <Upload className="w-5 h-5" />
            Seleccionar Archivo
            <input type="file" accept=".xlsx, .xls" onChange={handleFileUpload} className="hidden" />
          </label>
        </div>

        {status && (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`flex items-center gap-2 p-4 rounded-xl text-sm justify-center ${
              status.type === 'success' ? 'bg-indigo-600/10 text-indigo-600' : 'bg-red-500/10 text-red-500'
            }`}
          >
            {status.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
            {status.message}
          </motion.div>
        )}
      </div>

      {previewData && (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="space-y-6"
        >
          <div className="bg-indigo-600/10 border border-indigo-600/20 rounded-2xl p-4 flex items-center gap-3 text-indigo-600 text-xs">
            <Trophy className="w-5 h-5 flex-shrink-0" />
            <p>
              Se han detectado <span className="font-bold">Pitchers Ganadores</span> y <span className="font-bold">Jonroneros</span>. 
              Al aplicar los cambios, sus estadísticas se actualizarán automáticamente para los <span className="font-bold">Líderes de la Categoría</span>.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm dark:shadow-none">
              <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4">Vista Previa: Roles ({previewData.games.filter(r => r['C']).length})</h4>
              <div className="space-y-2 max-h-64 overflow-y-auto pr-2 custom-scrollbar">
                {previewData.games.filter(r => r['C'] && !String(r['C']).toLowerCase().includes('equipo')).map((g, i) => (
                  <div key={i} className="text-xs p-2 bg-slate-50 dark:bg-slate-950 rounded-lg border border-slate-100 dark:border-slate-800 flex justify-between text-slate-700 dark:text-slate-300">
                    <span>{g['C']} vs {g['F']}</span>
                    <span className="text-slate-400 italic">{g['B'] ? `(Descansa: ${g['B']})` : ''}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm dark:shadow-none">
              <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-4">Vista Previa: Resultados ({previewData.results.filter(r => r['C']).length})</h4>
              <div className="space-y-2 max-h-64 overflow-y-auto pr-2 custom-scrollbar">
                {previewData.results.filter(r => r['C'] && !String(r['C']).toLowerCase().includes('equipo')).map((r, i) => (
                  <div key={i} className="text-xs p-3 bg-slate-50 dark:bg-slate-950 rounded-lg border border-slate-100 dark:border-slate-800 space-y-2 text-slate-700 dark:text-slate-300">
                    <div className="flex justify-between font-bold">
                      <span>{r['C']} ({r['D']}) - {r['F']} ({r['E']})</span>
                      <span className="text-slate-400 italic text-[10px]">{r['B'] ? `(Descansa: ${r['B']})` : ''}</span>
                    </div>
                    {(r['G'] || r['H'] || r['I'] || r['J']) && (
                      <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-200 dark:border-slate-800/50 text-[10px]">
                        {r['G'] && (
                          <div className="text-indigo-600 dark:text-indigo-500">
                            <span className="text-slate-500 uppercase font-bold mr-1">Pitcher:</span> {r['G']}
                          </div>
                        )}
                        {(r['H'] || r['I'] || r['J']) && (
                          <div className="text-orange-500">
                            <span className="text-slate-500 uppercase font-bold mr-1">HR:</span> 
                            {[r['H'], r['I'], r['J']].filter(Boolean).join(', ')}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <button
            onClick={applyData}
            disabled={loading}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-4 rounded-2xl transition-all shadow-lg shadow-indigo-600/20 flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
            Aplicar Cambios a la Liga
          </button>
        </motion.div>
      )}

      {/* Danger Zone */}
      <div className="pt-12 border-t border-slate-200 dark:border-slate-800">
        <div className="bg-red-500/5 border border-red-500/10 rounded-3xl p-8 flex flex-col items-center text-center space-y-4">
          <div className="w-12 h-12 bg-red-500/10 rounded-xl flex items-center justify-center">
            <AlertCircle className="w-6 h-6 text-red-500" />
          </div>
          <div className="space-y-1">
            <h4 className="text-lg font-bold text-red-500">Zona de Peligro</h4>
            <p className="text-slate-500 dark:text-slate-400 text-sm max-w-xs">
              Si cometiste un error en la subida, puedes resetear todos los juegos y estadísticas a cero.
            </p>
          </div>
          
          {showResetConfirm ? (
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setShowResetConfirm(false)}
                className="bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-900 dark:text-white font-bold py-2 px-6 rounded-xl transition-all text-sm"
              >
                Cancelar
              </button>
              <button
                onClick={handleResetAll}
                disabled={loading}
                className="bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-6 rounded-xl transition-all text-sm flex items-center gap-2"
              >
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                Sí, Resetear Todo
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowResetConfirm(true)}
              className="text-red-500/60 hover:text-red-500 font-bold text-sm underline underline-offset-4 transition-colors"
            >
              Resetear todos los resultados y estadísticas
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
