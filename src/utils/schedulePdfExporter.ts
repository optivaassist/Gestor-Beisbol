import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Game, Team, Category, TournamentType, formatFieldName } from '../types';

export interface GenerateSchedulePdfOptions {
  games: Game[];
  teams: Team[];
  selectedCategory: Category | 'Todas' | 'All';
  selectedJornada: number | 'Todas' | 'All';
  selectedTournament?: TournamentType | 'Todos' | 'All';
  filterStatus?: 'all' | 'assigned' | 'pending';
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
    // 3 second timeout guard to avoid hanging PDF generation
    const timer = setTimeout(() => {
      resolve(src.startsWith('data:image/png') ? src : null);
    }, 3000);

    const img = new Image();
    // Do NOT set crossOrigin for data: URLs because that can trigger security origin errors in browsers!
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

        // Calculate aspect ratio fit inside circle
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

        // Subtle circular border matching app theme
        ctx.beginPath();
        ctx.arc(TARGET_SIZE / 2, TARGET_SIZE / 2, (TARGET_SIZE / 2) - 4, 0, Math.PI * 2);
        ctx.strokeStyle = '#94A3B8'; // Slate-400
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

/**
 * Draws a neat circular fallback with the team's initial letter in the PDF table.
 */
function drawLetterFallback(doc: jsPDF, name: string, x: number, y: number, size: number) {
  const initial = (name || '?').trim().charAt(0).toUpperCase();
  const radius = size / 2;
  const cx = x + radius;
  const cy = y + radius;

  // Circle background
  doc.setFillColor(238, 242, 255); // Indigo-50
  doc.setDrawColor(165, 180, 252); // Indigo-300
  doc.setLineWidth(0.2);
  doc.circle(cx, cy, radius, 'FD');

  // Initial letter
  doc.setTextColor(79, 70, 229); // Indigo-600
  doc.setFontSize(size * 1.35);
  doc.setFont('helvetica', 'bold');
  doc.text(initial, cx, cy + 0.45, { align: 'center', baseline: 'middle' });
}

export async function generateSchedulePDF({
  games,
  teams,
  selectedCategory,
  selectedJornada,
  selectedTournament = 'All',
  filterStatus = 'all',
  seasonName,
  leagueName = 'Liga de Béisbol Infantil y Juvenil'
}: GenerateSchedulePdfOptions): Promise<jsPDF> {
  // Normalize filters
  const categoryFilter = selectedCategory === 'Todas' || selectedCategory === 'All' ? 'All' : selectedCategory;
  const jornadaFilter = selectedJornada === 'Todas' || selectedJornada === 'All' ? 'All' : selectedJornada;
  const tournamentFilter = selectedTournament === 'Todos' || selectedTournament === 'All' ? 'All' : selectedTournament;

  // Filter games
  const filtered = games.filter(g => {
    const homeTeam = teams.find(t => t.id === g.homeTeamId);
    const awayTeam = teams.find(t => t.id === g.awayTeamId);
    const gameCat = g.category || homeTeam?.category || awayTeam?.category;

    const catMatch = categoryFilter === 'All' || gameCat === categoryFilter;
    const tourMatch = tournamentFilter === 'All' || g.tournament === tournamentFilter || (!g.tournament && tournamentFilter === 'Regular');
    const jorMatch = jornadaFilter === 'All' || Number(g.jornada) === Number(jornadaFilter);

    let statusMatch = true;
    if (filterStatus === 'assigned') {
      statusMatch = Boolean(g.field && g.date && !g.field.toLowerCase().includes('por definir'));
    } else if (filterStatus === 'pending') {
      statusMatch = !g.field || g.field.toLowerCase().includes('por definir');
    }

    return catMatch && tourMatch && jorMatch && statusMatch;
  });

  // Sort games: by Jornada, then by Date, then by Field
  filtered.sort((a, b) => {
    const jorA = Number(a.jornada || 999);
    const jorB = Number(b.jornada || 999);
    if (jorA !== jorB) return jorA - jorB;

    const timeA = a.date ? new Date(a.date).getTime() : 0;
    const timeB = b.date ? new Date(b.date).getTime() : 0;
    if (timeA !== timeB) return timeA - timeB;

    return (a.field || '').localeCompare(b.field || '');
  });

  // Pre-load all team logos as PNG Data URLs
  const teamPngLogos = new Map<string, string>();
  await Promise.all(
    teams.map(async (team) => {
      if (team.logoUrl) {
        const png = await ensurePngDataUrl(team.logoUrl);
        if (png) {
          if (team.id) {
            teamPngLogos.set(team.id, png);
          }
          if (team.name) {
            teamPngLogos.set(team.name.trim().toLowerCase(), png);
            teamPngLogos.set(normalizeStr(team.name), png);
          }
        }
      }
    })
  );

  // Helper to find pre-rendered logo by team ID or team Name
  const findLogoForTeam = (teamId?: string, teamName?: string): string | undefined => {
    if (teamId && teamPngLogos.has(teamId)) {
      return teamPngLogos.get(teamId);
    }
    if (teamName) {
      const lower = teamName.trim().toLowerCase();
      if (teamPngLogos.has(lower)) return teamPngLogos.get(lower);
      const norm = normalizeStr(teamName);
      if (teamPngLogos.has(norm)) return teamPngLogos.get(norm);

      // Search in teams array for match
      const matched = teams.find(t =>
        (t.id && t.id === teamId) ||
        normalizeStr(t.name) === norm ||
        norm.includes(normalizeStr(t.name)) ||
        normalizeStr(t.name).includes(norm)
      );
      if (matched) {
        if (matched.id && teamPngLogos.has(matched.id)) return teamPngLogos.get(matched.id);
        if (matched.name && teamPngLogos.has(matched.name.trim().toLowerCase())) {
          return teamPngLogos.get(matched.name.trim().toLowerCase());
        }
      }
    }
    return undefined;
  };

  // Create document in Landscape orientation for clear table readability
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4'
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  // Header Banner (Dark Slate)
  doc.setFillColor(30, 41, 59); // Slate-800
  doc.rect(0, 0, pageWidth, 28, 'F');

  // Decorative Accent Line (Indigo)
  doc.setFillColor(79, 70, 229); // Indigo-600
  doc.rect(0, 28, pageWidth, 2.5, 'F');

  // Decorative Baseball Icon / Badge in Header
  doc.setFillColor(79, 70, 229);
  doc.circle(18, 14, 6.5, 'F');
  doc.setFillColor(255, 255, 255);
  doc.circle(18, 14, 5.5, 'F');
  doc.setTextColor(79, 70, 229);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.text('⚾', 18, 14.5, { align: 'center', baseline: 'middle' });

  // League Title & Header Text
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(15);
  doc.setFont('helvetica', 'bold');
  doc.text(leagueName.toUpperCase(), 28, 12);

  doc.setFontSize(9.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(199, 210, 254); // Indigo-200
  doc.text('ROL OFICIAL DE JUEGOS Y PROGRAMACIÓN DE ENCUENTROS', 28, 18);

  // Meta box on top right
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
  doc.text(`Emisión: ${dateFormatted} ${timeFormatted}`, pageWidth - 14, 11, { align: 'right' });
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

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(100, 116, 139);
  doc.text(`Total de partidos: ${filtered.length}`, pageWidth - 14, yPos, { align: 'right' });

  // Prepare table data
  const tableRows = filtered.map((game, index) => {
    const homeTeam = teams.find(t => t.id === game.homeTeamId);
    const awayTeam = teams.find(t => t.id === game.awayTeamId);
    const cat = game.category || homeTeam?.category || awayTeam?.category || 'General';

    let dayStr = '-';
    let dateStr = 'Por definir';
    let timeStr = 'Por definir';

    if (game.date) {
      try {
        const d = new Date(game.date);
        if (!isNaN(d.getTime())) {
          const rawDay = d.toLocaleDateString('es-MX', { weekday: 'long' });
          dayStr = rawDay.charAt(0).toUpperCase() + rawDay.slice(1);
          dateStr = d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
          timeStr = d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: true });
        }
      } catch (e) {
        // ignore
      }
    }

    const fieldStr = formatFieldName(game.field) || 'Por definir';
    const jorStr = game.jornada ? `J${game.jornada}` : '-';

    let statusStr = 'Programado';
    if (game.status === 'in-progress') {
      statusStr = `En Vivo (${game.score?.away ?? 0} - ${game.score?.home ?? 0})`;
    } else if (game.status === 'completed') {
      statusStr = `Final (${game.score?.away ?? 0} - ${game.score?.home ?? 0})`;
    }

    return [
      String(index + 1),
      jorStr,
      cat,
      `${dayStr} ${dateStr}`,
      timeStr,
      fieldStr,
      game.awayTeamName || 'Visitante',
      'vs',
      game.homeTeamName || 'Local',
      statusStr
    ];
  });

  // If no games found, display message in table
  const finalRows = tableRows.length > 0 ? tableRows : [
    ['-', '-', '-', '-', '-', '-', 'No se encontraron partidos programados con los filtros seleccionados', '', '', '-']
  ];

  autoTable(doc, {
    startY: yPos + 4,
    head: [[
      '#',
      'Jor.',
      'Categoría',
      'Día y Fecha',
      'Hora',
      'Campo',
      'Equipo Visitante (1)',
      '',
      'Equipo Local (2)',
      'Estado / Marcador'
    ]],
    body: finalRows,
    theme: 'grid',
    headStyles: {
      fillColor: [79, 70, 229], // Indigo-600
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
      cellPadding: 2.5,
      textColor: [30, 41, 59],
      lineColor: [226, 232, 240],
      lineWidth: 0.2,
      valign: 'middle'
    },
    columnStyles: {
      0: { halign: 'center', cellWidth: 9 },
      1: { halign: 'center', cellWidth: 12, fontStyle: 'bold' },
      2: { halign: 'center', cellWidth: 23, fontStyle: 'bold' },
      3: { halign: 'left', cellWidth: 35 },
      4: { halign: 'center', cellWidth: 21, fontStyle: 'bold' },
      5: { halign: 'left', cellWidth: 35 },
      6: { halign: 'left', cellPadding: { left: 9.5, right: 2, top: 2.5, bottom: 2.5 }, fontStyle: 'bold' },
      7: { halign: 'center', cellWidth: 8, textColor: [100, 116, 139] },
      8: { halign: 'left', cellPadding: { left: 9.5, right: 2, top: 2.5, bottom: 2.5 }, fontStyle: 'bold' },
      9: { halign: 'center', cellWidth: 28 }
    },
    didDrawCell: (data) => {
      if (data.section === 'body') {
        const game = filtered[data.row.index];
        if (!game) return;

        const logoSize = 5.5; // 5.5 mm logo badge

        // Column 6: Away Team Logo
        if (data.column.index === 6) {
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

        // Column 8: Home Team Logo
        if (data.column.index === 8) {
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
      const pageCount = doc.getNumberOfPages();
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(148, 163, 184); // Slate-400

      // Left footer
      doc.text(
        `* Nota: El equipo local y visitante se decide en el terreno de juego. Favor de presentarse 15 minutos antes de la hora programada.`,
        14,
        pageHeight - 6
      );

      // Right footer
      doc.text(
        `Página ${data.pageNumber} de ${pageCount}`,
        pageWidth - 14,
        pageHeight - 6,
        { align: 'right' }
      );
    }
  });

  return doc;
}

export async function downloadSchedulePDF(options: GenerateSchedulePdfOptions): Promise<string> {
  const doc = await generateSchedulePDF(options);

  const cleanCat = options.selectedCategory === 'Todas' || options.selectedCategory === 'All'
    ? 'Todas_Categorias'
    : String(options.selectedCategory).replace(/\s+/g, '_');

  const cleanJor = options.selectedJornada === 'Todas' || options.selectedJornada === 'All'
    ? 'Todas_Jornadas'
    : `Jornada_${options.selectedJornada}`;

  const fileName = `Rol_de_Juegos_${cleanCat}_${cleanJor}.pdf`;
  doc.save(fileName);
  return fileName;
}
