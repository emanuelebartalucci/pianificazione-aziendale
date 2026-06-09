import { LogOut, Home, KeyRound, X, Shield } from 'lucide-react';
import { signOut, updatePassword, reauthenticateWithCredential, EmailAuthProvider } from 'firebase/auth';
import { auth } from '../services/firebase';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useState } from 'react';

export default function Navbar() {
  const navigate = useNavigate();
  const { user, isAdmin, isHR, isSenior, myAssociatedName } = useAuth();
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwError, setPwError] = useState('');
  const [pwSuccess, setPwSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogout = async () => {
    await signOut(auth);
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !user.email) return;

    if (newPassword !== confirmPassword) {
      setPwError('Le nuove password non coincidono.');
      return;
    }
    if (newPassword.length < 6) {
      setPwError('La nuova password deve essere di almeno 6 caratteri.');
      return;
    }
    
    setLoading(true);
    setPwError('');
    setPwSuccess('');
    
    try {
      const credential = EmailAuthProvider.credential(user.email, oldPassword);
      await reauthenticateWithCredential(user, credential);
      await updatePassword(user, newPassword);

      setPwSuccess('Password aggiornata con successo!');
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => setIsPasswordModalOpen(false), 2000);
    } catch (error: any) {
      if (error.code === 'auth/invalid-credential' || error.code === 'auth/wrong-password') {
        setPwError('La vecchia password inserita non è corretta.');
      } else {
        setPwError("Errore durante l'aggiornamento: " + error.message);
      }
    } finally {
      setLoading(false);
    }
  };

  const location = useLocation();
  const isSuggerimenti = location.pathname === '/suggerimenti';
  const userDisplayName = myAssociatedName ? `${myAssociatedName} (${user?.email})` : user?.email;

  return (
    <>
      <header className="bg-white shadow-sm sticky top-0 z-20 h-16 flex items-center justify-between px-6 no-print border-b">
        <div className="flex items-center gap-3">
          <img src="/Logo.png" alt="Ingegno06" className="h-10 object-contain drop-shadow-sm" onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
          }} />
          <h1 className="text-xl font-bold text-gray-800 hidden sm:block tracking-tight">Pianificazione Aziendale</h1>
        </div>
        <div className="flex items-center gap-4">
          <button 
            onClick={() => navigate('/')}
            className="text-sm font-medium text-gray-600 hover:text-blue-600 flex items-center gap-1 transition-colors animate-in fade-in duration-300"
          >
            <Home className="w-4 h-4" /> <span className="hidden sm:inline">Dashboard</span>
          </button>
          <div className="flex items-center gap-3 border-l pl-4">
            <div className="flex flex-col items-start hidden sm:flex">
              {isSuggerimenti ? (
                <span className="text-sm font-extrabold text-indigo-600 flex items-center gap-1.5 leading-tight select-none">
                  <Shield className="w-3.5 h-3.5" /> Anonimo
                </span>
              ) : (
                <>
                  <span className="text-sm font-semibold text-gray-700 leading-tight">{userDisplayName}</span>
                  <button 
                    onClick={() => { setIsPasswordModalOpen(true); setPwError(''); setPwSuccess(''); setOldPassword(''); setNewPassword(''); setConfirmPassword(''); }}
                    className="text-[10px] text-blue-600 hover:text-blue-800 hover:underline transition-colors mt-0.5 font-bold flex items-center gap-1"
                  >
                    <KeyRound className="w-3 h-3" /> Cambia Password
                  </button>
                </>
              )}
            </div>
            
            {/* Badges Ruolo */}
            {!isSuggerimenti && (
              <div className="hidden sm:flex gap-1">
                {isAdmin && <span className="text-[10px] font-bold bg-red-100 text-red-700 px-2 py-0.5 rounded-full uppercase tracking-wider">Admin</span>}
                {!isAdmin && isHR && <span className="text-[10px] font-bold bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full uppercase tracking-wider">HR</span>}
                {!isAdmin && isSenior && <span className="text-[10px] font-bold bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full uppercase tracking-wider">Senior</span>}
              </div>
            )}

            {!isSuggerimenti && (
              <button 
                onClick={handleLogout}
                className="text-gray-400 hover:text-red-600 p-1.5 rounded-full hover:bg-red-50 transition-colors" 
                title="Esci"
              >
                <LogOut className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Modal Cambio Password */}
      {isPasswordModalOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4 no-print transition-all">
          <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-sm overflow-hidden transform scale-100 transition-all">
            <div className="bg-gradient-to-r from-blue-600 to-indigo-600 p-5 flex justify-between items-center text-white">
              <h3 className="font-extrabold text-lg flex items-center gap-2"><KeyRound className="w-5 h-5" /> Cambia Password</h3>
              <button onClick={() => setIsPasswordModalOpen(false)} className="hover:bg-white/20 p-1.5 rounded-full transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6">
              {pwError && <div className="text-xs bg-red-50 text-red-600 p-3 rounded-xl mb-4 font-medium border border-red-100">{pwError}</div>}
              {pwSuccess && <div className="text-xs bg-green-50 text-green-700 p-3 rounded-xl mb-4 font-medium border border-green-100">{pwSuccess}</div>}
              
              <form onSubmit={handleChangePassword} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1.5 ml-1">Vecchia Password</label>
                  <input 
                    type="password" 
                    required 
                    placeholder="La tua password attuale"
                    value={oldPassword}
                    onChange={(e) => setOldPassword(e.target.value)}
                    className="w-full p-3.5 text-sm border-none rounded-xl bg-gray-50 outline-none focus:ring-2 focus:ring-blue-500 shadow-inner font-medium text-gray-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1.5 ml-1">Nuova Password</label>
                  <input 
                    type="password" 
                    required 
                    minLength={6}
                    placeholder="••••••••"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full p-3.5 text-sm border-none rounded-xl bg-gray-50 outline-none focus:ring-2 focus:ring-blue-500 shadow-inner font-medium text-gray-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-600 mb-1.5 ml-1">Conferma Nuova Password</label>
                  <input 
                    type="password" 
                    required 
                    minLength={6}
                    placeholder="••••••••"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full p-3.5 text-sm border-none rounded-xl bg-gray-50 outline-none focus:ring-2 focus:ring-blue-500 shadow-inner font-medium text-gray-900"
                  />
                </div>
                <button type="submit" disabled={loading} className="w-full bg-gray-900 text-white font-bold py-3.5 rounded-xl hover:bg-gray-800 transition-colors shadow-md active:scale-95 disabled:opacity-50 mt-2">
                  {loading ? 'Aggiornamento...' : 'Conferma Modifica'}
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
