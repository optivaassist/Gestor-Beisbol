import React, { useState, useRef, useEffect } from 'react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { collection, getDocs, query, where, writeBatch, doc } from 'firebase/firestore';
import { Team, Player, BASEBALL_POSITIONS } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Upload, 
  FileText, 
  Image as ImageIcon, 
  FileSpreadsheet, 
  Check, 
  AlertCircle, 
  X, 
  Plus, 
  Trash2, 
  Loader2, 
  Sparkles, 
  Users, 
  ArrowRight, 
  CheckCircle2, 
  Shield 
} from 'lucide-react';
import * as XLSX from 'xlsx';

interface CedulaUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  teams: Team[];
  initialTeamId?: string | null;
  onSaveSuccess: (teamId: string, count: number, teamName: string) => void;
}

interface ExtractedPlayerDraft {
  id: string;
  name: string;
  number: string;
  position: string;
  notes?: string;
}

export default function CedulaUploadModal({
  isOpen,
  onClose,
  teams,
  initialTeamId,
  onSaveSuccess,
}: CedulaUploadModalProps) {
  const [selectedTeamId, setSelectedTeamId] = useState<string>(initialTeamId || (teams[0]?.id || ''));
  const [file, setFile] = useState<File | null>(null);
  const [filePreviewUrl, setFilePreviewUrl] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<'upload' | 'review'>('upload');
  
  // Extracted data
  const [detectedTeamName, setDetectedTeamName] = useState<string | null>(null);
  const [detectedCategory, setDetectedCategory] = useState<string | null>(null);
  const [detectedManager, setDetectedManager] = useState<string | null>(null);
  const [extractedPlayers, setExtractedPlayers] = useState<ExtractedPlayerDraft[]>([]);
  const [saveMode, setSaveMode] = useState<'append' | 'replace'>('append');

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (initialTeamId) {
      setSelectedTeamId(initialTeamId);
    } else if (teams.length > 0 && !selectedTeamId) {
      setSelectedTeamId(teams[0].id);
    }
  }, [initialTeamId, teams]);

  useEffect(() => {
    if (!isOpen) {
      // Reset state on close
      setFile(null);
      setFilePreviewUrl(null);
      setIsAnalyzing(false);
      setIsSaving(false);
      setError(null);
      setStep('upload');
      setExtractedPlayers([]);
      setDetectedTeamName(null);
      setDetectedCategory(null);
      setDetectedManager(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const currentTeam = teams.find(t => t.id === selectedTeamId) || teams[0];

  const handleFileSelect = (selectedFile: File) => {
    setError(null);
    setFile(selectedFile);

    if (selectedFile.type.startsWith('image/')) {
      const url = URL.createObjectURL(selectedFile);
      setFilePreviewUrl(url);
    } else {
      setFilePreviewUrl(null);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile) {
      handleFileSelect(droppedFile);
    }
  };

  const handleAnalyzeCedula = async () => {
    if (!file) {
      setError('Por favor selecciona un archivo de cédula (foto, PDF, Excel o documento).');
      return;
    }

    setIsAnalyzing(true);
    setError(null);

    try {
      const fileName = file.name;
      const mimeType = file.type || 'application/octet-stream';
      let fileBase64 = '';
      let textContent: string | null = null;

      // Check if Excel / CSV client-side extraction can be pre-processed
      const isExcelOrCsv = 
        fileName.toLowerCase().endsWith('.xlsx') || 
        fileName.toLowerCase().endsWith('.xls') || 
        fileName.toLowerCase().endsWith('.csv') ||
        mimeType.includes('spreadsheet') ||
        mimeType.includes('excel');

      if (isExcelOrCsv) {
        try {
          const arrayBuffer = await file.arrayBuffer();
          const workbook = XLSX.read(arrayBuffer, { type: 'array' });
          let fullText = '';
          for (const sheetName of workbook.SheetNames) {
            const sheet = workbook.Sheets[sheetName];
            const csv = XLSX.utils.sheet_to_csv(sheet);
            fullText += `\n=== HOJA: "${sheetName}" ===\n${csv}\n`;
          }
          if (fullText.trim()) {
            textContent = fullText;
          }
        } catch (excelErr) {
          console.warn('Error extracting text directly from Excel, falling back to base64:', excelErr);
        }
      }

      // Convert to base64 if not sending pure textContent
      if (!textContent) {
        fileBase64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.readAsDataURL(file);
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = (err) => reject(err);
        });
      }

      const response = await fetch('/api/extract-cedula', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileBase64,
          mimeType,
          fileName,
          targetTeamName: currentTeam?.name || '',
          textContent,
        }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'No se pudo procesar la cédula.');
      }

      const data = result.data;
      const rawPlayers = data.players || [];

      if (rawPlayers.length === 0) {
        throw new Error('No se detectaron jugadores en el archivo subido. Asegúrate de que los nombres sean legibles.');
      }

      const drafts: ExtractedPlayerDraft[] = rawPlayers.map((p: any, idx: number) => ({
        id: `draft-${Date.now()}-${idx}`,
        name: (p.name || '').trim(),
        number: p.number ? String(p.number).replace(/[^0-9]/g, '') || '00' : '00',
        position: BASEBALL_POSITIONS.includes(p.position) ? p.position : 'OF',
        notes: p.notes || '',
      })).filter((p: ExtractedPlayerDraft) => p.name.length > 0);

      setExtractedPlayers(drafts);
      setDetectedTeamName(data.teamNameDetected || null);
      setDetectedCategory(data.categoryDetected || null);
      setDetectedManager(data.managerName || null);

      // If a team name was detected and matches one of the teams in our list, auto-select it if user hasn't explicitly chosen
      if (data.teamNameDetected) {
        const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
        const detectedNorm = norm(data.teamNameDetected);
        const matched = teams.find(t => norm(t.name) === detectedNorm || norm(t.name).includes(detectedNorm) || detectedNorm.includes(norm(t.name)));
        if (matched) {
          setSelectedTeamId(matched.id);
        }
      }

      setStep('review');
    } catch (err: any) {
      console.error('Error extracting cedula:', err);
      setError(err.message || 'Error al procesar el archivo de la cédula.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleUpdatePlayerDraft = (id: string, updates: Partial<ExtractedPlayerDraft>) => {
    setExtractedPlayers(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
  };

  const handleDeletePlayerDraft = (id: string) => {
    setExtractedPlayers(prev => prev.filter(p => p.id !== id));
  };

  const handleAddManualRow = () => {
    const newPlayer: ExtractedPlayerDraft = {
      id: `draft-manual-${Date.now()}`,
      name: '',
      number: '00',
      position: 'OF',
    };
    setExtractedPlayers(prev => [...prev, newPlayer]);
  };

  const handleSaveToTeamRoster = async () => {
    if (!selectedTeamId) {
      setError('Por favor selecciona el equipo al cual asignar los jugadores.');
      return;
    }

    const validPlayers = extractedPlayers.filter(p => p.name.trim().length > 0);
    if (validPlayers.length === 0) {
      setError('Debes tener al menos un jugador con nombre válido.');
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const batch = writeBatch(db);
      const playersCol = collection(db, 'players');

      // Fetch existing players for this team to either delete or prevent duplicates
      const existingSnap = await getDocs(query(playersCol, where('teamId', '==', selectedTeamId)));
      const existingPlayers = existingSnap.docs.map(d => ({ id: d.id, ...d.data() } as Player));

      if (saveMode === 'replace') {
        // Delete all existing players for this team
        existingSnap.docs.forEach(docSnap => {
          batch.delete(docSnap.ref);
        });
      }

      const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
      let addedCount = 0;

      for (const draft of validPlayers) {
        const cleanName = draft.name.trim();
        const cleanNumber = draft.number.trim() || '00';
        const cleanPosition = draft.position || 'OF';

        // If in append mode, check if player already exists by name
        if (saveMode === 'append') {
          const alreadyExists = existingPlayers.some(ep => norm(ep.name) === norm(cleanName));
          if (alreadyExists) {
            continue; // Skip duplicate
          }
        }

        const newPlayerDocRef = doc(playersCol);
        batch.set(newPlayerDocRef, {
          name: cleanName,
          number: cleanNumber,
          teamId: selectedTeamId,
          position: cleanPosition,
          notes: draft.notes || '',
          stats: {
            atBats: 0,
            hits: 0,
            homeRuns: 0,
            runs: 0,
            rbis: 0,
            strikeouts: 0,
            walks: 0,
            battingAverage: 0,
          },
          createdAt: new Date().toISOString(),
        });
        addedCount++;
      }

      await batch.commit();

      const teamName = currentTeam?.name || 'Equipo';
      onSaveSuccess(selectedTeamId, addedCount, teamName);
      onClose();
    } catch (err: any) {
      console.error('Error saving roster players:', err);
      handleFirestoreError(err, OperationType.CREATE, 'players');
      setError('No se pudieron guardar los jugadores en la base de datos.');
    } finally {
      setIsSaving(false);
    }
  };

  const getFileIcon = () => {
    if (!file) return <Upload className="w-10 h-10 text-indigo-500" />;
    const name = file.name.toLowerCase();
    if (file.type.startsWith('image/')) return <ImageIcon className="w-10 h-10 text-emerald-500" />;
    if (name.endsWith('.pdf')) return <FileText className="w-10 h-10 text-red-500" />;
    if (name.endsWith('.xlsx') || name.endsWith('.xls') || name.endsWith('.csv')) {
      return <FileSpreadsheet className="w-10 h-10 text-emerald-600" />;
    }
    return <FileText className="w-10 h-10 text-indigo-500" />;
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-[80] flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[2.5rem] max-w-3xl w-full shadow-2xl overflow-hidden flex flex-col max-h-[92vh]"
      >
        {/* Header */}
        <div className="p-6 pb-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-950/40">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-indigo-600/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
              <Upload className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-xl font-black text-slate-900 dark:text-white uppercase tracking-tight flex items-center gap-2">
                <span>Subir Cédula de Equipo</span>
                <span className="text-[10px] bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 px-2 py-0.5 rounded-full font-bold uppercase">
                  IA Automática
                </span>
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Acepta cualquier archivo: fotos, escaneos, PDF o Excel para extraer jugadores al instante.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-white rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 p-4 rounded-2xl text-xs flex items-center gap-3">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <div className="flex-1">{error}</div>
            </div>
          )}

          {step === 'upload' ? (
            <div className="space-y-6">
              {/* Select Team to assign */}
              <div className="space-y-2">
                <label className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-2">
                  <Shield className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                  <span>Equipo Destino</span>
                </label>
                <div className="relative">
                  <select
                    value={selectedTeamId}
                    onChange={(e) => setSelectedTeamId(e.target.value)}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl px-4 py-3 text-sm font-bold text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-600 cursor-pointer"
                  >
                    {teams.map(team => (
                      <option key={team.id} value={team.id}>
                        {team.name} ({team.category})
                      </option>
                    ))}
                  </select>
                </div>
                <p className="text-[11px] text-slate-400 dark:text-slate-500">
                  Los jugadores extraídos se asignarán al roster de este equipo.
                </p>
              </div>

              {/* Drag & Drop File Zone */}
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-3xl p-8 text-center transition-all cursor-pointer flex flex-col items-center justify-center gap-4 ${
                  isDragging 
                    ? 'border-indigo-600 bg-indigo-50/20 dark:bg-indigo-950/20 scale-[0.99]' 
                    : file 
                      ? 'border-emerald-500/50 bg-emerald-50/10 dark:bg-emerald-950/10' 
                      : 'border-slate-200 dark:border-slate-800 hover:border-indigo-500/50 hover:bg-slate-50 dark:hover:bg-slate-950/50'
                }`}
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFileSelect(f);
                  }}
                  accept="*/*"
                  className="hidden"
                />

                <div className="w-20 h-20 rounded-3xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center shadow-inner">
                  {getFileIcon()}
                </div>

                {file ? (
                  <div className="space-y-1">
                    <p className="text-sm font-black text-slate-900 dark:text-slate-100">
                      {file.name}
                    </p>
                    <p className="text-xs text-slate-500">
                      {(file.size / 1024).toFixed(1)} KB • Haz clic para cambiar archivo
                    </p>
                    {filePreviewUrl && (
                      <div className="mt-3 max-h-36 max-w-xs mx-auto overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
                        <img src={filePreviewUrl} alt="Vista previa de cédula" className="w-full h-auto object-cover" />
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-1 max-w-sm">
                    <p className="text-sm font-bold text-slate-700 dark:text-slate-200">
                      Arrastra y suelta aquí la cédula o haz clic para examinar
                    </p>
                    <p className="text-xs text-slate-400 dark:text-slate-500">
                      Formatos compatibles: Fotos (JPG, PNG, WEBP), Documentos PDF, Hojas de Excel (.xlsx, .xls, .csv).
                    </p>
                  </div>
                )}
              </div>

              {/* Supported types badges */}
              <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
                <span className="px-3 py-1 bg-slate-100 dark:bg-slate-800 rounded-xl text-[10px] font-bold text-slate-600 dark:text-slate-300">
                  📸 Foto de la hoja
                </span>
                <span className="px-3 py-1 bg-slate-100 dark:bg-slate-800 rounded-xl text-[10px] font-bold text-slate-600 dark:text-slate-300">
                  📄 PDF Digital / Escaneado
                </span>
                <span className="px-3 py-1 bg-slate-100 dark:bg-slate-800 rounded-xl text-[10px] font-bold text-slate-600 dark:text-slate-300">
                  📊 Excel / CSV
                </span>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Review Header Banner */}
              <div className="bg-indigo-50/50 dark:bg-slate-950/60 border border-indigo-100 dark:border-slate-800 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Destino:</span>
                    <strong className="text-sm font-black text-indigo-600 dark:text-indigo-400">
                      {currentTeam?.name} ({currentTeam?.category})
                    </strong>
                  </div>
                  {(detectedTeamName || detectedManager) && (
                    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                      {detectedTeamName && (
                        <span>Equipo en cédula: <strong>{detectedTeamName}</strong></span>
                      )}
                      {detectedManager && (
                        <span>Manager: <strong>{detectedManager}</strong></span>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleAddManualRow}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-xl text-xs font-bold transition-all cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Añadir Fila</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setStep('upload')}
                    className="text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 font-bold px-3 py-1.5 cursor-pointer"
                  >
                    Cambiar archivo
                  </button>
                </div>
              </div>

              {/* Save Mode Selector */}
              <div className="flex flex-wrap gap-4 px-2">
                <label className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-300 cursor-pointer">
                  <input
                    type="radio"
                    name="saveMode"
                    value="append"
                    checked={saveMode === 'append'}
                    onChange={() => setSaveMode('append')}
                    className="w-4 h-4 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span>Agregar al roster (evitar duplicados existentes)</span>
                </label>
                <label className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-300 cursor-pointer">
                  <input
                    type="radio"
                    name="saveMode"
                    value="replace"
                    checked={saveMode === 'replace'}
                    onChange={() => setSaveMode('replace')}
                    className="w-4 h-4 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span>Reemplazar completamente el roster de {currentTeam?.name}</span>
                </label>
              </div>

              {/* Editable Players Table */}
              <div className="border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
                <div className="max-h-80 overflow-y-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-100 dark:bg-slate-800/80 sticky top-0 z-10 text-[10px] font-black uppercase text-slate-500 tracking-wider">
                      <tr>
                        <th className="py-2.5 px-3 w-16">#</th>
                        <th className="py-2.5 px-3">Nombre del Jugador</th>
                        <th className="py-2.5 px-3 w-32">Posición</th>
                        <th className="py-2.5 px-3 w-12 text-center">Acción</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {extractedPlayers.map((player, idx) => (
                        <tr key={player.id} className="hover:bg-slate-50 dark:hover:bg-slate-950/40">
                          <td className="py-2 px-3">
                            <input
                              type="text"
                              value={player.number}
                              onChange={(e) => handleUpdatePlayerDraft(player.id, { number: e.target.value })}
                              placeholder="00"
                              className="w-12 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-2 py-1 text-center font-bold text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-indigo-600"
                            />
                          </td>
                          <td className="py-2 px-3">
                            <input
                              type="text"
                              value={player.name}
                              onChange={(e) => handleUpdatePlayerDraft(player.id, { name: e.target.value })}
                              placeholder="Nombre y Apellidos"
                              className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-1 font-semibold text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-indigo-600"
                            />
                          </td>
                          <td className="py-2 px-3">
                            <select
                              value={player.position}
                              onChange={(e) => handleUpdatePlayerDraft(player.id, { position: e.target.value })}
                              className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-2 py-1 font-semibold text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-indigo-600"
                            >
                              {BASEBALL_POSITIONS.map(pos => (
                                <option key={pos} value={pos}>{pos}</option>
                              ))}
                              <option value="OF">OF (Jardinero)</option>
                              <option value="INF">INF (Cuadro)</option>
                              <option value="UTIL">UTIL</option>
                            </select>
                          </td>
                          <td className="py-2 px-3 text-center">
                            <button
                              type="button"
                              onClick={() => handleDeletePlayerDraft(player.id)}
                              className="p-1.5 text-slate-400 hover:text-red-500 rounded-lg transition-colors cursor-pointer"
                              title="Quitar jugador"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex items-center justify-between text-xs text-slate-500 px-1">
                <span>Total de jugadores detectados: <strong>{extractedPlayers.length}</strong></span>
                <span>Se registrarán con estadísticas en cero listas para los partidos.</span>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-6 pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3 bg-slate-50/50 dark:bg-slate-950/40">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl font-bold text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800 transition-all cursor-pointer"
          >
            Cancelar
          </button>

          {step === 'upload' ? (
            <button
              type="button"
              disabled={!file || isAnalyzing}
              onClick={handleAnalyzeCedula}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white font-bold text-xs uppercase tracking-wider px-6 py-3 rounded-2xl shadow-lg shadow-indigo-600/20 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isAnalyzing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Analizando cédula con IA...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>Escanear y Extraer Jugadores</span>
                </>
              )}
            </button>
          ) : (
            <button
              type="button"
              disabled={isSaving || extractedPlayers.length === 0}
              onClick={handleSaveToTeamRoster}
              className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-bold text-xs uppercase tracking-wider px-6 py-3 rounded-2xl shadow-lg shadow-emerald-600/20 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Guardando en el Roster...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Guardar {extractedPlayers.length} Jugadores en {currentTeam?.name}</span>
                </>
              )}
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
}
