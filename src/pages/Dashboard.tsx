import { useState, useEffect, useMemo } from 'react';
import { Briefcase, Calendar, Settings, FileText, MessageSquare, Plus, Trash2, Megaphone, X, Users, CalendarDays, Edit, Network, AlertCircle, ChevronRight, HeartPulse } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth, isTechnicalUser } from '../contexts/AuthContext';
import { db } from '../services/firebase';
import { collection, addDoc, doc, deleteDoc, query, orderBy, where, getDoc, getDocs, updateDoc } from 'firebase/firestore';
import ConfirmModal from '../components/ConfirmModal';
import ClimaModal from '../components/ClimaModal';
import QuestionnaireModal from '../components/QuestionnaireModal';
import { isSoci, isCollaboratore } from './Impostazioni';
import { getWeekNumber } from '../utils/date';

interface Announcement {
  id: string;
  titolo: string;
  contenuto: string;
  autore: 'HR' | 'Direzione';
  data: string;
  tipo?: 'standard' | 'chiusure';
  anno?: number;
  periods?: Array<{ tipo: 'singolo' | 'intervallo'; inizio: string; fine: string }>;
}

const areNamesEqual = (n1?: string | null, n2?: string | null): boolean => {
  if (!n1 || !n2) return false;
  const clean1 = n1.toLowerCase().trim().replace(/\s+/g, ' ');
  const clean2 = n2.toLowerCase().trim().replace(/\s+/g, ' ');
  if (clean1 === clean2) return true;
  const w1 = clean1.split(' ').sort().join(' ');
  const w2 = clean2.split(' ').sort().join(' ');
  return w1 === w2;
};

export default function Dashboard() {
  const navigate = useNavigate();

  const handleNav = (e: React.MouseEvent, path: string) => {
    if (e.button === 1 || e.ctrlKey || e.metaKey) {
      e.preventDefault();
      window.open(path, '_blank', 'noopener,noreferrer');
    } else if (e.button === 0) {
      navigate(path);
    }
  };

  const { isAdmin, isHR, isDev, myAssociatedName, user, dipendenti, userEmail, assegnazioni, commesse, prioritaCommesse, coordinatori = [] } = useAuth();

  // States per le comunicazioni
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newAuthor, setNewAuthor] = useState<'HR' | 'Direzione'>('Direzione');
  const [noticeType, setNoticeType] = useState<'standard' | 'chiusure'>('standard');
  const [closureYear, setClosureYear] = useState<number>(() => new Date().getFullYear());
  const [closurePeriods, setClosurePeriods] = useState<Array<{ tipo: 'singolo' | 'intervallo'; inizio: string; fine: string }>>([
    { tipo: 'singolo', inizio: '2026-06-01', fine: '2026-06-01' },
    { tipo: 'intervallo', inizio: '2026-08-10', fine: '2026-08-14' },
    { tipo: 'singolo', inizio: '2026-12-07', fine: '2026-12-07' },
    { tipo: 'intervallo', inizio: '2026-12-28', fine: '2026-12-31' }
  ]);
  const [editingNoticeId, setEditingNoticeId] = useState<string | null>(null);
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

  const formatClosureDate = (dateStr: string) => {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    const year = Number(parts[0]);
    const month = Number(parts[1]) - 1;
    const day = Number(parts[2]);
    
    const dateObj = new Date(year, month, day);
    if (isNaN(dateObj.getTime())) return dateStr;
    
    const giorniSettimana = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];
    const mesi = [
      'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
      'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'
    ];
    
    const dayName = giorniSettimana[dateObj.getDay()];
    const monthName = mesi[dateObj.getMonth()];
    
    return `${dayName} ${day} ${monthName} ${year}`;
  };

  const generateNoticeContent = (year: number, periods: Array<{ tipo: 'singolo' | 'intervallo'; inizio: string; fine: string }>) => {
    let text = `Chiusure Aziendali ${year}\n`;
    periods.forEach((p, idx) => {
      const isLast = idx === periods.length - 1;
      const endChar = isLast ? '' : ';';
      if (p.tipo === 'singolo') {
        text += `• ${formatClosureDate(p.inizio)}${endChar}\n`;
      } else {
        text += `• da ${formatClosureDate(p.inizio)} a ${formatClosureDate(p.fine)}${endChar}\n`;
      }
    });
    return text;
  };

  // Autogenerazione titolo e contenuto quando si cambia il formato chiusure
  useEffect(() => {
    if (noticeType === 'chiusure') {
      setNewTitle(`Chiusure Aziendali ${closureYear}`);
      setNewContent(generateNoticeContent(closureYear, closurePeriods));
    }
  }, [noticeType, closureYear, closurePeriods]);

  // Controllo per la comparsa randomica del questionario sul clima (esclusi i soci)
  useEffect(() => {
    if (isSoci(myAssociatedName)) {
      return; // Non mostrare mai ai soci proprietari
    }

    const lastAnswered = localStorage.getItem('clima_answered_date');
    const todayStr = new Date().toDateString();
    
    if (lastAnswered !== todayStr) {
      // 5% di probabilità di mostrare il pop-up all'accesso (in media ~1 volta al mese per risorsa)
      const show = Math.random() < 0.05;
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
      const currentYear = new Date().getFullYear();
      noticesSnap.forEach(docSnap => {
        const data = docSnap.data();
        if (data.tipo === 'chiusure' && data.anno && data.anno < currentYear) {
          return;
        }
        listNotices.push({
          id: docSnap.id,
          ...data
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
          getDocs(query(collection(db, 'richieste_ferie'), where('stato', 'in', ['In attesa', 'Richiesta Annullamento', 'Richiesta Modifica']))),
          getDocs(query(collection(db, 'presenze'), where('stato', '==', 'Inviato'))),
          getDocs(query(collection(db, 'richieste_weekend'), where('stato', 'in', ['In attesa', 'Richiesta Annullamento', 'Richiesta Modifica']))),
          getDocs(query(collection(db, 'suggerimenti'), where('stato', '==', 'In attesa')))
        ]);

        const todayStr = new Date().toLocaleDateString('sv-SE');
        let pendingFerie = 0;
        ferieSnap.forEach(docSnap => {
          const data = docSnap.data();
          const dateLimit = data.dataFine || data.dataInizio || data.data || '';
          if (!dateLimit || dateLimit >= todayStr || data.stato === 'Richiesta Annullamento' || data.stato === 'Richiesta Modifica') {
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
  }, [myAssociatedName, isHR, isAdmin, user?.uid, userEmail]);

  const applyCorporateClosuresToEmployees = async (_noticeId: string, _periods: Array<{ tipo: 'singolo' | 'intervallo'; inizio: string; fine: string }>) => {
    // Rimossa la propagazione automatica delle ferie per le chiusure aziendali
    return;
  };

  const removeCorporateClosuresForNotice = async (noticeId: string) => {
    // Rimuove solo i periodi di chiusura associati a questo avviso in chiusure_aziendali
    const closuresSnap = await getDocs(query(collection(db, 'chiusure_aziendali'), where('comunicazioneId', '==', noticeId)));
    for (const d of closuresSnap.docs) {
      await deleteDoc(doc(db, 'chiusure_aziendali', d.id));
    }
  };

  const handleCreateNotice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newContent.trim()) return;

    setLoading(true);
    try {
      const today = new Date();
      const dateStr = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`;
      
      const payload: any = {
        titolo: newTitle.trim(),
        contenuto: newContent.trim(),
        autore: newAuthor,
        tipo: noticeType
      };

      if (noticeType === 'chiusure') {
        payload.anno = closureYear;
        payload.periods = closurePeriods;
      }

      if (editingNoticeId) {
        // Mode: Edit
        const oldAnn = announcements.find(a => a.id === editingNoticeId);
        if (oldAnn && oldAnn.tipo === 'chiusure') {
          // Revert previous configuration
          await removeCorporateClosuresForNotice(editingNoticeId);
        }

        await updateDoc(doc(db, 'comunicazioni', editingNoticeId), payload);

        if (noticeType === 'chiusure') {
          // Save new periods in chiusure_aziendali
          for (const p of closurePeriods) {
            if (!p.inizio) continue;
            await addDoc(collection(db, 'chiusure_aziendali'), {
              dataInizio: p.inizio,
              dataFine: p.tipo === 'singolo' ? p.inizio : p.fine,
              label: p.tipo === 'singolo' ? 'Chiusura Aziendale' : 'Chiusura Estiva/Natale',
              anno: closureYear,
              comunicazioneId: editingNoticeId,
              createdAt: new Date().toISOString()
            });
          }
          // Propagate to standard employees and timesheets
          await applyCorporateClosuresToEmployees(editingNoticeId, closurePeriods);
        }

        showToast("Avviso aggiornato con successo!");
      } else {
        // Mode: Create
        payload.data = dateStr;
        payload.createdAt = new Date().toISOString();

        const docRef = await addDoc(collection(db, 'comunicazioni'), payload);

        if (noticeType === 'chiusure') {
          // Save periods in chiusure_aziendali
          for (const p of closurePeriods) {
            if (!p.inizio) continue;
            await addDoc(collection(db, 'chiusure_aziendali'), {
              dataInizio: p.inizio,
              dataFine: p.tipo === 'singolo' ? p.inizio : p.fine,
              label: p.tipo === 'singolo' ? 'Chiusura Aziendale' : 'Chiusura Estiva/Natale',
              anno: closureYear,
              comunicazioneId: docRef.id,
              createdAt: new Date().toISOString()
            });
          }
          // Propagate to standard employees and timesheets
          await applyCorporateClosuresToEmployees(docRef.id, closurePeriods);
        }

        showToast("Avviso pubblicato con successo!");
      }

      // Reset form states
      setNewTitle('');
      setNewContent('');
      setNewAuthor('Direzione');
      setNoticeType('standard');
      setClosureYear(new Date().getFullYear());
      setClosurePeriods([
        { tipo: 'singolo', inizio: '2026-06-01', fine: '2026-06-01' },
        { tipo: 'intervallo', inizio: '2026-08-10', fine: '2026-08-14' },
        { tipo: 'singolo', inizio: '2026-12-07', fine: '2026-12-07' },
        { tipo: 'intervallo', inizio: '2026-12-28', fine: '2026-12-31' }
      ]);
      setEditingNoticeId(null);
      setIsModalOpen(false);
      loadDashboardData();
    } catch (err) {
      console.error("Errore nella pubblicazione/modifica dell'avviso:", err);
      showToast("Errore durante l'operazione.", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setNewTitle('');
    setNewContent('');
    setNewAuthor('Direzione');
    setNoticeType('standard');
    setClosureYear(new Date().getFullYear());
    setClosurePeriods([
      { tipo: 'singolo', inizio: '2026-06-01', fine: '2026-06-01' },
      { tipo: 'intervallo', inizio: '2026-08-10', fine: '2026-08-14' },
      { tipo: 'singolo', inizio: '2026-12-07', fine: '2026-12-07' },
      { tipo: 'intervallo', inizio: '2026-12-28', fine: '2026-12-31' }
    ]);
    setEditingNoticeId(null);
  };

  const handleEditNotice = (ann: Announcement) => {
    setEditingNoticeId(ann.id);
    setNewTitle(ann.titolo);
    setNewContent(ann.contenuto);
    setNewAuthor(ann.autore);
    setNoticeType(ann.tipo || 'standard');
    if (ann.tipo === 'chiusure') {
      setClosureYear(ann.anno || new Date().getFullYear());
      setClosurePeriods(ann.periods || []);
    }
    setIsModalOpen(true);
  };

  const handleDeleteNotice = (id: string, titolo: string) => {
    triggerConfirm(
      "Elimina Comunicazione",
      `Sei sicuro di voler eliminare la comunicazione "${titolo}"?`,
      async () => {
        try {
          const oldAnn = announcements.find(a => a.id === id);
          if (oldAnn && oldAnn.tipo === 'chiusure') {
            await removeCorporateClosuresForNotice(id);
          }
          await deleteDoc(doc(db, 'comunicazioni', id));
          loadDashboardData();
          showToast("Avviso eliminato con successo!");
        } catch (err) {
          console.error("Errore nell'eliminazione della comunicazione:", err);
          showToast("Errore durante l'eliminazione.", "error");
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

    // 0. Birthday Announcement (Top priority for all active users & partners)
    const todayISO = new Date().toLocaleDateString('sv-SE');
    const todayMMDD = todayISO.substring(5); // 'MM-DD'
    
    // Filter active resources & partners with birthdays today
    const birthdayPeople = (dipendenti || []).filter(dip => {
      if (isTechnicalUser(dip)) return false;
      if (dip.dataCessazione && dip.dataCessazione < todayISO) return false;
      if (!dip.dataNascita) return false;
      const dipMMDD = dip.dataNascita.substring(5);
      return dipMMDD === todayMMDD;
    });

    if (birthdayPeople.length > 0) {
      const namesList = birthdayPeople.map(b => b.nome);
      let namesText = '';
      if (namesList.length === 1) {
        namesText = namesList[0];
      } else if (namesList.length === 2) {
        namesText = `${namesList[0]} e ${namesList[1]}`;
      } else {
        const copy = [...namesList];
        const last = copy.pop();
        namesText = `${copy.join(', ')} e ${last}`;
      }

      list.unshift({
        id: `system-birthday-${todayISO}`,
        titolo: '🎂 Oggi festeggiamo insieme!',
        contenuto: `Tanti auguri di buon compleanno a ${namesText} da parte di tutto il team di Ingegno P&C! 🎉`,
        autore: 'Direzione',
        data: `${String(d).padStart(2, '0')}/${String(m + 1).padStart(2, '0')}/${y}`,
        tipo: 'compleanno' as any
      });
    }

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
    if (!myAssociatedName) {
      if (userEmail) {
        const u = userEmail.toLowerCase().trim().split('@')[0];
        if (u.includes('ebartalucci') || u.includes('emanuele')) return 'Emanuele';
        if (u.includes('aprofeti') || u.includes('andrea')) return 'Andrea';
        if (u.includes('mcorbellini') || u.includes('marco')) return 'Marco';
        return u.charAt(0).toUpperCase() + u.slice(1);
      }
      return 'Utente';
    }
    // myAssociatedName è in formato "Cognome Nome" → prendi l'ultimo token (nome di battesimo)
    const parts = myAssociatedName.trim().split(/\s+/);
    const firstName = parts.length > 1 ? parts[parts.length - 1] : parts[0];
    return firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase();
  })();

  const [welcomePhrase, setWelcomePhrase] = useState('');

  useEffect(() => {
    const defaultPhrases = [
      "Felici di collaborare con te anche oggi.",
      "Ti auguriamo una splendida giornata di lavoro.",
      "Il tuo spazio di lavoro è pronto.",
      "Ti diamo il benvenuto nel tuo portale aziendale.",
      "Buon lavoro e buona giornata da parte nostra.",
      "Felici di ritrovarti, ti auguriamo una buona giornata.",
      "Ti auguriamo il meglio per le attività di oggi.",
      "Grazie per il tuo prezioso contributo quotidiano."
    ];

    getDocs(collection(db, 'dashboard_greetings')).then((snap) => {
      const list: string[] = [];
      snap.forEach(docSnap => {
        const t = docSnap.data().testo;
        if (t) list.push(t);
      });
      const finalPhrases = list.length > 0 ? list : defaultPhrases;
      const randomIndex = Math.floor(Math.random() * finalPhrases.length);
      setWelcomePhrase(finalPhrases[randomIndex]);
    }).catch(err => {
      console.error("Errore frasi benvenuto:", err);
      const randomIndex = Math.floor(Math.random() * defaultPhrases.length);
      setWelcomePhrase(defaultPhrases[randomIndex]);
    });
  }, []);

  const currentDateString = useMemo(() => {
    const date = new Date();
    const capitalizeFirstLetter = (string: string) => {
      return string.charAt(0).toUpperCase() + string.slice(1);
    };
    const dayName = capitalizeFirstLetter(date.toLocaleDateString('it-IT', { weekday: 'long' }));
    const dayNum = date.getDate();
    const monthName = capitalizeFirstLetter(date.toLocaleDateString('it-IT', { month: 'long' }));
    const year = date.getFullYear();
    return `${dayName} ${dayNum} ${monthName} ${year}`;
  }, []);

  const currentWeekId = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-W${getWeekNumber(now)}`;
  }, []);

  const highPriorityCommesseThisWeek = useMemo(() => {
    if (!myAssociatedName || !assegnazioni || !commesse || !prioritaCommesse) return [];

    const key = `${myAssociatedName}-${currentWeekId}`;
    const userAssignments = assegnazioni[key] || [];
    if (userAssignments.length === 0) return [];

    const highPrioList: { id: string; nome: string }[] = [];
    userAssignments.forEach((a: any) => {
      const pKey = `${a.commessaId}_${currentWeekId}`;
      if (prioritaCommesse[pKey] === 'Alta') {
        const commObj = commesse.find(c => c.id === a.commessaId);
        const name = commObj ? commObj.nome : (a.commessaName || 'Commessa');
        if (!highPrioList.some(item => item.id === a.commessaId)) {
          highPrioList.push({ id: a.commessaId, nome: name });
        }
      }
    });
    return highPrioList;
  }, [myAssociatedName, assegnazioni, commesse, prioritaCommesse, currentWeekId]);

  const myCoordinatedAreas = useMemo(() => {
    const areas = new Set<string>();
    const uClean = (userEmail || '').toLowerCase().trim();
    const nClean = (myAssociatedName || '').toLowerCase().trim();
    const uUser = uClean.split('@')[0];

    (coordinatori || []).forEach(c => {
      const cEmail = (c.email || '').toLowerCase().trim();
      if (cEmail && uClean && (cEmail === uClean || cEmail.includes(uClean) || uClean.includes(cEmail))) {
        if (c.area) areas.add(c.area.trim());
      }
      const cUser = cEmail.split('@')[0];
      if (cUser && uUser && (cUser.includes(uUser) || uUser.includes(cUser))) {
        if (c.area) areas.add(c.area.trim());
      }
    });

    if (uClean.includes('badalassi') || uClean.includes('taddei') || nClean.includes('badalassi') || nClean.includes('taddei')) {
      areas.add('Ingegneria');
    }
    if (uClean.includes('romanello') || nClean.includes('romanello')) {
      areas.add('Disegnatori');
    }
    if (uClean.includes('bondi') || nClean.includes('bondi')) {
      areas.add('Sicurezza Cantieri');
    }
    if (uClean.includes('votino') || nClean.includes('votino')) {
      areas.add('Consulenza Sicurezza');
    }
    if (uClean.includes('corbellini') || nClean.includes('corbellini')) {
      areas.add('Amministrazione');
    }

    return Array.from(areas);
  }, [userEmail, myAssociatedName, coordinatori]);

  const isSelfRequester = (r: any): boolean => {
    if (!r) return false;
    const uClean = (userEmail || '').toLowerCase().trim();
    const nClean = (myAssociatedName || '').toLowerCase().trim();

    const reqEmail = (r.richiedenteEmail || '').toLowerCase().trim();
    const reqName = (r.richiedenteNome || r.richiedente || '').toLowerCase().trim();

    if (uClean && reqEmail && uClean === reqEmail) return true;
    if (nClean && reqName && areNamesEqual(nClean, reqName)) return true;
    return false;
  };

  const canUserManageRequest = (r: any): boolean => {
    if (!r || r.stato !== 'in_attesa') return false;
    if (isSelfRequester(r)) return false;

    // 1. Se l'utente è Coordinatore dell'area richiesta: la gestisce SEMPRE
    const rArea = (r.area || 'Disegnatori').toLowerCase().trim();
    const isCoordinated = myCoordinatedAreas.some(a => (a || '').toLowerCase().trim() === rArea);
    if (isCoordinated) return true;

    // 2. Se è una richiesta di inserimento commessa, la gestisce il PM / Responsabile di quella commessa
    if (r.tipoRichiesta === 'inserimento_commessa' || r.fonte === 'altre_commesse') {
      const commObj = (commesse || []).find(c => c.id === r.commessaId);
      const commResp = (r.commessaResponsabile || commObj?.responsabile || '').toLowerCase().trim();
      const commPM = r.commessaPM || commObj?.pm;

      const isCommessaManager = Boolean(
        (commResp && (areNamesEqual(commResp, myAssociatedName) || (userEmail && commResp.includes(userEmail.split('@')[0])))) ||
        (commPM && (
          typeof commPM === 'string' 
            ? areNamesEqual(commPM, myAssociatedName) 
            : Array.isArray(commPM) && commPM.some((pmName: string) => areNamesEqual(pmName, myAssociatedName))
        ))
      );

      if (isCommessaManager) return true;
    }

    return false;
  };

  const [pendingCoordinatorRequestsCount, setPendingCoordinatorRequestsCount] = useState(0);

  useEffect(() => {
    if (!userEmail) {
      setPendingCoordinatorRequestsCount(0);
      return;
    }
    const qReq = query(collection(db, 'richieste_disegnatori'), where('stato', '==', 'in_attesa'));
    getDocs(qReq).then((snap) => {
      let count = 0;
      snap.forEach(docSnap => {
        const data = docSnap.data();
        if (canUserManageRequest({ id: docSnap.id, ...data })) {
          count++;
        }
      });
      setPendingCoordinatorRequestsCount(count);
    }).catch(err => {
      console.error("Errore conteggio richieste disegnatori:", err);
    });
  }, [userEmail, myCoordinatedAreas, myAssociatedName, isAdmin, commesse]);

  const [pendingAvailabilityCount, setPendingAvailabilityCount] = useState(0);

  useEffect(() => {
    if (!userEmail || myCoordinatedAreas.length === 0) {
      setPendingAvailabilityCount(0);
      return;
    }
    const qDisp = query(collection(db, 'segnalazioni_disponibilita'), where('stato', '==', 'in_attesa'));
    getDocs(qDisp).then((snap) => {
      let count = 0;
      snap.forEach(docSnap => {
        const data = docSnap.data();
        if (myCoordinatedAreas.includes(data.macroArea)) {
          count++;
        }
      });
      setPendingAvailabilityCount(count);
    }).catch(err => {
      console.error("Errore conteggio disponibilita:", err);
    });
  }, [userEmail, myCoordinatedAreas]);

  const canPublish = isAdmin || isHR;

  return (
    <div className="max-w-7xl mx-auto px-4 mt-8 flex flex-col gap-6">
      
      {/* Intestazione di benvenuto */}
      <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] shadow-sm p-6 sm:p-8 border border-white/50 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-extrabold text-indigo-600 tracking-tight">
            Ciao, {welcomeName}! {welcomePhrase}
          </h1>
        </div>
        <div className="text-xs sm:text-sm font-extrabold text-indigo-500/80 bg-indigo-50/50 border border-indigo-100/50 px-4 py-2 rounded-2xl shadow-inner shrink-0 self-start md:self-auto flex items-center gap-2">
          <Calendar className="w-4 h-4 text-indigo-500" />
          <span>{currentDateString}</span>
        </div>
      </div>

      {/* Banner Commesse ad Alta Priorità (visibile solo alle risorse interessate) */}
      {highPriorityCommesseThisWeek.length > 0 && (
        <div className="bg-gradient-to-r from-red-500/10 via-rose-500/10 to-amber-500/10 backdrop-blur-xl border border-red-200/80 rounded-[1.8rem] p-4 sm:p-5 shadow-sm animate-in fade-in zoom-in-95 duration-200 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-start sm:items-center gap-3.5">
            <div className="p-2.5 bg-red-500 text-white rounded-2xl shadow-md shrink-0">
              <AlertCircle className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-black uppercase text-red-700 tracking-wider bg-red-100/80 px-2.5 py-0.5 rounded-full border border-red-200">
                  Priorità Alta Questa Settimana
                </span>
                <span className="text-xs text-gray-500 font-semibold">
                  ({highPriorityCommesseThisWeek.length} {highPriorityCommesseThisWeek.length === 1 ? 'commessa' : 'commesse'})
                </span>
              </div>
              <p className="text-xs font-bold text-gray-800 mt-1">
                Sei pianificato/a su: {' '}
                {highPriorityCommesseThisWeek.map((c, idx) => (
                  <span key={c.id} className="text-red-600 font-extrabold">
                    {c.nome}
                    {idx < highPriorityCommesseThisWeek.length - 1 ? ', ' : ''}
                  </span>
                ))}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={(e) => handleNav(e, '/commesse')}
            className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-xl text-xs font-black transition shadow-md active:scale-95 shrink-0 cursor-pointer flex items-center gap-1.5 self-end md:self-auto"
          >
            <span>Vai a Pianificazione</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Griglia a due colonne: Operational links a sinistra, News a destra */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* COLONNA SINISTRA: SEZIONI OPERATIVE (2/3 di larghezza) */}
        <div className="lg:col-span-7 space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-6">
            
            {/* Pianificazione Commesse */}
            <div 
              onClick={(e) => handleNav(e, '/commesse')} 
              onAuxClick={(e) => handleNav(e, '/commesse')} 
              onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
              className="bg-white/80 backdrop-blur-xl p-4 sm:p-5 rounded-[1.5rem] md:rounded-[2rem] shadow-md border border-white/50 hover:shadow-xl hover:-translate-y-1 transition-all cursor-pointer group flex flex-col min-h-[200px] xl:min-h-[220px] h-auto w-full"
            >
              <div className="w-12 h-12 sm:w-14 sm:h-14 shrink-0 bg-blue-100 text-blue-600 rounded-2xl flex items-center justify-center group-hover:bg-blue-600 group-hover:text-white transition-colors relative mb-3">
                <Briefcase className="w-6 h-6 sm:w-7 sm:h-7" />
              </div>
              <div className="h-11 xl:h-12 shrink-0 flex items-start overflow-hidden">
                <h2 className="text-sm sm:text-base xl:text-lg font-extrabold text-gray-900 leading-snug">Pianificazione Commesse</h2>
              </div>
              <div className="hidden xl:block min-h-[48px] shrink-0 mt-1 pb-1">
                <p className="text-xs font-semibold text-gray-500 leading-snug">Gestisci e visualizza i tuoi impegni settimanali e i progetti.</p>
              </div>
            </div>
            
            {/* Pianificazione Personale */}
            <div 
              onClick={(e) => handleNav(e, '/pianificazione-personale')} 
              onAuxClick={(e) => handleNav(e, '/pianificazione-personale')} 
              onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
              className="bg-white/80 backdrop-blur-xl p-4 sm:p-5 rounded-[1.5rem] md:rounded-[2rem] shadow-md border border-white/50 hover:shadow-xl hover:-translate-y-1 transition-all cursor-pointer group flex flex-col min-h-[200px] xl:min-h-[220px] h-auto w-full"
            >
              <div className="w-12 h-12 sm:w-14 sm:h-14 shrink-0 bg-orange-100 text-orange-600 rounded-2xl flex items-center justify-center group-hover:bg-orange-600 group-hover:text-white transition-colors relative mb-3">
                <Users className="w-6 h-6 sm:w-7 sm:h-7" />
                {pendingCoordinatorRequestsCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 flex h-6 w-6" title={`${pendingCoordinatorRequestsCount} richieste in attesa`}>
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-6 w-6 bg-red-500 text-[11px] font-black text-white items-center justify-center border-2 border-white shadow-md">
                      {pendingCoordinatorRequestsCount}
                    </span>
                  </span>
                )}
                {pendingAvailabilityCount > 0 && (
                  <span className="absolute -top-1.5 -left-1.5 flex h-6 w-6" title={`${pendingAvailabilityCount} risorse scariche disponibili`}>
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-6 w-6 bg-emerald-600 text-[11px] font-black text-white items-center justify-center border-2 border-white shadow-md">
                      {pendingAvailabilityCount}
                    </span>
                  </span>
                )}
              </div>
              <div className="h-11 xl:h-12 shrink-0 flex items-start overflow-hidden">
                <h2 className="text-sm sm:text-base xl:text-lg font-extrabold text-gray-900 leading-snug">Pianificazione Personale</h2>
              </div>
              <div className="hidden xl:block min-h-[48px] shrink-0 mt-1 pb-1">
                <p className="text-xs font-semibold text-gray-500 leading-snug">Pianifica il personale sulle commesse e controlla i carichi di lavoro.</p>
              </div>
            </div>
            
            {/* Piano Ferie */}
            <div 
              onClick={(e) => handleNav(e, '/ferie')} 
              onAuxClick={(e) => handleNav(e, '/ferie')} 
              onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
              className="bg-white/80 backdrop-blur-xl p-4 sm:p-5 rounded-[1.5rem] md:rounded-[2rem] shadow-md border border-white/50 hover:shadow-xl hover:-translate-y-1 transition-all cursor-pointer group flex flex-col min-h-[200px] xl:min-h-[220px] h-auto w-full"
            >
              <div className="w-12 h-12 sm:w-14 sm:h-14 shrink-0 bg-green-100 text-green-600 rounded-2xl flex items-center justify-center group-hover:bg-green-600 group-hover:text-white transition-colors relative mb-3">
                <Calendar className="w-6 h-6 sm:w-7 sm:h-7" />
                {isHR && pendingFerieCount > 0 && (
                  <span className="absolute -top-1 -right-1 flex h-5 w-5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-5 w-5 bg-red-500 text-[10px] font-black text-white items-center justify-center border border-white">
                      {pendingFerieCount}
                    </span>
                  </span>
                )}
              </div>
              <div className="h-11 xl:h-12 shrink-0 flex items-start overflow-hidden">
                <h2 className="text-sm sm:text-base xl:text-lg font-extrabold text-gray-900 leading-snug">Piano Ferie</h2>
              </div>
              <div className="hidden xl:block min-h-[48px] shrink-0 mt-1 pb-1">
                <p className="text-xs font-semibold text-gray-500 leading-snug">Richiedi giorni di ferie o assenze e controlla il calendario.</p>
              </div>
            </div>

            {/* Registro Presenze */}
            <div 
              onClick={(e) => handleNav(e, '/presenze')} 
              onAuxClick={(e) => handleNav(e, '/presenze')} 
              onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
              className="bg-white/80 backdrop-blur-xl p-4 sm:p-5 rounded-[1.5rem] md:rounded-[2rem] shadow-md border border-white/50 hover:shadow-xl hover:-translate-y-1 transition-all cursor-pointer group flex flex-col min-h-[200px] xl:min-h-[220px] h-auto w-full"
            >
              <div className="w-12 h-12 sm:w-14 sm:h-14 shrink-0 bg-indigo-100 text-indigo-600 rounded-2xl flex items-center justify-center group-hover:bg-indigo-600 group-hover:text-white transition-colors relative mb-3">
                <FileText className="w-6 h-6 sm:w-7 sm:h-7" />
                {isHR && pendingPresenzeCount > 0 && (
                  <span className="absolute -top-1 -right-1 flex h-5 w-5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-5 w-5 bg-red-500 text-[10px] font-black text-white items-center justify-center border border-white">
                      {pendingPresenzeCount}
                    </span>
                  </span>
                )}
              </div>
              <div className="h-11 xl:h-12 shrink-0 flex items-start overflow-hidden">
                <h2 className="text-sm sm:text-base xl:text-lg font-extrabold text-gray-900 leading-snug">
                  {isSoci(myAssociatedName) 
                    ? 'Riepilogo Ore e Bozze' 
                    : isCollaboratore(myAssociatedName, dipendenti) 
                      ? 'Bozza Fattura' 
                      : 'Registro Presenze'}
                </h2>
              </div>
              <div className="hidden xl:block min-h-[48px] shrink-0 mt-1 pb-1">
                <p className="text-xs font-semibold text-gray-500 leading-snug">
                  {isSoci(myAssociatedName)
                    ? 'Visualizza il riepilogo mensile dei fogli ore e delle bozze fattura delle risorse.'
                    : isCollaboratore(myAssociatedName, dipendenti)
                      ? 'Gestisci la bozza fattura mensile ed i rimborsi spese.'
                      : 'Compila il rapportino mensile delle ore e dei rimborsi trasferte.'}
                </p>
              </div>
            </div>

            {/* Prenotazione Risorse */}
            <div 
              onClick={(e) => handleNav(e, '/prenotazioni')} 
              onAuxClick={(e) => handleNav(e, '/prenotazioni')} 
              onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
              className="bg-white/80 backdrop-blur-xl p-4 sm:p-5 rounded-[1.5rem] md:rounded-[2rem] shadow-md border border-white/50 hover:shadow-xl hover:-translate-y-1 transition-all cursor-pointer group flex flex-col min-h-[200px] xl:min-h-[220px] h-auto w-full"
            >
              <div className="w-12 h-12 sm:w-14 sm:h-14 shrink-0 bg-teal-100 text-teal-600 rounded-2xl flex items-center justify-center group-hover:bg-teal-600 group-hover:text-white transition-colors mb-3">
                <CalendarDays className="w-6 h-6 sm:w-7 sm:h-7" />
              </div>
              <div className="h-11 xl:h-12 shrink-0 flex items-start overflow-hidden">
                <h2 className="text-sm sm:text-base xl:text-lg font-extrabold text-gray-900 leading-snug">Prenotazioni</h2>
              </div>
              <div className="hidden xl:block min-h-[48px] shrink-0 mt-1 pb-1">
                <p className="text-xs font-semibold text-gray-500 leading-snug">Prenota sale riunioni, auto aziendali o gestisci i PC CAD condivisi.</p>
              </div>
            </div>

            {/* Organigramma Aziendale */}
            <div 
              onClick={(e) => handleNav(e, '/organigramma')} 
              onAuxClick={(e) => handleNav(e, '/organigramma')} 
              onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
              className="bg-white/80 backdrop-blur-xl p-4 sm:p-5 rounded-[1.5rem] md:rounded-[2rem] shadow-md border border-white/50 hover:shadow-xl hover:-translate-y-1 transition-all cursor-pointer group flex flex-col min-h-[200px] xl:min-h-[220px] h-auto w-full"
            >
              <div className="w-12 h-12 sm:w-14 sm:h-14 shrink-0 bg-amber-100 text-amber-600 rounded-2xl flex items-center justify-center group-hover:bg-amber-600 group-hover:text-white transition-colors mb-3">
                <Network className="w-6 h-6 sm:w-7 sm:h-7" />
              </div>
              <div className="h-11 xl:h-12 shrink-0 flex items-start overflow-hidden">
                <h2 className="text-sm sm:text-base xl:text-lg font-extrabold text-gray-900 leading-snug">Organigramma</h2>
              </div>
              <div className="hidden xl:block min-h-[48px] shrink-0 mt-1 pb-1">
                <p className="text-xs font-semibold text-gray-500 leading-snug">Consulta la suddivisione delle macroaree ed i coordinatori di riferimento.</p>
              </div>
            </div>

            {/* Cassetta delle Idee */}
            <div 
              onClick={(e) => handleNav(e, '/suggerimenti')} 
              onAuxClick={(e) => handleNav(e, '/suggerimenti')} 
              onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
              className="bg-white/80 backdrop-blur-xl p-4 sm:p-5 rounded-[1.5rem] md:rounded-[2rem] shadow-md border border-white/50 hover:shadow-xl hover:-translate-y-1 transition-all cursor-pointer group flex flex-col min-h-[200px] xl:min-h-[220px] h-auto w-full"
            >
              <div className="w-12 h-12 sm:w-14 sm:h-14 shrink-0 bg-purple-100 text-purple-600 rounded-2xl flex items-center justify-center group-hover:bg-purple-600 group-hover:text-white transition-colors relative mb-3">
                <MessageSquare className="w-6 h-6 sm:w-7 sm:h-7" />
                {!isSoci(myAssociatedName) && activeQuestionnaire && activeQuestionnaire.active && !hasCompletedSurvey && (
                  <span className="absolute -top-1 -right-1 flex h-5 w-5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-5 w-5 bg-red-500 text-[10px] font-black text-white items-center justify-center border border-white">
                      1
                    </span>
                  </span>
                )}
              </div>
              <div className="h-11 xl:h-12 shrink-0 flex items-start overflow-hidden">
                <h2 className="text-sm sm:text-base xl:text-lg font-extrabold text-gray-900 leading-snug">Cassetta delle Idee</h2>
              </div>
              <div className="hidden xl:block min-h-[48px] shrink-0 mt-1 pb-1">
                <p className="text-xs font-semibold text-gray-500 leading-snug">Invia suggerimenti e partecipa alla valutazione del clima.</p>
              </div>
            </div>

            {/* Gestione HR (Riservato ad HR e Sviluppatore - Non Admin semplici) */}
            {(isHR || isDev) && (
              <div 
                onClick={(e) => handleNav(e, '/gestione-hr')} 
                onAuxClick={(e) => handleNav(e, '/gestione-hr')} 
                onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
                className="bg-white/80 backdrop-blur-xl p-4 sm:p-5 rounded-[1.5rem] md:rounded-[2rem] shadow-md border border-white/50 hover:shadow-xl hover:-translate-y-1 transition-all cursor-pointer group flex flex-col min-h-[200px] xl:min-h-[220px] h-auto w-full"
              >
                <div className="w-12 h-12 sm:w-14 sm:h-14 shrink-0 bg-purple-100 text-purple-600 rounded-2xl flex items-center justify-center group-hover:bg-purple-600 group-hover:text-white transition-colors relative mb-3">
                  <HeartPulse className="w-6 h-6 sm:w-7 sm:h-7" />
                  {pendingSuggerimentiCount > 0 && (
                    <span className="absolute -top-1 -right-1 flex h-5 w-5">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-5 w-5 bg-red-500 text-[10px] font-black text-white items-center justify-center border border-white">
                        {pendingSuggerimentiCount}
                      </span>
                    </span>
                  )}
                </div>
                <div className="h-11 xl:h-12 shrink-0 flex items-start overflow-hidden">
                  <h2 className="text-sm sm:text-base xl:text-lg font-extrabold text-gray-900 leading-snug">Gestione HR</h2>
                </div>
                <div className="hidden xl:block min-h-[48px] shrink-0 mt-1 pb-1">
                  <p className="text-xs font-semibold text-gray-500 leading-snug">Gestisci frasi di benvenuto, benessere, questionari e suggerimenti.</p>
                </div>
              </div>
            )}

            {/* Impostazioni Sviluppatore */}
            {isDev && (
              <div 
                onClick={(e) => handleNav(e, '/impostazioni')} 
                onAuxClick={(e) => handleNav(e, '/impostazioni')} 
                onMouseDown={(e) => { if (e.button === 1) e.preventDefault(); }}
                className="bg-white/80 backdrop-blur-xl p-4 sm:p-5 rounded-[1.5rem] md:rounded-[2rem] shadow-md border border-white/50 hover:shadow-xl hover:-translate-y-1 transition-all cursor-pointer group flex flex-col min-h-[200px] xl:min-h-[220px] h-auto w-full"
              >
                <div className="w-12 h-12 sm:w-14 sm:h-14 shrink-0 bg-gray-100 text-gray-600 rounded-2xl flex items-center justify-center group-hover:bg-gray-800 group-hover:text-white transition-colors mb-3">
                  <Settings className="w-6 h-6 sm:w-7 sm:h-7" />
                </div>
                <div className="h-11 xl:h-12 shrink-0 flex items-start overflow-hidden">
                  <h2 className="text-sm sm:text-base xl:text-lg font-extrabold text-gray-900 leading-snug">Impostazioni</h2>
                </div>
                <div className="hidden xl:block min-h-[48px] shrink-0 mt-1 pb-1">
                  <p className="text-xs font-semibold text-gray-500 leading-snug">Gestisci anagrafica risorse, clienti, ruoli e sistema.</p>
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
                  const isBirthday = ann.id.startsWith('system-birthday-');
                  return (
                    <div 
                      key={ann.id} 
                      className={`p-5 rounded-2xl shadow-sm hover:shadow-md transition flex flex-col justify-between gap-3 relative group/item ${
                        isBirthday
                          ? 'bg-gradient-to-br from-amber-500/10 via-amber-400/5 to-indigo-500/10 border-2 border-amber-400/80 shadow-md'
                          : isReminder 
                            ? 'bg-amber-50/80 border-l-4 border-l-amber-500 border-y border-r border-amber-200/70' 
                            : 'bg-white/60 border border-gray-100'
                      }`}
                    >
                      <div>
                        <div className="flex justify-between items-center gap-2 pr-16">
                          <span className={`text-[10px] font-extrabold uppercase px-2.5 py-0.5 rounded-full ${
                            isBirthday
                              ? 'bg-amber-500 text-white shadow-xs tracking-wider'
                              : isReminder 
                                ? 'bg-amber-100 text-amber-700 border border-amber-200' 
                                : isHRAuthor 
                                  ? 'bg-purple-100 text-purple-700 border border-purple-200' 
                                  : 'bg-indigo-100 text-indigo-700 border border-indigo-200'
                          }`}>
                            {isBirthday ? '🎉 Compleanno' : ann.autore}
                          </span>
                        </div>
                        <h4 className="text-base font-extrabold text-gray-900 mt-2 pr-16">{ann.titolo}</h4>
                        <p className={`text-sm leading-relaxed whitespace-pre-wrap mt-1.5 ${isBirthday ? 'font-bold text-amber-950' : 'text-gray-600 font-medium'}`}>
                          {ann.contenuto}
                        </p>
                      </div>

                      {canPublish && !isReminder && !isBirthday && (
                        <div className="absolute top-4 right-4 flex gap-1">
                          <button
                            onClick={() => handleEditNotice(ann)}
                            className="text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 p-1.5 rounded-xl transition-all"
                            title="Modifica avviso"
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDeleteNotice(ann.id, ann.titolo)}
                            className="text-gray-400 hover:text-red-600 hover:bg-red-50 p-1.5 rounded-xl transition-all"
                            title="Elimina avviso"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      )}

                      {!isReminder && ann.tipo !== 'chiusure' && (
                        <span className={`absolute text-[10px] font-bold text-gray-400 right-5 ${canPublish && !isBirthday ? 'top-[2.75rem]' : 'top-5'}`}>
                          {ann.data}
                        </span>
                      )}
                      {isReminder && (
                        <span className="absolute text-[10px] font-bold text-gray-400 right-5 top-5">
                          {ann.data}
                        </span>
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
          <div className="bg-white rounded-[2rem] shadow-2xl max-w-2xl w-full border border-gray-100 p-8 flex flex-col gap-5 animate-in fade-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center">
              <h3 className="text-2xl font-black text-gray-900 flex items-center gap-2">
                <Megaphone className="w-6 h-6 text-indigo-600" />
                <span>{editingNoticeId ? 'Modifica Comunicazione' : 'Nuova Comunicazione'}</span>
              </h3>
              <button 
                onClick={handleCloseModal}
                className="text-gray-400 hover:text-gray-600 p-1.5 rounded-xl hover:bg-gray-100 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateNotice} className="space-y-3.5 overflow-y-auto max-h-[70vh] px-2 py-2 pr-3">
              <div>
                <label className="block text-sm font-extrabold text-gray-700 mb-1.5 ml-1">Formato Comunicazione</label>
                <select
                  value={noticeType}
                  onChange={e => {
                    const type = e.target.value as 'standard' | 'chiusure';
                    setNoticeType(type);
                    if (type === 'chiusure') {
                      setNewTitle(`Chiusure Aziendali ${closureYear}`);
                      setNewContent(generateNoticeContent(closureYear, closurePeriods));
                    } else {
                      setNewTitle('');
                      setNewContent('');
                    }
                  }}
                  className="w-full p-3.5 border-none rounded-xl bg-gray-50 outline-none focus:ring-2 focus:ring-indigo-500 shadow-inner font-bold text-gray-700"
                >
                  <option value="standard">Standard (Testo libero)</option>
                  <option value="chiusure">Chiusure Aziendali (Format preimpostato)</option>
                </select>
              </div>

              {noticeType === 'chiusure' && (
                <>
                  <div>
                    <label className="block text-sm font-extrabold text-gray-700 mb-1.5 ml-1">Anno Chiusure</label>
                    <input
                      type="number"
                      value={closureYear}
                      onChange={e => setClosureYear(Number(e.target.value))}
                      className="w-full p-3.5 border-none rounded-xl bg-gray-50 focus:bg-white outline-none focus:ring-2 focus:ring-indigo-500 transition shadow-inner font-bold text-gray-700"
                    />
                  </div>

                  <div className="space-y-3">
                    <label className="block text-sm font-extrabold text-gray-700 ml-1">Periodi di Chiusura</label>
                    <div className="space-y-2">
                      {closurePeriods.map((p, idx) => (
                        <div key={idx} className="flex gap-2 items-center bg-gray-50 p-2.5 rounded-xl border border-gray-200">
                          <select
                            value={p.tipo}
                            onChange={e => {
                              const updated = [...closurePeriods];
                              updated[idx].tipo = e.target.value as 'singolo' | 'intervallo';
                              setClosurePeriods(updated);
                            }}
                            className="p-1.5 bg-white border border-gray-200 rounded-lg text-xs font-bold text-gray-700 focus:outline-none"
                          >
                            <option value="singolo">Singolo Giorno</option>
                            <option value="intervallo">Intervallo</option>
                          </select>
                          <input
                            type="date"
                            value={p.inizio}
                            onChange={e => {
                              const updated = [...closurePeriods];
                              updated[idx].inizio = e.target.value;
                              if (updated[idx].tipo === 'singolo') {
                                updated[idx].fine = e.target.value;
                              }
                              setClosurePeriods(updated);
                            }}
                            className="p-1.5 bg-white border border-gray-200 rounded-lg text-xs font-bold text-gray-700 focus:outline-none flex-1"
                          />
                          {p.tipo === 'intervallo' && (
                            <>
                              <span className="text-xs font-extrabold text-gray-400">al</span>
                              <input
                                type="date"
                                value={p.fine}
                                onChange={e => {
                                  const updated = [...closurePeriods];
                                  updated[idx].fine = e.target.value;
                                  setClosurePeriods(updated);
                                }}
                                className="p-1.5 bg-white border border-gray-200 rounded-lg text-xs font-bold text-gray-700 focus:outline-none flex-1"
                              />
                            </>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              setClosurePeriods(closurePeriods.filter((_, i) => i !== idx));
                            }}
                            className="text-gray-400 hover:text-red-600 p-1 hover:bg-white rounded transition"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setClosurePeriods([...closurePeriods, { tipo: 'singolo', inizio: '', fine: '' }]);
                      }}
                      className="w-full py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold text-xs rounded-xl transition flex items-center justify-center gap-1.5 active:scale-95"
                    >
                      <Plus className="w-3.5 h-3.5" /> Aggiungi Periodo
                    </button>
                  </div>
                </>
              )}

              <div>
                <label className="block text-sm font-extrabold text-gray-700 mb-1.5 ml-1">Titolo dell'Avviso</label>
                <input
                  required
                  type="text"
                  placeholder="Es. Chiusura Estiva Uffici"
                  value={newTitle}
                  onChange={e => setNewTitle(e.target.value)}
                  disabled={noticeType === 'chiusure'}
                  className="w-full p-3.5 border-none rounded-xl bg-gray-50 focus:bg-white outline-none focus:ring-2 focus:ring-indigo-500 transition shadow-inner font-bold text-gray-700 disabled:opacity-75"
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
                  rows={noticeType === 'chiusure' ? 4 : 5}
                  placeholder="Scrivi qui l'avviso ufficiale..."
                  value={newContent}
                  onChange={e => setNewContent(e.target.value)}
                  disabled={noticeType === 'chiusure'}
                  className="w-full p-4 border-none rounded-xl bg-gray-50 focus:bg-white outline-none focus:ring-2 focus:ring-indigo-500 shadow-inner font-medium text-gray-800 transition placeholder-gray-400 disabled:opacity-75"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="flex-1 py-3.5 px-4 rounded-xl border border-gray-200 text-sm font-bold text-gray-700 hover:bg-gray-50 transition"
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 py-3.5 px-4 rounded-xl bg-indigo-600 text-white text-sm font-bold hover:bg-indigo-700 transition active:scale-95 disabled:opacity-50"
                >
                  {loading ? 'Elaborazione in corso...' : (editingNoticeId ? 'Salva Modifiche' : 'Pubblica Avviso')}
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
