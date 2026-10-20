import React, { createContext, useContext, useState, useEffect, useMemo, ReactNode } from 'react';
import { collection, onSnapshot, doc, updateDoc, deleteField, query, orderBy } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Team } from '../types';

interface TeamsContextType {
  teams: Team[];
  loading: boolean;
  getTeamById: (id?: string) => Team | undefined;
  getTeamByName: (name?: string) => Team | undefined;
  getTeamLogo: (identifier?: { id?: string; name?: string }) => string | undefined;
  uploadTeamLogo: (teamId: string, file: File) => Promise<string>;
  removeTeamLogo: (teamId: string) => Promise<void>;
}

const TeamsContext = createContext<TeamsContextType | undefined>(undefined);

/**
 * Resizes and compresses an image file to a clean 256x256 WebP/PNG Data URL
 */
export async function processLogoFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const TARGET_SIZE = 256;
        let width = img.width;
        let height = img.height;

        // Keep aspect ratio inside square target
        const canvas = document.createElement('canvas');
        canvas.width = TARGET_SIZE;
        canvas.height = TARGET_SIZE;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(e.target?.result as string);
          return;
        }

        ctx.clearRect(0, 0, TARGET_SIZE, TARGET_SIZE);

        let drawW = TARGET_SIZE;
        let drawH = TARGET_SIZE;
        let offsetX = 0;
        let offsetY = 0;

        if (width > height) {
          drawW = TARGET_SIZE;
          drawH = Math.round((height * TARGET_SIZE) / width);
          offsetY = Math.round((TARGET_SIZE - drawH) / 2);
        } else {
          drawH = TARGET_SIZE;
          drawW = Math.round((width * TARGET_SIZE) / height);
          offsetX = Math.round((TARGET_SIZE - drawW) / 2);
        }

        ctx.drawImage(img, offsetX, offsetY, drawW, drawH);

        // Use PNG for lossless compression, transparency support, and direct jsPDF compatibility
        const pngData = canvas.toDataURL('image/png');
        resolve(pngData);
      };
      img.onerror = (err) => reject(err);
      img.src = e.target?.result as string;
    };
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });
}

export function TeamsProvider({ children }: { children: ReactNode }) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const teamsQuery = query(collection(db, 'teams'), orderBy('name', 'asc'));
    const unsubscribe = onSnapshot(teamsQuery, (snapshot) => {
      const loadedTeams = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Team));
      setTeams(loadedTeams);
      setLoading(false);
    }, (error) => {
      console.error("Error fetching teams in TeamsContext:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Quick lookup maps
  const { byId, byName } = useMemo(() => {
    const mapId = new Map<string, Team>();
    const mapName = new Map<string, Team>();

    teams.forEach(t => {
      if (t.id) mapId.set(t.id, t);
      if (t.name) {
        mapName.set(t.name.trim().toLowerCase(), t);
      }
    });

    return { byId: mapId, byName: mapName };
  }, [teams]);

  const getTeamById = (id?: string) => {
    if (!id) return undefined;
    return byId.get(id);
  };

  const getTeamByName = (name?: string) => {
    if (!name) return undefined;
    return byName.get(name.trim().toLowerCase());
  };

  const getTeamLogo = (identifier?: { id?: string; name?: string }): string | undefined => {
    if (!identifier) return undefined;
    if (identifier.id) {
      const t = byId.get(identifier.id);
      if (t?.logoUrl) return t.logoUrl;
    }
    if (identifier.name) {
      const t = byName.get(identifier.name.trim().toLowerCase());
      if (t?.logoUrl) return t.logoUrl;
    }
    return undefined;
  };

  const uploadTeamLogo = async (teamId: string, file: File): Promise<string> => {
    const dataUrl = await processLogoFile(file);
    const teamRef = doc(db, 'teams', teamId);
    await updateDoc(teamRef, {
      logoUrl: dataUrl
    });
    return dataUrl;
  };

  const removeTeamLogo = async (teamId: string): Promise<void> => {
    const teamRef = doc(db, 'teams', teamId);
    await updateDoc(teamRef, {
      logoUrl: deleteField()
    });
  };

  const value = {
    teams,
    loading,
    getTeamById,
    getTeamByName,
    getTeamLogo,
    uploadTeamLogo,
    removeTeamLogo
  };

  return (
    <TeamsContext.Provider value={value}>
      {children}
    </TeamsContext.Provider>
  );
}

export function useTeams() {
  const context = useContext(TeamsContext);
  if (!context) {
    throw new Error('useTeams must be used within a TeamsProvider');
  }
  return context;
}
