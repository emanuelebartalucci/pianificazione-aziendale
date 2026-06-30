import { useState, useEffect, useMemo } from 'react';
import { Briefcase, Calendar, Settings, FileText, MessageSquare, Plus, Trash2, Megaphone, X, Users, CalendarDays } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../services/firebase';
import { collection, addDoc, doc, deleteDoc, query, orderBy, where, getDoc, getDocs } from 'firebase/firestore';
import ConfirmModal from '../components/ConfirmModal';
import ClimaModal from '../components/ClimaModal';
import QuestionnaireModal from '../components/QuestionnaireModal';
import { isSoci, isCollaboratore } from './Impostazioni';

interface Announcement {
  id: string;
  titolo: string;
  contenuto: string;
  autore: 'HR' | 'Direzione';
  data: string;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { isAdmin, isHR, myAssociatedName, user, dipendenti } = useAuth();

  // States per le comunicazioni
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newAuthor, setNewAuthor] = useState<'HR' | 'Direzione'>('Direzione');
  const [loading, setLoading] = useState(false);
  const [isClimaModalOpen, setIsClimaModalOpen] = useState(false);
  const [activeQuestionnaire, setActiveQuestionnaire] = useState<any | null>(null);
  const [hasCompletedSurvey, setHasCompletedSurvey] = useState(true);
  const [hasSkippedSurvey, setHasSkippedSurvey] = useState(false);

  const isQuestionnaireOpen = !!(activeQuestionnaire && !hasCompletedSurvey && !hasSkippedSurvey);

  // Stati per i badge di notifica HR (solo se isHR && !isAdmin)
  const [pendingFerieCount, setPendingFerieCount] = useState(0);
  const [pendingPresenzeCount, setPendingPresenzeCount] = useState(0);
  const [pendingSuggerimentiCount, setPendingSuggerimentiCount] = useState(0);
  const [myMaternityLeaves, setMyMaternityLeaves] = useState<any[]>([]);

  const [toast, setToast] = useState<{ message: string; type: 'success' | 'warning' | 'error' } | null>(null);

  const showToast = (message: string, type: 'success' | 'warning' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(null);
    }, 4500);
  };

  // Stato per la modale di conferma
  const [confirmConfig, setConfirmConfig] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {}
  });

  const triggerConfirm = (title: string, message: string, onConfirm: () => void) => {
    setConfirmConfig({
      isOpen: true,
      title,
      message,
      onConfirm: () => {
        onConfirm();
        setConfirmConfig(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  // Controllo per la comparsa randomica del questionario sul clima (esclusi i soci)
  useEffect(() => {
    if (isSoci(myAssociatedName)) {
      return; // Non mostrare mai ai soci proprietari
    }

    const lastAnswered = localStorage.getItem('clima_answered_date');
    const todayStr = new Date().toDateString();
    
    if (lastAnswered !== todayStr) {
      // 15% di probabilità di mostrare il pop-up all'accesso (in media ~1 volta ogni 7-8 giorni lavorativi per risorsa)
      const show = Math.random() < 0.15;
      if (show) {
        setIsClimaModalOpen(true);
      }
    }
  }, [myAssociatedName]);

  const loadDashboardData = async () => {
    try {
      // 1. Questionario
      let activeSurvey: any = null;
      if (!isSoci(myAssociatedName)) {
        const docSnap = await getDoc(doc(db, 'configurazioni', 'questionario'));
        if (docSnap.exists()) {
          const data = docSnap.data();
          if (data.active) {
            activeSurvey = data;
            setActiveQuestionnaire(data);
          } else {
            setActiveQuestionnaire(null);
          }
        } else {
          setActiveQuestionnaire(null);
        }
      }

      // 2. Questionario completato
      if (activeSurvey && user?.uid) {
        const qComp = query(
          collection(db, 'questionari_completati'),
          where('userId', '==', user.uid),
          where('questionnaireId', '==', activeSurvey.id)
        );
        const compSnap = await getDocs(qComp);
        setHasCompletedSurvey(!compSnap.empty);
      } else {
        setHasCompletedSurvey(true);
      }

      // 3. Comunicazioni
      const noticesSnap = await getDocs(query(collection(db, 'comunicazioni'), orderBy('createdAt', 'desc')));
      const listNotices: Announcement[] = [];
      noticesSnap.forEach(docSnap => {
        listNotices.push({
          id: docSnap.id,
          ...docSnap.data()
        } as Announcement);
      });
      setAnnouncements(listNotices);

      // 4. Maternità approvate
      if (myAssociatedName) {
        const qMaternity = query(
          collection(db, 'richieste_ferie'),
          where('dipendenteName', '==', myAssociatedName),
          where('tipo', '==', 'maternita'),
          where('stato', '==', 'Approvato')
        );
        const maternitySnap = await getDocs(qMaternity);
        const listMat: any[] = [];
        maternitySnap.forEach(docSnap => {
          const data = docSnap.data();
          listMat.push({
            id: docSnap.id,
            dataInizio: data.dataInizio || data.data || '',
            dataFine: data.dataFine || data.data || '',
          });
        });
        setMyMaternityLeaves(listMat);
      } else {
        setMyMaternityLeaves([]);
      }

      // 5. Notifiche HR
      if (isHR) {
        const [ferieSnap, presenzeSnap, weekendSnap, sugSnap] = await Promise.all([
          getDocs(query(collection(db, 'richieste_ferie'), where('stato', '==', 'In attesa'))),
          getDocs(query(collection(db, 'presenze'), where('stato', '==', 'Inviato'))),
          getDocs(query(collection(db, 'richieste_weekend'), where('stato', '==', 'In attesa'))),
          getDocs(collection(db, 'suggerimenti'))
        ]);

        const todayStr = new Date().toLocaleDateString('sv-SE');
        let pendingFerie = 0;
        ferieSnap.forEach(docSnap => {
          const data = docSnap.data();
          const dateLimit = data.dataFine || data.dataInizio || data.data || '';
          if (!dateLimit || dateLimit >= todayStr) {
            pendingFerie++;
          }
        });
        setPendingFerieCount(pendingFerie);
        setPendingPresenzeCount(presenzeSnap.size + weekendSnap.size);
        setPendingSuggerimentiCount(sugSnap.size);
      } else {
        setPendingFerieCount(0);
        setPendingPresenzeCount(0);
        setPendingSuggerimentiCount(0);
      }
    } catch (err) {
      console.error("Errore caricamento dati Dashboard:", err);
    }
  };

  useEffect(() => {
    loadDashboardData();

    const handleRefresh = () => {
      loadDashboardData();
    };
    window.addEventListener('app-refresh-dashboard', handleRefresh);
    return () => {
      window.removeEventListener('app-refresh-dashboard', handleRefresh);
    };
  }, [myAssociatedName, isHR, isAdmin, user?.uid]);

  const handleCreateNotice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newContent.trim()) return;

    setLoading(true);
    try {
      const today = new Date();
      const dateStr = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`;
      
      await addDoc(collection(db, 'comunicazioni'), {
        titolo: newTitle.trim(),
        contenuto: newContent.trim(),
        autore: newAuthor,
        data: dateStr,
        createdAt: new Date().toISOString()
      });
      loadDashboardData();

      setNewTitle('');
      setNewContent('');
      setNewAuthor('Direzione');
      setIsModalOpen(false);
      showToast("Avviso pubblicato con successo!");
    } catch (err) {
      console.error("Errore nella pubblicazione dell'avviso:", err);
      showToast("Errore durante la pubblicazione.", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteNotice = (id: string, titolo: string) => {
    triggerConfirm(
      "Elimina Comunicazione",
      `Sei sicuro di voler eliminare la comunicazione "${titolo}"?`,
      async () => {
        try {
          await deleteDoc(doc(db, 'comunicazioni', id));
          loadDashboardData();
        } catch (err) {
          console.error("Errore nell'eliminazione della comunicazione:", err);
        }
      }
    );
  };

  // Promemoria automatico registro presenze (ultimi 2 giorni del mese e fino al 5 del mese successivo)
  const displayAnnouncements = useMemo(() => {
    const today = new Date();
    const y = today.getFullYear();
    const m = today.getMonth();
    const d = today.getDate();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    
    const isUserCollaboratore = isCollaboratore(myAssociatedName, dipendenti);
    const isUserSocio = isSoci(myAssociatedName);
    const isUserDipendente = myAssociatedName && !isUserCollaboratore && !isUserSocio;

    const list = [...announcements];

    // Reminders are not visible to partners (soci)
    if (isUserSocio) {
      return list;
    }

    // 1. Employee reminder
    // Visible only to dipendente, from last 2 days of the month to the 2nd of the next month (inclusive)
    const showEmployeeReminder = isUserDipendente && ((d >= daysInMonth - 2) || (d <= 2));
    if (showEmployeeReminder) {
      const targetMonthIndex = d <= 2 ? (m === 0 ? 11 : m - 1) : m;
      const targetYear = d <= 2 && m === 0 ? y - 1 : y;

      const targetMonthStr = String(targetMonthIndex + 1).padStart(2, '0');
      const firstDayOfMonthStr = `${targetYear}-${targetMonthStr}-01`;
      const lastDayVal = new Date(targetYear, targetMonthIndex + 1, 0).getDate();
      const lastDayOfMonthStr = `${targetYear}-${targetMonthStr}-${String(lastDayVal).padStart(2, '0')}`;

      const isFullyCoveredByMaternity = myMaternityLeaves.some(leave => {
        const start = leave.dataInizio;
        const end = leave.dataFine;
        return start && end && start <= firstDayOfMonthStr && end >= lastDayOfMonthStr;
      });

      if (!isFullyCoveredByMaternity) {
        const nomeMese = [
          'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
          'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'
        ][targetMonthIndex];

        list.unshift({
          id: 'system-reminder-presenze',
          titolo: '⚠️ Promemoria: Compilazione Registro Presenze',
          contenuto: `Si ricorda a tutti i dipendenti di compilare, verificare ed inviare il proprio foglio presenze per il mese di ${nomeMese} ${targetYear} all'HR per l'approvazione delle buste paga.`,
          autore: 'HR',
          data: `${String(d).padStart(2, '0')}/${String(m + 1).padStart(2, '0')}/${y}`
        });
      }
    }

    // 2. Collaborator reminder
    // Visible only to collaborator, from the 10th to the 20th of each month (inclusive)
    const showCollaboratorReminder = isUserCollaboratore && (d >= 10 && d <= 20);
    if (showCollaboratorReminder) {
      list.unshift({
        id: 'system-reminder-collaboratori',
        titolo: '⚠️ Promemoria Adempimenti Collaboratori',
        contenuto: `Si ricorda ai collaboratori i seguenti adempimenti mensili:\n\n• entro il 15 di ogni mese: trasmettere la bozza della fattura per verifica ed approvazione da parte del reparto competente;\n• entro il 20 di ogni mese: previa conferma, procedere con l’emissione della fattura elettronica.`,
        autore: 'HR',
        data: `${String(d).padStart(2, '0')}/${String(m + 1).padStart(2, '0')}/${y}`
      });
    }
    
    return list;
  }, [announcements, myAssociatedName, dipendenti, myMaternityLeaves]);

  const welcomeName = (() => {
    if (!myAssociatedName) return user?.email || 'Utente';
    const parts = myAssociatedName.trim().split(/\s+/);
    return parts.length > 1 ? parts[parts.length - 1] : myAssociatedName;
  })();
  const showAdminSettings = isAdmin;
  const canPublish = isAdmin || isHR;

  return (
    <div className="max-w-7xl mx-auto px-4 mt-8 flex flex-col gap-6">
      
      {/* Intestazione di benvenuto */}
      <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] shadow-sm p-6 sm:p-8 border border-white/50 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-extrabold text-indigo-600 tracking-tight">
            Ciao, {welcomeName}! Benvenuto nel tuo portale di lavoro.
          </h1>

        </div>
      </div>

      {/* Griglia a due colonne: Operational links a sinistra, News a destra */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* COLONNA SINISTRA: SEZIONI OPERATIVE (2/3 di larghezza) */}
        <div className="lg:col-span-7 space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-6">
            
            {/* Pianificazione Commesse */}
            <div 
              onClick={() => navigate('/commesse')} 
              className="bg-white/80 backdrop-blur-xl p-4 sm:p-5 xl:p-5 rounded-[1.5rem] md:rounded-[2rem] shadow-md border border-white/50 hover:shadow-xl hover:-translate-y-1 transition-all cursor-pointer group flex flex-col justify-between aspect-square w-full"
            >
              <div className="w-12 h-12 sm:w-14 sm:h-14 xl:w-16 xl:h-16 shrink-0 bg-blue-100 text-blue-600 rounded-2xl flex items-center justify-center group-hover:bg-blue-600 group-hover:text-white transition-colors">
                <Briefcase className="w-6 h-6 sm:w-7 sm:h-7 xl:w-8 xl:h-8" />
              </div>
              <div>
                <h2 className="text-sm sm:text-base xl:text-lg font-extrabold text-gray-800 mt-2">Pianificazione Commesse</h2>
                <p className="hidden xl:block text-xs font-semibold text-gray-500 mt-1.5 leading-tight">Gestisci e visualizza i tuoi impegni settimanali e i progetti.</p>
              </div>
            </div>
            
            {/* Pianificazione Personale */}
            <div 
              onClick={() => navigate('/pianificazione-personale')} 
              className="bg-white/80 backdrop-blur-xl p-4 sm:p-5 xl:p-5 rounded-[1.5rem] md:rounded-[2rem] shadow-md border border-white/50 hover:shadow-xl hover:-translate-y-1 transition-all cursor-pointer group flex flex-col justify-between aspect-square w-full"
            >
              <div className="w-12 h-12 sm:w-14 sm:h-14 xl:w-16 xl:h-16 shrink-0 bg-orange-100 text-orange-600 rounded-2xl flex items-center justify-center group-hover:bg-orange-600 group-hover:text-white transition-colors">
                <Users className="w-6 h-6 sm:w-7 sm:h-7 xl:w-8 xl:h-8" />
              </div>
              <div>
                <h2 className="text-sm sm:text-base xl:text-lg font-extrabold text-gray-800 mt-2">Pianificazione Personale</h2>
                <p className="hidden xl:block text-xs font-semibold text-gray-500 mt-1.5 leading-tight">Pianifica il personale sulle commesse e controlla i carichi di lavoro.</p>
              </div>
            </div>
            
            {/* Piano Ferie */}
            <div 
              onClick={() => navigate('/ferie')} 
              className="bg-white/80 backdrop-blur-xl p-4 sm:p-5 xl:p-5 rounded-[1.5rem] md:rounded-[2rem] shadow-md border border-white/50 hover:shadow-xl hover:-translate-y-1 transition-all cursor-pointer group flex flex-col justify-between aspect-square w-full"
            >
              <div className="w-12 h-12 sm:w-14 sm:h-14 xl:w-16 xl:h-16 shrink-0 bg-green-100 text-green-600 rounded-2xl flex items-center justify-center group-hover:bg-green-600 group-hover:text-white transition-colors relative">
                <Calendar className="w-6 h-6 sm:w-7 sm:h-7 xl:w-8 xl:h-8" />
                {isHR && pendingFerieCount > 0 && (
                  <span className="absolute -top-1 -right-1 flex h-5 w-5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-5 w-5 bg-red-500 text-[10px] font-black text-white items-center justify-center border border-white">
                      {pendingFerieCount}
                    </span>
                  </span>
                )}
              </div>
              <div>
                <h2 className="text-sm sm:text-base xl:text-lg font-extrabold text-gray-800 mt-2">Piano Ferie</h2>
                <p className="hidden xl:block text-xs font-semibold text-gray-500 mt-1.5 leading-tight">Richiedi giorni di ferie o assenze e controlla il calendario.</p>
              </div>
            </div>

            {/* Registro Presenze */}
            <div 
              onClick={() => navigate('/presenze')} 
              className="bg-white/80 backdrop-blur-xl p-4 sm:p-5 xl:p-5 rounded-[1.5rem] md:rounded-[2rem] shadow-md border border-white/50 hover:shadow-xl hover:-translate-y-1 transition-all cursor-pointer group flex flex-col justify-between aspect-square w-full"
            >
              <div className="w-12 h-12 sm:w-14 sm:h-14 xl:w-16 xl:h-16 shrink-0 bg-indigo-100 text-indigo-600 rounded-2xl flex items-center justify-center group-hover:bg-indigo-600 group-hover:text-white transition-colors relative">
                <FileText className="w-6 h-6 sm:w-7 sm:h-7 xl:w-8 xl:h-8" />
                {isHR && pendingPresenzeCount > 0 && (
                  <span className="absolute -top-1 -right-1 flex h-5 w-5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-5 w-5 bg-red-500 text-[10px] font-black text-white items-center justify-center border border-white">
                      {pendingPresenzeCount}
                    </span>
                  </span>
                )}
              </div>
              <div>
                <h2 className="text-sm sm:text-base xl:text-lg font-extrabold text-gray-800 mt-2">Registro Presenze</h2>
                <p className="hidden xl:block text-xs font-semibold text-gray-500 mt-1.5 leading-tight">Compila il rapportino mensile delle ore e dei rimborsi trasferte.</p>
              </div>
            </div>

            {/* Prenotazione Risorse */}
            <div 
              onClick={() => navigate('/prenotazioni')} 
              className="bg-white/80 backdrop-blur-xl p-4 sm:p-5 xl:p-5 rounded-[1.5rem] md:rounded-[2rem] shadow-md border border-white/50 hover:shadow-xl hover:-translate-y-1 transition-all cursor-pointer group flex flex-col justify-between aspect-square w-full"
            >
              <div className="w-12 h-12 sm:w-14 sm:h-14 xl:w-16 xl:h-16 shrink-0 bg-teal-100 text-teal-600 rounded-2xl flex items-center justify-center group-hover:bg-teal-600 group-hover:text-white transition-colors">
                <CalendarDays className="w-6 h-6 sm:w-7 sm:h-7 xl:w-8 xl:h-8" />
              </div>
              <div>
                <h2 className="text-sm sm:text-base xl:text-lg font-extrabold text-gray-800 mt-2">Prenotazioni</h2>
                <p className="hidden xl:block text-xs font-semibold text-gray-500 mt-1.5 leading-tight">Prenota sale riunioni, auto aziendali o gestisci i PC CAD condivisi.</p>
              </div>
            </div>

            {/* Cassetta delle Idee */}
            <div 
              onClick={() => navigate('/suggerimenti')} 
              className="bg-white/80 backdrop-blur-xl p-4 sm:p-5 xl:p-5 rounded-[1.5rem] md:rounded-[2rem] shadow-md border border-white/50 hover:shadow-xl hover:-translate-y-1 transition-all cursor-pointer group flex flex-col justify-between aspect-square w-full"
            >
              <div className="w-12 h-12 sm:w-14 sm:h-14 xl:w-16 xl:h-16 shrink-0 bg-purple-100 text-purple-600 rounded-2xl flex items-center justify-center group-hover:bg-purple-600 group-hover:text-white transition-colors relative">
                <MessageSquare className="w-6 h-6 sm:w-7 sm:h-7 xl:w-8 xl:h-8" />
                {isHR ? (
                  pendingSuggerimentiCount > 0 && (
                    <span className="absolute -top-1 -right-1 flex h-5 w-5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-5 w-5 bg-red-500 text-[10px] font-black text-white items-center justify-center border border-white">
                        {pendingSuggerimentiCount}
                      </span>
                    </span>
                  )
                ) : (
                  !isSoci(myAssociatedName) && activeQuestionnaire && activeQuestionnaire.active && !hasCompletedSurvey && (
                    <span className="absolute -top-1 -right-1 flex h-5 w-5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-5 w-5 bg-red-500 text-[10px] font-black text-white items-center justify-center border border-white">
                        1
                      </span>
                    </span>
                  )
                )}
              </div>
              <div>
                <h2 className="text-sm sm:text-base xl:text-lg font-extrabold text-gray-800 mt-2">Cassetta delle Idee</h2>
                <p className="hidden xl:block text-xs font-semibold text-gray-500 mt-1.5 leading-tight">Invia suggerimenti e partecipa in forma anonima alla valutazione clima.</p>
              </div>
            </div>

            {/* Impostazioni Admin */}
            {showAdminSettings && (
              <div 
                onClick={() => navigate('/impostazioni')} 
                className="bg-white/80 backdrop-blur-xl p-4 sm:p-5 xl:p-5 rounded-[1.5rem] md:rounded-[2rem] shadow-md border border-white/50 hover:shadow-xl hover:-translate-y-1 transition-all cursor-pointer group flex flex-col justify-between aspect-square w-full"
              >
                <div className="w-12 h-12 sm:w-14 sm:h-14 xl:w-16 xl:h-16 shrink-0 bg-gray-100 text-gray-600 rounded-2xl flex items-center justify-center group-hover:bg-gray-800 group-hover:text-white transition-colors">
                  <Settings className="w-6 h-6 sm:w-7 sm:h-7 xl:w-8 xl:h-8" />
                </div>
                <div>
                  <h2 className="text-sm sm:text-base xl:text-lg font-extrabold text-gray-800 mt-2">Impostazioni Admin</h2>
                  <p className="hidden xl:block text-xs font-semibold text-gray-500 mt-1.5 leading-tight">Gestisci ruoli, anagrafica dipendenti e catalogo commesse.</p>
                </div>
              </div>
            )}
            
          </div>
        </div>

        {/* COLONNA DESTRA: BACHECA NEWS (5/12 di larghezza) */}
        <div className="lg:col-span-5">
          <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] shadow-lg border border-white/50 p-6 flex flex-col h-full">
            <div className="flex justify-between items-center pb-4 border-b border-gray-100 mb-4">
              <h3 className="text-xl font-black text-gray-900 flex items-center gap-2">
                <Megaphone className="w-5 h-5 text-indigo-600" />
                <span>Bacheca News</span>
              </h3>
              {canPublish && (
                <button
                  onClick={() => setIsModalOpen(true)}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white p-2 rounded-xl transition shadow active:scale-95 flex items-center justify-center"
                  title="Nuova Comunicazione"
                >
                  <Plus className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Elenco comunicazioni */}
            <div className="space-y-4 flex-1">
              {displayAnnouncements.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center py-12 text-gray-400">
                  <Megaphone className="w-10 h-10 stroke-[1.5] opacity-50 mb-2" />
                  <p className="text-sm font-bold italic">Nessuna comunicazione pubblicata.</p>
                </div>
              ) : (
                displayAnnouncements.map(ann => {
                  const isHRAuthor = ann.autore === 'HR';
                  const isReminder = ann.id.startsWith('system-reminder-');
                  return (
                    <div 
                      key={ann.id} 
                      className={`p-5 rounded-2xl shadow-sm hover:shadow-md transition flex flex-col justify-between gap-3 relative group/item ${
                        isReminder 
                          ? 'bg-amber-50/80 border-l-4 border-l-amber-500 border-y border-r border-amber-200/70' 
                          : 'bg-white/60 border border-gray-100'
                      }`}
                    >
                      <div>
                        <div className="flex justify-between items-center gap-2 pr-8">
                          <span className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full ${
                            isReminder 
                              ? 'bg-amber-100 text-amber-700 border border-amber-200' 
                              : isHRAuthor 
                                ? 'bg-purple-100 text-purple-700 border border-purple-200' 
                                : 'bg-indigo-100 text-indigo-700 border border-indigo-200'
                          }`}>
                            {ann.autore}
                          </span>
                          <span className="text-[10px] font-bold text-gray-400">{ann.data}</span>
                        </div>
                        <h4 className="text-base font-extrabold text-gray-900 mt-2 pr-8">{ann.titolo}</h4>
                        <p className="text-sm text-gray-600 leading-relaxed font-medium whitespace-pre-wrap mt-1.5">{ann.contenuto}</p>
                      </div>

                      {canPublish && !isReminder && (
                        <button
                          onClick={() => handleDeleteNotice(ann.id, ann.titolo)}
                          className="absolute top-4 right-4 text-gray-400 hover:text-red-600 hover:bg-red-50 p-1.5 rounded-xl transition-all"
                          title="Elimina avviso"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}

                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

      </div>

      {/* MODALE DI CREAZIONE NEWS */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-[2rem] shadow-2xl max-w-lg w-full border border-gray-100 p-8 flex flex-col gap-6 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center">
              <h3 className="text-2xl font-black text-gray-900 flex items-center gap-2">
                <Megaphone className="w-6 h-6 text-indigo-600" />
                <span>Nuova Comunicazione</span>
              </h3>
              <button 
                onClick={() => setIsModalOpen(false)}
                className="text-gray-400 hover:text-gray-600 p-1.5 rounded-xl hover:bg-gray-100 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateNotice} className="space-y-4">
              <div>
                <label className="block text-sm font-extrabold text-gray-700 mb-1.5 ml-1">Titolo dell'Avviso</label>
                <input
                  required
                  type="text"
                  placeholder="Es. Chiusura Estiva Uffici"
                  value={newTitle}
                  onChange={e => setNewTitle(e.target.value)}
                  className="w-full p-3.5 border-none rounded-xl bg-gray-50 focus:bg-white outline-none focus:ring-2 focus:ring-indigo-500 transition shadow-inner font-bold text-gray-700"
                />
              </div>

              <div>
                <label className="block text-sm font-extrabold text-gray-700 mb-1.5 ml-1">Firma / Autore</label>
                <select
                  value={newAuthor}
                  onChange={e => setNewAuthor(e.target.value as 'HR' | 'Direzione')}
                  className="w-full p-3.5 border-none rounded-xl bg-gray-50 outline-none focus:ring-2 focus:ring-indigo-500 shadow-inner font-bold text-gray-700"
                >
                  <option value="Direzione">Direzione</option>
                  <option value="HR">HR</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-extrabold text-gray-700 mb-1.5 ml-1">Testo della Comunicazione</label>
                <textarea
                  required
                  rows={5}
                  placeholder="Scrivi qui l'avviso ufficiale..."
                  value={newContent}
                  onChange={e => setNewContent(e.target.value)}
                  className="w-full p-4 border-none rounded-xl bg-gray-50 focus:bg-white outline-none focus:ring-2 focus:ring-indigo-500 shadow-inner font-medium text-gray-800 transition placeholder-gray-400"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 py-3.5 px-4 rounded-xl border border-gray-200 text-sm font-bold text-gray-700 hover:bg-gray-50 transition"
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 py-3.5 px-4 rounded-xl bg-indigo-600 text-white text-sm font-bold hover:bg-indigo-700 transition active:scale-95 disabled:opacity-50"
                >
                  {loading ? 'Pubblicazione...' : 'Pubblica Avviso'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ConfirmModal per l'eliminazione */}
      <ConfirmModal
        isOpen={confirmConfig.isOpen}
        title={confirmConfig.title}
        message={confirmConfig.message}
        onConfirm={confirmConfig.onConfirm}
        onCancel={() => setConfirmConfig(prev => ({ ...prev, isOpen: false }))}
      />

      <ClimaModal 
        isOpen={isClimaModalOpen}
        onClose={() => {
          setIsClimaModalOpen(false);
          loadDashboardData();
        }}
      />

      {activeQuestionnaire && (
        <QuestionnaireModal
          isOpen={isQuestionnaireOpen}
          onClose={() => {
            setHasSkippedSurvey(true);
            loadDashboardData();
          }}
          activeQuestionnaire={activeQuestionnaire}
          userId={user?.uid || ''}
        />
      )}

      {toast && (
        <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[99999] animate-in fade-in slide-in-from-top-4 duration-300">
          <div className={`flex items-center gap-3 px-6 py-3.5 rounded-2xl shadow-2xl border font-bold text-sm ${
            toast.type === 'success' 
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200' 
              : toast.type === 'warning'
                ? 'bg-amber-50 text-amber-800 border-amber-200'
                : 'bg-rose-50 text-rose-800 border-rose-200'
          }`}>
            <span>{toast.type === 'success' ? '✅' : toast.type === 'warning' ? '⚠️' : '❌'}</span>
            <span>{toast.message}</span>
            <button 
              onClick={() => setToast(null)} 
              className="ml-2 hover:opacity-70 text-xs font-black"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
