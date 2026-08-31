import { LogOut, Home, KeyRound, X, Shield, RefreshCw, Network, Bell, CheckCircle2, FileText, Calendar, Check, Clock, Phone, Lightbulb, ListTodo } from 'lucide-react';
import { signOut, updatePassword, reauthenticateWithCredential, EmailAuthProvider } from 'firebase/auth';
import { auth, db } from '../services/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useState, useEffect, useRef, useMemo } from 'react';
import { isSoci, isCollaboratore } from '../pages/Impostazioni';
import { useNotifications } from '../contexts/NotificationContext';
import type { UserNotification } from '../utils/userNotificationService';
import NumeriInterniModal from './NumeriInterniModal';

interface UpcomingHolidayWork {
  id: string;
  dipendenteName: string;
  dipendenteEmail: string;
  data: string;
  motivo: string;
}

const formatRelativeTime = (isoString?: string): string => {
  if (!isoString) return '';
  const date = new Date(isoString);
  if (isNaN(date.getTime()) || date.getTime() === 0) return '';
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  if (diffMs < 0) {
    return 'Poco fa';
  }
  const diffMinutes = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMinutes < 1) return 'Adesso';
  if (diffMinutes < 60) return `${diffMinutes}m fa`;
  if (diffHours < 24) return `${diffHours}h fa`;
  if (diffDays === 1) return 'Ieri';
  if (diffDays < 7) return `${diffDays}gg fa`;
  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
};

const getNotificationGroup = (isoString?: string): 'Oggi' | 'Questa settimana' | 'Questo mese' | 'Mese scorso' | 'Più vecchie' => {
  if (!isoString) return 'Più vecchie';
  const date = new Date(isoString);
  if (isNaN(date.getTime()) || date.getTime() === 0) return 'Più vecchie';
  const now = new Date();
  
  const isSameDay = date.getFullYear() === now.getFullYear() &&
                    date.getMonth() === now.getMonth() &&
                    date.getDate() === now.getDate();
  if (isSameDay) return 'Oggi';

  const d1 = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const d2 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const diffDays = Math.floor((d2 - d1) / (1000 * 60 * 60 * 24));

  if (diffDays > 0 && diffDays <= 7) return 'Questa settimana';
  
  if (date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth()) {
    return 'Questo mese';
  }

  const monthDiff = (now.getFullYear() - date.getFullYear()) * 12 + (now.getMonth() - date.getMonth());
  if (monthDiff === 1) return 'Mese scorso';

  return 'Più vecchie';
};

export default function Navbar() {
  const navigate = useNavigate();
  const location = useLocation();

  const handleNav = (e: React.MouseEvent, path: string) => {
    if (e.button === 1 || e.ctrlKey || e.metaKey) {
      e.preventDefault();
      window.open(path, '_blank', 'noopener,noreferrer');
    } else if (e.button === 0) {
      navigate(path);
    }
  };

  const { user, isAdmin, isHR, isDev, myAssociatedName, userEmail, dipendenti } = useAuth();
  const { 
    totalPendingCount, 
    operativePendingCount,
    operativeNotifications,
    permissionState, 
    handleEnableNotifications,
    userNotifications,
    unreadUserNotificationsCount,
    markNotificationAsRead,
    markAllNotificationsAsRead
  } = useNotifications();

  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const [isNumeriInterniOpen, setIsNumeriInterniOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);

  const [notifFilter, setNotifFilter] = useState<'all' | 'unread' | 'read'>('all');
  const [visibleNotifLimit, setVisibleNotifLimit] = useState<number>(20);

  // Deduplicazione delle notifiche utente per evitare ripetizioni identiche a schermo
  const deduplicatedUserNotifs = useMemo(() => {
    const seen = new Set<string>();
    const res: UserNotification[] = [];
    userNotifications.forEach(n => {
      const normMsg = (n.messaggio || '').trim();
      const key = `${n.titolo}_${normMsg}_${n.link || ''}_${n.letta}`;
      if (!seen.has(key)) {
        seen.add(key);
        res.push(n);
      }
    });
    return res;
  }, [userNotifications]);

  // Suddivisione richieste operative: in attesa vs gestite
  const pendingOperativeItems = useMemo(() => operativeNotifications.filter(op => op.isPending), [operativeNotifications]);
  const managedOperativeItems = useMemo(() => operativeNotifications.filter(op => !op.isPending), [operativeNotifications]);

  // Conteggi totali perfettamente sincronizzati con gli elementi deduplicati a schermo
  const unreadUserNotifsCount = useMemo(() => deduplicatedUserNotifs.filter(n => !n.letta).length, [deduplicatedUserNotifs]);
  const readUserNotifsCount = useMemo(() => deduplicatedUserNotifs.filter(n => n.letta).length, [deduplicatedUserNotifs]);
  const totalReadCount = managedOperativeItems.length + readUserNotifsCount;
  const unreadTotal = unreadUserNotifsCount + pendingOperativeItems.length;
  const totalAllCount = unreadTotal + totalReadCount;

  // Flusso cronologico storico unificato (richieste gestite + notifiche personali)
  interface UnifiedHistoryItem {
    id: string;
    isOperative: boolean;
    titolo: string;
    messaggio: string;
    link?: string;
    createdAt: string;
    badgeLabel?: string;
    tipo?: string;
    letta: boolean;
    category?: string;
    userNotif?: UserNotification;
  }

  const filteredHistoryItems = useMemo((): UnifiedHistoryItem[] => {
    let list: UnifiedHistoryItem[] = [];

    if (notifFilter === 'unread') {
      list = deduplicatedUserNotifs
        .filter(n => !n.letta)
        .map(n => ({
          id: n.id || `un-${Math.random()}`,
          isOperative: false,
          titolo: n.titolo,
          messaggio: n.messaggio,
          link: n.link,
          createdAt: n.createdAt,
          tipo: n.tipo,
          letta: false,
          userNotif: n
        }));
    } else if (notifFilter === 'read') {
      const opManaged: UnifiedHistoryItem[] = managedOperativeItems.map(op => ({
        id: op.id,
        isOperative: true,
        titolo: op.titolo,
        messaggio: op.messaggio,
        link: op.link,
        createdAt: op.createdAt,
        badgeLabel: op.badgeLabel,
        category: op.category,
        letta: true
      }));

      const usrRead: UnifiedHistoryItem[] = deduplicatedUserNotifs
        .filter(n => n.letta)
        .map(n => ({
          id: n.id || `un-${Math.random()}`,
          isOperative: false,
          titolo: n.titolo,
          messaggio: n.messaggio,
          link: n.link,
          createdAt: n.createdAt,
          tipo: n.tipo,
          letta: true,
          userNotif: n
        }));

      list = [...opManaged, ...usrRead];
    } else {
      // 'all'
      const opManaged: UnifiedHistoryItem[] = managedOperativeItems.map(op => ({
        id: op.id,
        isOperative: true,
        titolo: op.titolo,
        messaggio: op.messaggio,
        link: op.link,
        createdAt: op.createdAt,
        badgeLabel: op.badgeLabel,
        category: op.category,
        letta: true
      }));

      const usrAll: UnifiedHistoryItem[] = deduplicatedUserNotifs.map(n => ({
        id: n.id || `un-${Math.random()}`,
        isOperative: false,
        titolo: n.titolo,
        messaggio: n.messaggio,
        link: n.link,
        createdAt: n.createdAt,
        tipo: n.tipo,
        letta: n.letta,
        userNotif: n
      }));

      list = [...opManaged, ...usrAll];
    }

    return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [deduplicatedUserNotifs, managedOperativeItems, notifFilter]);

  const visibleHistoryItems = useMemo(() => {
    return filteredHistoryItems.slice(0, visibleNotifLimit);
  }, [filteredHistoryItems, visibleNotifLimit]);

  const hasMoreNotifs = filteredHistoryItems.length > visibleNotifLimit;
  const remainingCount = filteredHistoryItems.length - visibleNotifLimit;

  // Raggruppamento temporale delle notifiche visibili
  const groupedHistoryItems = useMemo(() => {
    const groups: Record<'Oggi' | 'Questa settimana' | 'Questo mese' | 'Mese scorso' | 'Più vecchie', UnifiedHistoryItem[]> = {
      'Oggi': [],
      'Questa settimana': [],
      'Questo mese': [],
      'Mese scorso': [],
      'Più vecchie': []
    };
    visibleHistoryItems.forEach((item) => {
      const g = getNotificationGroup(item.createdAt);
      groups[g].push(item);
    });
    return groups;
  }, [visibleHistoryItems]);

  const shouldShowOperativePending = (notifFilter === 'all' || notifFilter === 'unread') && pendingOperativeItems.length > 0;

  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwError, setPwError] = useState('');
  const [pwSuccess, setPwSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  // Chiudi dropdown notifiche al click esterno
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(event.target as Node)) {
        setIsNotifOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Errore durante il logout:", error);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwError('');
    setPwSuccess('');

    if (newPassword !== confirmPassword) {
      setPwError('Le nuove password non coincidono.');
      return;
    }

    if (newPassword.length < 6) {
      setPwError('La password deve contenere almeno 6 caratteri.');
      return;
    }

    setLoading(true);

    try {
      if (user && user.email) {
        const credential = EmailAuthProvider.credential(user.email, oldPassword);
        await reauthenticateWithCredential(user, credential);
        await updatePassword(user, newPassword);

        setPwSuccess('Password aggiornata con successo!');
        setOldPassword('');
        setNewPassword('');
        setConfirmPassword('');

        setTimeout(() => {
          setIsPasswordModalOpen(false);
          setPwSuccess('');
        }, 1500);
      }
    } catch (err: any) {
      console.error(err);
      if (err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password') {
        setPwError('La vecchia password non è corretta.');
      } else {
        setPwError('Errore durante la modifica della password: ' + err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  if (!user) return null;

  const isSuggerimenti = location.pathname === '/suggerimenti';

  const getNotifIcon = (tipo: string) => {
    switch (tipo) {
      case 'ferie_approvate':
        return <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />;
      case 'presenze_approvate':
        return <FileText className="w-4 h-4 text-blue-600 shrink-0" />;
      case 'pianificazione_aggiornata':
        return <Calendar className="w-4 h-4 text-orange-600 shrink-0" />;
      case 'suggerimento_ricevuto':
        return <Lightbulb className="w-4 h-4 text-amber-500 shrink-0" />;
      case 'todo_assegnato':
        return <ListTodo className="w-4 h-4 text-indigo-600 shrink-0" />;
      case 'todo_completato':
        return <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />;
      default:
        return <Bell className="w-4 h-4 text-indigo-600 shrink-0" />;
    }
  };

  const handleNotifClick = (notif: UserNotification) => {
    if (notif.id && !notif.letta) {
      markNotificationAsRead(notif.id);
    }
    setIsNotifOpen(false);
    if (notif.link) {
      navigate(notif.link);
    }
  };

  return (
    <>
      <nav className="bg-white/80 backdrop-blur-md border-b border-gray-100 px-4 sm:px-6 py-2.5 flex justify-between items-center shadow-sm relative z-40 transition-all no-print print:hidden">
        <div className="flex items-center gap-3">
          <div 
            onClick={(e) => handleNav(e, '/')}
            onAuxClick={(e) => handleNav(e, '/')}
            onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
            className="flex items-center gap-3 cursor-pointer group select-none"
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
              onClick={(e) => handleNav(e, '/')}
              onAuxClick={(e) => handleNav(e, '/')}
              onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
              className="text-sm font-medium flex items-center gap-1 transition-colors animate-in fade-in duration-300 text-gray-600 hover:text-blue-600 cursor-pointer"
            >
              <Home className="w-4 h-4" /> <span className="hidden sm:inline">Dashboard</span>
            </button>
          )}

          <button 
            onClick={(e) => handleNav(e, '/organigramma')}
            onAuxClick={(e) => handleNav(e, '/organigramma')}
            onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
            className={`text-sm font-medium flex items-center gap-1 transition-colors animate-in fade-in duration-300 cursor-pointer ${
              location.pathname === '/organigramma' ? 'text-blue-600 font-bold' : 'text-gray-600 hover:text-blue-600'
            }`}
          >
            <Network className="w-4 h-4" /> <span className="hidden sm:inline">Organigramma</span>
          </button>

          <button 
            type="button"
            onClick={() => setIsNumeriInterniOpen(true)}
            className="text-sm font-medium flex items-center gap-1 transition-colors animate-in fade-in duration-300 text-gray-600 hover:text-blue-600 cursor-pointer"
            title="Rubrica Numeri Telefonici Interni"
          >
            <Phone className="w-4 h-4" /> <span className="hidden sm:inline">Numeri Interni</span>
          </button>

          {/* CAMPANELLA UNIFICATA CENTRO NOTIFICHE (Richieste Operative & Notifiche Personali) */}
          <div className="relative" ref={notifRef}>
            <button
              type="button"
              onClick={() => {
                if (!isNotifOpen) {
                  setNotifFilter(unreadTotal > 0 ? 'unread' : 'all');
                  setVisibleNotifLimit(20);
                }
                setIsNotifOpen(!isNotifOpen);
              }}
              className={`relative p-2 rounded-xl transition-all cursor-pointer ${
                isNotifOpen 
                  ? (operativePendingCount > 0 ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700') 
                  : (operativePendingCount > 0 ? 'text-red-600 hover:bg-red-50' : 'text-gray-600 hover:text-blue-600 hover:bg-blue-50')
              }`}
              title={
                operativePendingCount > 0 
                  ? `${operativePendingCount} richiesta/e da gestire in sospeso`
                  : unreadUserNotificationsCount > 0 
                    ? `${unreadUserNotificationsCount} nuova/e notifica/e personale/i` 
                    : 'Centro Notifiche'
              }
            >
              <Bell className="w-5 h-5" />
              {totalPendingCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4">
                  <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${operativePendingCount > 0 ? 'bg-red-400' : 'bg-blue-400'}`}></span>
                  <span className={`relative inline-flex rounded-full h-4 w-4 text-[9px] font-black text-white items-center justify-center border border-white shadow-xs ${operativePendingCount > 0 ? 'bg-red-600' : 'bg-blue-600'}`}>
                    {totalPendingCount > 99 ? '99+' : totalPendingCount}
                  </span>
                </span>
              )}
            </button>

            {/* DROPDOWN NOTIFICHE */}
            {isNotifOpen && (
              <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden z-50 animate-in fade-in slide-in-from-top-2 duration-200 flex flex-col">
                {/* Header */}
                <div className={`p-3.5 text-white flex items-center justify-between ${operativePendingCount > 0 ? 'bg-gradient-to-r from-gray-900 via-gray-900 to-red-950' : 'bg-gradient-to-r from-gray-900 to-gray-800'}`}>
                  <div className="flex items-center gap-2">
                    <Bell className={`w-4 h-4 ${operativePendingCount > 0 ? 'text-red-400' : 'text-blue-400'}`} />
                    <span className="font-extrabold text-xs tracking-wide uppercase">Centro Notifiche</span>
                    {unreadTotal > 0 && (
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-black text-white ${operativePendingCount > 0 ? 'bg-red-500' : 'bg-blue-500'}`}>
                        {unreadTotal} novità
                      </span>
                    )}
                  </div>
                  {unreadUserNotificationsCount > 0 && (
                    <button
                      onClick={() => userEmail && markAllNotificationsAsRead(userEmail)}
                      className="text-[11px] font-semibold text-gray-300 hover:text-white flex items-center gap-1 transition-colors cursor-pointer"
                      title="Segna tutte le notifiche personali come lette"
                    >
                      <Check className="w-3.5 h-3.5" /> Segna lette
                    </button>
                  )}
                </div>

                {/* Tab Filtri Rapidi */}
                <div className="bg-gray-50/90 px-3 py-2 border-b border-gray-100 flex items-center justify-between gap-1 text-xs select-none">
                  <div className="flex items-center gap-1 w-full">
                    <button
                      type="button"
                      onClick={() => { setNotifFilter('all'); setVisibleNotifLimit(20); }}
                      className={`flex-1 py-1 px-2 rounded-lg font-bold transition-all text-[11px] text-center cursor-pointer ${
                        notifFilter === 'all'
                          ? 'bg-white text-gray-900 shadow-2xs border border-gray-200 font-black'
                          : 'text-gray-500 hover:text-gray-800 hover:bg-gray-100/80'
                      }`}
                    >
                      Tutte ({totalAllCount})
                    </button>
                    <button
                      type="button"
                      onClick={() => { setNotifFilter('unread'); setVisibleNotifLimit(20); }}
                      className={`flex-1 py-1 px-2 rounded-lg font-bold transition-all text-[11px] text-center cursor-pointer flex items-center justify-center gap-1 ${
                        notifFilter === 'unread'
                          ? 'bg-white text-blue-700 shadow-2xs border border-blue-200 font-black'
                          : 'text-gray-500 hover:text-gray-800 hover:bg-gray-100/80'
                      }`}
                    >
                      <span>Non lette</span>
                      {unreadTotal > 0 && (
                        <span className={`px-1.5 py-0.2 rounded-full text-[9px] font-black text-white shrink-0 ${pendingOperativeItems.length > 0 ? 'bg-red-500' : 'bg-blue-600'}`}>
                          {unreadTotal}
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setNotifFilter('read'); setVisibleNotifLimit(20); }}
                      className={`flex-1 py-1 px-2 rounded-lg font-bold transition-all text-[11px] text-center cursor-pointer ${
                        notifFilter === 'read'
                          ? 'bg-white text-gray-900 shadow-2xs border border-gray-200 font-black'
                          : 'text-gray-500 hover:text-gray-800 hover:bg-gray-100/80'
                      }`}
                    >
                      Lette ({totalReadCount})
                    </button>
                  </div>
                </div>

                {/* Lista Notifiche Scorrevole */}
                <div className="max-h-[440px] overflow-y-auto divide-y divide-gray-50">
                  {/* Sezione vuota totale */}
                  {(!shouldShowOperativePending && visibleHistoryItems.length === 0) ? (
                    <div className="p-8 text-center text-gray-400">
                      <Bell className="w-8 h-8 mx-auto mb-2 opacity-30" />
                      <p className="text-xs font-semibold">Nessuna notifica presente</p>
                      <p className="text-[11px] text-gray-400 mt-0.5">
                        {notifFilter === 'unread' 
                          ? 'Ottimo lavoro! Non hai notifiche o richieste in sospeso.'
                          : 'Non ci sono comunicazioni per questo filtro.'}
                      </p>
                    </div>
                  ) : (
                    <>
                      {/* RICHIESTE OPERATIVE DA GESTIRE (IN ATTESA) */}
                      {shouldShowOperativePending && (
                        <div>
                          <div className="bg-red-50/70 px-3.5 py-1.5 border-b border-red-100/70 flex items-center justify-between text-[10px] font-black text-red-800 uppercase tracking-wider">
                            <span>🔴 Richieste da Gestire ({pendingOperativeItems.length})</span>
                          </div>
                          {pendingOperativeItems.map(op => (
                            <div
                              key={op.id}
                              onClick={() => {
                                setIsNotifOpen(false);
                                navigate(op.link);
                              }}
                              className="p-3.5 flex items-start gap-3 bg-red-50/30 hover:bg-red-100/60 border-l-4 border-red-500 transition-colors cursor-pointer"
                            >
                              <div className="mt-0.5 p-2 rounded-xl bg-red-100 text-red-600 border border-red-200 shrink-0 shadow-2xs">
                                <Bell className="w-4 h-4 text-red-600" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between gap-1 mb-0.5">
                                  <h4 className="text-xs font-black text-red-950 truncate">
                                    {op.titolo}
                                  </h4>
                                  {op.badgeLabel && (
                                    <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-red-100 text-red-700 shrink-0">
                                      {op.badgeLabel}
                                    </span>
                                  )}
                                </div>
                                <p className="text-[11px] text-red-800/90 line-clamp-2 leading-relaxed">
                                  {op.messaggio}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* NOTIFICHE E RICHIESTE STORICHE RAGGRUPPATE PER PERIODO TEMPORALE */}
                      {(['Oggi', 'Questa settimana', 'Questo mese', 'Mese scorso', 'Più vecchie'] as const).map(groupKey => {
                        const items = groupedHistoryItems[groupKey];
                        if (items.length === 0) return null;

                        return (
                          <div key={groupKey}>
                            <div className="bg-gray-50/80 px-3.5 py-1.5 border-b border-gray-100 flex items-center justify-between text-[10px] font-black text-gray-500 uppercase tracking-wider">
                              <span>📅 {groupKey} ({items.length})</span>
                            </div>
                            {items.map((item) => {
                              if (item.isOperative) {
                                return (
                                  <div
                                    key={item.id}
                                    className="p-3.5 flex items-start gap-3 bg-white border-l-4 border-emerald-400 select-text cursor-default"
                                  >
                                    <div className="mt-0.5 p-2 rounded-xl bg-emerald-50 border border-emerald-100 shrink-0 shadow-2xs">
                                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center justify-between gap-1 mb-0.5">
                                        <h4 className="text-xs font-bold text-gray-800 truncate">
                                          {item.titolo}
                                        </h4>
                                        <span className="text-[10px] text-gray-400 font-medium shrink-0 flex items-center gap-0.5">
                                          <Clock className="w-2.5 h-2.5" />
                                          {formatRelativeTime(item.createdAt)}
                                        </span>
                                      </div>
                                      <p className="text-[11px] text-gray-600 line-clamp-2 leading-relaxed">
                                        {item.messaggio}
                                      </p>
                                      {item.badgeLabel && (
                                        <div className="mt-1.5 flex items-center">
                                          <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-md border ${
                                            item.badgeLabel.includes('✓') || item.badgeLabel.toLowerCase().includes('approvat') || item.badgeLabel.toLowerCase().includes('gestit')
                                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                              : item.badgeLabel.includes('❌') || item.badgeLabel.toLowerCase().includes('rifiut')
                                                ? 'bg-rose-50 text-rose-700 border-rose-200'
                                                : 'bg-gray-100 text-gray-700 border-gray-200'
                                          }`}>
                                            {item.badgeLabel}
                                          </span>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                );
                              }

                              const n = item.userNotif!;
                              const isUnread = !n.letta;
                              return (
                                <div
                                  key={item.id}
                                  onClick={() => handleNotifClick(n)}
                                  className={`p-3.5 flex items-start gap-3 transition-colors cursor-pointer ${
                                    isUnread 
                                      ? 'bg-blue-50/30 border-l-4 border-blue-500 hover:bg-blue-50/60' 
                                      : 'bg-white hover:bg-gray-50'
                                  }`}
                                  title={n.link ? "Clicca per aprire la sezione" : undefined}
                                >
                                  <div className="mt-0.5 p-2 rounded-xl bg-gray-50 border border-gray-100 shrink-0 shadow-2xs">
                                    {getNotifIcon(n.tipo)}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between gap-1 mb-0.5">
                                      <h4 className={`text-xs truncate ${isUnread ? 'font-black text-gray-900' : 'font-bold text-gray-700'}`}>
                                        {n.titolo}
                                      </h4>
                                      <span className="text-[10px] text-gray-400 font-medium shrink-0 flex items-center gap-0.5">
                                        <Clock className="w-2.5 h-2.5" />
                                        {formatRelativeTime(n.createdAt)}
                                      </span>
                                    </div>
                                    <p className="text-[11px] text-gray-600 line-clamp-2 leading-relaxed">
                                      {n.messaggio}
                                    </p>
                                  </div>
                                  {isUnread && (
                                    <span className="w-2 h-2 rounded-full bg-blue-600 shrink-0 mt-1.5" title="Non letta" />
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}

                      {/* PULSANTE CARICA ALTRE NOTIFICHE */}
                      {hasMoreNotifs && (
                        <div className="p-2.5 bg-gray-50/70 text-center border-t border-gray-100">
                          <button
                            type="button"
                            onClick={() => setVisibleNotifLimit(prev => prev + 20)}
                            className="w-full py-1.5 px-3 bg-white hover:bg-gray-100 text-gray-700 font-bold rounded-xl text-xs border border-gray-200 shadow-2xs transition-colors cursor-pointer"
                          >
                            Mostra altre {Math.min(20, remainingCount)} notifiche ({remainingCount} rimanenti) ↓
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>

                {permissionState === 'default' && (
                  <div className="p-3 bg-indigo-50 border-t border-indigo-100 flex items-center justify-between gap-2">
                    <span className="text-[11px] text-indigo-900 font-medium">Vuoi ricevere avvisi Windows sul desktop?</span>
                    <button
                      onClick={handleEnableNotifications}
                      className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-[11px] font-bold transition shadow-xs shrink-0 cursor-pointer"
                    >
                      Attiva
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* PULSANTE ATTIVAZIONE NOTIFICHE DESKTOP SE NON ANCORA ABILITATE */}
          {permissionState === 'default' && (
            <button
              type="button"
              onClick={handleEnableNotifications}
              className="hidden md:flex items-center gap-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 px-2.5 py-1 rounded-xl text-xs font-bold transition-all cursor-pointer shadow-2xs active:scale-95"
              title="Attiva le notifiche desktop di Windows per ricevere avvisi immediati su ferie, presenze e richieste"
            >
              <Bell className="w-3.5 h-3.5 text-indigo-600 animate-bounce" />
              <span>Attiva Notifiche Desktop</span>
            </button>
          )}

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
                  <span className="text-sm font-bold text-gray-800 leading-tight">
                    {myAssociatedName || user.email}
                  </span>
                  <span className="text-[11px] font-bold text-gray-400 leading-tight">
                    {isDev ? 'Sviluppatore' : isAdmin ? 'Amministratore' : isHR ? 'Ufficio HR' : isCollaboratore(myAssociatedName || userEmail, dipendenti) ? 'Collaboratore' : 'Dipendente'}
                  </span>
                </>
              )}
            </div>

            <div className="flex items-center gap-1">
              <button 
                onClick={() => setIsPasswordModalOpen(true)}
                title="Cambia password"
                className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-all cursor-pointer"
              >
                <KeyRound className="w-4 h-4" />
              </button>

              <button 
                onClick={handleLogout}
                title="Logout"
                className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Modal Elenco Festivi Autorizzati nei prossimi 7 giorni (Solo Soci / Admin) */}
      {isHolidayModalOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4 no-print transition-all">
          <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-lg overflow-hidden transform scale-100 transition-all border border-amber-100">
            <div className="bg-gradient-to-r from-amber-500 to-amber-600 p-5 flex justify-between items-center text-white">
              <h3 className="font-extrabold text-lg flex items-center gap-2">
                <Shield className="w-5 h-5" /> Presenze Festivi Autorizzate (Prossimi 7gg)
              </h3>
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

      {/* MODALE NUMERI TELEFONICI INTERNI */}
      <NumeriInterniModal 
        isOpen={isNumeriInterniOpen} 
        onClose={() => setIsNumeriInterniOpen(false)} 
      />

    </>
  );
}
