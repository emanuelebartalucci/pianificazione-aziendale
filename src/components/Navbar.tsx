import { LogOut, Home, KeyRound, X, Shield, RefreshCw, Network } from 'lucide-react';
import { signOut, updatePassword, reauthenticateWithCredential, EmailAuthProvider } from 'firebase/auth';
import { auth, db } from '../services/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useState, useEffect } from 'react';
import { isSoci } from '../pages/Impostazioni';

interface UpcomingHolidayWork {
  id: string;
  dipendenteName: string;
  dipendenteEmail: string;
  data: string;
  motivo: string;
}

export default function Navbar() {
  const navigate = useNavigate();
  const { user, isAdmin, isHR, myAssociatedName, userEmail } = useAuth();
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwError, setPwError] = useState('');
  const [pwSuccess, setPwSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  // Stato per Presenze Festivi nei prossimi 7 giorni (Solo Soci / Admin)
  const [upcomingHolidayWorkList, setUpcomingHolidayWorkList] = useState<UpcomingHolidayWork[]>([]);
  const [isHolidayModalOpen, setIsHolidayModalOpen] = useState(false);

  useEffect(() => {
    if (!user) return;
    const fetchUpcomingHolidays = async () => {
      if (isSoci(myAssociatedName) || isAdmin) {
        try {
          const todayObj = new Date();
          const todayIso = `${todayObj.getFullYear()}-${String(todayObj.getMonth() + 1).padStart(2, '0')}-${String(todayObj.getDate()).padStart(2, '0')}`;
          const next7DaysObj = new Date(todayObj);
          next7DaysObj.setDate(next7DaysObj.getDate() + 7);
          const next7DaysIso = `${next7DaysObj.getFullYear()}-${String(next7DaysObj.getMonth() + 1).padStart(2, '0')}-${String(next7DaysObj.getDate()).padStart(2, '0')}`;

          const qWkApproved = query(
            collection(db, 'richieste_weekend'),
            where('stato', '==', 'Approvato')
          );
          const wkAppSnap = await getDocs(qWkApproved);
          const list: UpcomingHolidayWork[] = [];
          wkAppSnap.forEach(docSnap => {
            const data = docSnap.data();
            const reqDate = data.data || '';
            if (reqDate && reqDate >= todayIso && reqDate <= next7DaysIso) {
              list.push({
                id: docSnap.id,
                dipendenteName: data.dipendenteName || '',
                dipendenteEmail: data.dipendenteEmail || '',
                data: reqDate,
                motivo: data.motivo || 'Autorizzazione straordinario / festivo'
              });
            }
          });
          list.sort((a, b) => a.data.localeCompare(b.data));
          setUpcomingHolidayWorkList(list);
        } catch (err) {
          console.error("Errore fetch presenze festivi in Navbar:", err);
        }
      } else {
        setUpcomingHolidayWorkList([]);
      }
    };

    fetchUpcomingHolidays();
  }, [user, myAssociatedName, isAdmin]);

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
  const userDisplayName = myAssociatedName ? `${myAssociatedName} (${userEmail})` : userEmail;

  return (
    <>
      <header className="bg-white shadow-sm sticky top-0 z-50 h-16 flex items-center justify-between px-6 no-print border-b">
        <div className="flex items-center gap-3">
          <div 
            onClick={() => navigate('/')} 
            className="flex items-center gap-3 cursor-pointer select-none group"
          >
            <img src="/Logo.png" alt="Ingegno06" className="h-12 object-contain drop-shadow-sm group-hover:opacity-85 transition-opacity" onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }} />
            <h1 className="text-2xl font-black text-gray-800 hidden sm:block tracking-tight group-hover:text-blue-600 transition-colors">Pianificazione Aziendale</h1>
          </div>
          {location.pathname === '/' && (isHR || isAdmin) && (
            <button 
              onClick={(e) => {
                e.stopPropagation();
                window.dispatchEvent(new CustomEvent('app-refresh-dashboard'));
              }}
              title="Aggiorna Dashboard"
              className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 border border-transparent hover:border-blue-100 rounded-xl transition-all cursor-pointer hover:rotate-180 duration-500"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-4">
          {location.pathname !== '/' && (
            <button 
              onClick={() => navigate('/')}
              className="text-sm font-medium flex items-center gap-1 transition-colors animate-in fade-in duration-300 text-gray-600 hover:text-blue-600 cursor-pointer"
            >
              <Home className="w-4 h-4" /> <span className="hidden sm:inline">Dashboard</span>
            </button>
          )}

          <button 
            onClick={() => navigate('/organigramma')}
            className={`text-sm font-medium flex items-center gap-1 transition-colors animate-in fade-in duration-300 ${
              location.pathname === '/organigramma' ? 'text-blue-600 font-bold' : 'text-gray-600 hover:text-blue-600'
            }`}
          >
            <Network className="w-4 h-4" /> <span className="hidden sm:inline">Organigramma</span>
          </button>

          {/* BADGE PRESENZE FESTIVI (PROSSIMI 7 GIORNI) PER SOCI E ADMIN */}
          {(isSoci(myAssociatedName) || isAdmin) && upcomingHolidayWorkList.length > 0 && (
            <button
              type="button"
              onClick={() => setIsHolidayModalOpen(true)}
              className="flex items-center gap-1.5 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 px-2.5 py-1 rounded-xl text-xs font-black transition-all cursor-pointer shadow-2xs active:scale-95 animate-in fade-in"
              title="Clicca per visualizzare le risorse autorizzate nei festivi/weekend nei prossimi 7 giorni"
            >
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
              </span>
              <Shield className="w-3.5 h-3.5 text-amber-700" />
              <span>🛡️ {upcomingHolidayWorkList.length} Festivi (7gg)</span>
            </button>
          )}

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

      {/* Modal Presenze Festivi (Prossimi 7 giorni) */}
      {isHolidayModalOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-xs flex items-center justify-center z-50 p-4 no-print transition-all">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="bg-gradient-to-r from-amber-500 to-amber-600 p-5 flex justify-between items-center text-white">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-white/20 rounded-xl">
                  <Shield className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="font-extrabold text-base leading-tight">Sicurezza Presenze Festivi</h3>
                  <p className="text-[11px] text-amber-100 font-medium">Persone autorizzate nei prossimi 7 giorni</p>
                </div>
              </div>
              <button 
                onClick={() => setIsHolidayModalOpen(false)} 
                className="hover:bg-white/20 p-1.5 rounded-full transition-colors text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-3">
              <p className="text-xs text-gray-600 font-semibold">
                Elenco delle risorse autorizzate ad accedere in ditta nei giorni festivi o di weekend durante la settimana in corso:
              </p>

              <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
                {upcomingHolidayWorkList.map(req => {
                  const dateParts = req.data.split('-');
                  const formattedDate = dateParts.length === 3 ? `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}` : req.data;
                  return (
                    <div key={req.id} className="p-3.5 bg-amber-50/80 border border-amber-200/90 rounded-2xl flex items-center justify-between gap-3 shadow-2xs">
                      <div className="flex items-start gap-3">
                        <div className="px-2.5 py-1 bg-amber-200 text-amber-950 rounded-xl text-xs font-black shrink-0 text-center border border-amber-300/80">
                          📅 {formattedDate}
                        </div>
                        <div>
                          <div className="text-xs font-black text-gray-900">{req.dipendenteName}</div>
                          <div className="text-[11px] font-bold text-gray-600 italic leading-snug">{req.motivo}</div>
                        </div>
                      </div>
                      <span className="text-[10px] font-black uppercase px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200 shrink-0">
                        ✓ Autorizzato
                      </span>
                    </div>
                  );
                })}
              </div>

              <div className="pt-3 border-t border-gray-100 flex justify-end">
                <button
                  onClick={() => setIsHolidayModalOpen(false)}
                  className="px-4 py-2 bg-gray-900 hover:bg-gray-800 text-white font-bold text-xs rounded-xl transition cursor-pointer"
                >
                  Chiudi
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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
