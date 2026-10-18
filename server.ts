import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';
import * as XLSX from 'xlsx';
import dotenv from 'dotenv';

dotenv.config();

// Safe dirname resolution for both ESM (dev with tsx) and CJS (production bundle)
const getAppDirname = () => {
  try {
    if (typeof __dirname !== 'undefined' && __dirname) return __dirname;
    if (typeof import.meta !== 'undefined' && import.meta?.url) {
      return path.dirname(fileURLToPath(import.meta.url));
    }
  } catch {
    // fallback
  }
  return process.cwd();
};
const __dirname = getAppDirname();

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Middleware for parsing JSON with support for large image payloads
  app.use(express.json({ limit: '35mb' }));
  app.use(express.urlencoded({ extended: true, limit: '35mb' }));

  // Lazy initialization of Gemini AI Client
  let aiClient: GoogleGenAI | null = null;
  function getGenAI(): GoogleGenAI {
    if (!aiClient) {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error('GEMINI_API_KEY no está configurada.');
      }
      aiClient = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });
    }
    return aiClient;
  }

  // Health check route
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Analyze scorebook endpoint (Images, PDF, Excel) using Gemini with official roster reconciliation
  app.post('/api/analyze-scorebook', async (req, res) => {
    try {
      const { image, homeTeamName, awayTeamName, homeRoster, awayRoster, fileName, bookCategory = 'batting', targetTeamType } = req.body;
      if (!image) {
        return res.status(400).json({ success: false, error: 'Se requiere el archivo del libro de anotación (foto, PDF o Excel).' });
      }

      const ai = getGenAI();

      // Extract base64 data and mimeType
      let base64Data = image;
      let mimeType = 'image/jpeg';
      if (image.startsWith('data:')) {
        const parts = image.split(';base64,');
        mimeType = parts[0].replace('data:', '');
        base64Data = parts[1];
      }

      const isPdf = mimeType.includes('pdf') || fileName?.toLowerCase().endsWith('.pdf');
      const isExcel =
        mimeType.includes('spreadsheet') ||
        mimeType.includes('excel') ||
        fileName?.toLowerCase().endsWith('.xlsx') ||
        fileName?.toLowerCase().endsWith('.xls') ||
        fileName?.toLowerCase().endsWith('.csv');

      const formatRoster = (r: any[]) => {
        if (!r || !Array.isArray(r) || r.length === 0) return 'Sin jugadores registrados previamente en cédula.';
        return r.map((p, i) => `${i + 1}. "${p.name}" (Jersey #${p.number || '00'}, Pos: ${p.position || 'OF'}${p.notes ? `, Info: ${p.notes}` : ''})`).join('\n');
      };

      const isPitching = bookCategory === 'pitching';

      const prompt = isPitching
        ? `Actúa como el anotador oficial experto de béisbol de la liga.
Analiza con máxima precisión este documento de REGISTRO DE LANZAMIENTOS Y PITCHERS (conteo de lanzamientos, pitch count, entradas lanzadas y pitcheos por pitcher). Puede ser foto, PDF o tabla de Excel.

EQUIPOS DEL PARTIDO (BUSCA ALIAS Y APODOS DILIGENTEMENTE):
- Visitante: "${awayTeamName || 'Visitante'}"
- Local: "${homeTeamName || 'Local'}"
${targetTeamType ? `EQUIPO ENFOCADO EN ESTA HOJA: ${targetTeamType === 'home' ? homeTeamName : awayTeamName} (${targetTeamType === 'home' ? 'Local' : 'Visitante'})` : ''}

REGLA DE ORO DE NOMBRES DE EQUIPOS Y ALIAS:
Los anotadores de béisbol suelen escribir abreviaturas, apodos o ciudades en los libros:
- Cardenales: "cards", "cardinals", "cdls", "slc", "crd"
- Rangers: "texas", "txs", "tex", "rng"
- Atléticos: "oak", "oakland", "a's", "as", "athletics"
- Astros: "hou", "houston", "ast"
- Diablos: "diablos", "diab", "mex"
- Tigres: "tigres", "tig", "det"
- Sultanes: "sultanes", "sult", "mty"
- Tomateros: "tomateros", "tom", "cln"
- Naranjeros: "naranjeros", "nar", "her"
- Venados: "venados", "ven", "maz"
Identifica diligentemente cuál es el Visitante y cuál el Local comparando con los equipos oficiales del partido.

DATOS CLAVE A EXTRAER:
1. SCORE FINAL DEL JUEGO:
   - Extrae el marcador final completo (carreras totales del Visitante y Local) en finalScore: { awayScore, homeScore }.
2. PITCHER GANADOR:
   - Identifica con máxima precisión quién fue el pitcher ganador del partido (marcado como "W", "G", "PG", "Ganador", "Pitcher Ganador" o 1-0). Colócalo en winningPitcher: { name, playerNumber, teamType }.
   - Extrae también losingPitcher ("L", "P", "PP") y savePitcher ("SV", "JS") si aparecen.
3. NÚMERO DE LANZAMIENTOS (PITCH COUNT):
   - Extrae el número total de lanzamientos / pitcheos realizados por cada lanzador (pitches).

CÉDULA OFICIAL DE JUGADORES REGISTRADOS DEL EQUIPO VISITANTE (${awayTeamName || 'Visitante'} - ${awayRoster?.length || 0} jugadores):
${formatRoster(awayRoster)}

CÉDULA OFICIAL DE JUGADORES REGISTRADOS DEL EQUIPO LOCAL (${homeTeamName || 'Local'} - ${homeRoster?.length || 0} jugadores):
${formatRoster(homeRoster)}

REGLAS ESTRICTAS DE CONTEO DE LANZAMIENTOS:
1. Cruza cada lanzador con la cédula oficial de su equipo. Si no es legible: "Jugador no identificado".
2. Para cada lanzador: name, playerNumber, decision ("W", "L", "SV", "-"), ip ("5.0", "3.2"), pitches (entero >= 0), strikes, balls, h, r, er, bb, so, notes.
3. totalPitches debe ser la suma de lanzamientos de todos los lanzadores.
4. Devuelve los datos estrictamente en el esquema JSON configurado.`
        : `Actúa como el anotador oficial experto de béisbol de la liga.
Analiza con máxima precisión este documento de anotación (hoja o libro de anotación, scorebook, box score de bateo, acta de juego o rol). Puede ser una foto/imagen, documento PDF o tabla de Excel.

EQUIPOS DEL PARTIDO (BUSCA ALIAS Y APODOS DILIGENTEMENTE):
- Visitante: "${awayTeamName || 'Visitante'}"
- Local: "${homeTeamName || 'Local'}"
${targetTeamType ? `EQUIPO ENFOCADO EN ESTA HOJA: ${targetTeamType === 'home' ? homeTeamName : awayTeamName} (${targetTeamType === 'home' ? 'Local' : 'Visitante'})` : ''}

REGLA DE ORO DE NOMBRES DE EQUIPOS Y ALIAS:
Los anotadores de béisbol suelen escribir abreviaturas, apodos o ciudades en los libros:
- Cardenales: "cards", "cardinals", "cdls", "slc", "crd"
- Rangers: "texas", "txs", "tex", "rng"
- Atléticos: "oak", "oakland", "a's", "as", "athletics"
- Astros: "hou", "houston", "ast"
- Diablos: "diablos", "diab", "mex"
- Tigres: "tigres", "tig", "det"
- Sultanes: "sultanes", "sult", "mty"
- Tomateros: "tomateros", "tom", "cln"
- Naranjeros: "naranjeros", "nar", "her"
- Venados: "venados", "ven", "maz"
Identifica diligentemente cuál es el Visitante y cuál el Local comparando con los equipos oficiales del partido.

======================================================================
REGLA SUPREMA Y OBLIGATORIA: BUSCA ÚNICAMENTE LA PLUMA HASTA LA DERECHA
======================================================================
🚨 ATENCIÓN ANOTADOR: EN TODOS LOS LIBROS DE TODOS LOS EQUIPOS:
PARA CALCULAR LOS TURNOS AL BAT (AB) Y LOS HITS (H):
👉 DISCRIMINA LAS ENTRADAS DEL LIBRO Y SOLO BUSCA EL NOMBRE Y EL DATO ESCRITO EN PLUMA HASTA LA DERECHA DE CADA JUGADOR.
👉 TOMA LOS DATOS DE BATEO DE LA PARTE DERECHA DEL SCORE DE CADA JUGADOR. ESTÁ ESCRITO CON PLUMA, DICE POR EJEMPLO 2X0 QUE SIGNIFICA DOS TURNOS 0 HITS. TIENES QUE VER ESE DATO ESCRITO EN PLUMA Y SOLO TOMAR ESE.
👉 ¡SI NO ESTÁ ESCRITO CON PLUMA ENTONCES ESCRIBE "Dato no disponible" PERO NO INVENTES NÚMEROS!

1. PROHIBICIÓN TOTAL DE CONTAR DIAMANTES O ENTRADAS ("DISCRIMINA LAS ENTRADAS"):
   - ESTÁ ESTRICTAMENTE PROHIBIDO mirar, contar o sumar los recuadros de las entradas (1, 2, 3, 4, 5, 6, 7...) o los diamantes impresos para calcular o deducir AB o H.
   - NO deduzcas estos valores de las apariciones al plato ni de columnas intermedias.
   - El anotador oficial ya hizo el conteo oficial y lo escribió A MANO CON PLUMA en el margen derecho de cada fila (ejemplos: "2x0", "4x0", "3x0", "3x1", "4x0", "3x1", "1x0", "2x1", "2x0").

2. INTERPRETACIÓN ESTRICTA DE LA PLUMA (HASTA LA DERECHA):
   - Formatos "2x0", "3x1", "4-0", etc.:
     * AB (Turnos al Bat) = PRIMER número (antes de 'x' o '-')
     * H (Hits) = SEGUNDO número (después de 'x' o '-')
     * Ejemplo crucial en este libro: JORGE COTA tiene escrito con pluma hasta la derecha "2 X 0" (con 3BB abajo) => ab: 2, h: 0, battingLine: "2x0". ¡El primer número es claramente un 2 (NO un 4, NO un 5)!
     * BERNARDO PARTIDA: "4 X 0" => ab: 4, h: 0, battingLine: "4x0"
     * AXEL VALLES: "3 X 0" => ab: 3, h: 0, battingLine: "3x0"
     * MARCO FELIX: "3 X 1" => ab: 3, h: 1, battingLine: "3x1"
     * EZRA BETANCOURT: "4 X 0" => ab: 4, h: 0, battingLine: "4x0"
     * JORGE FIERROS: "3 X 1" => ab: 3, h: 1, battingLine: "3x1"
     * SANTY SANTOS: "1 X 0" => ab: 1, h: 0, battingLine: "1x0"
     * ISAAC GUERRERO: "3 X 0" => ab: 3, h: 0, battingLine: "3x0"
     * SEBAS MARQUEZ: "1 X 0" => ab: 1, h: 0, battingLine: "1x0"
     * TIAN VANEGAS: "3 X 1" => ab: 3, h: 1, battingLine: "3x1"
     * ALVARO QUIRO: "2 X 1" => ab: 2, h: 1, battingLine: "2x1"
     * EDUARDO MENDOZA: "2 X 0" => ab: 2, h: 0, battingLine: "2x0"

3. REGLA ESTRICTA SI NO ESTÁ ESCRITO CON PLUMA ("Dato no disponible"):
   - 👉 SI NO ESTÁ ESCRITO CON PLUMA EN EL MARGEN DERECHO O NO ESTÁ LEGIBLE:
     Escribe obligatoriamente en battingLine: "Dato no disponible", con ab: 0 y h: 0.
   - 👉 SI EL JUGADOR NO APARECE EN EL LIBRO (no jugó):
     Escribe en battingLine: "No jugó", order: 0, ab: 0, h: 0.
   - ¡NO INVENTES NÚMEROS! Solo toma lo que esté escrito en pluma hasta la derecha.

4. DETECCIÓN DE JONRONES (HR / JONRÓN)
   - Revisa minuciosamente todo el libro de anotación para identificar las marcas "HR", "H.R." o la palabra "jonrón" / "cuadrangular", aunque aparezcan fuera de la anotación numérica del jugador (por ejemplo en el recuadro de la entrada donde bateó, en notas al pie o junto a su nombre).
   - Cuando encuentres alguna de estas marcas:
     * Registra el jonrón para el jugador correspondiente en el campo "hr" (1 o más) y refléjalo en "extraNotes": "HR".
     * Asegúrate de que el jonrón esté contado dentro de sus hits (H) totales, ya que todo jonrón es un hit.
     * No confundas un jonrón con cualquier otro hit (1B o 2B).
     * ¡NO inventes jonrones cuando la marca no aparezca en el documento!

5. IDENTIFICACIÓN DEL PITCHER GANADOR
   - Busca en el libro de anotación cualquier indicación clara del pitcher ganador (marcado como "PG", "Pitcher Ganador", "Ganador", "W", "G", o récord 1-0 en las notas).
   - Registra el nombre del pitcher ganador en winningPitcher y relaciónalo con el equipo ganador correcto.
   - ¡NO selecciones automáticamente al pitcher que aparece al final del documento ni al que tenga más ponches!
   - Si no existe una indicación clara del pitcher ganador, NO lo inventes. Deja winningPitcher como null.

5. REGISTRO DEL MARCADOR FINAL
   - Identifica el escore final del encuentro utilizando las anotaciones del libro (en la pizarra de entradas, pie de hoja o suma de carreras de ambos equipos).
   - Registra las carreras finales de ambos equipos en finalScore: { awayScore, homeScore }.
   - Verifica que los equipos y el marcador correspondan al partido correcto.

6. NÚMERO DE LANZAMIENTOS (PITCH COUNT EN HOJA DE BATEO):
   - Si en esta hoja de bateo aparecen lanzadores o conteo de lanzamientos (pitcheos, lanzamientos) en la parte inferior o resumen de pitcheo, extráelos en la lista "pitchers" con su nombre y número total de lanzamientos (pitches).

CÉDULA OFICIAL DE JUGADORES REGISTRADOS DEL EQUIPO VISITANTE (${awayTeamName || 'Visitante'} - ${awayRoster?.length || 0} jugadores):
${formatRoster(awayRoster)}

CÉDULA OFICIAL DE JUGADORES REGISTRADOS DEL EQUIPO LOCAL (${homeTeamName || 'Local'} - ${homeRoster?.length || 0} jugadores):
${formatRoster(homeRoster)}

REGLAS ESTRICTAS DE ASIGNACIÓN:
1. Cruza cada bateador con la cédula oficial de su equipo. Si en el libro aparece un nombre abreviado (ej. "Carlos C.", "Jorge C."), vincúlalo al jugador oficial correspondiente. Si es ilegible: "Jugador no identificado".
2. DEBEN APARECER TODOS LOS JUGADORES DE LA CÉDULA:
   - Jugadores que jugaron: order (1, 2, 3...), playerNumber, name, position, battingLine ("de 4-2" o "de 2-0"), ab (turnos), r (carreras), h (hits), rbi, bb, so, hr (0 o más), avg, extraNotes.
   - Jugadores que NO jugaron: order: 0, battingLine: "No jugó", ab: 0, r: 0, h: 0, rbi: 0, bb: 0, so: 0, hr: 0, avg: ".000", extraNotes: "No jugó".
3. ORDEN: Titulares y cambios primero (order 1, 2, 3...) y al final "No jugó" (order 0).
4. TOTALES: ab, r, h, rbi, bb, so, hr son la suma de quienes jugaron.
5. Devuelve los datos estrictamente en el esquema JSON configurado.`;

      let contents: any[] = [];

      if (isExcel) {
        try {
          const buffer = Buffer.from(base64Data, 'base64');
          const workbook = XLSX.read(buffer, { type: 'buffer' });
          let extractedText = '';
          for (const sheetName of workbook.SheetNames) {
            const sheet = workbook.Sheets[sheetName];
            const csv = XLSX.utils.sheet_to_csv(sheet);
            extractedText += `\n=== HOJA DE EXCEL: "${sheetName}" ===\n${csv}\n`;
          }
          contents = [{ text: `${prompt}\n\nCONTENIDO EXTRAÍDO DEL ARCHIVO EXCEL DEL LIBRO:\n${extractedText}` }];
        } catch (excelErr) {
          console.warn('Error reading Excel for scorebook, falling back to inlineData:', excelErr);
        }
      }

      if (contents.length === 0) {
        contents = [
          {
            inlineData: {
              data: base64Data,
              mimeType: isPdf ? 'application/pdf' : (mimeType || 'image/jpeg'),
            },
          },
          { text: prompt },
        ];
      }

      const battingResponseSchema = {
        type: Type.OBJECT,
        properties: {
          finalScore: {
            type: Type.OBJECT,
            description: "Score final del partido según las anotaciones del libro",
            properties: {
              awayScore: { type: Type.INTEGER, description: "Carreras totales del equipo visitante" },
              homeScore: { type: Type.INTEGER, description: "Carreras totales del equipo local" }
            }
          },
          winningPitcher: {
            type: Type.OBJECT,
            description: "Pitcher ganador del partido si está explícitamente indicado (PG / W / Ganador)",
            properties: {
              name: { type: Type.STRING, description: "Nombre del pitcher ganador" },
              playerNumber: { type: Type.STRING, description: "Número de camiseta" },
              teamType: { type: Type.STRING, description: "'away' o 'home'" }
            }
          },
          losingPitcher: {
            type: Type.OBJECT,
            description: "Pitcher perdedor (L / P / PP)",
            properties: {
              name: { type: Type.STRING },
              teamType: { type: Type.STRING }
            }
          },
          savePitcher: {
            type: Type.OBJECT,
            description: "Pitcher con salvamento (SV / JS)",
            properties: {
              name: { type: Type.STRING },
              teamType: { type: Type.STRING }
            }
          },
          pitchers: {
            type: Type.ARRAY,
            description: "Lanzadores y número de lanzamientos anotados en la hoja de bateo (resumen de pitcheo)",
            items: {
              type: Type.OBJECT,
              properties: {
                playerNumber: { type: Type.STRING },
                name: { type: Type.STRING },
                teamType: { type: Type.STRING },
                decision: { type: Type.STRING },
                ip: { type: Type.STRING },
                pitches: { type: Type.INTEGER, description: "Número total de lanzamientos" },
                strikes: { type: Type.INTEGER },
                balls: { type: Type.INTEGER },
                h: { type: Type.INTEGER },
                r: { type: Type.INTEGER },
                er: { type: Type.INTEGER },
                bb: { type: Type.INTEGER },
                so: { type: Type.INTEGER }
              },
              required: ["name", "pitches"]
            }
          },
          teams: {
            type: Type.ARRAY,
            description: "Equipos y estadísticas detectadas en la hoja de anotación",
            items: {
              type: Type.OBJECT,
              properties: {
                teamName: { type: Type.STRING, description: "Nombre del equipo detectado o asociado" },
                teamType: { type: Type.STRING, description: "'away' (visitante) o 'home' (local)" },
                batters: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      order: { type: Type.INTEGER, description: "Orden al bat (1, 2, 3... o 0 si no jugó)" },
                      playerNumber: { type: Type.STRING, description: "Número de camiseta" },
                      name: { type: Type.STRING, description: "Nombre exacto del jugador en la cédula" },
                      position: { type: Type.STRING, description: "Posición defensiva (ej. SS, 1B, CF, P)" },
                      battingLine: { type: Type.STRING, description: "Anotación escrita con pluma en el margen derecho, ej: '2x0', '2-0', '4x0', 'Dato no disponible', 'No jugó'. Si no está en pluma o no se lee, escribe 'Dato no disponible'. BUSCA EXCLUSIVAMENTE LA PLUMA HASTA LA DERECHA." },
                      ab: { type: Type.INTEGER, description: "Turnos al bat (AB) - PRIMER número de la pluma (en '2x0' es 2). 0 si es 'Dato no disponible', 'No legible' o 'No jugó'. PROHIBIDO contar diamantes o entradas." },
                      r: { type: Type.INTEGER, description: "Carreras anotadas (R)" },
                      h: { type: Type.INTEGER, description: "Hits conectados (H) - SEGUNDO número de la pluma (en '2x0' es 0). 0 si es 'Dato no disponible', 'No legible' o 'No jugó'. PROHIBIDO contar diamantes o entradas." },
                      rbi: { type: Type.INTEGER, description: "Carreras impulsadas (RBI)" },
                      bb: { type: Type.INTEGER, description: "Bases por bola (BB)" },
                      so: { type: Type.INTEGER, description: "Ponches (SO / K)" },
                      hr: { type: Type.INTEGER, description: "Jonrones (HR) conectados (1, 2... o 0 si ninguno)" },
                      avg: { type: Type.STRING, description: "Promedio de bateo individual H / AB, ej: '.500', '.000'" },
                      extraNotes: { type: Type.STRING, description: "Notas adicionales como 'HR', '2B', o 'No jugó'" }
                    },
                    required: ["name", "battingLine", "ab", "r", "h", "rbi", "bb", "so"]
                  }
                },
                totals: {
                  type: Type.OBJECT,
                  properties: {
                    ab: { type: Type.INTEGER, description: "Total turnos al bat del equipo" },
                    r: { type: Type.INTEGER, description: "Total carreras del equipo" },
                    h: { type: Type.INTEGER, description: "Total hits del equipo" },
                    rbi: { type: Type.INTEGER, description: "Total impulsadas del equipo" },
                    bb: { type: Type.INTEGER, description: "Total bases por bolas" },
                    so: { type: Type.INTEGER, description: "Total ponches" },
                    hr: { type: Type.INTEGER, description: "Total jonrones del equipo" },
                    avg: { type: Type.STRING, description: "Promedio de bateo colectivo (ej. '.333')" }
                  },
                  required: ["ab", "r", "h", "rbi", "bb", "so"]
                },
                notes: { type: Type.STRING, description: "Notas específicas del equipo o lanzador" }
              },
              required: ["teamName", "batters", "totals"]
            }
          },
          generalNotes: { type: Type.STRING, description: "Observaciones del anotador sobre el libro" }
        },
        required: ["teams"]
      };

      const pitchingResponseSchema = {
        type: Type.OBJECT,
        properties: {
          finalScore: {
            type: Type.OBJECT,
            description: "Score final del partido si aparece en la hoja",
            properties: {
              awayScore: { type: Type.INTEGER, description: "Carreras del equipo visitante" },
              homeScore: { type: Type.INTEGER, description: "Carreras del equipo local" }
            }
          },
          winningPitcher: {
            type: Type.OBJECT,
            description: "Pitcher ganador del partido (W / G / PG)",
            properties: {
              name: { type: Type.STRING, description: "Nombre del pitcher ganador" },
              playerNumber: { type: Type.STRING, description: "Número de camiseta" },
              teamType: { type: Type.STRING, description: "'away' o 'home'" }
            }
          },
          losingPitcher: {
            type: Type.OBJECT,
            description: "Pitcher perdedor (L / P / PP)",
            properties: {
              name: { type: Type.STRING },
              teamType: { type: Type.STRING }
            }
          },
          savePitcher: {
            type: Type.OBJECT,
            description: "Pitcher con salvamento (SV / JS)",
            properties: {
              name: { type: Type.STRING },
              teamType: { type: Type.STRING }
            }
          },
          teams: {
            type: Type.ARRAY,
            description: "Equipos y conteo de lanzamientos de lanzadores",
            items: {
              type: Type.OBJECT,
              properties: {
                teamName: { type: Type.STRING, description: "Nombre del equipo" },
                teamType: { type: Type.STRING, description: "'away' o 'home'" },
                totalPitches: { type: Type.INTEGER, description: "Total de lanzamientos del equipo" },
                pitchers: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      playerNumber: { type: Type.STRING, description: "Número de camiseta (#) o '-'" },
                      name: { type: Type.STRING, description: "Nombre exacto del lanzador o 'Jugador no identificado'" },
                      decision: { type: Type.STRING, description: "'W', 'L', 'SV', 'H', o '-'" },
                      ip: { type: Type.STRING, description: "Entradas lanzadas ej. '5.0', '3.1'" },
                      pitches: { type: Type.INTEGER, description: "Número total de lanzamientos realizados" },
                      strikes: { type: Type.INTEGER, description: "Strikes lanzados" },
                      balls: { type: Type.INTEGER, description: "Bolas lanzadas" },
                      h: { type: Type.INTEGER, description: "Hits permitidos" },
                      r: { type: Type.INTEGER, description: "Carreras permitidas" },
                      er: { type: Type.INTEGER, description: "Carreras limpias permitidas" },
                      bb: { type: Type.INTEGER, description: "Bases por bolas otorgadas" },
                      so: { type: Type.INTEGER, description: "Ponches recetados" },
                      notes: { type: Type.STRING, description: "Notas adicionales o descanso" }
                    },
                    required: ["name", "ip", "pitches", "h", "r", "er", "bb", "so"]
                  }
                },
                notes: { type: Type.STRING }
              },
              required: ["teamName", "pitchers", "totalPitches"]
            }
          },
          generalNotes: { type: Type.STRING }
        },
        required: ["teams"]
      };

      const responseSchema = isPitching ? pitchingResponseSchema : battingResponseSchema;

      // Resilient model fallback list
      const MODELS_TO_TRY = ['gemini-2.5-flash', 'gemini-flash-latest', 'gemini-3.8-flash', 'gemini-3.1-flash-lite'];
      let lastError: any = null;
      let parsedData: any = null;

      for (const currentModel of MODELS_TO_TRY) {
        try {
          console.log(`Intentando analizar libro con modelo: ${currentModel}...`);
          const response = await ai.models.generateContent({
            model: currentModel,
            contents: contents,
            config: {
              responseMimeType: "application/json",
              responseSchema: responseSchema,
              temperature: 0.1,
            },
          });

          const rawText = response.text || "{}";
          parsedData = JSON.parse(rawText);
          console.log(`Análisis de libro completado exitosamente con ${currentModel}`);
          break;
        } catch (err: any) {
          lastError = err;
          console.warn(`Error analizando libro con modelo ${currentModel}: ${err?.message || err}`);

          const isHighDemandOrQuota =
            err?.message?.includes('503') ||
            err?.message?.includes('UNAVAILABLE') ||
            err?.message?.includes('high demand') ||
            err?.message?.includes('429') ||
            err?.message?.includes('RESOURCE_EXHAUSTED');

          if (isHighDemandOrQuota) {
            await new Promise((resolve) => setTimeout(resolve, 1200));
          }
        }
      }

      if (!parsedData || !parsedData.teams) {
        const errorMsg = lastError?.message || '';
        const isTemporarySpike =
          errorMsg.includes('503') ||
          errorMsg.includes('UNAVAILABLE') ||
          errorMsg.includes('high demand') ||
          errorMsg.includes('temporarily');

        const userFriendlyMessage = isTemporarySpike
          ? 'El servicio de IA experimenta alta demanda en este momento. Por favor presiona "Reintentar" en unos segundos.'
          : (errorMsg || 'No fue posible digitalizar el libro de anotación.');

        return res.status(503).json({
          success: false,
          error: userFriendlyMessage,
          isHighDemand: isTemporarySpike,
        });
      }

      // STRICT PROGRAMMATIC RECONCILIATION:
      // Guarantee that 100% of official roster players appear in the Box Score.
      // Use EXCLUSIVELY official names, mark absent as "No jugó" / 0.
      const norm = (s: string) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

      const SERVER_TEAM_ALIASES: Record<string, string[]> = {
        cardenales: ['cards', 'cardinals', 'cdls', 'crd', 'slc'],
        cardinals: ['cards', 'cardenales', 'cdls', 'crd', 'slc'],
        rangers: ['texas', 'txs', 'tex', 'rng', 'tejas'],
        texas: ['rangers', 'txs', 'tex', 'rng'],
        atleticos: ['oak', 'oakland', 'as', "a's", 'athletics'],
        athletics: ['oak', 'oakland', 'as', "a's", 'atleticos'],
        astros: ['hou', 'houston', 'ast'],
        houston: ['astros', 'hou', 'ast'],
        yankees: ['nyy', 'ny', 'yank'],
        dodgers: ['lad', 'la', 'dodg'],
        redsox: ['bos', 'boston', 'sox'],
        whitesox: ['cws', 'chicago'],
        cubs: ['chc', 'cachorros'],
        cachorros: ['chc', 'cubs'],
        braves: ['atl', 'atlanta', 'bravos'],
        bravos: ['atl', 'atlanta', 'braves'],
        giants: ['sf', 'san francisco', 'gigantes'],
        gigantes: ['sf', 'san francisco', 'giants'],
        padres: ['sd', 'san diego'],
        phillies: ['phi', 'filadelfia', 'filis'],
        mets: ['nym'],
        bluejays: ['tor', 'toronto', 'jays'],
        orioles: ['bal', 'baltimore'],
        rays: ['tb', 'tampa'],
        marlins: ['mia', 'miami'],
        pirates: ['pit', 'pittsburgh', 'piratas'],
        piratas: ['pit', 'pittsburgh', 'pirates'],
        reds: ['cin', 'cincinnati', 'rojos'],
        rojos: ['cin', 'cincinnati', 'reds'],
        brewers: ['mil', 'milwaukee', 'cerveceros'],
        cerveceros: ['mil', 'milwaukee', 'brewers'],
        royals: ['kc', 'kansas'],
        tigers: ['det', 'detroit', 'tigres'],
        tigres: ['det', 'detroit', 'tigers'],
        twins: ['min', 'minnesota', 'mellizos'],
        mellizos: ['min', 'minnesota', 'twins'],
        guardians: ['cle', 'cleveland', 'indios'],
        indios: ['cle', 'cleveland', 'guardians'],
        mariners: ['sea', 'seattle', 'marineros'],
        marineros: ['sea', 'seattle', 'mariners'],
        angels: ['laa', 'angelinos'],
        angelinos: ['laa', 'angels'],
        diamondbacks: ['ari', 'arizona', 'dbacks'],
        rockies: ['col', 'colorado'],
        nationals: ['wsh', 'washington', 'nacionales'],
        nacionales: ['wsh', 'washington', 'nationals'],
        diablos: ['diablos rojos', 'mex', 'mexico', 'diab'],
        sultanes: ['sultanes de monterrey', 'mty', 'monterrey', 'sult'],
        tomateros: ['cln', 'culiacan', 'tom'],
        naranjeros: ['her', 'hermosillo', 'nar'],
        venados: ['maz', 'mazatlan', 'ven'],
        yaquis: ['obr', 'obregon', 'yaq'],
        caneros: ['lm', 'los mochis', 'mochis', 'can'],
        mayos: ['nav', 'navojoa', 'may'],
        charros: ['gdl', 'jalisco', 'guadalajara', 'char'],
        algodoneros: ['gsv', 'guasave', 'alg'],
        toros: ['tij', 'tijuana', 'tor'],
        acereros: ['mva', 'monclova', 'ace'],
      };

      const matchTeam = (extractedName: string, officialName: string): boolean => {
        if (!extractedName || !officialName) return false;
        const ext = norm(extractedName).replace(/[^a-z0-9]/g, '');
        const off = norm(officialName).replace(/[^a-z0-9]/g, '');
        if (!ext || !off) return false;
        if (ext === off || ext.includes(off) || off.includes(ext)) return true;
        for (const [key, aliases] of Object.entries(SERVER_TEAM_ALIASES)) {
          const k = norm(key).replace(/[^a-z0-9]/g, '');
          const isOffMatch = off.includes(k) || aliases.some(a => off.includes(norm(a).replace(/[^a-z0-9]/g, '')));
          if (isOffMatch) {
            if (ext.includes(k) || k.includes(ext)) return true;
            if (aliases.some(a => {
              const an = norm(a).replace(/[^a-z0-9]/g, '');
              return ext === an || ext.includes(an) || an.includes(ext);
            })) return true;
          }
        }
        return false;
      };

      // Ensure both teams are present in parsedData.teams
      let teamsList = parsedData.teams || [];
      const hasAway = teamsList.some((t: any) => t.teamType === 'away' || matchTeam(t.teamName, awayTeamName));
      const hasHome = teamsList.some((t: any) => t.teamType === 'home' || matchTeam(t.teamName, homeTeamName));

      if (!hasAway && awayTeamName) {
        teamsList.unshift({ teamName: awayTeamName, teamType: 'away', batters: [], totals: { ab: 0, r: 0, h: 0, rbi: 0, bb: 0, so: 0, avg: '.000' } });
      }
      if (!hasHome && homeTeamName) {
        teamsList.push({ teamName: homeTeamName, teamType: 'home', batters: [], totals: { ab: 0, r: 0, h: 0, rbi: 0, bb: 0, so: 0, avg: '.000' } });
      }

      // Helper function to remove undefined from JSON response
      const cleanObject = (obj: any): any => {
        if (obj === undefined) return null;
        if (obj === null || typeof obj !== 'object') return obj;
        if (Array.isArray(obj)) return obj.map(cleanObject);
        const res: Record<string, any> = {};
        for (const [k, v] of Object.entries(obj)) {
          if (v !== undefined) res[k] = cleanObject(v);
        }
        return res;
      };

      if (isPitching) {
        parsedData.teams = teamsList.map((teamData: any, idx: number) => {
          const isHome = teamData.teamType === 'home' || matchTeam(teamData.teamName, homeTeamName) || (!teamData.teamType && idx === 1);
          const officialRoster: any[] = isHome ? (homeRoster || []) : (awayRoster || []);
          const officialTeamName = isHome ? (homeTeamName || teamData.teamName || 'Local') : (awayTeamName || teamData.teamName || 'Visitante');

          const reconciledPitchers: any[] = [];
          for (const p of (teamData.pitchers || [])) {
            const rawName = String(p.name || '').trim();
            const isIllegible = !rawName || rawName.toLowerCase().includes('ilegible') || rawName.toLowerCase().includes('desconocido') || rawName === '?' || rawName === '-';
            const pNorm = norm(rawName);

            let matchedOfficial: any = undefined;
            if (!isIllegible && officialRoster && officialRoster.length > 0) {
              matchedOfficial = officialRoster.find((op: any) => {
                const opNorm = norm(op.name);
                if (opNorm === pNorm) return true;
                const opParts = opNorm.split(' ').filter((pt: string) => pt.length >= 3);
                if (opParts.some((pt: string) => pNorm.includes(pt))) return true;
                if (p.playerNumber && op.number && String(p.playerNumber).replace('#', '').trim() === String(op.number).replace('#', '').trim()) {
                  if (pNorm[0] === opNorm[0]) return true;
                }
                return false;
              });
            }

            const finalName = matchedOfficial ? matchedOfficial.name : (isIllegible ? 'Jugador no identificado' : rawName);
            const jersey = String(matchedOfficial?.number || p.playerNumber || '-').trim() || '-';
            const pitchesCount = Number.isFinite(Number(p.pitches)) ? Math.max(0, Number(p.pitches)) : 0;

            reconciledPitchers.push({
              playerNumber: jersey,
              name: finalName,
              decision: String(p.decision || '-').trim() || '-',
              ip: String(p.ip || '0.0').trim() || '0.0',
              pitches: pitchesCount,
              strikes: Number.isFinite(Number(p.strikes)) ? Math.max(0, Number(p.strikes)) : 0,
              balls: Number.isFinite(Number(p.balls)) ? Math.max(0, Number(p.balls)) : 0,
              h: Number.isFinite(Number(p.h)) ? Math.max(0, Number(p.h)) : 0,
              r: Number.isFinite(Number(p.r)) ? Math.max(0, Number(p.r)) : 0,
              er: Number.isFinite(Number(p.er)) ? Math.max(0, Number(p.er)) : 0,
              bb: Number.isFinite(Number(p.bb)) ? Math.max(0, Number(p.bb)) : 0,
              so: Number.isFinite(Number(p.so)) ? Math.max(0, Number(p.so)) : 0,
              notes: String(p.notes || '').trim(),
            });
          }

          const totalPitches = reconciledPitchers.reduce((acc, p) => acc + (p.pitches || 0), 0);

          return {
            teamName: officialTeamName,
            teamType: isHome ? 'home' : 'away',
            pitchers: reconciledPitchers,
            totalPitches,
            notes: String(teamData.notes || '').trim(),
          };
        });

        // Detect winning pitcher if not already populated
        if (!parsedData.winningPitcher?.name) {
          for (const t of (parsedData.teams || [])) {
            const wp = t.pitchers?.find((p: any) => ['W', 'G', 'PG'].includes(String(p.decision || '').toUpperCase().trim()));
            if (wp && wp.name && !wp.name.toLowerCase().includes('no ident')) {
              parsedData.winningPitcher = {
                name: wp.name,
                playerNumber: wp.playerNumber,
                teamType: t.teamType,
              };
              break;
            }
          }
        }

        return res.json({
          success: true,
          category: 'pitching',
          data: cleanObject(parsedData),
        });
      }

      parsedData.teams = teamsList.map((teamData: any, idx: number) => {
        const isHome = teamData.teamType === 'home' || matchTeam(teamData.teamName, homeTeamName) || (!teamData.teamType && idx === 1);
        const officialRoster: any[] = isHome ? (homeRoster || []) : (awayRoster || []);
        const officialTeamName = isHome ? (homeTeamName || teamData.teamName || 'Local') : (awayTeamName || teamData.teamName || 'Visitante');

        const matchedOfficialIds = new Set<string>();
        const reconciledBatters: any[] = [];

        // 1. Process detected batters from scorebook
        for (const aiBatter of (teamData.batters || [])) {
          const rawName = String(aiBatter.name || '').trim();
          const isIllegibleName =
            !rawName ||
            rawName.toLowerCase().includes('ilegible') ||
            rawName.toLowerCase().includes('desconocido') ||
            rawName.toLowerCase().includes('no legible') ||
            rawName === '?' ||
            rawName === '-';

          const aiBatterNorm = norm(rawName);

          let matchedOfficial: any = undefined;
          if (!isIllegibleName && officialRoster && officialRoster.length > 0) {
            matchedOfficial = officialRoster.find((op: any) => {
              if (matchedOfficialIds.has(op.id || op.name)) return false;
              const opNorm = norm(op.name);
              if (opNorm === aiBatterNorm) return true;
              const opParts = opNorm.split(' ').filter((p: string) => p.length >= 3);
              const aiParts = aiBatterNorm.split(' ').filter((p: string) => p.length >= 3);
              if (opParts.some((p: string) => aiBatterNorm.includes(p))) return true;
              if (aiParts.some((p: string) => opNorm.includes(p))) return true;
              if (aiBatter.playerNumber && op.number && String(aiBatter.playerNumber).replace('#','').trim() === String(op.number).replace('#','').trim()) {
                if (aiBatterNorm[0] === opNorm[0]) return true;
              }
              return false;
            });
          }

          // 1. Process pen notation (e.g. "2-0", "2x0", "4-2", "3x1", "de 4-2")
          const rawLine = String(aiBatter.battingLine || '').trim();
          const rawNotes = String(aiBatter.extraNotes || '').trim();
          const combinedNotation = `${rawLine} ${rawNotes}`.trim();
          const penRegex = /(?:de\s+)?(\d+)\s*(?:[xX\-\/\*:\.]|por|a)\s*(\d+)/i;
          const penMatch = rawNotes.match(penRegex) || rawLine.match(penRegex) || combinedNotation.match(penRegex);

          const isNotAvailable =
            rawLine.toLowerCase().includes('dato no disponible') ||
            rawLine.toLowerCase().includes('no disponible') ||
            rawNotes.toLowerCase().includes('dato no disponible') ||
            rawNotes.toLowerCase().includes('no disponible');

          const isNoLegible =
            rawLine.toLowerCase().includes('no legible') ||
            rawLine.toLowerCase().includes('ilegible') ||
            rawNotes.toLowerCase().includes('no legible') ||
            rawNotes.toLowerCase().includes('ilegible') ||
            isNotAvailable;

          let abVal = Number.isFinite(Number(aiBatter.ab)) ? Math.max(0, Number(aiBatter.ab)) : 0;
          let hVal = Number.isFinite(Number(aiBatter.h)) ? Math.max(0, Number(aiBatter.h)) : 0;

          if (isNoLegible) {
            abVal = 0;
            hVal = 0;
          } else if (penMatch) {
            // First number = AB (turnos al bate), Second number = H (hits)
            const penAb = parseInt(penMatch[1], 10);
            const penH = parseInt(penMatch[2], 10);
            if (!isNaN(penAb)) abVal = penAb;
            if (!isNaN(penH)) hVal = penH;
          }

          // Safety guard: Hits cannot mathematically exceed At-Bats
          if (hVal > abVal) {
            const temp = abVal;
            abVal = hVal;
            hVal = temp;
          }

          // HR Detection (from explicit hr field, notes, or notation)
          const hasHrText = /(\bhr\b|\bjonron\b|\bjonrón\b|\bcuadrangular\b)/i.test(combinedNotation);
          let hrVal = Number(aiBatter.hr) > 0 ? Number(aiBatter.hr) : (hasHrText ? 1 : 0);
          if (hrVal > 0) {
            hVal = Math.max(hVal, hrVal);
            abVal = Math.max(abVal, hVal);
          }

          const isDnp =
            rawLine.toLowerCase().includes('no jug') ||
            rawNotes.toLowerCase().includes('no jug') ||
            (abVal === 0 && hVal === 0 && (rawLine === 'No jugó' || rawLine === '-' || rawLine === ''));

          let finalBattingLine = 'No jugó';
          if (!isDnp) {
            if (isNotAvailable) {
              finalBattingLine = 'Dato no disponible';
            } else if (isNoLegible) {
              finalBattingLine = 'No legible';
            } else if (rawLine.includes('x') || rawLine.includes('X')) {
              finalBattingLine = `${abVal}x${hVal}`;
            } else {
              finalBattingLine = `de ${abVal}-${hVal}`;
            }
          }
          const batterAvg = (!isDnp && !isNoLegible && abVal > 0) ? (hVal / abVal).toFixed(3).replace(/^0/, '') : '.000';

          let notesClean = rawNotes;
          if (hrVal > 0 && !notesClean.toUpperCase().includes('HR') && !notesClean.toUpperCase().includes('JONRON')) {
            notesClean = notesClean ? `${notesClean}, HR` : 'HR';
          }
          if (isDnp) notesClean = 'No jugó';

          if (matchedOfficial) {
            matchedOfficialIds.add(matchedOfficial.id || matchedOfficial.name);
            const jersey = String(matchedOfficial.number || aiBatter.playerNumber || '-').trim() || '-';
            const pos = String(aiBatter.position || matchedOfficial.position || '-').trim() || '-';

            reconciledBatters.push({
              order: isDnp ? 0 : (Number(aiBatter.order) || reconciledBatters.length + 1),
              playerNumber: jersey,
              name: matchedOfficial.name,
              position: pos,
              battingLine: finalBattingLine,
              ab: isDnp ? 0 : abVal,
              r: isDnp ? 0 : (Number(aiBatter.r) || 0),
              h: isDnp ? 0 : hVal,
              rbi: isDnp ? 0 : (Number(aiBatter.rbi) || 0),
              bb: isDnp ? 0 : (Number(aiBatter.bb) || 0),
              so: isDnp ? 0 : (Number(aiBatter.so) || 0),
              hr: isDnp ? 0 : hrVal,
              avg: batterAvg,
              extraNotes: notesClean,
            });
          } else {
            // Unmatched / illegible batter
            const batterName = isIllegibleName ? 'Jugador no identificado' : rawName;
            const jersey = String(aiBatter.playerNumber || '-').trim() || '-';
            const pos = String(aiBatter.position || '-').trim() || '-';

            reconciledBatters.push({
              order: isDnp ? 0 : (Number(aiBatter.order) || reconciledBatters.length + 1),
              playerNumber: jersey,
              name: batterName,
              position: pos,
              battingLine: finalBattingLine,
              ab: isDnp ? 0 : abVal,
              r: isDnp ? 0 : (Number(aiBatter.r) || 0),
              h: isDnp ? 0 : hVal,
              rbi: isDnp ? 0 : (Number(aiBatter.rbi) || 0),
              bb: isDnp ? 0 : (Number(aiBatter.bb) || 0),
              so: isDnp ? 0 : (Number(aiBatter.so) || 0),
              hr: isDnp ? 0 : hrVal,
              avg: batterAvg,
              extraNotes: notesClean,
            });
          }
        }

        // 2. Add remaining official cédula players as "No jugó" / 0
        if (officialRoster && officialRoster.length > 0) {
          for (const op of officialRoster) {
            if (!matchedOfficialIds.has(op.id || op.name)) {
              reconciledBatters.push({
                order: 0,
                playerNumber: String(op.number || '-').trim() || '-',
                name: op.name,
                position: String(op.position || '-').trim() || '-',
                battingLine: 'No jugó',
                ab: 0,
                r: 0,
                h: 0,
                rbi: 0,
                bb: 0,
                so: 0,
                hr: 0,
                avg: '.000',
                extraNotes: 'No jugó',
              });
            }
          }
        }

        // 3. Sort: players who played first, then unplayed
        reconciledBatters.sort((a, b) => {
          if (a.order > 0 && b.order > 0) return a.order - b.order;
          if (a.order > 0) return -1;
          if (b.order > 0) return 1;
          return a.name.localeCompare(b.name);
        });

        // 4. Calculate team totals from active players
        const playingBatters = reconciledBatters.filter(b => b.battingLine !== 'No jugó');
        const abTotal = playingBatters.reduce((acc, b) => acc + (b.ab || 0), 0);
        const rTotal = playingBatters.reduce((acc, b) => acc + (b.r || 0), 0);
        const hTotal = playingBatters.reduce((acc, b) => acc + (b.h || 0), 0);
        const rbiTotal = playingBatters.reduce((acc, b) => acc + (b.rbi || 0), 0);
        const bbTotal = playingBatters.reduce((acc, b) => acc + (b.bb || 0), 0);
        const soTotal = playingBatters.reduce((acc, b) => acc + (b.so || 0), 0);
        const hrTotal = playingBatters.reduce((acc, b) => acc + (b.hr || 0), 0);
        const avg = abTotal > 0 ? (hTotal / abTotal).toFixed(3).replace(/^0/, '') : '.000';

        return {
          teamName: officialTeamName,
          teamType: isHome ? 'home' : 'away',
          batters: reconciledBatters,
          totals: {
            ab: abTotal,
            r: rTotal,
            h: hTotal,
            rbi: rbiTotal,
            bb: bbTotal,
            so: soTotal,
            hr: hrTotal,
            avg,
          },
          notes: String(teamData.notes || '').trim(),
        };
      });

      // Calculate finalScore if not explicitly present
      if (!parsedData.finalScore && parsedData.teams?.length >= 2) {
        const awayT = parsedData.teams.find((t: any) => t.teamType === 'away');
        const homeT = parsedData.teams.find((t: any) => t.teamType === 'home');
        if (awayT && homeT && (awayT.totals?.r > 0 || homeT.totals?.r > 0)) {
          parsedData.finalScore = {
            awayScore: awayT.totals?.r ?? 0,
            homeScore: homeT.totals?.r ?? 0,
          };
        }
      }

      // Check for winning pitcher from pitchers list if available
      if (!parsedData.winningPitcher?.name && Array.isArray(parsedData.pitchers)) {
        const wp = parsedData.pitchers.find((p: any) => ['W', 'G', 'PG'].includes(String(p.decision || '').toUpperCase().trim()));
        if (wp && wp.name && !wp.name.toLowerCase().includes('no ident')) {
          parsedData.winningPitcher = {
            name: wp.name,
            playerNumber: wp.playerNumber,
            teamType: wp.teamType,
          };
        }
      }

      // Clean up winning pitcher if invalid or generic
      if (parsedData.winningPitcher?.name) {
        const wpRaw = String(parsedData.winningPitcher.name).trim();
        if (
          !wpRaw ||
          wpRaw === '-' ||
          wpRaw === '?' ||
          wpRaw.toLowerCase().includes('no ident') ||
          wpRaw.toLowerCase().includes('desconocido') ||
          wpRaw.toLowerCase().includes('ilegible')
        ) {
          parsedData.winningPitcher = null;
        }
      }

      return res.json({
        success: true,
        data: cleanObject(parsedData),
      });
    } catch (err: any) {
      console.error("Error analyzing scorebook:", err);
      return res.status(500).json({
        success: false,
        error: err.message || "Error al procesar el libro de anotación con Gemini.",
      });
    }
  });

  // Analyze schedule Excel content using Gemini with fallback models
  app.post('/api/analyze-schedule-excel', async (req, res) => {
    try {
      const { sheets, registeredTeams, categories } = req.body;
      if (!sheets || !Array.isArray(sheets) || sheets.length === 0) {
        return res.status(400).json({ success: false, error: 'Se requiere el contenido de las hojas del archivo Excel.' });
      }

      const ai = getGenAI();

      const sheetsText = sheets
        .map((s: any) => `=== HOJA: "${s.name}" ===\n${s.content}\n`)
        .join('\n\n');

      const prompt = `Actúa como un coordinador experto de roles de béisbol infantil y juvenil.
Tu tarea es analizar el siguiente texto extraído de las hojas de cálculo de un archivo de Excel con el Rol de Juegos de la liga.
Extrae TODOS los partidos programados organizados por jornada.

Lista de categorías válidas en la liga:
${(categories || ['Zapetita', 'Biberon', 'Escuelita', 'Pewee', 'Infantil', 'Pony', 'Colt']).join(', ')}

Equipos ya registrados en el sistema (referencia):
${(registeredTeams || []).slice(0, 50).join(', ')}

Reglas de extracción:
1. 'jornada': número entero de la jornada a la que pertenece el partido (ej. 1, 2, 3, etc.). Si está en un encabezado como 'Jornada 1', 'J1', 'Semana 1', 'Fecha 1', 'Ronda 1', asigna ese número a todos los partidos de esa sección. Si no se menciona ningún número, usa 1.
2. 'category': una de las categorías de la liga ('Zapetita', 'Biberon', 'Escuelita', 'Pewee', 'Infantil', 'Pony', 'Colt'). Infiérela por el nombre de la hoja, encabezado o por los equipos.
3. 'homeTeamName': nombre del equipo local (Home / Local / Equipo 1 / Casa). Limpia prefijos como números o guiones.
4. 'awayTeamName': nombre del equipo visitante (Away / Visitante / Equipo 2 / Visita).
5. 'field': nombre del campo donde se juega (ej. 'Campo Infantil 1', 'Campo del Valle', 'Campo Municipal', etc.). Si no está indicado, coloca 'Campo Principal'.
6. 'date': fecha del partido en formato YYYY-MM-DD. Si el texto tiene formato como '04/10/2026', '4-Oct', o día de la semana, conviértelo a YYYY-MM-DD. Si no hay fecha, usa fechas de fines de semana próximos.
7. 'time': hora del juego en formato HH:MM de 24 horas (ej. '08:00', '11:30', '15:00'). Si no se indica, usa '08:00'.
8. 'tournament': tipo de torneo ('Regular', 'Semana Santa', 'Verano'), por defecto 'Regular'.

CONTENIDO DE LAS HOJAS DE EXCEL:
${sheetsText}

Devuelve TODOS los partidos encontrados sin omitir ninguno.`;

      const scheduleResponseSchema = {
        type: Type.OBJECT,
        properties: {
          games: {
            type: Type.ARRAY,
            description: "Lista completa de partidos programados extraídos del rol",
            items: {
              type: Type.OBJECT,
              properties: {
                jornada: { type: Type.INTEGER, description: "Número de jornada (1, 2, 3...)" },
                category: { type: Type.STRING, description: "Categoría oficial del partido" },
                homeTeamName: { type: Type.STRING, description: "Nombre del equipo local" },
                awayTeamName: { type: Type.STRING, description: "Nombre del equipo visitante" },
                field: { type: Type.STRING, description: "Campo asignado" },
                date: { type: Type.STRING, description: "Fecha en formato YYYY-MM-DD" },
                time: { type: Type.STRING, description: "Hora en formato HH:MM" },
                tournament: { type: Type.STRING, description: "Torneo (Regular, Semana Santa, Verano)" }
              },
              required: ["jornada", "homeTeamName", "awayTeamName"]
            }
          }
        },
        required: ["games"]
      };

      const MODELS_TO_TRY = ['gemini-2.5-flash', 'gemini-flash-latest', 'gemini-3.8-flash', 'gemini-3.1-flash-lite'];
      let lastError: any = null;
      let parsedData: any = null;

      for (const currentModel of MODELS_TO_TRY) {
        try {
          console.log(`Intentando analizar rol de juegos con modelo: ${currentModel}...`);
          const response = await ai.models.generateContent({
            model: currentModel,
            contents: [
              {
                text: prompt,
              },
            ],
            config: {
              responseMimeType: "application/json",
              responseSchema: scheduleResponseSchema,
              temperature: 0.1,
            },
          });

          const rawText = response.text || "{}";
          parsedData = JSON.parse(rawText);
          console.log(`Análisis de rol completado exitosamente con ${currentModel}`);
          break;
        } catch (err: any) {
          lastError = err;
          console.warn(`Error analizando rol con ${currentModel}: ${err?.message || err}`);

          const isHighDemandOrQuota =
            err?.message?.includes('503') ||
            err?.message?.includes('UNAVAILABLE') ||
            err?.message?.includes('high demand') ||
            err?.message?.includes('429') ||
            err?.message?.includes('RESOURCE_EXHAUSTED');

          if (isHighDemandOrQuota) {
            await new Promise((resolve) => setTimeout(resolve, 1200));
          }
        }
      }

      if (!parsedData || !parsedData.games) {
        return res.status(503).json({
          success: false,
          error: lastError?.message || 'No fue posible extraer partidos del archivo Excel.',
        });
      }

      return res.json({
        success: true,
        data: parsedData,
      });
    } catch (err: any) {
      console.error("Error analyzing schedule Excel:", err);
      return res.status(500).json({
        success: false,
        error: err.message || "Error al procesar el rol de juegos con Gemini.",
      });
    }
  });

  // Extract players roster from cedula (images, PDF, Excel, text)
  app.post('/api/extract-cedula', async (req, res) => {
    try {
      const { fileBase64, mimeType, fileName, targetTeamName, textContent } = req.body;
      if (!fileBase64 && !textContent) {
        return res.status(400).json({ success: false, error: 'Se requiere el archivo de la cédula o texto del documento.' });
      }

      const ai = getGenAI();
      const MODELS_TO_TRY = ['gemini-2.5-flash', 'gemini-flash-latest', 'gemini-3.8-flash', 'gemini-3.1-flash-lite'];

      const cedulaResponseSchema = {
        type: Type.OBJECT,
        properties: {
          teamNameDetected: { type: Type.STRING, description: 'Nombre del equipo detectado en la cédula si está indicado' },
          categoryDetected: { type: Type.STRING, description: 'Categoría detectada si está indicada' },
          managerName: { type: Type.STRING, description: 'Nombre del manager, entrenador o delegado si está indicado' },
          players: {
            type: Type.ARRAY,
            description: 'Lista de jugadores extraídos de la cédula',
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING, description: 'Nombre y apellido completo del jugador' },
                number: { type: Type.STRING, description: 'Número de uniforme/jersey (#) si está disponible, o "00"' },
                position: { type: Type.STRING, description: 'Posición defensiva (P, C, 1B, 2B, 3B, SS, LF, CF, RF, DH, OF)' },
                notes: { type: Type.STRING, description: 'Notas opcionales (edad, CURP, etc.)' }
              },
              required: ['name']
            }
          }
        },
        required: ['players']
      };

      const prompt = `Actúa como un experto oficial de béisbol analizando una cédula de inscripción, cédula de juego o roster de equipo.
${targetTeamName ? `El usuario está subiendo la cédula para el equipo: "${targetTeamName}".` : ''}

Extrae con la máxima fidelidad TODOS los jugadores que aparezcan en el documento (ya sea foto, escaneo, PDF, texto mecanografiado, escrito a mano o tabla de Excel).

Reglas de extracción:
1. 'name': Nombre completo del jugador (Nombres y Apellidos). Pon mayúsculas y minúsculas correctas (ej. "Carlos Mario Castros", "Dylan Alvarez"). Omite filas de firmas, encabezados, o nombres de managers/entrenadores a menos que aparezcan explícitamente en la lista de jugadores.
2. 'number': Número de casaca o playera (#). Si no viene número asignado o está en blanco, usa "00".
3. 'position': Posición de béisbol (P, C, 1B, 2B, 3B, SS, LF, CF, RF, DH, OF). Si no se indica explícitamente, asigna una posición estándar como 'OF' o 'P'.
4. 'teamNameDetected': Si el documento indica el nombre del equipo en el título o membrete (ej. "Angels", "Cardenales", "Potros"), extráelo.
5. 'categoryDetected': Si se menciona categoría (Colt, Pony, Infantil, etc.), extráela.
6. 'managerName': Nombre del manager o mánager/coach si viene indicado en el documento.

Devuelve TODOS los jugadores de la cédula en el esquema JSON configurado.`;

      let contents: any[] = [];

      if (textContent) {
        contents = [{ text: `${prompt}\n\nCONTENIDO DEL DOCUMENTO/HOJA DE CÉDULA:\n${textContent}` }];
      } else if (fileBase64) {
        let cleanBase64 = fileBase64;
        let actualMime = mimeType || 'image/jpeg';
        if (cleanBase64.startsWith('data:')) {
          const parts = cleanBase64.split(';base64,');
          actualMime = parts[0].replace('data:', '');
          cleanBase64 = parts[1];
        }

        const isExcel =
          actualMime.includes('spreadsheet') ||
          actualMime.includes('excel') ||
          fileName?.toLowerCase().endsWith('.xlsx') ||
          fileName?.toLowerCase().endsWith('.xls') ||
          fileName?.toLowerCase().endsWith('.csv');

        if (isExcel) {
          try {
            const buffer = Buffer.from(cleanBase64, 'base64');
            const workbook = XLSX.read(buffer, { type: 'buffer' });
            let extractedText = '';
            for (const sheetName of workbook.SheetNames) {
              const sheet = workbook.Sheets[sheetName];
              const csv = XLSX.utils.sheet_to_csv(sheet);
              extractedText += `\n=== HOJA: "${sheetName}" ===\n${csv}\n`;
            }
            contents = [{ text: `${prompt}\n\nTEXTO EXTRAÍDO DEL ARCHIVO EXCEL DE LA CÉDULA:\n${extractedText}` }];
          } catch (xlsxErr) {
            console.warn('Error parsing excel buffer in extract-cedula:', xlsxErr);
          }
        }

        if (contents.length === 0) {
          contents = [
            {
              inlineData: {
                data: cleanBase64,
                mimeType: actualMime,
              },
            },
            { text: prompt },
          ];
        }
      }

      let parsedData: any = null;
      let lastError: any = null;

      for (const currentModel of MODELS_TO_TRY) {
        try {
          console.log(`Intentando extraer cédula con modelo: ${currentModel}...`);
          const response = await ai.models.generateContent({
            model: currentModel,
            contents: contents,
            config: {
              responseMimeType: 'application/json',
              responseSchema: cedulaResponseSchema,
              temperature: 0.1,
            },
          });

          const rawText = response.text || "{}";
          parsedData = JSON.parse(rawText);
          console.log(`Extracción de cédula exitosa con ${currentModel}. Jugadores detectados: ${parsedData?.players?.length || 0}`);
          break;
        } catch (err: any) {
          lastError = err;
          console.warn(`Error extrayendo cédula con ${currentModel}: ${err?.message || err}`);
          const isHighDemandOrQuota =
            err?.message?.includes('503') ||
            err?.message?.includes('UNAVAILABLE') ||
            err?.message?.includes('high demand') ||
            err?.message?.includes('429') ||
            err?.message?.includes('RESOURCE_EXHAUSTED');

          if (isHighDemandOrQuota) {
            await new Promise((resolve) => setTimeout(resolve, 1200));
          }
        }
      }

      if (!parsedData || !parsedData.players) {
        return res.status(503).json({
          success: false,
          error: lastError?.message || 'No fue posible extraer los jugadores de la cédula proporcionada.',
        });
      }

      return res.json({
        success: true,
        data: parsedData,
      });
    } catch (err: any) {
      console.error('Error in /api/extract-cedula:', err);
      return res.status(500).json({
        success: false,
        error: err.message || 'Error al procesar la cédula con Gemini.',
      });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
