import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Game, Team, Category, TournamentType, formatFieldName } from '../types';

export interface GenerateResultsPdfOptions {
  games: Game[];
  teams: Team[];
  selectedCategory: Category | 'Todas' | 'All';
  selectedJornada: number | 'Todas' | 'All';
  selectedTournament?: TournamentType | 'Todos' | 'All';
  onlyCompleted?: boolean;
  seasonName?: string;
  leagueName?: string;
}

/**
 * Normalizes string for fuzzy/accent-insensitive matching.
 */
function normalizeStr(str?: string): string {
  return String(str || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
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

        // Circular clipping
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
        ctx.strokeStyle = '#059669'; // Emerald-600
        ctx.lineWidth = 3;
        ctx.stroke();

        const png = canvas.toDataURL('image/png');
        resolve(png);
      } catch (err) {
        console.warn('Could not convert image to PNG for PDF:', err);
        resolve(null);
      }
    };

    img.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };

    img.src = src;
  });
}

/**
 * Draws a clean circular fallback badge with team initial.
 */
function drawLetterFallback(doc: jsPDF, name: string, x: number, y: number, size: number) {
  const initial = (name || '?').trim().charAt(0).toUpperCase();
  const radius = size / 2;
  const centerX = x + radius;
  const centerY = y + radius;

  doc.setFillColor(241, 245, 249); // Slate-100
  doc.circle(centerX, centerY, radius, 'F');

  doc.setDrawColor(203, 213, 225); // Slate-300
  doc.setLineWidth(0.2);
  doc.circle(centerX, centerY, radius, 'S');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(size * 1.8);
  doc.setTextColor(71, 85, 105); // Slate-600
  doc.text(initial, centerX, centerY + (size * 0.35), { align: 'center', baseline: 'middle' });
}

/**
 * Extracts Home Runs from box score and player notes for a game.
 */
export function extractGameHomeRuns(game: Game): string[] {
  const hrList: string[] = [];

  if (game.boxScore?.teams) {
    for (const team of game.boxScore.teams) {
      if (!team.batters) continue;
      for (const batter of team.batters) {
        let count = Number(batter.hr) || 0;
        const notes = `${batter.extraNotes || ''} ${batter.battingLine || ''}`.toUpperCase();
        
        const match = notes.match(/(\d+)\s*HR|HR\s*(\d+)|(?:^|\s|,|\()HR(?:$|\s|,|\))/i);
        if (match) {
          const parsed = parseInt(match[1] || match[2] || '1', 10);
          if (parsed > count) count = parsed;
        }

        if (count > 0) {
          const nameClean = (batter.name || 'Bateador').replace(/#\d+\s*/, '').trim();
          hrList.push(`${nameClean} (${team.teamName}${count > 1 ? ` x${count}` : ''})`);
        }
      }
    }
  }

  // Check general notes if any
  const genNotes = String(game.boxScore?.generalNotes || (game as any).generalNotes || '');
  if (genNotes) {
    const hrMatch = genNotes.match(/HR(?:s)?:\s*([^\n\.;]+)/i);
    if (hrMatch && hrMatch[1]) {
      const parsedNotesHR = hrMatch[1].trim();
      if (parsedNotesHR && !hrList.some(h => parsedNotesHR.includes(h))) {
        hrList.push(parsedNotesHR);
      }
    }
  }

  return hrList;
}

/**
 * Generates and downloads official match results PDF.
 */
export async function downloadResultsPDF({
  games,
  teams,
  selectedCategory,
  selectedJornada,
  selectedTournament = 'All',
  onlyCompleted = true,
  seasonName = 'Temporada Oficial',
  leagueName = 'Liga de Béisbol Infantil y Juvenil'
}: GenerateResultsPdfOptions): Promise<string> {
  const categoryFilter = selectedCategory === 'Todas' ? 'All' : selectedCategory;
  const jornadaFilter = selectedJornada === 'Todas' ? 'All' : selectedJornada;
  const tournamentFilter = selectedTournament === 'Todos' ? 'All' : selectedTournament;

  // Filter games based on criteria
  const filtered = games.filter(game => {
    const homeTeam = teams.find(t => t.id === game.homeTeamId);
    const awayTeam = teams.find(t => t.id === game.awayTeamId);
    const gameCat = game.category || homeTeam?.category || awayTeam?.category;

    const catMatch = categoryFilter === 'All' || gameCat === categoryFilter;
    const tourMatch =
      tournamentFilter === 'All' ||
      game.tournament === tournamentFilter ||
      (!game.tournament && tournamentFilter === 'Regular');
    const jorMatch =
      jornadaFilter === 'All' || Number(game.jornada) === Number(jornadaFilter);

    const isFinished =
      game.status === 'completed' ||
      (game.score && (game.score.away !== undefined || game.score.home !== undefined) &&
        (Number(game.score.away) > 0 || Number(game.score.home) > 0 || game.winningPitcher || game.boxScore));

    const statusMatch = onlyCompleted ? isFinished : true;

    return catMatch && tourMatch && jorMatch && statusMatch;
  });

  // Sort by Jornada ASC, then by Date ASC
  filtered.sort((a, b) => {
    const jA = Number(a.jornada) || 999;
    const jB = Number(b.jornada) || 999;
    if (jA !== jB) return jA - jB;
    const dateA = a.date ? new Date(a.date).getTime() : 0;
    const dateB = b.date ? new Date(b.date).getTime() : 0;
    return dateA - dateB;
  });

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

  // Create document in Landscape orientation for spacious and clear multi-column layout
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4'
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  // Header Banner (Slate-900 / Emerald)
  doc.setFillColor(15, 23, 42); // Slate-900
  doc.rect(0, 0, pageWidth, 28, 'F');

  // Decorative Accent Line (Emerald-500)
  doc.setFillColor(16, 185, 129); // Emerald-500
  doc.rect(0, 28, pageWidth, 2.5, 'F');

  // Decorative Trophy Badge in Header
  doc.setFillColor(16, 185, 129);
  doc.circle(18, 14, 6.5, 'F');
  doc.setFillColor(255, 255, 255);
  doc.circle(18, 14, 5.5, 'F');
  doc.setTextColor(16, 185, 129);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.text('🏆', 18, 14.5, { align: 'center', baseline: 'middle' });

  // League Title & Header Text
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(15);
  doc.setFont('helvetica', 'bold');
  doc.text(leagueName.toUpperCase(), 28, 12);

  doc.setFontSize(9.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(167, 243, 208); // Emerald-200
  doc.text('REPORTE OFICIAL DE RESULTADOS DE PARTIDOS Y ESTADÍSTICAS', 28, 18);

  // Meta info on top right
  const now = new Date();
  const dateFormatted = now.toLocaleDateString('es-MX', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  });
  const timeFormatted = now.toLocaleTimeString('es-MX', {
    hour: '2-digit',
    minute: '2-digit'
  });

  doc.setFontSize(8);
  doc.setTextColor(203, 213, 225); // Slate-300
  doc.text(`Fecha de Emisión: ${dateFormatted} ${timeFormatted}`, pageWidth - 14, 11, { align: 'right' });
  if (seasonName) {
    doc.text(`Temporada: ${seasonName}`, pageWidth - 14, 17, { align: 'right' });
  }

  // Filter Subheader Badges (Category & Jornada & Total Games)
  const yPos = 36;
  doc.setTextColor(30, 41, 59);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);

  const catLabel = categoryFilter === 'All' ? 'TODAS LAS CATEGORÍAS' : `CATEGORÍA: ${categoryFilter.toUpperCase()}`;
  const jorLabel = jornadaFilter === 'All' ? 'TODAS LAS JORNADAS' : `JORNADA ${jornadaFilter}`;
  const tourLabel = tournamentFilter === 'All' ? 'TODOS LOS TORNEOS' : `TORNEO: ${tournamentFilter}`;

  doc.text(`${catLabel}   |   ${jorLabel}   |   ${tourLabel}`, 14, yPos);

  const completedCount = filtered.filter(g => g.status === 'completed' || (g.score && (Number(g.score.away) > 0 || Number(g.score.home) > 0))).length;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(100, 116, 139);
  doc.text(`Partidos con Resultado: ${completedCount} de ${filtered.length}`, pageWidth - 14, yPos, { align: 'right' });

  // Prepare table data
  const tableRows = filtered.map((game, index) => {
    const homeTeam = teams.find(t => t.id === game.homeTeamId);
    const awayTeam = teams.find(t => t.id === game.awayTeamId);
    const cat = game.category || homeTeam?.category || awayTeam?.category || 'General';

    let dateStr = 'Fecha por definir';
    if (game.date) {
      try {
        const d = new Date(game.date);
        if (!isNaN(d.getTime())) {
          const rawDay = d.toLocaleDateString('es-MX', { weekday: 'short' });
          const dayUpper = rawDay.charAt(0).toUpperCase() + rawDay.slice(1);
          const dPart = d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' });
          const tPart = d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: true });
          dateStr = `${dayUpper} ${dPart} • ${tPart}`;
        }
      } catch (e) {
        // ignore
      }
    }

    const fieldStr = formatFieldName(game.field) || 'Campo Principal';
    const jorStr = game.jornada ? `Jornada ${game.jornada}` : 'Sin Jornada';

    // Scores
    const awayScore = game.score?.away ?? 0;
    const homeScore = game.score?.home ?? 0;
    const isCompleted = game.status === 'completed' || awayScore > 0 || homeScore > 0;

    const awayName = (game.awayTeamName || 'Visitante').toUpperCase();
    const homeName = (game.homeTeamName || 'Local').toUpperCase();

    let scoreFormatted = '';
    let winnerIndicator = '';
    if (isCompleted) {
      if (awayScore > homeScore) {
        winnerIndicator = `Ganador: ${awayName} (+${awayScore - homeScore})`;
      } else if (homeScore > awayScore) {
        winnerIndicator = `Ganador: ${homeName} (+${homeScore - awayScore})`;
      } else {
        winnerIndicator = 'Empate';
      }
      scoreFormatted = `${awayName}  ${awayScore}  -  ${homeScore}  ${homeName}\n${winnerIndicator}`;
    } else {
      scoreFormatted = `${awayName} vs ${homeName}\n(Pendiente de juego)`;
    }

    // Pitchers and HRs
    const winPitcher = game.winningPitcher || game.boxScore?.winningPitcher || '';
    const losePitcher = game.losingPitcher || game.boxScore?.losingPitcher || '';
    const savePitcher = game.savePitcher || game.boxScore?.savePitcher || '';
    const hrs = extractGameHomeRuns(game);

    const detailsLines: string[] = [];
    if (winPitcher && winPitcher !== 'Dato no disponible' && winPitcher !== 'null') {
      detailsLines.push(`PG (Ganador): ${winPitcher}`);
    } else if (winPitcher === 'Dato no disponible') {
      detailsLines.push(`PG: Dato no disponible en libro`);
    }

    if (losePitcher && losePitcher !== 'Dato no disponible' && losePitcher !== 'null') {
      detailsLines.push(`PP (Perdedor): ${losePitcher}`);
    } else if (losePitcher === 'Dato no disponible') {
      detailsLines.push(`PP: Dato no disponible en libro`);
    }

    if (savePitcher && savePitcher !== 'Dato no disponible' && savePitcher !== 'null') {
      detailsLines.push(`JS (Salvamento): ${savePitcher}`);
    }

    if (hrs.length > 0) {
      detailsLines.push(`HR (Jonrones): ${hrs.join(', ')}`);
    } else if (isCompleted) {
      detailsLines.push(`HR: Ninguno registrado`);
    }

    if (detailsLines.length === 0) {
      detailsLines.push(isCompleted ? 'Sin decisiones de pitcheo registradas' : 'Partido programado sin resultado');
    }

    const detailsStr = detailsLines.join('\n');

    return [
      String(index + 1),
      `${jorStr}\n${cat}`,
      `${dateStr}\n${fieldStr}`,
      awayName,
      String(awayScore),
      'vs',
      String(homeScore),
      homeName,
      detailsStr
    ];
  });

  const finalRows = tableRows.length > 0 ? tableRows : [
    ['-', '-', '-', '-', '-', 'No se encontraron resultados de partidos con los filtros seleccionados', '', '', '-']
  ];

  autoTable(doc, {
    startY: yPos + 4,
    head: [[
      '#',
      'Jornada / Cat.',
      'Fecha / Campo',
      'Equipo Visitante (1)',
      'C',
      '',
      'C',
      'Equipo Local (2)',
      'Pitcheo & Jonrones (PG / PP / HR)'
    ]],
    body: finalRows,
    theme: 'grid',
    headStyles: {
      fillColor: [5, 150, 105], // Emerald-600
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8.5,
      halign: 'center',
      valign: 'middle'
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252] // Slate-50
    },
    styles: {
      font: 'helvetica',
      fontSize: 8,
      cellPadding: 3,
      textColor: [30, 41, 59],
      lineColor: [226, 232, 240],
      lineWidth: 0.2,
      valign: 'middle'
    },
    margin: { left: 14, right: 14 },
    columnStyles: {
      0: { halign: 'center', cellWidth: 8 },
      1: { halign: 'center', cellWidth: 25, fontStyle: 'bold' },
      2: { halign: 'left', cellWidth: 36 },
      3: { halign: 'left', cellPadding: { left: 9.5, right: 2, top: 3, bottom: 3 }, fontStyle: 'bold', cellWidth: 36 },
      4: { halign: 'center', cellWidth: 9, fontStyle: 'bold', textColor: [5, 150, 105] },
      5: { halign: 'center', cellWidth: 6, textColor: [148, 163, 184] },
      6: { halign: 'center', cellWidth: 9, fontStyle: 'bold', textColor: [5, 150, 105] },
      7: { halign: 'left', cellPadding: { left: 9.5, right: 2, top: 3, bottom: 3 }, fontStyle: 'bold', cellWidth: 36 },
      8: { halign: 'left' }
    },
    didDrawCell: (data) => {
      if (data.section === 'body') {
        const game = filtered[data.row.index];
        if (!game) return;

        const logoSize = 5.5; // 5.5 mm logo badge

        // Column 3: Away Team Logo
        if (data.column.index === 3) {
          const logoPng = findLogoForTeam(game.awayTeamId, game.awayTeamName);
          const x = data.cell.x + 2;
          const y = data.cell.y + (data.cell.height - logoSize) / 2;

          if (logoPng) {
            try {
              doc.addImage(logoPng, 'PNG', x, y, logoSize, logoSize);
            } catch (e) {
              drawLetterFallback(doc, game.awayTeamName || 'Visitante', x, y, logoSize);
            }
          } else {
            drawLetterFallback(doc, game.awayTeamName || 'Visitante', x, y, logoSize);
          }
        }

        // Column 7: Home Team Logo
        if (data.column.index === 7) {
          const logoPng = findLogoForTeam(game.homeTeamId, game.homeTeamName);
          const x = data.cell.x + 2;
          const y = data.cell.y + (data.cell.height - logoSize) / 2;

          if (logoPng) {
            try {
              doc.addImage(logoPng, 'PNG', x, y, logoSize, logoSize);
            } catch (e) {
              drawLetterFallback(doc, game.homeTeamName || 'Local', x, y, logoSize);
            }
          } else {
            drawLetterFallback(doc, game.homeTeamName || 'Local', x, y, logoSize);
          }
        }
      }
    },
    didDrawPage: (data) => {
      // Footer on every page
      doc.setFillColor(248, 250, 252);
      doc.rect(0, pageHeight - 11, pageWidth, 11, 'F');

      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.3);
      doc.line(14, pageHeight - 11, pageWidth - 14, pageHeight - 11);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(148, 163, 184); // Slate-400
      doc.text(
        'Documento oficial generado por el Sistema de Anotación y Box Score de la Liga.',
        14,
        pageHeight - 4.5
      );

      const pageStr = `Página ${data.pageNumber}`;
      doc.text(pageStr, pageWidth - 14, pageHeight - 4.5, { align: 'right' });
    }
  });

  // Generate file name
  const cleanCat = categoryFilter === 'All' ? 'Todas_Categorias' : categoryFilter.replace(/[^a-zA-Z0-9]/g, '_');
  const cleanJor = jornadaFilter === 'All' ? 'Todas_Jornadas' : `Jornada_${jornadaFilter}`;
  const fileName = `Resultados_${cleanCat}_${cleanJor}.pdf`;

  // Download PDF
  doc.save(fileName);
  return fileName;
}
