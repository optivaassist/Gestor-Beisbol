import React, { useState, useEffect } from 'react';
import { db } from './firebase';
import { UserProfile } from './types';
import { 
  Trophy, 
  Users, 
  Calendar, 
  Plus, 
  BarChart3, 
  ShieldCheck, 
  UserCog, 
  Star, 
  Upload, 
  Sun, 
  Moon 
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// Components
import Dashboard from './components/Dashboard';
import Scorekeeper from './components/Scorekeeper';
import TeamManager from './components/TeamManager';
import Standings from './components/Standings';
import UserManagement from './components/UserManagement';
import Leaders from './components/Leaders';
import Selectivos from './components/Selectivos';
import ScheduleManager from './components/ScheduleManager';
import ExcelUploader from './components/ExcelUploader';

// 100% Open Access Admin Profile - No sign-in required anywhere
export const OPEN_ADMIN_PROFILE: UserProfile = {
  uid: 'admin-open',
  displayName: 'Administrador',
  email: 'admin@ligabeisbol.com',
  role: 'admin',
};

export default function App() {
  const [profile] = useState<UserProfile>(OPEN_ADMIN_PROFILE);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'scorekeeper' | 'teams' | 'standings' | 'leaders' | 'selectivos' | 'schedule' | 'users' | 'import'>('dashboard');
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [scorekeeperInitialTab, setScorekeeperInitialTab] = useState<'score' | 'lineup'>('score');
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('theme') as 'dark' | 'light') || 'dark';
    }
    return 'dark';
  });

  useEffect(() => {
    localStorage.setItem('theme', theme);
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [theme]);

  return (
    <div className={`min-h-screen flex flex-col transition-colors duration-500 ${theme === 'dark' ? 'bg-slate-950 text-white' : 'bg-indigo-50/30 text-slate-900'}`}>
      {/* Mobile Header */}
      {activeTab !== 'scorekeeper' && (
        <header className={`lg:hidden flex items-center justify-between p-4 border-b transition-colors duration-300 ${theme === 'dark' ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'}`}>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center shadow-lg shadow-indigo-600/20">
              <Trophy className="w-5 h-5 text-white" />
            </div>
            <span className="font-black text-lg tracking-tight uppercase">Liga Béisbol</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold transition-all shadow-sm ${
                theme === 'dark' 
                  ? 'bg-slate-800 text-white' 
                  : 'bg-slate-100 text-indigo-600 border border-slate-200'
              }`}
            >
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </header>
      )}

      <div className="flex flex-col lg:flex-row flex-1 overflow-hidden">
        {/* Sidebar Navigation */}
        {activeTab !== 'scorekeeper' && (
          <nav className={`lg:w-72 border-r p-6 flex lg:flex-col gap-2 overflow-x-auto lg:overflow-y-auto transition-colors duration-300 ${theme === 'dark' ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'}`}>
            <div className="hidden lg:flex items-center gap-3 px-2 mb-10">
              <div className="w-10 h-10 bg-gradient-to-br from-indigo-600 to-indigo-600 rounded-xl flex items-center justify-center shadow-xl shadow-indigo-600/20">
                <Trophy className="w-6 h-6 text-white" />
              </div>
              <span className={`font-black text-xl tracking-tight uppercase ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>Liga Béisbol</span>
            </div>

            <div className="flex lg:flex-col gap-1.5 w-full">
              <NavButton 
                active={activeTab === 'dashboard'} 
                onClick={() => { setActiveTab('dashboard'); setSelectedGameId(null); }} 
                icon={<Calendar className="w-5 h-5" />} 
                label="Partidos" 
                theme={theme}
              />
              <NavButton 
                active={activeTab === 'schedule'} 
                onClick={() => { setActiveTab('schedule'); setSelectedGameId(null); }} 
                icon={<Plus className="w-5 h-5" />} 
                label="Rol de Juego" 
                theme={theme}
              />
              <NavButton 
                active={activeTab === 'teams'} 
                onClick={() => { setActiveTab('teams'); setSelectedGameId(null); }} 
                icon={<Users className="w-5 h-5" />} 
                label="Equipos" 
                theme={theme}
              />
              <NavButton 
                active={activeTab === 'standings'} 
                onClick={() => { setActiveTab('standings'); setSelectedGameId(null); }} 
                icon={<Trophy className="w-5 h-5" />} 
                label="Posiciones" 
                theme={theme}
              />
              <NavButton 
                active={activeTab === 'leaders'} 
                onClick={() => { setActiveTab('leaders'); setSelectedGameId(null); }} 
                icon={<Star className="w-5 h-5" />} 
                label="Líderes" 
                theme={theme}
              />
              <NavButton 
                active={activeTab === 'selectivos'} 
                onClick={() => { setActiveTab('selectivos'); setSelectedGameId(null); }} 
                icon={<ShieldCheck className="w-5 h-5" />} 
                label="Selectivos" 
                theme={theme}
              />
            </div>

            <div className="lg:mt-8 lg:pt-8 lg:border-t lg:border-slate-100 lg:dark:border-slate-800 flex lg:flex-col gap-1.5 w-full">
              <NavButton 
                active={activeTab === 'scorekeeper'} 
                onClick={() => { setActiveTab('scorekeeper'); setSelectedGameId(null); }} 
                icon={<BarChart3 className="w-5 h-5" />} 
                label="Anotador" 
                theme={theme}
              />
              <NavButton 
                active={activeTab === 'import'} 
                onClick={() => { setActiveTab('import'); setSelectedGameId(null); }} 
                icon={<Upload className="w-5 h-5" />} 
                label="Importar" 
                theme={theme}
              />
              <NavButton 
                active={activeTab === 'users'} 
                onClick={() => { setActiveTab('users'); setSelectedGameId(null); }} 
                icon={<UserCog className="w-5 h-5" />} 
                label="Usuarios" 
                theme={theme}
              />
            </div>
            
            <div className="lg:mt-auto flex lg:flex-col gap-1.5 w-full pt-4">
              <button
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                className={`hidden lg:flex items-center gap-3 px-4 py-3 rounded-xl transition-all group ${
                  theme === 'dark' 
                    ? 'text-slate-400 hover:bg-slate-900 hover:text-white' 
                    : 'text-slate-600 hover:bg-slate-100 hover:text-indigo-600'
                }`}
              >
                {theme === 'dark' ? (
                  <>
                    <Sun className="w-5 h-5 text-amber-400 group-hover:rotate-45 transition-transform" />
                    <span className="font-medium">Modo Claro</span>
                  </>
                ) : (
                  <>
                    <Moon className="w-5 h-5 text-indigo-500 group-hover:-rotate-12 transition-transform" />
                    <span className="font-medium">Modo Oscuro</span>
                  </>
                )}
              </button>
            </div>
          </nav>
        )}

        {/* Main Content Area */}
        <main className={`flex-1 overflow-y-auto ${activeTab === 'scorekeeper' ? 'p-0' : 'p-4 lg:p-8'}`}>
          <AnimatePresence mode="wait">
            {activeTab === 'dashboard' && (
              <Dashboard 
                userRole="admin"
                userProfile={profile}
                onSelectGame={(id, initialTab = 'score') => { 
                  setSelectedGameId(id); 
                  setScorekeeperInitialTab(initialTab);
                  setActiveTab('scorekeeper'); 
                }} 
              />
            )}
            {activeTab === 'scorekeeper' && (
              <Scorekeeper 
                gameId={selectedGameId} 
                userRole="admin"
                userProfile={profile}
                onBack={() => setActiveTab('dashboard')} 
                initialTab={scorekeeperInitialTab}
              />
            )}
            {activeTab === 'teams' && (
              <TeamManager userProfile={profile} />
            )}
            {activeTab === 'standings' && (
              <Standings />
            )}
            {activeTab === 'leaders' && (
              <Leaders userProfile={profile} />
            )}
            {activeTab === 'selectivos' && (
              <Selectivos />
            )}
            {activeTab === 'schedule' && (
              <ScheduleManager 
                userProfile={profile} 
                onNavigateToDashboard={() => setActiveTab('dashboard')}
              />
            )}
            {activeTab === 'users' && (
              <UserManagement />
            )}
            {activeTab === 'import' && (
              <ExcelUploader />
            )}
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}

function NavButton({ active, onClick, icon, label, theme }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string, theme: 'dark' | 'light' }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-3 px-4 py-3 rounded-2xl transition-all shrink-0 group ${
        active 
          ? 'bg-indigo-600 text-white font-bold shadow-lg shadow-indigo-600/20' 
          : theme === 'dark'
            ? 'text-slate-400 hover:bg-slate-900 hover:text-white'
            : 'text-slate-600 hover:bg-slate-100 hover:text-indigo-600'
      }`}
    >
      <span className={`${active ? 'text-white' : 'text-slate-400 group-hover:text-indigo-500 transition-colors'}`}>
        {icon}
      </span>
      <span className="whitespace-nowrap font-medium">{label}</span>
    </button>
  );
}
