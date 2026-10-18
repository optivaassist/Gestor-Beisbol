import React, { useState, useEffect } from 'react';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { collection, onSnapshot, query, doc, updateDoc, setDoc, deleteDoc, getDocs, where } from 'firebase/firestore';
import { UserProfile, Role, Category, CATEGORIES } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { Users, Shield, UserCog, Mail, Plus, Trash2, X, UserPlus, Star, Loader2, CheckCircle2 } from 'lucide-react';

export default function UserManagement() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    category: CATEGORIES[0] as Category
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const usersQuery = query(collection(db, 'users'));
    const unsubscribe = onSnapshot(usersQuery, (snapshot) => {
      setUsers(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as UserProfile & { id: string })));
      setLoading(false);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'users'));

    return () => unsubscribe();
  }, []);

  const handleRoleChange = async (uid: string, newRole: Role) => {
    try {
      await updateDoc(doc(db, 'users', uid), { role: newRole });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${uid}`);
    }
  };

  const handleAddJefe = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      // Check if user already exists
      const q = query(collection(db, 'users'), where('email', '==', formData.email.toLowerCase().trim()));
      const querySnapshot = await getDocs(q);
      
      if (!querySnapshot.empty) {
        // alert('Ya existe un usuario con este correo electrónico.');
        setIsSubmitting(false);
        return;
      }

      // Create a "pending" user profile
      // We use a random ID because we don't have the UID yet
      const newUserId = doc(collection(db, 'users')).id;
      const newProfile: UserProfile = {
        uid: '', // Empty until they log in
        displayName: `${formData.firstName} ${formData.lastName}`,
        firstName: formData.firstName,
        lastName: formData.lastName,
        email: formData.email.toLowerCase().trim(),
        role: 'jefe_categoria',
        category: formData.category
      };

      await setDoc(doc(db, 'users', newUserId), newProfile);
      setShowAddModal(false);
      setFormData({ firstName: '', lastName: '', email: '', category: CATEGORIES[0] });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'users');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteUser = async (id: string) => {
    // if (!confirm('¿Estás seguro de que deseas eliminar este usuario?')) return;
    try {
      await deleteDoc(doc(db, 'users', id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `users/${id}`);
    }
  };

  if (loading) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-8"
    >
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Gestión de Usuarios</h2>
          <p className="text-slate-500 dark:text-slate-400">Administra los roles y jefes de categoría de la liga.</p>
        </div>
        
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 rounded-2xl font-bold transition-all shadow-lg shadow-indigo-600/20"
        >
          <UserPlus className="w-5 h-5" />
          Agregar Jefe de Categoría
        </button>
      </div>

      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-3xl overflow-hidden shadow-xl dark:shadow-none">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-950/50 border-b border-slate-200 dark:border-slate-800">
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest">Usuario</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest">Email</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest">Rol / Categoría</th>
                <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase tracking-widest text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {users.map((user: any) => (
                <tr key={user.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors group">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-slate-100 dark:bg-slate-800 rounded-xl flex items-center justify-center font-bold text-slate-400 group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                        {user.displayName ? user.displayName[0] : '?'}
                      </div>
                      <div>
                        <div className="font-bold text-slate-900 dark:text-slate-200">{user.displayName || 'Pendiente de registro'}</div>
                        {!user.uid && <div className="text-[10px] text-orange-500 font-bold uppercase">Invitación Pendiente</div>}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
                      <Mail className="w-4 h-4" />
                      <span className="text-sm">{user.email}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="space-y-1">
                      <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest ${
                        user.role === 'admin' ? 'bg-red-500/10 text-red-500 border border-red-500/20' :
                        user.role === 'jefe_categoria' ? 'bg-indigo-500/10 text-indigo-500 border border-indigo-500/20' :
                        user.role === 'editor' ? 'bg-indigo-600/10 text-indigo-600 border border-indigo-600/20' :
                        'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700'
                      }`}>
                        {user.role === 'admin' ? 'Administrador' : 
                         user.role === 'jefe_categoria' ? 'Jefe de Categoría' :
                         user.role === 'editor' ? 'Anotador' : 'Espectador'}
                      </div>
                      {user.role === 'jefe_categoria' && user.category && (
                        <div className="text-[10px] text-slate-500 font-bold uppercase tracking-tighter pl-1">
                          Categoría: <span className="text-slate-900 dark:text-slate-300">{user.category}</span>
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <select
                        value={user.role}
                        onChange={(e) => handleRoleChange(user.id, e.target.value as Role)}
                        className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-600 transition-all text-slate-900 dark:text-slate-100"
                      >
                        <option value="viewer">Espectador</option>
                        <option value="editor">Anotador</option>
                        <option value="jefe_categoria">Jefe de Categoría</option>
                        <option value="admin">Administrador</option>
                      </select>
                      <button
                        onClick={() => handleDeleteUser(user.id)}
                        className="p-2 text-slate-400 hover:text-red-500 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <AnimatePresence>
        {showAddModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-3xl p-8 w-full max-w-md space-y-6 shadow-2xl"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 text-indigo-600">
                  <UserPlus className="w-6 h-6" />
                  <h3 className="text-xl font-bold">Nuevo Jefe de Categoría</h3>
                </div>
                <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-slate-600 dark:hover:text-white">
                  <X className="w-6 h-6" />
                </button>
              </div>

              <form onSubmit={handleAddJefe} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Nombre</label>
                    <input
                      required
                      type="text"
                      value={formData.firstName}
                      onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                      className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-600 transition-all text-slate-900 dark:text-slate-100"
                      placeholder="Ej. Juan"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Apellido</label>
                    <input
                      required
                      type="text"
                      value={formData.lastName}
                      onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                      className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-600 transition-all text-slate-900 dark:text-slate-100"
                      placeholder="Ej. Pérez"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Correo Electrónico</label>
                  <input
                    required
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-600 transition-all text-slate-900 dark:text-slate-100"
                    placeholder="correo@ejemplo.com"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Categoría Asignada</label>
                  <select
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value as Category })}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-600 transition-all text-slate-900 dark:text-slate-100"
                  >
                    {CATEGORIES.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-xl transition-all shadow-lg shadow-indigo-600/20 flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
                  Crear Jefe de Categoría
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <div className="grid md:grid-cols-3 gap-6">
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 space-y-4 shadow-sm dark:shadow-none">
          <div className="flex items-center gap-2 text-indigo-600">
            <Star className="w-5 h-5" />
            <h4 className="font-bold uppercase tracking-widest text-xs">Jefes de Categoría</h4>
          </div>
          <p className="text-slate-500 dark:text-slate-400 text-sm">
            Tienen control total sobre su categoría asignada, pero acceso de solo lectura a las demás.
          </p>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-4 shadow-sm dark:shadow-none">
          <div className="flex items-center gap-2 text-indigo-600">
            <Shield className="w-5 h-5" />
            <h4 className="font-bold uppercase tracking-widest text-xs">Anotadores</h4>
          </div>
          <p className="text-slate-500 dark:text-slate-400 text-sm">
            Pueden gestionar partidos y estadísticas en tiempo real de cualquier categoría.
          </p>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-4 shadow-sm dark:shadow-none">
          <div className="flex items-center gap-2 text-red-500">
            <UserCog className="w-5 h-5" />
            <h4 className="font-bold uppercase tracking-widest text-xs">Administradores</h4>
          </div>
          <p className="text-slate-500 dark:text-slate-400 text-sm">
            Control total sobre toda la liga, incluyendo gestión de usuarios y ajustes globales.
          </p>
        </div>
      </div>
    </motion.div>
  );
}
