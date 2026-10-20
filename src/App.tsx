import React, { useState, useEffect } from 'react';
import { auth, signIn, logOut, db, handleFirestoreError, OperationType } from './firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, getDoc, setDoc, onSnapshot, collection, query, where, orderBy, getDocs, deleteDoc } from 'firebase/firestore';
import { UserProfile, Game, Team, Player } from './types';
import { Trophy, Users, Calendar, Settings, LogOut, LogIn, Plus, Play, ChevronRight, BarChart3, ShieldCheck, UserCog, Star, Upload, Loader2, Sun, Moon } from 'lucide-react';
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

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'scorekeeper' | 'teams' | 'standings' | 'leaders' | 'selectivos' | 'schedule' | 'settings' | 'users' | 'import'>('dashboard');
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [scorekeeperInitialTab, setScorekeeperInitialTab] = useState<'score' | 'lineup'>('score');
  const [error, setError] = useState<string | null>(null);
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

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        // Fetch or create profile
        try {
          const profileDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
          if (profileDoc.exists()) {
            const existingProfile = profileDoc.data() as UserProfile;
            // Bootstrap admin role for the specific user
            if (firebaseUser.email === 'llorch7@gmail.com' && existingProfile.role !== 'admin') {
              const updatedProfile = { ...existingProfile, role: 'admin' as const };
              await setDoc(doc(db, 'users', firebaseUser.uid), updatedProfile);
              setProfile(updatedProfile);
            } else {
              setProfile(existingProfile);
            }
          } else {
            // Check for pending invitation by email
            const q = query(collection(db, 'users'), where('email', '==', firebaseUser.email?.toLowerCase().trim()));
            const querySnapshot = await getDocs(q);
            
            if (!querySnapshot.empty) {
              const invitationDoc = querySnapshot.docs[0];
              const invitationData = invitationDoc.data() as UserProfile;
              
              // Claim the invitation: create new doc with UID and delete old one
              const newProfile: UserProfile = {
                ...invitationData,
                uid: firebaseUser.uid,
                displayName: firebaseUser.displayName || invitationData.displayName || 'Anonymous'
              };
              
              await setDoc(doc(db, 'users', firebaseUser.uid), newProfile);
              await deleteDoc(invitationDoc.ref);
              setProfile(newProfile);
            } else {
              const newProfile: UserProfile = {
                uid: firebaseUser.uid,
                displayName: firebaseUser.displayName || 'Anonymous',
                email: firebaseUser.email || '',
                role: firebaseUser.email === 'llorch7@gmail.com' ? 'admin' : 'viewer',
              };
              await setDoc(doc(db, 'users', firebaseUser.uid), newProfile);
              setProfile(newProfile);
            }
          }
        } catch (error) {
          console.error("Error fetching profile:", error);
        }
      } else {
        setProfile(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
          className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full"
        />
      </div>
    );
  }

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
            {user ? (
              <button
                onClick={logOut}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-rose-500/10 text-rose-500 border border-rose-500/20 active:scale-95 transition-all"
                title="Cerrar Sesión"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Salir</span>
              </button>
            ) : null}
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

            <div className="lg:mt-10 lg:pt-10 lg:border-t lg:border-slate-100 lg:dark:border-slate-800 flex lg:flex-col gap-1.5 w-full">
              {profile?.role === 'editor' || profile?.role === 'admin' ? (
                <NavButton 
                  active={activeTab === 'scorekeeper'} 
                  onClick={() => { setActiveTab('scorekeeper'); setSelectedGameId(null); }} 
                  icon={<BarChart3 className="w-5 h-5" />} 
                  label="Anotador" 
                  theme={theme}
                />
              ) : null}
              {profile?.role === 'admin' ? (
                <NavButton 
                  active={activeTab === 'users'} 
                  onClick={() => { setActiveTab('users'); setSelectedGameId(null); }} 
                  icon={<UserCog className="w-5 h-5" />} 
                  label="Usuarios" 
                  theme={theme}
                />
              ) : null}
              {profile?.role === 'admin' ? (
                <NavButton 
                  active={activeTab === 'import'} 
                  onClick={() => { setActiveTab('import'); setSelectedGameId(null); }} 
                  icon={<Upload className="w-5 h-5" />} 
                  label="Importar" 
                  theme={theme}
                />
              ) : null}
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

              {user ? (
                <>
                  <NavButton 
                    active={activeTab === 'settings'} 
                    onClick={() => setActiveTab('settings')} 
                    icon={<Settings className="w-5 h-5" />} 
                    label="Ajustes" 
                    theme={theme}
                  />
                  <button
                    onClick={logOut}
                    className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all cursor-pointer ${
                      theme === 'dark'
                        ? 'text-slate-400 hover:bg-rose-500/10 hover:text-rose-500'
                        : 'text-slate-600 hover:bg-rose-50 hover:text-rose-600'
                    }`}
                  >
                    <LogOut className="w-5 h-5" />
                    <span className="hidden lg:inline font-medium">Cerrar Sesión</span>
                  </button>
                </>
              ) : null}
            </div>
          </nav>
        )}

      {/* Main Content Area */}
      <main className={`flex-1 overflow-y-auto ${activeTab === 'scorekeeper' ? 'p-0' : 'p-4 lg:p-8'}`}>
        <AnimatePresence mode="wait">
          {activeTab === 'dashboard' && (
            <Dashboard 
              userRole={profile?.role || 'viewer'}
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
              userRole={profile?.role || 'viewer'}
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
          {activeTab === 'users' && profile?.role === 'admin' && (
            <UserManagement />
          )}
          {activeTab === 'import' && profile?.role === 'admin' && (
            <ExcelUploader />
          )}
          {activeTab === 'settings' && user && (
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="max-w-2xl mx-auto space-y-8"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-4xl font-black tracking-tight uppercase">Ajustes</h2>
              </div>
              
              <div className={`border rounded-3xl p-8 space-y-8 transition-colors duration-300 ${theme === 'dark' ? 'bg-slate-900 border-slate-800 shadow-2xl' : 'bg-slate-50 border-slate-200 shadow-xl shadow-slate-200/50'}`}>
                <div className="flex items-center gap-6">
                  <div className="w-20 h-20 bg-gradient-to-br from-indigo-600 to-blue-600 rounded-2xl flex items-center justify-center text-3xl font-black text-white shadow-xl shadow-indigo-600/20">
                    {profile?.displayName?.[0] || '?'}
                  </div>
                  <div className="space-y-1">
                    <h3 className="text-2xl font-bold">{profile?.displayName || 'Usuario'}</h3>
                    <p className="text-slate-500 font-medium">{profile?.email}</p>
                    <div className={`mt-2 inline-flex items-center gap-1.5 px-3 py-1 border rounded-full text-[10px] font-black tracking-wider uppercase ${theme === 'dark' ? 'bg-slate-800 border-slate-700 text-indigo-400' : 'bg-indigo-50 border-indigo-100 text-indigo-600'}`}>
                      <ShieldCheck className="w-3 h-3" />
                      {profile?.role === 'admin' ? 'ADMINISTRADOR' : 
                       profile?.role === 'editor' ? 'ANOTADOR' : 'ESPECTADOR'}
                    </div>
                  </div>
                </div>

                <div className={`space-y-6 pt-8 border-t ${theme === 'dark' ? 'border-slate-800' : 'border-slate-100'}`}>
                  <h4 className={`text-sm font-black uppercase tracking-widest ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`}>Ajustes de Perfil</h4>
                  <div className="grid gap-6">
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Nombre de Usuario</label>
                      <input 
                        type="text" 
                        value={profile?.displayName} 
                        readOnly
                        className={`w-full border rounded-2xl px-5 py-3 font-medium cursor-not-allowed ${theme === 'dark' ? 'bg-slate-950 border-slate-800 text-slate-500' : 'bg-slate-50 border-slate-200 text-slate-500'}`}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Rol de Usuario</label>
                      {profile?.role === 'admin' ? (
                        <select 
                          value={profile?.role}
                          onChange={async (e) => {
                            const newRole = e.target.value as any;
                            if (profile) {
                              const updated = { ...profile, role: newRole };
                              await setDoc(doc(db, 'users', profile.uid), updated);
                              setProfile(updated);
                            }
                          }}
                          className={`w-full border rounded-2xl px-5 py-3 font-bold focus:outline-none focus:ring-4 focus:ring-indigo-600/20 transition-all ${theme === 'dark' ? 'bg-slate-950 border-slate-800 text-white' : 'bg-white border-slate-200 text-slate-900'}`}
                        >
                          <option value="viewer">Espectador</option>
                          <option value="editor">Anotador</option>
                          <option value="jefe_categoria">Jefe de Categoría</option>
                          <option value="admin">Administrador</option>
                        </select>
                      ) : (
                        <div className={`w-full border rounded-2xl px-5 py-3 font-bold ${theme === 'dark' ? 'bg-slate-950 border-slate-800 text-slate-500' : 'bg-slate-50 border-slate-200 text-slate-500'}`}>
                          {profile?.role === 'admin' ? 'Administrador' : 
                           profile?.role === 'jefe_categoria' ? 'Jefe de Categoría' :
                           profile?.role === 'editor' ? 'Anotador' : 'Espectador'}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
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
