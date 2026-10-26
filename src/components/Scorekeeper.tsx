import React, { useState, useEffect } from 'react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { doc, onSnapshot, updateDoc, collection, addDoc, getDoc, increment, writeBatch, query, where } from 'firebase/firestore';
import { Game, Play, Team, Player, BASEBALL_POSITIONS, LineupPlayer, UserProfile, GameBoxScoreData, GamePitchingData } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronLeft, Plus, Minus, Trophy, History, Users, Activity, Play as PlayIcon, Circle, GripVertical, UserPlus, UserMinus, Shield, Home, BookOpen, Upload, Eye, X, Download, FileCheck, Loader2, Table as TableIcon, AlertCircle, Trash2 } from 'lucide-react';
import ScorebookModal from './ScorebookModal';
import TeamLogo from './TeamLogo';
import { cleanFirestoreData, hasUploadedBooks, getUploadedSheetsCount, reconcileBoxScore, reconcilePitchingBoxScore, mergeBoxScores, mergePitchingBoxScores, processScorebookFile, saveScorebookFile, deleteGameScorebookFiles, sanitizeScorebooksForMainDoc } from '../utils/scorebookUtils';
import { parseApiResponse } from '../utils/apiHelper';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragOverlay,
  defaultDropAnimationSideEffects,
  useDraggable,
  useDroppable,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface ScorekeeperProps {
  gameId: string | null;
  userRole: string;
  userProfile?: UserProfile | null;
  onBack: () => void;
  initialTab?: 'score' | 'lineup';
}

interface PlayAnimation {
  type: string;
  batterName: string;
  runners: { first?: string; second?: string; third?: string };
}

export default function Scorekeeper({ gameId, userRole, userProfile, onBack, initialTab }: ScorekeeperProps) {
  const [game, setGame] = useState<Game | null>(null);
  const [plays, setPlays] = useState<Play[]>([]);
  const [loading, setLoading] = useState(true);
  const [homeRoster, setHomeRoster] = useState<Player[]>([]);
  const [awayRoster, setAwayRoster] = useState<Player[]>([]);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [showAnimation, setShowAnimation] = useState<PlayAnimation | null>(null);
  const [activeTab, setActiveTab] = useState<'score' | 'lineup'>(initialTab || 'score');

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);
  const [scorekeeperLineupTab, setScorekeeperLineupTab] = useState<'away' | 'home'>('away');
  const [uploadingBook, setUploadingBook] = useState(false);
  const [uploadCategory, setUploadCategory] = useState<'batting' | 'pitching'>('batting');
  const [showBookModal, setShowBookModal] = useState(false);
  const bookFileInputRef = React.useRef<HTMLInputElement>(null);

  const isJefe = userProfile?.role === 'jefe_categoria' || userProfile?.role === 'admin';

  const handleDeleteBookInScorekeeper = async () => {
    if (!game) return;
    if (window.confirm('¿Deseas borrar los libros de anotación y estadísticas de este partido?')) {
      try {
        await deleteGameScorebookFiles(game.id);
        await updateDoc(doc(db, 'games', game.id), cleanFirestoreData({
          bookImageUrl: '',
          bookFileName: '',
          bookFileType: null,
          bookUploadedAt: null,
          bookUploadedBy: null,
          boxScore: null,
          pitchingBoxScore: null,
          scorebooks: null,
          winningPitcher: null,
          losingPitcher: null,
          savePitcher: null,
          homeRuns: null,
        }));
      } catch (err) {
        console.error('Error deleting book in scorekeeper:', err);
        handleFirestoreError(err, OperationType.UPDATE, `games/${game.id}`);
      }
    }
  };

  const handleUploadBookInScorekeeper = async (file: File, category: 'batting' | 'pitching' = 'batting') => {
    if (!file || !game) return;
    setUploadingBook(true);
    try {
      const processed = await processScorebookFile(file);
      const uploaderName = userProfile?.displayName || userProfile?.email || 'Jefe de Categoría';
      const isPitch = category === 'pitching';
      const nowIso = new Date().toISOString();

      try {
        const response = await fetch('/api/analyze-scorebook', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            image: processed.dataUrl,
            homeTeamName: game.homeTeamName,
            awayTeamName: game.awayTeamName,
            homeRoster: homeRoster,
            awayRoster: awayRoster,
            fileName: file.name,
            bookCategory: category,
          })
        });
        const result = await parseApiResponse(response, 'Error al analizar el libro de anotación.');

        const sheetKey = isPitch ? 'awayPitching' : 'awayBatting';

        // 1. Save full file in dedicated scorebook_files subcollection (each file gets its own 1MB quota)
        await saveScorebookFile(game.id, sheetKey, {
          fileUrl: processed.dataUrl,
          thumbnailUrl: processed.thumbnailUrl,
          fileName: file.name,
          fileType: processed.fileType || 'image',
          uploadedAt: nowIso,
          uploadedBy: uploaderName,
          category,
          teamType: 'away',
          teamName: game.awayTeamName,
        });

        const sheetRecord = {
          hasFile: true,
          fileName: file.name,
          fileType: processed.fileType || 'image',
          uploadedAt: nowIso,
          uploadedBy: uploaderName,
          category: category,
          teamType: 'away' as const,
          teamName: game.awayTeamName,
        };

        const cleanScorebooks: Record<string, any> = sanitizeScorebooksForMainDoc(game.scorebooks);
        cleanScorebooks[sheetKey] = sheetRecord;

        const updatePayload: Record<string, any> = {
          bookImageUrl: '', // Keep empty in main doc to prevent 1MB limit overflow
          bookUploadedAt: nowIso,
          bookUploadedBy: uploaderName,
          bookFileName: file.name,
          bookFileType: processed.fileType || 'image',
          scorebooks: cleanFirestoreData(cleanScorebooks),
        };

        if (result.success && result.data) {
          if (isPitch) {
            let reconciledPitch = reconcilePitchingBoxScore(
              result.data,
              game.homeTeamName,
              game.awayTeamName,
              homeRoster,
              awayRoster
            );
            reconciledPitch = mergePitchingBoxScores(game.pitchingBoxScore, reconciledPitch);
            updatePayload.pitchingBoxScore = reconciledPitch;
          } else {
            let reconciledBox = reconcileBoxScore(
              result.data,
              game.homeTeamName,
              game.awayTeamName,
              homeRoster,
              awayRoster
            );
            reconciledBox = mergeBoxScores(game.boxScore, reconciledBox);
            updatePayload.boxScore = reconciledBox;

            // Also save pitch counts from batting sheet if present
            if (Array.isArray(result.data?.pitchers) && result.data.pitchers.length > 0) {
              const battingPitchingData: GamePitchingData = {
                teams: [
                  {
                    teamName: game.awayTeamName,
                    teamType: 'away',
                    pitchers: result.data.pitchers.filter((p: any) => p.teamType === 'away' || !p.teamType),
                    totalPitches: result.data.pitchers.filter((p: any) => p.teamType === 'away' || !p.teamType).reduce((acc: number, p: any) => acc + (p.pitches || 0), 0)
                  },
                  {
                    teamName: game.homeTeamName,
                    teamType: 'home',
                    pitchers: result.data.pitchers.filter((p: any) => p.teamType === 'home'),
                    totalPitches: result.data.pitchers.filter((p: any) => p.teamType === 'home').reduce((acc: number, p: any) => acc + (p.pitches || 0), 0)
                  }
                ],
                detectedAt: nowIso,
                detectedBy: uploaderName,
              };
              updatePayload.pitchingBoxScore = reconcilePitchingBoxScore(
                battingPitchingData,
                game.homeTeamName,
                game.awayTeamName,
                homeRoster,
                awayRoster
              );
            }
          }

          // 1. EXTRACT AND SET FINAL SCORE ON THE GAME
          const extScore = result.data?.finalScore;
          if (
            extScore &&
            typeof extScore.awayScore === 'number' &&
            typeof extScore.homeScore === 'number' &&
            extScore.awayScore >= 0 &&
            extScore.homeScore >= 0
          ) {
            updatePayload.score = {
              away: extScore.awayScore,
              home: extScore.homeScore,
            };
            updatePayload.status = 'completed';
          } else if (!isPitch && updatePayload.boxScore?.teams) {
            const awayT = updatePayload.boxScore.teams.find((t: any) => t.teamType === 'away');
            const homeT = updatePayload.boxScore.teams.find((t: any) => t.teamType === 'home');
            if (awayT && homeT && (awayT.totals?.r > 0 || homeT.totals?.r > 0)) {
              updatePayload.score = {
                away: awayT.totals?.r || 0,
                home: homeT.totals?.r || 0,
              };
              updatePayload.status = 'completed';
            }
          }

          // 2. EXTRACT AND SET WINNING PITCHER ON THE GAME
          const extractedWin =
            result.data?.winningPitcher?.name ||
            updatePayload.pitchingBoxScore?.winningPitcher ||
            updatePayload.boxScore?.winningPitcher;

          if (extractedWin && extractedWin !== '-' && !extractedWin.toLowerCase().includes('no ident')) {
            updatePayload.winningPitcher = extractedWin;
          }

          const extractedLose =
            result.data?.losingPitcher?.name ||
            updatePayload.pitchingBoxScore?.losingPitcher ||
            updatePayload.boxScore?.losingPitcher;

          if (extractedLose && extractedLose !== '-' && !extractedLose.toLowerCase().includes('no ident')) {
            updatePayload.losingPitcher = extractedLose;
          }

          const extractedSave =
            result.data?.savePitcher?.name ||
            updatePayload.pitchingBoxScore?.savePitcher ||
            updatePayload.boxScore?.savePitcher;

          if (extractedSave && extractedSave !== '-' && !extractedSave.toLowerCase().includes('no ident')) {
            updatePayload.savePitcher = extractedSave;
          }
        }

        await updateDoc(doc(db, 'games', game.id), cleanFirestoreData(updatePayload));
        setShowBookModal(true);
      } catch (aiErr) {
        console.warn('AI analysis in background:', aiErr);
        await saveScorebookFile(game.id, 'default', {
          fileUrl: processed.dataUrl,
          fileName: file.name,
          fileType: 'image',
          uploadedAt: nowIso,
          uploadedBy: uploaderName,
        });
        await updateDoc(doc(db, 'games', game.id), cleanFirestoreData({
          bookImageUrl: '',
          bookUploadedAt: nowIso,
          bookUploadedBy: uploaderName,
          bookFileName: file.name,
          bookFileType: 'image',
        }));
        setShowBookModal(true);
      }
    } catch (err) {
      console.error("Error uploading scorebook:", err);
      handleFirestoreError(err, OperationType.UPDATE, `games/${game.id}`);
    } finally {
      setUploadingBook(false);
    }
  };

  useEffect(() => {
    if (game) {
      setScorekeeperLineupTab(game.isTop ? 'away' : 'home');
    }
  }, [game?.isTop]);

  useEffect(() => {
    if (!game) return;
    
    // Initialize currentBatterIndex if missing
    if (!game.currentBatterIndex) {
      updateGame({ currentBatterIndex: { home: 0, away: 0 } });
      return;
    }

    const battingTeam = game.isTop ? 'away' : 'home';
    const lineup = battingTeam === 'home' ? game.homeLineup : game.awayLineup;
    const index = game.currentBatterIndex?.[battingTeam] || 0;
    
    if (lineup && lineup[index] && !selectedPlayerId) {
      setSelectedPlayerId(lineup[index].playerId);
    }
  }, [game?.isTop, game?.currentBatterIndex, game?.homeLineup, game?.awayLineup, selectedPlayerId]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  useEffect(() => {
    if (!gameId) return;

    const unsubscribeGame = onSnapshot(doc(db, 'games', gameId), (snapshot) => {
      if (snapshot.exists()) {
        const gameData = { id: snapshot.id, ...snapshot.data() } as Game;
        setGame(gameData);
      } else {
        setGame(null);
      }
      setLoading(false);
    }, (error) => {
      console.error("Error fetching game:", error);
      setLoading(false);
    });

    const playsQuery = collection(db, 'games', gameId, 'plays');
    const unsubscribePlays = onSnapshot(playsQuery, (snapshot) => {
      setPlays(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Play)).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()));
    }, (error) => {
      console.error("Error fetching plays:", error);
    });

    return () => {
      unsubscribeGame();
      unsubscribePlays();
    };
  }, [gameId]);

  useEffect(() => {
    if (!game) return;

    const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    const homeNameNorm = norm(game.homeTeamName || '');
    const awayNameNorm = norm(game.awayTeamName || '');

    // Listen to teams & players to resolve canonical team IDs and rosters
    const unsubscribeTeams = onSnapshot(collection(db, 'teams'), (teamSnap) => {
      const allTeams = teamSnap.docs.map(d => ({ id: d.id, ...d.data() } as Team));
      const homeTeam = allTeams.find(t => t.id === game.homeTeamId || norm(t.name) === homeNameNorm || norm(t.name).includes(homeNameNorm) || (homeNameNorm && homeNameNorm.includes(norm(t.name))));
      const awayTeam = allTeams.find(t => t.id === game.awayTeamId || norm(t.name) === awayNameNorm || norm(t.name).includes(awayNameNorm) || (awayNameNorm && awayNameNorm.includes(norm(t.name))));

      const homeIds = new Set<string>();
      if (game.homeTeamId) homeIds.add(game.homeTeamId);
      if (homeTeam) homeIds.add(homeTeam.id);

      const awayIds = new Set<string>();
      if (game.awayTeamId) awayIds.add(game.awayTeamId);
      if (awayTeam) awayIds.add(awayTeam.id);

      const unsubscribePlayers = onSnapshot(collection(db, 'players'), (playerSnap) => {
        const allPlayers = playerSnap.docs.map(d => ({ id: d.id, ...d.data() } as Player));
        const matchedHome = allPlayers.filter(p => homeIds.has(p.teamId));
        const matchedAway = allPlayers.filter(p => awayIds.has(p.teamId));
        setHomeRoster(matchedHome);
        setAwayRoster(matchedAway);
      });

      return () => {
        unsubscribePlayers();
      };
    });

    return () => {
      unsubscribeTeams();
    };
  }, [game?.id, game?.homeTeamId, game?.awayTeamId, game?.homeTeamName, game?.awayTeamName]);

  const updateGame = async (updates: any) => {
    if (!gameId) return;
    try {
      await updateDoc(doc(db, 'games', gameId), updates);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `games/${gameId}`);
    }
  };

  const addPlay = async (description: string, result: string) => {
    if (!gameId || !game) return;
    const newPlay: Partial<Play> = {
      gameId,
      inning: game.inning,
      isTop: game.isTop,
      description,
      result,
      timestamp: new Date().toISOString(),
    };

    try {
      await addDoc(collection(db, 'games', gameId, 'plays'), newPlay);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `games/${gameId}/plays`);
    }
  };

  const handleEndGame = async () => {
    if (!game || !gameId) return;
    
    const batch = writeBatch(db);
    const homeTeamRef = doc(db, 'teams', game.homeTeamId);
    const awayTeamRef = doc(db, 'teams', game.awayTeamId);
    const gameRef = doc(db, 'games', gameId);

    const homeWon = game.score.home > game.score.away;
    const awayWon = game.score.away > game.score.home;

    // Update Home Team
    batch.update(homeTeamRef, {
      wins: increment(homeWon ? 1 : 0),
      losses: increment(awayWon ? 1 : 0),
      runsScored: increment(game.score.home),
      runsAllowed: increment(game.score.away)
    });

    // Update Away Team
    batch.update(awayTeamRef, {
      wins: increment(awayWon ? 1 : 0),
      losses: increment(homeWon ? 1 : 0),
      runsScored: increment(game.score.away),
      runsAllowed: increment(game.score.home)
    });

    // Update Game Status
    batch.update(gameRef, { status: 'completed' });

    try {
      await batch.commit();
      addPlay('Partido finalizado y estadísticas actualizadas', 'game_end');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `games/${gameId}`);
    }
  };

  const handlePlayerStatUpdate = async (playerId: string, statType: 'hit' | 'double' | 'triple' | 'home_run' | 'out' | 'strikeout' | 'walk' | 'rbi' | 'run' | 'error' | 'winning_pitcher' | 'reached_on_error') => {
    const playerRef = doc(db, 'players', playerId);
    const updates: any = {};
    
    switch (statType) {
      case 'hit':
        updates['stats.hits'] = increment(1);
        updates['stats.atBats'] = increment(1);
        break;
      case 'double':
        updates['stats.hits'] = increment(1);
        updates['stats.doubles'] = increment(1);
        updates['stats.atBats'] = increment(1);
        break;
      case 'triple':
        updates['stats.hits'] = increment(1);
        updates['stats.triples'] = increment(1);
        updates['stats.atBats'] = increment(1);
        break;
      case 'home_run':
        updates['stats.hits'] = increment(1);
        updates['stats.atBats'] = increment(1);
        updates['stats.homeRuns'] = increment(1);
        updates['stats.runs'] = increment(1);
        updates['stats.rbis'] = increment(1);
        break;
      case 'out':
        updates['stats.atBats'] = increment(1);
        break;
      case 'strikeout':
        updates['stats.atBats'] = increment(1);
        updates['stats.strikeouts'] = increment(1);
        break;
      case 'walk':
        updates['stats.walks'] = increment(1);
        break;
      case 'reached_on_error':
        updates['stats.atBats'] = increment(1);
        break;
      case 'rbi':
        updates['stats.rbis'] = increment(1);
        break;
      case 'run':
        updates['stats.runs'] = increment(1);
        break;
      case 'error':
        updates['stats.errors'] = increment(1);
        break;
      case 'winning_pitcher':
        updates['stats.wins'] = increment(1);
        break;
    }

    try {
      await updateDoc(playerRef, updates);
      const player = [...homeRoster, ...awayRoster].find(p => p.id === playerId);
      const lastName = player?.name.split(' ').pop() || player?.name || 'Jugador';
      
      // Automatic runner movement logic
      const runnerUpdates: any = {
        'runners.first': null,
        'runners.second': null,
        'runners.third': null
      };
      
      let bases = 0;
      if (statType === 'hit') bases = 1;
      else if (statType === 'double') bases = 2;
      else if (statType === 'triple') bases = 3;
      else if (statType === 'home_run') bases = 4;

      if (bases > 0) {
        const scoringPlayers: string[] = [];
        const currentRunners = game.runners || {};
        
        // Move existing runners
        if (currentRunners.third) {
          scoringPlayers.push(currentRunners.third);
        }
        
        if (currentRunners.second) {
          if (bases >= 2) scoringPlayers.push(currentRunners.second);
          else if (bases === 1) runnerUpdates['runners.third'] = currentRunners.second;
        }
        
        if (currentRunners.first) {
          if (bases >= 3) scoringPlayers.push(currentRunners.first);
          else if (bases === 2) runnerUpdates['runners.third'] = currentRunners.first;
          else if (bases === 1) runnerUpdates['runners.second'] = currentRunners.first;
        }
        
        // Move batter
        if (bases === 4) scoringPlayers.push(playerId);
        else if (bases === 3) runnerUpdates['runners.third'] = playerId;
        else if (bases === 2) runnerUpdates['runners.second'] = playerId;
        else if (bases === 1) runnerUpdates['runners.first'] = playerId;

        // Update scores and player runs
        if (scoringPlayers.length > 0) {
          const battingTeam = game.isTop ? 'away' : 'home';
          const scoreUpdate: any = {};
          scoreUpdate[`score.${battingTeam}`] = increment(scoringPlayers.length);
          await updateGame(scoreUpdate);
          
          for (const pId of scoringPlayers) {
            // Batter's run is already handled in the switch for home_run
            if (statType === 'home_run' && pId === playerId) continue;
            
            await updateDoc(doc(db, 'players', pId), {
              'stats.runs': increment(1)
            });
          }
          
          // Update RBIs for the batter (excluding self in HR as it's handled in switch)
          const rbis = statType === 'home_run' ? scoringPlayers.length - 1 : scoringPlayers.length;
          if (rbis > 0) {
             await updateDoc(doc(db, 'players', playerId), {
              'stats.rbis': increment(rbis)
            });
          }
        }
      }

      if (Object.keys(runnerUpdates).length > 0) {
        await updateGame(runnerUpdates);
      }

      // Trigger animation for certain plays
      if (['hit', 'double', 'triple', 'home_run'].includes(statType)) {
        const currentRunners: any = {};
        if (game?.runners?.first) {
          const p = [...homeRoster, ...awayRoster].find(r => r.id === game.runners.first);
          currentRunners.first = p?.name.split(' ').pop();
        }
        if (game?.runners?.second) {
          const p = [...homeRoster, ...awayRoster].find(r => r.id === game.runners.second);
          currentRunners.second = p?.name.split(' ').pop();
        }
        if (game?.runners?.third) {
          const p = [...homeRoster, ...awayRoster].find(r => r.id === game.runners.third);
          currentRunners.third = p?.name.split(' ').pop();
        }

        setShowAnimation({
          type: statType,
          batterName: lastName,
          runners: currentRunners
        });
        setTimeout(() => setShowAnimation(null), 4000);
      }

      addPlay(`${player?.name}: ${statType.toUpperCase().replace('_', ' ')}`, statType);
      
      // Advance batter index
      if (['hit', 'double', 'triple', 'home_run', 'out', 'strikeout', 'walk', 'reached_on_error'].includes(statType)) {
        const battingTeam = game.isTop ? 'away' : 'home';
        const lineup = battingTeam === 'home' ? game.homeLineup : game.awayLineup;
        const currentIndex = game.currentBatterIndex?.[battingTeam] || 0;
        
        if (lineup && lineup.length > 0 && lineup[currentIndex]?.playerId === playerId) {
          const nextIndex = (currentIndex + 1) % lineup.length;
          const indexUpdate: any = {};
          indexUpdate[`currentBatterIndex.${battingTeam}`] = nextIndex;
          await updateGame(indexUpdate);
        }
      }

      // Reset selected player after play to prepare for next batter
      setSelectedPlayerId(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `players/${playerId}`);
    }
  };

  const handleScoreChange = (team: 'home' | 'away', delta: number) => {
    if (!game) return;
    const newScore = { ...game.score, [team]: Math.max(0, game.score[team] + delta) };
    updateGame({ score: newScore });
    addPlay(`${team === 'home' ? game.homeTeamName : game.awayTeamName} anotó!`, 'score');
  };

  const getDefensivePlayer = (position: string) => {
    if (!game) return null;
    const defensiveTeam = game.isTop ? 'home' : 'away';
    const lineup = defensiveTeam === 'home' ? game.homeLineup : game.awayLineup;
    const roster = defensiveTeam === 'home' ? homeRoster : awayRoster;
    
    const lp = lineup?.find(p => p.position === position);
    if (!lp) return null;
    
    return roster.find(p => p.id === lp.playerId);
  };

  const handleOutChange = (delta: number) => {
    if (!game) return;
    let newOuts = game.outs + delta;
    if (newOuts >= 3) {
      // Inning change
      const newInning = game.isTop ? game.inning : game.inning + 1;
      const newIsTop = !game.isTop;
      updateGame({ outs: 0, balls: 0, strikes: 0, inning: newInning, isTop: newIsTop });
      addPlay(`Cambio de entrada: ${newIsTop ? 'Alta' : 'Baja'} de ${newInning}`, 'inning_change');
      setSelectedPlayerId(null);
    } else {
      updateGame({ outs: Math.max(0, newOuts) });
      if (delta > 0) addPlay('Out registrado', 'out');
    }
  };

  const handleRunnerDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || !game) return;

    const runnerId = active.id as string;
    const targetBase = over.id as string;
    const sourceBase = active.data.current?.base as string;

    if (sourceBase === targetBase) return;

    const updates: any = {};

    // Clear source base
    if (sourceBase !== 'home') {
      updates[`runners.${sourceBase}`] = null;
    } else {
      setSelectedPlayerId(null);
    }

    // Set target base
    if (targetBase === 'home') {
      // Runner scored!
      const battingTeam = game.isTop ? 'away' : 'home';
      const scoreUpdate: any = {};
      scoreUpdate[`score.${battingTeam}`] = increment(1);
      await updateGame(scoreUpdate);
      
      await updateDoc(doc(db, 'players', runnerId), {
        'stats.runs': increment(1)
      });
      
      addPlay(`Carrera anotada por ${[...homeRoster, ...awayRoster].find(p => p.id === runnerId)?.name}`, 'run');
    } else {
      updates[`runners.${targetBase}`] = runnerId;
    }

    if (Object.keys(updates).length > 0) {
      await updateGame(updates);
    }
  };

  if (!gameId) return <div className="p-8 text-center text-slate-500">Selecciona un partido para comenzar a anotar.</div>;
  if (loading) return null;
  if (!game) return <div className="p-8 text-center text-slate-500">Partido no encontrado.</div>;

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      className="max-w-6xl mx-auto space-y-6"
    >
      {/* Play Animation Overlay */}
      <AnimatePresence>
        {showAnimation && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/90 backdrop-blur-sm p-4"
          >
            <motion.div
              initial={{ scale: 0.5, y: 50 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.5, y: -50 }}
              className="relative w-full max-w-lg aspect-square bg-slate-900 border border-slate-800 rounded-[3rem] overflow-hidden shadow-2xl flex flex-col items-center justify-center"
            >
              {/* Baseball Diamond Background */}
              <div className="absolute inset-0 opacity-20">
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 border-4 border-white rotate-45" />
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 border-2 border-white/20 rotate-45" />
                {/* Outfield Fence in Animation */}
                <div className="absolute top-[15%] left-1/2 -translate-x-1/2 w-[140%] h-[140%] border-[24px] border-emerald-900/60 rounded-full flex items-start justify-center pt-8">
                  <div className="px-6 py-2 bg-yellow-500 text-slate-950 font-black text-2xl rounded-lg shadow-xl border-4 border-yellow-600 animate-bounce">
                    400 FT
                  </div>
                </div>
              </div>

              {/* Ball Animation */}
              <motion.div
                initial={{ x: 0, y: 150, scale: 0.5, zIndex: 10 }}
                animate={{ 
                  x: showAnimation.type === 'home_run' ? [0, 0, 0] : [0, 100, 150],
                  y: showAnimation.type === 'home_run' ? [150, -150, -600] : [150, -50, -100],
                  scale: showAnimation.type === 'home_run' ? [0.5, 3.5, 0.1] : [0.5, 1.5, 0.2],
                  opacity: [1, 1, 0]
                }}
                transition={{ duration: 2.5, ease: "easeOut" }}
                className="absolute z-20"
              >
                <div className="w-8 h-8 bg-white rounded-full shadow-[0_0_20px_rgba(255,255,255,0.5)] flex items-center justify-center">
                  <div className="w-6 h-6 border-2 border-red-500/20 rounded-full" />
                </div>
              </motion.div>

              {/* Text Info */}
              <div className="relative z-30 text-center space-y-4">
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.5 }}
                  className="text-6xl font-black text-white uppercase tracking-tighter italic"
                >
                  {showAnimation.type.replace('_', ' ')}!
                </motion.div>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.8 }}
                  className="text-2xl font-bold text-indigo-400 uppercase tracking-widest"
                >
                  {showAnimation.batterName}
                </motion.div>
              </div>

              {/* Runners Display */}
              <div className="absolute bottom-10 left-0 right-0 flex justify-center gap-8">
                {showAnimation.runners.first && (
                  <div className="flex flex-col items-center gap-1">
                    <div className="w-3 h-3 bg-indigo-500 rounded-full animate-pulse" />
                    <span className="text-[10px] font-bold text-slate-500 uppercase">1B: {showAnimation.runners.first}</span>
                  </div>
                )}
                {showAnimation.runners.second && (
                  <div className="flex flex-col items-center gap-1">
                    <div className="w-3 h-3 bg-indigo-500 rounded-full animate-pulse" />
                    <span className="text-[10px] font-bold text-slate-500 uppercase">2B: {showAnimation.runners.second}</span>
                  </div>
                )}
                {showAnimation.runners.third && (
                  <div className="flex flex-col items-center gap-1">
                    <div className="w-3 h-3 bg-indigo-500 rounded-full animate-pulse" />
                    <span className="text-[10px] font-bold text-slate-500 uppercase">3B: {showAnimation.runners.third}</span>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex items-center gap-4 mb-8 p-4 lg:p-8">
        <button 
          onClick={onBack} 
          className="p-2 bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:bg-indigo-600 hover:text-white rounded-xl transition-all active:scale-95 shadow-sm"
          title="Regresar al Inicio"
        >
          <Home className="w-4 h-4" />
        </button>
        <h2 className="text-2xl font-black tracking-tight uppercase">Anotador</h2>
        <div className="ml-auto flex items-center gap-2">
          {game.status === 'completed' && (
            <>
              {hasUploadedBooks(game) && (
                <button
                  type="button"
                  onClick={() => setShowBookModal(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 rounded-full text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer"
                >
                  {game.boxScore ? <TableIcon className="w-3 h-3" /> : <FileCheck className="w-3 h-3" />}
                  <span>Ver Libro {getUploadedSheetsCount(game) > 1 ? `(${getUploadedSheetsCount(game)}/4)` : ''}</span>
                </button>
              )}

              {isJefe && (
                <>
                  <input
                    type="file"
                    ref={bookFileInputRef}
                    accept="image/*,application/pdf,.pdf,.xlsx,.xls,.csv"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleUploadBookInScorekeeper(file, uploadCategory);
                      e.target.value = '';
                    }}
                  />

                  {hasUploadedBooks(game) && (
                    <button
                      type="button"
                      disabled={uploadingBook}
                      onClick={handleDeleteBookInScorekeeper}
                      className="flex items-center gap-1.5 px-3.5 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-full text-[10px] font-black uppercase tracking-wider transition-all shadow-md shadow-rose-600/20 active:scale-95 cursor-pointer"
                      title="Borrar los libros de anotación"
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>Borrar Libro</span>
                    </button>
                  )}

                  <button
                    type="button"
                    disabled={uploadingBook}
                    onClick={() => {
                      setUploadCategory('batting');
                      bookFileInputRef.current?.click();
                    }}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full text-[10px] font-black uppercase tracking-wider transition-all shadow-md shadow-indigo-600/20 active:scale-95 cursor-pointer"
                    title="Subir libro de bateo de un equipo"
                  >
                    {uploadingBook && uploadCategory === 'batting' ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <BookOpen className="w-3 h-3" />
                    )}
                    <span>Subir Libro Bateo</span>
                  </button>

                  <button
                    type="button"
                    disabled={uploadingBook}
                    onClick={() => {
                      setUploadCategory('pitching');
                      bookFileInputRef.current?.click();
                    }}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 bg-violet-600 hover:bg-violet-700 text-white rounded-full text-[10px] font-black uppercase tracking-wider transition-all shadow-md shadow-violet-600/20 active:scale-95 cursor-pointer"
                    title="Subir libro de lanzamientos de los pitchers"
                  >
                    {uploadingBook && uploadCategory === 'pitching' ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Activity className="w-3 h-3" />
                    )}
                    <span>Subir Libro Lanzamientos</span>
                  </button>
                </>
              )}
            </>
          )}

          <div className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest ${
            game.status === 'in-progress' ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
          }`}>
            {game.status === 'in-progress' ? 'En Progreso' : game.status === 'completed' ? 'Finalizado' : 'Programado'}
          </div>
        </div>
      </div>

      <div className="px-4 lg:px-8 pb-8">
        {/* Tabs */}
        <div className="flex gap-2 bg-slate-100 dark:bg-slate-800 p-1 rounded-2xl w-fit mb-6">
          <button
            onClick={() => setActiveTab('score')}
            className={`px-6 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
              activeTab === 'score'
                ? 'bg-white dark:bg-slate-900 text-indigo-600 shadow-sm'
                : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            Anotador
          </button>
          <button
            onClick={() => setActiveTab('lineup')}
            className={`px-6 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
              activeTab === 'lineup'
                ? 'bg-white dark:bg-slate-900 text-indigo-600 shadow-sm'
                : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            Lineup
          </button>
        </div>

      {activeTab === 'score' ? (
        <>
          {/* Scoreboard Header */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-8 shadow-xl dark:shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-indigo-600/5 blur-3xl rounded-full -mr-48 -mt-48" />
        
        <div className="relative z-10 space-y-8">
          {/* Top Row: Scores and Inning */}
          <div className="flex items-center justify-between px-4">
            {/* Away Team */}
            <div className="flex items-center gap-5">
              <TeamLogo
                teamId={game.awayTeamId}
                teamName={game.awayTeamName}
                size="xl"
                className="w-14 h-14 rounded-2xl shadow-md shrink-0"
              />
              <div className="text-center">
                <div className="text-6xl font-black tracking-tighter text-slate-900 dark:text-white leading-none mb-2">{game.score.away}</div>
                <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Visitante</p>
              </div>
              <div className="text-left">
                <p className="text-xl font-black text-slate-900 dark:text-slate-200 leading-tight">{game.awayTeamName}</p>
                <div className="flex gap-2 mt-2">
                  <button 
                    disabled={userRole === 'viewer'}
                    onClick={() => handleScoreChange('away', -1)} 
                    className="p-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg disabled:opacity-50 transition-colors"
                  >
                    <Minus className="w-3 h-3" />
                  </button>
                  <button 
                    disabled={userRole === 'viewer'}
                    onClick={() => handleScoreChange('away', 1)} 
                    className="p-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg disabled:opacity-50 shadow-lg shadow-indigo-600/20 transition-all"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>

            {/* Inning Info */}
            <div className="text-center bg-slate-50 dark:bg-slate-950 px-8 py-4 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-inner">
              <div className="text-indigo-600 font-black text-3xl uppercase tracking-tighter leading-none mb-1">
                {game.isTop ? 'Alta' : 'Baja'} {game.inning}
              </div>
              <div className="flex items-center justify-center gap-4 mt-3">
                <div className="flex flex-col items-center">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">B</span>
                  <div className="flex gap-1">
                    {[1, 2, 3].map(i => (
                      <div key={i} className={`w-2.5 h-2.5 rounded-full border ${i <= game.balls ? 'bg-emerald-500 border-emerald-600' : 'bg-slate-200 dark:bg-slate-800 border-transparent'}`} />
                    ))}
                  </div>
                </div>
                <div className="flex flex-col items-center">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">S</span>
                  <div className="flex gap-1">
                    {[1, 2].map(i => (
                      <div key={i} className={`w-2.5 h-2.5 rounded-full border ${i <= game.strikes ? 'bg-amber-500 border-amber-600' : 'bg-slate-200 dark:bg-slate-800 border-transparent'}`} />
                    ))}
                  </div>
                </div>
                <div className="flex flex-col items-center">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">O</span>
                  <div className="flex gap-1">
                    {[1, 2].map(i => (
                      <div key={i} className={`w-2.5 h-2.5 rounded-full border ${i <= game.outs ? 'bg-red-500 border-red-600' : 'bg-slate-200 dark:bg-slate-800 border-transparent'}`} />
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Home Team */}
            <div className="flex items-center gap-5 flex-row-reverse">
              <TeamLogo
                teamId={game.homeTeamId}
                teamName={game.homeTeamName}
                size="xl"
                className="w-14 h-14 rounded-2xl shadow-md shrink-0"
              />
              <div className="text-center">
                <div className="text-6xl font-black tracking-tighter text-slate-900 dark:text-white leading-none mb-2">{game.score.home}</div>
                <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Local</p>
              </div>
              <div className="text-right">
                <p className="text-xl font-black text-slate-900 dark:text-slate-200 leading-tight">{game.homeTeamName}</p>
                <div className="flex gap-2 mt-2 justify-end">
                  <button 
                    disabled={userRole === 'viewer'}
                    onClick={() => handleScoreChange('home', -1)} 
                    className="p-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg disabled:opacity-50 transition-colors"
                  >
                    <Minus className="w-3 h-3" />
                  </button>
                  <button 
                    disabled={userRole === 'viewer'}
                    onClick={() => handleScoreChange('home', 1)} 
                    className="p-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg disabled:opacity-50 shadow-lg shadow-indigo-600/20 transition-all"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Middle Row: Large Diamond Visualization */}
          <div className="flex justify-center">
            <DndContext sensors={sensors} onDragEnd={handleRunnerDragEnd}>
              <div className="relative w-full max-w-[720px] aspect-square bg-[#8b3a2b] dark:bg-[#6b2a1b] rounded-[4rem] border-8 border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden">
                {/* Outfield Fence */}
                <div className="absolute inset-[1%] rounded-full border-[16px] border-emerald-900 dark:border-emerald-950 shadow-2xl z-0 flex items-start justify-center pt-4">
                  <div className="w-1.5 h-full bg-emerald-800/30 absolute left-1/4" />
                  <div className="w-1.5 h-full bg-emerald-800/30 absolute left-1/2" />
                  <div className="w-1.5 h-full bg-emerald-800/30 absolute right-1/4" />
                  <div className="px-3 py-1 bg-yellow-500/80 text-slate-950 font-black text-[10px] rounded border border-yellow-600 shadow-lg z-10">
                    400 FT
                  </div>
                </div>
                
                {/* Outfield Grass with Cross-Hatch Pattern */}
                <div className="absolute inset-[4%] rounded-full overflow-hidden bg-emerald-700 dark:bg-emerald-800 shadow-inner">
                  <div className="absolute inset-0 opacity-20" style={{ 
                    backgroundImage: `
                      repeating-linear-gradient(45deg, transparent, transparent 40px, rgba(0,0,0,0.15) 40px, rgba(0,0,0,0.15) 80px),
                      repeating-linear-gradient(-45deg, transparent, transparent 40px, rgba(0,0,0,0.15) 40px, rgba(0,0,0,0.15) 80px)
                    ` 
                  }} />
                </div>
                
                {/* Infield Dirt Diamond */}
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[52%] h-[52%] rotate-45 bg-[#c68e65] dark:bg-[#a66e45] shadow-inner border-[12px] border-emerald-900/10" />
                
                {/* Infield Grass with Vertical Stripes */}
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[36%] h-[36%] rotate-45 overflow-hidden bg-emerald-600 dark:bg-emerald-700 shadow-lg border-4 border-[#b37e5d]/40">
                  <div className="absolute inset-[-50%] -rotate-45 opacity-20" style={{ 
                    backgroundImage: 'repeating-linear-gradient(90deg, transparent, transparent 25px, rgba(0,0,0,0.2) 25px, rgba(0,0,0,0.2) 50px)' 
                  }} />
                </div>

                {/* Pitcher's Mound */}
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-16 h-16 bg-[#b37e5d] dark:bg-[#8b5a3c] rounded-full shadow-xl border-2 border-white/10 flex items-center justify-center">
                  <div className="w-8 h-1.5 bg-white/30 rounded-full" />
                </div>

                {/* Home Plate Dirt Area */}
                <div className="absolute top-[85%] left-1/2 -translate-x-1/2 -translate-y-1/2 w-28 h-28 bg-[#b37e5d] dark:bg-[#8b5a3c] rounded-full shadow-xl border-2 border-white/10" />

                {/* Batter's Boxes */}
                <div className="absolute top-[85%] left-[calc(50%-28px)] -translate-x-1/2 -translate-y-1/2 w-10 h-16 border border-white/40 rounded-sm" />
                <div className="absolute top-[85%] left-[calc(50%+28px)] -translate-x-1/2 -translate-y-1/2 w-10 h-16 border border-white/40 rounded-sm" />

                {/* Catcher's Box */}
                <div className="absolute top-[92%] left-1/2 -translate-x-1/2 -translate-y-1/2 w-12 h-8 border border-white/30 rounded-sm" />

                {/* Foul Lines */}
                <div className="absolute top-0 left-0 w-full h-full pointer-events-none">
                   <div className="absolute top-[85%] left-1/2 w-[2px] h-[120%] bg-white/20 origin-top rotate-[135deg]" />
                   <div className="absolute top-[85%] left-1/2 w-[2px] h-[120%] bg-white/20 origin-top rotate-[225deg]" />
                </div>

                {/* Defensive Players on Field */}
                <div className="absolute inset-0 pointer-events-none">
                  {/* Pitcher */}
                  <DefensivePlayerOnField pos="P" top="50%" left="50%" player={getDefensivePlayer('P')} />
                  
                  {/* Catcher - Behind Home */}
                  <DefensivePlayerOnField pos="C" top="96%" left="50%" player={getDefensivePlayer('C')} />
                  
                  {/* 1B */}
                  <DefensivePlayerOnField pos="1B" top="65%" left="82%" player={getDefensivePlayer('1B')} />
                  
                  {/* 2B */}
                  <DefensivePlayerOnField pos="2B" top="30%" left="72%" player={getDefensivePlayer('2B')} />
                  
                  {/* 3B */}
                  <DefensivePlayerOnField pos="3B" top="65%" left="18%" player={getDefensivePlayer('3B')} />
                  
                  {/* SS */}
                  <DefensivePlayerOnField pos="SS" top="30%" left="28%" player={getDefensivePlayer('SS')} />
                  
                  {/* LF - Behind 3B/SS */}
                  <DefensivePlayerOnField pos="LF" top="15%" left="15%" player={getDefensivePlayer('LF')} />
                  
                  {/* CF - Behind 2B */}
                  <DefensivePlayerOnField pos="CF" top="5%" left="50%" player={getDefensivePlayer('CF')} />
                  
                  {/* RF - Behind 1B/2B */}
                  <DefensivePlayerOnField pos="RF" top="15%" left="85%" player={getDefensivePlayer('RF')} />
                </div>

                {/* Bases */}
                <BaseIcon 
                  position="second" 
                  className="top-[15%] left-1/2 -translate-x-1/2 -translate-y-1/2"
                  occupied={!!game.runners?.second} 
                  playerId={game.runners?.second || undefined}
                  name={game.runners?.second ? (() => {
                    const p = [...homeRoster, ...awayRoster].find(p => p.id === game.runners?.second);
                    return p ? `${p.name.split(' ').pop()} (${p.stats?.hits || 0}-${p.stats?.atBats || 0})` : '';
                  })() : ''} 
                />
                <BaseIcon 
                  position="first" 
                  className="top-1/2 left-[85%] -translate-x-1/2 -translate-y-1/2"
                  occupied={!!game.runners?.first} 
                  playerId={game.runners?.first || undefined}
                  name={game.runners?.first ? (() => {
                    const p = [...homeRoster, ...awayRoster].find(p => p.id === game.runners?.first);
                    return p ? `${p.name.split(' ').pop()} (${p.stats?.hits || 0}-${p.stats?.atBats || 0})` : '';
                  })() : ''} 
                />
                <BaseIcon 
                  position="third" 
                  className="top-1/2 left-[15%] -translate-x-1/2 -translate-y-1/2"
                  occupied={!!game.runners?.third} 
                  playerId={game.runners?.third || undefined}
                  name={game.runners?.third ? (() => {
                    const p = [...homeRoster, ...awayRoster].find(p => p.id === game.runners?.third);
                    return p ? `${p.name.split(' ').pop()} (${p.stats?.hits || 0}-${p.stats?.atBats || 0})` : '';
                  })() : ''} 
                />
                <BaseIcon 
                  position="home" 
                  className="top-[85%] left-1/2 -translate-x-1/2 -translate-y-1/2"
                  occupied={!!selectedPlayerId} 
                  playerId={selectedPlayerId || undefined}
                  batterHand={game.batterHand || 'right'}
                  name={selectedPlayerId ? (() => {
                    const p = [...homeRoster, ...awayRoster].find(p => p.id === selectedPlayerId);
                    return p ? `${p.name.split(' ').pop()} (${p.stats?.hits || 0}-${p.stats?.atBats || 0})` : '';
                  })() : ''} 
                />
              </div>
            </DndContext>
          </div>

          {/* Bottom Row: Controls */}
          <div className="flex justify-center gap-4">
            {userRole !== 'viewer' && (
              game.status === 'in-progress' ? (
                <button 
                  onClick={handleEndGame}
                  className="px-10 py-3 rounded-2xl font-black uppercase tracking-widest text-xs transition-all bg-red-500 text-white hover:bg-red-600 shadow-xl shadow-red-500/20 active:scale-95"
                >
                  Finalizar Partido
                </button>
              ) : (
                <button 
                  onClick={() => updateGame({ status: 'in-progress' })}
                  className="px-10 py-3 rounded-2xl font-black uppercase tracking-widest text-xs transition-all bg-indigo-600 text-white hover:bg-indigo-700 shadow-xl shadow-indigo-600/20 active:scale-95"
                >
                  Comenzar Partido
                </button>
              )
            )}
          </div>
        </div>
      </div>

      {/* Controls Grid */}
      <div className={`grid md:grid-cols-2 ${userRole === 'viewer' ? 'lg:grid-cols-2' : 'lg:grid-cols-3'} gap-6`}>
        {/* Lineup Column */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 space-y-4 shadow-sm dark:shadow-none">
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2 text-slate-400 dark:text-slate-500">
              <Users className="w-5 h-5" />
              <h4 className="font-bold uppercase tracking-widest text-xs">Lineups</h4>
            </div>
            
            <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
              <button 
                onClick={() => setScorekeeperLineupTab('away')}
                className={`flex-1 py-1.5 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all ${scorekeeperLineupTab === 'away' ? 'bg-white dark:bg-slate-900 text-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
              >
                {game.awayTeamName}
              </button>
              <button 
                onClick={() => setScorekeeperLineupTab('home')}
                className={`flex-1 py-1.5 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all ${scorekeeperLineupTab === 'home' ? 'bg-white dark:bg-slate-900 text-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
              >
                {game.homeTeamName}
              </button>
            </div>
          </div>

          <div className="space-y-2 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
            {((scorekeeperLineupTab === 'away' ? game.awayLineup : game.homeLineup) || []).map((lp, index) => {
              const player = (scorekeeperLineupTab === 'away' ? awayRoster : homeRoster).find(p => p.id === lp.playerId);
              const isBattingTeam = (scorekeeperLineupTab === 'away' && game.isTop) || (scorekeeperLineupTab === 'home' && !game.isTop);
              const isCurrent = isBattingTeam && index === (game.currentBatterIndex?.[scorekeeperLineupTab] || 0);
              
              return (
                <div 
                  key={lp.playerId} 
                  onClick={() => setSelectedPlayerId(lp.playerId)}
                  className={`flex items-center gap-3 p-2 rounded-xl border transition-all cursor-pointer ${
                    isCurrent 
                      ? 'bg-indigo-600/10 border-indigo-600/30 ring-1 ring-indigo-600/20' 
                      : selectedPlayerId === lp.playerId
                        ? 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700'
                        : 'bg-slate-50 dark:bg-slate-950 border-transparent hover:border-slate-200 dark:hover:border-slate-800'
                  }`}
                >
                  <div className={`w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-black ${
                    isCurrent ? 'bg-indigo-600 text-white' : 'bg-slate-200 dark:bg-slate-800 text-slate-500'
                  }`}>
                    {index + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs font-bold truncate ${isCurrent ? 'text-indigo-600' : 'text-slate-700 dark:text-slate-200'}`}>
                      {player?.name} <span className="text-[10px] opacity-60 ml-1">({player?.stats?.hits || 0}-{player?.stats?.atBats || 0})</span>
                    </p>
                    <p className="text-[10px] text-slate-400 uppercase tracking-widest">{lp.position || 'SIN POS'}</p>
                  </div>
                  {isCurrent && <div className="w-2 h-2 bg-indigo-600 rounded-full animate-pulse" />}
                </div>
              );
            })}
            {((scorekeeperLineupTab === 'away' ? game.awayLineup : game.homeLineup) || []).length === 0 && (
              <p className="text-center text-xs text-slate-500 py-4 italic">No hay lineup configurado</p>
            )}
          </div>
        </div>

        {userRole !== 'viewer' && (
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 space-y-6 shadow-sm dark:shadow-none">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 text-slate-400 dark:text-slate-500">
                <Activity className="w-5 h-5" />
                <h4 className="font-bold uppercase tracking-widest text-xs">Acciones Rápidas</h4>
              </div>
              <select 
                value={selectedPlayerId || ''} 
                onChange={(e) => setSelectedPlayerId(e.target.value)}
                className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-600 text-slate-900 dark:text-slate-200"
              >
                <option value="">Seleccionar Jugador</option>
                <optgroup label={game.awayTeamName} className="bg-white dark:bg-slate-950">
                  {awayRoster.map(p => <option key={p.id} value={p.id}>{p.number} - {p.name} ({p.stats?.hits || 0}-{p.stats?.atBats || 0})</option>)}
                </optgroup>
                <optgroup label={game.homeTeamName} className="bg-white dark:bg-slate-950">
                  {homeRoster.map(p => <option key={p.id} value={p.id}>{p.number} - {p.name} ({p.stats?.hits || 0}-{p.stats?.atBats || 0})</option>)}
                </optgroup>
              </select>
            </div>
            
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl mb-2">
              <button 
                onClick={() => updateGame({ batterHand: 'left' })}
                className={`flex-1 py-1.5 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all ${game.batterHand === 'left' ? 'bg-white dark:bg-slate-900 text-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
              >
                Zurdo
              </button>
              <button 
                onClick={() => updateGame({ batterHand: 'right' })}
                className={`flex-1 py-1.5 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all ${game.batterHand !== 'left' ? 'bg-white dark:bg-slate-900 text-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
              >
                Derecho
              </button>
            </div>
            <div className="col-span-2 grid grid-cols-4 gap-2 mb-2">
                <button
                  onClick={() => updateGame({ 'runners.first': game.runners?.first ? null : (selectedPlayerId || 'on_base') })}
                  className={`py-2 px-1 rounded-xl text-[9px] font-black uppercase tracking-widest border transition-all flex flex-col items-center justify-center ${game.runners?.first ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-slate-50 dark:bg-slate-950 text-slate-400 border-slate-200 dark:border-slate-800'}`}
                >
                  <span>1B {game.runners?.first ? '✓' : ''}</span>
                  <span className="text-[7px] opacity-60">{getDefensivePlayer('1B')?.name?.split(' ').pop() || ''}</span>
                </button>
                <button
                  onClick={() => updateGame({ 'runners.second': game.runners?.second ? null : (selectedPlayerId || 'on_base') })}
                  className={`py-2 px-1 rounded-xl text-[9px] font-black uppercase tracking-widest border transition-all flex flex-col items-center justify-center ${game.runners?.second ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-slate-50 dark:bg-slate-950 text-slate-400 border-slate-200 dark:border-slate-800'}`}
                >
                  <span>2B {game.runners?.second ? '✓' : ''}</span>
                  <span className="text-[7px] opacity-60">{getDefensivePlayer('2B')?.name?.split(' ').pop() || ''}</span>
                </button>
                <button
                  onClick={() => updateGame({ 'runners.third': game.runners?.third ? null : (selectedPlayerId || 'on_base') })}
                  className={`py-2 px-1 rounded-xl text-[9px] font-black uppercase tracking-widest border transition-all flex flex-col items-center justify-center ${game.runners?.third ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-slate-50 dark:bg-slate-950 text-slate-400 border-slate-200 dark:border-slate-800'}`}
                >
                  <span>3B {game.runners?.third ? '✓' : ''}</span>
                  <span className="text-[7px] opacity-60">{getDefensivePlayer('3B')?.name?.split(' ').pop() || ''}</span>
                </button>
                <button
                  onClick={() => {
                    if (selectedPlayerId) handlePlayerStatUpdate(selectedPlayerId, 'run');
                  }}
                  className={`py-2 px-1 rounded-xl text-[9px] font-black uppercase tracking-widest border transition-all flex flex-col items-center justify-center bg-slate-50 dark:bg-slate-950 text-slate-400 border-slate-200 dark:border-slate-800 hover:border-indigo-600/30`}
                >
                  <span>C (Home)</span>
                  <span className="text-[7px] opacity-60">{getDefensivePlayer('C')?.name?.split(' ').pop() || ''}</span>
                </button>
              </div>
              <ActionButton 
                onClick={() => {
                  handleOutChange(1);
                  if (selectedPlayerId) handlePlayerStatUpdate(selectedPlayerId, 'out');
                }} 
                label="Out" 
                color="bg-red-500/10 text-red-500 border-red-500/20" 
                disabled={userRole === 'viewer'}
              />
              <ActionButton 
                onClick={() => {
                  updateGame({ strikes: (game.strikes + 1) % 3 });
                  if (game.strikes === 2) {
                    handleOutChange(1);
                    if (selectedPlayerId) handlePlayerStatUpdate(selectedPlayerId, 'strikeout');
                  } else {
                    addPlay('Strike', 'strike');
                  }
                }} 
                label="Strike" 
                color="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-800" 
                disabled={userRole === 'viewer'}
              />
              <ActionButton 
                onClick={() => {
                  updateGame({ balls: (game.balls + 1) % 4 });
                  if (game.balls === 3) {
                    if (selectedPlayerId) handlePlayerStatUpdate(selectedPlayerId, 'walk');
                    updateGame({ balls: 0, strikes: 0 });
                  } else {
                    addPlay('Bola', 'ball');
                  }
                }} 
                label="Bola" 
                color="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-800" 
                disabled={userRole === 'viewer'}
              />
              <ActionButton 
                onClick={() => {
                  updateGame({ balls: 0, strikes: 0 });
                  if (selectedPlayerId) handlePlayerStatUpdate(selectedPlayerId, 'hit');
                  else addPlay('Hit', 'hit');
                }} 
                label="Hit" 
                color="bg-indigo-600/10 text-indigo-600 border-indigo-600/20" 
                disabled={userRole === 'viewer'}
              />
              <ActionButton 
                onClick={() => {
                  updateGame({ balls: 0, strikes: 0 });
                  if (selectedPlayerId) handlePlayerStatUpdate(selectedPlayerId, 'double');
                  else addPlay('Doble', 'double');
                }} 
                label="Doble" 
                color="bg-indigo-600/10 text-indigo-600 border-indigo-600/20" 
                disabled={userRole === 'viewer'}
              />
              <ActionButton 
                onClick={() => {
                  updateGame({ balls: 0, strikes: 0 });
                  if (selectedPlayerId) handlePlayerStatUpdate(selectedPlayerId, 'triple');
                  else addPlay('Triple', 'triple');
                }} 
                label="Triple" 
                color="bg-indigo-600/10 text-indigo-600 border-indigo-600/20" 
                disabled={userRole === 'viewer'}
              />
              <ActionButton 
                onClick={() => {
                  updateGame({ balls: 0, strikes: 0 });
                  if (selectedPlayerId) {
                    handlePlayerStatUpdate(selectedPlayerId, 'home_run');
                    handleScoreChange(game.isTop ? 'away' : 'home', 1);
                  } else {
                    addPlay('Jonrón!', 'home_run');
                    handleScoreChange(game.isTop ? 'away' : 'home', 1);
                  }
                }} 
                label="Jonrón" 
                color="bg-purple-500/10 text-purple-500 border-purple-500/20" 
                disabled={userRole === 'viewer'}
              />
              <ActionButton 
                onClick={() => {
                  if (selectedPlayerId) handlePlayerStatUpdate(selectedPlayerId, 'reached_on_error');
                  else addPlay('Llegó por Error', 'error');
                }} 
                label="Llegó por Error" 
                color="bg-orange-500/10 text-orange-500 border-orange-500/20" 
                disabled={userRole === 'viewer'}
              />
              <ActionButton 
                onClick={() => {
                  if (selectedPlayerId) handlePlayerStatUpdate(selectedPlayerId, 'rbi');
                }} 
                label="Carrera Impulsada" 
                color="bg-indigo-500/10 text-indigo-500 border-indigo-500/20" 
                disabled={userRole === 'viewer' || !selectedPlayerId}
              />
              <ActionButton 
                onClick={() => {
                  if (selectedPlayerId) handlePlayerStatUpdate(selectedPlayerId, 'run');
                }} 
                label="Carrera Anotada" 
                color="bg-yellow-500/10 text-yellow-500 border-yellow-500/20" 
                disabled={userRole === 'viewer' || !selectedPlayerId}
              />
              <ActionButton 
                onClick={() => {
                  if (selectedPlayerId) handlePlayerStatUpdate(selectedPlayerId, 'winning_pitcher');
                }} 
                label="Pitcher Ganador" 
                color="bg-indigo-600/10 text-indigo-600 border-indigo-600/20" 
                disabled={userRole === 'viewer' || !selectedPlayerId}
              />
            </div>
          </div>
        )}

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 space-y-4 shadow-sm dark:shadow-none">
          <div className="flex items-center gap-2 text-slate-400 dark:text-slate-500 mb-2">
            <History className="w-5 h-5" />
            <h4 className="font-bold uppercase tracking-widest text-xs">Jugadas Recientes</h4>
          </div>
          <div className="space-y-3 max-h-64 overflow-y-auto pr-2 custom-scrollbar">
            {plays.map(play => (
              <div key={play.id} className="flex items-start gap-3 p-3 bg-slate-50 dark:bg-slate-950 rounded-xl border border-slate-100 dark:border-slate-800">
                <div className="w-8 h-8 bg-slate-100 dark:bg-slate-800 rounded-lg flex items-center justify-center text-[10px] font-bold text-slate-400 dark:text-slate-500 shrink-0">
                  {play.isTop ? 'A' : 'B'}{play.inning}
                </div>
                <div className="flex-1">
                  <p className="text-sm text-slate-700 dark:text-slate-200">{play.description}</p>
                  <p className="text-[10px] text-slate-400 dark:text-slate-600 uppercase tracking-widest mt-1">{new Date(play.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  ) : (
        <LineupManager 
          game={game} 
          homeRoster={homeRoster} 
          awayRoster={awayRoster} 
          onUpdateLineup={(lineup, isHome) => {
            updateGame({ [isHome ? 'homeLineup' : 'awayLineup']: lineup });
          }}
        />
      )}
      </div>

      {/* Scorebook & Box Score Modal */}
      <AnimatePresence>
        {showBookModal && game && (
          <ScorebookModal
            game={game}
            isJefe={isJefe}
            userProfile={userProfile}
            onClose={() => setShowBookModal(false)}
            onUploadBook={async (_, file) => {
              await handleUploadBookInScorekeeper(file);
            }}
            isUploading={uploadingBook}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function LineupManager({ game, homeRoster, awayRoster, onUpdateLineup }: { 
  game: Game, 
  homeRoster: Player[], 
  awayRoster: Player[], 
  onUpdateLineup: (lineup: LineupPlayer[], isHome: boolean) => void 
}) {
  const [isHomeTab, setIsHomeTab] = useState(true);
  const roster = isHomeTab ? homeRoster : awayRoster;
  const lineup = (isHomeTab ? game.homeLineup : game.awayLineup) || [];
  
  const bench = roster.filter(p => !lineup.some(lp => lp.playerId === p.id));
  const currentTeamName = isHomeTab ? game.homeTeamName : game.awayTeamName;

  const handleAutoFillLineup = () => {
    const newLineup = [...lineup];
    bench.forEach((p, idx) => {
      if (!newLineup.some(lp => lp.playerId === p.id)) {
        newLineup.push({
          playerId: p.id,
          position: p.position && BASEBALL_POSITIONS.includes(p.position) ? p.position : (BASEBALL_POSITIONS[newLineup.length % BASEBALL_POSITIONS.length] || 'DH')
        });
      }
    });
    onUpdateLineup(newLineup, isHomeTab);
  };

  const handleAddToLineup = (playerId: string) => {
    const player = roster.find(p => p.id === playerId);
    const suggestedPos = player?.position && BASEBALL_POSITIONS.includes(player.position) ? player.position : '';
    const newLineup = [...lineup, { playerId, position: suggestedPos }];
    onUpdateLineup(newLineup, isHomeTab);
  };

  const handleRemoveFromLineup = (playerId: string) => {
    const newLineup = lineup.filter(lp => lp.playerId !== playerId);
    onUpdateLineup(newLineup, isHomeTab);
  };

  const handleUpdatePosition = (playerId: string, position: string) => {
    const newLineup = lineup.map(lp => lp.playerId === playerId ? { ...lp, position } : lp);
    onUpdateLineup(newLineup, isHomeTab);
  };

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;

    // Handle position drop
    if (active.data.current?.type === 'position') {
      const targetPlayerId = over.id as string;
      const position = active.data.current.position;
      handleUpdatePosition(targetPlayerId, position);
      return;
    }

    // Handle player drag from bench
    if (active.data.current?.type === 'bench-player') {
      const playerId = active.data.current.playerId;
      handleAddToLineup(playerId);
      return;
    }

    // Handle reordering within lineup
    if (active.id !== over.id) {
      const oldIndex = lineup.findIndex(lp => lp.playerId === active.id);
      const newIndex = lineup.findIndex(lp => lp.playerId === over.id);
      if (oldIndex !== -1 && newIndex !== -1) {
        onUpdateLineup(arrayMove(lineup, oldIndex, newIndex), isHomeTab);
      }
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex gap-4 mb-4">
        <button 
          onClick={() => setIsHomeTab(true)}
          className={`flex-1 py-4 rounded-[2rem] font-black uppercase tracking-widest text-xs transition-all border-2 flex items-center justify-center gap-3 ${isHomeTab ? 'bg-indigo-600 border-indigo-600 text-white shadow-xl shadow-indigo-600/20' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-500 hover:border-slate-300'}`}
        >
          <TeamLogo teamId={game.homeTeamId} teamName={game.homeTeamName} size="xs" />
          <span>{game.homeTeamName} (Local)</span>
        </button>
        <button 
          onClick={() => setIsHomeTab(false)}
          className={`flex-1 py-4 rounded-[2rem] font-black uppercase tracking-widest text-xs transition-all border-2 flex items-center justify-center gap-3 ${!isHomeTab ? 'bg-indigo-600 border-indigo-600 text-white shadow-xl shadow-indigo-600/20' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-500 hover:border-slate-300'}`}
        >
          <TeamLogo teamId={game.awayTeamId} teamName={game.awayTeamName} size="xs" />
          <span>{game.awayTeamName} (Visitante)</span>
        </button>
      </div>

      <DndContext 
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <div className="grid lg:grid-cols-12 gap-8">
          {/* Left Column: Bench & Positions */}
          <div className="lg:col-span-4 space-y-8">
            {/* Bench / Roster */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[2.5rem] p-8 space-y-6 shadow-sm">
              <div className="flex items-center justify-between">
                <h4 className="text-xl font-black uppercase tracking-tight">Roster / <span className="text-indigo-600">Banca</span></h4>
                <span className="bg-slate-100 dark:bg-slate-800 px-3 py-1 rounded-full text-[10px] font-black text-slate-500 uppercase">{bench.length}</span>
              </div>
              
              <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                {roster.length === 0 ? (
                  <div className="py-8 text-center space-y-2 bg-indigo-50/10 dark:bg-slate-800/40 rounded-2xl border border-dashed border-indigo-200/40 dark:border-slate-800 p-4">
                    <AlertCircle className="w-6 h-6 text-amber-500 mx-auto" />
                    <p className="text-xs font-bold text-slate-700 dark:text-slate-300">
                      Sin jugadores registrados para {currentTeamName}
                    </p>
                    <p className="text-[11px] text-slate-400">
                      Sube la cédula o agrega jugadores a este equipo en la pestaña "Equipos" para que aparezcan aquí.
                    </p>
                  </div>
                ) : bench.length === 0 ? (
                  <div className="py-8 text-center text-xs text-slate-400 font-semibold">
                    Todos los jugadores del roster ({roster.length}) están alineados.
                  </div>
                ) : (
                  bench.map(player => (
                    <DraggableBenchPlayer 
                      key={player.id} 
                      player={player} 
                      onAdd={() => handleAddToLineup(player.id)} 
                    />
                  ))
                )}
              </div>
            </div>

            {/* Positions Box */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[2.5rem] p-8 space-y-6 shadow-sm">
              <h4 className="text-xl font-black uppercase tracking-tight">Posiciones <span className="text-indigo-600">Disponibles</span></h4>
              <p className="text-[10px] text-slate-400 uppercase font-black tracking-widest">Arrastra una posición al jugador</p>
              <div className="flex flex-wrap gap-2">
                {BASEBALL_POSITIONS.map(pos => (
                  <DraggablePosition key={pos} position={pos} />
                ))}
              </div>
            </div>
          </div>

          {/* Right Column: Lineup */}
          <div className="lg:col-span-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[2.5rem] p-8 space-y-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h4 className="text-xl font-black uppercase tracking-tight">Lineup <span className="text-indigo-600">Titular</span></h4>
                <p className="text-[11px] text-slate-400">Orden al bat y posiciones defensivas de {currentTeamName}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="bg-indigo-600/10 text-indigo-600 px-3 py-1 rounded-full text-[10px] font-black uppercase">{lineup.length} Jugadores</span>
                {bench.length > 0 && (
                  <button
                    type="button"
                    onClick={handleAutoFillLineup}
                    className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-[10px] font-bold uppercase transition-all shadow-sm cursor-pointer active:scale-95"
                  >
                    + Alinear Todos
                  </button>
                )}
                {lineup.length > 0 && (
                  <button
                    type="button"
                    onClick={() => onUpdateLineup([], isHomeTab)}
                    className="px-2.5 py-1 text-slate-400 hover:text-red-500 rounded-xl text-[10px] font-bold uppercase transition-all cursor-pointer"
                  >
                    Limpiar
                  </button>
                )}
              </div>
            </div>

            <DroppableLineupContainer id="lineup-container">
              <SortableContext 
                items={lineup.map(lp => lp.playerId)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-3">
                  {lineup.map((lp, index) => {
                    const player = roster.find(p => p.id === lp.playerId);
                    if (!player) return null;
                    return (
                      <SortableLineupItem 
                        key={lp.playerId}
                        id={lp.playerId}
                        player={player}
                        order={index + 1}
                        position={lp.position}
                        onRemove={() => handleRemoveFromLineup(lp.playerId)}
                        onUpdatePosition={(pos) => handleUpdatePosition(lp.playerId, pos)}
                      />
                    );
                  })}
                </div>
              </SortableContext>
            </DroppableLineupContainer>

            {lineup.length === 0 && (
              <div className="py-20 text-center space-y-4 bg-indigo-50/20 dark:bg-slate-900/50 border-2 border-dashed border-indigo-100 dark:border-slate-800 rounded-[2rem]">
                <Users className="w-12 h-12 text-indigo-200 dark:text-slate-700 mx-auto" />
                <p className="text-slate-400 font-bold text-sm">Arrastra jugadores aquí para formar el lineup</p>
              </div>
            )}
          </div>
        </div>
      </DndContext>
    </div>
  );
}

const DraggableBenchPlayer: React.FC<{ player: Player, onAdd: () => void }> = ({ player, onAdd }) => {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `bench-${player.id}`,
    data: { type: 'bench-player', playerId: player.id }
  });
  
  const style = transform ? {
    transform: CSS.Translate.toString(transform),
    zIndex: 50,
  } : undefined;

  return (
    <div 
      ref={setNodeRef} 
      style={style} 
      {...listeners} 
      {...attributes}
      className={`flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-950 rounded-2xl border transition-all cursor-grab active:cursor-grabbing ${isDragging ? 'border-indigo-600 shadow-2xl scale-105 opacity-50' : 'border-slate-100 dark:border-slate-800 hover:border-indigo-600/30'}`}
    >
      <div className="flex items-center gap-4">
        <div className="w-10 h-10 bg-white dark:bg-slate-900 rounded-xl flex items-center justify-center font-black text-slate-400 border border-slate-100 dark:border-slate-800">
          {player.number}
        </div>
        <div>
          <p className="font-bold text-slate-900 dark:text-white text-sm">{player.name}</p>
          <p className="text-[10px] text-slate-400 uppercase font-black">{player.position}</p>
        </div>
      </div>
      <button 
        onClick={(e) => { e.stopPropagation(); onAdd(); }}
        className="p-2 bg-indigo-600/10 text-indigo-600 rounded-xl hover:bg-indigo-600 hover:text-white transition-all"
      >
        <UserPlus className="w-5 h-5" />
      </button>
    </div>
  );
}

const DraggablePosition: React.FC<{ position: string }> = ({ position }) => {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `pos-${position}`,
    data: { type: 'position', position }
  });
  
  const style = transform ? {
    transform: CSS.Translate.toString(transform),
    zIndex: 50,
  } : undefined;

  return (
    <div 
      ref={setNodeRef} 
      style={style} 
      {...listeners} 
      {...attributes}
      className={`px-4 py-2 bg-slate-100 dark:bg-slate-800 rounded-xl font-black text-xs cursor-move hover:bg-indigo-600 hover:text-white transition-all border border-slate-200 dark:border-slate-700 ${isDragging ? 'scale-110 shadow-xl bg-indigo-600 text-white border-indigo-600' : ''}`}
    >
      {position}
    </div>
  );
}

function DroppableLineupContainer({ children, id }: { children: React.ReactNode, id: string }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div 
      ref={setNodeRef} 
      className={`space-y-3 min-h-[200px] rounded-[2rem] transition-all ${isOver ? 'bg-indigo-600/5 ring-2 ring-indigo-600/20 ring-dashed' : ''}`}
    >
      {children}
    </div>
  );
}

interface SortableLineupItemProps {
  id: string;
  player: Player;
  order: number;
  position: string;
  onRemove: () => void;
  onUpdatePosition: (pos: string) => void;
}

const SortableLineupItem: React.FC<SortableLineupItemProps> = ({ id, player, order, position, onRemove, onUpdatePosition }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isOver
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : 1,
  };

  return (
    <div 
      ref={setNodeRef} 
      style={style}
      className={`flex items-center gap-4 p-4 bg-white dark:bg-slate-900 border rounded-2xl transition-all ${isDragging ? 'border-indigo-600 shadow-2xl scale-105 opacity-50' : isOver ? 'border-indigo-600 bg-indigo-600/5 ring-2 ring-indigo-600/20' : 'border-slate-100 dark:border-slate-800 shadow-sm'}`}
    >
      <div className="flex items-center gap-3 flex-1">
        <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing p-1 text-slate-300 hover:text-slate-500 transition-colors">
          <GripVertical className="w-5 h-5" />
        </div>
        <div className="w-8 h-8 bg-indigo-600/10 text-indigo-600 rounded-lg flex items-center justify-center font-black text-xs">
          {order}
        </div>
        <div className="flex-1">
          <p className="font-bold text-slate-900 dark:text-white text-sm">{player.name}</p>
          <p className="text-[10px] text-slate-400 uppercase font-black">#{player.number}</p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <select 
          value={position}
          onChange={(e) => onUpdatePosition(e.target.value)}
          className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-[10px] font-black uppercase tracking-widest focus:outline-none focus:ring-2 focus:ring-indigo-600/20"
        >
          <option value="">POS</option>
          {BASEBALL_POSITIONS.map(pos => (
            <option key={pos} value={pos}>{pos}</option>
          ))}
        </select>
        <button 
          onClick={onRemove}
          className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-xl transition-all"
        >
          <UserMinus className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}

function DefensivePlayerOnField({ pos, top, left, player }: { pos: string, top: string, left: string, player?: Player }) {
  return (
    <div className="absolute text-center z-20" style={{ top, left, transform: 'translate(-50%, -50%)' }}>
      <div className="bg-white/95 dark:bg-slate-900/95 backdrop-blur-md px-3 py-1.5 rounded-lg border-2 border-slate-200 dark:border-slate-800 shadow-2xl min-w-[50px] group hover:scale-110 transition-transform">
        <div className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase leading-none mb-0.5">{pos}</div>
        <div className="text-[11px] font-black text-indigo-600 dark:text-indigo-400 truncate leading-none">
          {player?.name?.split(' ').pop() || '---'}
        </div>
      </div>
    </div>
  );
}

function StatBox({ label, value, color = "text-slate-900 dark:text-white" }: { label: string, value: number, color?: string }) {
  return (
    <div className="space-y-1">
      <div className={`text-xl font-black ${color}`}>{value}</div>
      <div className="text-[10px] text-slate-400 dark:text-slate-600 font-bold uppercase tracking-widest">{label}</div>
    </div>
  );
}

function BaseIcon({ position, occupied, name, playerId, className, batterHand }: { position: 'first' | 'second' | 'third' | 'home', occupied: boolean, name?: string, playerId?: string, className?: string, batterHand?: 'right' | 'left' }) {
  const { setNodeRef, isOver } = useDroppable({
    id: position,
  });

  return (
    <div 
      ref={setNodeRef}
      className={`absolute ${className} flex flex-col items-center z-30`}
    >
      {/* Home Plate itself */}
      {position === 'home' && (
        <div className="w-7 h-7 bg-white border-2 border-slate-400 shadow-lg" style={{ clipPath: 'polygon(50% 0%, 100% 35%, 100% 100%, 0% 100%, 0% 35%)' }} />
      )}

      {/* Diamond for 1B, 2B, 3B */}
      {position !== 'home' && (
        <div className={`w-7 h-7 rotate-45 border-2 transition-all duration-300 shadow-lg ${
          isOver ? 'scale-150 border-indigo-400 bg-indigo-600/50' :
          occupied 
            ? 'bg-indigo-600 border-indigo-400 shadow-[0_0_20px_rgba(79,70,229,0.6)] scale-110' 
            : 'bg-white dark:bg-slate-100 border-slate-300 dark:border-slate-400'
        }`} />
      )}

      {occupied && playerId && (
        <div className={`absolute ${position === 'home' ? (batterHand === 'left' ? '-left-12' : 'left-12') : ''}`}>
          <DraggableRunner id={playerId} name={name || ''} base={position} isBatter={position === 'home'} />
        </div>
      )}
    </div>
  );
}

function DraggableRunner({ id, name, base, isBatter }: { id: string, name: string, base: string, isBatter?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: id,
    data: { base }
  });

  const style = transform ? {
    transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
  } : {};

  return (
    <div 
      ref={setNodeRef} 
      {...listeners} 
      {...attributes}
      className={`absolute ${isBatter ? 'rotate-0' : '-rotate-45'} whitespace-nowrap cursor-grab active:cursor-grabbing z-20 ${isDragging ? 'opacity-50 scale-125' : ''}`} 
      style={{ ...style, top: isBatter ? '0px' : '35px' }}
    >
      <span className="text-[12px] font-black text-indigo-600 dark:text-indigo-400 uppercase tracking-tighter bg-white dark:bg-slate-950 px-2 py-1 rounded shadow-lg border border-indigo-600/20">
        {name}
      </span>
    </div>
  );
}

function ActionButton({ onClick, label, color, disabled = false }: { onClick: () => void, label: string, color: string, disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`py-4 px-6 rounded-2xl font-bold text-sm border transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 ${color}`}
    >
      {label}
    </button>
  );
}
