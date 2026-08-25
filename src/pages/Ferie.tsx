import { useState, useEffect, useMemo, memo } from 'react';
import { useAuth, isTechnicalUser } from '../contexts/AuthContext';
import { db } from '../services/firebase';
import { collection, addDoc, doc, updateDoc, deleteDoc, query, where, getDocs, getDoc } from 'firebase/firestore';
import { Calendar, CheckCircle, XCircle, Clock, ChevronLeft, ChevronRight, RefreshCw, Pencil, Trash2, AlertTriangle, X, Search, BarChart2, Download, Users, Printer, ShieldAlert } from 'lucide-react';
import { isItalianHoliday, isWeekend, getWeekNumber } from '../utils/date';
import { getPrintFooterHtml, getPrintDateString, APP_VERSION } from '../config/version';
import { isCollaboratore, isSoci } from './Impostazioni';
import ResourceAnalyticsModal from '../components/ResourceAnalyticsModal';
import { rebuildYearlySummary } from '../services/yearlySummaryService';
import { createUserNotification } from '../utils/userNotificationService';
import { queueMail } from '../utils/mailSender';
import { getSociNotificationEmails } from '../utils/emailTemplateManager';

const areNamesEqual = (n1?: string | null, n2?: string | null): boolean => {
  if (!n1 || !n2) return false;
  const clean1 = n1.toLowerCase().trim().replace(/\s+/g, ' ');
  const clean2 = n2.toLowerCase().trim().replace(/\s+/g, ' ');
  if (clean1 === clean2) return true;
  const p1 = clean1.split(' ').sort().join(' ');
  const p2 = clean2.split(' ').sort().join(' ');
  return p1 === p2;
};

const formatDate = (dateStr: string) => {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const [year, month, day] = parts;
  return `${day}/${month}/${year}`;
};

interface RichiestaFerie {
  id: string;
  dipendenteName: string;
  data: string;
  tipo: string;
  stato: 'In attesa' | 'Approvato' | 'Rifiutato' | 'Richiesta Annullamento' | 'Richiesta Modifica';
  frazioneTipo?: 'mattina' | 'pomeriggio' | 'giornata' | 'orario';
  dataInizio?: string;
  dataFine?: string;
  oraInizio?: string;
  oraFine?: string;
  pausaPranzo?: boolean;
  pausaPranzoOre?: number;
  timestamp?: string;
  note?: string;
  comunicazioneId?: string;
  richiestaModifica?: {
    tipoAzione: 'annullamento' | 'modifica';
    nuovaDataInizio?: string;
    nuovaDataFine?: string;
    nuovaOraInizio?: string;
    nuovaOraFine?: string;
    nuovaFrazioneTipo?: 'mattina' | 'pomeriggio' | 'giornata' | 'orario';
    nuovoTipo?: string;
    motivazione?: string;
    dataRichiesta?: string;
  };
}

const TIME_OPTIONS = Array.from({ length: 48 }).map((_, i) => {
  const h = Math.floor(i / 2);
  const m = i % 2 === 0 ? '00' : '30';
  return `${String(h).padStart(2, '0')}:${m}`;
});

const PAUSA_PRANZO_OPTIONS = Array.from({ length: 8 }).map((_, i) => {
  const v = (i + 1) * 0.5;
  return { value: v.toFixed(1), label: `${v.toString().replace('.', ',')} or${v === 1 ? 'a' : 'e'}` };
});

// Cache persistente in memoria modulo e sessionStorage per evitare qualsiasi sfarfallio a 0 al cambio di rotta
let globalCounterYearSummaries: Record<number, any> = {};

const getInitialSummaries = (): Record<number, any> => {
  if (Object.keys(globalCounterYearSummaries).length > 0) {
    return globalCounterYearSummaries;
  }
  try {
    const cached = sessionStorage.getItem('cached_yearly_summaries');
    if (cached) {
      const parsed = JSON.parse(cached);
      globalCounterYearSummaries = parsed;
      return parsed;
    }
  } catch (e) {}
  return {};
};

const saveSummariesToCache = (newMap: Record<number, any>) => {
  globalCounterYearSummaries = newMap;
  try {
    sessionStorage.setItem('cached_yearly_summaries', JSON.stringify(newMap));
  } catch (e) {}
};

const getInitialTargetDipName = (nameProp: string): string => {
  if (nameProp) {
    try { localStorage.setItem('last_user_associated_name', nameProp); } catch (e) {}
    return nameProp;
  }
  try {
    const cached = localStorage.getItem('last_user_associated_name');
    if (cached) return cached;
  } catch (e) {}
  return '';
};

interface FerieContentProps {
  isHR: boolean;
  isAdmin: boolean;
  myAssociatedName: string;
  dipendenti: any[];
}

const FerieContent = memo(({ isHR, isAdmin, myAssociatedName, dipendenti }: FerieContentProps) => {
  const { userEmail, isDev, refreshData } = useAuth();
  const [viewMode, setViewMode] = useState<'calendario' | 'tabella'>('calendario');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'warning' | 'error' | 'info' } | null>(null);
  const [chiusureAziendali, setChiusureAziendali] = useState<Array<{ dataInizio: string; dataFine: string }>>([]);

  const isInChiusuraAziendaleLocal = (dateStr: string) => {
    return chiusureAziendali.some(c => dateStr >= c.dataInizio && dateStr <= c.dataFine);
  };

  const showToast = (message: string, type: 'success' | 'warning' | 'error' | 'info' = 'success') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(null);
    }, 4500);
  };

  // State per la nuova richiesta
  const [requestMode, setRequestMode] = useState<'singolo' | 'range'>('singolo');
  const [dipendenteSelezionato, setDipendenteSelezionato] = useState<string>(() => getInitialTargetDipName(myAssociatedName));
  const [dataRichiesta, setDataRichiesta] = useState('');
  const [dataInizio, setDataInizio] = useState('');
  const [dataFine, setDataFine] = useState('');
  const [oraInizio, setOraInizio] = useState('09:00');
  const [oraFine, setOraFine] = useState('18:00');
  const [tipoRichiesta, setTipoRichiesta] = useState('ferie');
  const [frazioneTipo, setFrazioneTipo] = useState<'mattina' | 'pomeriggio' | 'giornata' | 'orario'>('giornata');
  const [approvedWeekends, setApprovedWeekends] = useState<Record<string, boolean>>({});
  const [pausaPranzo, setPausaPranzo] = useState(false);
  const [pausaPranzoOre, setPausaPranzoOre] = useState('1.0');

  useEffect(() => {
    if (myAssociatedName) {
      try { localStorage.setItem('last_user_associated_name', myAssociatedName); } catch (e) {}
      if (!dipendenteSelezionato) {
        setDipendenteSelezionato(myAssociatedName);
      }
    }
  }, [myAssociatedName]);

  const effectiveMyAssociatedName = myAssociatedName || getInitialTargetDipName('');
  const targetDipName = (isHR || isAdmin) ? (dipendenteSelezionato || effectiveMyAssociatedName) : effectiveMyAssociatedName;
  // I Soci vengono trattati come collaboratori nel Piano Ferie
  const isCollaboratoreUser = isCollaboratore(targetDipName, dipendenti) || isSoci(targetDipName);

  useEffect(() => {
    if (isCollaboratoreUser && (tipoRichiesta === 'ferie' || tipoRichiesta === 'permesso' || tipoRichiesta === 'studio' || tipoRichiesta === 'donazione' || tipoRichiesta === 'elettorale')) {
      setTipoRichiesta('assenza');
    }
  }, [isCollaboratoreUser, tipoRichiesta]);
  
  // State per calendario
  const [currentMonth, setCurrentMonth] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d;
  });

  // Liste richieste suddivise per ottimizzazione letture
  const [myRichieste, setMyRichieste] = useState<RichiestaFerie[]>([]);
  const [othersApprovedRichieste, setOthersApprovedRichieste] = useState<RichiestaFerie[]>([]);
  const [hrRichieste, setHrRichieste] = useState<RichiestaFerie[]>([]);
  const [loading, setLoading] = useState(false);

  const [loadedYears, setLoadedYears] = useState<Set<number>>(() => new Set<number>());

  const mapRequestTipo = (dipName: string, docId: string, currentTipo: string) => {
    if (isCollaboratore(dipName, dipendenti) && (currentTipo === 'ferie' || currentTipo === 'permesso' || currentTipo === 'mattina' || currentTipo === 'pomeriggio')) {
      updateDoc(doc(db, 'richieste_ferie', docId), { tipo: 'assenza' }).catch(() => {});
      return 'assenza';
    }
    return currentTipo;
  };

  const ensureYearLoaded = async (targetYear: number) => {
    if (loadedYears.has(targetYear)) return;

    try {
      const startStr = `${targetYear}-01-01`;
      const endStr = `${targetYear}-12-31`;

      const qOld = query(
        collection(db, 'richieste_ferie'),
        where('dataFine', '>=', startStr)
      );
      const snap = await getDocs(qOld);
      const fetched: RichiestaFerie[] = [];
      snap.forEach(docSnap => {
        const data = docSnap.data();
        const dInizio = data.dataInizio || data.data || '';
        if (dInizio <= endStr) {
          fetched.push({
            id: docSnap.id,
            dipendenteName: data.dipendenteName,
            data: data.data || '',
            tipo: mapRequestTipo(data.dipendenteName, docSnap.id, data.tipo),
            stato: data.stato || 'In attesa',
            frazioneTipo: data.frazioneTipo,
            dataInizio: data.dataInizio,
            dataFine: data.dataFine,
            oraInizio: data.oraInizio,
            oraFine: data.oraFine,
            timestamp: data.timestamp,
            note: data.note || '',
            comunicazioneId: data.comunicazioneId || '',
            pausaPranzo: data.pausaPranzo || false,
            pausaPranzoOre: data.pausaPranzoOre || 0,
            richiestaModifica: data.richiestaModifica || null
          });
        }
      });

      if (isHR || isAdmin) {
        setHrRichieste(prev => {
          const existingIds = new Set(prev.map(p => p.id));
          const newItems = fetched.filter(f => !existingIds.has(f.id));
          return [...prev, ...newItems];
        });
      }

      const myNameClean = (myAssociatedName || '').trim().toLowerCase();
      setOthersApprovedRichieste(prev => {
        const existingIds = new Set(prev.map(p => p.id));
        const newItems = fetched.filter(f => f.stato === 'Approvato' && (f.dipendenteName || '').trim().toLowerCase() !== myNameClean && !existingIds.has(f.id));
        return [...prev, ...newItems];
      });

      setLoadedYears(prev => new Set([...Array.from(prev), targetYear]));
    } catch (err) {
      console.error("Errore caricamento anno su richiesta:", err);
    }
  };

  const [loadedMonths, setLoadedMonths] = useState<Set<string>>(() => new Set<string>());

  const ensureMonthLoaded = async (year: number, month: number) => {
    const monthKey = `${year}-${String(month).padStart(2, '0')}`;
    if (loadedMonths.has(monthKey)) return;

    try {
      const startStr = `${year}-${String(month).padStart(2, '0')}-01`;
      const lastDay = new Date(year, month, 0).getDate();
      const endStr = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

      // Query mirata esclusivamente al mese selezionato per limitare al minimo le letture Firestore
      const qRange = query(
        collection(db, 'richieste_ferie'),
        where('dataFine', '>=', startStr)
      );
      const qSingle = query(
        collection(db, 'richieste_ferie'),
        where('data', '>=', startStr),
        where('data', '<=', endStr)
      );

      const [snapRange, snapSingle] = await Promise.all([
        getDocs(qRange),
        getDocs(qSingle)
      ]);

      const fetchedMap = new Map<string, RichiestaFerie>();

      const processDoc = (docSnap: any) => {
        if (fetchedMap.has(docSnap.id)) return;
        const data = docSnap.data();
        const dInizio = data.dataInizio || data.data || '';
        const dFine = data.dataFine || data.data || '';

        // Filtro rigoroso sul mese specifico visualizzato
        if (dInizio <= endStr && dFine >= startStr) {
          fetchedMap.set(docSnap.id, {
            id: docSnap.id,
            dipendenteName: data.dipendenteName,
            data: data.data || '',
            tipo: mapRequestTipo(data.dipendenteName, docSnap.id, data.tipo),
            stato: data.stato || 'In attesa',
            frazioneTipo: data.frazioneTipo,
            dataInizio: data.dataInizio,
            dataFine: data.dataFine,
            oraInizio: data.oraInizio,
            oraFine: data.oraFine,
            timestamp: data.timestamp,
            note: data.note || '',
            comunicazioneId: data.comunicazioneId || '',
            pausaPranzo: data.pausaPranzo || false,
            pausaPranzoOre: data.pausaPranzoOre || 0,
            richiestaModifica: data.richiestaModifica || null
          });
        }
      };

      snapRange.forEach(processDoc);
      snapSingle.forEach(processDoc);

      const fetched = Array.from(fetchedMap.values());

      if (isHR || isAdmin) {
        setHrRichieste(prev => {
          const existingIds = new Set(prev.map(p => p.id));
          const newItems = fetched.filter(f => !existingIds.has(f.id));
          return [...prev, ...newItems];
        });
      }

      const myNameClean = (myAssociatedName || '').trim().toLowerCase();

      // Merge delle proprie richieste del mese
      setMyRichieste(prev => {
        const existingIds = new Set(prev.map(p => p.id));
        const newItems = fetched.filter(f => (f.dipendenteName || '').trim().toLowerCase() === myNameClean && !existingIds.has(f.id));
        return [...prev, ...newItems];
      });

      // Merge delle richieste approvate altrui del mese
      setOthersApprovedRichieste(prev => {
        const existingIds = new Set(prev.map(p => p.id));
        const newItems = fetched.filter(f => f.stato === 'Approvato' && (f.dipendenteName || '').trim().toLowerCase() !== myNameClean && !existingIds.has(f.id));
        return [...prev, ...newItems];
      });

      // Salva il mese scaricato nella cache locale
      setLoadedMonths(prev => new Set([...Array.from(prev), monthKey]));
    } catch (err) {
      console.error("Errore caricamento mese su richiesta:", err);
    }
  };

  useEffect(() => {
    if (currentMonth) {
      ensureMonthLoaded(currentMonth.getFullYear(), currentMonth.getMonth() + 1);
    }
  }, [currentMonth]);

  // States per l'annullamento ferie da parte di HR
  const [cancellationRequest, setCancellationRequest] = useState<RichiestaFerie | null>(null);
  const [cancellationReason, setCancellationReason] = useState('');
  const [cancellationLoading, setCancellationLoading] = useState(false);

  // States per richiesta modifica / annullamento da parte del dipendente
  const [modifyingRequest, setModifyingRequest] = useState<RichiestaFerie | null>(null);
  const [modTipoAzione, setModTipoAzione] = useState<'annullamento' | 'modifica'>('annullamento');
  const [modDataInizio, setModDataInizio] = useState('');
  const [modDataFine, setModDataFine] = useState('');
  const [modOraInizio, setModOraInizio] = useState('09:00');
  const [modOraFine, setModOraFine] = useState('18:00');
  const [modFrazioneTipo, setModFrazioneTipo] = useState<'mattina' | 'pomeriggio' | 'giornata' | 'orario'>('giornata');
  const [modTipo, setModTipo] = useState('ferie');
  const [modMotivazione, setModMotivazione] = useState('');
  const [modLoading, setModLoading] = useState(false);

  // States per il filtraggio della lista richieste
  const [requestTab, setRequestTab] = useState<'tutte' | 'in_attesa' | 'approvate' | 'storico'>('tutte');
  const [searchResourceText, setSearchResourceText] = useState('');

  const [counterYearSummaries, setCounterYearSummaries] = useState<Record<number, any>>(() => getInitialSummaries());

  const updateCounterSummaries = (updater: (prev: Record<number, any>) => Record<number, any>) => {
    setCounterYearSummaries(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      saveSummariesToCache(next);
      return next;
    });
  };

  const loadFerieData = async () => {
    try {
      const closuresSnap = await getDocs(collection(db, 'chiusure_aziendali')).catch(err => {
        console.error("Errore query chiusure:", err);
        return null;
      });
      const listClosures: any[] = [];
      if (closuresSnap) {
        closuresSnap.forEach(d => {
          listClosures.push(d.data());
        });
      }
      setChiusureAziendali(listClosures);

      // Carica SOLO il mese corrente al primo avvio per limitare le letture Firestore.
      // I mesi successivi vengono caricati on-demand da ensureMonthLoaded al cambio mese.
      const now = new Date();
      const curYear = now.getFullYear();
      const curMonth = now.getMonth() + 1;
      const startLimit = `${curYear}-${String(curMonth).padStart(2, '0')}-01`;
      const lastDay = new Date(curYear, curMonth, 0).getDate();
      const endLimit = `${curYear}-${String(curMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      const curMonthKey = `${curYear}-${String(curMonth).padStart(2, '0')}`;

      const fetchAndMapDoc = (docSnap: any): RichiestaFerie | null => {
        const data = docSnap.data();
        const dInizio = data.dataInizio || data.data || '';
        const dFine = data.dataFine || data.data || '';
        if (dInizio > endLimit || dFine < startLimit) return null;
        return {
          id: docSnap.id,
          dipendenteName: data.dipendenteName,
          data: data.data || '',
          tipo: mapRequestTipo(data.dipendenteName, docSnap.id, data.tipo),
          stato: data.stato || 'In attesa',
          frazioneTipo: data.frazioneTipo,
          dataInizio: data.dataInizio,
          dataFine: data.dataFine,
          oraInizio: data.oraInizio,
          oraFine: data.oraFine,
          timestamp: data.timestamp,
          note: data.note || '',
          comunicazioneId: data.comunicazioneId || '',
          pausaPranzo: data.pausaPranzo || false,
          pausaPranzoOre: data.pausaPranzoOre || 0,
          richiestaModifica: data.richiestaModifica || null
        };
      };

      if (isHR || isAdmin) {
        const qRange = query(collection(db, 'richieste_ferie'), where('dataFine', '>=', startLimit));
        const qSingle = query(
          collection(db, 'richieste_ferie'),
          where('data', '>=', startLimit),
          where('data', '<=', endLimit)
        );
        const [snapRange, snapSingle] = await Promise.all([getDocs(qRange), getDocs(qSingle)]);
        const mapHR = new Map<string, RichiestaFerie>();
        snapRange.forEach(d => { const r = fetchAndMapDoc(d); if (r) mapHR.set(r.id, r); });
        snapSingle.forEach(d => { const r = fetchAndMapDoc(d); if (r && !mapHR.has(r.id)) mapHR.set(r.id, r); });
        setHrRichieste(Array.from(mapHR.values()));
      }

      if (myAssociatedName) {
        // Proprie richieste: tutte (senza limite di data, usate anche per storico personale e contatori)
        const qMy = query(collection(db, 'richieste_ferie'), where('dipendenteName', '==', myAssociatedName));
        const mySnap = await getDocs(qMy);
        const listMy: RichiestaFerie[] = [];
        mySnap.forEach(docSnap => {
          const data = docSnap.data();
          listMy.push({
            id: docSnap.id,
            dipendenteName: data.dipendenteName,
            data: data.data || '',
            tipo: mapRequestTipo(data.dipendenteName, docSnap.id, data.tipo),
            stato: data.stato || 'In attesa',
            frazioneTipo: data.frazioneTipo,
            dataInizio: data.dataInizio,
            dataFine: data.dataFine,
            oraInizio: data.oraInizio,
            oraFine: data.oraFine,
            timestamp: data.timestamp,
            note: data.note || '',
            comunicazioneId: data.comunicazioneId || '',
            pausaPranzo: data.pausaPranzo || false,
            pausaPranzoOre: data.pausaPranzoOre || 0,
            richiestaModifica: data.richiestaModifica || null
          });
        });
        setMyRichieste(listMy);

        // Richieste altrui approvate: solo mese corrente (il resto si carica con ensureMonthLoaded)
        const qOthersRange = query(collection(db, 'richieste_ferie'), where('dataFine', '>=', startLimit));
        const qOthersSingle = query(
          collection(db, 'richieste_ferie'),
          where('data', '>=', startLimit),
          where('data', '<=', endLimit)
        );
        const [othersSnap, othersSingleSnap] = await Promise.all([getDocs(qOthersRange), getDocs(qOthersSingle)]);
        const mapOthers = new Map<string, RichiestaFerie>();
        const processOther = (docSnap: any) => {
          if (mapOthers.has(docSnap.id)) return;
          const data = docSnap.data();
          if (data.stato !== 'Approvato' || data.dipendenteName === myAssociatedName) return;
          const r = fetchAndMapDoc(docSnap);
          if (r) mapOthers.set(r.id, r);
        };
        othersSnap.forEach(processOther);
        othersSingleSnap.forEach(processOther);
        setOthersApprovedRichieste(Array.from(mapOthers.values()));
      }

      // Segna il mese corrente come già caricato nella cache
      setLoadedMonths(prev => new Set([...Array.from(prev), curMonthKey]));

      // Carica autorizzazioni weekend approvate per tutti
      const wkSnap = await getDocs(query(
        collection(db, 'richieste_weekend'),
        where('stato', '==', 'Approvato')
      )).catch(err => {
        console.error("Errore query weekend:", err);
        return null;
      });
      const wkMap: Record<string, boolean> = {};
      if (wkSnap) {
        wkSnap.forEach(docSnap => {
          const d = docSnap.data();
          if (d.dipendenteName && d.data) {
            wkMap[`${d.dipendenteName}_${d.data}`] = true;
          }
        });
      }
      setApprovedWeekends(wkMap);

      // Carica e garantisce la presenza delle sintesi 2025 e 2026 per contatori e grafici (solo se dipendenti caricati!)
      if (dipendenti && dipendenti.length > 0) {
        [2025, 2026].forEach(async y => {
          try {
            const docRef = doc(db, 'storico_annuale_ferie', String(y));
            const snap = await getDoc(docRef);
            if (snap.exists() && snap.data()?.employeeStats && Object.keys(snap.data().employeeStats).length > 0) {
              updateCounterSummaries(prev => ({ ...prev, [y]: snap.data() }));
            } else {
              const newSum = await rebuildYearlySummary(y, dipendenti);
              if (newSum) {
                updateCounterSummaries(prev => ({ ...prev, [y]: newSum }));
              }
            }
          } catch (err) {
            console.error(`Errore caricamento sintesi ${y}:`, err);
            const newSum = await rebuildYearlySummary(y, dipendenti);
            if (newSum) {
              updateCounterSummaries(prev => ({ ...prev, [y]: newSum }));
            }
          }
        });
      }
    } catch (err) {
      console.error("Error loading ferie data:", err);
      showToast("Errore nel caricamento delle ferie.", "error");
    }
  };

  const loadWeekendData = async () => {
    try {
      if (myAssociatedName) {
        const qMy = query(
          collection(db, 'richieste_weekend'),
          where('dipendenteName', '==', myAssociatedName)
        );
        const snapMy = await getDocs(qMy);
        const listMy: any[] = [];
        snapMy.forEach(d => listMy.push({ id: d.id, ...d.data() }));
        listMy.sort((a, b) => (b.data || '').localeCompare(a.data || ''));
        setMyWeekendRequests(listMy);
      }

      if (isHR || isAdmin || isSoci(myAssociatedName)) {
        const snapAll = await getDocs(collection(db, 'richieste_weekend'));
        const listAll: any[] = [];
        snapAll.forEach(d => listAll.push({ id: d.id, ...d.data() }));
        listAll.sort((a, b) => (b.data || '').localeCompare(a.data || ''));
        setAllWeekendRequests(listAll);
      }
    } catch (err) {
      console.error("Error loading weekend requests:", err);
    }
  };

  useEffect(() => {
    const now = new Date();
    const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    setLoadedMonths(new Set([currentMonthKey]));
    setLoadedYears(new Set<number>());
    loadFerieData();
    loadWeekendData();
  }, [myAssociatedName, isHR, isAdmin, isDev]);

  useEffect(() => {
    if (dipendenti && dipendenti.length > 0) {
      [2025, 2026].forEach(async y => {
        try {
          const docRef = doc(db, 'storico_annuale_ferie', String(y));
          const snap = await getDoc(docRef);
          if (snap.exists() && snap.data()?.employeeStats && Object.keys(snap.data().employeeStats).length > 0) {
            updateCounterSummaries(prev => ({ ...prev, [y]: snap.data() }));
          } else {
            const newSum = await rebuildYearlySummary(y, dipendenti);
            if (newSum) {
              updateCounterSummaries(prev => ({ ...prev, [y]: newSum }));
            }
          }
        } catch (err) {
          console.error(`Errore caricamento sintesi ${y}:`, err);
        }
      });
    }
  }, [dipendenti]);

  const handleRequestWeekendSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!myAssociatedName || !userEmail) return;
    if (!reqWeekendData) {
      showToast("Seleziona una data!", "warning");
      return;
    }

    const todayObj = new Date();
    const todayStr = `${todayObj.getFullYear()}-${String(todayObj.getMonth() + 1).padStart(2, '0')}-${String(todayObj.getDate()).padStart(2, '0')}`;
    if (reqWeekendData <= todayStr) {
      showToast("Le richieste di autorizzazione per lavoro festivo/straordinario devono essere inviate con almeno 1 giorno di anticipo (entro la mezzanotte del giorno precedente).", "warning");
      return;
    }

    setReqWeekendLoading(true);
    try {
      await addDoc(collection(db, 'richieste_weekend'), {
        dipendenteName: myAssociatedName,
        dipendenteEmail: userEmail,
        data: reqWeekendData,
        motivo: reqWeekendMotivo,
        stato: 'In attesa',
        timestamp: new Date().toISOString()
      });
      setReqWeekendData('');
      setReqWeekendMotivo('');
      showToast("Richiesta inviata con successo!");
      loadWeekendData();
    } catch (err) {
      console.error("Errore invio richiesta:", err);
      showToast("Errore nell'invio della richiesta.", "error");
    } finally {
      setReqWeekendLoading(false);
    }
  };

  const sendWeekendApprovalMailToSoci = async (
    dipendenteNome: string,
    dataFestivo: string,
    motivo: string,
    approvedByName: string
  ) => {
    try {
      const formattedData = formatDate(dataFestivo) || dataFestivo;
      const nowStr = new Date().toLocaleDateString('it-IT', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });

      const subject = `[Lavoro Festivo Approvato] ${dipendenteNome} - ${formattedData}`;
      const htmlBody = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b; max-width: 680px; margin: 0 auto; background-color: #ffffff; border: 1px solid #cbd5e1; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.06);">
          
          <!-- Header Dark Navy Email-Safe con Fallback Outlook -->
          <table width="100%" border="0" cellpadding="0" cellspacing="0" bgcolor="#0f172a" style="width: 100%; background-color: #0f172a; background: linear-gradient(135deg, #0f172a 0%, #312e81 50%, #4338ca 100%);">
            <tr>
              <td bgcolor="#0f172a" style="background-color: #0f172a; padding: 26px; color: #ffffff;">
                <table border="0" cellpadding="0" cellspacing="0" width="100%" style="width: 100%;">
                  <tr>
                    <td valign="top" style="vertical-align: top;">
                      <div style="font-size: 11px; font-weight: 900; text-transform: uppercase; letter-spacing: 1.5px; color: #a5b4fc; margin-bottom: 6px;">
                        Autorizzazione Lavoro Straordinario / Festivo
                      </div>
                      <h1 style="margin: 0; font-size: 22px; font-weight: 900; color: #ffffff; line-height: 1.25;">
                        ${dipendenteNome} — ${formattedData}
                      </h1>
                      <div style="margin-top: 10px; font-size: 13px; color: #e0e7ff; font-weight: 600;">
                        🛡️ Approvato per lavoro nel weekend / festività
                      </div>
                    </td>
                    <td align="right" valign="top" style="text-align: right; vertical-align: top; width: 130px;">
                      <span style="background-color: #10b981; color: #ffffff; padding: 6px 14px; border-radius: 20px; font-size: 11px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.5px; display: inline-block;">
                        🟢 AUTORIZZATO
                      </span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>

          <div style="padding: 26px;">
            <p style="font-size: 13px; color: #334155; margin-top: 0; margin-bottom: 20px; line-height: 1.5; font-weight: 600;">
              Notifica automatica per i <strong>Soci</strong>: è stata approvata una richiesta di autorizzazione per lo svolgimento di attività lavorativa in giornata festiva o durante il fine settimana.
            </p>

            <h3 style="margin-top: 0; font-size: 13px; text-transform: uppercase; letter-spacing: 0.8px; color: #1e1b4b; border-bottom: 2px solid #6366f1; padding-bottom: 8px; margin-bottom: 16px; font-weight: 900;">
              📋 Dettaglio Autorizzazione Lavoro Festivo
            </h3>

            <table border="0" cellpadding="10" cellspacing="0" style="width: 100%; font-size: 13px; color: #334155; border-collapse: collapse; margin-bottom: 24px; background-color: #f8fafc; border-radius: 12px; overflow: hidden; border: 1px solid #e2e8f0;">
              <tr style="border-bottom: 1px solid #e2e8f0;">
                <td style="font-weight: bold; width: 220px; color: #475569; background-color: #f1f5f9;">Risorsa Autorizzata:</td>
                <td style="font-weight: 900; color: #0f172a; font-size: 14px;">${dipendenteNome}</td>
              </tr>
              <tr style="border-bottom: 1px solid #e2e8f0;">
                <td style="font-weight: bold; color: #475569; background-color: #f1f5f9;">Data / Giorno Festivo:</td>
                <td style="font-weight: 800; color: #4338ca; font-size: 14px;">${formattedData}</td>
              </tr>
              <tr style="border-bottom: 1px solid #e2e8f0;">
                <td style="font-weight: bold; color: #475569; background-color: #f1f5f9;">Motivazione / Attività:</td>
                <td style="font-weight: 700; color: #0f172a;">${motivo || 'Autorizzazione lavoro festivo'}</td>
              </tr>
              <tr style="border-bottom: 1px solid #e2e8f0;">
                <td style="font-weight: bold; color: #475569; background-color: #f1f5f9;">Approvato Da:</td>
                <td style="font-weight: 700; color: #047857;">${approvedByName}</td>
              </tr>
              <tr>
                <td style="font-weight: bold; color: #475569; background-color: #f1f5f9;">Data Registrazione:</td>
                <td style="font-weight: 600; color: #64748b;">${nowStr}</td>
              </tr>
            </table>

            <div style="padding: 14px 18px; background-color: #eef2ff; border: 1px solid #c7d2fe; border-radius: 12px; font-size: 12px; color: #3730a3; font-weight: 600;">
              ℹ️ Questa comunicazione è trasmessa automaticamente a tutti i Soci in conformità alle direttive aziendali per il monitoraggio delle presenze nei giorni non lavorativi.
            </div>
          </div>

        </div>
      `;

      const sociEmails = await getSociNotificationEmails(dipendenti);
      for (const email of sociEmails) {
        await queueMail(email, subject, htmlBody, undefined, { isSystemNotification: true });
      }
    } catch (err) {
      console.error("Errore invio email approvazione festivi ai soci:", err);
    }
  };

  const handleWeekendDecision = async (id: string, action: 'Approvato' | 'Rifiutato' | 'Revocato' | 'Annullato') => {
    try {
      const req = allWeekendRequests.find(r => r.id === id);
      if (!req) return;
      
      const updates: Record<string, any> = { stato: action };

      if (action === 'Approvato' && req.nuovaData) {
        updates.data = req.nuovaData;
        if (req.nuovoMotivo) updates.motivo = req.nuovoMotivo;
        updates.nuovaData = null;
        updates.nuovoMotivo = null;
      }

      if (action === 'Annullato' || action === 'Revocato' || action === 'Rifiutato') {
        await deleteDoc(doc(db, 'richieste_weekend', id));
      } else {
        await updateDoc(doc(db, 'richieste_weekend', id), updates);
      }
      loadWeekendData();

      if (action === 'Approvato') {
        const targetData = req.nuovaData || req.data;
        const targetMotivo = req.nuovoMotivo || req.motivo || 'Autorizzazione lavoro weekend/festivo';
        const approver = myAssociatedName || userEmail || 'Ufficio HR';
        await sendWeekendApprovalMailToSoci(req.dipendenteName, targetData, targetMotivo, approver);

        if (req.dipendenteEmail) {
          await createUserNotification({
            destinatarioEmail: req.dipendenteEmail,
            destinatarioNome: req.dipendenteName,
            titolo: '✅ Lavoro Festivo Approvato',
            messaggio: `La tua richiesta di lavoro per ${formatDate(targetData)} è stata approvata dall'HR.`,
            tipo: 'ferie_approvate',
            link: '/presenze'
          });
        }
      }

      showToast(`Richiesta ${action.toLowerCase()} con successo!`);
    } catch (e) {
      console.error("Errore decisione weekend:", e);
      showToast("Errore durante l'aggiornamento della richiesta.", "error");
    }
  };

  const handleCancelPendingWeekendRequest = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'richieste_weekend', id));
      showToast("Richiesta eliminata con successo!");
      loadWeekendData();
    } catch (err) {
      console.error("Errore eliminazione richiesta:", err);
      showToast("Errore durante l'eliminazione della richiesta.", "error");
    }
  };

  const handleDirectWeekendAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!directAuthDipNome) {
      showToast("Seleziona una risorsa!", "warning");
      return;
    }
    if (!directAuthData) {
      showToast("Seleziona una data!", "warning");
      return;
    }

    const selectedDip = dipendenti.find(d => d.nome === directAuthDipNome);
    const email = selectedDip?.email || '';

    setDirectAuthLoading(true);
    try {
      await addDoc(collection(db, 'richieste_weekend'), {
        dipendenteName: directAuthDipNome,
        dipendenteEmail: email.toLowerCase(),
        data: directAuthData,
        motivo: directAuthMotivo || 'Autorizzazione d\'ufficio dall\'HR',
        stato: 'Approvato',
        timestamp: new Date().toISOString()
      });
      
      const approver = myAssociatedName || userEmail || 'Ufficio HR';
      await sendWeekendApprovalMailToSoci(directAuthDipNome, directAuthData, directAuthMotivo || "Autorizzazione d'ufficio dall'HR", approver);

      if (email) {
        await createUserNotification({
          destinatarioEmail: email,
          destinatarioNome: directAuthDipNome,
          titolo: '✅ Lavoro Festivo Autorizzato',
          messaggio: `Sei stato autorizzato per lavoro nel giorno ${formatDate(directAuthData)} dall'HR.`,
          tipo: 'ferie_approvate',
          link: '/presenze'
        });
      }

      setDirectAuthDipNome('');
      setDirectAuthData('');
      setDirectAuthMotivo('');
      showToast("Autorizzazione registrata ed approvata con successo!");
      loadWeekendData();
    } catch (err) {
      console.error("Errore registrazione autorizzazione:", err);
      showToast("Errore durante la registrazione dell'autorizzazione.", "error");
    } finally {
      setDirectAuthLoading(false);
    }
  };

  // Union list for regular users
  const requestsList = useMemo(() => {
    const map: Record<string, RichiestaFerie> = {};
    myRichieste.forEach(r => { map[r.id] = r; });
    othersApprovedRichieste.forEach(r => { map[r.id] = r; });
    return Object.values(map);
  }, [myRichieste, othersApprovedRichieste]);

  // Calcolo ore assenze per l'anno corrente (dal 01 gennaio al 31 dicembre)
  const currentYear = new Date().getFullYear();

  const yearlyStats = useMemo(() => {
    if (!targetDipName) {
      return { ferieHours: 0, permessoHours: 0, malattiaHours: 0, assenzeGenericheHours: 0 };
    }

    const summary = counterYearSummaries[currentYear];
    const dipNameClean = (targetDipName || '').trim().toLowerCase();
    
    let stats: any = null;
    if (summary && summary.employeeStats) {
      if (summary.employeeStats[dipNameClean]) {
        stats = summary.employeeStats[dipNameClean];
      } else {
        const foundKey = Object.keys(summary.employeeStats).find(k => areNamesEqual(k, targetDipName));
        if (foundKey) stats = summary.employeeStats[foundKey];
      }
    }

    if (stats) {
      return {
        ferieHours: Math.round((stats.ferie || 0) * 100) / 100,
        permessoHours: Math.round((stats.permessi || 0) * 100) / 100,
        malattiaHours: Math.round((stats.malattia || 0) * 100) / 100,
        assenzeGenericheHours: Math.round((stats.totale || 0) * 100) / 100
      };
    }

    const allList = isHR ? hrRichieste : requestsList;
    const approvedTarget = allList.filter(r => 
      r.stato === 'Approvato' && 
      r.dipendenteName === targetDipName &&
      r.note !== 'Chiusure Aziendali'
    );

    let ferieHours = 0;
    let permessoHours = 0;
    let malattiaHours = 0;
    let assenzeGenericheHours = 0;

    approvedTarget.forEach(req => {
      const dates: string[] = [];
      if (req.dataInizio && req.dataFine) {
        const [sY, sM, sD] = req.dataInizio.split('-').map(Number);
        const [eY, eM, eD] = req.dataFine.split('-').map(Number);
        if (!isNaN(sY) && !isNaN(eY)) {
          const curr = new Date(sY, sM - 1, sD);
          const end = new Date(eY, eM - 1, eD);
          while (curr <= end) {
            const y = curr.getFullYear();
            const m = String(curr.getMonth() + 1).padStart(2, '0');
            const d = String(curr.getDate()).padStart(2, '0');
            dates.push(`${y}-${m}-${d}`);
            curr.setDate(curr.getDate() + 1);
          }
        }
      } else if (req.data) {
        dates.push(req.data);
      } else if (req.dataInizio) {
        dates.push(req.dataInizio);
      }

      let reqTotalHrs = 0;

      for (const dateStr of dates) {
        if (!dateStr || !dateStr.startsWith(`${currentYear}-`)) continue;

        const isWk = isWeekend(dateStr);
        const isHol = isItalianHoliday(dateStr);
        const isWkApproved = approvedWeekends[`${req.dipendenteName}_${dateStr}`];

        if ((isWk || isHol) && !isWkApproved) {
          continue;
        }

        const frazione = req.frazioneTipo;
        const tipo = req.tipo;

        if (frazione === 'mattina' || frazione === 'pomeriggio' || tipo === 'mattina' || tipo === 'pomeriggio') {
          reqTotalHrs += 4;
        } else if ((frazione === 'orario' || tipo === 'orario' || tipo === 'permesso' || tipo === 'assenza') && req.oraInizio && req.oraFine) {
          const [hStart, mStart] = req.oraInizio.split(':').map(Number);
          const [hEnd, mEnd] = req.oraFine.split(':').map(Number);
          const diffMs = new Date(2000, 0, 1, hEnd, mEnd).getTime() - new Date(2000, 0, 1, hStart, mStart).getTime();
          let hrs = Math.max(0, Math.round((diffMs / 3600000) * 100) / 100);
          if (req.pausaPranzo && req.pausaPranzoOre) {
            hrs = Math.max(0, hrs - req.pausaPranzoOre);
          }
          reqTotalHrs += hrs;
        } else {
          reqTotalHrs += 8;
        }
      }

      assenzeGenericheHours += reqTotalHrs;
      const t = req.tipo;
      if (t === 'ferie') {
        ferieHours += reqTotalHrs;
      } else if (t === 'malattia' || t === 'maternita') {
        malattiaHours += reqTotalHrs;
      } else {
        permessoHours += reqTotalHrs;
      }
    });

    return {
      ferieHours: Math.round(ferieHours * 100) / 100,
      permessoHours: Math.round(permessoHours * 100) / 100,
      malattiaHours: Math.round(malattiaHours * 100) / 100,
      assenzeGenericheHours: Math.round(assenzeGenericheHours * 100) / 100
    };
  }, [isHR, hrRichieste, requestsList, targetDipName, currentYear, approvedWeekends, counterYearSummaries]);

  // States per la scheda Riepilogo Contatori Risorse (Soci & HR)
  const [mainTab, setMainTab] = useState<'piano' | 'weekend' | 'contatori_risorse'>('piano');
  
  useEffect(() => {
    if (isDev && mainTab === 'contatori_risorse') {
      setMainTab('piano');
    }
  }, [isDev, mainTab]);
  
  // States per autorizzazione weekend/chiusure
  const [reqWeekendData, setReqWeekendData] = useState('');
  const [reqWeekendMotivo, setReqWeekendMotivo] = useState('');
  const [reqWeekendLoading, setReqWeekendLoading] = useState(false);
  const [myWeekendRequests, setMyWeekendRequests] = useState<any[]>([]);
  const [allWeekendRequests, setAllWeekendRequests] = useState<any[]>([]);
  const [directAuthDipNome, setDirectAuthDipNome] = useState('');
  const [directAuthData, setDirectAuthData] = useState('');
  const [directAuthMotivo, setDirectAuthMotivo] = useState('');
  const [directAuthLoading, setDirectAuthLoading] = useState(false);

  const [counterYear, setCounterYear] = useState<number>(currentYear);
  const [counterMacroArea, setCounterMacroArea] = useState<string>('tutte');
  const [counterSearchText, setCounterSearchText] = useState<string>('');
  const [isResourceDropdownOpen, setIsResourceDropdownOpen] = useState<boolean>(false);
  const [selectedResource, setSelectedResource] = useState<any | null>(null);
  const [isRegenerating, setIsRegenerating] = useState<boolean>(false);

  // Rigenera forzatamente il documento di sintesi annuale su Firestore
  const handleRegenerateSummary = async () => {
    if (!dipendenti || dipendenti.length === 0) {
      showToast('Impossibile rigenerare: lista dipendenti non disponibile.', 'error');
      return;
    }
    setIsRegenerating(true);
    try {
      const newSummary = await rebuildYearlySummary(counterYear, dipendenti);
      if (newSummary) {
        updateCounterSummaries(prev => ({ ...prev, [counterYear]: newSummary }));
        showToast(`Sintesi ${counterYear} rigenerata con successo! I contatori sono ora aggiornati.`, 'success');
      } else {
        showToast(`Rigenerazione ${counterYear} fallita: controlla i permessi Firestore o la console per dettagli.`, 'error');
      }
    } catch (err) {
      console.error('Errore rigenerazione sintesi:', err);
      showToast('Errore durante la rigenerazione della sintesi annuale.', 'error');
    } finally {
      setIsRegenerating(false);
    }
  };

  // State per modale di analisi grafica dettagliata risorsa
  const [analyticsResource, setAnalyticsResource] = useState<any | null>(null);
  const [isAnalyticsOpen, setIsAnalyticsOpen] = useState<boolean>(false);

  useEffect(() => {
    const y = counterYear;
    ensureYearLoaded(y);
    if (counterYearSummaries[y] && Object.keys(counterYearSummaries[y]?.employeeStats || {}).length > 0) return;

    const docRef = doc(db, 'storico_annuale_ferie', String(y));
    getDoc(docRef).then(async snap => {
      if (snap.exists() && snap.data()?.employeeStats && Object.keys(snap.data().employeeStats).length > 0) {
        updateCounterSummaries(prev => ({ ...prev, [y]: snap.data() }));
      } else if (dipendenti && dipendenti.length > 0) {
        // Genera al volo se non esiste ancora su Firestore
        const newSummary = await rebuildYearlySummary(y, dipendenti);
        if (newSummary) {
          updateCounterSummaries(prev => ({ ...prev, [y]: newSummary }));
        }
      }
    }).catch(async () => {
      if (dipendenti && dipendenti.length > 0) {
        const newSummary = await rebuildYearlySummary(y, dipendenti);
        if (newSummary) {
          updateCounterSummaries(prev => ({ ...prev, [y]: newSummary }));
        }
      }
    });
  }, [counterYear, dipendenti]);

  // Aggregazione contatori per tutte le risorse dipendenti per l'anno selezionato (1 sola lettura da sintesi!)
  const allResourcesStats = useMemo(() => {
    if (isDev || (!isHR && !isAdmin && !isSoci(myAssociatedName))) return [];

    // Filtra ALL'ORIGINE solo i dipendenti veri e propri (i collaboratori P.IVA e i soci non hanno contatori ferie)
    const onlyDipendenti = dipendenti.filter(dip => {
      const dipName = dip.nome || '';
      return !isCollaboratore(dipName, dipendenti) && !isSoci(dipName);
    });

    const summary = counterYearSummaries[counterYear];
    if (summary && summary.employeeStats && Object.keys(summary.employeeStats).length > 0) {
      return onlyDipendenti.map(dip => {
        const dipName = dip.nome || '';
        const dipNameClean = dipName.trim().toLowerCase();
        
        let stats = summary.employeeStats[dipNameClean];
        if (!stats) {
          const foundKey = Object.keys(summary.employeeStats).find(k => areNamesEqual(k, dipName));
          if (foundKey) stats = summary.employeeStats[foundKey];
        }
        if (!stats) stats = { ferie: 0, permessi: 0, malattia: 0, smart: 0, totale: 0 };

        const ferieHours = stats.ferie || 0;
        const permessoHours = stats.permessi || 0;
        const malattiaHours = stats.malattia || 0;
        const totaleOreAssenze = Math.round((ferieHours + permessoHours + malattiaHours) * 100) / 100;

        return {
          dip,
          dipName,
          email: dip.email || '',
          macroArea: dip.macroArea || 'Non specificata',
          isCollab: false,
          ferieHours,
          permessoHours,
          malattiaHours,
          totaleOreAssenze
        };
      }).sort((a, b) => a.dipName.localeCompare(b.dipName));
    }

    const approvedTarget = hrRichieste.filter(r => 
      r.stato === 'Approvato' && 
      r.note !== 'Chiusure Aziendali'
    );

    return onlyDipendenti.map(dip => {
      const dipName = dip.nome || '';

      const userApprovedReqs = approvedTarget.filter(r => 
        r.dipendenteName?.trim().toLowerCase() === dipName.trim().toLowerCase()
      );

      let ferieHours = 0;
      let permessoHours = 0;
      let malattiaHours = 0;

      userApprovedReqs.forEach(req => {
        const dates: string[] = [];
        if (req.dataInizio && req.dataFine) {
          const [sY, sM, sD] = req.dataInizio.split('-').map(Number);
          const [eY, eM, eD] = req.dataFine.split('-').map(Number);
          if (!isNaN(sY) && !isNaN(eY)) {
            const curr = new Date(sY, sM - 1, sD);
            const end = new Date(eY, eM - 1, eD);
            while (curr <= end) {
              const y = curr.getFullYear();
              const m = String(curr.getMonth() + 1).padStart(2, '0');
              const d = String(curr.getDate()).padStart(2, '0');
              dates.push(`${y}-${m}-${d}`);
              curr.setDate(curr.getDate() + 1);
            }
          }
        } else if (req.data) {
          dates.push(req.data);
        } else if (req.dataInizio) {
          dates.push(req.dataInizio);
        }

        let reqTotalHrs = 0;

        for (const dateStr of dates) {
          if (!dateStr || !dateStr.startsWith(`${counterYear}-`)) continue;

          const isWk = isWeekend(dateStr);
          const isHol = isItalianHoliday(dateStr);
          const isWkApproved = approvedWeekends[`${req.dipendenteName}_${dateStr}`];

          if ((isWk || isHol) && !isWkApproved) {
            continue;
          }

          const frazione = req.frazioneTipo;
          const tipo = req.tipo;

          if (frazione === 'mattina' || frazione === 'pomeriggio' || tipo === 'mattina' || tipo === 'pomeriggio') {
            reqTotalHrs += 4;
          } else if ((frazione === 'orario' || tipo === 'orario' || tipo === 'permesso' || tipo === 'assenza') && req.oraInizio && req.oraFine) {
            const [hStart, mStart] = req.oraInizio.split(':').map(Number);
            const [hEnd, mEnd] = req.oraFine.split(':').map(Number);
            const diffMs = new Date(2000, 0, 1, hEnd, mEnd).getTime() - new Date(2000, 0, 1, hStart, mStart).getTime();
            let hrs = Math.max(0, Math.round((diffMs / 3600000) * 100) / 100);
            if (req.pausaPranzo && req.pausaPranzoOre) {
              const pOre = parseFloat(req.pausaPranzoOre.toString()) || 0;
              hrs = Math.max(0, hrs - pOre);
            }
            reqTotalHrs += hrs;
          } else {
            reqTotalHrs += 8;
          }
        }

        const t = (req.tipo || '').toLowerCase();
        const isSmartWorking = t === 'smart' || t.includes('smart') || t.includes('lavoro da casa');

        if (isSmartWorking) {
          // Lavoro da Casa non è un'assenza: ignora dal conteggio assenze
          return;
        }

        if (t === 'ferie' || t.includes('ferie')) {
          ferieHours += reqTotalHrs;
        } else if (t === 'malattia' || t.includes('malattia') || t.includes('maternita') || t.includes('maternità') || t.includes('infortunio')) {
          malattiaHours += reqTotalHrs;
        } else {
          permessoHours += reqTotalHrs;
        }
      });

      const totaleOreAssenze = Math.round((ferieHours + permessoHours + malattiaHours) * 100) / 100;

      return {
        dip,
        dipName,
        email: dip.email || '',
        macroArea: dip.macroArea || 'Non specificata',
        isCollab: false,
        ferieHours: Math.round(ferieHours * 100) / 100,
        permessoHours: Math.round(permessoHours * 100) / 100,
        malattiaHours: Math.round(malattiaHours * 100) / 100,
        totaleOreAssenze
      };
    }).sort((a, b) => a.dipName.localeCompare(b.dipName));
  }, [isHR, isAdmin, hrRichieste, dipendenti, counterYear, approvedWeekends, counterYearSummaries]);

  // Filtro per ricerca e macro-area
  const filteredResourceStats = useMemo(() => {
    return allResourcesStats.filter(stat => {
      if (counterMacroArea !== 'tutte' && stat.macroArea !== counterMacroArea) {
        return false;
      }
      if (counterSearchText) {
        const queryStr = counterSearchText.toLowerCase().trim();
        const matchName = stat.dipName.toLowerCase().includes(queryStr);
        const matchEmail = stat.email.toLowerCase().includes(queryStr);
        const matchArea = stat.macroArea.toLowerCase().includes(queryStr);
        if (!matchName && !matchEmail && !matchArea) return false;
      }
      return true;
    });
  }, [allResourcesStats, counterMacroArea, counterSearchText]);

  // Esportazione CSV
  const handleExportCSV = () => {
    const headers = [
      "Risorsa",
      "Macro Area",
      "Ore Ferie",
      "Giorni Ferie Equivalenti (~8h)",
      "Ore Permesso",
      "Ore Malattia/Maternita",
      "Totale Ore Assenze"
    ];

    const rows = filteredResourceStats.map(stat => [
      `"${stat.dipName.replace(/"/g, '""')}"`,
      `"${stat.macroArea.replace(/"/g, '""')}"`,
      stat.ferieHours,
      (stat.ferieHours / 8).toFixed(1).replace('.', ','),
      stat.permessoHours,
      stat.malattiaHours,
      stat.totaleOreAssenze
    ]);

    const csvContent = "\uFEFF" + [headers.join(";"), ...rows.map(r => r.join(";"))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Report_Contatori_Assenze_${counterYear}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Stampa / PDF Report Contatori Risorse (Finestra di Stampa Dedicata)
  const handlePrintContatoriReport = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      showToast("Consenti i pop-up per stampare il report contatori.", "warning");
      return;
    }

    const rowsHtml = filteredResourceStats.length === 0 ? `
      <tr>
        <td colspan="6" style="text-align: center; padding: 20px; color: #9ca3af; font-weight: 700;">
          Nessun dipendente trovato per i filtri selezionati.
        </td>
      </tr>
    ` : filteredResourceStats.map((stat, idx) => {
      const ferieText = `<strong>${stat.ferieHours} h</strong> <span class="days-sub">(~${(stat.ferieHours / 8).toFixed(1).replace('.0', '')} gg)</span>`;
      const permessioniText = `<strong>${stat.permessoHours} h</strong> <span class="days-sub">(~${(stat.permessoHours / 8).toFixed(1).replace('.0', '')} gg)</span>`;
      const malattiaText = `<strong>${stat.malattiaHours} h</strong> <span class="days-sub">(~${(stat.malattiaHours / 8).toFixed(1).replace('.0', '')} gg)</span>`;
      const totaleText = `<strong>${stat.totaleOreAssenze} h</strong> <span class="days-sub">(~${(stat.totaleOreAssenze / 8).toFixed(1).replace('.0', '')} gg)</span>`;
      const rowBg = idx % 2 === 1 ? 'background-color: #f9fafb;' : 'background-color: #ffffff;';

      return `
        <tr style="${rowBg}">
          <td style="padding: 5px 8px; border: 1px solid #d1d5db;">
            <div style="font-size: 10.5px; font-weight: 800; color: #111827;">${stat.dipName}</div>
            <div style="font-size: 8.5px; font-weight: 600; color: #2563eb;">Dipendente</div>
          </td>
          <td style="padding: 5px 8px; border: 1px solid #d1d5db; font-size: 10px; font-weight: 600; color: #374151;">
            ${stat.macroArea}
          </td>
          <td style="padding: 5px 8px; border: 1px solid #d1d5db; text-align: center; font-size: 10px;">
            ${ferieText}
          </td>
          <td style="padding: 5px 8px; border: 1px solid #d1d5db; text-align: center; font-size: 10px;">
            ${permessioniText}
          </td>
          <td style="padding: 5px 8px; border: 1px solid #d1d5db; text-align: center; font-size: 10px;">
            ${malattiaText}
          </td>
          <td style="padding: 5px 8px; border: 1px solid #d1d5db; text-align: center; font-size: 10px; color: #dc2626;">
            ${totaleText}
          </td>
        </tr>
      `;
    }).join('');

    const htmlContent = `
      <!DOCTYPE html>
      <html lang="it">
      <head>
        <meta charset="UTF-8">
        <title>Report Contatori Assenze</title>
        <style>
          @page { size: A4 portrait; margin: 10mm; }
          * { box-sizing: border-box !important; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          html, body { margin: 0 !important; padding: 0 !important; background: #ffffff !important; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; font-size: 10px; color: #111827; }
          
          table.main-layout { width: 100%; border-collapse: collapse; border: none; }
          table.main-layout > thead > tr > td { padding: 0; border: none; }
          table.main-layout > tbody > tr > td { padding: 0; border: none; }
          table.main-layout > tfoot > tr > td { padding: 0; border: none; }

          .header-bar { display: flex; justify-content: space-between; align-items: flex-end; padding-bottom: 6px; margin-bottom: 8px; border-bottom: 2px solid #1f2937; }
          .header-logo { height: 36px; width: auto; }
          .header-title-right { text-align: right; font-size: 8.5px; font-weight: 800; color: #4b5563; text-transform: uppercase; letter-spacing: 0.5px; }
          
          .title-banner { background-color: #1f2937; color: #ffffff; padding: 6px 10px; border-radius: 5px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
          .title-banner-text { font-size: 11px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.5px; }
          .count-badge { background-color: rgba(255, 255, 255, 0.2); padding: 2px 7px; border-radius: 4px; font-size: 9.5px; font-weight: 900; }
          
          .filter-box { border: 1px solid #9ca3af; background-color: #f9fafb; padding: 6px 10px; border-radius: 5px; margin-bottom: 10px; font-size: 9px; font-weight: 600; color: #374151; display: flex; justify-content: space-between; flex-wrap: wrap; gap: 6px; }
          
          table.report-table { width: 100% !important; border-collapse: collapse !important; border: 1.5px solid #4b5563 !important; }
          table.report-table th { background-color: #f3f4f6 !important; color: #111827 !important; font-size: 9px !important; font-weight: 800 !important; text-transform: uppercase !important; letter-spacing: 0.5px !important; padding: 6px 8px !important; border: 1px solid #6b7280 !important; }
          table.report-table td { border: 1px solid #d1d5db !important; vertical-align: middle !important; }
          table.report-table tr { page-break-inside: avoid !important; break-inside: avoid !important; }
          .days-sub { font-size: 8.5px; color: #6b7280; font-weight: 500; margin-left: 4px; }
          
          .print-footer-static { margin-top: 10px; padding-top: 6px; padding-bottom: 4px; border-top: 1px solid #9ca3af; display: flex; justify-content: space-between; align-items: center; font-size: 8.5px; font-weight: 600; color: #4b5563; font-family: monospace; }
          .page-number::after { content: counter(page); }
        </style>
      </head>
      <body>
        <table class="main-layout">
          <thead>
            <tr>
              <td>
                <div class="header-bar">
                  <img src="/Logo.png" alt="Logo Ingegno" class="header-logo" />
                  <div class="header-title-right">INGEGNO P&C S.R.L. · REPORT ASSENZE</div>
                </div>
                <div class="title-banner">
                  <span class="title-banner-text">CONTATORI FERIE E PERMESSI (CONSUNTIVO)</span>
                  <span class="count-badge">ANNO ${counterYear}</span>
                </div>
              </td>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <div class="filter-box">
                  <span><strong>Ricerca:</strong> ${counterSearchText || 'Nessuna'}</span>
                  <span><strong>Macro Area:</strong> ${counterMacroArea === 'tutte' ? 'Tutte' : counterMacroArea}</span>
                  <span><strong>Data Stampa:</strong> ${getPrintDateString()}</span>
                  <span><strong>Totale Risorse:</strong> ${filteredResourceStats.length}</span>
                </div>

                <table class="report-table">
                  <thead>
                    <tr>
                      <th style="width: 25%; text-align: left;">Risorsa</th>
                      <th style="width: 25%; text-align: left;">Macro Area / Ruolo</th>
                      <th style="width: 12.5%; text-align: center;">Ferie Godute</th>
                      <th style="width: 12.5%; text-align: center;">Permessi Usufruiti</th>
                      <th style="width: 12.5%; text-align: center;">Malattia / Maternità</th>
                      <th style="width: 12.5%; text-align: center;">Totale Assenze</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${rowsHtml}
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td>
                <div class="print-footer-static">
                  <span>Piattaforma Pianificazione Aziendale</span>
                  <span>${APP_VERSION} — Data Stampa: ${getPrintDateString()}</span>
                </div>
              </td>
            </tr>
          </tfoot>
        </table>

        <script>
          function closeWindow() { try { window.close(); } catch(e) {} }
          window.onafterprint = closeWindow;
          window.onload = function() { setTimeout(function() { window.print(); closeWindow(); setTimeout(closeWindow, 500); }, 250); };
        </script>
      </body>
      </html>
    `;

    printWindow.document.open();
    printWindow.document.write(htmlContent);
    printWindow.document.close();
  };

  // Sorted full list depending on role
  const richieste = useMemo(() => {
    const list = isHR ? hrRichieste : requestsList;
    return list.sort((a, b) => {
      const timeA = a.timestamp ? new Date(a.timestamp).getTime() : new Date(a.dataInizio || a.data).getTime();
      const timeB = b.timestamp ? new Date(b.timestamp).getTime() : new Date(b.dataInizio || b.data).getTime();
      return timeB - timeA;
    });
  }, [hrRichieste, requestsList, isHR]);

  const pendingCount = useMemo(() => {
    const list = isHR ? hrRichieste : myRichieste;
    return list.filter(r => r.stato === 'In attesa' || r.stato === 'Richiesta Annullamento' || r.stato === 'Richiesta Modifica').length;
  }, [hrRichieste, myRichieste, isHR]);

  const [userSelectedTab, setUserSelectedTab] = useState<boolean>(false);

  useEffect(() => {
    if (!userSelectedTab) {
      if (pendingCount > 0) {
        setRequestTab('in_attesa');
      } else {
        setRequestTab('tutte');
      }
    }
  }, [pendingCount, userSelectedTab]);

  const searchedBaseRequests = useMemo(() => {
    let baseList = isHR ? hrRichieste : requestsList;

    if (!isHR) {
      baseList = baseList.filter(r => r.dipendenteName === myAssociatedName && r.note !== 'Chiusure Aziendali');
    } else {
      baseList = baseList.filter(r => r.note !== 'Chiusure Aziendali');
    }

    if (isHR && searchResourceText.trim()) {
      const term = searchResourceText.trim().toLowerCase();
      baseList = baseList.filter(r => r.dipendenteName?.toLowerCase().includes(term));
    }
    return baseList;
  }, [isHR, hrRichieste, requestsList, myAssociatedName, searchResourceText]);

  const filteredRequestsList = useMemo(() => {
    let baseList = [...searchedBaseRequests];

    // Filtra per Tab
    if (requestTab === 'in_attesa') {
      baseList = baseList.filter(r => r.stato === 'In attesa' || r.stato === 'Richiesta Annullamento' || r.stato === 'Richiesta Modifica');
    } else if (requestTab === 'approvate') {
      baseList = baseList.filter(r => r.stato === 'Approvato');
    } else if (requestTab === 'storico') {
      baseList = baseList.filter(r => r.stato === 'Rifiutato');
    }

    // Escludi dalla vista registro le ferie la cui data ultima è antecedente a 60 giorni fa per mantenere la sezione pulita
    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
    const sixtyDaysAgoStr = sixtyDaysAgo.toLocaleDateString('sv-SE');

    baseList = baseList.filter(r => {
      const lastDate = r.dataFine || r.dataInizio || r.data || '';
      return !lastDate || lastDate >= sixtyDaysAgoStr;
    });

    // Ordina in ordine cronologico dalla richiesta con la data più avanti nel tempo a quella più indietro
    return baseList.sort((a, b) => {
      const dateA = a.dataInizio || a.data || '';
      const dateB = b.dataInizio || b.data || '';
      if (dateA !== dateB) {
        return dateB.localeCompare(dateA);
      }
      const timeA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const timeB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return timeB - timeA;
    });
  }, [searchedBaseRequests, requestTab]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const isPowerUser = isHR;
    
    if (!isPowerUser && !myAssociatedName) {
      showToast("Devi avere un profilo associato nell'anagrafica per richiedere ferie.", "warning");
      return;
    }

    const targetDipName = isPowerUser ? dipendenteSelezionato : myAssociatedName;
    if (!targetDipName) {
      showToast("Seleziona un dipendente.", "warning");
      return;
    }
    
    if (requestMode === 'singolo' && !dataRichiesta) {
      showToast("Seleziona una data.", "warning");
      return;
    }
    
    if (requestMode === 'range' && (!dataInizio || !dataFine)) {
      showToast("Seleziona sia la data di inizio che quella di fine.", "warning");
      return;
    }
    
    if (requestMode === 'range' && dataInizio > dataFine) {
      showToast("La data di inizio non può essere successiva alla data di fine.", "warning");
      return;
    }

    if ((tipoRichiesta === 'permesso' || tipoRichiesta === 'assenza') && frazioneTipo === 'orario') {
      if (!oraInizio || !oraFine) {
        showToast("Inserisci l'ora di inizio e di fine dell'assenza.", "warning");
        return;
      }
      if (oraInizio >= oraFine) {
        showToast("L'ora di inizio deve essere precedente all'ora di fine.", "warning");
        return;
      }
    }

    // Genera l'elenco delle date da controllare nel range richiesto
    const datesToCheck: string[] = [];
    if (requestMode === 'singolo') {
      datesToCheck.push(dataRichiesta);
    } else {
      const [sY, sM, sD] = dataInizio.split('-').map(Number);
      const [eY, eM, eD] = dataFine.split('-').map(Number);
      const curr = new Date(sY, sM - 1, sD);
      const last = new Date(eY, eM - 1, eD);
      while (curr <= last) {
        const y = curr.getFullYear();
        const m = String(curr.getMonth() + 1).padStart(2, '0');
        const d = String(curr.getDate()).padStart(2, '0');
        datesToCheck.push(`${y}-${m}-${d}`);
        curr.setDate(curr.getDate() + 1);
      }
    }

    const targetDipObj = dipendenti.find(d => d.nome === targetDipName);
    if (targetDipObj && targetDipObj.dataCessazione) {
      const invalidDate = datesToCheck.find(dStr => dStr > targetDipObj.dataCessazione!);
      if (invalidDate) {
        showToast(`Impossibile inserire la richiesta: la risorsa cessa il rapporto lavorativo il ${formatDate(targetDipObj.dataCessazione)}.`, "warning");
        return;
      }
    }

    setLoading(true);
    try {
      // 1. Recupera le richieste esistenti per questo dipendente con stato 'Approvato' o 'In attesa'
      const qAbsences = query(
        collection(db, 'richieste_ferie'),
        where('dipendenteName', '==', targetDipName)
      );
      const absencesSnap = await getDocs(qAbsences);
      const existingReqs = absencesSnap.docs
        .map(d => ({ id: d.id, ...d.data() } as any))
        .filter(r => r.stato === 'Approvato' || r.stato === 'In attesa');

      // 2. Controlla se ci sono conflitti per ciascun giorno richiesto
      for (const dStr of datesToCheck) {
        const coveringReqs = existingReqs.filter(r => {
          const start = r.dataInizio || r.data;
          const end = r.dataFine || r.data;
          return start && end && dStr >= start && dStr <= end;
        });

        for (const exist of coveringReqs) {
          let hasConflict = false;
          let conflictReason = '';

          const isExistFullDay = ['ferie', 'malattia', 'maternita', 'smart'].includes(exist.tipo) || ((exist.tipo === 'permesso' || exist.tipo === 'assenza') && (exist.frazioneTipo === 'giornata' || !exist.frazioneTipo));
          const isNewFullDay = ['ferie', 'malattia', 'maternita', 'smart'].includes(tipoRichiesta) || ((tipoRichiesta === 'permesso' || tipoRichiesta === 'assenza') && frazioneTipo === 'giornata');

          if (isExistFullDay || isNewFullDay) {
            hasConflict = true;
            conflictReason = `La risorsa risulta già assente/impegnata il ${formatDate(dStr)} (stato: "${exist.stato}").`;
          } else {
            // Entrambi sono frazioni di giornata (mattina, pomeriggio, o orari)
            const getSlot = (reqObj: any) => {
              if (reqObj.tipo === 'mattina' || reqObj.frazioneTipo === 'mattina') return { start: '09:00', end: '13:00' };
              if (reqObj.tipo === 'pomeriggio' || reqObj.frazioneTipo === 'pomeriggio') return { start: '14:00', end: '18:00' };
              return { start: reqObj.oraInizio || '09:00', end: reqObj.oraFine || '18:00' };
            };

            const slotExist = getSlot(exist);
            const slotNew = getSlot({ tipo: tipoRichiesta, frazioneTipo, oraInizio, oraFine });

            if (slotNew.start < slotExist.end && slotNew.end > slotExist.start) {
              hasConflict = true;
              conflictReason = `La risorsa ha già un permesso/assenza sovrapposto il ${formatDate(dStr)} (dalle ${slotExist.start} alle ${slotExist.end}, stato: "${exist.stato}").`;
            }
          }

          if (hasConflict) {
            showToast(conflictReason, "error");
            setLoading(false);
            return;
          }
        }
      }

      const payload: any = {
        dipendenteName: targetDipName,
        tipo: tipoRichiesta,
        stato: isPowerUser ? 'Approvato' : 'In attesa',
        timestamp: new Date().toISOString()
      };
      
      if (requestMode === 'singolo') {
        payload.data = dataRichiesta;
        payload.dataInizio = dataRichiesta;
        payload.dataFine = dataRichiesta;
      } else {
        payload.data = dataInizio; // legacy fallback
        payload.dataInizio = dataInizio;
        payload.dataFine = dataFine;
      }

      if (tipoRichiesta === 'permesso' || tipoRichiesta === 'assenza' || tipoRichiesta === 'smart') {
        payload.frazioneTipo = frazioneTipo;
        if (frazioneTipo === 'orario') {
          payload.oraInizio = oraInizio;
          payload.oraFine = oraFine;
          if (pausaPranzo && tipoRichiesta !== 'smart') {
            payload.pausaPranzo = true;
            payload.pausaPranzoOre = Number(pausaPranzoOre);
          }
        }
      }
      
      await addDoc(collection(db, 'richieste_ferie'), payload);
      
      setDataRichiesta('');
      setDataInizio('');
      setDataFine('');
      setOraInizio('09:00');
      setOraFine('18:00');
      setFrazioneTipo('giornata');
      setPausaPranzo(false);
      setPausaPranzoOre('1.0');
      showToast("Richiesta inviata con successo!");
      loadFerieData();
    } catch (err) {
      showToast("Errore nell'invio della richiesta.", "error");
    } finally {
      setLoading(false);
    }
  };

  const cleanAssignmentsForApprovedFullWeekLeave = async (dipName: string, startDateStr: string, endDateStr: string) => {
    try {
      if (!startDateStr || !endDateStr) return;
      const [sY, sM, sD] = startDateStr.split('-').map(Number);
      const [eY, eM, eD] = endDateStr.split('-').map(Number);
      const start = new Date(sY, sM - 1, sD);
      const end = new Date(eY, eM - 1, eD);
      if (isNaN(start.getTime()) || isNaN(end.getTime())) return;

      const curr = new Date(start);
      const weekIds = new Set<string>();
      while (curr <= end) {
        const dayOfWeek = curr.getDay();
        if (dayOfWeek !== 0 && dayOfWeek !== 6) {
          const wkNum = getWeekNumber(curr);
          const year = curr.getFullYear();
          weekIds.add(`${year}-W${wkNum}`);
        }
        curr.setDate(curr.getDate() + 1);
      }

      for (const wkId of weekIds) {
        const docId = `${dipName}-${wkId}`;
        const docRef = doc(db, 'assegnazioni', docId);
        try {
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            await deleteDoc(docRef);
          }
        } catch (err) {
          console.error("Errore pulizia assegnazioni ferie:", err);
        }
      }
    } catch (e) {
      console.error("Errore pulizia retroattiva assegnazioni:", e);
    }
  };

  const handleDecision = async (id: string, approva: boolean) => {
    try {
      const req = richieste.find(r => r.id === id);
      if (!req) return;

      const newStatus = approva ? 'Approvato' : 'Rifiutato';
      await updateDoc(doc(db, 'richieste_ferie', id), {
        stato: newStatus
      });

      if (approva) {
        const startStr = req.dataInizio || req.data;
        const endStr = req.dataFine || req.data;
        if (startStr && endStr && ['ferie', 'assenza', 'malattia', 'maternita'].includes(req.tipo)) {
          await cleanAssignmentsForApprovedFullWeekLeave(req.dipendenteName, startStr, endStr);
        }
      }

      // Invia notifica personale informativa all'utente interessato
      const targetDip = dipendenti.find(d => areNamesEqual(d.nome, req.dipendenteName));
      if (targetDip?.email) {
        const dateDesc = req.dataInizio && req.dataFine && req.dataInizio !== req.dataFine 
          ? `dal ${formatDate(req.dataInizio)} al ${formatDate(req.dataFine)}` 
          : `per il ${formatDate(req.dataInizio || req.data)}`;
        
        await createUserNotification({
          destinatarioEmail: targetDip.email,
          destinatarioNome: req.dipendenteName,
          titolo: approva ? '✅ Ferie / Assenza Approvata' : '❌ Richiesta Assenza Non Approvata',
          messaggio: approva 
            ? `La tua richiesta di ${req.tipo || 'ferie'} ${dateDesc} è stata approvata dall'HR.`
            : `La tua richiesta di ${req.tipo || 'ferie'} ${dateDesc} non è stata approvata dall'HR.`,
          tipo: 'ferie_approvate',
          link: '/ferie'
        });
      }

      loadFerieData();

      // Rigenera la sintesi annuale in background (fire-and-forget)
      const reqYear = new Date(req.dataInizio || req.data || new Date()).getFullYear();
      rebuildYearlySummary(reqYear, dipendenti).then(newSum => {
        if (newSum) updateCounterSummaries(prev => ({ ...prev, [reqYear]: newSum }));
      }).catch(() => {/* silent */});

      // Aggiorna approvedLeaves in AuthContext (usato da PianificazioneModal)
      refreshData().catch(() => {/* silent */});
    } catch (e) {
      console.error("Errore aggiornamento:", e);
    }
  };

  const handleCancelApprovedLeave = async () => {
    if (!cancellationRequest) return;
    setCancellationLoading(true);
    try {
      const req = cancellationRequest;
      // 1. Elimina il documento da Firestore
      await deleteDoc(doc(db, 'richieste_ferie', req.id));

      showToast("Ferie annullate con successo!");
      setCancellationRequest(null);
      setCancellationReason('');
      loadFerieData();

      // Rigenera la sintesi annuale in background
      const cancelYear = new Date(req.dataInizio || req.data || new Date()).getFullYear();
      rebuildYearlySummary(cancelYear, dipendenti).then(newSum => {
        if (newSum) updateCounterSummaries(prev => ({ ...prev, [cancelYear]: newSum }));
      }).catch(() => {/* silent */});
    } catch (err) {
      console.error(err);
      showToast("Errore durante l'annullamento delle ferie.", "error");
    } finally {
      setCancellationLoading(false);
    }
  };

  // Funzioni di gestione per richieste di modifica / annullamento da parte del dipendente
  const openModificationModal = (req: RichiestaFerie) => {
    setModifyingRequest(req);
    setModTipoAzione('annullamento');
    setModDataInizio(req.dataInizio || req.data || '');
    setModDataFine(req.dataFine || req.data || '');
    setModOraInizio(req.oraInizio || '09:00');
    setModOraFine(req.oraFine || '18:00');
    setModFrazioneTipo(req.frazioneTipo || 'giornata');
    setModTipo(req.tipo || 'ferie');
    setModMotivazione('');
  };

  const handleSendModificationRequest = async () => {
    if (!modifyingRequest) return;
    if (modTipoAzione === 'modifica' && (!modDataInizio || !modDataFine)) {
      showToast("Seleziona le nuove date per la modifica.", "warning");
      return;
    }
    setModLoading(true);
    try {
      const isHROrAdminAction = isHR;

      if (isHROrAdminAction) {
        if (modTipoAzione === 'annullamento') {
          await deleteDoc(doc(db, 'richieste_ferie', modifyingRequest.id));
          showToast("Ferie/Permesso annullato direttamente con successo!", "success");
        } else {
          const payloadUpdate: any = {
            stato: 'Approvato',
            dataInizio: modDataInizio,
            dataFine: modDataFine,
            data: modDataInizio,
            tipo: modTipo,
            frazioneTipo: modFrazioneTipo,
            richiestaModifica: null
          };
          if (modFrazioneTipo === 'orario') {
            payloadUpdate.oraInizio = modOraInizio;
            payloadUpdate.oraFine = modOraFine;
          }

          await updateDoc(doc(db, 'richieste_ferie', modifyingRequest.id), payloadUpdate);

          if (modDataInizio && modDataFine && (modTipo === 'ferie' || modTipo === 'malattia' || modTipo === 'maternita')) {
            await cleanAssignmentsForApprovedFullWeekLeave(modifyingRequest.dipendenteName, modDataInizio, modDataFine);
          }

          showToast("Ferie/Permesso modificato direttamente con successo!", "success");
        }
      } else {
        const newStato = modTipoAzione === 'annullamento' ? 'Richiesta Annullamento' : 'Richiesta Modifica';
        const payloadModifica: any = {
          tipoAzione: modTipoAzione,
          motivazione: modMotivazione.trim(),
          dataRichiesta: new Date().toISOString()
        };
        if (modTipoAzione === 'modifica') {
          payloadModifica.nuovaDataInizio = modDataInizio;
          payloadModifica.nuovaDataFine = modDataFine;
          payloadModifica.nuovoTipo = modTipo;
          payloadModifica.nuovaFrazioneTipo = modFrazioneTipo;
          if (modFrazioneTipo === 'orario') {
            payloadModifica.nuovaOraInizio = modOraInizio;
            payloadModifica.nuovaOraFine = modOraFine;
          }
        }

        await updateDoc(doc(db, 'richieste_ferie', modifyingRequest.id), {
          stato: newStato,
          richiestaModifica: payloadModifica
        });

        showToast("Richiesta di modifica/annullamento inviata all'HR con successo!", "success");
      }

      setModifyingRequest(null);
      loadFerieData();
    } catch (err) {
      console.error("Errore invio richiesta modifica:", err);
      showToast("Errore durante l'elaborazione della modifica.", "error");
    } finally {
      setModLoading(false);
    }
  };

  const handleHRApproveModification = async (req: RichiestaFerie) => {
    if (!req.richiestaModifica) return;
    try {
      const mod = req.richiestaModifica;
      const newStart = mod.nuovaDataInizio || req.dataInizio || req.data;
      const newEnd = mod.nuovaDataFine || req.dataFine || req.data;
      const newTipo = mod.nuovoTipo || req.tipo;
      const newFrazione = mod.nuovaFrazioneTipo || req.frazioneTipo;
      const newOraInizio = mod.nuovaOraInizio || req.oraInizio;
      const newOraFine = mod.nuovaOraFine || req.oraFine;

      await updateDoc(doc(db, 'richieste_ferie', req.id), {
        stato: 'Approvato',
        dataInizio: newStart,
        dataFine: newEnd,
        data: newStart,
        tipo: newTipo,
        frazioneTipo: newFrazione,
        oraInizio: newOraInizio || null,
        oraFine: newOraFine || null,
        richiestaModifica: null
      });

      if (newStart && newEnd && (newTipo === 'ferie' || newTipo === 'malattia' || newTipo === 'maternita')) {
        await cleanAssignmentsForApprovedFullWeekLeave(req.dipendenteName, newStart, newEnd);
      }

      const targetDip = dipendenti.find(d => areNamesEqual(d.nome, req.dipendenteName));
      if (targetDip?.email) {
        await createUserNotification({
          destinatarioEmail: targetDip.email,
          destinatarioNome: req.dipendenteName,
          titolo: '✅ Modifica Assenza Approvata',
          messaggio: `La tua richiesta di modifica per ${req.tipo || 'ferie'} è stata approvata dall'HR.`,
          tipo: 'ferie_approvate',
          link: '/ferie'
        });
      }

      showToast("Modifica approvata ed applicata con successo!", "success");
      loadFerieData();
    } catch (err) {
      console.error(err);
      showToast("Errore durante l'applicazione della modifica.", "error");
    }
  };

  const handleHRApproveCancellation = async (req: RichiestaFerie) => {
    try {
      await deleteDoc(doc(db, 'richieste_ferie', req.id));

      const targetDip = dipendenti.find(d => areNamesEqual(d.nome, req.dipendenteName));
      if (targetDip?.email) {
        await createUserNotification({
          destinatarioEmail: targetDip.email,
          destinatarioNome: req.dipendenteName,
          titolo: '✅ Annullamento Assenza Confermato',
          messaggio: `L'annullamento della tua richiesta di ${req.tipo || 'ferie'} è stato confermato dall'HR.`,
          tipo: 'ferie_approvate',
          link: '/ferie'
        });
      }

      showToast("Annullamento approvato con successo!", "success");
      loadFerieData();
    } catch (err) {
      console.error(err);
      showToast("Errore durante l'annullamento.", "error");
    }
  };

  const handleHRRejectModificationOrCancellation = async (req: RichiestaFerie) => {
    try {
      await updateDoc(doc(db, 'richieste_ferie', req.id), {
        stato: 'Approvato',
        richiestaModifica: null
      });

      showToast("Richiesta ripristinata allo stato approvato originale.", "info");
      loadFerieData();
    } catch (err) {
      console.error(err);
      showToast("Errore durante l'operazione.", "error");
    }
  };

  const handleWithdrawPendingRequest = async (reqId: string) => {
    try {
      await deleteDoc(doc(db, 'richieste_ferie', reqId));
      showToast("Richiesta in attesa ritirata con successo.", "success");
      loadFerieData();
    } catch (err) {
      showToast("Errore durante l'annullamento.", "error");
    }
  };

  const getStatusBadge = (stato: string) => {
    switch(stato) {
      case 'Approvato': 
        return <span className="flex items-center gap-1 text-[10px] sm:text-xs font-bold bg-green-100 text-green-700 px-2.5 py-1 rounded-full"><CheckCircle className="w-3.5 h-3.5"/> Approvato</span>;
      case 'Rifiutato': 
        return <span className="flex items-center gap-1 text-[10px] sm:text-xs font-bold bg-red-100 text-red-700 px-2.5 py-1 rounded-full"><XCircle className="w-3.5 h-3.5"/> Rifiutato</span>;
      case 'Richiesta Annullamento': 
        return <span className="flex items-center gap-1 text-[10px] sm:text-xs font-bold bg-amber-100 text-amber-800 px-2.5 py-1 rounded-full border border-amber-300"><AlertTriangle className="w-3.5 h-3.5 text-amber-600"/> Richiesta Annullamento</span>;
      case 'Richiesta Modifica': 
        return <span className="flex items-center gap-1 text-[10px] sm:text-xs font-bold bg-orange-100 text-orange-800 px-2.5 py-1 rounded-full border border-orange-300"><Pencil className="w-3.5 h-3.5 text-orange-600"/> Richiesta Modifica</span>;
      default: 
        return <span className="flex items-center gap-1 text-[10px] sm:text-xs font-bold bg-yellow-100 text-yellow-700 px-2 py-1 rounded-full"><Clock className="w-3.5 h-3.5"/> In attesa</span>;
    }
  };

  const getTipoData = (tipo: string, frazioneTipo?: string, dipName?: string) => {
    const isCollab = isCollaboratore(dipName, dipendenti) || isSoci(dipName);
    const tipi: Record<string, {label: string, color: string}> = {
      ferie: {label: isCollab ? 'Assenza' : 'Ferie', color: 'bg-red-500'},
      malattia: {label: 'Malattia', color: 'bg-purple-600'},
      maternita: {label: 'Maternità', color: 'bg-pink-500'},
      permesso: {label: isCollab ? 'Assenza' : 'Permesso', color: 'bg-amber-500'},
      assenza: {label: 'Assenza', color: 'bg-amber-500'},
      smart: {label: 'Lavora da Casa', color: 'bg-blue-500'},
      mattina: {label: 'Assenza Mattina', color: 'bg-amber-500'},
      pomeriggio: {label: 'Assenza Pomeriggio', color: 'bg-amber-500'},
      studio: {label: 'Permesso Studio', color: 'bg-violet-600'},
      ex_l104: {label: 'Permesso ex L.104', color: 'bg-emerald-600'},
      donazione: {label: 'Permesso Donazione', color: 'bg-teal-500'},
      elettorale: {label: 'Permesso Elettorale', color: 'bg-indigo-500'}
    };
    const base = tipi[tipo] || {label: isCollab ? 'Assenza' : tipo, color: 'bg-gray-500'};
    if ((tipo === 'permesso' || tipo === 'assenza' || tipo === 'smart' || tipo === 'ex_l104' || tipo === 'studio') && frazioneTipo) {
      const copy = { ...base };
      const prefix = tipo === 'smart'
        ? 'Lavora da Casa'
        : ((isCollab || tipo === 'assenza') ? 'Assenza' : (tipo === 'ex_l104' ? 'Permesso ex L.104' : 'Permesso'));
      if (frazioneTipo === 'mattina') copy.label = `${prefix} Mattina`;
      if (frazioneTipo === 'pomeriggio') copy.label = `${prefix} Pomeriggio`;
      if (frazioneTipo === 'giornata') copy.label = `${prefix} Giornata Intera`;
      if (frazioneTipo === 'orario') copy.label = `${prefix} Orario`;
      return copy;
    }
    return base;
  };

  const getTipoLabel = (tipo: string, frazioneTipo?: string, dipName?: string) => {
    const t = getTipoData(tipo, frazioneTipo, dipName);
    return (
      <span className="text-xs sm:text-sm font-bold text-gray-600 bg-gray-100 px-2 py-1 rounded-lg capitalize">
        {t.label}
      </span>
    );
  };

  const handlePrintFeriePlan = () => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth(); // 0-indexed
    const monthLabel = currentMonth.toLocaleString('it-IT', { month: 'long' }).toUpperCase();
    const numDays = new Date(year, month + 1, 0).getDate();

    const firstDayOfMonthStr = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const sortedDipendenti = dipendenti
      .filter(d => (!d.dataCessazione || d.dataCessazione >= firstDayOfMonthStr) && !isTechnicalUser(d))
      .sort((a, b) => a.nome.trim().localeCompare(b.nome.trim()));

    const statusMap: Record<string, Record<number, RichiestaFerie>> = {};
    sortedDipendenti.forEach(dip => {
      statusMap[(dip.nome || '').trim().toLowerCase()] = {};
    });

    richieste.forEach(req => {
      // Include anche 'Richiesta Modifica' e 'Richiesta Annullamento': il periodo originale
      // approvato è ancora valido finché l'HR non ha accettato la modifica/annullamento.
      const isVisibleInPrint = req.stato === 'Approvato' || req.stato === 'Richiesta Modifica' || req.stato === 'Richiesta Annullamento';
      if (!isVisibleInPrint) return;
      const start = req.dataInizio || req.data;
      const end = req.dataFine || req.data;
      if (!start || !end) return;

      const [sY, sM, sD] = start.split('-').map(Number);
      const [eY, eM, eD] = end.split('-').map(Number);
      const curr = new Date(sY, sM - 1, sD);
      const last = new Date(eY, eM - 1, eD);

      while (curr <= last) {
        const y = curr.getFullYear();
        const m = curr.getMonth();
        const d = curr.getDate();

        if (y === year && m === month) {
          const dipNameClean = (req.dipendenteName || '').trim().toLowerCase();
          if (statusMap[dipNameClean]) {
            statusMap[dipNameClean][d] = req;
          }
        }
        curr.setDate(curr.getDate() + 1);
      }
    });

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      showToast("Consenti i pop-up per stampare il piano ferie.", "warning");
      return;
    }

    const rowsHtml = sortedDipendenti.map(dip => {
      const dipKey = (dip.nome || '').trim().toLowerCase();
      const daysCells = Array.from({ length: 31 }).map((_, i) => {
        const day = i + 1;
        if (day > numDays) {
          return `<td class="empty-cell"></td>`;
        }

        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const dateObj = new Date(year, month, day);
        const dayOfWeek = dateObj.getDay();
        const isWknd = dayOfWeek === 0 || dayOfWeek === 6;
        const isHoliday = isItalianHoliday(dateStr);
        const isUnlocked = approvedWeekends[`${dip.nome}_${dateStr}`];
        const isSpecialDay = (isWknd || isHoliday) && !isUnlocked;
        const isCessato = dip.dataCessazione && dateStr > dip.dataCessazione;

        const reqObj = statusMap[dipKey]?.[day];
        const tipo = reqObj?.tipo;
        let cellBg = '';
        let cellText = '';
        let textColor = '#000000';

        if (isCessato) {
          cellBg = '#4b5563';
          cellText = 'X';
          textColor = '#ffffff';
        } else if (isSpecialDay) {
          cellBg = '#f3f4f6';
        } else if (tipo) {
          const isCollabDip = isCollaboratore(dip.nome, dipendenti) || isSoci(dip.nome);
          const isFractional = Boolean(
            (reqObj.frazioneTipo && reqObj.frazioneTipo !== 'giornata') || 
            (reqObj.oraInizio && reqObj.oraFine) || 
            tipo === 'mattina' || 
            tipo === 'pomeriggio'
          );

          if (['malattia', 'maternita'].includes(tipo)) {
            cellBg = '#ef4444'; // Rosso (Malattia / Maternità)
            cellText = 'M';
            textColor = '#ffffff';
          } else if (tipo === 'ex_l104') {
            cellBg = '#facc15'; // Giallo
            cellText = 'L';
            textColor = '#713f12';
          } else if (tipo === 'studio') {
            cellBg = '#facc15'; // Giallo
            cellText = 'S';
            textColor = '#713f12';
          } else if (tipo === 'donazione') {
            cellBg = '#facc15'; // Giallo
            cellText = 'D';
            textColor = '#713f12';
          } else if (tipo === 'elettorale') {
            cellBg = '#facc15'; // Giallo
            cellText = 'E';
            textColor = '#713f12';
          } else if (isCollabDip && isFractional) {
            // Assenza Oraria Collaboratori / Soci in Stampa -> Giallo
            cellBg = '#facc15';
            textColor = '#713f12';
            if (reqObj.frazioneTipo === 'mattina' || tipo === 'mattina') {
              cellText = 'AM';
            } else if (reqObj.frazioneTipo === 'pomeriggio' || tipo === 'pomeriggio') {
              cellText = 'PM';
            } else if (reqObj.oraInizio && reqObj.oraFine) {
              const [hStart, mStart] = reqObj.oraInizio.split(':').map(Number);
              const [hEnd, mEnd] = reqObj.oraFine.split(':').map(Number);
              const diffMs = new Date(2000, 0, 1, hEnd, mEnd).getTime() - new Date(2000, 0, 1, hStart, mStart).getTime();
              let hrs = Math.round((diffMs / 3600000) * 100) / 100;
              if (reqObj.pausaPranzo && reqObj.pausaPranzoOre) {
                hrs = Math.max(0, hrs - reqObj.pausaPranzoOre);
              }
              cellText = `${hrs.toString().replace('.', ',')}h`;
            } else {
              cellText = '';
            }
          } else if (tipo === 'smart') {
            cellBg = '#84cc16'; // Verde Lime / Smeraldo (Lavora da Casa Dipendenti)
            textColor = '#ffffff';
            if (reqObj.frazioneTipo === 'mattina') {
              cellText = 'AM';
            } else if (reqObj.frazioneTipo === 'pomeriggio') {
              cellText = 'PM';
            } else if (reqObj.oraInizio && reqObj.oraFine) {
              const [hStart, mStart] = reqObj.oraInizio.split(':').map(Number);
              const [hEnd, mEnd] = reqObj.oraFine.split(':').map(Number);
              const diffMs = new Date(2000, 0, 1, hEnd, mEnd).getTime() - new Date(2000, 0, 1, hStart, mStart).getTime();
              let hrs = Math.round((diffMs / 3600000) * 100) / 100;
              if (reqObj.pausaPranzo && reqObj.pausaPranzoOre) {
                hrs = Math.max(0, hrs - reqObj.pausaPranzoOre);
              }
              cellText = `${hrs.toString().replace('.', ',')}h`;
            } else {
              cellText = '';
            }
          } else if (tipo === 'ferie' || reqObj.frazioneTipo === 'giornata' || (!isFractional && (tipo === 'assenza' || tipo === 'ferie'))) {
            cellBg = '#38bdf8'; // Sky Blue (Ferie Dipendenti / Assenza Giornata Intera Collaboratori)
            textColor = '#ffffff';
            cellText = '';
          } else {
            // Assenza Oraria / Permesso -> Giallo
            cellBg = '#facc15';
            textColor = '#713f12';
            if (reqObj.frazioneTipo === 'mattina' || tipo === 'mattina') {
              cellText = 'AM';
            } else if (reqObj.frazioneTipo === 'pomeriggio' || tipo === 'pomeriggio') {
              cellText = 'PM';
            } else if (reqObj.oraInizio && reqObj.oraFine) {
              const [hStart, mStart] = reqObj.oraInizio.split(':').map(Number);
              const [hEnd, mEnd] = reqObj.oraFine.split(':').map(Number);
              const diffMs = new Date(2000, 0, 1, hEnd, mEnd).getTime() - new Date(2000, 0, 1, hStart, mStart).getTime();
              let hrs = Math.round((diffMs / 3600000) * 100) / 100;
              if (reqObj.pausaPranzo && reqObj.pausaPranzoOre) {
                hrs = Math.max(0, hrs - reqObj.pausaPranzoOre);
              }
              cellText = `${hrs.toString().replace('.', ',')}h`;
            } else {
              cellText = '';
            }
          }
        }

        const styleAttr = cellBg ? ` style="background-color: ${cellBg} !important; color: ${textColor} !important;"` : '';
        return `<td${styleAttr}>${cellText}</td>`;
      }).join('');

      return `
        <tr>
          <td class="name-cell">${dip.nome}</td>
          ${daysCells}
        </tr>
      `;
    }).join('');

    const headerDaysHtml = Array.from({ length: 31 }).map((_, i) => {
      const day = i + 1;
      if (day > numDays) {
        return `<th class="empty-cell">${day}</th>`;
      }

      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const dateObj = new Date(year, month, day);
      const dayOfWeek = dateObj.getDay();
      const isWknd = dayOfWeek === 0 || dayOfWeek === 6;
      const isHoliday = isItalianHoliday(dateStr);
      const isSpecialDay = isWknd || isHoliday;

      const style = isSpecialDay ? ' style="background-color: #e5e7eb !important; color: #6b7280 !important;"' : '';
      return `<th${style}>${day}</th>`;
    }).join('');

    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Stampa Piano Ferie - ${monthLabel} ${year}</title>
          <style>
            * {
              -webkit-print-color-adjust: exact !important;
              print-color-adjust: exact !important;
              box-sizing: border-box;
            }
            @page {
              size: A4 portrait;
              margin: 0.5cm;
            }
            html, body {
              margin: 0;
              padding: 0;
              font-family: 'Inter', -apple-system, Arial, sans-serif;
              color: #111827;
              background-color: #ffffff;
              font-size: 6.5px;
            }
            .header-container {
              display: flex;
              justify-content: space-between;
              align-items: flex-end;
              border-bottom: 2px solid #111827;
              padding-bottom: 6px;
              margin-bottom: 8px;
            }
            .title-main {
              font-weight: 900;
              font-size: 18px;
              letter-spacing: -0.02em;
              color: #111827;
              text-transform: uppercase;
            }
            .title-sub {
              font-weight: 700;
              font-size: 9px;
              color: #6b7280;
              text-transform: uppercase;
              letter-spacing: 0.05em;
              margin-top: 1px;
            }
            .logo-img {
              height: 32px;
              object-fit: contain;
            }
            thead {
              display: table-header-group !important;
            }
            tr {
              page-break-inside: avoid !important;
              break-inside: avoid !important;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              table-layout: fixed;
              border: 0.5px solid #d1d5db;
            }
            th, td {
              border: 0.5px solid #d1d5db;
              padding: 2px 0;
              text-align: center;
              font-size: 6px;
              font-weight: bold;
              height: 14px;
            }
            th {
              background-color: #f3f4f6 !important;
              color: #374151;
              font-weight: 800;
              border-bottom: 1px solid #9ca3af;
            }
            .name-cell {
              text-align: left;
              padding-left: 4px;
              font-weight: 800;
              font-size: 6.5px;
              color: #111827;
              border-right: 1px solid #d1d5db;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
              background-color: #ffffff !important;
            }
            .empty-cell {
              background-color: #f9fafb !important;
            }
            .legend-box {
              margin-top: 8px;
              border-top: 1px solid #e5e7eb;
              padding-top: 5px;
            }
            .legend-title {
              font-weight: 850;
              text-transform: uppercase;
              letter-spacing: 0.05em;
              margin-bottom: 4px;
              font-size: 6.5px;
              color: #374151;
            }
            .legend-items {
              display: flex;
              flex-wrap: wrap;
              gap: 3px 8px;
            }
            .legend-item {
              display: flex;
              align-items: center;
              gap: 3px;
              font-size: 5.8px;
              font-weight: 700;
              color: #4b5563;
              background-color: #f9fafb !important;
              border: 0.5px solid #e5e7eb;
              padding: 2px 4px;
              border-radius: 3px;
            }
            .color-block {
              width: 12px;
              height: 9px;
              border-radius: 2px;
              border: 0.5px solid #d1d5db;
              display: inline-flex;
              align-items: center;
              justify-content: center;
              font-size: 5.5px;
              font-weight: 900;
            }
          </style>
        </head>
        <body>
          <div class="header-container">
            <div>
              <div class="title-main">${monthLabel} ${year}</div>
              <div class="title-sub">Pianificazione Ferie & Assenze — Documento Aziendale</div>
            </div>
            <div>
              <img src="${window.location.origin}/Logo.png" alt="Logo Ingegno" class="logo-img" />
            </div>
          </div>

          <div class="table-container">
            <table>
              <colgroup>
                <col style="width: 18%;" />
                ${Array.from({ length: 31 }).map(() => `<col style="width: 2.64%;" />`).join('')}
              </colgroup>
              <thead>
                <tr>
                  <th>ELENCO PERSONALE</th>
                  ${headerDaysHtml}
                </tr>
              </thead>
              <tbody>
                ${rowsHtml}
              </tbody>
            </table>
          </div>

          <div class="legend-box">
            <div class="legend-title">Legenda:</div>
            <div class="legend-items">
              <div class="legend-item">
                <div class="color-block" style="background-color: #38bdf8 !important;"></div>
                <span>FERIE DIPENDENTI / ASSENZA COLLABORATORI</span>
              </div>
              <div class="legend-item">
                <div class="color-block" style="background-color: #facc15 !important;"></div>
                <span>PERMESSO (DIPENDENTI) / ASSENZA ORARIA (COLLABORATORI) (L: EX L.104, S: STUDIO, D: DONAZIONE, E: ELETTORALE)</span>
              </div>
              <div class="legend-item">
                <div class="color-block" style="background-color: #ef4444 !important; color: #ffffff !important;">M</div>
                <span>MALATTIA / MATERNITÀ</span>
              </div>
              <div class="legend-item">
                <div class="color-block" style="background-color: #84cc16 !important;"></div>
                <span>LAVORA DA CASA</span>
              </div>
              <div class="legend-item">
                <div class="color-block" style="background-color: #4b5563 !important; color: #ffffff !important;">X</div>
                <span>CESSATO / INATTIVO</span>
              </div>
            </div>
          </div>
          ${getPrintFooterHtml()}
          <script>
            function closeWindow() {
              try { window.close(); } catch(e) {}
            }
            window.onafterprint = closeWindow;
            window.onload = function() {
              setTimeout(function() {
                window.print();
                closeWindow();
                setTimeout(closeWindow, 500);
              }, 250);
            };
            window.onfocus = function() {
              setTimeout(closeWindow, 300);
            };
          </script>
        </body>
      </html>
    `;

    printWindow.document.write(htmlContent);
    printWindow.document.close();
  };

  // --- LOGICA CALENDARIO ---
  const shiftMonth = (delta: number) => {
    const d = new Date(currentMonth);
    d.setMonth(d.getMonth() + delta);
    setCurrentMonth(d);
  };

  const daysInMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate();
  const firstDayIndex = (new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1).getDay() + 6) % 7; // Lunedi = 0
  
  const monthName = currentMonth.toLocaleString('it-IT', { month: 'long', year: 'numeric' });
  const calendarCells = [];
  
  // Celle vuote iniziali
  for (let i = 0; i < firstDayIndex; i++) {
    calendarCells.push(<div key={`empty-${i}`} className="min-h-[100px] bg-gray-50/50 rounded-xl border border-transparent"></div>);
  }
  
  // Giorni effettivi
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dayRequests = richieste.filter(r => {
      if (r.stato === 'Rifiutato') return false;
      const start = r.dataInizio || r.data;
      const end = r.dataFine || r.data;
      return start && end && dateStr >= start && dateStr <= end;
    });

    // Dividiamo le chiusure aziendali dalle altre richieste
    const closureReqs = dayRequests.filter(r => r.note === 'Chiusure Aziendali' && r.stato === 'Approvato');
    const otherReqs = dayRequests.filter(r => r.note !== 'Chiusure Aziendali' || r.stato !== 'Approvato');

    // Ordiniamo le altre richieste in ordine alfabetico per dipendente
    const sortedOthers = [...otherReqs].sort((a, b) => a.dipendenteName.localeCompare(b.dipendenteName));

    const isWknd = isWeekend(dateStr);
    const isHoliday = isItalianHoliday(dateStr);
    const isChiusura = isInChiusuraAziendaleLocal(dateStr) || closureReqs.length > 0;
    const isSpecialDay = isWknd || isHoliday;

    let cellStyle: React.CSSProperties = {};
    let cellClass = "min-h-[100px] rounded-xl border border-gray-200 p-2 shadow-sm hover:shadow-md transition-all flex flex-col";
    
    if (isSpecialDay) {
      cellStyle = { background: 'linear-gradient(135deg, #f3f4f6 0%, #e5e7eb 100%)' };
      cellClass += " bg-gray-100/50 text-gray-500";
    } else {
      cellClass += " bg-white";
    }

    const isToday = dateStr === new Date().toLocaleDateString('sv-SE');
    if (isToday) {
      cellClass += " ring-2 ring-green-600 z-10";
    }

    // Se è un giorno festivo o weekend, non mostriamo le richieste individuali di assenza
    const displayOthers = isSpecialDay ? [] : sortedOthers;
    // Se c'è chiusura aziendale, mostriamo il badge Chiusura solo se non è weekend/festivo
    const showClosureBadge = isChiusura && !isSpecialDay;

    calendarCells.push(
      <div key={day} style={cellStyle} className={cellClass}>
        <div className={`font-bold mb-1 text-right ${isSpecialDay ? 'text-gray-400' : 'text-gray-700'}`}>{day}</div>
        <div className="flex-1 flex flex-col gap-1 overflow-y-auto custom-scrollbar pr-1">
          {/* Badge riepilogativo per le chiusure aziendali */}
          {showClosureBadge && (
            <div 
              className="bg-indigo-100 border border-indigo-200 text-indigo-900 text-[10px] p-1.5 rounded-lg font-extrabold text-center flex items-center justify-center gap-1.5 shadow-sm cursor-help select-none mb-0.5 shrink-0"
              title={closureReqs.length > 0 ? `Dipendenti in ferie per chiusura:\n${[...closureReqs].map(r => r.dipendenteName).sort((a, b) => a.localeCompare(b)).join('\n')}` : `Azienda chiusa per ferie collettive`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0"></span>
              <span className="truncate">🏢 Chiusura {closureReqs.length > 0 ? `(${closureReqs.length} dip.)` : ''}</span>
            </div>
          )}

          {/* Mappa delle altre richieste ordinate alfabeticamente */}
          {displayOthers.map(req => {
            const t = getTipoData(req.tipo, req.frazioneTipo, req.dipendenteName);
            const isCollabDip = isCollaboratore(req.dipendenteName, dipendenti) || isSoci(req.dipendenteName);
            const isFractional = Boolean(
              req.frazioneTipo === 'mattina' ||
              req.frazioneTipo === 'pomeriggio' ||
              req.frazioneTipo === 'orario' ||
              (req.frazioneTipo && req.frazioneTipo !== 'giornata') ||
              (req.oraInizio && req.oraFine) ||
              req.tipo === 'mattina' ||
              req.tipo === 'pomeriggio'
            );

            let bg = 'bg-sky-50 border-sky-200 text-sky-900';
            let dotBg = 'bg-sky-500';
            let typeLetter = '';

            // Assegnazione colori per tipo di assenza (coerente con Griglia Risorse e Stampa)
            if (['malattia', 'maternita'].includes(req.tipo)) {
              bg = 'bg-red-50 border-red-200 text-red-900';
              dotBg = 'bg-red-500';
              typeLetter = 'M';
            } else if (req.tipo === 'ex_l104') {
              bg = 'bg-amber-50 border-amber-200 text-amber-950';
              dotBg = 'bg-amber-500';
              typeLetter = 'L';
            } else if (req.tipo === 'studio') {
              bg = 'bg-amber-50 border-amber-200 text-amber-950';
              dotBg = 'bg-amber-500';
              typeLetter = 'S';
            } else if (req.tipo === 'donazione') {
              bg = 'bg-amber-50 border-amber-200 text-amber-950';
              dotBg = 'bg-amber-500';
              typeLetter = 'D';
            } else if (req.tipo === 'elettorale') {
              bg = 'bg-amber-50 border-amber-200 text-amber-950';
              dotBg = 'bg-amber-500';
              typeLetter = 'E';
            } else if (req.tipo === 'smart') {
              bg = 'bg-emerald-50 border-emerald-200 text-emerald-900';
              dotBg = 'bg-emerald-500';
            } else if (isCollabDip && isFractional) {
              // Assenza Oraria Collaboratori / Soci -> AMBRA / GIALLO
              bg = 'bg-amber-50 border-amber-200 text-amber-950';
              dotBg = 'bg-amber-500';
            } else if (req.tipo === 'ferie' || req.frazioneTipo === 'giornata' || (!isFractional && (req.tipo === 'assenza' || req.tipo === 'ferie'))) {
              // Ferie Dipendenti / Assenza Collaboratori (Giornata Intera) -> AZZURRO
              bg = 'bg-sky-50 border-sky-200 text-sky-900';
              dotBg = 'bg-sky-500';
            } else {
              // Permessi Dipendenti / Assenza Oraria Collaboratori -> AMBRA / GIALLO
              bg = 'bg-amber-50 border-amber-200 text-amber-950';
              dotBg = 'bg-amber-500';
            }

            // Modificatori in base allo Stato
            if (req.stato === 'Rifiutato') {
              bg = 'bg-red-50 border-red-200 text-red-800 opacity-50 line-through';
              dotBg = 'bg-red-400';
            } else if (req.stato === 'In attesa') {
              bg = 'bg-yellow-50/90 border-amber-300 border-dashed text-amber-950';
            }

            let hourSuffix = '';
            if (req.oraInizio && req.oraFine) {
              hourSuffix = ` (${req.oraInizio}-${req.oraFine}${req.pausaPranzo && req.pausaPranzoOre ? `, escl. p.pranzo ${req.pausaPranzoOre.toString().replace('.', ',')}h` : ''})`;
            } else if (req.frazioneTipo === 'mattina' || req.tipo === 'mattina') {
              hourSuffix = ' AM';
            } else if (req.frazioneTipo === 'pomeriggio' || req.tipo === 'pomeriggio') {
              hourSuffix = ' PM';
            } else if (req.frazioneTipo === 'giornata') {
              hourSuffix = ' GI';
            }

            const isPowerUser = isHR;

            // Finestra informativa dettagliata (tooltip al passaggio del mouse)
            let itemTitle = `${req.dipendenteName} - ${t.label}`;
            if (req.oraInizio && req.oraFine) {
              itemTitle += `\nOrario: dalle ${req.oraInizio} alle ${req.oraFine}${req.pausaPranzo && req.pausaPranzoOre ? ` (esclusa pausa pranzo ${req.pausaPranzoOre.toString().replace('.', ',')}h)` : ''}`;
            } else if (req.frazioneTipo === 'mattina' || req.tipo === 'mattina') {
              itemTitle += '\nFascia: Mattina (AM)';
            } else if (req.frazioneTipo === 'pomeriggio' || req.tipo === 'pomeriggio') {
              itemTitle += '\nFascia: Pomeriggio (PM)';
            } else if (req.frazioneTipo === 'giornata') {
              itemTitle += '\nFascia: Giornata Intera';
            }
            itemTitle += `\nStato: ${req.stato}`;
            if (req.note) itemTitle += `\nNote: ${req.note}`;
            if (isPowerUser) itemTitle += '\n\n(Clicca per annullare/eliminare questa richiesta)';

            return (
              <div 
                key={req.id} 
                onClick={() => {
                  if (isPowerUser) {
                    setCancellationRequest(req);
                    setCancellationReason('');
                  }
                }}
                className={`text-[10px] p-1.5 rounded border ${bg} flex items-center gap-1.5 font-medium leading-tight shadow-sm ${
                  isPowerUser ? 'cursor-pointer hover:brightness-95 active:scale-95 transition-all' : ''
                }`}
                title={itemTitle}
              >
                {typeLetter ? (
                  <span className={`w-3.5 h-3.5 rounded-full shrink-0 ${dotBg} text-[9px] font-black text-white flex items-center justify-center`}>
                    {typeLetter}
                  </span>
                ) : (
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotBg}`}></span>
                )}
                <span className="truncate">
                  {req.dipendenteName} ({t.label}){hourSuffix} {req.stato === 'In attesa' ? '⌛' : ''}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] shadow-xl p-6 sm:p-10 border border-white/50 no-print">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-3xl font-extrabold text-gray-900 flex items-center gap-3">
            <div className="p-3 bg-green-100 rounded-2xl"><Calendar className="w-8 h-8 text-green-600" /></div>
            <div className="flex items-center gap-3">
              <span>Piano Ferie e Assenze</span>
              <button 
                onClick={loadFerieData}
                title="Aggiorna Dati"
                className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 border border-transparent hover:border-green-100 rounded-xl transition-all cursor-pointer hover:rotate-180 duration-500"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
          </h2>
        </div>

        {/* TAB SWITCHER PRINCIPALE PER TUTTI GLI UTENTI */}
        <div className="flex flex-wrap items-center gap-2 bg-slate-100/80 p-1.5 rounded-2xl border border-slate-200/80 w-fit">
          <button
            type="button"
            onClick={() => setMainTab('piano')}
            className={`px-4 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-2 cursor-pointer ${
              mainTab === 'piano'
                ? 'bg-white text-emerald-950 shadow-sm border border-emerald-100'
                : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
            }`}
          >
            <Calendar className="w-4 h-4 text-emerald-600" />
            <span>Piano Ferie & Richieste</span>
          </button>

          <button
            type="button"
            onClick={() => setMainTab('weekend')}
            className={`px-4 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-2 cursor-pointer ${
              mainTab === 'weekend'
                ? 'bg-white text-indigo-950 shadow-sm border border-indigo-100'
                : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
            }`}
          >
            <ShieldAlert className="w-4 h-4 text-indigo-600" />
            <span>Lavoro nei Weekend & Festivi</span>
          </button>

          {!isDev && (isHR || isAdmin || isSoci(myAssociatedName)) && (
            <>
              <button
                type="button"
                onClick={() => setMainTab('contatori_risorse')}
                className={`px-4 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-2 cursor-pointer ${
                  mainTab === 'contatori_risorse'
                    ? 'bg-white text-indigo-950 shadow-sm border border-indigo-100'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
                }`}
              >
                <BarChart2 className="w-4 h-4 text-indigo-600" />
                <span>Riepilogo Contatori Risorse (Soci & HR)</span>
              </button>
            </>
          )}
        </div>
      </div>

      {mainTab === 'weekend' && (
          /* VISTA RICHIEDI / GESTISCI AUTORIZZAZIONI WEEKEND E FESTIVI */
          <div className="space-y-6 animate-in fade-in duration-200">
            <div className="bg-gradient-to-br from-indigo-50 via-white to-blue-50 p-6 sm:p-8 rounded-3xl border border-indigo-100 shadow-sm no-print">
              <div className="pb-4 border-b border-indigo-100 mb-6">
                <h3 className="font-extrabold text-xl text-indigo-950 flex items-center gap-2">
                  <ShieldAlert className="w-6 h-6 text-indigo-600" />
                  <span>Autorizzazione Lavoro Weekend e Festività</span>
                </h3>
                <p className="text-xs text-indigo-900/80 mt-1 leading-relaxed">
                  Per poter registrare ore di lavoro il sabato, la domenica o nei giorni festivi, invia una richiesta preventiva all'HR <strong>entro la mezzanotte del giorno precedente</strong> (almeno 1 giorno di anticipo). Una volta approvata, i giorni corrispondenti saranno sbloccati nel tuo tabellone presenze.
                </p>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Form Nuova Richiesta */}
                <form onSubmit={handleRequestWeekendSubmit} className="space-y-4 bg-white p-6 rounded-2xl border border-indigo-100 shadow-2xs">
                  <h4 className="text-sm font-black text-indigo-950 uppercase tracking-wider">Invia Nuova Richiesta Festivo</h4>
                  <div>
                    <label className="block text-xs font-bold text-indigo-950 mb-1 ml-1">Giorno Festivo / Weekend (con 1 giorno di anticipo)</label>
                    <input 
                      type="date"
                      required
                      min={(() => {
                        const d = new Date();
                        d.setDate(d.getDate() + 1);
                        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                      })()}
                      value={reqWeekendData}
                      onChange={e => setReqWeekendData(e.target.value)}
                      className="w-full p-3 border border-indigo-150 bg-indigo-50/30 focus:bg-white rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-500 shadow-2xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-indigo-950 mb-1 ml-1">Motivazione</label>
                    <textarea
                      required
                      rows={3}
                      value={reqWeekendMotivo}
                      onChange={e => setReqWeekendMotivo(e.target.value)}
                      placeholder="Es. Straordinari urgenti commessa GSK, trasferta presso cliente..."
                      className="w-full p-3 border border-indigo-150 bg-indigo-50/30 focus:bg-white rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-500 shadow-2xs"
                    />
                  </div>
                  <button 
                    type="submit"
                    disabled={reqWeekendLoading}
                    className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-black rounded-xl text-xs shadow-md transition active:scale-95 disabled:opacity-50 cursor-pointer"
                  >
                    {reqWeekendLoading ? 'Invio in corso...' : 'Invia Richiesta all\'HR'}
                  </button>
                </form>

                {/* Storico Richieste Utente */}
                <div className="space-y-4">
                  <h4 className="text-sm font-black text-indigo-950 uppercase tracking-wider">Storico delle tue Richieste</h4>
                  <div className="max-h-[360px] overflow-y-auto pr-1 space-y-3 custom-scrollbar">
                    {myWeekendRequests.length === 0 ? (
                      <p className="text-xs text-gray-400 italic p-4 bg-white/60 rounded-2xl border border-dashed border-indigo-100 text-center">Nessuna richiesta festiva inviata.</p>
                    ) : (
                      myWeekendRequests.map(req => (
                        <div key={req.id} className="bg-white p-4 rounded-2xl border border-indigo-100 shadow-2xs flex justify-between items-center gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-black text-indigo-950 flex items-center gap-2">
                              <span>📅 {formatDate(req.data)}</span>
                              {req.nuovaData && (
                                <span className="text-[10px] text-indigo-600 font-extrabold">(Spostata a {formatDate(req.nuovaData)})</span>
                              )}
                            </div>
                            <div className="text-xs text-gray-600 mt-0.5 truncate" title={req.motivo}>{req.motivo}</div>
                            {req.noteModifica && (
                              <div className="text-[10px] text-purple-700 font-bold italic mt-0.5">Nota: {req.noteModifica}</div>
                            )}
                          </div>
                          <div className="shrink-0 flex items-center gap-2">
                            {getStatusBadge(req.stato)}
                            {req.stato === 'In attesa' && (
                              <button
                                type="button"
                                onClick={() => handleCancelPendingWeekendRequest(req.id)}
                                className="p-1.5 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50 transition cursor-pointer"
                                title="Elimina richiesta in attesa"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>

              {/* PANNELLO APPROVAZIONE HR / ADMIN */}
              {(isHR || isAdmin || isSoci(myAssociatedName)) && (
                <div className="mt-8 pt-8 border-t border-indigo-100 space-y-6">
                  <div className="bg-indigo-950 text-white p-6 rounded-2xl shadow-md">
                    <h4 className="font-black text-base flex items-center gap-2 mb-1">
                      <ShieldAlert className="w-5 h-5 text-indigo-400" /> Gestione HR: Approva / Autorizza Festivi
                    </h4>
                    <p className="text-xs text-indigo-200">
                      Gestisci le richieste pervenute o inserisci un'autorizzazione d'ufficio diretta.
                    </p>
                  </div>

                  {/* Form Autorizzazione Diretta d'Ufficio */}
                  <form onSubmit={handleDirectWeekendAuthSubmit} className="bg-white p-5 rounded-2xl border border-indigo-100 shadow-2xs space-y-4">
                    <h5 className="text-xs font-black text-indigo-950 uppercase tracking-wider">⚡ Registra Autorizzazione d'Ufficio Immediata</h5>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-[10px] font-bold text-gray-600 uppercase mb-1">Risorsa *</label>
                        <select
                          required
                          value={directAuthDipNome}
                          onChange={e => setDirectAuthDipNome(e.target.value)}
                          className="w-full p-2.5 border border-indigo-150 rounded-xl text-xs font-bold text-gray-800 outline-none focus:ring-2 focus:ring-indigo-500"
                        >
                          <option value="">-- Seleziona Risorsa --</option>
                          {dipendenti.map(d => (
                            <option key={d.id} value={d.nome}>{d.nome}</option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold text-gray-600 uppercase mb-1">Data Festivo *</label>
                        <input
                          type="date"
                          required
                          value={directAuthData}
                          onChange={e => setDirectAuthData(e.target.value)}
                          className="w-full p-2.5 border border-indigo-150 rounded-xl text-xs font-bold text-gray-800 outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                      </div>

                      <div>
                        <label className="block text-[10px] font-bold text-gray-600 uppercase mb-1">Note / Motivazione</label>
                        <input
                          type="text"
                          placeholder="Es. Autorizzato d'ufficio per cantiere..."
                          value={directAuthMotivo}
                          onChange={e => setDirectAuthMotivo(e.target.value)}
                          className="w-full p-2.5 border border-indigo-150 rounded-xl text-xs font-bold text-gray-800 outline-none focus:ring-2 focus:ring-indigo-500"
                        />
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={directAuthLoading}
                      className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs rounded-xl transition shadow-xs cursor-pointer active:scale-95 disabled:opacity-50"
                    >
                      {directAuthLoading ? 'Registrazione...' : '✓ Autorizza ed Approva Subito'}
                    </button>
                  </form>

                  {/* Lista Tutte le Richieste Festivi (HR Review) */}
                  <div className="space-y-3">
                    <h5 className="text-xs font-black text-indigo-950 uppercase tracking-wider">Tutte le Richieste Festivi Ricevute</h5>
                    <div className="space-y-3 max-h-[400px] overflow-y-auto pr-1">
                      {allWeekendRequests.length === 0 ? (
                        <p className="text-xs text-gray-400 italic p-4 text-center border border-dashed border-indigo-100 rounded-2xl">
                          Nessuna richiesta nel sistema.
                        </p>
                      ) : (
                        allWeekendRequests.map(req => (
                          <div key={req.id} className="bg-white p-4 rounded-2xl border border-indigo-100 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-extrabold text-sm text-gray-900">{req.dipendenteName}</span>
                                <span className="text-xs font-bold text-indigo-700 bg-indigo-50 px-2.5 py-0.5 rounded-lg border border-indigo-100">{formatDate(req.data)}</span>
                                {getStatusBadge(req.stato)}
                              </div>
                              <p className="text-xs text-gray-600 mt-1">{req.motivo}</p>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              {req.stato === 'In attesa' && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => handleWeekendDecision(req.id, 'Approvato')}
                                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition cursor-pointer shadow-xs active:scale-95"
                                  >
                                    Approva
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleWeekendDecision(req.id, 'Rifiutato')}
                                    className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-xl transition cursor-pointer shadow-xs active:scale-95"
                                  >
                                    Rifiuta
                                  </button>
                                </>
                              )}
                              {req.stato === 'Approvato' && (
                                <button
                                  type="button"
                                  onClick={() => handleWeekendDecision(req.id, 'Revocato')}
                                  className="px-3 py-1.5 bg-slate-100 hover:bg-rose-50 text-slate-700 hover:text-rose-700 border border-slate-200 rounded-xl text-xs font-bold transition cursor-pointer"
                                >
                                  Revoca
                                </button>
                              )}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                </div>
              )}
            </div>
          </div>
        )}

        {mainTab === 'contatori_risorse' && !isDev && (isHR || isAdmin || isSoci(myAssociatedName)) && (
          /* VISTA CONTATORI RISORSE (SOCI & HR) */
          <div className="space-y-6 animate-in fade-in duration-200">
            {/* Header KPI Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-gradient-to-br from-indigo-50 to-slate-50 p-4 rounded-2xl border border-indigo-100 shadow-2xs flex items-center gap-3">
                <div className="p-3 bg-indigo-600 text-white rounded-xl shadow-xs">
                  <Users className="w-5 h-5" />
                </div>
                <div>
                  <span className="block text-[11px] font-extrabold text-indigo-900 uppercase tracking-wider">Risorse Censite</span>
                  <span className="text-2xl font-black text-indigo-950">{filteredResourceStats.length} <span className="text-xs text-gray-500 font-bold">risorse</span></span>
                </div>
              </div>

              <div className="bg-gradient-to-br from-emerald-50 to-teal-50 p-4 rounded-2xl border border-emerald-100 shadow-2xs flex items-center gap-3">
                <div className="p-3 bg-emerald-600 text-white rounded-xl shadow-xs">
                  <span className="text-lg">🌴</span>
                </div>
                <div>
                  <span className="block text-[11px] font-extrabold text-emerald-900 uppercase tracking-wider">Totale Ore Ferie ({counterYear})</span>
                  <div className="flex items-baseline gap-1">
                    <span className="text-2xl font-black text-emerald-950">{filteredResourceStats.reduce((sum, r) => sum + r.ferieHours, 0)}</span>
                    <span className="text-xs font-bold text-emerald-800">ore</span>
                    <span className="text-[10px] text-gray-500 font-bold">
                      (~{(filteredResourceStats.reduce((sum, r) => sum + r.ferieHours, 0) / 8).toFixed(1).replace('.0', '')} gg)
                    </span>
                  </div>
                </div>
              </div>

              <div className="bg-gradient-to-br from-amber-50 to-orange-50 p-4 rounded-2xl border border-amber-100 shadow-2xs flex items-center gap-3">
                <div className="p-3 bg-amber-600 text-white rounded-xl shadow-xs">
                  <span className="text-lg">⏱️</span>
                </div>
                <div>
                  <span className="block text-[11px] font-extrabold text-amber-900 uppercase tracking-wider">Totale Permessi ({counterYear})</span>
                  <div className="flex items-baseline gap-1">
                    <span className="text-2xl font-black text-amber-950">{filteredResourceStats.reduce((sum, r) => sum + r.permessoHours, 0)}</span>
                    <span className="text-xs font-bold text-amber-800">ore</span>
                    <span className="text-[10px] text-gray-500 font-bold">
                      (~{(filteredResourceStats.reduce((sum, r) => sum + r.permessoHours, 0) / 8).toFixed(1).replace('.0', '')} gg)
                    </span>
                  </div>
                </div>
              </div>

              <div className="bg-gradient-to-br from-rose-50 to-slate-50 p-4 rounded-2xl border border-rose-100 shadow-2xs flex items-center gap-3">
                <div className="p-3 bg-rose-600 text-white rounded-xl shadow-xs">
                  <Clock className="w-5 h-5" />
                </div>
                <div>
                  <span className="block text-[11px] font-extrabold text-rose-900 uppercase tracking-wider">Totale Assenze Complessive</span>
                  <div className="flex items-baseline gap-1">
                    <span className="text-2xl font-black text-rose-950">{filteredResourceStats.reduce((sum, r) => sum + r.totaleOreAssenze, 0)}</span>
                    <span className="text-xs font-bold text-rose-800">ore</span>
                    <span className="text-[10px] text-gray-500 font-bold ml-1">
                      (~{(filteredResourceStats.reduce((sum, r) => sum + r.totaleOreAssenze, 0) / 8).toFixed(1).replace('.0', '')} gg)
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Filtri della Tabella */}
            <div className="bg-slate-50/80 p-4 rounded-2xl border border-slate-200 flex flex-wrap items-end justify-between gap-4">
              <div className="flex flex-wrap items-end gap-3 flex-1 min-w-[280px]">
                {/* Anno */}
                <div className="flex flex-col gap-1">
                  <label className="block text-[10px] font-extrabold text-indigo-950 uppercase tracking-wider ml-0.5">Anno:</label>
                  <select
                    value={counterYear}
                    onChange={(e) => setCounterYear(Number(e.target.value))}
                    className="bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-extrabold text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 shadow-2xs cursor-pointer"
                  >
                    {[currentYear, currentYear - 1, currentYear - 2].map(y => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>

                {/* Macro Area */}
                <div className="flex flex-col gap-1">
                  <label className="block text-[10px] font-extrabold text-indigo-950 uppercase tracking-wider ml-0.5">Area:</label>
                  <select
                    value={counterMacroArea}
                    onChange={(e) => setCounterMacroArea(e.target.value)}
                    className="bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-bold text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 shadow-2xs cursor-pointer"
                  >
                    <option value="tutte">Tutte le Macro-Aree</option>
                    <option value="Disegnatori">Disegnatori</option>
                    <option value="Ingegneria">Ingegneria</option>
                    <option value="Sicurezza Cantieri">Sicurezza Cantieri</option>
                    <option value="Consulenza Sicurezza">Consulenza Sicurezza</option>
                    <option value="Amministrazione">Amministrazione</option>
                  </select>
                </div>

                {/* Selettore Risorsa (Cerca e Seleziona) - Componente Unificato con Dropdown Floattante */}
                <div className="relative flex-1 min-w-[280px]">
                  <label className="block text-[10px] font-extrabold text-indigo-950 uppercase tracking-wider mb-1 ml-0.5">
                    Risorsa (Cerca e Seleziona)
                  </label>
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 z-10" />
                    <input
                      type="text"
                      autoComplete="new-password"
                      name="risorsa-search-counter"
                      placeholder="Digita per cercare una risorsa per nome, e-mail o area..."
                      value={selectedResource ? selectedResource.nome : counterSearchText}
                      onChange={e => {
                        setCounterSearchText(e.target.value);
                        if (selectedResource) setSelectedResource(null);
                        setIsResourceDropdownOpen(true);
                      }}
                      onFocus={() => setIsResourceDropdownOpen(true)}
                      className="w-full pl-8 pr-16 py-2 border border-slate-200 rounded-xl bg-white shadow-2xs focus:ring-2 focus:ring-indigo-400 outline-none font-bold text-gray-800 text-xs transition-all placeholder:font-normal placeholder:text-gray-400"
                    />
                    {selectedResource || counterSearchText ? (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedResource(null);
                          setCounterSearchText('');
                        }}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-rose-600 hover:text-rose-800 font-extrabold text-[10px] bg-rose-50 hover:bg-rose-100 px-2 py-0.5 rounded-lg border border-rose-200 transition cursor-pointer z-10"
                      >
                        Rimuovi
                      </button>
                    ) : null}
                  </div>

                  {isResourceDropdownOpen && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setIsResourceDropdownOpen(false)}></div>
                      <div className="absolute left-0 right-0 z-20 mt-1 max-h-60 overflow-y-auto bg-white border border-slate-200 rounded-2xl shadow-2xl divide-y divide-slate-100 animate-in fade-in zoom-in-95 duration-150 custom-scrollbar">
                        {(() => {
                          const searchStr = counterSearchText.toLowerCase().trim();
                          const filteredDip = dipendenti
                            .slice()
                            .sort((a, b) => (a.nome || '').localeCompare(b.nome || ''))
                            .filter(d => {
                              const n = (d.nome || '').toLowerCase();
                              const e = (d.email || '').toLowerCase();
                              const a = (d.macroArea || '').toLowerCase();
                              return n.includes(searchStr) || e.includes(searchStr) || a.includes(searchStr);
                            });

                          if (filteredDip.length === 0) {
                            return (
                              <div className="p-3 text-xs text-gray-400 italic font-bold text-center">
                                Nessuna risorsa trovata per "{counterSearchText}"
                              </div>
                            );
                          }

                          return filteredDip.map(d => (
                            <button
                              key={d.id || d.nome}
                              type="button"
                              onClick={() => {
                                setSelectedResource(d);
                                setCounterSearchText(d.nome);
                                setIsResourceDropdownOpen(false);
                              }}
                              className="w-full text-left px-3.5 py-2.5 hover:bg-indigo-50/80 text-xs font-semibold text-gray-800 transition-colors flex items-center justify-between gap-2 cursor-pointer"
                            >
                              <div className="flex flex-col min-w-0">
                                <span className="font-extrabold text-sm text-gray-900 truncate">{d.nome}</span>
                                <span className="text-[10.5px] text-gray-400 font-normal truncate">{d.email || 'Nessuna email'}</span>
                              </div>
                              <span className="text-[10px] font-extrabold text-indigo-700 bg-indigo-50 px-2.5 py-1 rounded-lg border border-indigo-100 shrink-0">
                                {d.macroArea || 'Generico'}
                              </span>
                            </button>
                          ));
                        })()}
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Pulsanti Azione: Export CSV e Stampa/PDF */}
              <div className="flex items-end gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleExportCSV}
                  className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-extrabold flex items-center gap-2 shadow-xs transition-all cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  <span>Esporta CSV</span>
                </button>

                <button
                  type="button"
                  onClick={handlePrintContatoriReport}
                  className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-extrabold flex items-center gap-2 shadow-xs transition-all cursor-pointer"
                >
                  <Printer className="w-4 h-4" />
                  <span>Stampa / PDF</span>
                </button>

                {(isHR || isAdmin || isSoci(myAssociatedName)) && (
                  <button
                    type="button"
                    onClick={handleRegenerateSummary}
                    disabled={isRegenerating}
                    title={`Rigenera il documento di sintesi ${counterYear} su Firestore con i dati corretti`}
                    className="px-3.5 py-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-60 disabled:cursor-not-allowed text-white rounded-xl text-xs font-extrabold flex items-center gap-2 shadow-xs transition-all cursor-pointer"
                  >
                    <RefreshCw className={`w-4 h-4 ${isRegenerating ? 'animate-spin' : ''}`} />
                    <span>{isRegenerating ? 'Rigenerazione...' : `Rigenera Sintesi ${counterYear}`}</span>
                  </button>
                )}
              </div>
            </div>

            {/* Tabella Risorse */}
            <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-xs">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-100/80 border-b border-slate-200 text-slate-700 font-extrabold uppercase tracking-wider">
                    <th className="p-3.5">Risorsa</th>
                    <th className="p-3.5">Macro Area</th>
                    <th className="p-3.5 text-center">Ore Ferie ({counterYear})</th>
                    <th className="p-3.5 text-center">Ore Permesso ({counterYear})</th>
                    <th className="p-3.5 text-center">Malattia / Maternità</th>
                    <th className="p-3.5 text-center">Totale Assenze ({counterYear})</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredResourceStats.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center py-8 text-gray-400 font-medium">
                        Nessuna risorsa trovata per i filtri selezionati.
                      </td>
                    </tr>
                  ) : (
                    filteredResourceStats.map((stat, idx) => (
                      <tr key={stat.dip.id || idx} className="hover:bg-slate-50/80 transition-colors">
                        <td className="p-3.5 font-bold text-gray-900">
                          <div className="flex flex-col">
                            <button
                              type="button"
                              onClick={() => {
                                setAnalyticsResource(stat.dip);
                                setIsAnalyticsOpen(true);
                              }}
                              className="text-left font-extrabold text-sm text-indigo-950 hover:text-indigo-600 flex items-center gap-1.5 cursor-pointer group transition-colors"
                              title="Clicca per aprire l'analisi grafica dettagliata e il trend storico"
                            >
                              <span>{stat.dipName}</span>
                              <BarChart2 className="w-3.5 h-3.5 text-indigo-500 opacity-60 group-hover:opacity-100 group-hover:scale-110 transition-all" />
                            </button>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className="px-1.5 py-0.2 rounded text-[9.5px] font-extrabold uppercase bg-blue-100 text-blue-800">
                                Dipendente
                              </span>
                              {stat.email && <span className="text-[10.5px] text-gray-400 font-normal">{stat.email}</span>}
                            </div>
                          </div>
                        </td>

                        <td className="p-3.5 font-semibold text-gray-700">
                          <span className="px-2.5 py-1 bg-slate-100 text-slate-800 rounded-lg border border-slate-200/60 font-extrabold text-[11px]">
                            {stat.macroArea}
                          </span>
                        </td>

                        <td className="p-3.5 text-center">
                          <div className="inline-flex flex-col items-center">
                            <span className="text-sm font-black text-emerald-700">{stat.ferieHours} h</span>
                            <span className="text-[10px] font-bold text-gray-500">~{(stat.ferieHours / 8).toFixed(1).replace('.0', '')} gg</span>
                          </div>
                        </td>

                        <td className="p-3.5 text-center">
                          <div className="inline-flex flex-col items-center">
                            <span className="text-sm font-black text-amber-700">{stat.permessoHours} h</span>
                            <span className="text-[10px] font-bold text-gray-500">~{(stat.permessoHours / 8).toFixed(1).replace('.0', '')} gg</span>
                          </div>
                        </td>

                        <td className="p-3.5 text-center">
                          <div className="inline-flex flex-col items-center">
                            <span className="text-sm font-black text-rose-700">{stat.malattiaHours} h</span>
                            <span className="text-[10px] font-bold text-gray-500">~{(stat.malattiaHours / 8).toFixed(1).replace('.0', '')} gg</span>
                          </div>
                        </td>

                        <td className="p-3.5 text-center">
                          <div className="inline-flex flex-col items-center bg-rose-50/80 px-3.5 py-1.5 rounded-xl border border-rose-200/80">
                            <span className="text-sm font-black text-rose-950">{stat.totaleOreAssenze} h</span>
                            <span className="text-[10px] font-extrabold text-rose-800">~{(stat.totaleOreAssenze / 8).toFixed(1).replace('.0', '')} gg</span>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {mainTab === 'piano' && (
          <>
            <div className="space-y-8 animate-in fade-in duration-200">

        {/* Contatori Assenze Anno Corrente (Solo Dipendenti) */}
        {!isCollaboratoreUser && (
          <div className="mb-8 bg-gradient-to-r from-emerald-50/80 via-teal-50/60 to-indigo-50/80 p-5 rounded-3xl border border-emerald-100/90 shadow-sm animate-in fade-in zoom-in-95 duration-200">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4 border-b border-emerald-200/50 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-emerald-600 text-white rounded-xl shadow-xs">
                  <Clock className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-emerald-950 uppercase tracking-wide">
                    Riepilogo Assenze Approvate {currentYear}
                  </h3>
                  <p className="text-[11px] font-semibold text-emerald-800/80">
                    Risorsa: <strong className="text-emerald-950">{targetDipName || 'Seleziona risorsa'}</strong> (Dipendente)
                  </p>
                </div>
              </div>
              <span className="text-[10px] font-extrabold uppercase tracking-wider bg-white/80 text-emerald-800 px-3 py-1 rounded-full border border-emerald-200 shadow-2xs">
                01 Gen - 31 Dic {currentYear}
              </span>
            </div>

            {/* 3 Contatori specifici per Dipendenti: Ferie, Permessi, Malattia */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* Ore Ferie */}
              <div className="bg-white/90 p-4 rounded-2xl border border-emerald-200/80 shadow-xs flex items-center gap-3.5">
                <div className="w-11 h-11 rounded-2xl bg-emerald-100 text-emerald-700 font-extrabold text-lg flex items-center justify-center shrink-0">
                  🌴
                </div>
                <div>
                  <span className="block text-[10.5px] font-black text-emerald-900 uppercase tracking-wider">Ore Ferie</span>
                  <div className="flex items-baseline gap-1 mt-0.5">
                    <span className="text-2xl font-black text-emerald-950">{yearlyStats.ferieHours}</span>
                    <span className="text-xs font-bold text-emerald-800">ore</span>
                    <span className="text-[10px] font-bold text-gray-500 ml-1">
                      (~{(yearlyStats.ferieHours / 8).toFixed(1).replace('.0', '')} gg)
                    </span>
                  </div>
                </div>
              </div>

              {/* Ore Permesso */}
              <div className="bg-white/90 p-4 rounded-2xl border border-amber-200/80 shadow-xs flex items-center gap-3.5">
                <div className="w-11 h-11 rounded-2xl bg-amber-100 text-amber-700 font-extrabold text-lg flex items-center justify-center shrink-0">
                  ⏱️
                </div>
                <div>
                  <span className="block text-[10.5px] font-black text-amber-900 uppercase tracking-wider">Ore Permesso</span>
                  <div className="flex items-baseline gap-1 mt-0.5">
                    <span className="text-2xl font-black text-amber-950">{yearlyStats.permessoHours}</span>
                    <span className="text-xs font-bold text-amber-800">ore</span>
                    <span className="text-[10px] font-bold text-gray-500 ml-1">
                      (~{(yearlyStats.permessoHours / 8).toFixed(1).replace('.0', '')} gg)
                    </span>
                  </div>
                </div>
              </div>

              {/* Ore Malattia / Maternità */}
              <div className="bg-white/90 p-4 rounded-2xl border border-rose-200/80 shadow-xs flex items-center gap-3.5">
                <div className="w-11 h-11 rounded-2xl bg-rose-100 text-rose-700 font-extrabold text-lg flex items-center justify-center shrink-0">
                  🏥
                </div>
                <div>
                  <span className="block text-[10.5px] font-black text-rose-900 uppercase tracking-wider">Ore Malattia / Maternità</span>
                  <div className="flex items-baseline gap-1 mt-0.5">
                    <span className="text-2xl font-black text-rose-950">{yearlyStats.malattiaHours}</span>
                    <span className="text-xs font-bold text-rose-800">ore</span>
                    <span className="text-[10px] font-bold text-gray-500 ml-1">
                      (~{(yearlyStats.malattiaHours / 8).toFixed(1).replace('.0', '')} gg)
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-stretch">
          
          {/* FORM NUOVA RICHIESTA */}
          <div className="bg-white/70 backdrop-blur-xl p-6 sm:p-8 rounded-3xl border border-gray-100 shadow-sm flex flex-col justify-between h-full">
            <div>
              <div className="pb-3 border-b border-gray-150 mb-6">
                <h3 className="font-extrabold text-xl text-gray-900 flex items-center gap-2">
                  Nuova Richiesta Personale
                </h3>
                <p className="text-xs text-gray-500 font-medium mt-0.5">
                  Compila il modulo per inoltrare la tua richiesta all'HR
                </p>
              </div>
              
              <div className="bg-emerald-600/10 border border-emerald-500/20 rounded-2xl p-4 mb-5 text-xs text-emerald-950 leading-relaxed font-semibold flex gap-2.5 items-start">
                <span className="w-5 h-5 shrink-0 bg-emerald-600 text-white rounded-full flex items-center justify-center font-extrabold text-[10px]">i</span>
                <div>
                  <strong>Nota Importante:</strong> Assicurati di esserti accordato a voce con il tuo responsabile prima di inoltrare la richiesta.
                </div>
              </div>

              {!myAssociatedName && !(isAdmin || isHR) ? (
                <div className="bg-yellow-100 text-yellow-800 p-4 rounded-xl text-sm font-medium">
                  Il tuo profilo non è associato ad un nome nell'anagrafica. Contatta un amministratore per poter richiedere le ferie.
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-5">
                  {isHR && (
                    <div>
                      <label className="block text-sm font-bold text-green-900 mb-1.5 ml-1">Dipendente</label>
                      <select
                        value={dipendenteSelezionato}
                        onChange={e => setDipendenteSelezionato(e.target.value)}
                        required
                        className="w-full p-3.5 border-none rounded-xl bg-white/60 focus:bg-white outline-none focus:ring-2 focus:ring-green-500 transition shadow-inner font-medium text-green-900"
                      >
                        <option value="">-- Seleziona Dipendente --</option>
                        {dipendenti.filter(d => (!d.dataCessazione || d.dataCessazione >= new Date().toLocaleDateString('sv-SE')) && !isTechnicalUser(d)).map(d => (
                          <option key={d.id} value={d.nome}>{d.nome}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  
                  <div className="flex bg-white/50 p-1 rounded-xl shadow-inner border border-green-100/50">
                    <button
                      type="button"
                      onClick={() => setRequestMode('singolo')}
                      className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${requestMode === 'singolo' ? 'bg-green-600 text-white shadow-sm' : 'text-green-800/70 hover:text-green-900'}`}
                    >
                      Giorno Singolo
                    </button>
                    <button
                      type="button"
                      onClick={() => setRequestMode('range')}
                      className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${requestMode === 'range' ? 'bg-green-600 text-white shadow-sm' : 'text-green-800/70 hover:text-green-900'}`}
                    >
                      Intervallo di Date
                    </button>
                  </div>

                  {requestMode === 'singolo' ? (
                    <div>
                      <label className="block text-sm font-bold text-green-900 mb-1.5 ml-1">Giorno di assenza</label>
                      <input 
                        type="date" 
                        required 
                        value={dataRichiesta}
                        onChange={e => setDataRichiesta(e.target.value)}
                        className="w-full p-3.5 border-none rounded-xl bg-white/60 focus:bg-white outline-none focus:ring-2 focus:ring-green-500 transition shadow-inner font-medium text-green-900"
                      />
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-bold text-green-900 mb-1.5 ml-1">Data Inizio</label>
                        <input 
                          type="date" 
                          required 
                          value={dataInizio}
                          onChange={e => {
                            const newStart = e.target.value;
                            setDataInizio(newStart);
                            if (dataFine && dataFine < newStart) {
                              setDataFine(newStart);
                            }
                          }}
                          className="w-full p-3.5 border-none rounded-xl bg-white/60 focus:bg-white outline-none focus:ring-2 focus:ring-green-500 transition shadow-inner font-medium text-green-900 text-xs sm:text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-green-900 mb-1.5 ml-1">Data Fine</label>
                        <input 
                          type="date" 
                          required 
                          min={dataInizio || undefined}
                          value={dataFine}
                          onChange={e => setDataFine(e.target.value)}
                          className="w-full p-3.5 border-none rounded-xl bg-white/60 focus:bg-white outline-none focus:ring-2 focus:ring-green-500 transition shadow-inner font-medium text-green-900 text-xs sm:text-sm"
                        />
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="block text-sm font-bold text-green-900 mb-1.5 ml-1">Tipo di assenza</label>
                    <select 
                      value={tipoRichiesta} 
                      onChange={e => setTipoRichiesta(e.target.value)}
                      className="w-full p-3.5 border-none rounded-xl bg-white/60 focus:bg-white outline-none focus:ring-2 focus:ring-green-500 transition shadow-inner font-medium text-green-900"
                    >
                      {isCollaboratoreUser ? (
                        <>
                          <option value="assenza">Assenza</option>
                          <option value="malattia">Malattia</option>
                          <option value="maternita">Maternità</option>
                          <option value="smart">Lavora da Casa</option>
                        </>
                      ) : (
                        <>
                          <option value="ferie">Ferie</option>
                          <option value="permesso">Permesso</option>
                          <option value="malattia">Malattia</option>
                          <option value="maternita">Maternità</option>
                          <option value="smart">Lavora da Casa</option>
                          <option value="studio">Permesso Studio</option>
                          <option value="ex_l104">Permesso ex L.104</option>
                          <option value="donazione">Permesso Donazione</option>
                          <option value="elettorale">Permesso Elettorale</option>
                        </>
                      )}
                    </select>
                  </div>

                  {(tipoRichiesta === 'permesso' || tipoRichiesta === 'assenza' || tipoRichiesta === 'smart' || tipoRichiesta === 'ex_l104' || tipoRichiesta === 'studio') && (
                    <div className="bg-white/40 p-4 rounded-2xl border border-green-150 space-y-4 animate-in fade-in duration-200">
                      <label className="block text-xs font-black text-green-950 uppercase tracking-wider">
                        {tipoRichiesta === 'smart' ? 'Frazionamento Lavoro da Casa' : (tipoRichiesta === 'assenza' ? 'Frazionamento Assenza' : 'Frazionamento Permesso')}
                      </label>
                      <div className="grid grid-cols-2 gap-2.5">
                        {[
                          { value: 'giornata', label: 'Giornata Intera' },
                          { value: 'mattina', label: 'Solo Mattina (AM)' },
                          { value: 'pomeriggio', label: 'Solo Pomeriggio (PM)' },
                          { value: 'orario', label: 'Orario Specifico' }
                        ].map((item) => (
                          <button
                            key={item.value}
                            type="button"
                            onClick={() => setFrazioneTipo(item.value as any)}
                            className={`p-3 rounded-xl border text-xs font-bold text-center transition-all ${
                              frazioneTipo === item.value
                                ? 'bg-green-600 text-white border-transparent shadow-sm'
                                : 'bg-white/60 text-green-900 border-green-100 hover:bg-white'
                            }`}
                          >
                            {item.value === frazioneTipo && <span className="mr-1">✓</span>}
                            {item.label}
                          </button>
                        ))}
                      </div>
                      {frazioneTipo === 'orario' && (
                        <div className="space-y-4 pt-2 border-t border-green-100 animate-in slide-in-from-top-2 duration-200">
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <label className="block text-xs font-bold text-green-900 mb-1 ml-1">Ora Inizio</label>
                              <select 
                                required 
                                value={oraInizio}
                                onChange={e => setOraInizio(e.target.value)}
                                className="w-full p-3 border-none rounded-xl bg-white/70 focus:bg-white outline-none focus:ring-2 focus:ring-green-500 transition shadow-inner font-bold text-green-900 text-xs cursor-pointer"
                              >
                                {TIME_OPTIONS.map(opt => (
                                  <option key={opt} value={opt}>{opt}</option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs font-bold text-green-900 mb-1 ml-1">Ora Fine</label>
                              <select 
                                required 
                                value={oraFine}
                                onChange={e => setOraFine(e.target.value)}
                                className="w-full p-3 border-none rounded-xl bg-white/70 focus:bg-white outline-none focus:ring-2 focus:ring-green-500 transition shadow-inner font-bold text-green-900 text-xs cursor-pointer"
                              >
                                {TIME_OPTIONS.map(opt => (
                                  <option key={opt} value={opt}>{opt}</option>
                                ))}
                              </select>
                            </div>
                          </div>

                          {tipoRichiesta !== 'smart' && (
                            <>
                              <div className="flex items-center gap-3 bg-white/50 p-3 rounded-xl border border-green-100/50">
                                <label className="flex items-center gap-2.5 cursor-pointer text-xs font-bold text-green-950 select-none">
                                  <input 
                                    type="checkbox" 
                                    checked={pausaPranzo}
                                    onChange={e => setPausaPranzo(e.target.checked)}
                                    className="w-4.5 h-4.5 rounded border-green-200 text-green-600 focus:ring-green-500 cursor-pointer"
                                  />
                                  <span>Pausa pranzo all'interno della fascia oraria</span>
                                </label>
                              </div>

                              {pausaPranzo && (
                                <div className="animate-in slide-in-from-top-2 duration-200">
                                  <label className="block text-xs font-bold text-green-900 mb-1 ml-1">Durata pausa pranzo da sottrarre</label>
                                  <select 
                                    value={pausaPranzoOre}
                                    onChange={e => setPausaPranzoOre(e.target.value)}
                                    className="w-full p-3 border-none rounded-xl bg-white/70 focus:bg-white outline-none focus:ring-2 focus:ring-green-500 transition shadow-inner font-bold text-green-900 text-xs cursor-pointer"
                                  >
                                    {PAUSA_PRANZO_OPTIONS.map(opt => (
                                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                                    ))}
                                  </select>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  
                  <button 
                    type="submit" 
                    disabled={loading}
                    className="w-full bg-green-600 text-white font-bold py-4 rounded-xl hover:bg-green-700 transition shadow-lg active:scale-95 disabled:opacity-50 disabled:active:scale-100 mt-4"
                  >
                    {loading ? 'Invio in corso...' : 'Invia Richiesta'}
                  </button>
                </form>
              )}
            </div>
          </div>

          {/* LISTA E REGISTRO RICHIESTE */}
          <div className="bg-white/70 backdrop-blur-xl p-6 sm:p-8 rounded-3xl border border-gray-100 shadow-sm flex flex-col h-full">
            <div className="flex flex-col gap-4 h-full">
              <div className="pb-3 border-b border-gray-150">
                <h3 className="font-extrabold text-xl text-gray-900 flex items-center gap-2">
                  {isHR ? "Gestione e Registro Permessi" : "Registro Ferie e Permessi"}
                  {pendingCount > 0 && (
                    <span className="bg-amber-500 text-white text-xs font-black px-2.5 py-0.5 rounded-full shadow-xs">
                      {pendingCount}
                    </span>
                  )}
                </h3>
                <p className="text-xs text-gray-500 font-medium mt-0.5">
                  {isHR ? "Consulta e gestisci le richieste pervenute ed i cambi approvati per qualsiasi risorsa" : "Filtra le tue richieste ed invia modifiche per i permessi approvati"}
                </p>

                {/* CAMPO DI RICERCA RISORSA PER HR */}
                {isHR && (
                  <div className="relative mt-3">
                    <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      placeholder="Cerca per nome risorsa..."
                      value={searchResourceText}
                      onChange={e => setSearchResourceText(e.target.value)}
                      className="w-full pl-9 pr-8 py-2 bg-slate-50 hover:bg-slate-100/80 focus:bg-white border border-slate-200 rounded-xl text-xs font-bold text-gray-800 focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500 transition-all placeholder:text-gray-400 placeholder:font-normal shadow-2xs"
                    />
                    {searchResourceText && (
                      <button
                        type="button"
                        onClick={() => setSearchResourceText('')}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-0.5 rounded-full cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* TAB DI FILTRAGGIO */}
            <div className="flex flex-wrap items-center gap-1.5 border-b border-gray-100 pb-2.5">
              {[
                { id: 'tutte', label: 'Tutte', count: searchedBaseRequests.length },
                { id: 'in_attesa', label: 'In Attesa / Modifiche', count: searchedBaseRequests.filter(r => r.stato === 'In attesa' || r.stato === 'Richiesta Annullamento' || r.stato === 'Richiesta Modifica').length },
                { id: 'approvate', label: 'Approvate', count: searchedBaseRequests.filter(r => r.stato === 'Approvato').length },
                { id: 'storico', label: 'Rifiutate', count: searchedBaseRequests.filter(r => r.stato === 'Rifiutato').length }
              ].map(tab => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setUserSelectedTab(true);
                    setRequestTab(tab.id as any);
                  }}
                  className={`px-3 py-1.5 rounded-xl text-[11px] font-black transition-all flex items-center gap-1.5 cursor-pointer ${
                    requestTab === tab.id
                      ? 'bg-green-600 text-white shadow-sm'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  <span>{tab.label}</span>
                  <span className={`px-1.5 py-0.2 rounded-full text-[9.5px] ${requestTab === tab.id ? 'bg-white/30 text-white' : 'bg-slate-200 text-slate-700'}`}>
                    {tab.count}
                  </span>
                </button>
              ))}
            </div>

            {/* LISTA CARD RICHIESTE */}
            <div className="space-y-3 flex-1 overflow-y-auto pr-1 max-h-[500px] custom-scrollbar">
              {filteredRequestsList.length === 0 ? (
                <div className="text-center text-gray-400 py-10 font-medium bg-slate-50/50 rounded-2xl border border-dashed border-slate-200 text-xs">
                  Nessuna richiesta presente per i filtri correnti.
                </div>
              ) : (
                filteredRequestsList.map(req => {
                  const isMyReq = req.dipendenteName === myAssociatedName;
                  const hasModificationPending = req.stato === 'Richiesta Annullamento' || req.stato === 'Richiesta Modifica';

                  return (
                    <div 
                      key={req.id} 
                      className={`p-3.5 sm:p-4 border rounded-2xl transition-all flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 ${
                        hasModificationPending 
                          ? 'bg-amber-50/70 border-amber-200 shadow-xs' 
                          : 'bg-white border-slate-200/80 shadow-2xs hover:shadow-xs'
                      }`}
                    >
                      <div className="space-y-1.5 flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-extrabold text-sm text-gray-900 truncate">{req.dipendenteName}</span>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[11px] font-extrabold text-gray-700 bg-slate-100 px-2 py-0.5 rounded-lg border border-slate-200/60">
                            {req.dataInizio && req.dataFine && req.dataInizio !== req.dataFine 
                              ? `Dal ${formatDate(req.dataInizio)} al ${formatDate(req.dataFine)}${req.oraInizio && req.oraFine ? ` (${req.oraInizio}-${req.oraFine}${req.pausaPranzo && req.pausaPranzoOre ? `, esc. pranzo ${req.pausaPranzoOre.toString().replace('.', ',')}h` : ''})` : ''}`
                              : req.oraInizio && req.oraFine
                                ? `Il ${formatDate(req.dataInizio || req.data)} dalle ${req.oraInizio} alle ${req.oraFine}${req.pausaPranzo && req.pausaPranzoOre ? ` (esc. pranzo ${req.pausaPranzoOre.toString().replace('.', ',')}h)` : ''}`
                                : `Il ${formatDate(req.dataInizio || req.data)}`}
                          </span>
                          {getTipoLabel(req.tipo, req.frazioneTipo, req.dipendenteName)}
                        </div>

                        {/* ANTEPRIMA MODIFICA RICHIESTA (SE IN ATTESA DI ANNULLAMENTO/MODIFICA) */}
                        {req.richiestaModifica && (
                          <div className="mt-1.5 p-2.5 bg-amber-100/60 border border-amber-200 rounded-xl text-xs space-y-0.5 text-amber-950">
                            <div className="font-black flex items-center gap-1 text-amber-900 uppercase text-[10px]">
                              <AlertTriangle className="w-3 h-3 text-amber-600" />
                              <span>{req.richiestaModifica.tipoAzione === 'annullamento' ? 'Richiesta di Annullamento' : 'Richiesta di Modifica'}</span>
                            </div>
                            {req.richiestaModifica.tipoAzione === 'modifica' && (
                              <div className="font-bold text-amber-900 text-[11px]">
                                Nuovo Periodo: Dal {formatDate(req.richiestaModifica.nuovaDataInizio || '')} al {formatDate(req.richiestaModifica.nuovaDataFine || '')}
                                {req.richiestaModifica.nuovaOraInizio && req.richiestaModifica.nuovaOraFine ? ` dalle ${req.richiestaModifica.nuovaOraInizio} alle ${req.richiestaModifica.nuovaOraFine}` : ''}
                              </div>
                            )}
                            {req.richiestaModifica.motivazione && (
                              <div className="italic text-amber-900/90 font-medium text-[10.5px]">
                                "{req.richiestaModifica.motivazione}"
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="flex flex-col items-start sm:items-end justify-between w-full sm:w-auto gap-2 shrink-0 border-t sm:border-t-0 pt-2 sm:pt-0">
                        <div className="flex items-center gap-2">
                          {getStatusBadge(req.stato)}
                        </div>

                        <div className="flex items-center gap-1.5 flex-wrap">
                          {/* AZIONE DIPENDENTE O HR SU RICHIESTA APPROVATA: MODIFICA / ANNULLA (MATITINA) */}
                          {(isMyReq || isHR) && req.stato === 'Approvato' && (
                            <button
                              type="button"
                              onClick={() => openModificationModal(req)}
                              className="flex items-center gap-1 px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300/80 rounded-lg text-[11px] font-extrabold transition-all shadow-2xs hover:shadow-xs active:scale-95 cursor-pointer"
                              title={isHR ? "Modifica o annulla direttamente le ferie/permesso approvati per questa risorsa" : "Richiedi modifica o annullamento all'HR"}
                            >
                              <Pencil className="w-3 h-3 text-amber-700" />
                              <span>Modifica / Annulla</span>
                            </button>
                          )}

                          {/* AZIONE DIPENDENTE SU RICHIESTA IN ATTESA: ANNULLA BOZZA */}
                          {isMyReq && req.stato === 'In attesa' && (
                            <button
                              type="button"
                              onClick={() => handleWithdrawPendingRequest(req.id)}
                              className="flex items-center gap-1 px-2 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg text-[11px] font-extrabold transition active:scale-95 cursor-pointer"
                              title="Ritira la richiesta in attesa"
                            >
                              <Trash2 className="w-3 h-3" />
                              <span>Ritira</span>
                            </button>
                          )}

                          {/* AZIONI HR PER RICHIESTE IN ATTESA */}
                          {isHR && req.stato === 'In attesa' && (
                            <div className="flex gap-1.5">
                              <button 
                                onClick={() => handleDecision(req.id, true)} 
                                className="px-2.5 py-1 text-[11px] font-extrabold bg-green-600 hover:bg-green-700 text-white rounded-lg transition shadow-2xs active:scale-95 cursor-pointer"
                              >
                                Approva
                              </button>
                              <button 
                                onClick={() => handleDecision(req.id, false)} 
                                className="px-2.5 py-1 text-[11px] font-extrabold bg-rose-600 hover:bg-rose-700 text-white rounded-lg transition shadow-2xs active:scale-95 cursor-pointer"
                              >
                                Rifiuta
                              </button>
                            </div>
                          )}

                          {/* AZIONI HR PER RICHIESTE DI ANNULLAMENTO / MODIFICA */}
                          {isHR && (req.stato === 'Richiesta Annullamento' || req.stato === 'Richiesta Modifica') && (
                            <div className="flex flex-wrap gap-1.5">
                              {req.stato === 'Richiesta Annullamento' ? (
                                <button 
                                  onClick={() => handleHRApproveCancellation(req)} 
                                  className="px-2.5 py-1 text-[11px] font-extrabold bg-red-600 hover:bg-red-700 text-white rounded-lg transition shadow-2xs active:scale-95 cursor-pointer"
                                >
                                  Conferma Annullamento
                                </button>
                              ) : (
                                <button 
                                  onClick={() => handleHRApproveModification(req)} 
                                  className="px-2.5 py-1 text-[11px] font-extrabold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition shadow-2xs active:scale-95 cursor-pointer"
                                >
                                  Applica Modifica
                                </button>
                              )}
                              <button 
                                onClick={() => handleHRRejectModificationOrCancellation(req)} 
                                className="px-2 py-1 text-[11px] font-bold bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-lg transition cursor-pointer"
                              >
                                Rifiuta Cambio
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>

      {/* CALENDARIO VIEW */}
      <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] shadow-xl p-6 sm:p-10 border border-white/50 no-print">
        <div className="flex justify-between items-center mb-6">
          <h3 className="font-extrabold text-2xl text-gray-900 capitalize">{monthName}</h3>
          <div className="flex flex-wrap items-center gap-3">
            {/* Navigatore Mese */}
            <div className="flex items-center gap-1 bg-white p-1.5 rounded-xl border border-gray-200 shadow-sm">
              <button onClick={() => shiftMonth(-1)} className="p-2 hover:bg-gray-100 rounded-lg text-gray-600 transition"><ChevronLeft className="w-5 h-5" /></button>
              <button onClick={() => setCurrentMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))} className="px-4 py-2 text-sm font-extrabold text-gray-700 hover:bg-gray-100 rounded-lg transition">Oggi</button>
              <button onClick={() => shiftMonth(1)} className="p-2 hover:bg-gray-100 rounded-lg text-gray-600 transition"><ChevronRight className="w-5 h-5" /></button>
            </div>

            {/* Selettore Vista */}
            <div className="bg-gray-150 p-1.5 rounded-2xl flex gap-1.5 border border-gray-200 shadow-inner">
              <button 
                onClick={() => setViewMode('calendario')}
                className={`px-3 py-1.5 rounded-xl text-xs font-extrabold transition-all cursor-pointer ${
                  viewMode === 'calendario' 
                    ? 'bg-white text-gray-900 shadow-sm border border-gray-200/50' 
                    : 'text-gray-500 hover:text-gray-800'
                }`}
              >
                Calendario
              </button>
              <button 
                onClick={() => setViewMode('tabella')}
                className={`px-3 py-1.5 rounded-xl text-xs font-extrabold transition-all cursor-pointer ${
                  viewMode === 'tabella' 
                    ? 'bg-white text-gray-900 shadow-sm border border-gray-200/50' 
                    : 'text-gray-500 hover:text-gray-800'
                }`}
              >
                Griglia Risorse
              </button>
            </div>
            
            {/* Bottone Stampa */}
            <button onClick={handlePrintFeriePlan} className="hidden md:flex items-center gap-2 bg-gray-900 text-white hover:bg-gray-800 px-5 py-2.5 rounded-xl font-bold transition shadow-lg active:scale-95 cursor-pointer">
              Stampa
            </button>
          </div>
        </div>

        {viewMode === 'calendario' ? (
          <>
            <div className="grid grid-cols-7 gap-2 mb-2">
              {['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'].map(d => (
                <div key={d} className="text-center font-bold text-gray-400 text-sm py-2">{d}</div>
              ))}
            </div>
            
            <div className="grid grid-cols-7 gap-2">
              {calendarCells}
            </div>

            <div className="mt-8 flex flex-wrap gap-4 p-4 bg-gray-50 rounded-2xl border border-gray-100 justify-center">
              <div className="text-xs font-bold text-gray-500 mr-2 self-center">Legenda Colori:</div>
              <div className="flex items-center gap-2 text-xs font-bold text-gray-700">
                <span className="w-3 h-3 rounded-full bg-sky-500 shadow-sm"></span> Ferie Dipendenti/Assenza Collaboratori
              </div>
              <div className="flex items-center gap-2 text-xs font-bold text-gray-700">
                <span className="w-3 h-3 rounded-full bg-amber-500 shadow-sm"></span> Permesso dipendenti/Assenza oraria Collaboratori (L: ex L.104, S: Studio, D: Donazione, E: Elettorale)
              </div>
              <div className="flex items-center gap-2 text-xs font-bold text-gray-700">
                <span className="w-3.5 h-3.5 rounded-full bg-red-500 shadow-sm flex items-center justify-center text-[9px] font-black text-white">M</span> Malattia/Maternità
              </div>
              <div className="flex items-center gap-2 text-xs font-bold text-gray-700">
                <span className="w-3 h-3 rounded-full bg-emerald-500 shadow-sm"></span> Lavoro da Casa
              </div>
              <div className="flex items-center gap-2 text-xs font-bold text-gray-700">
                <span className="w-3.5 h-3.5 rounded-full bg-gray-600 shadow-sm flex items-center justify-center text-[9px] font-black text-white">X</span> Cessato / Inattivo
              </div>
              <div className="flex items-center gap-2 text-xs font-bold text-gray-700 border-l border-gray-300 pl-3">
                <span className="px-1.5 py-0.5 rounded bg-yellow-50 border border-amber-300 border-dashed text-[10px] text-amber-900 font-extrabold flex items-center gap-1">
                  <span>In attesa</span> ⌛
                </span>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm mt-4">
              <table className="w-full text-left border-collapse min-w-[900px] table-fixed">
                <colgroup>
                  <col className="w-[180px]" />
                  {Array.from({ length: 31 }).map((_, idx) => (
                    <col key={idx} className="w-[30px]" />
                  ))}
                </colgroup>
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="p-3 text-xs font-bold text-gray-550 uppercase sticky left-0 bg-gray-50 z-10 border-r border-gray-200">ELENCO PERSONALE</th>
                    {Array.from({ length: 31 }).map((_, i) => {
                      const day = i + 1;
                      if (day > daysInMonth) return <th key={i} className="bg-gray-100"></th>;
                      const dateStr = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                      const isWknd = isWeekend(dateStr);
                      const isHoliday = isItalianHoliday(dateStr);
                      const isSpecialDay = isWknd || isHoliday;

                      let thStyle: React.CSSProperties = {};
                      let thClass = "p-2 text-center text-xs font-bold border-r border-gray-200";

                      if (isSpecialDay) {
                        thStyle = { background: 'linear-gradient(135deg, #f3f4f6 0%, #e5e7eb 100%)' };
                        thClass += " text-gray-500";
                      } else {
                        thClass += " text-gray-500";
                      }

                      return (
                        <th key={i} style={thStyle} className={thClass}>
                          {day}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 font-medium text-gray-900 text-xs">
                  {(() => {
                    const firstDayOfMonthStr = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}-01`;
                    const sortedDipendenti = dipendenti
                      .filter(d => (!d.dataCessazione || d.dataCessazione >= firstDayOfMonthStr) && !isTechnicalUser(d))
                      .sort((a, b) => a.nome.trim().localeCompare(b.nome.trim()));
                    return sortedDipendenti.map(dip => {
                      return (
                        <tr key={dip.id} className="hover:bg-gray-50/40 transition-colors">
                          <td className="p-3 font-bold text-gray-800 sticky left-0 bg-white border-r border-gray-200 shadow-[2px_0_5px_rgba(0,0,0,0.03)] truncate z-10">
                            {dip.nome}
                          </td>
                          {Array.from({ length: 31 }).map((_, i) => {
                            const day = i + 1;
                            if (day > daysInMonth) return <td key={i} className="bg-gray-50 border-r border-gray-150"></td>;

                            const dateStr = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                            const isWknd = isWeekend(dateStr);
                            const isHoliday = isItalianHoliday(dateStr);

                            const isUnlocked = approvedWeekends[`${dip.nome}_${dateStr}`];
                            const isSpecialDay = (isWknd || isHoliday) && !isUnlocked;

                            const req = richieste.find(r => {
                               if (r.stato === 'Rifiutato') return false;
                               const start = r.dataInizio || r.data;
                               const end = r.dataFine || r.data;
                               const matchName = (r.dipendenteName || '').trim().toLowerCase() === (dip.nome || '').trim().toLowerCase();
                               return start && end && dateStr >= start && dateStr <= end && matchName;
                             });

                            let cellBg = '';
                            let cellStyle: React.CSSProperties = {};
                            let cellText = '';
                            let titleStr = `${dip.nome} - ${day}/${currentMonth.getMonth() + 1}`;

                            const isCessato = dip.dataCessazione && dateStr > dip.dataCessazione;

                            if (isCessato) {
                              cellBg = 'text-white text-center font-bold bg-gray-500';
                              cellStyle = { background: 'linear-gradient(135deg, #4b5563 0%, #374151 100%)' };
                              cellText = 'X';
                              titleStr += '\nRisorsa cessata / inattiva';
                            } else if (isSpecialDay) {
                              cellBg = 'text-gray-400';
                              cellStyle = { background: 'linear-gradient(135deg, #f3f4f6 0%, #e5e7eb 100%)' };
                            } else if (req) {
                              const isApproved = req.stato === 'Approvato';
                              const isRejected = req.stato === 'Rifiutato';

                              titleStr += `\nStato: ${req.stato}\nTipo: ${getTipoData(req.tipo, req.frazioneTipo, dip.nome).label}`;
                              if (req.oraInizio && req.oraFine) {
                                titleStr += `\nOrario: dalle ${req.oraInizio} alle ${req.oraFine}${req.pausaPranzo && req.pausaPranzoOre ? ` (esclusa p. pranzo ${req.pausaPranzoOre.toString().replace('.', ',')}h)` : ''}`;
                              } else if (req.frazioneTipo === 'mattina' || req.tipo === 'mattina') {
                                titleStr += '\nFascia: Mattina (AM)';
                              } else if (req.frazioneTipo === 'pomeriggio' || req.tipo === 'pomeriggio') {
                                titleStr += '\nFascia: Pomeriggio (PM)';
                              }
                              if (req.note) titleStr += `\nNote: ${req.note}`;

                              const isCollabDip = isCollaboratore(dip.nome, dipendenti) || isSoci(dip.nome);
                              const isFractional = Boolean(
                                req.frazioneTipo === 'mattina' ||
                                req.frazioneTipo === 'pomeriggio' ||
                                req.frazioneTipo === 'orario' ||
                                (req.frazioneTipo && req.frazioneTipo !== 'giornata') ||
                                (req.oraInizio && req.oraFine) ||
                                req.tipo === 'mattina' ||
                                req.tipo === 'pomeriggio'
                              );

                              if (isRejected) {
                                cellBg = 'bg-red-50 border-red-200 text-red-800/60 line-through opacity-50';
                              } else if (['malattia', 'maternita'].includes(req.tipo)) {
                                cellBg = isApproved 
                                  ? 'bg-red-500 hover:bg-red-600 border-red-600 text-white font-extrabold shadow-sm' 
                                  : 'bg-yellow-50 border-yellow-250 text-yellow-750 opacity-60';
                                cellText = 'M';
                              } else if (req.tipo === 'ex_l104') {
                                cellBg = isApproved 
                                  ? 'bg-amber-400 hover:bg-amber-500 border-amber-500 text-amber-950 font-extrabold shadow-sm' 
                                  : 'bg-yellow-50 border-yellow-250 text-yellow-750 opacity-60';
                                cellText = 'L';
                              } else if (req.tipo === 'studio') {
                                cellBg = isApproved 
                                  ? 'bg-amber-400 hover:bg-amber-500 border-amber-500 text-amber-950 font-extrabold shadow-sm' 
                                  : 'bg-yellow-50 border-yellow-250 text-yellow-750 opacity-60';
                                cellText = 'S';
                              } else if (req.tipo === 'donazione') {
                                cellBg = isApproved 
                                  ? 'bg-amber-400 hover:bg-amber-500 border-amber-500 text-amber-950 font-extrabold shadow-sm' 
                                  : 'bg-yellow-50 border-yellow-250 text-yellow-750 opacity-60';
                                cellText = 'D';
                              } else if (req.tipo === 'elettorale') {
                                cellBg = isApproved 
                                  ? 'bg-amber-400 hover:bg-amber-500 border-amber-500 text-amber-950 font-extrabold shadow-sm' 
                                  : 'bg-yellow-50 border-yellow-250 text-yellow-750 opacity-60';
                                cellText = 'E';
                              } else if (isCollabDip && isFractional) {
                                // Assenza Oraria Collaboratori / Soci -> AMBRA / GIALLO
                                cellBg = isApproved 
                                  ? 'bg-amber-400 hover:bg-amber-500 border-amber-500 text-amber-950 font-extrabold shadow-sm' 
                                  : 'bg-yellow-50 border-yellow-250 text-yellow-750 opacity-60';
                                
                                if (req.tipo === 'mattina' || req.frazioneTipo === 'mattina') {
                                  cellText = 'AM';
                                } else if (req.tipo === 'pomeriggio' || req.frazioneTipo === 'pomeriggio') {
                                  cellText = 'PM';
                                } else if (req.oraInizio && req.oraFine) {
                                  const [hStart, mStart] = req.oraInizio.split(':').map(Number);
                                  const [hEnd, mEnd] = req.oraFine.split(':').map(Number);
                                  const diffMs = new Date(2000, 0, 1, hEnd, mEnd).getTime() - new Date(2000, 0, 1, hStart, mStart).getTime();
                                  let hrs = Math.round((diffMs / 3600000) * 100) / 100;
                                  if (req.pausaPranzo && req.pausaPranzoOre) {
                                    hrs = Math.max(0, hrs - req.pausaPranzoOre);
                                  }
                                  cellText = `${hrs.toString().replace('.', ',')}h`;
                                } else {
                                  cellText = '';
                                }
                              } else if (req.tipo === 'smart') {
                                cellBg = isApproved 
                                  ? 'bg-emerald-500 hover:bg-emerald-600 border-emerald-600 text-white font-extrabold shadow-sm' 
                                  : 'bg-yellow-50 border-yellow-250 text-yellow-750 opacity-60';
                                if (req.frazioneTipo === 'mattina') {
                                  cellText = 'AM';
                                } else if (req.frazioneTipo === 'pomeriggio') {
                                  cellText = 'PM';
                                } else if (req.oraInizio && req.oraFine) {
                                  const [hStart, mStart] = req.oraInizio.split(':').map(Number);
                                  const [hEnd, mEnd] = req.oraFine.split(':').map(Number);
                                  const diffMs = new Date(2000, 0, 1, hEnd, mEnd).getTime() - new Date(2000, 0, 1, hStart, mStart).getTime();
                                  let hrs = Math.round((diffMs / 3600000) * 100) / 100;
                                  if (req.pausaPranzo && req.pausaPranzoOre) {
                                    hrs = Math.max(0, hrs - req.pausaPranzoOre);
                                  }
                                  cellText = `${hrs.toString().replace('.', ',')}h`;
                                } else {
                                  cellText = '';
                                }
                              } else if (req.tipo === 'studio') {
                                cellBg = isApproved 
                                  ? 'bg-purple-500 hover:bg-purple-600 border-purple-600 text-white font-extrabold shadow-sm' 
                                  : 'bg-yellow-50 border-yellow-250 text-yellow-750 opacity-60';
                                cellText = 'S';
                              } else if (req.tipo === 'donazione') {
                                cellBg = isApproved 
                                  ? 'bg-teal-500 hover:bg-teal-600 border-teal-600 text-white font-extrabold shadow-sm' 
                                  : 'bg-yellow-50 border-yellow-250 text-yellow-750 opacity-60';
                                cellText = 'D';
                              } else if (req.tipo === 'elettorale') {
                                cellBg = isApproved 
                                  ? 'bg-indigo-500 hover:bg-indigo-600 border-indigo-600 text-white font-extrabold shadow-sm' 
                                  : 'bg-yellow-50 border-yellow-250 text-yellow-750 opacity-60';
                                cellText = 'E';
                              } else if (req.tipo === 'ferie' || req.frazioneTipo === 'giornata' || (!isFractional && (req.tipo === 'assenza' || req.tipo === 'ferie'))) {
                                cellBg = isApproved 
                                  ? 'bg-sky-500 hover:bg-sky-600 border-sky-600 text-white font-extrabold shadow-sm' 
                                  : 'bg-yellow-50 border-yellow-250 text-yellow-750 opacity-60';
                                cellText = '';
                              } else {
                                // Permessi Dipendenti / Assenza Oraria Collaboratori -> AMBRA / GIALLO
                                cellBg = isApproved 
                                  ? 'bg-amber-400 hover:bg-amber-500 border-amber-500 text-amber-950 font-extrabold shadow-sm' 
                                  : 'bg-yellow-50 border-yellow-250 text-yellow-750 opacity-60';
                                
                                if (req.tipo === 'mattina' || req.frazioneTipo === 'mattina') {
                                  cellText = 'AM';
                                } else if (req.tipo === 'pomeriggio' || req.frazioneTipo === 'pomeriggio') {
                                  cellText = 'PM';
                                } else if (req.oraInizio && req.oraFine) {
                                  const [hStart, mStart] = req.oraInizio.split(':').map(Number);
                                  const [hEnd, mEnd] = req.oraFine.split(':').map(Number);
                                  const diffMs = new Date(2000, 0, 1, hEnd, mEnd).getTime() - new Date(2000, 0, 1, hStart, mStart).getTime();
                                  let hrs = Math.round((diffMs / 3600000) * 100) / 100;
                                  if (req.pausaPranzo && req.pausaPranzoOre) {
                                    hrs = Math.max(0, hrs - req.pausaPranzoOre);
                                  }
                                  cellText = `${hrs.toString().replace('.', ',')}h`;
                                } else {
                                  cellText = '';
                                }
                              }
                            }

                            const isClickable = !!req && isHR && !isSpecialDay && !isCessato;

                            return (
                              <td 
                                key={i} 
                                onClick={() => {
                                  if (isClickable) {
                                    setCancellationRequest(req);
                                    setCancellationReason('');
                                  }
                                }}
                                title={titleStr}
                                style={cellStyle}
                                className={`p-1.5 text-center border-r border-gray-200 transition-all ${cellBg} ${isClickable ? 'cursor-pointer select-none font-extrabold' : ''}`}
                              >
                                {cellText}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    });
                  })()}
                </tbody>
              </table>
            </div>

            {/* Legend for resources grid */}
            <div className="mt-6 flex flex-wrap gap-4 p-5 bg-gray-50 rounded-2xl border border-gray-100 justify-center">
              <div className="text-xs font-bold text-gray-500 mr-2 self-center">Legenda Colori (Approvati):</div>
              <div className="flex items-center gap-2 text-xs font-bold text-gray-700">
                <span className="w-6 h-4 rounded border border-sky-600 bg-sky-500"></span> Ferie Dipendenti/Assenza Collaboratori
              </div>
              <div className="flex items-center gap-2 text-xs font-bold text-gray-700">
                <span className="w-6 h-4 rounded border border-amber-500 bg-amber-400"></span> Permesso dipendenti/Assenza oraria Collaboratori (L: ex L.104, S: Studio, D: Donazione, E: Elettorale)
              </div>
              <div className="flex items-center gap-2 text-xs font-bold text-gray-700">
                <span className="w-6 h-4 rounded border border-red-600 bg-red-500 flex items-center justify-center text-[10px] font-black text-white">M</span> Malattia/Maternità
              </div>
              <div className="flex items-center gap-2 text-xs font-bold text-gray-700">
                <span className="w-6 h-4 rounded border border-emerald-600 bg-emerald-500"></span> Lavoro da casa
              </div>
              <div className="flex items-center gap-2 text-xs font-bold text-gray-700">
                <span className="w-6 h-4 rounded border border-gray-700 bg-gray-600 flex items-center justify-center text-[10px] font-black text-white">X</span> Cessato / Inattivo
              </div>
            </div>
          </>
        )}
      </div>
    </>
  )}

      {/* MODALE RICHIESTA MODIFICA / ANNULLAMENTO FERIE APPROVATE PER DIPENDENTE */}
      {modifyingRequest && (
        <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-md flex items-center justify-center z-[9999] p-4 sm:p-6 no-print animate-in fade-in duration-200">
          <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-xl border border-gray-100 flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
            
            {/* Header Modale */}
            <div className="p-5 sm:p-6 border-b bg-gradient-to-r from-amber-500 via-amber-600 to-amber-700 text-white flex justify-between items-center">
              <div className="flex items-center gap-2.5">
                <Pencil className="w-5 h-5 text-amber-200" />
                <h3 className="text-lg font-black tracking-tight">Richiesta Modifica / Annullamento</h3>
              </div>
              <button
                type="button"
                onClick={() => setModifyingRequest(null)}
                className="text-white/80 hover:text-white p-1 hover:bg-white/10 rounded-full transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 sm:p-6 space-y-5 overflow-y-auto max-h-[80vh]">
              {/* Card di Riepilogo Richiesta Approvata Attuale */}
              <div className="bg-amber-50/80 border border-amber-200 p-4 rounded-2xl space-y-1 text-xs">
                <div className="font-extrabold text-amber-950 text-sm">{modifyingRequest.dipendenteName}</div>
                <div className="font-bold text-amber-900">
                  {modifyingRequest.dataInizio && modifyingRequest.dataFine && modifyingRequest.dataInizio !== modifyingRequest.dataFine
                    ? `Periodo Approvato: Dal ${formatDate(modifyingRequest.dataInizio)} al ${formatDate(modifyingRequest.dataFine)}`
                    : `Giorno Approvato: ${formatDate(modifyingRequest.dataInizio || modifyingRequest.data)}`}
                  {modifyingRequest.oraInizio && modifyingRequest.oraFine ? ` dalle ${modifyingRequest.oraInizio} alle ${modifyingRequest.oraFine}${modifyingRequest.pausaPranzo && modifyingRequest.pausaPranzoOre ? ` (esclusa p. pranzo ${modifyingRequest.pausaPranzoOre.toString().replace('.', ',')}h)` : ''}` : ''}
                </div>
                <div className="text-amber-800 font-semibold">
                  Tipo: {getTipoData(modifyingRequest.tipo, modifyingRequest.frazioneTipo, modifyingRequest.dipendenteName).label}
                </div>
              </div>

              {/* Selettore Tipo Azione: Annullamento vs Modifica */}
              <div className="space-y-2">
                <label className="block text-xs font-black text-gray-800 uppercase tracking-wider">
                  {isHR ? `Azione da applicare direttamente per ${modifyingRequest.dipendenteName}:` : "Cosa desideri richiedere all'HR?"}
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setModTipoAzione('annullamento')}
                    className={`p-3.5 rounded-2xl border text-xs font-extrabold text-center transition-all flex flex-col items-center gap-1.5 cursor-pointer ${
                      modTipoAzione === 'annullamento'
                        ? 'bg-red-600 text-white border-transparent shadow-md'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>{isHR ? "Annulla Permesso/Ferie" : "Annulla Ferie Approvate"}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setModTipoAzione('modifica')}
                    className={`p-3.5 rounded-2xl border text-xs font-extrabold text-center transition-all flex flex-col items-center gap-1.5 cursor-pointer ${
                      modTipoAzione === 'modifica'
                        ? 'bg-indigo-600 text-white border-transparent shadow-md'
                        : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                    }`}
                  >
                    <Pencil className="w-4 h-4" />
                    <span>Modifica Date / Orari</span>
                  </button>
                </div>
              </div>

              {/* Campi di Modifica se selezionato 'modifica' */}
              {modTipoAzione === 'modifica' && (
                <div className="space-y-3.5 bg-slate-50 p-4 rounded-2xl border border-slate-200 animate-in fade-in duration-200">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-gray-700 mb-1">Nuova Data Inizio *</label>
                      <input 
                        type="date"
                        value={modDataInizio}
                        onChange={e => {
                          const newStart = e.target.value;
                          setModDataInizio(newStart);
                          if (modDataFine && modDataFine < newStart) {
                            setModDataFine(newStart);
                          }
                        }}
                        className="w-full p-2.5 rounded-xl border border-slate-200 text-xs font-bold text-gray-800 bg-white outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-gray-700 mb-1">Nuova Data Fine *</label>
                      <input 
                        type="date"
                        min={modDataInizio || undefined}
                        value={modDataFine}
                        onChange={e => setModDataFine(e.target.value)}
                        className="w-full p-2.5 rounded-xl border border-slate-200 text-xs font-bold text-gray-800 bg-white outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1">Tipo Assenza</label>
                    <select
                      value={modTipo}
                      onChange={e => setModTipo(e.target.value)}
                      className="w-full p-2.5 rounded-xl border border-slate-200 text-xs font-bold text-gray-800 bg-white outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
                    >
                      <option value="ferie">Ferie</option>
                      <option value="permesso">Permesso</option>
                      <option value="malattia">Malattia</option>
                      <option value="smart">Lavora da Casa</option>
                    </select>
                  </div>
                </div>
              )}

              {/* Nota / Motivazione per HR (solo per dipendenti che inviano la richiesta) */}
              {!isHR && (
                <div>
                  <label className="block text-xs font-bold text-gray-800 mb-1 flex items-center justify-between">
                    <span>Motivazione / Nota per l'HR</span>
                    <span className="text-[10px] text-gray-400 font-normal italic">(Facoltativa)</span>
                  </label>
                  <textarea
                    placeholder={modTipoAzione === 'annullamento' ? "Spiega all'HR il motivo dell'annullamento delle ferie..." : "Spiega all'HR il motivo della modifica del periodo..."}
                    value={modMotivazione}
                    onChange={e => setModMotivazione(e.target.value)}
                    rows={3}
                    className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-gray-800 outline-none focus:ring-2 focus:ring-amber-500 resize-none"
                  />
                </div>
              )}
            </div>

            {/* Footer Modale */}
            <div className="p-4 border-t border-gray-150 flex gap-3 bg-gray-50">
              <button
                type="button"
                onClick={() => setModifyingRequest(null)}
                className="flex-1 py-3 px-4 rounded-xl border border-gray-300 text-xs font-bold text-gray-700 hover:bg-gray-100 transition cursor-pointer"
              >
                Annulla
              </button>
              <button
                type="button"
                onClick={handleSendModificationRequest}
                disabled={modLoading}
                className="flex-1 py-3 px-4 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-extrabold transition shadow-md disabled:opacity-50 cursor-pointer"
              >
                {modLoading ? "Elaborazione in corso..." : (isHR ? (modTipoAzione === 'annullamento' ? "Conferma Annullamento Diretto" : "Applica Modifica Diretta") : "Invia Richiesta all'HR")}
              </button>
            </div>

          </div>
        </div>
      )}

      {cancellationRequest && (
        <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-2xl border border-gray-100 p-6 sm:p-8 max-w-md w-full animate-in fade-in zoom-in-95 duration-200 flex flex-col gap-5">
            <div>
              <h4 className="font-extrabold text-xl text-gray-900">Annulla Richiesta Assenza</h4>
              <p className="text-xs text-gray-500 mt-1">Stai per eliminare definitivamente questa richiesta approvata o in attesa.</p>
            </div>

            <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100/50 text-xs text-gray-700 space-y-2 font-medium">
              <div><strong>Dipendente:</strong> {cancellationRequest.dipendenteName}</div>
              <div><strong>Tipo Assenza:</strong> <span className="capitalize">{getTipoData(cancellationRequest.tipo, cancellationRequest.frazioneTipo, cancellationRequest.dipendenteName).label}</span></div>
              <div>
                <strong>Periodo:</strong> {
                  (() => {
                    let cancelPeriod = cancellationRequest.dataInizio && cancellationRequest.dataFine && cancellationRequest.dataInizio !== cancellationRequest.dataFine 
                      ? `Dal ${formatDate(cancellationRequest.dataInizio)} al ${formatDate(cancellationRequest.dataFine)}` 
                      : `Il ${formatDate(cancellationRequest.dataInizio || cancellationRequest.data)}`;
                    if (cancellationRequest.oraInizio && cancellationRequest.oraFine) {
                      cancelPeriod += ` dalle ${cancellationRequest.oraInizio} alle ${cancellationRequest.oraFine}${cancellationRequest.pausaPranzo && cancellationRequest.pausaPranzoOre ? ` (esclusa p. pranzo ${cancellationRequest.pausaPranzoOre.toString().replace('.', ',')}h)` : ''}`;
                    } else if (cancellationRequest.frazioneTipo === 'mattina' || cancellationRequest.tipo === 'mattina') {
                      cancelPeriod += ' (mattina)';
                    } else if (cancellationRequest.frazioneTipo === 'pomeriggio' || cancellationRequest.tipo === 'pomeriggio') {
                      cancelPeriod += ' (pomeriggio)';
                    } else if (cancellationRequest.frazioneTipo === 'giornata') {
                      cancelPeriod += ' (giornata intera)';
                    }
                    return cancelPeriod;
                  })()
                }
              </div>
              <div><strong>Stato Attuale:</strong> <span className="font-bold">{cancellationRequest.stato}</span></div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-gray-500 ml-1">Motivazione annullamento (facoltativa, inviata via email)</label>
              <textarea
                placeholder="Es: Modifica della pianificazione o delle attività concordata con il dipendente..."
                value={cancellationReason}
                onChange={e => setCancellationReason(e.target.value)}
                className="w-full p-3 border-none bg-gray-50 focus:bg-gray-100 rounded-xl text-xs outline-none focus:ring-2 focus:ring-red-500 shadow-inner font-semibold text-gray-700 min-h-[90px] resize-none"
              />
            </div>

            <div className="flex gap-3">
              <button 
                onClick={() => {
                  setCancellationRequest(null);
                  setCancellationReason('');
                }}
                disabled={cancellationLoading}
                className="flex-1 py-3 px-4 rounded-xl border border-gray-200 text-xs font-bold text-gray-655 hover:bg-gray-50 transition active:scale-95 disabled:opacity-50"
              >
                Annulla
              </button>
              <button 
                onClick={handleCancelApprovedLeave}
                disabled={cancellationLoading}
                className="flex-1 py-3 px-4 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold transition active:scale-95 disabled:opacity-50 shadow-md shadow-red-200"
              >
                {cancellationLoading ? 'Elaborazione...' : 'Elimina Assenza'}
              </button>
            </div>
          </div>
        </div>
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
      {/* MODALE DI ANALISI GRAFICA E TREND RISORSA */}
      <ResourceAnalyticsModal
        isOpen={isAnalyticsOpen}
        onClose={() => setIsAnalyticsOpen(false)}
        resource={analyticsResource}
        allRequests={hrRichieste}
        dipendenti={dipendenti}
        onEnsureYearLoaded={ensureYearLoaded}
      />
    </div>
  );
});

export default function Ferie() {
  const { isHR, isAdmin, myAssociatedName, dipendenti } = useAuth();
  return (
    <FerieContent 
      isHR={!!isHR} 
      isAdmin={!!isAdmin} 
      myAssociatedName={myAssociatedName || ''} 
      dipendenti={dipendenti} 
    />
  );
}
