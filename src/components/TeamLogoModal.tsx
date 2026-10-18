import React, { useRef, useState } from 'react';
import { Team } from '../types';
import { useTeams } from '../context/TeamsContext';
import { motion, AnimatePresence } from 'motion/react';
import { Upload, Trash2, X, Check, Loader2, Image as ImageIcon, Camera } from 'lucide-react';
import TeamLogo from './TeamLogo';

interface TeamLogoModalProps {
  isOpen: boolean;
  onClose: () => void;
  team: Team | null;
  onSuccess?: (message: string) => void;
}

export default function TeamLogoModal({
  isOpen,
  onClose,
  team,
  onSuccess
}: TeamLogoModalProps) {
  const { uploadTeamLogo, removeTeamLogo } = useTeams();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);

  if (!isOpen || !team) return null;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    try {
      await uploadTeamLogo(team.id, file);
      if (onSuccess) {
        onSuccess(`Logotipo de ${team.name} actualizado correctamente.`);
      }
      onClose();
    } catch (err) {
      console.error('Error uploading team logo:', err);
    } finally {
      setIsProcessing(false);
      e.target.value = '';
    }
  };

  const handleRemove = async () => {
    setIsProcessing(true);
    try {
      await removeTeamLogo(team.id);
      if (onSuccess) {
        onSuccess(`Logotipo de ${team.name} eliminado. Se mostrará la letra inicial.`);
      }
      onClose();
    } catch (err) {
      console.error('Error removing team logo:', err);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 15 }}
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[2.5rem] p-6 sm:p-8 max-w-sm w-full space-y-6 shadow-2xl text-center"
      >
        <div className="flex items-center justify-between">
          <div className="text-left">
            <h3 className="text-lg font-black text-slate-900 dark:text-white uppercase tracking-tight">
              Logotipo del Equipo
            </h3>
            <p className="text-xs text-slate-500 font-semibold">{team.name} • {team.category}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-white rounded-xl transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Hidden File Input */}
        <input
          type="file"
          ref={fileInputRef}
          accept="image/png,image/jpeg,image/webp,image/svg+xml,image/*"
          onChange={handleFileChange}
          className="hidden"
        />

        {/* Current / Preview Logo */}
        <div className="flex flex-col items-center justify-center gap-3 py-2">
          <div className="relative group cursor-pointer" onClick={() => fileInputRef.current?.click()}>
            <div className="w-24 h-24 rounded-3xl p-1 bg-slate-100 dark:bg-slate-800 border-2 border-dashed border-indigo-400/50 flex items-center justify-center shadow-lg shadow-indigo-600/10">
              <TeamLogo team={team} size="2xl" className="w-full h-full rounded-2xl" />
            </div>
            <div className="absolute inset-0 bg-slate-950/60 rounded-3xl opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center text-white text-xs font-bold gap-1 backdrop-blur-[2px]">
              <Camera className="w-5 h-5" />
              <span>Cambiar</span>
            </div>
          </div>
          <span className="text-[11px] text-slate-400 font-medium">
            {team.logoUrl ? 'Logotipo oficial configurado' : 'Sin logotipo (mostrando inicial)'}
          </span>
        </div>

        {/* Actions */}
        <div className="space-y-2 pt-2">
          <button
            type="button"
            disabled={isProcessing}
            onClick={() => fileInputRef.current?.click()}
            className="w-full py-3.5 px-4 bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white font-black text-xs uppercase tracking-wider rounded-xl transition-all shadow-lg shadow-indigo-600/20 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
          >
            {isProcessing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Upload className="w-4 h-4" />
            )}
            <span>{team.logoUrl ? 'Seleccionar Nueva Imagen' : 'Subir Imagen desde mi PC'}</span>
          </button>

          {team.logoUrl && (
            <button
              type="button"
              disabled={isProcessing}
              onClick={handleRemove}
              className="w-full py-2.5 px-4 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/40 text-rose-600 dark:text-rose-400 font-bold text-xs uppercase tracking-wider rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Eliminar Logotipo (Volver a inicial)</span>
            </button>
          )}

          <button
            type="button"
            onClick={onClose}
            className="w-full py-2.5 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 font-bold transition-colors cursor-pointer"
          >
            Cancelar
          </button>
        </div>
      </motion.div>
    </div>
  );
}
