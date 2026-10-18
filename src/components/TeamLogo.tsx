import React, { useState, useEffect } from 'react';
import { Team } from '../types';
import { useTeams } from '../context/TeamsContext';
import { Camera } from 'lucide-react';

export type TeamLogoSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'custom';

interface TeamLogoProps {
  team?: Team | null;
  teamId?: string;
  teamName?: string;
  size?: TeamLogoSize;
  className?: string;
  isEditable?: boolean;
  onEditClick?: (e: React.MouseEvent) => void;
  title?: string;
}

const SIZE_STYLES: Record<Exclude<TeamLogoSize, 'custom'>, { container: string; text: string; icon: string }> = {
  xs: {
    container: 'w-6 h-6 rounded-full',
    text: 'text-[10px] font-black',
    icon: 'w-2.5 h-2.5'
  },
  sm: {
    container: 'w-8 h-8 rounded-full',
    text: 'text-xs font-black',
    icon: 'w-3.5 h-3.5'
  },
  md: {
    container: 'w-10 h-10 rounded-full',
    text: 'text-sm font-black',
    icon: 'w-4 h-4'
  },
  lg: {
    container: 'w-12 h-12 rounded-full',
    text: 'text-base font-black',
    icon: 'w-5 h-5'
  },
  xl: {
    container: 'w-16 h-16 rounded-full',
    text: 'text-2xl font-black',
    icon: 'w-6 h-6'
  },
  '2xl': {
    container: 'w-20 h-20 rounded-full',
    text: 'text-3xl font-black',
    icon: 'w-8 h-8'
  }
};

export default function TeamLogo({
  team,
  teamId,
  teamName,
  size = 'md',
  className = '',
  isEditable = false,
  onEditClick,
  title
}: TeamLogoProps) {
  const { getTeamById, getTeamByName } = useTeams();
  const [imageError, setImageError] = useState(false);

  // Resolve team from direct prop, ID, or name
  const resolvedTeam = team || getTeamById(teamId) || getTeamByName(teamName);
  const resolvedName = resolvedTeam?.name || teamName || 'Equipo';
  const logoUrl = (!imageError && resolvedTeam?.logoUrl) ? resolvedTeam.logoUrl : null;
  const initialLetter = resolvedName.trim().charAt(0).toUpperCase() || '?';

  // Reset image error whenever the team's logoUrl changes
  useEffect(() => {
    setImageError(false);
  }, [resolvedTeam?.logoUrl]);

  const sizeStyle = size !== 'custom' ? SIZE_STYLES[size] : { container: '', text: '', icon: '' };

  const handleContainerClick = (e: React.MouseEvent) => {
    if (isEditable && onEditClick) {
      e.stopPropagation();
      onEditClick(e);
    }
  };

  return (
    <div
      onClick={handleContainerClick}
      title={title || (isEditable ? `Haz clic para cambiar o subir el logotipo de ${resolvedName}` : resolvedName)}
      className={`relative shrink-0 flex items-center justify-center overflow-hidden transition-all select-none border border-slate-200/90 dark:border-slate-700/90 bg-white dark:bg-slate-900 shadow-sm ${
        sizeStyle.container
      } ${
        isEditable ? 'cursor-pointer group hover:ring-2 hover:ring-indigo-500/80 hover:scale-105 active:scale-95 shadow-md' : ''
      } ${className}`}
    >
      {logoUrl ? (
        <img
          src={logoUrl}
          alt={`Logotipo oficial de ${resolvedName}`}
          onError={() => setImageError(true)}
          className="w-full h-full object-contain p-0.5 rounded-[inherit] bg-white dark:bg-slate-900"
          loading="lazy"
        />
      ) : (
        /* Fallback: First letter inside the circle */
        <div className={`w-full h-full flex items-center justify-center bg-indigo-50 dark:bg-slate-800 text-indigo-700 dark:text-indigo-300 rounded-[inherit] ${sizeStyle.text}`}>
          {initialLetter}
        </div>
      )}

      {/* Editable Hover Overlay */}
      {isEditable && (
        <div className="absolute inset-0 bg-slate-950/65 opacity-0 group-hover:opacity-100 backdrop-blur-[1px] transition-all flex flex-col items-center justify-center text-white rounded-[inherit] z-10">
          <Camera className={sizeStyle.icon} />
          {size === 'xl' || size === '2xl' ? (
            <span className="text-[9px] font-black uppercase tracking-wider mt-0.5">Logo</span>
          ) : null}
        </div>
      )}
    </div>
  );
}
