import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Game, Team, Category, CATEGORIES } from '../types';
import { matchTeamNameWithAliases } from './scorebookUtils';

export interface StandingsTeamRow extends Team {
  wins: number;
  losses: number;
  runsScored: number;
  runsAllowed: number;
  pctStr: string;
  pctNum: number;
  diff: number;
  gamesPlayed: number;
}

export interface GenerateStandingsPdfOptions {
  teams: Team[];
  games: Game[];
  selectedCategory: Category | 'Todas' | 'All';
  seasonName?: string;
  leagueName?: string;
  orientation?: 'portrait' | 'landscape';
  includeHighlights?: boolean;
}

const normalizeStr = (str: any): string => {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
};

const isTeamMatch = (gameTeamId: string | undefined, gameTeamName: string | undefined, team: Team): boolean => {
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

const getHeadToHead = (teamA: Team, teamB: Team, games: Game[]): number => {
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

  if (aWins > bWins) return 1;
  if (bWins > aWins) return -1;
  return 0;
};

/**
 * Computes official standings rows applying identical tiebreakers as Standings.tsx.
 */
export function computeCategoryStandings(teams: Team[], games: Game[], category: Category): StandingsTeamRow[] {
  const standings = teams.map(team => {
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
    const gamesPlayed = wins + losses;
    const pctNum = gamesPlayed === 0 ? 0 : wins / gamesPlayed;
    const pctStr = gamesPlayed === 0 ? '.000' : pctNum.toFixed(3).replace(/^0/, '');
    const diff = runsScored - runsAllowed;

    return {
      ...team,
      wins,
      losses,
      runsScored,
      runsAllowed,
      gamesPlayed,
      pctNum,
      pctStr,
      diff,
    };
  });

  return standings
    .filter(t => t.category === category)
    .sort((a, b) => {
      // Criterio Principal: Porcentaje
      if (Math.abs(b.pctNum - a.pctNum) > 0.0001) {
        return b.pctNum - a.pctNum;
      }

      // Criterio 1: Mayor cantidad de juegos ganados
      if (b.wins !== a.wins) {
        return b.wins - a.wins;
      }

      // Criterio 2: Head-to-Head
      if (a.wins === b.wins && a.losses === b.losses) {
        const h2h = getHeadToHead(a, b, games);
        if (h2h !== 0) {
          return h2h > 0 ? -1 : 1;
        }
      }

      // Criterio 3: Diferencia de carreras (CA - CP)
      if (b.diff !== a.diff) {
        return b.diff - a.diff;
      }

      // Criterio 4: Carreras anotadas (CA)
      if (b.runsScored !== a.runsScored) {
        return b.runsScored - a.runsScored;
      }

      // Criterio 5: Menor cantidad de carreras permitidas (CP)
      if (a.runsAllowed !== b.runsAllowed) {
        return a.runsAllowed - b.runsAllowed;
      }

      // Criterio 6: Alfabético
      return a.name.localeCompare(b.name);
    });
}

/**
 * Pre-processes an image source to a guaranteed circular PNG Data URL supported by jsPDF.
 */
async function ensurePngDataUrl(src?: string): Promise<string | null> {
  if (!src) return null;
  if (typeof window === 'undefined') return null;

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve(src.startsWith('data:image/png') ? src : null);
    }, 3000);

    const img = new Image();
    if (src.startsWith('http://') || src.startsWith('https://')) {
      img.crossOrigin = 'anonymous';
    }

    img.onload = () => {
      clearTimeout(timer);
      try {
        const TARGET_SIZE = 192;
        const canvas = document.createElement('canvas');
        canvas.width = TARGET_SIZE;
        canvas.height = TARGET_SIZE;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(src.startsWith('data:image/png') ? src : null);
          return;
        }

        ctx.clearRect(0, 0, TARGET_SIZE, TARGET_SIZE);

        ctx.save();
        ctx.beginPath();
        ctx.arc(TARGET_SIZE / 2, TARGET_SIZE / 2, (TARGET_SIZE / 2) - 4, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();

        const w = img.width || TARGET_SIZE;
        const h = img.height || TARGET_SIZE;
        const maxDim = TARGET_SIZE - 10;
        let drawW = maxDim;
        let drawH = maxDim;
        let offsetX = 5;
        let offsetY = 5;

        if (w > h) {
          drawW = maxDim;
          drawH = Math.round((maxDim * h) / w);
          offsetY = Math.round((TARGET_SIZE - drawH) / 2);
        } else {
          drawH = maxDim;
          drawW = Math.round((maxDim * w) / h);
          offsetX = Math.round((TARGET_SIZE - drawW) / 2);
        }

        ctx.drawImage(img, offsetX, offsetY, drawW, drawH);
        ctx.restore();

        ctx.beginPath();
        ctx.arc(TARGET_SIZE / 2, TARGET_SIZE / 2, (TARGET_SIZE / 2) - 4, 0, Math.PI * 2);
        ctx.strokeStyle = '#4F46E5'; // Indigo-600
        ctx.lineWidth = 3;
        ctx.stroke();

        const png = canvas.toDataURL('image/png');
        resolve(png);
      } catch (err) {
        console.warn('Could not convert image to PNG for PDF:', err);
        resolve(src.startsWith('data:image/png') ? src : null);
      }
    };

    img.onerror = () => {
      clearTimeout(timer);
      resolve(src.startsWith('data:image/png') ? src : null);
    };

    img.src = src;
  });
}

function drawLetterFallback(doc: jsPDF, name: string, x: number, y: number, size: number) {
  const initial = (name || '?').trim().charAt(0).toUpperCase();
  const radius = size / 2;
  const cx = x + radius;
  const cy = y + radius;

  doc.setFillColor(238, 242, 255); // Indigo-50
  doc.setDrawColor(165, 180, 252); // Indigo-300
  doc.setLineWidth(0.2);
  doc.circle(cx, cy, radius, 'FD');

  doc.setTextColor(79, 70, 229); // Indigo-600
  doc.setFontSize(size * 1.35);
  doc.setFont('helvetica', 'bold');
  doc.text(initial, cx, cy + 0.45, { align: 'center', baseline: 'middle' });
}

export async function generateStandingsPDF({
  teams,
  games,
  selectedCategory,
  seasonName = 'Temporada Oficial',
  leagueName = 'Liga de Béisbol Infantil y Juvenil',
  orientation = 'portrait',
  includeHighlights = true,
}: GenerateStandingsPdfOptions): Promise<jsPDF> {
  const isAll = selectedCategory === 'Todas' || selectedCategory === 'All';

  // Pre-load and convert team logos to PNG Data URLs
  const teamPngLogos = new Map<string, string>();
  await Promise.all(
    teams.map(async (t) => {
      if (t.logoUrl) {
        const png = await ensurePngDataUrl(t.logoUrl);
        if (png) {
          if (t.id) teamPngLogos.set(t.id, png);
          if (t.name) teamPngLogos.set(t.name.trim().toLowerCase(), png);
          const norm = normalizeStr(t.name);
          if (norm) teamPngLogos.set(norm, png);
        }
      }
    })
  );

  const findLogoForTeam = (teamId?: string, teamName?: string): string | undefined => {
    if (teamId && teamPngLogos.has(teamId)) return teamPngLogos.get(teamId);
    if (teamName) {
      const lower = teamName.trim().toLowerCase();
      if (teamPngLogos.has(lower)) return teamPngLogos.get(lower);
      const norm = normalizeStr(teamName);
      if (teamPngLogos.has(norm)) return teamPngLogos.get(norm);
    }
    return undefined;
  };

  const doc = new jsPDF({
    orientation,
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  // Helper to draw the header on any page
  const drawPageHeader = (catLabel: string) => {
    // Header Banner
    doc.setFillColor(15, 23, 42); // Slate-900
    doc.rect(0, 0, pageWidth, 28, 'F');

    // Accent line
    doc.setFillColor(79, 70, 229); // Indigo-600
    doc.rect(0, 28, pageWidth, 2.5, 'F');

    // Trophy icon circle
    doc.setFillColor(79, 70, 229);
    doc.circle(18, 14, 6.5, 'F');
    doc.setFillColor(255, 255, 255);
    doc.circle(18, 14, 5.5, 'F');
    doc.setTextColor(79, 70, 229);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text('⚾', 18, 14.5, { align: 'center', baseline: 'middle' });

    // Titles
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text(leagueName.toUpperCase(), 28, 12);

    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(199, 210, 254); // Indigo-200
    doc.text('TABLA GENERAL DE POSICIONES Y ESTADÍSTICAS OFICIALES', 28, 18);

    // Meta right
    const now = new Date();
    const dateFormatted = now.toLocaleDateString('es-MX', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
    const timeFormatted = now.toLocaleTimeString('es-MX', {
      hour: '2-digit',
      minute: '2-digit',
    });

    doc.setFontSize(8);
    doc.setTextColor(203, 213, 225); // Slate-300
    doc.text(`Fecha de Emisión: ${dateFormatted} ${timeFormatted}`, pageWidth - 14, 11, { align: 'right' });
    if (seasonName) {
      doc.text(`Temporada: ${seasonName}`, pageWidth - 14, 17, { align: 'right' });
    }
  };

  // Categories to render
  const categoriesToRender: Category[] = isAll
    ? (CATEGORIES.filter(c => teams.some(t => t.category === c)))
    : [selectedCategory as Category];

  let currentY = 36;

  categoriesToRender.forEach((cat, catIdx) => {
    const catTeams = computeCategoryStandings(teams, games, cat);

    // If starting a new category and not first, check space or add page
    if (catIdx > 0) {
      if (currentY > pageHeight - 80) {
        doc.addPage();
        drawPageHeader(isAll ? 'TODAS LAS CATEGORÍAS' : cat.toUpperCase());
        currentY = 36;
      } else {
        currentY += 8;
      }
    } else {
      drawPageHeader(isAll ? 'TODAS LAS CATEGORÍAS' : cat.toUpperCase());
    }

    // Category Section Header Banner
    doc.setFillColor(241, 245, 249); // Slate-100
    doc.roundedRect(14, currentY, pageWidth - 28, 8.5, 2, 2, 'F');
    doc.setFillColor(79, 70, 229);
    doc.rect(14, currentY, 3, 8.5, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(30, 41, 59);
    doc.text(`CATEGORÍA: ${cat.toUpperCase()} (${catTeams.length} ${catTeams.length === 1 ? 'EQUIPO' : 'EQUIPOS'})`, 20, currentY + 5.5);

    const totalGamesFinished = catTeams.reduce((acc, t) => acc + t.gamesPlayed, 0) / 2;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(100, 116, 139);
    doc.text(`Juegos Jugados: ${Math.round(totalGamesFinished)}`, pageWidth - 18, currentY + 5.5, { align: 'right' });

    currentY += 11;

    if (catTeams.length === 0) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(9);
      doc.setTextColor(148, 163, 184);
      doc.text('No hay equipos registrados en esta categoría.', 20, currentY + 6);
      currentY += 12;
      return;
    }

    // Table Data
    const head = [['#', '', 'EQUIPO', 'JJ', 'V', 'D', 'PCT', 'CA', 'CP', 'DIF']];
    const body = catTeams.map((team, idx) => {
      const diffFormatted = team.diff > 0 ? `+${team.diff}` : `${team.diff}`;
      return [
        String(idx + 1),
        '', // reserved for team logo cell
        team.name.toUpperCase(),
        String(team.gamesPlayed),
        String(team.wins),
        String(team.losses),
        team.pctStr,
        String(team.runsScored),
        String(team.runsAllowed),
        diffFormatted,
      ];
    });

    const logoCellSize = 6.5;

    autoTable(doc, {
      startY: currentY,
      head,
      body,
      theme: 'grid',
      styles: {
        fontSize: 8.5,
        cellPadding: { top: 2.2, bottom: 2.2, left: 2, right: 2 },
        textColor: [30, 41, 59],
        lineColor: [226, 232, 240],
        lineWidth: 0.15,
        valign: 'middle',
      },
      headStyles: {
        fillColor: [30, 41, 59], // Slate-800
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 8.5,
        halign: 'center',
      },
      columnStyles: {
        0: { halign: 'center', fontStyle: 'bold', cellWidth: 10 }, // #
        1: { halign: 'center', cellWidth: 10 }, // Logo cell
        2: { halign: 'left', fontStyle: 'bold', cellWidth: orientation === 'landscape' ? 85 : 55 }, // Equipo
        3: { halign: 'center', cellWidth: 14 }, // JJ
        4: { halign: 'center', fontStyle: 'bold', cellWidth: 14 }, // V
        5: { halign: 'center', cellWidth: 14 }, // D
        6: { halign: 'center', fontStyle: 'bold', textColor: [79, 70, 229], cellWidth: 18 }, // PCT
        7: { halign: 'center', cellWidth: 16 }, // CA
        8: { halign: 'center', cellWidth: 16 }, // CP
        9: { halign: 'center', fontStyle: 'bold', cellWidth: 16 }, // DIF
      },
      alternateRowStyles: {
        fillColor: [248, 250, 252], // Slate-50
      },
      margin: { left: 14, right: 14 },
      didDrawCell: (data) => {
        // Draw team logos inside Column 1
        if (data.section === 'body' && data.column.index === 1) {
          const team = catTeams[data.row.index];
          if (!team) return;
          const logoPng = findLogoForTeam(team.id, team.name);
          const x = data.cell.x + (data.cell.width - logoCellSize) / 2;
          const y = data.cell.y + (data.cell.height - logoCellSize) / 2;

          if (logoPng) {
            try {
              doc.addImage(logoPng, 'PNG', x, y, logoCellSize, logoCellSize);
            } catch (e) {
              drawLetterFallback(doc, team.name, x, y, logoCellSize);
            }
          } else {
            drawLetterFallback(doc, team.name, x, y, logoCellSize);
          }
        }
      },
    });

    const finalY = (doc as any).lastAutoTable?.finalY || currentY + 30;
    currentY = finalY;

    // Highlights Card (Líder, Mejor Ofensiva, Mejor Defensiva)
    if (includeHighlights && catTeams.length > 0) {
      const leader = catTeams[0];
      const bestOffense = [...catTeams].sort((a, b) => b.runsScored - a.runsScored)[0];
      const bestDefense = [...catTeams].sort((a, b) => a.runsAllowed - b.runsAllowed)[0];

      if (currentY + 22 > pageHeight - 16) {
        doc.addPage();
        drawPageHeader(isAll ? 'TODAS LAS CATEGORÍAS' : cat.toUpperCase());
        currentY = 36;
      } else {
        currentY += 4;
      }

      const cardWidth = (pageWidth - 28 - 6) / 3;
      const cardHeight = 15;

      // Card 1: Líder
      doc.setFillColor(238, 242, 255); // Indigo-50
      doc.setDrawColor(199, 210, 254);
      doc.roundedRect(14, currentY, cardWidth, cardHeight, 2, 2, 'FD');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(79, 70, 229);
      doc.text('🏆 LÍDER DE CATEGORÍA', 17, currentY + 4.5);
      doc.setFontSize(8.5);
      doc.setTextColor(15, 23, 42);
      doc.text(leader.name.toUpperCase(), 17, currentY + 9);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(100, 116, 139);
      doc.text(`${leader.wins} V - ${leader.losses} D (${leader.pctStr}) • Dif: ${leader.diff > 0 ? `+${leader.diff}` : leader.diff}`, 17, currentY + 12.5);

      // Card 2: Mejor Ofensiva
      const x2 = 14 + cardWidth + 3;
      doc.setFillColor(254, 243, 199); // Amber-50
      doc.setDrawColor(253, 230, 138);
      doc.roundedRect(x2, currentY, cardWidth, cardHeight, 2, 2, 'FD');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(180, 83, 9);
      doc.text('⚡ MEJOR OFENSIVA', x2 + 3, currentY + 4.5);
      doc.setFontSize(8.5);
      doc.setTextColor(15, 23, 42);
      doc.text(bestOffense.name.toUpperCase(), x2 + 3, currentY + 9);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(100, 116, 139);
      doc.text(`${bestOffense.runsScored} Carreras Anotadas (${bestOffense.gamesPlayed > 0 ? (bestOffense.runsScored / bestOffense.gamesPlayed).toFixed(1) : 0} por juego)`, x2 + 3, currentY + 12.5);

      // Card 3: Mejor Defensiva
      const x3 = x2 + cardWidth + 3;
      doc.setFillColor(236, 253, 245); // Emerald-50
      doc.setDrawColor(167, 243, 208);
      doc.roundedRect(x3, currentY, cardWidth, cardHeight, 2, 2, 'FD');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(5, 150, 105);
      doc.text('🛡️ MEJOR DEFENSIVA', x3 + 3, currentY + 4.5);
      doc.setFontSize(8.5);
      doc.setTextColor(15, 23, 42);
      doc.text(bestDefense.name.toUpperCase(), x3 + 3, currentY + 9);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(100, 116, 139);
      doc.text(`${bestDefense.runsAllowed} Carreras Permitidas (${bestDefense.gamesPlayed > 0 ? (bestDefense.runsAllowed / bestDefense.gamesPlayed).toFixed(1) : 0} por juego)`, x3 + 3, currentY + 12.5);

      currentY += cardHeight + 4;
    }
  });

  // Footer on all pages
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(148, 163, 184); // Slate-400

    doc.text(
      '* Criterios oficiales: 1. Porcentaje (PCT), 2. Mayor número de victorias, 3. Dominio directo (Head-to-Head), 4. Diferencia de carreras (CA - CP), 5. Carreras anotadas.',
      14,
      pageHeight - 6
    );

    doc.text(
      `Página ${p} de ${totalPages}`,
      pageWidth - 14,
      pageHeight - 6,
      { align: 'right' }
    );
  }

  return doc;
}

export async function downloadStandingsPDF(options: GenerateStandingsPdfOptions): Promise<string> {
  const doc = await generateStandingsPDF(options);

  const cleanCat = options.selectedCategory === 'Todas' || options.selectedCategory === 'All'
    ? 'Todas_Categorias'
    : String(options.selectedCategory).replace(/\s+/g, '_');

  const todayStr = new Date().toISOString().split('T')[0];
  const fileName = `Tabla_de_Posiciones_${cleanCat}_${todayStr}.pdf`;
  doc.save(fileName);
  return fileName;
}
