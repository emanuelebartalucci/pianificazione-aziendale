import { useState, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useAuth, isTechnicalUser, type Dipendente } from '../contexts/AuthContext';
import { db } from '../services/firebase';
import { collection, doc, writeBatch, addDoc, updateDoc, deleteDoc, query, where, getDocs, onSnapshot } from 'firebase/firestore';
import { Users, ChevronLeft, ChevronRight, ChevronDown, Save, Download, ZoomIn, ZoomOut, Trash2, Plus, RefreshCw, CalendarDays, FileText, X, UserCheck, MoveVertical, Clock, Pencil, ExternalLink, Calendar, AlertTriangle } from 'lucide-react';
import { getWeekNumber, getStartOfWeek, addDays, isItalianHoliday, getDefaultWeekRange } from '../utils/date';

import ConfirmModal from '../components/ConfirmModal';
import { PianificazioneModal } from '../components/PianificazioneModal';
import { ResourceAvailabilityModal } from '../components/ResourceAvailabilityModal';
import { addPendingNotification, getPendingNotifications, clearPendingNotifications, sendAllPendingNotifications } from '../utils/pendingNotifications';
import { isCollaboratore, isSoci } from './Impostazioni';
import { TIPOLOGIA_COLORS } from '../utils/commesseIniziali';
import { createUserNotification } from '../utils/userNotificationService';

const MACRO_AREE = ['Disegnatori', 'Ingegneria', 'Sicurezza Cantieri', 'Consulenza Sicurezza', 'Amministrazione'] as const;
type MacroArea = typeof MACRO_AREE[number];

const areNamesEqual = (n1?: string | null, n2?: string | null): boolean => {
  if (!n1 || !n2) return false;
  const clean1 = n1.toLowerCase().trim().replace(/\s+/g, ' ');
  const clean2 = n2.toLowerCase().trim().replace(/\s+/g, ' ');
  if (clean1 === clean2) return true;
  const w1 = clean1.split(' ').sort().join(' ');
  const w2 = clean2.split(' ').sort().join(' ');
  return w1 === w2;
};


interface Assegnazione {
  commessaId: string;
  commessaName: string;
  percentuale: number;
  colore: string;
  giorni?: string[];
}

interface WeekInfo {
  id: string;
  label: string;
  sub: string;
  dateObj?: Date;
}

interface WeekOption {
  id: string;
  mondayStr: string;
  sundayStr: string;
  label: string;
  weekNum: number;
  year: number;
}

const generateWeeksExtended = (baseDate: Date, numWeeks: number): WeekInfo[] => {
  const weeks: WeekInfo[] = [];
  let currentStart = getStartOfWeek(baseDate);
  for(let i = 0; i < numWeeks; i++) {
    const end = addDays(currentStart, 4); // Mon to Fri
    const wkNum = getWeekNumber(currentStart);
    weeks.push({
      id: `${currentStart.getFullYear()}-W${wkNum}`,
      label: `Sett. ${wkNum}`,
      sub: `${currentStart.getDate()}/${currentStart.getMonth() + 1} - ${end.getDate()}/${end.getMonth() + 1}`,
      dateObj: new Date(currentStart)
    });
    currentStart = addDays(currentStart, 7);
  }
  return weeks;
};

const getWeeksSpannedByDates = (startDateStr: string, endDateStr: string): string[] => {
  const list: string[] = [];
  const start = new Date(startDateStr);
  const end = new Date(endDateStr);
  
  let curr = getStartOfWeek(start);
  const endMonday = getStartOfWeek(end);
  
  while (curr <= endMonday) {
    const wkNum = getWeekNumber(curr);
    list.push(`${curr.getFullYear()}-W${wkNum}`);
    curr = addDays(curr, 7);
  }
  return list;
};

const getCoveredDaysInWeek = (wkId: string, startDateStr: string, endDateStr: string): number => {
  const parts = wkId.split('-W');
  if (parts.length !== 2) return 0;
  const year = parseInt(parts[0]);
  const week = parseInt(parts[1]);

  const simple = new Date(year, 0, 4);
  const dayOfWeek = simple.getDay();
  const dayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const firstMonday = new Date(simple.setDate(simple.getDate() + dayOffset));
  const monday = new Date(firstMonday.setDate(firstMonday.getDate() + (week - 1) * 7));

  let covered = 0;
  const startLimit = new Date(startDateStr);
  const endLimit = new Date(endDateStr);
  startLimit.setHours(0, 0, 0, 0);
  endLimit.setHours(0, 0, 0, 0);

  for (let i = 0; i < 5; i++) {
    const dObj = new Date(monday);
    dObj.setDate(monday.getDate() + i);
    dObj.setHours(0, 0, 0, 0);

    if (dObj >= startLimit && dObj <= endLimit) {
      covered++;
    }
  }
  return covered;
};

const formatCommDate = (dateStr?: string): string => {
  if (!dateStr) return 'N/D';
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return dateStr;
};

// Calcola il lunedì di una weekId (es. "2026-W30") come oggetto Date
const getWeekMondayDate = (wkId: string): Date | null => {
  const parts = wkId.split('-W');
  if (parts.length !== 2) return null;
  const year = parseInt(parts[0]);
  const week = parseInt(parts[1]);
  const simple = new Date(year, 0, 4);
  const dow = simple.getDay();
  const offset = dow === 0 ? -6 : 1 - dow;
  const firstMonday = new Date(simple);
  firstMonday.setDate(simple.getDate() + offset);
  const monday = new Date(firstMonday);
  monday.setDate(firstMonday.getDate() + (week - 1) * 7);
  return monday;
};

// Formatta una Date come "D Mmm" o "D Mmm YYYY" in italiano
const formatShortDate = (d: Date | null, includeYear: boolean = false): string => {
  if (!d) return '';
  const months = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];
  const base = `${d.getDate()} ${months[d.getMonth()]}`;
  return includeYear ? `${base} ${d.getFullYear()}` : base;
};


export default function PianificazionePersonale() {
  const { 
    isAdmin = false, 
    dipendenti = [], 
    commesse = [], 
    coordinatori = [], 
    user = null, 
    myAssociatedName = '', 
    userEmail = '',
    assegnazioni: globalAssignments = {},
    approvedLeaves = [],
    richiesteDisegnatori: globalRichiesteDisegnatori = [],
    loadPlanningData,
    refreshDataIfStale
  } = useAuth();

  // Aree coordinate dall'utente loggato (fonte autorevole: collezione coordinatori)
  const myCoordinatedAreas = useMemo((): string[] => {
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

  // Sincronizzazione in tempo reale delle sole richieste di personale in attesa (filtro mirato alla fonte)
  const [localRichiesteDisegnatori, setLocalRichiesteDisegnatori] = useState<any[]>([]);
  const [isLoadedReqs, setIsLoadedReqs] = useState(false);

  useEffect(() => {
    if (!user) return;
    const qReq = query(collection(db, 'richieste_disegnatori'), where('stato', '==', 'in_attesa'));
    const unsub = onSnapshot(qReq, (snap) => {
      const list: any[] = [];
      snap.forEach(docSnap => {
        list.push({ id: docSnap.id, ...docSnap.data() });
      });
      setLocalRichiesteDisegnatori(list);
      setIsLoadedReqs(true);
    });
    return () => unsub();
  }, [user]);

  const richiesteDisegnatori = isLoadedReqs ? localRichiesteDisegnatori : globalRichiesteDisegnatori.filter(r => r.stato === 'in_attesa');

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

    // 1. Il richiedente NON può MAI approvare o rifiutare le proprie richieste
    if (isSelfRequester(r)) return false;

    const isInserimentoAltraCommessa = r.fonte === 'altre_commesse';

    if (isInserimentoAltraCommessa) {
      // 2. Se è una richiesta di inserimento da "Altre Commesse", la gestisce il Responsabile o PM della commessa target
      const commObj = commesse.find(c => 
        (r.commessaId && c.id === r.commessaId) || 
        (c.nome && (c.nome === r.commessaName || c.nome === r.commessaNome))
      );

      const commResp = (r.commessaResponsabile || commObj?.responsabile || '').toLowerCase().trim();
      const commPM = r.commessaPM || commObj?.pm;

      const myDip = dipendenti.find(d => 
        areNamesEqual(d.nome, myAssociatedName) || 
        (d.email && userEmail && d.email.toLowerCase() === userEmail.toLowerCase())
      );

      const isCommessaManager = Boolean(
        (commResp && (
          areNamesEqual(commResp, myAssociatedName) || 
          (userEmail && commResp.includes(userEmail.split('@')[0])) ||
          (myDip?.nome && areNamesEqual(commResp, myDip.nome))
        )) ||
        (commPM && (
          typeof commPM === 'string' 
            ? (areNamesEqual(commPM, myAssociatedName) || (userEmail && commPM.toLowerCase().includes(userEmail.split('@')[0])) || (myDip?.nome && areNamesEqual(commPM, myDip.nome)))
            : Array.isArray(commPM) && commPM.some((pmName: string) => areNamesEqual(pmName, myAssociatedName) || (userEmail && pmName.toLowerCase().includes(userEmail.split('@')[0])) || (myDip?.nome && areNamesEqual(pmName, myDip.nome)))
        ))
      );

      return isCommessaManager;
    } else {
      // 3. Richiesta ordinaria per un'area (es. Disegnatori): la gestisce ESCLUSIVAMENTE il coordinatore dell'area richiesta
      const rArea = (r.area || 'Disegnatori').toLowerCase().trim();
      const isCoordinated = myCoordinatedAreas.some(a => (a || '').toLowerCase().trim() === rArea);
      return isCoordinated;
    }
  };

  useEffect(() => {
    loadPlanningData?.();
    refreshDataIfStale();
  }, [loadPlanningData]);
  const [commessaSearchText, setCommessaSearchText] = useState('');
  const [isCommessaDropdownOpen, setIsCommessaDropdownOpen] = useState(false);
  const [addCommessaSearchText, setAddCommessaSearchText] = useState('');
  const [isAddCommessaDropdownOpen, setIsAddCommessaDropdownOpen] = useState(false);
  const [resourceSearchText, setResourceSearchText] = useState('');
  const [isResourceDropdownOpen, setIsResourceDropdownOpen] = useState(false);
  const [timelineWeeks, setTimelineWeeks] = useState<WeekInfo[]>([]); // weeks for the load grid
  const [gridBaseDate, setGridBaseDate] = useState<Date>(new Date());
  const [zoomWeeks, setZoomWeeks] = useState<number>(8);
  
  const weekColumnMinWidth = useMemo(() => {
    // Estimating remaining width of a container on standard screen (approx 900px)
    const containerWidth = 900;
    const calculated = Math.floor(containerWidth / zoomWeeks);
    return `${Math.max(35, Math.min(150, calculated))}px`;
  }, [zoomWeeks]);

  const isNarrow = useMemo(() => parseInt(weekColumnMinWidth) < 80, [weekColumnMinWidth]);
  const isUltraNarrow = useMemo(() => parseInt(weekColumnMinWidth) < 50, [weekColumnMinWidth]);
  
  const [dbAssignments, setDbAssignments] = useState<Record<string, Assegnazione[]>>({});
  const [assignments, setAssignments] = useState<Record<string, Assegnazione[]>>({});
  const [isDirty, setIsDirty] = useState(false);
  const [draftNotifications, setDraftNotifications] = useState<{
    dipendenteNome: string;
    email: string;
    weekLabel: string;
    description: string;
  }[]>([]);
  const [loadingAssignments, setLoadingAssignments] = useState(true);
  const [savingChanges, setSavingChanges] = useState(false);
  const plannerContainerRef = useRef<HTMLDivElement>(null);
  
  // Selection states for bulk allocator
  const [activeTab, setActiveTab] = useState<'commessa' | 'risorsa' | 'sostituisci'>('commessa');
  const [selectedCommessaId, setSelectedCommessaId] = useState('');
  const [selectedResourceNames, setSelectedResourceNames] = useState<string[]>([]);
  const [resourcePercentages] = useState<Record<string, string>>({});
  const [savingAllocations, _setSavingAllocations] = useState(false);
  const [allocAction, setAllocAction] = useState<'assegna' | 'rimuovi' | 'sostituisci'>('assegna');
  const [sourceResource, setSourceResource] = useState('');
  const [targetResource, setTargetResource] = useState('');

  const selectableWeekOptions = useMemo(() => {
    const options: WeekOption[] = [];
    const today = new Date();
    let currentMonday = getStartOfWeek(addDays(today, -84)); // 12 settimane prima

    const months = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];

    for (let i = 0; i < 260; i++) {
      const sunday = addDays(currentMonday, 6);
      const wkNum = getWeekNumber(currentMonday);
      const y = currentMonday.getFullYear();

      const mY = currentMonday.getFullYear();
      const mM = String(currentMonday.getMonth() + 1).padStart(2, '0');
      const mD = String(currentMonday.getDate()).padStart(2, '0');
      const mondayStr = `${mY}-${mM}-${mD}`;

      const sY = sunday.getFullYear();
      const sM = String(sunday.getMonth() + 1).padStart(2, '0');
      const sD = String(sunday.getDate()).padStart(2, '0');
      const sundayStr = `${sY}-${sM}-${sD}`;

      const startFormatted = `${currentMonday.getDate()} ${months[currentMonday.getMonth()]}`;
      const endFormatted = `${sunday.getDate()} ${months[sunday.getMonth()]} ${sunday.getFullYear()}`;

      options.push({
        id: `${y}-W${wkNum}`,
        mondayStr,
        sundayStr,
        label: `Settimana ${wkNum} (${startFormatted} - ${endFormatted})`,
        weekNum: wkNum,
        year: y
      });

      currentMonday = addDays(currentMonday, 7);
    }

    return options;
  }, []);



  const currentWeekOpt = useMemo(() => {
    const todayMon = getStartOfWeek(new Date());
    const todayMonStr = `${todayMon.getFullYear()}-${String(todayMon.getMonth()+1).padStart(2,'0')}-${String(todayMon.getDate()).padStart(2,'0')}`;
    return selectableWeekOptions.find(o => o.mondayStr === todayMonStr) || selectableWeekOptions[12] || selectableWeekOptions[0];
  }, [selectableWeekOptions]);

  const [selectedStartWeekId, setSelectedStartWeekId] = useState<string>(() => currentWeekOpt.id);
  const [selectedEndWeekId, setSelectedEndWeekId] = useState<string>(() => {
    const idx = selectableWeekOptions.findIndex(o => o.id === currentWeekOpt.id);
    const endIdx = idx !== -1 && idx + 3 < selectableWeekOptions.length ? idx + 3 : idx;
    return selectableWeekOptions[endIdx]?.id || currentWeekOpt.id;
  });

  const [allocDataInizio, setAllocDataInizio] = useState('');
  const [allocDataFine, setAllocDataFine] = useState('');

  // Handler per cambio data da Input Calendario (<input type="date">)
  const handleDateInputChange = (dateStr: string, isStart: boolean) => {
    if (!dateStr) return;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return;
    const monday = getStartOfWeek(d);
    const mY = monday.getFullYear();
    const mM = String(monday.getMonth() + 1).padStart(2, '0');
    const mD = String(monday.getDate()).padStart(2, '0');
    const monStr = `${mY}-${mM}-${mD}`;

    const matchedOpt = selectableWeekOptions.find(o => o.mondayStr === monStr);
    if (matchedOpt) {
      if (isStart) {
        setSelectedStartWeekId(matchedOpt.id);
        const startIdx = selectableWeekOptions.findIndex(o => o.id === matchedOpt.id);
        const endIdx = selectableWeekOptions.findIndex(o => o.id === selectedEndWeekId);
        if (startIdx > endIdx) {
          setSelectedEndWeekId(matchedOpt.id);
        }
      } else {
        const startIdx = selectableWeekOptions.findIndex(o => o.id === selectedStartWeekId);
        const endIdx = selectableWeekOptions.findIndex(o => o.id === matchedOpt.id);
        if (endIdx < startIdx) {
          setSelectedEndWeekId(selectedStartWeekId);
        } else {
          setSelectedEndWeekId(matchedOpt.id);
        }
      }
    }
  };

  // Sincronizza allocDataInizio e allocDataFine con le settimane selezionate
  useEffect(() => {
    const startOpt = selectableWeekOptions.find(o => o.id === selectedStartWeekId);
    const endOpt = selectableWeekOptions.find(o => o.id === selectedEndWeekId);

    if (startOpt && endOpt) {
      setAllocDataInizio(startOpt.mondayStr);
      setAllocDataFine(endOpt.sundayStr);
    }
  }, [selectedStartWeekId, selectedEndWeekId, selectableWeekOptions]);

  const lastSyncedCommessaIdRef = useRef<string | null>(null);

  // Pre-selezione automatica dell'intervallo settimane SOLO al primo cambio/selezione della commessa
  useEffect(() => {
    if (selectedCommessaId) {
      if (selectedCommessaId === lastSyncedCommessaIdRef.current) return;
      const comm = commesse.find(c => c.id === selectedCommessaId);
      if (!comm) return; // Se commesse non è ancora caricato, attende

      lastSyncedCommessaIdRef.current = selectedCommessaId;

      if (comm.dataInizio || comm.dataFine) {
        if (comm.dataInizio) {
          const commStartMon = getStartOfWeek(new Date(comm.dataInizio));
          const startMonStr = `${commStartMon.getFullYear()}-${String(commStartMon.getMonth()+1).padStart(2,'0')}-${String(commStartMon.getDate()).padStart(2,'0')}`;
          const startMatch = selectableWeekOptions.find(o => o.mondayStr === startMonStr);
          if (startMatch) setSelectedStartWeekId(startMatch.id);
        }
        if (comm.dataFine) {
          const commEndMon = getStartOfWeek(new Date(comm.dataFine));
          const commEndSun = addDays(commEndMon, 6);
          const endSunStr = `${commEndSun.getFullYear()}-${String(commEndSun.getMonth()+1).padStart(2,'0')}-${String(commEndSun.getDate()).padStart(2,'0')}`;
          const endMatch = selectableWeekOptions.find(o => o.sundayStr === endSunStr);
          if (endMatch) setSelectedEndWeekId(endMatch.id);
        }
      }
    } else {
      lastSyncedCommessaIdRef.current = null;
    }
  }, [selectedCommessaId, commesse, selectableWeekOptions]);

  const [toast, setToast] = useState<{ message: string; type: 'success' | 'warning' | 'error' | 'info' } | null>(null);
  const [showMySentRequestsModal, setShowMySentRequestsModal] = useState(false);
  const [tableHeight, setTableHeight] = useState<number>(680);
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const heightTextRef = useRef<HTMLSpanElement>(null);
  const animationFrameRef = useRef<number | null>(null);

  const [editingSentRequest, setEditingSentRequest] = useState<any | null>(null);

  // Filtra le richieste inviate dall'utente corrente (quelle in attesa/in lavorazione sono SEMPRE mostrate, per le risolte vale il filtro <= 30 gg)
  const myRecentSentRequests = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const thirtyDaysAgoIso = thirtyDaysAgo.toISOString().slice(0, 10);

    return (richiesteDisegnatori || [])
      .filter((r: any) => {
        if (!isSelfRequester(r)) return false;

        // Le richieste ancora in lavorazione ("in_attesa") vengano SEMPRE mostrate a prescindere dalla data!
        if (r.stato === 'in_attesa') return true;

        // Per le richieste già approvate o rifiutate, applica il filtro dei 30 giorni
        const refDate = r.createdAt ? r.createdAt.slice(0, 10) : (r.dataFine || r.dataInizio || '');
        if (!refDate) return true;
        return refDate >= thirtyDaysAgoIso;
      })
      .sort((a: any, b: any) => {
        const timeA = a.createdAt ? new Date(a.createdAt).getTime() : new Date(a.dataFine || a.dataInizio || 0).getTime();
        const timeB = b.createdAt ? new Date(b.createdAt).getTime() : new Date(b.dataFine || b.dataInizio || 0).getTime();
        return timeB - timeA;
      });
  }, [richiesteDisegnatori, userEmail, myAssociatedName]);

  const handleDeleteSentRequest = async (req: any) => {
    const isPending = req.stato === 'in_attesa';
    const actionTitle = isPending ? "Annulla Richiesta Personale" : "Elimina dallo Storico";
    const actionMessage = isPending 
      ? `Sei sicuro di voler annullare e cancellare la richiesta in lavorazione per la commessa "${req.commessaName}"?`
      : `Sei sicuro di voler rimuovere definitivamente questa richiesta dallo storico?`;

    setConfirmConfig({
      isOpen: true,
      title: actionTitle,
      message: actionMessage,
      type: "warning",
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, 'richieste_disegnatori', req.id));
          showToast(isPending ? "Richiesta annullata e rimossa con successo." : "Richiesta eliminata dallo storico.", "success");
          setConfirmConfig(prev => ({ ...prev, isOpen: false }));
        } catch (err) {
          console.error("Errore eliminazione richiesta:", err);
          showToast("Errore durante l'eliminazione della richiesta.", "error");
        }
      }
    });
  };

  const handleStartEditSentRequest = (req: any) => {
    if (req.stato !== 'in_attesa') {
      showToast("Puoi modificare solo le richieste che sono ancora in lavorazione.", "warning");
      return;
    }
    setEditingSentRequest(req);
    setReqCommessaId(req.commessaId || '');
    setReqAreaTarget(req.area || 'Disegnatori');
    setReqDataInizio(req.dataInizio || '');
    setReqDataFine(req.dataFine || '');
    setReqPercentuale(Number(req.percentuale) || 100);
    setReqPreferredResource(req.risorsaPreferita || '');
    setReqNota(req.nota || '');
  };

  const handleSaveUpdateSentRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingSentRequest) return;

    try {
      const commObj = commesse.find(c => c.id === reqCommessaId);
      const commName = commObj ? commObj.nome : editingSentRequest.commessaName;

      const reqRef = doc(db, 'richieste_disegnatori', editingSentRequest.id);
      await updateDoc(reqRef, {
        commessaId: reqCommessaId,
        commessaName: commName,
        commessaNome: commName,
        area: reqAreaTarget,
        dataInizio: reqDataInizio,
        dataFine: reqDataFine,
        percentuale: Number(reqPercentuale),
        risorsaPreferita: reqPreferredResource || '',
        nota: reqNota,
        updatedAt: new Date().toISOString()
      });

      showToast("Richiesta modificata con successo!", "success");
      setEditingSentRequest(null);
    } catch (err) {
      console.error("Errore aggiornamento richiesta:", err);
      showToast("Errore durante l'aggiornamento della richiesta.", "error");
    }
  };

  const handleMouseDownResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startClientY = e.clientY;
    const startScrollY = window.scrollY;
    const startHeight = tableContainerRef.current ? tableContainerRef.current.clientHeight : tableHeight;
    let currentHeight = startHeight;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaViewportY = moveEvent.clientY - startClientY;
      const deltaScrollY = window.scrollY - startScrollY;
      const totalDelta = deltaViewportY + deltaScrollY;

      const newHeight = Math.max(300, Math.min(3000, startHeight + totalDelta));
      currentHeight = newHeight;

      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }

      animationFrameRef.current = requestAnimationFrame(() => {
        if (tableContainerRef.current) {
          tableContainerRef.current.style.maxHeight = `${currentHeight}px`;
        }
        if (heightTextRef.current) {
          heightTextRef.current.textContent = `Trascina per ridimensionare altezza (${currentHeight}px)`;
        }

        const viewportHeight = window.innerHeight;
        const cursorY = moveEvent.clientY;
        if (cursorY > viewportHeight - 50) {
          window.scrollBy(0, 8);
        } else if (cursorY < 50) {
          window.scrollBy(0, -8);
        }
      });
    };

    const handleMouseUp = () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      setTableHeight(currentHeight);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  // Pending notifications states
  const [pendingNotificationsCount, setPendingNotificationsCount] = useState(0);
  const [sendingNotifications, setSendingNotifications] = useState(false);

  const [commesseToRemove, setCommesseToRemove] = useState<string[]>([]);

  const urlParamsHandledRef = useRef(false);

  // Gestione parametri URL per il collegamento da altre pagine (es. Commesse.tsx)
  // Supporta: ?tab=commessa&commessaId=X&startWeek=2026-W32&endWeek=2026-W45
  //           ?tab=risorsa&risorsa=Nome+Cognome&startWeek=2026-W32&endWeek=2026-W45
  useEffect(() => {
    if (urlParamsHandledRef.current) return;
    if (!commesse.length || !selectableWeekOptions.length) return;
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get('tab');
    const commessaIdParam = params.get('commessaId');
    const risorsaParam = params.get('risorsa');
    const startWeekParam = params.get('startWeek');
    const endWeekParam = params.get('endWeek');
    // legacy: weekId singolo
    const weekIdParam = params.get('weekId');

    if (!tabParam && !commessaIdParam && !risorsaParam && !startWeekParam && !endWeekParam && !weekIdParam) {
      urlParamsHandledRef.current = true;
      return;
    }

    urlParamsHandledRef.current = true;

    const applyWeeks = () => {
      const startId = startWeekParam || weekIdParam || null;
      const endId = endWeekParam || weekIdParam || null;
      if (startId) {
        const matched = selectableWeekOptions.find(o => o.id === startId);
        if (matched) setSelectedStartWeekId(matched.id);
      }
      if (endId) {
        const matched = selectableWeekOptions.find(o => o.id === endId);
        if (matched) setSelectedEndWeekId(matched.id);
      }
    };

    if (tabParam === 'commessa' && commessaIdParam) {
      setActiveTab('commessa');
      setSelectedCommessaId(commessaIdParam);
      lastSyncedCommessaIdRef.current = commessaIdParam; // Segna come già sincronizzata per evitare sovrascritture successive
      const commObj = commesse.find(c => c.id === commessaIdParam);
      if (commObj) setCommessaSearchText(commObj.nome);
      applyWeeks();
      setTimeout(() => {
        plannerContainerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    } else if (tabParam === 'risorsa' && risorsaParam) {
      setActiveTab('risorsa');
      const decodedRes = decodeURIComponent(risorsaParam);
      setSelectedResourceForTab(decodedRes);
      setResourceSearchText(decodedRes);
      applyWeeks();
      setTimeout(() => {
        plannerContainerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    }
  }, [commesse, selectableWeekOptions]);

  // Tooltip galleggiante intelligente fuori dal flusso (Portal) per evitare tagli o overflow
  const [hoveredCellTooltip, setHoveredCellTooltip] = useState<{
    rect: DOMRect;
    dipNome: string;
    wkLabel: string;
    list: { commessaName: string; percentuale: number }[];
    leaves: { giorno: string; dettagli: string }[];
    isFullLeave: boolean;
  } | null>(null);

  // Auto-cleaner per eliminare automaticamente le assegnazioni residue su risorse in ferie per l'intera settimana
  // (Disattivato in useEffect per evitare loop continui di re-render)

  // Stato per la modale di conferma
  const [confirmConfig, setConfirmConfig] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    type?: 'danger' | 'warning' | 'info';
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
    type: 'danger'
  });

  // =====================================================================
  // SOTTO-PERIODI: stato espansione cards nei pannelli di gestione
  // =====================================================================
  const [expandedRisorseCommessa, setExpandedRisorseCommessa] = useState<Set<string>>(new Set());
  const [expandedCommessaRisorsa, setExpandedCommessaRisorsa] = useState<Set<string>>(new Set());

  const toggleRisorsaExpanded = (nome: string) => {
    setExpandedRisorseCommessa(prev => {
      const next = new Set(prev);
      if (next.has(nome)) next.delete(nome);
      else next.add(nome);
      return next;
    });
  };

  const toggleCommessaExpanded = (id: string) => {
    setExpandedCommessaRisorsa(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Raggruppa settimane consecutive con la stessa percentuale in "sotto-periodi"
  const computeSubperiodsPage = (
    percentuali: Record<string, number>,
    allWeekIds: string[]
  ): { weekIds: string[]; pct: number; label: string }[] => {
    const relevant = allWeekIds.filter(wkId => wkId in percentuali);
    if (relevant.length === 0) return [];

    const periods: { weekIds: string[]; pct: number; label: string }[] = [];
    let group: string[] = [relevant[0]];
    let curPct = percentuali[relevant[0]];

    const buildLabel = (g: string[]): string => {
      const sWk = g[0].split('-W')[1];
      const eWk = g[g.length - 1].split('-W')[1];
      const monday = getWeekMondayDate(g[0]);
      const friday = getWeekMondayDate(g[g.length - 1]);
      if (friday) friday.setDate(friday.getDate() + 4);

      let dateRange = '';
      if (monday && friday) {
        if (monday.getFullYear() === friday.getFullYear()) {
          dateRange = `${formatShortDate(monday)} – ${formatShortDate(friday)} ${friday.getFullYear()}`;
        } else {
          dateRange = `${formatShortDate(monday, true)} – ${formatShortDate(friday, true)}`;
        }
      }

      if (g.length === 1) return `Sett. ${sWk} (${dateRange})`;
      return `Sett. ${sWk} → ${eWk}  ·  ${dateRange}`;
    };

    for (let i = 1; i < relevant.length; i++) {
      const wkId = relevant[i];
      const pct = percentuali[wkId];
      const prevIdx = allWeekIds.indexOf(relevant[i - 1]);
      const currIdx = allWeekIds.indexOf(wkId);
      const consecutive = currIdx === prevIdx + 1;

      if (pct === curPct && consecutive) {
        group.push(wkId);
      } else {
        periods.push({ weekIds: [...group], pct: curPct, label: buildLabel(group) });
        group = [wkId];
        curPct = pct;
      }
    }
    periods.push({ weekIds: [...group], pct: curPct, label: buildLabel(group) });
    return periods;
  };

  const renderWeekPeriodSelector = () => {
    const startOpt = selectableWeekOptions.find(o => o.id === selectedStartWeekId);
    const endOpt = selectableWeekOptions.find(o => o.id === selectedEndWeekId);
    const targetWeekIds = (allocDataInizio && allocDataFine) ? getWeeksSpannedByDates(allocDataInizio, allocDataFine) : [];

    return (
      <div className="bg-white/90 p-4 rounded-2xl border border-indigo-100/80 shadow-sm flex flex-col gap-3 w-full">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-indigo-100 pb-2.5">
          <label className="text-xs font-black text-indigo-950 uppercase tracking-wider flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-indigo-600" />
            <span>Periodo Lavoro (Settimana per Settimana)</span>
          </label>

          {/* Quick Presets */}
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                setSelectedStartWeekId(currentWeekOpt.id);
                setSelectedEndWeekId(currentWeekOpt.id);
              }}
              className="px-2.5 py-1 text-[10.5px] font-extrabold bg-indigo-50 hover:bg-indigo-100 text-indigo-750 rounded-lg transition cursor-pointer"
            >
              Questa Settimana
            </button>
            <button
              type="button"
              onClick={() => {
                const idx = selectableWeekOptions.findIndex(o => o.id === currentWeekOpt.id);
                setSelectedStartWeekId(currentWeekOpt.id);
                if (idx !== -1 && idx + 1 < selectableWeekOptions.length) {
                  setSelectedEndWeekId(selectableWeekOptions[idx + 1].id);
                }
              }}
              className="px-2.5 py-1 text-[10.5px] font-extrabold bg-indigo-50 hover:bg-indigo-100 text-indigo-750 rounded-lg transition cursor-pointer"
            >
              Prossime 2 Sett.
            </button>
            <button
              type="button"
              onClick={() => {
                const idx = selectableWeekOptions.findIndex(o => o.id === currentWeekOpt.id);
                setSelectedStartWeekId(currentWeekOpt.id);
                if (idx !== -1 && idx + 3 < selectableWeekOptions.length) {
                  setSelectedEndWeekId(selectableWeekOptions[idx + 3].id);
                }
              }}
              className="px-2.5 py-1 text-[10.5px] font-extrabold bg-indigo-50 hover:bg-indigo-100 text-indigo-750 rounded-lg transition cursor-pointer"
            >
              Prossime 4 Sett.
            </button>
            <button
              type="button"
              onClick={() => {
                const idx = selectableWeekOptions.findIndex(o => o.id === currentWeekOpt.id);
                setSelectedStartWeekId(currentWeekOpt.id);
                if (idx !== -1 && idx + 7 < selectableWeekOptions.length) {
                  setSelectedEndWeekId(selectableWeekOptions[idx + 7].id);
                }
              }}
              className="px-2.5 py-1 text-[10.5px] font-extrabold bg-indigo-50 hover:bg-indigo-100 text-indigo-750 rounded-lg transition cursor-pointer"
            >
              Prossime 8 Sett.
            </button>
          </div>

          <div className="text-[11px] font-bold text-indigo-700 bg-indigo-50/80 px-2.5 py-1 rounded-lg border border-indigo-100 flex items-center gap-1.5 shrink-0">
            <span>💡 Scegliendo qualsiasi giorno, viene considerata l'intera settimana</span>
          </div>
        </div>

        {/* SELEZIONE DA CALENDARIO DATE CON EVIDENZA SETTIMANA */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-white/90 p-4 rounded-2xl border border-indigo-100 shadow-xs">
          <div>
            <label className="block text-[10px] font-black text-indigo-900 uppercase tracking-wider mb-1.5 ml-0.5">
              📅 Data Inizio (Scegli da Calendario)
            </label>
            <input
              type="date"
              value={allocDataInizio}
              onChange={e => handleDateInputChange(e.target.value, true)}
              className="w-full p-2.5 border border-indigo-200 bg-indigo-50/30 rounded-xl text-xs font-black text-indigo-950 outline-none focus:ring-2 focus:ring-indigo-500 shadow-2xs cursor-pointer"
            />
            {startOpt && (
              <div className="mt-2 p-2 bg-indigo-50/80 rounded-xl border border-indigo-100 flex items-center gap-2">
                <span className="text-xs">📌</span>
                <div className="flex flex-col">
                  <span className="text-[9.5px] font-black text-indigo-600 uppercase tracking-wider">Settimana di Inizio Riferimento</span>
                  <span className="text-xs font-black text-indigo-950">{startOpt.label}</span>
                </div>
              </div>
            )}
          </div>

          <div>
            <label className="block text-[10px] font-black text-indigo-900 uppercase tracking-wider mb-1.5 ml-0.5">
              📅 Data Fine (Scegli da Calendario)
            </label>
            <input
              type="date"
              min={allocDataInizio || undefined}
              value={allocDataFine}
              onChange={e => handleDateInputChange(e.target.value, false)}
              className="w-full p-2.5 border border-indigo-200 bg-indigo-50/30 rounded-xl text-xs font-black text-indigo-950 outline-none focus:ring-2 focus:ring-indigo-500 shadow-2xs cursor-pointer"
            />
            {endOpt && (
              <div className="mt-2 p-2 bg-indigo-50/80 rounded-xl border border-indigo-100 flex items-center gap-2">
                <span className="text-xs">📌</span>
                <div className="flex flex-col">
                  <span className="text-[9.5px] font-black text-indigo-600 uppercase tracking-wider">Settimana di Fine Riferimento</span>
                  <span className="text-xs font-black text-indigo-950">{endOpt.label}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Dynamic Summary Banner */}
        {startOpt && endOpt && (
          <div className="flex flex-wrap items-center justify-between gap-2 bg-indigo-50/80 px-3 py-2 rounded-xl border border-indigo-100 text-xs font-bold text-indigo-900 mt-0.5">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-indigo-600 animate-pulse"></span>
              <span>
                Durata Selezionata: <strong className="text-indigo-700 font-extrabold">{targetWeekIds.length} {targetWeekIds.length === 1 ? 'settimana' : 'settimane'}</strong>
              </span>
            </div>
            <div className="text-[11px] text-indigo-700 font-semibold">
              (da Lun {formatCommDate(startOpt.mondayStr)} a Dom {formatCommDate(endOpt.sundayStr)})
            </div>
          </div>
        )}
      </div>
    );
  };

  // Tab 2 selection states
  const [selectedResourceForTab, setSelectedResourceForTab] = useState<string>('');
  const [addCommessaId, setAddCommessaId] = useState<string>('');
  const [addPercentage, setAddPercentage] = useState<string>('100');
  const [assignPercentageMap, setAssignPercentageMap] = useState<Record<string, string>>({});

  // Search filter for allocator
  const [searchQuery, setSearchQuery] = useState('');

  // Macro area del dipendente loggato (fallback per PM non coordinatori)
  const myMacroArea = useMemo((): MacroArea | null => {
    if (isAdmin || isSoci(myAssociatedName)) return null; // admin/soci vedono tutto
    const myDip = dipendenti.find(d => d.email?.toLowerCase() === userEmail);
    return (myDip?.macroArea as MacroArea) || null;
  }, [isAdmin, myAssociatedName, dipendenti, userEmail]);

  const isSocioUser = isAdmin || isSoci(myAssociatedName) || isSoci(userEmail);

  const filteredDipendenti = useMemo(() => {
    let list = dipendenti.filter(d => {
      if (isTechnicalUser(d)) return false;
      return !isSoci(d.nome);
    });
    // Esclude risorse cessate in passato
    const todayStr = new Date().toLocaleDateString('sv-SE');
    list = list.filter(d => !d.dataCessazione || d.dataCessazione >= todayStr);

    // Coordinatori e PM vedono solo le risorse della propria macro area
    // Admin e Soci vedono tutto; isSenior non è più un bypass
    if (!isSocioUser) {
      if (myCoordinatedAreas.length > 0) {
        list = list.filter(d => myCoordinatedAreas.includes(d.macroArea || ''));
      } else if (myMacroArea) {
        list = list.filter(d => d.macroArea === myMacroArea);
      }
    }

    if (!searchQuery) return list;
    return list.filter(d => d.nome.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [dipendenti, searchQuery, myMacroArea, myCoordinatedAreas, isSocioUser]);

  const isPMOrResponsabile = useMemo(() => {
    return commesse.some(c => {
      const pmArray = Array.isArray(c.pm) ? c.pm : (c.pm ? [c.pm] : []);
      const extraArray: string[] = Array.isArray(c.abilitatiExtra) ? c.abilitatiExtra : (c.abilitatiExtra ? [c.abilitatiExtra] : []);
      const isPM = pmArray.some(name => areNamesEqual(name, myAssociatedName));
      const isExtra = extraArray.some((name: string) => areNamesEqual(name, myAssociatedName) || (userEmail && String(name).toLowerCase().includes(userEmail.split('@')[0])));
      return isPM || isExtra || areNamesEqual(c.responsabile, myAssociatedName);
    });
  }, [commesse, myAssociatedName, userEmail]);

  const isUserPmOrResp = (comm: any): boolean => {
    if (!comm) return false;

    const respStr = String(comm.responsabile || '').trim();
    const pmList: any[] = Array.isArray(comm.pm) ? comm.pm : (comm.pm ? [comm.pm] : []);
    const extraList: any[] = Array.isArray(comm.abilitatiExtra) ? comm.abilitatiExtra : (comm.abilitatiExtra ? [comm.abilitatiExtra] : []);
    const targets = [respStr, ...pmList.map(p => String(p || '').trim()), ...extraList.map(e => String(e || '').trim())].filter(Boolean);

    if (targets.length === 0) return false;

    if (myAssociatedName && targets.some(t => areNamesEqual(t, myAssociatedName))) return true;

    if (userEmail) {
      const emailClean = userEmail.toLowerCase().trim();
      const username = emailClean.split('@')[0];
      if (targets.some(t => {
        const tLower = t.toLowerCase().trim();
        return tLower.includes(emailClean) || (username.length >= 4 && tLower.includes(username));
      })) return true;
    }

    return false;
  };

  const selectableCommesse = useMemo(() => {
    const openCommesse = commesse.filter(c => c.stato !== 'Chiusa');
    if (isSocioUser) return openCommesse;
    return openCommesse.filter(c => isUserPmOrResp(c));
  }, [commesse, isSocioUser, userEmail, myAssociatedName]);

  const assignedCommesseForSelected = useMemo(() => {
    if (allocAction !== 'rimuovi' || selectedResourceNames.length === 0 || !allocDataInizio || !allocDataFine) {
      return [];
    }
    
    try {
      const targetWeekIds = getWeeksSpannedByDates(allocDataInizio, allocDataFine);
      const commesseSet = new Set<string>();
      const list: { id: string; nome: string }[] = [];
      
      selectedResourceNames.forEach(resName => {
        targetWeekIds.forEach(wkId => {
          const key = `${resName}-${wkId}`;
          const wkAssignments = assignments[key] || [];
          wkAssignments.forEach(a => {
            if (a.commessaId) {
              commesseSet.add(a.commessaId);
            }
          });
        });
      });
      
      commesseSet.forEach(cId => {
        const commObj = commesse.find(c => c.id === cId);
        if (commObj) {
          list.push({ id: cId, nome: commObj.nome });
        } else {
          list.push({ id: cId, nome: cId });
        }
      });
      
      return list;
    } catch (e) {
      console.error(e);
      return [];
    }
  }, [assignments, selectedResourceNames, allocDataInizio, allocDataFine, allocAction, commesse]);

  const risorseAssegnateAllaCommessa = useMemo(() => {
    if (!selectedCommessaId || !allocDataInizio || !allocDataFine) return [];
    try {
      const targetWeekIds = getWeeksSpannedByDates(allocDataInizio, allocDataFine);
      const map: Record<string, { nome: string; percentuali: Record<string, number> }> = {};
      
      filteredDipendenti.forEach(dip => {
        targetWeekIds.forEach(wkId => {
          const key = `${dip.nome}-${wkId}`;
          const list = assignments[key] || [];
          const found = list.find(a => a.commessaId === selectedCommessaId);
          if (found) {
            if (!map[dip.nome]) {
              map[dip.nome] = { nome: dip.nome, percentuali: {} };
            }
            map[dip.nome].percentuali[wkId] = found.percentuale;
          }
        });
      });
      
      return Object.values(map);
    } catch (e) {
      console.error(e);
      return [];
    }
  }, [assignments, selectedCommessaId, allocDataInizio, allocDataFine, filteredDipendenti]);

  const risorseNonAssegnateAllaCommessa = useMemo(() => {
    const assegnateNames = new Set(risorseAssegnateAllaCommessa.map(r => r.nome));
    return filteredDipendenti.filter(d => !assegnateNames.has(d.nome));
  }, [filteredDipendenti, risorseAssegnateAllaCommessa]);

  // Calcolo unificato, ultra-performante e pre-indicizzato delle ferie e assenze per risorsa e settimana (O(1) lookups)
  const resourceWeekLeavesMap = useMemo(() => {
    const map = new Map<string, { leaves: any[]; isFullLeave: boolean }>();
    if (!approvedLeaves || approvedLeaves.length === 0) return map;

    const dayNames = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven'];

    // Cache dei giorni lavorativi effettivi per ogni settimana (calcolo festività fatto UNA sola volta per settimana)
    const weekWorkDaysCache = new Map<string, number>();
    (selectableWeekOptions || []).forEach(weekOpt => {
      const monday = new Date(weekOpt.mondayStr);
      let count = 0;
      for (let i = 0; i < 5; i++) {
        const d = addDays(monday, i);
        const dStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        if (!isItalianHoliday(dStr)) count++;
      }
      weekWorkDaysCache.set(weekOpt.id, Math.max(1, count));
    });

    const normalizeKey = (name: string, wkId: string): string => `${name.toLowerCase().replace(/\s+/g, ' ').trim()}_${wkId}`;

    approvedLeaves.forEach((leave: any) => {
      const resName = leave.dipendenteName;
      if (!resName) return;
      const start = leave.dataInizio || leave.data;
      const end = leave.dataFine || leave.data;
      if (!start || !end) return;

      const [sY, sM, sD] = start.split('-').map(Number);
      const [eY, eM, eD] = end.split('-').map(Number);
      if (isNaN(sY) || isNaN(eY)) return;

      const curr = new Date(sY, sM - 1, sD);
      const last = new Date(eY, eM - 1, eD);

      const canonicalDip = (dipendenti || []).find(d => areNamesEqual(d.nome, resName));
      const targetNames = [resName];
      if (canonicalDip && canonicalDip.nome !== resName) {
        targetNames.push(canonicalDip.nome);
      }

      while (curr <= last) {
        const dow = curr.getDay();
        if (dow >= 1 && dow <= 5) {
          const y = curr.getFullYear();
          const m = String(curr.getMonth() + 1).padStart(2, '0');
          const ds = String(curr.getDate()).padStart(2, '0');
          const dateStr = `${y}-${m}-${ds}`;

          if (!isItalianHoliday(dateStr)) {
            const wkNum = getWeekNumber(curr);
            const wkId = `${y}-W${wkNum}`;

            let label = (leave.tipo === 'ferie' || leave.tipo === 'assenza') ? 'Ferie' : leave.tipo === 'malattia' ? 'Malattia' : leave.tipo === 'maternita' ? 'Maternità' : leave.tipo === 'smart' ? 'Smart' : leave.tipo === 'ex_l104' ? 'ex L.104' : leave.tipo === 'studio' ? 'Studio' : (leave.tipo || 'Assenza');
            if (leave.tipo === 'mattina' || leave.frazioneTipo === 'mattina') label = 'Ass. Matt.';
            if (leave.tipo === 'pomeriggio' || leave.frazioneTipo === 'pomeriggio') label = 'Ass. Pom.';
            if (leave.tipo === 'permesso' || leave.tipo === 'ex_l104' || leave.tipo === 'studio' || leave.frazioneTipo === 'orario') {
              if (leave.oraInizio && leave.oraFine) {
                label = `${leave.tipo === 'ex_l104' ? 'L.104' : (leave.tipo === 'studio' ? 'Studio' : 'Perm.')} (${leave.oraInizio}-${leave.oraFine})`;
              }
            }

            const dayName = dayNames[dow - 1];
            const leaveItem = {
              giorno: dayName,
              tipo: leave.tipo,
              frazioneTipo: leave.frazioneTipo,
              oraInizio: leave.oraInizio,
              oraFine: leave.oraFine,
              pausaPranzo: leave.pausaPranzo,
              pausaPranzoOre: leave.pausaPranzoOre,
              dettagli: label
            };

            targetNames.forEach(tName => {
              const k1 = normalizeKey(tName, wkId);
              const k2 = `${tName}-${wkId}`;
              [k1, k2].forEach(k => {
                let entry = map.get(k);
                if (!entry) {
                  entry = { leaves: [], isFullLeave: false };
                  map.set(k, entry);
                }
                if (!entry.leaves.some(l => l.giorno === dayName)) {
                  entry.leaves.push(leaveItem);
                }
              });
            });
          }
        }
        curr.setDate(curr.getDate() + 1);
      }
    });

    // Calcolo isFullLeave per ogni risorsa e settimana censita
    map.forEach((entry, key) => {
      const wkId = key.includes('_') ? key.split('_')[1] : key.split('-')[1];
      const requiredDays = weekWorkDaysCache.get(wkId) || 5;

      const fullLeaveDays = entry.leaves.filter(l => 
        l.tipo === 'ferie' || 
        l.tipo === 'assenza' ||
        l.tipo === 'malattia' || 
        l.tipo === 'maternita' || 
        l.frazioneTipo === 'giornata' ||
        (l.tipo !== 'smart' && l.tipo !== 'permesso' && l.tipo !== 'ex_l104' && l.tipo !== 'studio' && l.tipo !== 'mattina' && l.tipo !== 'pomeriggio' && l.frazioneTipo !== 'orario' && l.frazioneTipo !== 'mattina' && l.frazioneTipo !== 'pomeriggio')
      );
      const uniqueDays = new Set(fullLeaveDays.map(l => l.giorno));
      entry.isFullLeave = uniqueDays.size >= requiredDays;
    });

    return map;
  }, [approvedLeaves, dipendenti, selectableWeekOptions]);

  const EMPTY_LEAVE_DATA = { leaves: [], isFullLeave: false };

  const getLeavesForResourceInWeek = (resName: string, wkId: string) => {
    if (!resName || !wkId) return EMPTY_LEAVE_DATA.leaves;
    const normKey = `${resName.toLowerCase().replace(/\s+/g, ' ').trim()}_${wkId}`;
    const entry = resourceWeekLeavesMap.get(normKey) || resourceWeekLeavesMap.get(`${resName}-${wkId}`);
    return entry ? entry.leaves : EMPTY_LEAVE_DATA.leaves;
  };

  const isFullWeekLeave = (resName: string, wkId: string): boolean => {
    if (!resName || !wkId) return false;
    const normKey = `${resName.toLowerCase().replace(/\s+/g, ' ').trim()}_${wkId}`;
    const entry = resourceWeekLeavesMap.get(normKey) || resourceWeekLeavesMap.get(`${resName}-${wkId}`);
    return entry ? entry.isFullLeave : false;
  };

  const commesseAssegnateAllaRisorsa = useMemo(() => {
    if (!selectedResourceForTab || !allocDataInizio || !allocDataFine) return [];
    try {
      const targetWeekIds = getWeeksSpannedByDates(allocDataInizio, allocDataFine);
      const map: Record<string, { id: string; nome: string; percentuali: Record<string, number>; colore: string }> = {};
      
      targetWeekIds.forEach(wkId => {
        // Se la risorsa è in ferie per l'intera settimana, in quella settimana non lavora ad alcuna commessa
        if (isFullWeekLeave(selectedResourceForTab, wkId)) {
          return;
        }
        const key = `${selectedResourceForTab}-${wkId}`;
        const list = assignments[key] || [];
        list.forEach(a => {
          if (a.commessaId) {
            if (!map[a.commessaId]) {
              const commObj = commesse.find(c => c.id === a.commessaId);
              map[a.commessaId] = { 
                id: a.commessaId, 
                nome: a.commessaName, 
                percentuali: {}, 
                colore: commObj ? (TIPOLOGIA_COLORS[commObj.tipologia || ''] || commObj.colore || '#64748b') : (a.colore || '#64748b') 
              };
            }
            map[a.commessaId].percentuali[wkId] = a.percentuale;
          }
        });
      });
      
      return Object.values(map);
    } catch (e) {
      console.error(e);
      return [];
    }
  }, [assignments, selectedResourceForTab, allocDataInizio, allocDataFine, commesse, resourceWeekLeavesMap]);

  const resourceLeaveInfoForPeriod = useMemo(() => {
    if (!selectedResourceForTab || !allocDataInizio || !allocDataFine) {
      return { isFullyOnLeave: false, leaveWeekLabels: [], hasAnyLeave: false, leaveDaysDetails: [], totalWeeks: 0 };
    }
    const targetWeekIds = getWeeksSpannedByDates(allocDataInizio, allocDataFine);
    const leaveWeekLabels: string[] = [];
    const leaveDaysDetails: string[] = [];
    let fullLeaveCount = 0;

    targetWeekIds.forEach(wkId => {
      const isFull = isFullWeekLeave(selectedResourceForTab, wkId);
      const weekLeaves = getLeavesForResourceInWeek(selectedResourceForTab, wkId);
      const opt = selectableWeekOptions.find(o => o.id === wkId);
      const label = opt ? opt.label : `Sett. ${wkId.split('-W')[1]}`;

      if (isFull) {
        fullLeaveCount++;
        leaveWeekLabels.push(label);
      } else if (weekLeaves.length > 0) {
        const days = weekLeaves.map(l => `${l.giorno} (${l.dettagli || l.tipo})`).join(', ');
        leaveDaysDetails.push(`${label}: ${days}`);
      }
    });

    const isFullyOnLeave = targetWeekIds.length > 0 && fullLeaveCount === targetWeekIds.length;
    const hasAnyLeave = fullLeaveCount > 0 || leaveDaysDetails.length > 0;

    return { 
      isFullyOnLeave, 
      leaveWeekLabels, 
      hasAnyLeave, 
      fullLeaveCount, 
      totalWeeks: targetWeekIds.length,
      leaveDaysDetails 
    };
  }, [selectedResourceForTab, allocDataInizio, allocDataFine, selectableWeekOptions, resourceWeekLeavesMap]);

  // Pulizia automatica delle assegnazioni storiche residue per le settimane in cui la risorsa è in ferie piena
  useEffect(() => {
    if (!selectedResourceForTab || !allocDataInizio || !allocDataFine) return;
    const targetWeekIds = getWeeksSpannedByDates(allocDataInizio, allocDataFine);
    targetWeekIds.forEach(wkId => {
      if (isFullWeekLeave(selectedResourceForTab, wkId)) {
        const docId = `${selectedResourceForTab}-${wkId}`;
        if (assignments[docId] && assignments[docId].length > 0) {
          import('../services/firebase').then(({ db }) => {
            import('firebase/firestore').then(({ doc, deleteDoc }) => {
              deleteDoc(doc(db, 'assegnazioni', docId)).catch(() => {});
            });
          });
          setAssignments(prev => {
            const next = { ...prev };
            delete next[docId];
            return next;
          });
        }
      }
    });
  }, [selectedResourceForTab, allocDataInizio, allocDataFine, resourceWeekLeavesMap, assignments]);

  useEffect(() => {
    setCommesseToRemove([]);
  }, [assignedCommesseForSelected]);

  const showToast = (message: string, type: 'success' | 'warning' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(null);
    }, 4500);
  };



  // Search filter for main grid
  const [gridSearchQuery, setGridSearchQuery] = useState('');

  // Collapsible sections for macro areas
  const [expandedAreas, setExpandedAreas] = useState<Record<string, boolean>>({
    'Disegnatori': false,
    'Ingegneria': false,
    'Sicurezza Cantieri': false,
    'Consulenza Sicurezza': false,
    'Amministrazione': false,
    'Non Assegnati': false,
  });








  // Stati per richieste personale (generalizzate per tutte le aree)
  const [isRequestModalOpen, setIsRequestModalOpen] = useState(false);
  const [reqAreaTarget, setReqAreaTarget] = useState<MacroArea>('Disegnatori');
  const [reqCommessaId, setReqCommessaId] = useState('');
  const [reqDataInizio, setReqDataInizio] = useState<string>(() => getDefaultWeekRange().startStr);
  const [reqDataFine, setReqDataFine] = useState<string>(() => getDefaultWeekRange().endStr);
  const [reqPercentuale, setReqPercentuale] = useState(100);
  const [reqPreferredResource, setReqPreferredResource] = useState('');
  const [reqNota, setReqNota] = useState('');
  const [isSubmittingRequest, setIsSubmittingRequest] = useState(false);
  const [selectedRisorsePerRichiesta, setSelectedRisorsePerRichiesta] = useState<Record<string, string>>({});
  const [customPercentagesPerRichiesta, setCustomPercentagesPerRichiesta] = useState<Record<string, number>>({});
  const [showApprovedHistoryModal, setShowApprovedHistoryModal] = useState(false);
  const [historySelectedResource, setHistorySelectedResource] = useState<Record<string, string>>({});
  const [isAvailabilityModalOpen, setIsAvailabilityModalOpen] = useState(false);
  const [segnalazioniDisponibilita, setSegnalazioniDisponibilita] = useState<any[]>([]);
  const [segnalazioneToManage, setSegnalazioneToManage] = useState<any | null>(null);
  const [isConfirmManageOpen, setIsConfirmManageOpen] = useState(false);

  const fetchSegnalazioni = async () => {
    try {
      const qDisp = query(collection(db, 'segnalazioni_disponibilita'), where('stato', '==', 'in_attesa'));
      const snap = await getDocs(qDisp);
      const list: any[] = [];
      snap.forEach(docSnap => {
        list.push({ id: docSnap.id, ...docSnap.data() });
      });
      setSegnalazioniDisponibilita(list);
    } catch (err) {
      console.error("Errore caricamento segnalazioni:", err);
    }
  };

  useEffect(() => {
    fetchSegnalazioni();
  }, [userEmail, myCoordinatedAreas.length]);

  const handlePianificaRisorsaDaSegnalazione = (nomeRisorsa: string) => {
    if (!nomeRisorsa) return;
    setActiveTab('risorsa');
    setSelectedResourceForTab(nomeRisorsa);
    setResourceSearchText(nomeRisorsa);
    showToast(`Visualizzazione impostata sulla risorsa ${nomeRisorsa}.`);
    // Scroll morbido verso la griglia di pianificazione
    setTimeout(() => {
      const el = document.getElementById('planning-view-section');
      if (el) {
        el.scrollIntoView({ behavior: 'smooth' });
      }
    }, 100);
  };

  const handleConfirmGestione = async () => {
    if (!segnalazioneToManage?.id) return;
    try {
      await updateDoc(doc(db, 'segnalazioni_disponibilita', segnalazioneToManage.id), { 
        stato: 'gestita',
        gestitaDa: myAssociatedName || userEmail || 'Coordinatore',
        gestitaEmail: userEmail || '',
        dataGestione: new Date().toISOString()
      });
      showToast(`Segnalazione di ${segnalazioneToManage.risorsaNome || segnalazioneToManage.dipendenteNome || 'risorsa'} archiviata.`, 'success');
      setIsConfirmManageOpen(false);
      setSegnalazioneToManage(null);
      await fetchSegnalazioni();
    } catch (err) {
      console.error("Errore aggiornamento segnalazione:", err);
      showToast("Errore durante l'archiviazione della segnalazione.", "error");
    }
  };

  const openRequestModalForArea = (area: MacroArea) => {
    setReqAreaTarget(area);
    setReqCommessaId(selectedCommessaId);
    setReqDataInizio(allocDataInizio);
    setReqDataFine(allocDataFine);
    setReqPercentuale(100);
    setReqPreferredResource('');
    setReqNota('');
    setIsRequestModalOpen(true);
  };

  const handleReqModalDateChange = (dateStr: string, isStart: boolean) => {
    if (!dateStr) return;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return;
    const monday = getStartOfWeek(d);
    const mY = monday.getFullYear();
    const mM = String(monday.getMonth() + 1).padStart(2, '0');
    const mD = String(monday.getDate()).padStart(2, '0');
    const monStr = `${mY}-${mM}-${mD}`;

    const sunday = addDays(monday, 6);
    const sY = sunday.getFullYear();
    const sM = String(sunday.getMonth() + 1).padStart(2, '0');
    const sD = String(sunday.getDate()).padStart(2, '0');
    const sunStr = `${sY}-${sM}-${sD}`;

    if (isStart) {
      setReqDataInizio(monStr);
      if (!reqDataFine || reqDataFine < sunStr) {
        setReqDataFine(sunStr);
      }
    } else {
      setReqDataFine(sunStr);
      if (!reqDataInizio || reqDataInizio > monStr) {
        setReqDataInizio(monStr);
      }
    }
  };

  const getWeekId = (d: Date): string => {
    const date = new Date(d.getTime());
    date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
    const year = date.getFullYear();
    const wkNum = getWeekNumber(date);
    return `${year}-W${wkNum}`;
  };

  const handleSubmitRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    const def = getDefaultWeekRange();
    const effectiveInizio = reqDataInizio || def.startStr;
    const effectiveFine = reqDataFine || def.endStr;

    if (!reqCommessaId || !effectiveInizio || !effectiveFine || !reqPercentuale) {
      showToast("Compila tutti i campi richiesti.", "warning");
      return;
    }
    setIsSubmittingRequest(true);
    try {
      const commObj = commesse.find(c => c.id === reqCommessaId);
      const commName = commObj ? commObj.nome : '';
      const commResp = commObj ? (commObj.responsabile || '') : '';
      const commPM = commObj ? (typeof commObj.pm === 'string' ? commObj.pm : (Array.isArray(commObj.pm) ? commObj.pm.join(', ') : '')) : '';

      await addDoc(collection(db, 'richieste_disegnatori'), {
        commessaId: reqCommessaId,
        commessaName: commName,
        commessaResponsabile: commResp,
        commessaPM: commPM,
        dataInizio: effectiveInizio,
        dataFine: effectiveFine,
        percentuale: Number(reqPercentuale),
        risorsaPreferita: reqPreferredResource || '',
        nota: reqNota,
        richiedenteNome: myAssociatedName || user?.displayName || userEmail || '',
        richiedenteEmail: userEmail,
        stato: 'in_attesa',
        area: reqAreaTarget,
        tipoRichiesta: 'richiesta_area',
        fonte: 'planning',
        createdAt: new Date().toISOString()
      });

      showToast(`Richiesta inviata con successo!`, "success");
      setIsRequestModalOpen(false);
      setReqCommessaId('');
      setReqDataInizio(def.startStr);
      setReqDataFine(def.endStr);
      setReqPercentuale(100);
      setReqPreferredResource('');
      setReqNota('');
    } catch (err) {
      console.error("Errore salvataggio richiesta:", err);
      showToast("Errore durante l'invio della richiesta.", "error");
    } finally {
      setIsSubmittingRequest(false);
    }
  };

  const handleApproveRequest = async (req: any) => {
    if (!canUserManageRequest(req)) {
      if (isSelfRequester(req)) {
        showToast("Non puoi approvare o rifiutare una richiesta di personale che hai inviato tu stesso.", "error");
      } else {
        showToast("Non hai i permessi per approvare o rifiutare questa richiesta.", "error");
      }
      return;
    }

    const isCancellation = Number(req.percentuale) === 0 || 
      (req.tipoRichiesta || '').toLowerCase().includes('annullamento') || 
      (req.tipoRichiesta || '').toLowerCase().includes('rimozione');

    const commObj = commesse.find(c => (req.commessaId && c.id === req.commessaId) || (c.nome && (c.nome === req.commessaName || c.nome === req.commessaNome)));
    const isInserimentoCommessa = req.fonte === 'altre_commesse';

    let risorsaNome = '';
    if (isCancellation) {
      risorsaNome = req.risorseAssegnata || req.risorsaPreferita || selectedRisorsePerRichiesta[req.id] || '';
    } else if (isInserimentoCommessa && req.risorsaPreferita) {
      risorsaNome = req.risorsaPreferita;
    } else {
      const isPreferredValid = req.risorsaPreferita && dipendenti.some(d => d.nome === req.risorsaPreferita);
      risorsaNome = selectedRisorsePerRichiesta[req.id] || (isPreferredValid ? req.risorsaPreferita : '');
    }

    if (!risorsaNome || !dipendenti.some(d => d.nome === risorsaNome)) {
      showToast("Seleziona una risorsa valida prima di approvare la richiesta.", "warning");
      return;
    }

    const effectivePercent = customPercentagesPerRichiesta[req.id] !== undefined
      ? Number(customPercentagesPerRichiesta[req.id])
      : Number(req.percentuale || 100);

    if (effectivePercent <= 0 || effectivePercent > 100) {
      showToast("La percentuale deve essere compresa tra 1% e 100%.", "warning");
      return;
    }

    try {
      const start = new Date(req.dataInizio);
      const end = new Date(req.dataFine);
      
      const weekIds = new Set<string>();
      let curr = new Date(start);
      while (curr <= end) {
        const wkId = getWeekId(curr);
        if (wkId) weekIds.add(wkId);
        curr.setDate(curr.getDate() + 7);
      }
      const finalWkId = getWeekId(end);
      if (finalWkId) weekIds.add(finalWkId);

      const batch = writeBatch(db);
      
      const commName = commObj?.nome || req.commessaName || req.commessaNome || 'Commessa';
      const colore = commObj ? (TIPOLOGIA_COLORS[commObj.tipologia || ''] || commObj.colore || '#64748b') : '#64748b';

      for (const wkId of weekIds) {
        const docId = `${risorsaNome}-${wkId}`;
        const currentList = [...(assignments[docId] || [])];
        const filtered = currentList.filter(c => c.commessaId !== req.commessaId);

        // Aggiungiamo l'assegnazione SOLO se non si tratta di un annullamento/rimozione
        if (!isCancellation && effectivePercent > 0) {
          filtered.push({
            commessaId: req.commessaId,
            commessaName: commName,
            percentuale: effectivePercent,
            colore: colore
          });
        }
        
        const docRef = doc(db, 'assegnazioni', docId);
        batch.set(docRef, { lista: filtered });
      }
      
      const reqRef = doc(db, 'richieste_disegnatori', req.id);
      batch.update(reqRef, {
        stato: 'approvata',
        risorseAssegnata: risorsaNome,
        percentuale: effectivePercent,
        dataApprovazione: new Date().toISOString(),
        approvatoDa: myAssociatedName || userEmail || ''
      });
      
      await batch.commit();

      // Rimuovi immediatamente dalla lista locale per aggiornare la UI in tempo reale
      setLocalRichiesteDisegnatori(prev => prev.filter(r => r.id !== req.id));

      showToast(isCancellation ? `Annullamento approvato: ${risorsaNome} rimosso dalla commessa!` : `Richiesta approvata per ${risorsaNome} con carico ${effectivePercent}%!`, "success");
    } catch (err) {
      console.error("Errore approvazione richiesta:", err);
      showToast("Errore durante l'approvazione.", "error");
    }
  };

  const handleFixHistoryRequest = async (req: any, chosenRisorsa: string) => {
    if (!chosenRisorsa) {
      showToast("Seleziona una risorsa per salvare l'assegnazione.", "warning");
      return;
    }
    try {
      const isCancellation = Number(req.percentuale) === 0 || 
        (req.tipoRichiesta || '').toLowerCase().includes('annullamento') || 
        (req.tipoRichiesta || '').toLowerCase().includes('rimozione');

      const start = new Date(req.dataInizio);
      const end = new Date(req.dataFine);
      
      const weekIds = new Set<string>();
      let curr = new Date(start);
      while (curr <= end) {
        const wkId = getWeekId(curr);
        if (wkId) weekIds.add(wkId);
        curr.setDate(curr.getDate() + 7);
      }
      const finalWkId = getWeekId(end);
      if (finalWkId) weekIds.add(finalWkId);

      const batch = writeBatch(db);
      const commObj = commesse.find(c => (req.commessaId && c.id === req.commessaId) || (c.nome && (c.nome === req.commessaName || c.nome === req.commessaNome)));
      const colore = commObj ? (TIPOLOGIA_COLORS[commObj.tipologia || ''] || commObj.colore || '#64748b') : '#64748b';

      for (const wkId of weekIds) {
        const docId = `${chosenRisorsa}-${wkId}`;
        const currentList = [...(assignments[docId] || [])];
        const filtered = currentList.filter(c => c.commessaId !== req.commessaId);

        if (!isCancellation) {
          filtered.push({
            commessaId: req.commessaId,
            commessaName: req.commessaName,
            percentuale: Number(req.percentuale),
            colore: colore
          });
        }
        
        const docRef = doc(db, 'assegnazioni', docId);
        batch.set(docRef, { lista: filtered });
      }
      
      const reqRef = doc(db, 'richieste_disegnatori', req.id);
      batch.update(reqRef, {
        stato: 'approvata',
        risorseAssegnata: chosenRisorsa,
        dataApprovazione: new Date().toISOString(),
        approvatoDa: myAssociatedName || userEmail || ''
      });
      
      await batch.commit();
      setLocalRichiesteDisegnatori(prev => prev.filter(r => r.id !== req.id));
      showToast(`Assegnazione salvata nel calendario per ${chosenRisorsa}!`, "success");
    } catch (err) {
      console.error("Errore salvataggio correzione:", err);
      showToast("Errore durante il salvataggio dell'assegnazione.", "error");
    }
  };

  const handleRejectRequest = async (reqId: string) => {
    const targetReq = richiesteDisegnatori.find(r => r.id === reqId);
    if (targetReq) {
      if (!canUserManageRequest(targetReq)) {
        if (isSelfRequester(targetReq)) {
          showToast("Non puoi approvare o rifiutare una richiesta che hai inviato tu stesso.", "error");
        } else {
          showToast("Non hai i permessi per rifiutare questa richiesta.", "error");
        }
        return;
      }
    }

    setConfirmConfig({
      isOpen: true,
      title: "Rifiuta Richiesta Personale",
      message: "Sei sicuro di voler rifiutare questa richiesta di personale?",
      type: "warning",
      onConfirm: async () => {
        try {
          const reqRef = doc(db, 'richieste_disegnatori', reqId);
          await updateDoc(reqRef, {
            stato: 'rifiutata',
            dataRifiuto: new Date().toISOString(),
            rifiutatoDa: myAssociatedName || userEmail || ''
          });

          setLocalRichiesteDisegnatori(prev => prev.filter(r => r.id !== reqId));
          showToast("Richiesta rifiutata con successo.");
          setConfirmConfig(prev => ({ ...prev, isOpen: false }));
        } catch (err) {
          console.error("Errore rifiuto richiesta:", err);
          showToast("Errore durante il rifiuto della richiesta.", "error");
        }
      }
    });
  };

  const getDayContractHoursForDip = (dip: any, dayName: string, defaultHours: number = 8): number => {
    if (dip?.tipo === 'collaboratore') return 8;
    if (dip?.orarioSettimanale) {
      const mapKey: Record<string, 'lun' | 'mar' | 'mer' | 'gio' | 'ven'> = {
        'lun': 'lun', 'mar': 'mar', 'mer': 'mer', 'gio': 'gio', 'ven': 'ven',
        'lunedì': 'lun', 'martedì': 'mar', 'mercoledì': 'mer', 'giovedì': 'gio', 'venerdì': 'ven'
      };
      const key = mapKey[dayName.toLowerCase().slice(0, 3)];
      if (key && typeof dip.orarioSettimanale[key] === 'number') {
        return dip.orarioSettimanale[key];
      }
    }
    return dip?.oreContratto ?? defaultHours;
  };

  const getDayLoad = (dayName: string, commesseLoad: number, dayLeaves: any[], dailyContractHours: number = 8) => {
    const leavesForDay = dayLeaves.filter(l => l.giorno === dayName);
    let leaveLoad = 0;
    if (leavesForDay.length > 0) {
      const leaveHrs = leavesForDay.reduce((acc, l) => {
        let hrs = 0;
        if (l.tipo === 'smart') {
          hrs = 0;
        } else if (l.frazioneTipo === 'mattina' || l.frazioneTipo === 'pomeriggio' || l.tipo === 'mattina' || l.tipo === 'pomeriggio') {
          hrs = dailyContractHours / 2;
        } else if ((l.frazioneTipo === 'orario' || l.tipo === 'permesso' || l.tipo === 'ex_l104' || l.tipo === 'studio' || (!l.frazioneTipo && l.oraInizio && l.oraFine)) && l.oraInizio && l.oraFine) {
          const [hStart, mStart] = l.oraInizio.split(':').map(Number);
          const [hEnd, mEnd] = l.oraFine.split(':').map(Number);
          if (!isNaN(hStart) && !isNaN(hEnd)) {
            const diffMs = new Date(2000, 0, 1, hEnd, mEnd || 0).getTime() - new Date(2000, 0, 1, hStart, mStart || 0).getTime();
            hrs = Math.max(0, Math.round((diffMs / 3600000) * 100) / 100);
            if (l.pausaPranzo && l.pausaPranzoOre) {
              hrs = Math.max(0, hrs - l.pausaPranzoOre);
            }
          }
        } else if (l.tipo === 'permesso' || l.tipo === 'ex_l104' || l.tipo === 'studio') {
          if (l.frazioneTipo === 'giornata') {
            hrs = dailyContractHours;
          } else {
            hrs = dailyContractHours / 2;
          }
        } else {
          // 'giornata', 'ferie', 'assenza', 'malattia', 'maternita'
          hrs = dailyContractHours;
        }
        return acc + Math.min(dailyContractHours, hrs);
      }, 0);
      leaveLoad = dailyContractHours > 0 ? Math.min(100, Math.round((leaveHrs / dailyContractHours) * 100)) : 0;
    }
    return leaveLoad + commesseLoad;
  };

  const calculateWeeklyLoad = (dipName: string, wkId: string, rawList: any[]) => {
    const isFullLeave = isFullWeekLeave(dipName, wkId);
    const list = isFullLeave ? [] : rawList;
    const leaves = getLeavesForResourceInWeek(dipName, wkId);
    const commesseLoad = list.reduce((acc, c) => acc + Number(c.percentuale), 0);
    const dip = dipendenti.find(d => areNamesEqual(d.nome, dipName));
    const baseDays = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven'];
    let totalWeekPct = 0;
    for (const day of baseDays) {
      const dayContract = getDayContractHoursForDip(dip, day, 8);
      totalWeekPct += getDayLoad(day, commesseLoad, leaves, dayContract);
    }
    return Math.round(totalWeekPct / 5);
  };

  // Funzione avviso ferie rimosso come richiesto dall'utente

  // Carica le assegnazioni e sincronizza dal contesto globale real-time
  useEffect(() => {
    const isLocalModified = JSON.stringify(assignments) !== JSON.stringify(dbAssignments);
    setDbAssignments(globalAssignments || {});
    if (!isLocalModified) {
      setAssignments(globalAssignments || {});
    }
    setLoadingAssignments(false);
  }, [globalAssignments]);

  // Update timeline weeks for the grid
  useEffect(() => {
    setTimelineWeeks(generateWeeksExtended(gridBaseDate, zoomWeeks));
  }, [gridBaseDate, zoomWeeks]);

  // Load pending notifications count at mount
  useEffect(() => {
    updatePendingNotificationsCount();
  }, []);

  const updatePendingNotificationsCount = () => {
    const pending = getPendingNotifications();
    setPendingNotificationsCount(Object.keys(pending).length);
  };

  const getWeekdayDate = (wkId: string, dayKey: string): string => {
    const parts = wkId.split('-W');
    if (parts.length !== 2) return '';
    const year = parseInt(parts[0]);
    const week = parseInt(parts[1]);

    const simple = new Date(year, 0, 4);
    const dayOfWeek = simple.getDay();
    const dayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const firstMonday = new Date(simple.setDate(simple.getDate() + dayOffset));
    const monday = new Date(firstMonday.setDate(firstMonday.getDate() + (week - 1) * 7));

    const dayMap: Record<string, number> = { 'Lun': 0, 'Mar': 1, 'Mer': 2, 'Gio': 3, 'Ven': 4 };
    const offset = dayMap[dayKey] ?? 0;
    const targetDate = new Date(monday);
    targetDate.setDate(monday.getDate() + offset);

    const y = targetDate.getFullYear();
    const m = String(targetDate.getMonth() + 1).padStart(2, '0');
    const dStr = String(targetDate.getDate()).padStart(2, '0');
    return `${y}-${m}-${dStr}`;
  };

  // Aggiorna solo le settimane di un SINGOLO sotto-periodo (non tocca il resto)
  const executeAssignSubperiodToCommessa = async (
    resName: string,
    commessaId: string,
    weekIds: string[],
    percentage: number
  ) => {
    if (!allocDataInizio || !allocDataFine) return;
    const commObj = commesse.find(c => c.id === commessaId);
    if (!commObj) return;

    const updatedAssignments = { ...assignments };
    const baseDays = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven'];

    for (const wkId of weekIds) {
      if (isFullWeekLeave(resName, wkId)) continue;

      const coveredDays = getCoveredDaysInWeek(wkId, allocDataInizio, allocDataFine);
      if (coveredDays === 0) continue;

      const allowedDays: string[] = [];
      for (const day of baseDays) {
        const dayDate = getWeekdayDate(wkId, day);
        if (dayDate >= allocDataInizio && dayDate <= allocDataFine) allowedDays.push(day);
      }

      const docId = `${resName}-${wkId}`;
      const currentList = updatedAssignments[docId] || [];
      const filteredList = currentList.filter((a: any) => a.commessaId !== commessaId);
      filteredList.push({
        commessaId,
        commessaName: commObj.nome,
        percentuale: percentage,
        colore: TIPOLOGIA_COLORS[commObj.tipologia || ''] || commObj.colore || '#64748b',
        giorni: allowedDays.length > 0 ? allowedDays : baseDays
      });
      updatedAssignments[docId] = filteredList;
    }

    setAssignments(updatedAssignments);
    setIsDirty(true);
    showToast('Sotto-periodo aggiornato in bozza!', 'success');
  };

  // Rimuove solo le settimane di un SINGOLO sotto-periodo
  const executeRemoveSubperiodFromCommessa = async (
    resName: string,
    commessaId: string,
    weekIds: string[]
  ) => {
    const updatedAssignments = { ...assignments };
    for (const wkId of weekIds) {
      const docId = `${resName}-${wkId}`;
      const currentList = updatedAssignments[docId] || [];
      const filteredList = currentList.filter((a: any) => a.commessaId !== commessaId);
      if (filteredList.length === 0) {
        delete updatedAssignments[docId];
      } else {
        updatedAssignments[docId] = filteredList;
      }
    }
    setAssignments(updatedAssignments);
    setIsDirty(true);
    showToast('Sotto-periodo rimosso in bozza!', 'success');
  };

  const executeRemoveResourceFromCommessa = async (resName: string, commessaId: string) => {
    if (!allocDataInizio || !allocDataFine) {
      showToast("Seleziona prima le date di inizio e fine periodo!", "warning");
      return;
    }
    const commObj = commesse.find(c => c.id === commessaId);
    if (commObj) {
      const pmArray = Array.isArray(commObj.pm) ? commObj.pm : (commObj.pm ? [commObj.pm] : []);
      const isPM = pmArray.some(name => areNamesEqual(name, myAssociatedName));
      const isUserAllowed = isAdmin || isSoci(myAssociatedName) || areNamesEqual(commObj.responsabile, myAssociatedName) || isPM;
      if (!isUserAllowed) {
        showToast("Non hai i permessi per questa commessa.", "error");
        return;
      }
    } else {
      if (!isAdmin && !isSoci(myAssociatedName)) {
        showToast("Non hai i permessi per questa operazione globale.", "error");
        return;
      }
    }

    const updatedAssignments = { ...assignments };
    const newNotifications = [...draftNotifications];

    try {
      const targetWeekIds = getWeeksSpannedByDates(allocDataInizio, allocDataFine);

      for (const wkId of targetWeekIds) {
        const docId = `${resName}-${wkId}`;
        const currentList = updatedAssignments[docId] || [];
        const filteredList = currentList.filter((a: any) => a.commessaId !== commessaId);
        
        if (currentList.length !== filteredList.length) {
          if (filteredList.length === 0) {
            delete updatedAssignments[docId];
          } else {
            updatedAssignments[docId] = filteredList;
          }

          // Coda notifica (solo se la risorsa non è l'utente operante)
          const targetDip = dipendenti.find(d => d.nome === resName);
          const isSelfRes = (targetDip?.email?.toLowerCase() === userEmail.toLowerCase()) || areNamesEqual(resName, myAssociatedName);
          if (targetDip && targetDip.email && !isSelfRes) {
            const wkLabel = `Sett. ${wkId.split('-W')[1] || ''}`;
            newNotifications.push({
              dipendenteNome: resName,
              email: targetDip.email,
              weekLabel: wkLabel,
              description: `Rimossa commessa: ${commObj?.nome || commessaId}`
            });
          }
        }
      }
      setAssignments(updatedAssignments);
      setDraftNotifications(newNotifications);
      setIsDirty(true);
      showToast("Rimozione registrata in bozza!", "success");
    } catch (err) {
      console.error(err);
      showToast("Si è verificato un errore durante la rimozione locale.", "error");
    }
  };

  const executeAssignResourceToCommessa = async (resName: string, commessaId: string, percentage: number) => {
    if (!allocDataInizio || !allocDataFine) {
      showToast("Seleziona prima le date di inizio e fine periodo!", "warning");
      return;
    }
    if (allocDataInizio > allocDataFine) {
      showToast("La data di inizio non può essere successiva alla data di fine.", "error");
      return;
    }
    const commObj = commesse.find(c => c.id === commessaId);
    if (!commObj) {
      showToast("Seleziona una commessa!", "warning");
      return;
    }

    const pmArray = Array.isArray(commObj.pm) ? commObj.pm : (commObj.pm ? [commObj.pm] : []);
    const isPM = pmArray.some(name => areNamesEqual(name, myAssociatedName));
    const isUserAllowed = isAdmin || isSoci(myAssociatedName) || isSoci(userEmail) || areNamesEqual(commObj.responsabile, myAssociatedName) || isPM;
    if (!isUserAllowed) {
      showToast("Non hai i permessi per questa commessa (PM/Responsabile o Admin richiesto).", "error");
      return;
    }


    const updatedAssignments = { ...assignments };
    const newNotifications = [...draftNotifications];

    try {
      const targetWeekIds = getWeeksSpannedByDates(allocDataInizio, allocDataFine);

      const allWeeksOnLeave = targetWeekIds.length > 0 && targetWeekIds.every(wkId => isFullWeekLeave(resName, wkId));
      if (allWeeksOnLeave) {
        showToast(`Impossibile assegnare commesse: ${resName} è in ferie per l'intero periodo selezionato.`, "warning");
        return;
      }

      const skippedLeaveWeeks: string[] = [];

      for (const wkId of targetWeekIds) {
        const docId = `${resName}-${wkId}`;

        // Se la risorsa è in ferie piena per questa settimana, salta l'assegnazione e rimuovi eventuali vecchi residui
        if (isFullWeekLeave(resName, wkId)) {
          skippedLeaveWeeks.push(wkId.split('-W')[1] || wkId);
          if (updatedAssignments[docId]) {
            delete updatedAssignments[docId];
          }
          continue;
        }

        const baseDays = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven'];
        const allowedDays: string[] = [];

        const coveredDays = getCoveredDaysInWeek(wkId, allocDataInizio, allocDataFine);
        if (coveredDays === 0) continue;

        for (const day of baseDays) {
          const dayDate = getWeekdayDate(wkId, day);
          const isWithinRange = (dayDate >= allocDataInizio && dayDate <= allocDataFine);
          if (isWithinRange) {
            allowedDays.push(day);
          }
        }

        const actualPct = percentage;

        const currentList = updatedAssignments[docId] || [];
        const filteredList = currentList.filter(a => a.commessaId !== commessaId);

        if (actualPct === 0) {
          if (filteredList.length === 0) {
            delete updatedAssignments[docId];
          } else {
            updatedAssignments[docId] = filteredList;
          }
          continue;
        }

        const newAllocation = {
          commessaId: commessaId,
          commessaName: commObj.nome,
          percentuale: actualPct,
          colore: TIPOLOGIA_COLORS[commObj.tipologia || ''] || commObj.colore || '#64748b',
          giorni: allowedDays
        };

        updatedAssignments[docId] = [...filteredList, newAllocation];

        // Coda notifica (solo se la risorsa non è l'utente operante)
        const targetDip = dipendenti.find(d => d.nome === resName);
        const isSelfRes = (targetDip?.email?.toLowerCase() === userEmail.toLowerCase()) || areNamesEqual(resName, myAssociatedName);
        if (targetDip && targetDip.email && !isSelfRes) {
          const wkLabel = `Sett. ${wkId.split('-W')[1] || ''}`;
          newNotifications.push({
            dipendenteNome: resName,
            email: targetDip.email,
            weekLabel: wkLabel,
            description: `Assegnata commessa: ${commObj.nome} (${actualPct}%)`
          });
        }
      }

      setAssignments(updatedAssignments);
      setDraftNotifications(newNotifications);
      setIsDirty(true);
      if (skippedLeaveWeeks.length > 0) {
        showToast(`Assegnazione salvata escludendo le settimane di ferie (Sett. ${skippedLeaveWeeks.join(', ')}).`, "warning");
      } else {
        showToast("Assegnazione registrata in bozza!", "success");
      }
    } catch (err) {
      console.error(err);
      showToast("Si è verificato un errore durante il salvataggio locale.", "error");
    }
  };



  const handleDiscardChanges = () => {
    setAssignments(dbAssignments);
    setDraftNotifications([]);
    setIsDirty(false);
    showToast("Modifiche locali annullate con successo!", "success");
  };

  const handleSaveChanges = async () => {
    setSavingChanges(true);
    try {
      const batch = writeBatch(db);
      
      const allKeys = new Set([...Object.keys(assignments), ...Object.keys(dbAssignments)]);
      
      let writeCount = 0;
      allKeys.forEach(key => {
        const currentList = assignments[key] || [];
        const dbList = dbAssignments[key] || [];
        
        const currentStr = JSON.stringify(currentList);
        const dbStr = JSON.stringify(dbList);
        
        if (currentStr !== dbStr) {
          const docRef = doc(db, 'assegnazioni', key);
          if (currentList.length === 0) {
            batch.delete(docRef);
          } else {
            batch.set(docRef, { lista: currentList });
          }
          writeCount++;
        }
      });

      if (writeCount > 0) {
        await batch.commit();

        // Invia notifiche personali informative alle risorse coinvolte
        const notifiedEmails = new Set<string>();
        draftNotifications.forEach(n => {
          const targetDip = dipendenti.find(d => areNamesEqual(d.nome, n.dipendenteNome));
          if (targetDip?.email && targetDip.email.toLowerCase() !== userEmail.toLowerCase() && !notifiedEmails.has(targetDip.email.toLowerCase())) {
            notifiedEmails.add(targetDip.email.toLowerCase());
            const isRimosso = (n.description || '').toLowerCase().includes('rimoss');
            const isAssegnato = (n.description || '').toLowerCase().includes('assegnat');
            const notifTitle = isRimosso ? '🔴 Rimozione da Commessa' : isAssegnato ? '🟢 Nuova Assegnazione Commessa' : '📅 Pianificazione Aggiornata';
            
            createUserNotification({
              destinatarioEmail: targetDip.email,
              destinatarioNome: n.dipendenteNome,
              titolo: notifTitle,
              messaggio: `${n.description || 'Pianificazione aggiornata'} (${n.weekLabel}).`,
              tipo: 'pianificazione_aggiornata',
              link: '/commesse'
            });
          }
        });
      }

      // Applica le notifiche accumulate in locale
      draftNotifications.forEach(n => {
        addPendingNotification(n.dipendenteNome, n.email, n.weekLabel, n.description);
      });
      updatePendingNotificationsCount();
      
      const freshAssignments = JSON.parse(JSON.stringify(assignments));
      setDbAssignments(freshAssignments);
      setAssignments(freshAssignments);
      setDraftNotifications([]);
      setIsDirty(false);
      showToast("Tutte le modifiche sono state salvate con successo!", "success");
    } catch (err) {
      console.error("Errore salvataggio modifiche:", err);
      showToast("Errore durante il salvataggio definitivo.", "error");
    } finally {
      setSavingChanges(false);
    }
  };

  const [planningModal, setPlanningModal] = useState<{
    isOpen: boolean;
    tab?: 'commessa' | 'risorsa' | 'sostituisci';
    commessaId?: string;
    risorsa?: string;
    weekId?: string;
  }>({ isOpen: false });

  const handleCellClick = (dipNome: string, weekId: string, _weekLabel?: string, _weekSub?: string) => {
    setPlanningModal({
      isOpen: true,
      tab: 'risorsa',
      risorsa: dipNome,
      weekId: weekId
    });
  };

  const handleConfirmAssignments = async (e: React.FormEvent) => {
    e.preventDefault();
    if (allocAction !== 'rimuovi' && !selectedCommessaId) {
      showToast("Seleziona una commessa!", "warning");
      return;
    }
    
    if (!allocDataInizio || !allocDataFine) {
      showToast("Imposta la data di inizio e la data di fine del periodo!", "warning");
      return;
    }
    
    if (allocDataInizio > allocDataFine) {
      showToast("La data di inizio non può essere successiva alla data di fine.", "error");
      return;
    }

    const commObj = selectedCommessaId ? commesse.find(c => c.id === selectedCommessaId) : null;

    // Permissions check
    if (commObj) {
      const respStr = String(commObj.responsabile || '').trim();
      const pmArray = Array.isArray(commObj.pm) ? commObj.pm : (commObj.pm ? [commObj.pm] : []);
      const targets = [respStr, ...pmArray.map(p => String(p || '').trim())].filter(Boolean);
      
      const myDip = dipendenti.find(d => areNamesEqual(d.nome, myAssociatedName) || (d.email && userEmail && d.email.toLowerCase() === userEmail.toLowerCase()));
      const isPMOrResp = targets.some(t => 
        areNamesEqual(t, myAssociatedName) || 
        (myDip?.nome && areNamesEqual(t, myDip.nome)) ||
        (userEmail && (t.toLowerCase().includes(userEmail.toLowerCase()) || (userEmail.split('@')[0].length >= 4 && t.toLowerCase().includes(userEmail.split('@')[0]))))
      );
      const isUserAllowed = isAdmin || isSoci(myAssociatedName) || isPMOrResp;
      if (!isUserAllowed) {
        showToast("Non hai i permessi per pianificare risorse su questa commessa (solo Amministratori, Soci o il PM/Responsabile specifico della commessa sono autorizzati).", "error");
        return;
      }
    } else {
      // Operazione globale: solo Admin o Soci
      if (!isAdmin && !isSoci(myAssociatedName)) {
        showToast("Non hai i permessi per eseguire questa operazione globale (solo Amministratori o Soci possono liberare risorse o rimuovere commesse globalmente).", "error");
        return;
      }
    }

    if (allocAction === 'assegna') {
      if (selectedResourceNames.length === 0) {
        showToast("Seleziona almeno un dipendente!", "warning");
        return;
      }
      for (const resName of selectedResourceNames) {
        if (!resourcePercentages[resName]) {
          showToast(`Seleziona una percentuale per ${resName}!`, "warning");
          return;
        }
      }
    } else if (allocAction === 'rimuovi') {
      if (!selectedCommessaId && selectedResourceNames.length === 0) {
        showToast("Seleziona almeno una commessa o almeno una risorsa da cui rimuovere il carico di lavoro!", "warning");
        return;
      }
    } else if (allocAction === 'sostituisci') {
      if (!selectedCommessaId) {
        showToast("Seleziona la commessa per la sostituzione!", "warning");
        return;
      }
      if (!sourceResource || !targetResource) {
        showToast("Seleziona sia la risorsa da sostituire che la nuova risorsa!", "warning");
        return;
      }
      if (sourceResource === targetResource) {
        showToast("La risorsa di origine e di destinazione non possono essere identiche!", "warning");
        return;
      }
    }


    const updatedAssignments = { ...assignments };
    const newNotifications = [...draftNotifications];

    try {
      const targetWeekIds = getWeeksSpannedByDates(allocDataInizio, allocDataFine);

      if (allocAction === 'assegna') {
        if (!commObj) return;
        const entirePeriodOnLeaveResources: string[] = [];
        for (const resName of selectedResourceNames) {
          // Controlla se la risorsa è in ferie per l'intero periodo selezionato
          const isAllWeeksOnLeave = targetWeekIds.length > 0 && targetWeekIds.every(wkId => isFullWeekLeave(resName, wkId));
          if (isAllWeeksOnLeave) {
            entirePeriodOnLeaveResources.push(resName);
          }

          for (const wkId of targetWeekIds) {
            // SALTA la settimana se la risorsa è in ferie per tutta la settimana (5gg su 5)
            if (isFullWeekLeave(resName, wkId)) {
              continue;
            }

            const docId = `${resName}-${wkId}`;
            const baseDays = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven'];
            const allowedDays: string[] = [];

            const basePct = Number(resourcePercentages[resName] || '100');
            
            const coveredDays = getCoveredDaysInWeek(wkId, allocDataInizio, allocDataFine);
            if (coveredDays === 0) continue;

            for (const day of baseDays) {
              const dayDate = getWeekdayDate(wkId, day);
              const isWithinRange = (dayDate >= allocDataInizio && dayDate <= allocDataFine);
              
              if (isWithinRange) {
                allowedDays.push(day);
              }
            }

            const actualPct = basePct;

            if (actualPct === 0) continue;

            const currentList = updatedAssignments[docId] || [];
            const filteredList = currentList.filter(a => a.commessaId !== selectedCommessaId);

            const newAllocation = {
              commessaId: selectedCommessaId,
              commessaName: commObj.nome,
              percentuale: actualPct,
              colore: TIPOLOGIA_COLORS[commObj.tipologia || ''] || commObj.colore || '#64748b',
              giorni: allowedDays
            };

            updatedAssignments[docId] = [...filteredList, newAllocation];

            // Coda notifica
            const targetDip = dipendenti.find(d => d.nome === resName);
            if (targetDip && targetDip.email) {
              const wkLabel = `Sett. ${wkId.split('-W')[1] || ''}`;
              newNotifications.push({
                dipendenteNome: resName,
                email: targetDip.email,
                weekLabel: wkLabel,
                description: `Assegnata commessa: ${commObj.nome} (${actualPct}%)`
              });
            }
          }
        }
        showToast("Assegnazioni registrate in bozza!", "success");

        if (entirePeriodOnLeaveResources.length > 0) {
          setConfirmConfig({
            isOpen: true,
            title: '⚠️ Risorse in Ferie per l\'Intero Periodo',
            message: `Le seguenti risorse sono risultate in ferie per l'intero periodo selezionato e non è stata salvata alcuna assegnazione: ${entirePeriodOnLeaveResources.join(', ')}.`,
            type: 'warning',
            onConfirm: () => setConfirmConfig(prev => ({ ...prev, isOpen: false }))
          });
        }

      } else if (allocAction === 'rimuovi') {
        const hasCommessa = !!selectedCommessaId;
        const hasResources = selectedResourceNames.length > 0;
        const hasSpecificRemove = commesseToRemove.length > 0;

        if (hasResources && hasSpecificRemove) {
          for (const resName of selectedResourceNames) {
            for (const wkId of targetWeekIds) {
              const docId = `${resName}-${wkId}`;
              const currentList = updatedAssignments[docId] || [];
              const filteredList = currentList.filter((a: any) => !commesseToRemove.includes(a.commessaId));
              
              if (currentList.length !== filteredList.length) {
                if (filteredList.length === 0) {
                  delete updatedAssignments[docId];
                } else {
                  updatedAssignments[docId] = filteredList;
                }

                const removedNames = commesseToRemove
                  .map(cId => commesse.find(c => c.id === cId)?.nome || cId)
                  .join(', ');

                const targetDip = dipendenti.find(d => d.nome === resName);
                if (targetDip && targetDip.email) {
                  const wkLabel = `Sett. ${wkId.split('-W')[1] || ''}`;
                  newNotifications.push({
                    dipendenteNome: resName,
                    email: targetDip.email,
                    weekLabel: wkLabel,
                    description: `Rimosse commesse: ${removedNames}`
                  });
                }
              }
            }
          }
        } else if (hasCommessa && hasResources) {
          if (!commObj) return;
          for (const resName of selectedResourceNames) {
            for (const wkId of targetWeekIds) {
              const docId = `${resName}-${wkId}`;
              const currentList = updatedAssignments[docId] || [];
              const filteredList = currentList.filter((a: any) => a.commessaId !== selectedCommessaId);
              
              if (currentList.length !== filteredList.length) {
                if (filteredList.length === 0) {
                  delete updatedAssignments[docId];
                } else {
                  updatedAssignments[docId] = filteredList;
                }

                const targetDip = dipendenti.find(d => d.nome === resName);
                if (targetDip && targetDip.email) {
                  const wkLabel = `Sett. ${wkId.split('-W')[1] || ''}`;
                  newNotifications.push({
                    dipendenteNome: resName,
                    email: targetDip.email,
                    weekLabel: wkLabel,
                    description: `Rimossa commessa: ${commObj?.nome || ''}`
                  });
                }
              }
            }
          }
        } else if (hasCommessa && !hasResources) {
          if (!commObj) return;
          for (const dip of dipendenti) {
            const resName = dip.nome;
            for (const wkId of targetWeekIds) {
              const docId = `${resName}-${wkId}`;
              const currentList = updatedAssignments[docId] || [];
              const filteredList = currentList.filter((a: any) => a.commessaId !== selectedCommessaId);
              
              if (currentList.length !== filteredList.length) {
                if (filteredList.length === 0) {
                  delete updatedAssignments[docId];
                } else {
                  updatedAssignments[docId] = filteredList;
                }

                if (dip.email) {
                  const wkLabel = `Sett. ${wkId.split('-W')[1] || ''}`;
                  newNotifications.push({
                    dipendenteNome: resName,
                    email: dip.email,
                    weekLabel: wkLabel,
                    description: `Rimossa commessa: ${commObj?.nome || ''}`
                  });
                }
              }
            }
          }
        } else if (!hasCommessa && hasResources) {
          for (const resName of selectedResourceNames) {
            for (const wkId of targetWeekIds) {
              const docId = `${resName}-${wkId}`;
              delete updatedAssignments[docId];

              const targetDip = dipendenti.find(d => d.nome === resName);
              if (targetDip && targetDip.email) {
                const wkLabel = `Sett. ${wkId.split('-W')[1] || ''}`;
                newNotifications.push({
                  dipendenteNome: resName,
                  email: targetDip.email,
                  weekLabel: wkLabel,
                  description: `Svuotato carico di lavoro (rimosse tutte le commesse)`
                });
              }
            }
          }
        }
        showToast("Rimozioni registrate in bozza!", "success");

      } else if (allocAction === 'sostituisci') {
        if (!commObj) return;
        // Avviso pop-up ferie rimosso per sostituzione

        for (const wkId of targetWeekIds) {
          const docIdA = `${sourceResource}-${wkId}`;
          const currentListA = updatedAssignments[docIdA] || [];

          const oldAlloc = currentListA.find((a: any) => a.commessaId === selectedCommessaId);
          if (!oldAlloc) {
            continue;
          }

          // Remove allocation from A
          const updatedListA = currentListA.filter((a: any) => a.commessaId !== selectedCommessaId);
          if (updatedListA.length === 0) {
            delete updatedAssignments[docIdA];
          } else {
            updatedAssignments[docIdA] = updatedListA;
          }

          // Copy and adjust percentage/days for B (targetResource)
          const basePct = oldAlloc.percentuale;
          const baseDays = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven'];
          const allowedDaysB: string[] = [];

          for (const day of baseDays) {
            const dayDate = getWeekdayDate(wkId, day);
            const isWithinRange = (dayDate >= allocDataInizio && dayDate <= allocDataFine);
            if (isWithinRange) {
              allowedDaysB.push(day);
            }
          }

          const actualPctB = basePct;
          const wkLabel = `Sett. ${wkId.split('-W')[1] || ''}`;

          if (actualPctB > 0) {
            const docIdB = `${targetResource}-${wkId}`;
            const currentListB = updatedAssignments[docIdB] || [];
            
            const filteredListB = currentListB.filter((a: any) => a.commessaId !== selectedCommessaId);
            const newAllocationB = {
              commessaId: selectedCommessaId,
              commessaName: commObj.nome,
              percentuale: actualPctB,
              colore: TIPOLOGIA_COLORS[commObj.tipologia || ''] || commObj.colore || '#64748b',
              giorni: allowedDaysB
            };
            updatedAssignments[docIdB] = [...filteredListB, newAllocationB];
          }

          // Coda notifica A
          const targetDipA = dipendenti.find(d => d.nome === sourceResource);
          if (targetDipA && targetDipA.email) {
            newNotifications.push({
              dipendenteNome: sourceResource,
              email: targetDipA.email,
              weekLabel: wkLabel,
              description: `Sostituito da ${targetResource} per la commessa ${commObj.nome}`
            });
          }

          // Coda notifica B
          const targetDipB = dipendenti.find(d => d.nome === targetResource);
          if (targetDipB && targetDipB.email) {
            newNotifications.push({
              dipendenteNome: targetResource,
              email: targetDipB.email,
              weekLabel: wkLabel,
              description: `Assegnato alla commessa ${commObj.nome} in sostituzione di ${sourceResource} (${actualPctB}%)${actualPctB < basePct ? ' [Percentuale ricalcolata per ferie/assenza]' : ''}`
            });
          }
        }
        showToast("Sostituzioni registrate in bozza!", "success");
      }

      setAssignments(updatedAssignments);
      setDraftNotifications(newNotifications);
      setIsDirty(true);

      // Reset selection states
      setSelectedResourceNames([]);
      setAllocDataInizio('');
      setAllocDataFine('');
      setSourceResource('');
      setTargetResource('');
      setSelectedCommessaId('');
      setCommessaSearchText('');
      setCommesseToRemove([]);


    } catch (err) {
      console.error("Errore salvataggio locale:", err);
      showToast("Si è verificato un errore durante la modifica locale.", "error");
    }
  };





  const filteredGridDipendenti = useMemo(() => {
    const timelineStart = timelineWeeks[0]?.dateObj;
    const timelineStartStr = timelineStart ? timelineStart.toLocaleDateString('sv-SE') : '';
    
    let list = dipendenti.filter(d => !isTechnicalUser(d));
    if (timelineStartStr) {
      list = list.filter(d => !d.dataCessazione || d.dataCessazione >= timelineStartStr);
    }
    
    if (!gridSearchQuery) return list;
    return list.filter(d => d.nome.toLowerCase().includes(gridSearchQuery.toLowerCase()));
  }, [dipendenti, gridSearchQuery, timelineWeeks]);

  const employees = useMemo(() => {
    return filteredGridDipendenti.filter(d => !isCollaboratore(d.nome, d.tipo));
  }, [filteredGridDipendenti]);

  const collaborators = useMemo(() => {
    return filteredGridDipendenti.filter(d => isCollaboratore(d.nome, d.tipo));
  }, [filteredGridDipendenti]);

  // myCoordinatedAreas è ora definito in cima (riga ~201) per poter essere usato in filteredDipendenti

  const isCoordinatoreQualsiasi = useMemo(() => {
    return myCoordinatedAreas.length > 0;
  }, [myCoordinatedAreas]);

  // Un dipendente normale: non è admin, non è socio, non è coordinatore, non è PM
  const isDipendenteNormale = useMemo(() => {
    return !isAdmin && !isSoci(myAssociatedName) && !isCoordinatoreQualsiasi && !isPMOrResponsabile;
  }, [isAdmin, myAssociatedName, isCoordinatoreQualsiasi, isPMOrResponsabile]);
  const disegnatori = useMemo(() => {
    return filteredGridDipendenti.filter(d => !isSoci(d.nome) && d.macroArea === 'Disegnatori');
  }, [filteredGridDipendenti]);

  const ingegneria = useMemo(() => {
    return filteredGridDipendenti.filter(d => !isSoci(d.nome) && d.macroArea === 'Ingegneria');
  }, [filteredGridDipendenti]);

  const sicurezzaCantieri = useMemo(() => {
    return filteredGridDipendenti.filter(d => !isSoci(d.nome) && d.macroArea === 'Sicurezza Cantieri');
  }, [filteredGridDipendenti]);

  const consulenzaSicurezza = useMemo(() => {
    return filteredGridDipendenti.filter(d => !isSoci(d.nome) && d.macroArea === 'Consulenza Sicurezza');
  }, [filteredGridDipendenti]);

  const amministrazione = useMemo(() => {
    return filteredGridDipendenti.filter(d => !isSoci(d.nome) && d.macroArea === 'Amministrazione');
  }, [filteredGridDipendenti]);

  const nonAssegnati = useMemo(() => {
    return filteredGridDipendenti.filter(d => !isSoci(d.nome) && !d.macroArea);
  }, [filteredGridDipendenti]);

  const handleExportGridToExcel = () => {
    let csvContent = "\uFEFF"; // UTF-8 BOM
    
    // Costruiamo gli header
    const headers = ["Dipendente", "Tipo"];
    timelineWeeks.forEach(wk => {
      headers.push(`${wk.label} (${wk.sub})`);
      headers.push(`Assenze ${wk.label}`);
    });
    csvContent += headers.join(";") + "\n";

    // Righe dati
    const allDeps = [...employees, ...collaborators];
    allDeps.forEach(dip => {
      const isCollab = isCollaboratore(dip.nome, dip.tipo);
      const row = [
        dip.nome,
        isCollab ? "Collaboratore P. IVA" : "Dipendente"
      ];
      
      timelineWeeks.forEach(wk => {
        const key = `${dip.nome}-${wk.id}`;
        const list = assignments[key] || [];
        const leaves = getLeavesForResourceInWeek(dip.nome, wk.id);
        const totalLoad = calculateWeeklyLoad(dip.nome, wk.id, list);
        row.push(`${totalLoad}%`);
        
        const leavesStr = leaves.map(l => `${l.giorno}: ${l.dettagli}`).join(" | ");
        row.push(leavesStr || "Nessuna");
      });
      
      csvContent += row.map(val => `"${val.replace(/"/g, '""')}"`).join(";") + "\n";
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `Carichi_Lavoro_${timelineWeeks[0].id}_a_${timelineWeeks[timelineWeeks.length - 1].id}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleSendPendingNotifications = async () => {
    setSendingNotifications(true);
    try {
      await sendAllPendingNotifications();
      showToast("Notifiche inviate con successo!");
      updatePendingNotificationsCount();
    } catch (err) {
      console.error(err);
      showToast("Errore durante l'invio delle notifiche.", "error");
    } finally {
      setSendingNotifications(false);
    }
  };

  const handleIgnorePendingNotifications = () => {
    setConfirmConfig({
      isOpen: true,
      title: "Ignora Notifiche",
      message: "Sei sicuro di voler ignorare e cancellare tutte le notifiche in sospeso per questa sessione? I dipendenti non riceveranno alcuna email sulle modifiche apportate.",
      type: "warning",
      onConfirm: () => {
        clearPendingNotifications();
        showToast("Notifiche in sospeso cancellate.");
        updatePendingNotificationsCount();
        setConfirmConfig(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  const renderEmployeeRow = (dip: Dipendente, parentAreaName: string, _rowIndex: number = 0, _totalRows: number = 1) => {
    const isCoordinatoreArea = myCoordinatedAreas.includes(parentAreaName);
    // Può modificare la cella se è admin/socio, o coordinatore di quest'area
    const isEditable = isAdmin || isSoci(myAssociatedName) || isCoordinatoreArea;
    const isResponsabileDiQuestArea = coordinatori.some(c => 
      ((c.email && dip.email && c.email.toLowerCase().trim() === dip.email.toLowerCase().trim()) || areNamesEqual(c.email, dip.nome)) && 
      c.area === parentAreaName
    );

    let areaColorClass = "border-l-4 border-slate-350 bg-slate-50/20 text-slate-900";
    if (parentAreaName === 'Disegnatori') {
      areaColorClass = "border-l-4 border-teal-500 bg-teal-50/30 text-teal-950";
    } else if (parentAreaName === 'Ingegneria') {
      areaColorClass = "border-l-4 border-indigo-500 bg-indigo-50/30 text-indigo-950";
    } else if (parentAreaName === 'Sicurezza Cantieri') {
      areaColorClass = "border-l-4 border-emerald-500 bg-emerald-50/30 text-emerald-950";
    } else if (parentAreaName === 'Consulenza Sicurezza') {
      areaColorClass = "border-l-4 border-amber-500 bg-amber-50/30 text-amber-950";
    } else if (parentAreaName === 'Amministrazione') {
      areaColorClass = "border-l-4 border-blue-500 bg-blue-50/30 text-blue-950";
    }

    return (
      <tr key={dip.id} className="hover:bg-indigo-50/20 transition-colors bg-white">
        <td 
          className={`p-4 text-left font-bold sticky left-0 z-10 shadow-[1px_0_0_0_#f3f4f6] border-b align-middle pl-8 ${areaColorClass}`}
          style={{ width: '180px', minWidth: '180px', maxWidth: '180px' }}
        >
          <div className="flex flex-col gap-0.5 truncate">
            <div className="flex items-center gap-1.5 truncate">
              <span className="text-gray-400 text-[10px] shrink-0">↳</span>
              <span className="truncate" title={dip.nome}>{dip.nome}</span>
            </div>
            {isResponsabileDiQuestArea && (
              <span className="text-[8px] font-black text-teal-700 ml-4.5 bg-teal-50 border border-teal-150 px-1.5 py-0.5 rounded-md w-fit uppercase tracking-wider select-none shrink-0">
                Responsabile
              </span>
            )}
          </div>
        </td>
        
        {timelineWeeks.map((wk, wIndex) => {
          const key = `${dip.nome}-${wk.id}`;
          const list = assignments[key] || [];
          const leaves = getLeavesForResourceInWeek(dip.nome, wk.id);
          const totalLoad = calculateWeeklyLoad(dip.nome, wk.id, list);
          
          const dbList = dbAssignments[key] || [];
          const isCellModified = isDirty && (
            list.length !== dbList.length ||
            list.some((item, idx) => {
              const dbItem = dbList[idx];
              return !dbItem || item.commessaId !== dbItem.commessaId || item.percentuale !== dbItem.percentuale;
            })
          );

          const weekStartStr = wk.dateObj ? wk.dateObj.toLocaleDateString('sv-SE') : '';
          const isWeekCessato = dip.dataCessazione && weekStartStr && weekStartStr > dip.dataCessazione;

          const isSelfRow = (dip.email?.toLowerCase() === (userEmail || '').toLowerCase()) || areNamesEqual(dip.nome, myAssociatedName);
          // Admin/Soci, Coordinatori e PM della commessa possono sempre editare le risorse in pianificazione (o se stessi se coordinatori)
          const canDirectlyEditCell = !isWeekCessato && (isEditable || isPMOrResponsabile || isAdmin || isSoci(myAssociatedName) || isCoordinatoreArea || (isCoordinatoreQualsiasi && isSelfRow));

          let bgClass = isWeekCessato 
            ? "bg-slate-400/90 text-white font-bold text-center" 
            : "bg-slate-50/50 text-slate-400 font-bold";
          if (canDirectlyEditCell) bgClass += " hover:bg-slate-100/60";
          let indicatorColor = "bg-slate-400"; // Grigio scuro per 0%

          const isFullLeave = isFullWeekLeave(dip.nome, wk.id);

          if (totalLoad > 0) {
            if (totalLoad <= 60) {
              bgClass = canDirectlyEditCell 
                ? "bg-sky-50 text-sky-900 hover:bg-sky-100/80 font-bold" 
                : "bg-sky-50 text-sky-900 font-bold";
              indicatorColor = "bg-sky-500"; // Celeste acceso per sotto-utilizzato
            } else if (totalLoad > 60 && totalLoad <= 110) {
              bgClass = canDirectlyEditCell 
                ? "bg-emerald-50 text-emerald-900 hover:bg-emerald-100/80 font-bold" 
                : "bg-emerald-50 text-emerald-900 font-bold";
              indicatorColor = "bg-emerald-500"; // Verde acceso per ottimale
            } else {
              bgClass = canDirectlyEditCell 
                ? "bg-rose-50 text-rose-900 hover:bg-rose-100/90 font-black" 
                : "bg-rose-50 text-rose-900 font-black";
              indicatorColor = "bg-rose-600"; // Rosso acceso per sovraccarico
            }
          }

          const ferieCount = leaves.filter(l => l.tipo === 'ferie' || l.tipo === 'assenza').length;
          const malattiaCount = leaves.filter(l => l.tipo === 'malattia').length;
          const maternitaCount = leaves.filter(l => l.tipo === 'maternita').length;
          const permessoCount = leaves.filter(l => l.tipo === 'permesso' || l.tipo === 'mattina' || l.tipo === 'pomeriggio').length;
          const smartCount = leaves.filter(l => l.tipo === 'smart').length;

          const cellBgStyle: React.CSSProperties | undefined = isFullLeave ? {
            backgroundImage: 'repeating-linear-gradient(45deg, #dbeafe 0px, #dbeafe 10px, #eff6ff 10px, #eff6ff 20px)'
          } : undefined;

          return (
            <td 
              key={wIndex} 
              onMouseDown={(e) => {
                if (canDirectlyEditCell && e.button === 1) e.preventDefault();
              }}
              onAuxClick={(e) => {
                if (canDirectlyEditCell && e.button === 1) {
                  e.preventDefault();
                  e.stopPropagation();
                  window.open(`/pianificazione-personale?tab=risorsa&risorsa=${encodeURIComponent(dip.nome)}&weekId=${encodeURIComponent(wk.id)}`, '_blank');
                }
              }}
              onClick={(e) => {
                if (canDirectlyEditCell && e.button === 0) {
                  e.preventDefault();
                  handleCellClick(dip.nome, wk.id, wk.label, wk.sub);
                }
              }}
              className={`border-l border-b border-slate-900 align-middle transition-colors ${canDirectlyEditCell ? 'cursor-pointer' : 'cursor-default'} ${bgClass} ${
                isUltraNarrow ? 'p-1' : isNarrow ? 'p-1.5' : 'p-3'
              }`}
              style={{ 
                minWidth: weekColumnMinWidth, 
                width: weekColumnMinWidth,
                outline: isCellModified ? '2px dashed #d97706' : undefined,
                outlineOffset: '-2px',
                ...cellBgStyle
              }}
            >
              <div 
                onMouseEnter={(e) => {
                  const hasContent = (!isFullLeave && list.length > 0) || leaves.length > 0;
                  if (hasContent) {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setHoveredCellTooltip({
                      rect,
                      dipNome: dip.nome,
                      wkLabel: wk.label,
                      list,
                      leaves,
                      isFullLeave
                    });
                  }
                }}
                onMouseLeave={() => {
                  setHoveredCellTooltip(null);
                }}
                className="flex flex-col items-center justify-center relative"
                style={{ 
                  minHeight: isNarrow ? '40px' : '56px',
                  gap: isUltraNarrow ? '1px' : '2px'
                }}
              >
                {isWeekCessato ? (
                  <span className={`${isUltraNarrow ? 'text-[10px]' : 'text-xs'} font-black text-white/95`}>X</span>
                ) : (
                  <>
                    <span className={`${isUltraNarrow ? 'text-[10px]' : 'text-xs'} font-black`}>{totalLoad}%</span>
                    
                    {!isUltraNarrow && (
                      <span className={`w-1.5 h-1.5 rounded-full shadow-sm no-print ${indicatorColor}`}></span>
                    )}

                    {leaves.length > 0 && (
                      <div className="flex gap-0.5 justify-center mt-0.5 w-full flex-wrap">
                        {isUltraNarrow ? (
                          <span className="text-[9px]" title="Assenze presenti">⚠️</span>
                        ) : isNarrow ? (
                          <span className="text-[9px] font-extrabold px-1 rounded bg-orange-100 text-orange-750" title={`${leaves.length} assenze`}>
                            ⚠️ {leaves.length}g
                          </span>
                        ) : (
                          <>
                            {ferieCount > 0 && (
                              <span className="text-[9.5px] font-extrabold px-1.5 py-0.5 rounded leading-none bg-orange-100 text-orange-700 border border-orange-200" title="Ferie">
                                🌴 {ferieCount}g
                              </span>
                            )}
                            {malattiaCount > 0 && (
                              <span className="text-[9.5px] font-extrabold px-1.5 py-0.5 rounded leading-none bg-red-100 text-red-700 border border-red-200" title="Malattia">
                                🤒 {malattiaCount}g
                              </span>
                            )}
                            {maternitaCount > 0 && (
                              <span className="text-[9.5px] font-extrabold px-1.5 py-0.5 rounded leading-none bg-pink-100 text-pink-700 border border-pink-200" title="Maternità">
                                🍼 {maternitaCount}g
                              </span>
                            )}
                            {permessoCount > 0 && (
                              <span className="text-[9.5px] font-extrabold px-1.5 py-0.5 rounded leading-none bg-purple-100 text-purple-700 border border-purple-200" title="Permessi / Ass. parziale">
                                ⏱️ {permessoCount}g
                              </span>
                            )}
                            {smartCount > 0 && (
                              <span className="text-[9.5px] font-extrabold px-1.5 py-0.5 rounded leading-none bg-indigo-100 text-indigo-700 border border-indigo-200" title="Smart Working">
                                🏠 {smartCount}g
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </td>
          );
        })}
      </tr>
    );
  };

  const renderAreaRow = (areaName: string, members: Dipendente[]) => {
    const isMyCoordinatedArea = myCoordinatedAreas.includes(areaName);
    // PM possono espandere la loro area di appartenenza
    const isPMInThisArea = isPMOrResponsabile && (myMacroArea === areaName || isMyCoordinatedArea);
    const canExpand = isAdmin || isSoci(myAssociatedName) || isMyCoordinatedArea || isPMInThisArea;
    const isExpanded = expandedAreas[areaName];

    const toggleExpand = () => {
      if (!canExpand) return;
      setExpandedAreas(prev => ({
        ...prev,
        [areaName]: !prev[areaName]
      }));
    };

    return (
      <>
        <tr 
          onClick={toggleExpand}
          className={`bg-slate-100 hover:bg-slate-150 transition-colors font-extrabold text-xs select-none border-b border-slate-200 ${canExpand ? 'cursor-pointer' : 'cursor-default'}`}
        >
          {(() => {
            let areaHeaderClass = "bg-slate-100 text-slate-900 border-t-2 border-slate-900";
            if (areaName === 'Disegnatori') {
              areaHeaderClass = "bg-teal-100 text-teal-950 border-t-2 border-teal-600";
            } else if (areaName === 'Ingegneria') {
              areaHeaderClass = "bg-indigo-100 text-indigo-955 border-t-2 border-indigo-600";
            } else if (areaName === 'Sicurezza Cantieri') {
              areaHeaderClass = "bg-emerald-100 text-emerald-955 border-t-2 border-emerald-600";
            } else if (areaName === 'Consulenza Sicurezza') {
              areaHeaderClass = "bg-amber-100 text-amber-955 border-t-2 border-amber-600";
            } else if (areaName === 'Amministrazione') {
              areaHeaderClass = "bg-blue-100 text-blue-955 border-t-2 border-blue-600";
            }

            return (
              <td 
                className={`p-4 text-left font-black sticky left-0 z-10 shadow-[1px_0_0_0_#e2e8f0] border-b align-middle truncate ${areaHeaderClass}`}
                style={{ width: '180px', minWidth: '180px', maxWidth: '180px' }}
              >
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-500 w-3 text-center">
                    {canExpand ? (isExpanded ? '▼' : '▶') : ''}
                  </span>
                  <span className="uppercase tracking-wider">{areaName} ({members.length})</span>
                </div>
              </td>
            );
          })()}

          {timelineWeeks.map((wk, wIndex) => {
            const avgLoad = members.length === 0 ? 0 : Math.round(
              members.reduce((sum, dip) => {
                const key = `${dip.nome}-${wk.id}`;
                const list = assignments[key] || [];
                const dipLoad = calculateWeeklyLoad(dip.nome, wk.id, list);
                return sum + dipLoad;
              }, 0) / members.length
            );

            let bgClass = "bg-slate-50 text-slate-400 font-bold";
            let indicatorColor = "bg-slate-400"; // Grigio scuro per 0%

            if (avgLoad > 0) {
              if (avgLoad <= 60) {
                bgClass = "bg-sky-50/70 text-sky-900 font-bold";
                indicatorColor = "bg-sky-500"; // Celeste acceso per sotto-utilizzato (> 0% a 60%)
              } else if (avgLoad > 60 && avgLoad <= 110) {
                bgClass = "bg-emerald-50/70 text-emerald-900 font-bold";
                indicatorColor = "bg-emerald-500"; // Verde acceso per ottimale (> 60% a 110%)
              } else {
                bgClass = "bg-rose-50/75 text-rose-900 font-black";
                indicatorColor = "bg-rose-600"; // Rosso acceso per sovraccarico (> 110%)
              }
            }

            let areaTopBorder = "border-t-2 border-slate-900";
            if (areaName === 'Disegnatori') areaTopBorder = "border-t-2 border-teal-600";
            else if (areaName === 'Ingegneria') areaTopBorder = "border-t-2 border-indigo-600";
            else if (areaName === 'Sicurezza Cantieri') areaTopBorder = "border-t-2 border-emerald-600";
            else if (areaName === 'Consulenza Sicurezza') areaTopBorder = "border-t-2 border-amber-600";
            else if (areaName === 'Amministrazione') areaTopBorder = "border-t-2 border-blue-600";

            return (
              <td 
                key={wIndex} 
                className={`border-l border-b ${areaTopBorder} border-slate-900 align-middle transition-colors ${bgClass} ${
                  isUltraNarrow ? 'p-1' : isNarrow ? 'p-1.5' : 'p-3'
                }`}
                style={{ 
                  minWidth: weekColumnMinWidth, 
                  width: weekColumnMinWidth,
                }}
              >
                <div 
                  className="flex flex-col items-center justify-center relative"
                  style={{ 
                    minHeight: isNarrow ? '40px' : '56px',
                    gap: isUltraNarrow ? '1px' : '2px'
                  }}
                >
                  <span className={`${isUltraNarrow ? 'text-[10px]' : 'text-xs'} font-black`}>{avgLoad}%</span>
                  {!isUltraNarrow && (
                    <span className={`w-1.5 h-1.5 rounded-full no-print ${indicatorColor}`}></span>
                  )}
                </div>
              </td>
            );
          })}
        </tr>

        {isExpanded && (
          members.length === 0 ? (
            <tr>
              <td colSpan={timelineWeeks.length + 1} className="p-4 text-center text-gray-400 italic bg-white pl-8">
                Nessuna risorsa in questa area.
              </td>
            </tr>
          ) : (
            (() => {
              const sortedMembers = [...members].sort((a, b) => {
                const isACoord = coordinatori.some(c => ((c.email && a.email && c.email.toLowerCase().trim() === a.email.toLowerCase().trim()) || areNamesEqual(c.email, a.nome)) && c.area === areaName);
                const isBCoord = coordinatori.some(c => ((c.email && b.email && c.email.toLowerCase().trim() === b.email.toLowerCase().trim()) || areNamesEqual(c.email, b.nome)) && c.area === areaName);
                if (isACoord && !isBCoord) return -1;
                if (!isACoord && isBCoord) return 1;
                return a.nome.localeCompare(b.nome);
              });
              return sortedMembers.map((dip, idx) => renderEmployeeRow(dip, areaName, idx, sortedMembers.length));
            })()
          )
        )}
      </>
    );
  };

  const shiftGridPeriod = (weeksOffset: number) => {
    setGridBaseDate(prev => addDays(prev, weeksOffset * 7));
  };

  return (
    <div className="flex flex-col gap-6">
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
      
      {/* HEADER */}
      <div className="bg-white/80 backdrop-blur-xl rounded-[2rem] shadow-sm p-4 sm:p-6 border border-white/50 no-print flex flex-col md:flex-row justify-between items-center gap-4">
        <h2 className="text-3xl font-extrabold text-gray-900 flex items-center gap-3">
          <div className="p-3 bg-indigo-100 rounded-2xl"><Users className="text-indigo-600 w-8 h-8" /></div>
          <div className="flex items-center gap-3">
            <span>Pianificazione del Personale e Carichi</span>
            {richiesteDisegnatori.filter(r => canUserManageRequest(r)).length > 0 && (
              <div className="inline-flex items-center gap-1.5 bg-gradient-to-r from-red-600 to-rose-600 text-white text-[11px] font-black px-3 py-1.5 rounded-2xl shadow-md animate-pulse ml-2 border border-red-400">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
                </span>
                <span>
                  {richiesteDisegnatori.filter(r => canUserManageRequest(r)).length} RICHIESTE IN ATTESA DA GESTIRE
                </span>
              </div>
            )}

            {myCoordinatedAreas.length > 0 &&
              segnalazioniDisponibilita.filter(s => {
                if (s.stato !== 'in_attesa') return false;
                return myCoordinatedAreas.includes(s.macroArea);
              }).length > 0 && (
              <div className="inline-flex items-center gap-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-[11px] font-black px-3 py-1.5 rounded-2xl shadow-md animate-pulse ml-2 border border-emerald-400">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
                </span>
                <span>
                  🙋 {segnalazioniDisponibilita.filter(s => {
                    if (s.stato !== 'in_attesa') return false;
                    return myCoordinatedAreas.includes(s.macroArea);
                  }).length} RISORSE SCARICHE DA ASSEGNARE
                </span>
              </div>
            )}

            <button 
              onClick={() => window.location.reload()}
              title="Aggiorna Dati"
              className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 border border-transparent hover:border-indigo-100 rounded-xl transition-all cursor-pointer hover:rotate-180 duration-500"
            >
              <RefreshCw className="w-4 h-4" />
            </button>

            {myAssociatedName && !isAdmin && !isSoci(myAssociatedName) && myCoordinatedAreas.length === 0 && (
              <button
                type="button"
                onClick={() => setIsAvailabilityModalOpen(true)}
                className="flex items-center gap-1.5 px-3.5 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border border-emerald-300 rounded-xl text-xs font-black transition shadow-2xs cursor-pointer ml-2"
              >
                <UserCheck className="w-4 h-4 text-emerald-600" />
                <span>Segnala Disponibilità / Chiedi Lavoro</span>
              </button>
            )}

            {(() => {
              const pendingCount = (myRecentSentRequests || []).filter((r: any) => r.stato === 'in_attesa').length;

              return (
                <button
                  type="button"
                  onClick={() => setShowMySentRequestsModal(true)}
                  className="flex items-center gap-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-900 border border-indigo-200 px-3.5 py-2 rounded-xl text-xs font-extrabold transition shadow-2xs active:scale-95 cursor-pointer ml-2"
                >
                  <Clock className="w-4 h-4 text-indigo-600" />
                  <span>Storico Mie Richieste Inviate</span>
                  {pendingCount > 0 && (
                    <span className="inline-flex items-center gap-1 bg-amber-500 text-white text-[10px] font-black px-2 py-0.5 rounded-full shadow-xs border border-amber-400 animate-pulse">
                      <span className="relative flex h-1.5 w-1.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-white"></span>
                      </span>
                      <span>{pendingCount} in lavorazione</span>
                    </span>
                  )}
                </button>
              );
            })()}
          </div>
        </h2>
      </div>

      {/* SEZIONE NOTIFICA RISORSE SCARICHE CHE RICHIEDONO LAVORO (PER COORDINATORI D'AREA) */}
      {(() => {
        const visibleSegnalazioni = segnalazioniDisponibilita.filter(s => {
          if (s.stato !== 'in_attesa') return false;
          return myCoordinatedAreas.includes(s.macroArea);
        });

        if (visibleSegnalazioni.length === 0) return null;

        return (
          <div className="bg-emerald-50/90 border border-emerald-300 rounded-[2rem] p-5 shadow-sm space-y-3 no-print animate-in fade-in duration-200">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2.5">
                <UserCheck className="w-5 h-5 text-emerald-700 animate-bounce" />
                <h3 className="font-extrabold text-sm text-emerald-950">
                  🙋 Risorse Scariche che Richiedono Lavoro ({visibleSegnalazioni.length})
                </h3>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold text-emerald-800 bg-emerald-100 px-3 py-1 rounded-full border border-emerald-200">
                  Coordinamento Area
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {visibleSegnalazioni.map(s => {
                const risorsaNome = s.risorsaNome || s.dipendenteNome || 'Risorsa';
                const periodoLabel = s.settimanaLabel || (s.dataInizio && s.dataFine ? `${s.dataInizio} → ${s.dataFine}` : s.settimana || 'Periodo corrente');
                const notaContent = s.nota || s.note || '';

                return (
                  <div key={s.id} className="bg-white p-4 rounded-2xl border border-emerald-200 shadow-xs flex flex-col justify-between gap-3 hover:border-emerald-300 transition-all">
                    <div className="space-y-1.5">
                      <div className="flex justify-between items-center">
                        <span className="font-extrabold text-sm text-gray-900">{risorsaNome}</span>
                        <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                          {s.macroArea}
                        </span>
                      </div>
                      <p className="text-xs text-gray-600">
                        Disponibilità: <strong className="text-emerald-950">{periodoLabel}</strong>
                      </p>
                      {notaContent && (
                        <p className="text-xs text-gray-600 italic bg-gray-50 p-2.5 rounded-xl border border-gray-100">
                          &ldquo;{notaContent}&rdquo;
                        </p>
                      )}
                      {s.timestamp && (
                        <p className="text-[10px] text-gray-400 font-medium pt-0.5">
                          Ricevuta: {new Date(s.timestamp).toLocaleDateString('it-IT')} alle {new Date(s.timestamp).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
                      <button
                        type="button"
                        onClick={() => handlePianificaRisorsaDaSegnalazione(risorsaNome)}
                        className="flex-1 py-2 px-3 bg-indigo-600 hover:bg-indigo-700 active:scale-95 text-white font-extrabold text-xs rounded-xl shadow-xs transition cursor-pointer text-center flex items-center justify-center gap-1.5"
                        title="Imposta la vista sulla risorsa per assegnarla alle commesse"
                      >
                        <Calendar className="w-3.5 h-3.5" />
                        <span>Pianifica Risorsa</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setSegnalazioneToManage(s);
                          setIsConfirmManageOpen(true);
                        }}
                        className="py-2 px-3 bg-emerald-100 hover:bg-emerald-200 active:scale-95 text-emerald-900 border border-emerald-300 font-extrabold text-xs rounded-xl transition cursor-pointer text-center"
                        title="Segna come gestita dopo aver assegnato il lavoro"
                      >
                        ✓ Gestita
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* SEZIONE GESTIONE RICHIESTE PERSONALE (per tutte le aree) */}
      {(() => {
        // Determina quali richieste può gestire l'utente loggato (in base a tipo richiesta, responsabile commessa o coordinatore d'area, ed escludendo le proprie)
        const visibleReqs = richiesteDisegnatori.filter(r => canUserManageRequest(r));

        if (visibleReqs.length === 0) return null;

        // Raggruppa per area
        const byArea: Record<string, typeof visibleReqs> = {};
        visibleReqs.forEach(req => {
          const a = req.area || 'Disegnatori';
          if (!byArea[a]) byArea[a] = [];
          byArea[a].push(req);
        });

        const areaColors: Record<string, { bg: string; border: string; heading: string; badge: string; btn: string; select: string }> = {
          'Disegnatori':          { bg: 'from-teal-50 to-emerald-50', border: 'border-teal-100', heading: 'text-teal-900', badge: 'bg-teal-100 text-teal-800', btn: 'bg-teal-600 hover:bg-teal-700', select: 'border-teal-200 focus:ring-teal-500' },
          'Ingegneria':           { bg: 'from-indigo-50 to-blue-50', border: 'border-indigo-100', heading: 'text-indigo-900', badge: 'bg-indigo-100 text-indigo-800', btn: 'bg-indigo-600 hover:bg-indigo-700', select: 'border-indigo-200 focus:ring-indigo-500' },
          'Sicurezza Cantieri':   { bg: 'from-emerald-50 to-green-50', border: 'border-emerald-100', heading: 'text-emerald-900', badge: 'bg-emerald-100 text-emerald-800', btn: 'bg-emerald-600 hover:bg-emerald-700', select: 'border-emerald-200 focus:ring-emerald-500' },
          'Consulenza Sicurezza': { bg: 'from-amber-50 to-yellow-50', border: 'border-amber-100', heading: 'text-amber-900', badge: 'bg-amber-100 text-amber-800', btn: 'bg-amber-600 hover:bg-amber-700', select: 'border-amber-200 focus:ring-amber-500' },
          'Amministrazione':      { bg: 'from-blue-50 to-sky-50', border: 'border-blue-100', heading: 'text-blue-900', badge: 'bg-blue-100 text-blue-800', btn: 'bg-blue-600 hover:bg-blue-700', select: 'border-blue-200 focus:ring-blue-500' },
        };

        const getMembersForArea = (areaName: string): Dipendente[] => {
          return dipendenti.filter(d => !isSoci(d.nome) && d.macroArea === areaName);
        };

        return Object.entries(byArea).map(([areaName, areaReqs]) => {
          const colors = areaColors[areaName] || areaColors['Disegnatori'];
          const areaMembers = getMembersForArea(areaName);

          return (
            <div key={areaName} className={`bg-gradient-to-br ${colors.bg} rounded-[2rem] p-6 border ${colors.border} shadow-sm space-y-4 no-print animate-in fade-in duration-300`}>
              <h3 className={`text-xl font-bold ${colors.heading} flex items-center gap-2`}>
                📥 Richieste Personale — {areaName} ({areaReqs.length} in attesa)
              </h3>
              <p className="text-xs text-gray-600/80">Valuta i carichi di lavoro correnti ed assegna la risorsa definitiva per approvare la richiesta.</p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {areaReqs.map(req => {
                  const isCancellation = Number(req.percentuale) === 0 || 
                    (req.tipoRichiesta || '').toLowerCase().includes('annullamento') || 
                    (req.tipoRichiesta || '').toLowerCase().includes('rimozione');
                  const isPreferredValidMember = req.risorsaPreferita && areaMembers.some(m => m.nome === req.risorsaPreferita);
                  const targetResource = isPreferredValidMember ? req.risorsaPreferita : (req.risorseAssegnata || 'Nessuna preferenza');
                  const selectedRisorsa = selectedRisorsePerRichiesta[req.id] || (isPreferredValidMember ? req.risorsaPreferita : '');

                  if (isCancellation) {
                    return (
                      <div key={req.id} className="bg-rose-50/60 p-5 rounded-2xl border border-rose-200 shadow-sm flex flex-col justify-between gap-4 text-xs animate-in fade-in duration-200">
                        <div>
                          <div className="flex justify-between items-center mb-2.5">
                            <span className="font-extrabold text-rose-950 text-sm">{req.commessaName}</span>
                            <span className="bg-rose-600 text-white font-black px-2.5 py-1 rounded-full uppercase tracking-wider text-[9px] shadow-xs">
                              ❌ RICHIESTA ANNULLAMENTO / RIMOZIONE
                            </span>
                          </div>

                          <div className="bg-white p-3.5 rounded-xl border border-rose-150 space-y-2 text-rose-950 shadow-2xs">
                            <div className="flex items-center gap-2 font-bold text-xs text-rose-900">
                              <span>⚠️ Risorsa da Rimuovere:</span>
                              <span className="bg-rose-100 text-rose-950 font-black px-2.5 py-1 rounded-lg border border-rose-250 text-xs">{targetResource}</span>
                            </div>
                            <div className="text-gray-600 text-xs pt-1">
                              📅 Periodo di Rimozione: <strong className="text-gray-900">{formatCommDate(req.dataInizio)}</strong> al <strong className="text-gray-900">{formatCommDate(req.dataFine)}</strong>
                            </div>
                            <div className="text-xs">👤 Richiedente: <span className="font-semibold text-gray-800">{req.richiedenteNome}</span> ({req.richiedenteEmail})</div>
                            {req.nota && (
                              <div className="bg-rose-50/60 p-2.5 rounded-lg border border-rose-100 italic text-rose-900 mt-2">
                                💬 Motivazione: &ldquo;{req.nota}&rdquo;
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-3 pt-3 border-t border-rose-200/80">
                          <div className="text-[11px] font-extrabold text-rose-900">
                            Rimuovere <span className="underline decoration-rose-400">{targetResource}</span> dalla commessa?
                          </div>

                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => handleRejectRequest(req.id)}
                              className="bg-white hover:bg-rose-100 text-rose-700 font-bold px-3 py-2 rounded-xl border border-rose-200 transition cursor-pointer"
                            >
                              Rifiuta
                            </button>
                            <button
                              type="button"
                              onClick={() => handleApproveRequest(req)}
                              className="bg-rose-600 hover:bg-rose-700 text-white font-black px-4 py-2 rounded-xl shadow-md transition active:scale-95 cursor-pointer flex items-center gap-1.5"
                            >
                              <span>❌ Approva Rimozione</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  }

                  const isInserimentoCommessa = req.fonte === 'altre_commesse';
                  const lockedResource = req.risorsaPreferita || req.risorseAssegnata || '';
                  const currentPercent = customPercentagesPerRichiesta[req.id] !== undefined ? customPercentagesPerRichiesta[req.id] : (req.percentuale || 100);

                  return (
                    <div key={req.id} className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex flex-col justify-between gap-3 text-xs">
                      <div>
                        <div className="flex justify-between items-center mb-1">
                          <span className={`font-extrabold ${colors.heading} text-sm`}>{req.commessaName}</span>
                          <span className={`${colors.badge} px-2 py-0.5 rounded-full font-bold uppercase tracking-wider text-[9px]`}>
                            {isInserimentoCommessa ? 'Inserimento Risorsa' : 'In Attesa'}
                          </span>
                        </div>
                        <div className="text-gray-500 mt-1 space-y-1">
                          <div>📅 Periodo: <strong className="text-gray-700">{formatCommDate(req.dataInizio)}</strong> al <strong className="text-gray-700">{formatCommDate(req.dataFine)}</strong></div>
                          <div>👤 Richiedente: <span className="font-semibold text-gray-700">{req.richiedenteNome}</span> ({req.richiedenteEmail})</div>
                          {req.nota && (
                            <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100 italic text-gray-600 mt-2">
                              &ldquo;{req.nota}&rdquo;
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-col gap-2.5 mt-3 pt-3 border-t border-gray-100">
                        {isInserimentoCommessa ? (
                          // CASO 1: RICHIESTA INSERIMENTO DA ALTRO COORDINATORE (Risorsa Bloccata & Percentuale Modificabile)
                          <>
                            <div className="flex items-center gap-2 bg-indigo-50/80 p-2.5 rounded-xl border border-indigo-150">
                              <span className="text-[11px] font-extrabold text-indigo-950">👤 Risorsa Proposta:</span>
                              <span className="bg-indigo-600 text-white font-black px-2.5 py-1 rounded-lg text-xs shadow-2xs">
                                {lockedResource}
                              </span>
                              <span className="text-[10px] text-indigo-600 font-bold italic ml-auto">🔒 Fissata da richiesta</span>
                            </div>

                            <div className="flex items-center justify-between gap-3 bg-slate-50 p-2.5 rounded-xl border border-slate-200/80">
                              <label className="text-xs font-bold text-gray-750 flex items-center gap-1.5">
                                <span>⚡ Percentuale di Carico:</span>
                                <span className="text-[10px] text-gray-400 font-normal">(modificabile a scaglioni del 5%)</span>
                              </label>
                              <select
                                value={currentPercent}
                                onChange={e => setCustomPercentagesPerRichiesta(prev => ({ ...prev, [req.id]: Number(e.target.value) }))}
                                className="w-24 p-1.5 border border-indigo-200 rounded-lg bg-white text-xs font-black text-indigo-900 text-center outline-none focus:ring-2 focus:ring-indigo-500 shadow-2xs cursor-pointer"
                              >
                                {Array.from({ length: 20 }, (_, i) => (i + 1) * 5).map(pct => (
                                  <option key={pct} value={pct}>{pct}%</option>
                                ))}
                              </select>
                            </div>

                            <div className="flex gap-2 justify-end pt-1">
                              <button
                                type="button"
                                onClick={() => handleApproveRequest(req)}
                                className="bg-emerald-600 hover:bg-emerald-700 text-white font-black px-5 py-2.5 rounded-xl shadow-md transition active:scale-95 cursor-pointer flex items-center gap-1.5 text-xs"
                              >
                                <span>✓ Approva Inserimento ({currentPercent}%)</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => handleRejectRequest(req.id)}
                                className="bg-transparent hover:bg-rose-50 text-rose-600 font-extrabold px-3 py-2.5 rounded-xl border border-rose-200 transition active:scale-95 cursor-pointer text-xs"
                              >
                                Rifiuta
                              </button>
                            </div>
                          </>
                        ) : (
                          // CASO 2: RICHIESTA STANDARD RISORSA PER AREA (Scelta della risorsa & Percentuale)
                          <>
                            <div className="flex items-center justify-between gap-3 bg-slate-50 p-2 rounded-xl border border-slate-200/80 mb-1">
                              <label className="text-[11px] font-bold text-gray-700">⚡ Percentuale Carico:</label>
                              <select
                                value={currentPercent}
                                onChange={e => setCustomPercentagesPerRichiesta(prev => ({ ...prev, [req.id]: Number(e.target.value) }))}
                                className="w-20 p-1 border border-gray-300 rounded-lg bg-white text-xs font-bold text-gray-800 text-center outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
                              >
                                {Array.from({ length: 20 }, (_, i) => (i + 1) * 5).map(pct => (
                                  <option key={pct} value={pct}>{pct}%</option>
                                ))}
                              </select>
                            </div>

                            <label className={`block text-[10px] font-bold ${colors.heading} uppercase tracking-wider`}>Seleziona Risorsa {areaName} da Assegnare</label>
                            <div className="flex gap-2">
                              <select
                                value={selectedRisorsa}
                                onChange={e => setSelectedRisorsePerRichiesta(prev => ({ ...prev, [req.id]: e.target.value }))}
                                className={`flex-1 p-2.5 border ${colors.select} rounded-xl bg-slate-50 text-xs font-bold text-gray-750 focus:ring-2 outline-none`}
                              >
                                <option value="">-- Scegli Risorsa --</option>
                                {areaMembers.map(d => (
                                  <option key={d.id} value={d.nome}>{d.nome}</option>
                                ))}
                              </select>

                              <button
                                onClick={() => handleApproveRequest(req)}
                                disabled={!selectedRisorsa}
                                className={`${colors.btn} text-white font-extrabold px-4 py-2.5 rounded-xl shadow transition active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer`}
                              >
                                Approva
                              </button>

                              <button
                                onClick={() => handleRejectRequest(req.id)}
                                className="bg-transparent hover:bg-rose-50 text-rose-600 font-extrabold px-3 py-2.5 rounded-xl border border-rose-200 transition active:scale-95 cursor-pointer"
                              >
                                Rifiuta
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        });
      })()}

      {/* BOZZA DRAFT BANNER */}
      {isDirty && (
        <div className="bg-gradient-to-r from-amber-500 to-amber-600 text-white rounded-[2rem] p-4 px-6 sm:p-5 sm:px-8 shadow-lg flex flex-col sm:flex-row justify-between items-center gap-4 animate-in fade-in slide-in-from-top-4 duration-300 no-print">
          <div className="flex items-center gap-3 text-center sm:text-left">
            <span className="text-2xl">⚠️</span>
            <div>
              <p className="font-extrabold text-lg">Modifiche in Bozza</p>
              <p className="text-white/85 text-sm">Ci sono delle modifiche alla pianificazione non ancora salvate. Salvale per renderle visibili a tutti.</p>
            </div>
          </div>
          <div className="flex gap-3">
            <button 
              disabled={savingChanges}
              onClick={handleSaveChanges}
              className="bg-white text-amber-900 font-extrabold px-6 py-2.5 rounded-2xl shadow-md hover:bg-gray-50 transition-all active:scale-95 text-sm disabled:opacity-50"
            >
              {savingChanges ? "Salvataggio..." : "Salva Modifiche"}
            </button>
            <button 
              disabled={savingChanges}
              onClick={handleDiscardChanges}
              className="bg-transparent hover:bg-white/10 text-white font-extrabold px-6 py-2.5 rounded-2xl border border-white/30 transition-all active:scale-95 text-sm disabled:opacity-50"
            >
              Annulla
            </button>
          </div>
        </div>
      )}

      {/* PENDING NOTIFICATIONS BANNER */}
      {pendingNotificationsCount > 0 && (
        <div className="bg-gradient-to-r from-indigo-600 to-indigo-800 text-white rounded-[2rem] p-4 px-6 sm:p-5 sm:px-8 shadow-lg flex flex-col sm:flex-row justify-between items-center gap-4 animate-in fade-in slide-in-from-top-4 duration-300 no-print">
          <div className="flex items-center gap-3 text-center sm:text-left">
            <span className="text-xl">✉️</span>
            <div>
              <p className="font-extrabold text-sm sm:text-base">Ci sono notifiche di pianificazione in sospeso</p>
              <p className="text-xs text-indigo-100 font-semibold">{pendingNotificationsCount} {pendingNotificationsCount === 1 ? 'dipendente coinvolto' : 'dipendenti coinvolti'} nelle modifiche della sessione.</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleIgnorePendingNotifications}
              className="px-4 py-2 bg-indigo-700/60 hover:bg-indigo-900 text-white font-bold text-xs sm:text-sm rounded-xl transition cursor-pointer"
            >
              Ignora Notifiche
            </button>
            <button
              onClick={handleSendPendingNotifications}
              disabled={sendingNotifications}
              className="px-5 py-2 bg-white text-indigo-700 hover:bg-indigo-50 disabled:opacity-50 font-black text-xs sm:text-sm rounded-xl shadow-md active:scale-95 transition cursor-pointer"
            >
              {sendingNotifications ? 'Invio...' : 'Invia Notifiche Ora'}
            </button>
          </div>
        </div>
      )}

      {/* 1. BULK ALLOCATION PANEL — visibile solo ad Admin, Soci, Coordinatori e PM */}
      {(isAdmin || isSoci(myAssociatedName) || isCoordinatoreQualsiasi || isPMOrResponsabile) && (
        <div ref={plannerContainerRef} className="bg-gradient-to-br from-indigo-50 to-blue-50 p-6 sm:p-8 rounded-[2rem] border border-indigo-100 shadow-xl no-print scroll-mt-6">
          <h3 className="text-xl font-extrabold text-indigo-950 mb-4 flex items-center gap-2">
            Pianificatore Risorse
          </h3>

          {/* TAB BAR */}
          <div className="flex flex-wrap border-b border-indigo-100 mb-6 gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('commessa')}
              className={`px-4 py-2.5 font-bold text-xs sm:text-sm rounded-t-xl transition-all ${
                activeTab === 'commessa'
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'text-indigo-755 hover:bg-indigo-100/50'
              }`}
            >
              📁 Gestione per Commessa
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('risorsa')}
              className={`px-4 py-2.5 font-bold text-xs sm:text-sm rounded-t-xl transition-all ${
                activeTab === 'risorsa'
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'text-indigo-755 hover:bg-indigo-100/50'
              }`}
            >
              👤 Gestione per Risorsa
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('sostituisci')}
              className={`px-4 py-2.5 font-bold text-xs sm:text-sm rounded-t-xl transition-all ${
                activeTab === 'sostituisci'
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'text-indigo-755 hover:bg-indigo-100/50'
              }`}
            >
              🔄 Sostituzione Risorsa
            </button>
          </div>

          {/* TAB CONTENT: GESTIONE PER COMMESSA */}
          {activeTab === 'commessa' && (
            <div className="flex flex-col gap-6">

              {/* Riga 1: Commessa & Periodo – barra compatta orizzontale */}
              <div className="bg-white/60 p-4 rounded-2xl border border-indigo-100/50 flex flex-wrap gap-4 items-end">
                <div className="font-bold text-sm text-indigo-900 w-full border-b pb-2 mb-1">1. Commessa &amp; Periodo</div>

                {/* Ricerca commessa */}
                <div className="relative flex-1 min-w-[220px]">
                  <label className="block text-xs font-bold text-indigo-950 mb-1 ml-1">Commessa</label>
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="Cerca o seleziona commessa..."
                      value={isCommessaDropdownOpen ? commessaSearchText : (selectedCommessaId ? (commesse.find(c => c.id === selectedCommessaId)?.nome || '') : commessaSearchText)}
                      onChange={e => {
                        setCommessaSearchText(e.target.value);
                        setIsCommessaDropdownOpen(true);
                      }}
                      onFocus={() => {
                        setCommessaSearchText('');
                        setIsCommessaDropdownOpen(true);
                      }}
                      className="w-full p-2.5 pr-8 border-none bg-white rounded-xl text-xs outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm font-bold text-gray-750 cursor-pointer"
                    />
                    <div className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
                      <ChevronDown className="w-4 h-4" />
                    </div>
                  </div>
                  {isCommessaDropdownOpen && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setIsCommessaDropdownOpen(false)}></div>
                      <div className="absolute left-0 right-0 z-20 mt-1 bg-white border border-indigo-200 rounded-xl shadow-2xl overflow-hidden">
                        <div className="max-h-56 overflow-y-auto divide-y divide-gray-50 p-1">
                          {(() => {
                            const search = commessaSearchText.toLowerCase();
                            const filtered = selectableCommesse.filter(c =>
                              c.nome.toLowerCase().includes(search) ||
                              (c.cliente && c.cliente.toLowerCase().includes(search))
                            );
                            if (filtered.length === 0) {
                              return <div className="p-3 text-xs text-gray-450 italic font-bold">Nessuna commessa abilitata trovata</div>;
                            }
                            return filtered.map(c => {
                              const isSelected = selectedCommessaId === c.id;
                              return (
                                <button
                                  key={c.id}
                                  ref={el => {
                                    if (el && isSelected && el.parentElement) {
                                      el.parentElement.scrollTop = el.offsetTop;
                                    }
                                  }}
                                  type="button"
                                  title={c.nome}
                                  onClick={() => {
                                    setSelectedCommessaId(c.id);
                                    setCommessaSearchText(c.nome);
                                    setIsCommessaDropdownOpen(false);
                                  }}
                                  className={`w-full text-left px-3 py-2 text-xs font-semibold transition-colors flex flex-col gap-0.5 cursor-pointer rounded-lg ${
                                    isSelected ? 'bg-indigo-100/90 font-black text-indigo-950' : 'hover:bg-indigo-50 text-gray-700'
                                  }`}
                                >
                                <span className="truncate w-full font-bold text-gray-800">
                                  {isSelected ? '✓ ' : ''}{c.nome}
                                </span>
                                <span className="text-[9.5px] text-indigo-650 font-semibold italic">
                                  💼 Cliente: {c.cliente || 'Nessun cliente'}
                                </span>
                              </button>
                            );
                          });
                        })()}
                        </div>
                      </div>
                    </>
                  )}
                </div>

                {/* Selettore Periodo Settimanale */}
                <div className="w-full mt-2">
                  {renderWeekPeriodSelector()}
                </div>

                {/* Durata commessa (badge) */}
                {selectedCommessaId && (() => {
                  const comm = commesse.find(c => c.id === selectedCommessaId);
                  if (!comm || (!comm.dataInizio && !comm.dataFine)) return null;
                  return (
                    <div className="text-xs text-indigo-950/85 font-semibold bg-white/70 px-3 py-2.5 rounded-xl border border-indigo-100/50 flex items-center gap-1.5 shadow-sm self-end">
                      <span>🗓️</span>
                      <span>Durata: <strong className="text-indigo-900">{comm.dataInizio ? formatCommDate(comm.dataInizio) : 'N/D'}</strong> – <strong className="text-indigo-900">{comm.dataFine ? formatCommDate(comm.dataFine) : 'N/D'}</strong></span>
                    </div>
                  );
                })()}
              </div>

              {/* Riga 2: Pannelli risorse – occupano tutto lo spazio */}
              {!selectedCommessaId || !allocDataInizio || !allocDataFine ? (
                <div className="bg-white/50 border border-dashed border-indigo-200 rounded-2xl p-8 text-center text-xs font-bold text-indigo-900/60 flex items-center justify-center min-h-[200px]">
                  ⚠️ Seleziona una commessa e un periodo di date per visualizzare e gestire le risorse assegnate.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Altre Risorse (Non Assegnate) */}
                  <div className="bg-white/60 p-5 rounded-2xl border border-indigo-100/50 flex flex-col max-h-[520px]">
                    <h4 className="font-bold text-sm text-indigo-900 border-b pb-2 mb-3">
                      ➕ Aggiungi Risorsa ({risorseNonAssegnateAllaCommessa.length})
                    </h4>
                    <div className="mb-2 shrink-0">
                      <input
                        type="text"
                        placeholder="Filtra dipendenti..."
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        className="w-full p-2 border border-indigo-100 bg-white rounded-xl text-xs outline-none focus:ring-1 focus:ring-indigo-400 shadow-inner font-bold text-gray-700"
                      />
                    </div>
                    <div className="overflow-y-auto flex-1 space-y-2 pr-1 scrollbar-thin">
                      {risorseNonAssegnateAllaCommessa.length === 0 ? (
                        <p className="text-xs text-gray-405 italic p-3 text-center">Tutte le risorse sono assegnate.</p>
                      ) : (
                        risorseNonAssegnateAllaCommessa.map(r => {
                          const currentPct = assignPercentageMap[r.nome] || '100';
                          return (
                            <div key={r.nome} className="flex justify-between items-center p-2.5 bg-white rounded-xl border border-indigo-50 shadow-sm hover:border-indigo-100 transition-colors">
                              <span className="font-bold text-xs text-gray-750 truncate pr-2">{r.nome}</span>
                              <div className="flex items-center gap-2">
                                <select
                                  value={currentPct}
                                  onChange={e => {
                                    const val = e.target.value;
                                    setAssignPercentageMap(prev => ({ ...prev, [r.nome]: val }));
                                  }}
                                  className="p-1 border border-gray-200 rounded-lg bg-white font-bold text-[10px] text-gray-700 outline-none focus:border-indigo-400"
                                >
                                  {Array.from({ length: 20 }, (_, i) => (i + 1) * 5).map(pct => (
                                    <option key={pct} value={pct}>{pct}%</option>
                                  ))}
                                </select>
                                <button
                                  type="button"
                                  disabled={savingAllocations}
                                  onClick={async () => {
                                    await executeAssignResourceToCommessa(r.nome, selectedCommessaId, parseInt(currentPct));
                                  }}
                                  className="flex items-center gap-1 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-[10px] px-2.5 py-1.5 rounded-lg transition shadow-sm active:scale-95 disabled:opacity-50"
                                >
                                  <Plus className="w-3.5 h-3.5" />
                                  <span>Assegna</span>
                                </button>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>

                  {/* Lista Risorse Assegnate — UI a sotto-periodi */}
                  <div className="bg-white/60 p-5 rounded-2xl border border-indigo-100/50 flex flex-col max-h-[600px]">
                    <h4 className="font-bold text-sm text-indigo-900 border-b pb-2 mb-3">
                      👥 Risorse Assegnate ({risorseAssegnateAllaCommessa.length})
                    </h4>
                    <div className="overflow-y-auto flex-1 space-y-2.5 pr-1 scrollbar-thin">
                      {risorseAssegnateAllaCommessa.length === 0 ? (
                        <p className="text-xs text-gray-405 italic p-3 text-center">Nessuna risorsa assegnata in questo periodo.</p>
                      ) : (() => {
                        const allWeekIds = getWeeksSpannedByDates(allocDataInizio, allocDataFine);
                        return risorseAssegnateAllaCommessa.map(r => {
                          const subperiods = computeSubperiodsPage(r.percentuali, allWeekIds);
                          const pcts = Object.values(r.percentuali);
                          const minPct = pcts.length > 0 ? Math.min(...pcts) : 0;
                          const maxPct = pcts.length > 0 ? Math.max(...pcts) : 0;
                          const displayPct = minPct === maxPct ? `${minPct}%` : `${minPct}% – ${maxPct}%`;
                          const totalWeeks = Object.keys(r.percentuali).length;
                          const isExpanded = expandedRisorseCommessa.has(r.nome);

                          return (
                            <div key={r.nome} className="rounded-xl border border-indigo-100 shadow-xs overflow-hidden">

                              {/* HEADER RISORSA */}
                              <div
                                className={`flex items-center justify-between p-2.5 cursor-pointer transition-colors select-none ${
                                  isExpanded ? 'bg-indigo-50/70' : 'bg-white hover:bg-indigo-50/40'
                                }`}
                                onClick={() => toggleRisorsaExpanded(r.nome)}
                              >
                                <div className="flex items-center gap-2 truncate min-w-0">
                                  <span className={`text-indigo-500 text-[10px] shrink-0 transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
                                  <span className="font-bold text-xs text-gray-800 truncate">{r.nome}</span>
                                  {displayPct && (
                                    <span className="text-[10px] font-black text-indigo-700 bg-indigo-100 px-1.5 py-0.5 rounded-full shrink-0">
                                      {displayPct} · {totalWeeks} sett.
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  {/* Deep-link → Pianifica per Risorsa */}
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      // Usa le settimane effettive dell'assegnazione, non il filtro pagina
                                      const assignedWeeks = Object.keys(r.percentuali).sort();
                                      const wStart = assignedWeeks[0] || selectedStartWeekId;
                                      const wEnd = assignedWeeks[assignedWeeks.length - 1] || selectedEndWeekId;
                                      const url = new URL(window.location.href);
                                      url.searchParams.set('tab', 'risorsa');
                                      url.searchParams.set('risorsa', encodeURIComponent(r.nome));
                                      url.searchParams.set('startWeek', wStart);
                                      url.searchParams.set('endWeek', wEnd);
                                      url.searchParams.delete('commessaId');
                                      url.searchParams.delete('weekId');
                                      window.open(url.toString(), '_blank');
                                    }}
                                    className="text-indigo-400 hover:text-indigo-700 hover:bg-indigo-50 p-1.5 rounded-lg transition-colors shrink-0"
                                    title={`Apri pianificazione per risorsa: ${r.nome}`}
                                  >
                                    <ExternalLink className="w-3.5 h-3.5" />
                                  </button>
                                  {/* Rimuovi TUTTO il periodo */}
                                  <button
                                    type="button"
                                    disabled={savingAllocations}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setConfirmConfig({
                                        isOpen: true,
                                        title: 'Rimozione Risorsa',
                                        message: `Rimuovere ${r.nome} da questa commessa per TUTTO il periodo selezionato?`,
                                        type: 'danger',
                                        onConfirm: async () => {
                                          await executeRemoveResourceFromCommessa(r.nome, selectedCommessaId);
                                          setConfirmConfig(prev => ({ ...prev, isOpen: false }));
                                        }
                                      });
                                    }}
                                    className="text-red-400 hover:text-red-600 hover:bg-red-50 p-1.5 rounded-lg transition-colors shrink-0 disabled:opacity-50"
                                    title="Rimuovi da tutto il periodo"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>

                              {/* SOTTO-PERIODI */}
                              {isExpanded && (
                                <div className="border-t border-indigo-100/70 bg-white divide-y divide-slate-50">
                                  {subperiods.map((sp, spIdx) => {
                                    const bgRow = sp.pct <= 60 ? 'bg-sky-50/50' : sp.pct <= 110 ? 'bg-emerald-50/50' : 'bg-rose-50/50';
                                    const pctBadge = sp.pct <= 60 ? 'bg-sky-100 text-sky-800' : sp.pct <= 110 ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800';

                                    return (
                                      <div key={spIdx} className={`flex items-center justify-between px-3.5 py-2 gap-2 ${bgRow}`}>
                                        <div className="flex items-center gap-2 min-w-0 flex-1">
                                          <span className="text-slate-400 text-[10px] shrink-0">↳</span>
                                          <span className="text-[11px] font-semibold text-gray-700 truncate">{sp.label}</span>
                                          <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-full shrink-0 ${pctBadge}`}>{sp.pct}%</span>
                                        </div>
                                        <div className="flex items-center gap-1.5 shrink-0">
                                          <select
                                            value={sp.pct}
                                            disabled={savingAllocations}
                                            onChange={async (e) => {
                                              e.stopPropagation();
                                              await executeAssignSubperiodToCommessa(r.nome, selectedCommessaId, sp.weekIds, parseInt(e.target.value));
                                            }}
                                            className="p-1 border border-gray-200 rounded-lg bg-white font-bold text-[10px] text-gray-700 outline-none focus:border-indigo-400 cursor-pointer"
                                            title="Modifica % solo per questo sotto-periodo"
                                          >
                                            {(!Array.from({ length: 20 }, (_, i) => (i + 1) * 5).includes(sp.pct)) && (
                                              <option value={sp.pct}>{sp.pct}%</option>
                                            )}
                                            {Array.from({ length: 20 }, (_, i) => (i + 1) * 5).map(pct => (
                                              <option key={pct} value={pct}>{pct}%</option>
                                            ))}
                                          </select>
                                          <button
                                            type="button"
                                            disabled={savingAllocations}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              executeRemoveSubperiodFromCommessa(r.nome, selectedCommessaId, sp.weekIds);
                                            }}
                                            className="text-red-400 hover:text-red-600 hover:bg-red-50 p-1 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                                            title={`Rimuovi solo ${sp.label}`}
                                          >
                                            <Trash2 className="w-3 h-3" />
                                          </button>
                                        </div>
                                      </div>
                                    );
                                  })}

                                  {/* Applica % uniforme all'intero periodo */}
                                  {subperiods.length > 1 && (
                                    <div className="flex items-center justify-between px-3.5 py-2 bg-indigo-50/40 gap-2">
                                      <span className="text-[10px] font-semibold text-indigo-700">📐 Applica % uniforme:</span>
                                      <div className="flex items-center gap-1.5">
                                        <select
                                          id={`uniform-pp-${r.nome}`}
                                          defaultValue={subperiods[0]?.pct || 100}
                                          className="p-1 border border-indigo-200 rounded-lg bg-white font-bold text-[10px] text-gray-700 outline-none focus:border-indigo-400 cursor-pointer"
                                        >
                                          {Array.from({ length: 20 }, (_, i) => (i + 1) * 5).map(pct => (
                                            <option key={pct} value={pct}>{pct}%</option>
                                          ))}
                                        </select>
                                        <button
                                          type="button"
                                          disabled={savingAllocations}
                                          onClick={async () => {
                                            const sel = document.getElementById(`uniform-pp-${r.nome}`) as HTMLSelectElement;
                                            if (!sel) return;
                                            await executeAssignResourceToCommessa(r.nome, selectedCommessaId, parseInt(sel.value));
                                          }}
                                          className="flex items-center gap-1 bg-indigo-600 hover:bg-indigo-700 text-white font-black text-[10px] px-2 py-1.5 rounded-lg transition cursor-pointer active:scale-95"
                                        >
                                          ✓ Applica
                                        </button>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        });
                      })()}
                    </div>
                  </div>
                </div>
              )}

              {/* Pulsanti Richiesta Personale – centrati sotto, visibili solo quando commessa + periodo selezionati */}
              {selectedCommessaId && allocDataInizio && allocDataFine && (() => {
                const areaButtonConfigs: Record<MacroArea, { color: string; label: string }> = {
                  'Disegnatori':          { color: 'bg-teal-600 hover:bg-teal-700',     label: '✉️ Richiedi Disegnatore' },
                  'Ingegneria':           { color: 'bg-indigo-600 hover:bg-indigo-700', label: '✉️ Richiedi Ingegnere' },
                  'Sicurezza Cantieri':   { color: 'bg-emerald-600 hover:bg-emerald-700', label: '✉️ Richiedi Risorsa Sicurezza Cantieri' },
                  'Consulenza Sicurezza': { color: 'bg-amber-600 hover:bg-amber-700',   label: '✉️ Richiedi Consulente Sicurezza' },
                  'Amministrazione':      { color: 'bg-blue-600 hover:bg-blue-700',     label: '✉️ Richiedi Risorsa Amministrativa' },
                };
                // Nasconde le aree che il coordinatore già gestisce
                const areasToShow = MACRO_AREE.filter(a => !myCoordinatedAreas.includes(a));
                if (areasToShow.length === 0) return null;
                return (
                  <div className="flex flex-wrap justify-center gap-2 pt-1 border-t border-indigo-100/50">
                    <span className="w-full text-center text-[10px] font-black text-gray-400 uppercase tracking-wider mb-1">Richiedi personale da altra area</span>
                    {areasToShow.map(area => {
                      const cfg = areaButtonConfigs[area];
                      return (
                        <button
                          key={area}
                          type="button"
                          onClick={() => openRequestModalForArea(area)}
                          className={`flex items-center gap-2 ${cfg.color} text-white px-4 py-2.5 rounded-2xl font-bold text-xs shadow-md active:scale-95 transition-all cursor-pointer`}
                        >
                          {cfg.label}
                        </button>
                      );
                    })}
                  </div>
                );
              })()}

            </div>
          )}

          {/* TAB CONTENT: GESTIONE PER RISORSA */}
          {activeTab === 'risorsa' && (
            <div className="flex flex-col gap-6">

              {/* Riga 1: Risorsa & Periodo – barra orizzontale a tutta larghezza */}
              <div className="bg-white/60 p-4 sm:p-5 rounded-2xl border border-indigo-100/50 flex flex-col gap-4">
                <div className="font-bold text-sm text-indigo-900 border-b pb-2">1. Risorsa &amp; Periodo</div>

                {/* Selezione Risorsa & Badge */}
                <div className="flex flex-wrap gap-4 items-end">
                  <div className="relative flex-1 min-w-[260px]">
                    <label className="block text-xs font-bold text-indigo-950 mb-1 ml-1">Risorsa da Modificare *</label>
                    <div className="relative">
                      <input
                        type="text"
                        placeholder="Cerca o seleziona risorsa..."
                        value={isResourceDropdownOpen ? resourceSearchText : (selectedResourceForTab || resourceSearchText)}
                        onChange={e => {
                          setResourceSearchText(e.target.value);
                          setIsResourceDropdownOpen(true);
                        }}
                        onFocus={() => {
                          setResourceSearchText('');
                          setIsResourceDropdownOpen(true);
                        }}
                        className="w-full p-2.5 pr-8 border-none bg-white rounded-xl text-xs outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm font-bold text-gray-750 cursor-pointer"
                      />
                      <div className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
                        <ChevronDown className="w-4 h-4" />
                      </div>
                    </div>
                    {isResourceDropdownOpen && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setIsResourceDropdownOpen(false)}></div>
                        <div className="absolute left-0 right-0 z-20 mt-1 bg-white border border-indigo-200 rounded-xl shadow-2xl overflow-hidden">
                          <div className="max-h-56 overflow-y-auto divide-y divide-gray-50 p-1">
                            {(() => {
                              const search = resourceSearchText.toLowerCase();
                              const filtered = filteredDipendenti.filter(d =>
                                d.nome.toLowerCase().includes(search) ||
                                (d.macroArea && d.macroArea.toLowerCase().includes(search)) ||
                                (d.tipo && d.tipo.toLowerCase().includes(search)) ||
                                (d.email && d.email.toLowerCase().includes(search))
                              );
                              if (filtered.length === 0) {
                                return <div className="p-3 text-xs text-gray-450 italic font-bold">Nessuna risorsa trovata</div>;
                              }
                              return filtered.map(d => {
                                const isSelected = selectedResourceForTab === d.nome;
                                return (
                                  <button
                                    key={d.id}
                                    ref={el => {
                                      if (el && isSelected && el.parentElement) {
                                        el.parentElement.scrollTop = el.offsetTop;
                                      }
                                    }}
                                    type="button"
                                    title={d.nome}
                                    onClick={() => {
                                      setSelectedResourceForTab(d.nome);
                                      setResourceSearchText(d.nome);
                                      setIsResourceDropdownOpen(false);
                                      setAddCommessaId('');
                                      setAddCommessaSearchText('');
                                    }}
                                    className={`w-full text-left px-3 py-2 text-xs font-semibold transition-colors flex flex-col gap-0.5 cursor-pointer rounded-lg ${
                                      isSelected ? 'bg-indigo-100/90 font-black text-indigo-950' : 'hover:bg-indigo-50 text-gray-700'
                                    }`}
                                  >
                                    <span className="truncate w-full font-bold text-gray-800">
                                      {isSelected ? '✓ ' : ''}{d.nome}
                                    </span>
                                    <span className="text-[9.5px] text-indigo-650 font-semibold italic">
                                      👤 Macroarea: {d.macroArea || 'Non Assegnata'}{d.tipo ? ` • ${d.tipo === 'collaboratore' ? 'Collaboratore' : 'Dipendente'}` : ''}
                                    </span>
                                  </button>
                                );
                              });
                            })()}
                          </div>
                        </div>
                      </>
                    )}
                  </div>

                  {selectedResourceForTab && (() => {
                    const dip = filteredDipendenti.find(d => d.nome === selectedResourceForTab);
                    if (!dip) return null;
                    return (
                      <div className="text-xs text-indigo-950/85 font-semibold bg-white/80 px-3.5 py-2.5 rounded-xl border border-indigo-100/60 flex items-center gap-2 shadow-sm self-end">
                        <span className="w-2.5 h-2.5 rounded-full bg-indigo-600"></span>
                        <span>Macroarea: <strong className="text-indigo-900 font-extrabold">{dip.macroArea || 'Non Assegnata'}</strong></span>
                      </div>
                    );
                  })()}
                </div>

                {/* Selettore Periodo Settimanale a tutta larghezza */}
                <div className="w-full mt-1">
                  {renderWeekPeriodSelector()}
                </div>

                {/* Banner Informativo Ferie / Assenze Risorsa */}
                {selectedResourceForTab && allocDataInizio && allocDataFine && resourceLeaveInfoForPeriod.hasAnyLeave && (
                  <div className={`p-4 rounded-2xl border flex items-start gap-3 shadow-xs transition-all ${
                    resourceLeaveInfoForPeriod.isFullyOnLeave
                      ? 'bg-rose-50/90 border-rose-200 text-rose-950'
                      : 'bg-amber-50/90 border-amber-200 text-amber-950'
                  }`}>
                    <div className={`p-2 rounded-xl shrink-0 ${
                      resourceLeaveInfoForPeriod.isFullyOnLeave ? 'bg-rose-100 text-rose-600' : 'bg-amber-100 text-amber-700'
                    }`}>
                      <AlertTriangle className="w-5 h-5" />
                    </div>
                    <div className="flex-1 text-xs">
                      <div className="font-extrabold text-sm mb-1">
                        {resourceLeaveInfoForPeriod.isFullyOnLeave
                          ? `⚠️ Risorsa in Ferie / Assente per l'intero periodo selezionato`
                          : `⚠️ Attenzione: Presenza di Ferie / Assenze nel periodo selezionato`}
                      </div>
                      {resourceLeaveInfoForPeriod.isFullyOnLeave ? (
                        <p className="font-semibold leading-relaxed">
                          <strong>{selectedResourceForTab}</strong> risulta in <strong>ferie/assenza approvata</strong> per tutte le settimane selezionate ({resourceLeaveInfoForPeriod.leaveWeekLabels.join(', ')}). In questo periodo la risorsa non è disponibile e l'assegnazione di nuove commesse è bloccata.
                        </p>
                      ) : (
                        <div className="space-y-1 font-semibold leading-relaxed">
                          {resourceLeaveInfoForPeriod.leaveWeekLabels.length > 0 && (
                            <p>
                              <strong>{selectedResourceForTab}</strong> è in ferie piena nelle settimane: <strong className="text-amber-900">{resourceLeaveInfoForPeriod.leaveWeekLabels.join(', ')}</strong> (in tali settimane non verranno assegnate commesse).
                            </p>
                          )}
                          {resourceLeaveInfoForPeriod.leaveDaysDetails.length > 0 && (
                            <p>
                              Giornate parziali di assenza/permesso: {resourceLeaveInfoForPeriod.leaveDaysDetails.join(' | ')}.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Riga 2: Griglia a 2 colonne ampie (Assegna Commessa & Lista Commesse Assegnate) */}
              {!selectedResourceForTab || !allocDataInizio || !allocDataFine ? (
                <div className="bg-white/50 border border-dashed border-indigo-200 rounded-2xl p-8 text-center text-xs font-bold text-indigo-900/60 flex items-center justify-center min-h-[200px]">
                  ⚠️ Seleziona una risorsa e un periodo di date per visualizzare e gestire le commesse associate.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Assegna Nuova Commessa */}
                  <div className="bg-white/60 p-5 rounded-2xl border border-indigo-100/50 flex flex-col justify-between min-h-[360px]">
                    <div>
                      <h4 className="font-bold text-sm text-indigo-900 border-b pb-2 mb-4">
                        ➕ Assegna Commessa a <strong className="text-indigo-950">{selectedResourceForTab}</strong>
                      </h4>
                      <div className="space-y-4">
                        <div className="relative">
                          <label className="block text-xs font-bold text-indigo-950 mb-1 ml-1">Seleziona Commessa *</label>
                          <div className="relative">
                            <input
                              type="text"
                              placeholder="Cerca o seleziona commessa..."
                              value={isAddCommessaDropdownOpen ? addCommessaSearchText : (addCommessaId ? (commesse.find(c => c.id === addCommessaId)?.nome || '') : addCommessaSearchText)}
                              onChange={e => {
                                setAddCommessaSearchText(e.target.value);
                                setIsAddCommessaDropdownOpen(true);
                              }}
                              onFocus={() => {
                                setAddCommessaSearchText('');
                                setIsAddCommessaDropdownOpen(true);
                              }}
                              className="w-full p-2.5 pr-8 border-none bg-white rounded-xl text-xs outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm font-bold text-gray-750 cursor-pointer"
                            />
                            <div className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
                              <ChevronDown className="w-4 h-4" />
                            </div>
                          </div>
                          {isAddCommessaDropdownOpen && (
                            <>
                              <div className="fixed inset-0 z-10" onClick={() => setIsAddCommessaDropdownOpen(false)}></div>
                              <div className="absolute left-0 right-0 z-20 mt-1 bg-white border border-indigo-200 rounded-xl shadow-2xl overflow-hidden">
                                <div className="max-h-56 overflow-y-auto divide-y divide-gray-50 p-1">
                                  {(() => {
                                    const search = addCommessaSearchText.toLowerCase();
                                    const filtered = selectableCommesse.filter(c =>
                                      c.nome.toLowerCase().includes(search) ||
                                      (c.cliente && c.cliente.toLowerCase().includes(search)) ||
                                      (c.codiceCommessa && c.codiceCommessa.toLowerCase().includes(search))
                                    );
                                    if (filtered.length === 0) {
                                      return <div className="p-3 text-xs text-gray-450 italic font-bold">Nessuna commessa abilitata trovata</div>;
                                    }
                                    return filtered.map(c => {
                                      const isSelected = addCommessaId === c.id;
                                      return (
                                        <button
                                          key={c.id}
                                          ref={el => {
                                            if (el && isSelected && el.parentElement) {
                                              el.parentElement.scrollTop = el.offsetTop;
                                            }
                                          }}
                                          type="button"
                                          title={c.nome}
                                          onClick={() => {
                                            setAddCommessaId(c.id);
                                            setAddCommessaSearchText(c.nome);
                                            setIsAddCommessaDropdownOpen(false);
                                          }}
                                          className={`w-full text-left px-3 py-2 text-xs font-semibold transition-colors flex flex-col gap-0.5 cursor-pointer rounded-lg ${
                                            isSelected ? 'bg-indigo-100/90 font-black text-indigo-950' : 'hover:bg-indigo-50 text-gray-700'
                                          }`}
                                        >
                                          <span className="truncate w-full font-bold text-gray-800">
                                            {isSelected ? '✓ ' : ''}{c.nome}
                                          </span>
                                          <span className="text-[9.5px] text-indigo-650 font-semibold italic">
                                            💼 Cliente: {c.cliente || 'Nessun cliente'}
                                          </span>
                                        </button>
                                      );
                                    });
                                  })()}
                                </div>
                              </div>
                            </>
                          )}
                        </div>

                        <div>
                          <label className="block text-xs font-bold text-indigo-950 mb-1 ml-1">Percentuale di Carico *</label>
                          <select
                            value={addPercentage}
                            onChange={e => setAddPercentage(e.target.value)}
                            className="w-full p-3 border-none bg-white rounded-xl text-xs outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm font-bold text-gray-800 cursor-pointer"
                          >
                            {Array.from({ length: 20 }, (_, i) => (i + 1) * 5).map(pct => (
                              <option key={pct} value={pct}>{pct}%</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={savingAllocations || !addCommessaId || resourceLeaveInfoForPeriod.isFullyOnLeave}
                      onClick={async () => {
                        if (resourceLeaveInfoForPeriod.isFullyOnLeave) {
                          showToast(`Impossibile assegnare commesse: ${selectedResourceForTab} è in ferie per l'intero periodo selezionato.`, "warning");
                          return;
                        }
                        await executeAssignResourceToCommessa(selectedResourceForTab, addCommessaId, parseInt(addPercentage));
                        setAddCommessaId('');
                        setAddCommessaSearchText('');
                      }}
                      className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-black py-3 rounded-xl transition shadow-md active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer mt-6"
                      title={resourceLeaveInfoForPeriod.isFullyOnLeave ? "Risorsa in ferie per l'intero periodo selezionato" : ""}
                    >
                      <Plus className="w-4 h-4" />
                      <span>{resourceLeaveInfoForPeriod.isFullyOnLeave ? 'Risorsa in Ferie (Assegnazione Bloccata)' : 'Conferma ed Esegui Assegnazione'}</span>
                    </button>
                  </div>

                  {/* Lista Commesse Assegnate — UI a sotto-periodi */}
                  <div className="bg-white/60 p-5 rounded-2xl border border-indigo-100/50 flex flex-col max-h-[600px] min-h-[360px]">
                    <h4 className="font-bold text-sm text-indigo-900 border-b pb-2 mb-3 flex items-center justify-between">
                      <span>📁 Commesse Assegnate ({commesseAssegnateAllaRisorsa.length})</span>
                    </h4>
                    <div className="overflow-y-auto flex-1 space-y-2.5 pr-1 scrollbar-thin">
                      {commesseAssegnateAllaRisorsa.length === 0 ? (
                        <div className="p-6 text-center">
                          {resourceLeaveInfoForPeriod.isFullyOnLeave ? (
                            <div className="p-4 bg-amber-50/90 border border-amber-200 rounded-xl text-amber-900 text-xs font-bold inline-flex items-center gap-2">
                              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                              <span>Nessuna commessa attiva: {selectedResourceForTab} è in ferie per l'intero periodo selezionato.</span>
                            </div>
                          ) : (
                            <p className="text-xs text-gray-400 italic">Nessuna commessa assegnata a {selectedResourceForTab} nel periodo selezionato.</p>
                          )}
                        </div>
                      ) : (() => {
                        const allWeekIds = getWeeksSpannedByDates(allocDataInizio, allocDataFine);
                        return commesseAssegnateAllaRisorsa.map(c => {
                          const subperiods = computeSubperiodsPage(c.percentuali, allWeekIds);
                          const pcts = Object.values(c.percentuali);
                          const minPct = pcts.length > 0 ? Math.min(...pcts) : 0;
                          const maxPct = pcts.length > 0 ? Math.max(...pcts) : 0;
                          const displayPct = minPct === maxPct ? `${minPct}%` : `${minPct}% – ${maxPct}%`;
                          const totalWeeks = Object.keys(c.percentuali).length;
                          const isExpanded = expandedCommessaRisorsa.has(c.id);

                          // Permessi di modifica per questa commessa
                          const commObj = commesse.find(x => x.id === c.id);
                          const pmArray = commObj && commObj.pm ? (Array.isArray(commObj.pm) ? commObj.pm : [commObj.pm]) : [];
                          const isPM = pmArray.some(name => areNamesEqual(name, myAssociatedName));
                          const hasPermission = isAdmin || isSoci(myAssociatedName) || (commObj && (isPM || areNamesEqual(commObj.responsabile, myAssociatedName)));

                          return (
                            <div key={c.id} className="rounded-xl border border-indigo-100 shadow-xs overflow-hidden">

                              {/* HEADER COMMESSA */}
                              <div
                                className={`flex items-center justify-between p-2.5 cursor-pointer transition-colors select-none ${
                                  isExpanded ? 'bg-indigo-50/70' : 'bg-white hover:bg-indigo-50/40'
                                }`}
                                onClick={() => toggleCommessaExpanded(c.id)}
                              >
                                <div className="flex items-center gap-2 truncate min-w-0 pr-2">
                                  <span className={`text-indigo-500 text-[10px] shrink-0 transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
                                  <span className="font-bold text-xs text-gray-850 truncate">{c.nome}</span>
                                  {displayPct && (
                                    <span className="text-[10px] font-black text-indigo-700 bg-indigo-100 px-1.5 py-0.5 rounded-full shrink-0">
                                      {displayPct} · {totalWeeks} sett.
                                    </span>
                                  )}
                                </div>

                                <div className="flex items-center gap-1 shrink-0">
                                  {hasPermission ? (
                                    <>
                                      {/* Deep-link → Pianifica per Commessa */}
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          const assignedWeeks = Object.keys(c.percentuali).sort();
                                          const wStart = assignedWeeks[0] || selectedStartWeekId;
                                          const wEnd = assignedWeeks[assignedWeeks.length - 1] || selectedEndWeekId;
                                          const url = new URL(window.location.href);
                                          url.searchParams.set('tab', 'commessa');
                                          url.searchParams.set('commessaId', c.id);
                                          url.searchParams.set('startWeek', wStart);
                                          url.searchParams.set('endWeek', wEnd);
                                          url.searchParams.delete('risorsa');
                                          url.searchParams.delete('weekId');
                                          window.open(url.toString(), '_blank');
                                        }}
                                        className="text-indigo-400 hover:text-indigo-700 hover:bg-indigo-50 p-1.5 rounded-lg transition-colors shrink-0"
                                        title={`Apri pianificazione per commessa: ${c.nome}`}
                                      >
                                        <ExternalLink className="w-3.5 h-3.5" />
                                      </button>
                                      {/* Rimuovi da tutto il periodo */}
                                      <button
                                        type="button"
                                        disabled={savingAllocations}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setConfirmConfig({
                                            isOpen: true,
                                            title: 'Rimozione Commessa',
                                            message: `Rimuovere la commessa "${c.nome}" per ${selectedResourceForTab} per TUTTO il periodo selezionato?`,
                                            type: 'danger',
                                            onConfirm: async () => {
                                              await executeRemoveResourceFromCommessa(selectedResourceForTab, c.id);
                                              setConfirmConfig(prev => ({ ...prev, isOpen: false }));
                                            }
                                          });
                                        }}
                                        className="text-red-400 hover:text-red-600 hover:bg-red-50 p-1.5 rounded-lg transition-colors shrink-0 disabled:opacity-50"
                                        title="Rimuovi da tutto il periodo"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    </>
                                  ) : (
                                    <span className="text-gray-400 text-[10px] italic font-bold bg-gray-50 px-2 py-0.5 rounded-lg border border-gray-100">
                                      🔒 Sola Lettura
                                    </span>
                                  )}
                                </div>
                              </div>

                              {/* SOTTO-PERIODI */}
                              {isExpanded && (
                                <div className="border-t border-indigo-100/70 bg-white divide-y divide-slate-50">
                                  {subperiods.map((sp, spIdx) => {
                                    const bgRow = sp.pct <= 60 ? 'bg-sky-50/50' : sp.pct <= 110 ? 'bg-emerald-50/50' : 'bg-rose-50/50';
                                    const pctBadge = sp.pct <= 60 ? 'bg-sky-100 text-sky-800' : sp.pct <= 110 ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800';

                                    return (
                                      <div key={spIdx} className={`flex items-center justify-between px-3.5 py-2 gap-2 ${bgRow}`}>
                                        <div className="flex items-center gap-2 min-w-0 flex-1">
                                          <span className="text-slate-400 text-[10px] shrink-0">↳</span>
                                          <span className="text-[11px] font-semibold text-gray-700 truncate">{sp.label}</span>
                                          <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-full shrink-0 ${pctBadge}`}>{sp.pct}%</span>
                                        </div>

                                        {hasPermission && (
                                          <div className="flex items-center gap-1.5 shrink-0">
                                            <select
                                              value={sp.pct}
                                              disabled={savingAllocations}
                                              onChange={async (e) => {
                                                e.stopPropagation();
                                                await executeAssignSubperiodToCommessa(selectedResourceForTab, c.id, sp.weekIds, parseInt(e.target.value));
                                              }}
                                              className="p-1 border border-gray-200 rounded-lg bg-white font-bold text-[10px] text-gray-700 outline-none focus:border-indigo-400 cursor-pointer"
                                              title="Modifica % solo per questo sotto-periodo"
                                            >
                                              {(!Array.from({ length: 20 }, (_, i) => (i + 1) * 5).includes(sp.pct)) && (
                                                <option value={sp.pct}>{sp.pct}%</option>
                                              )}
                                              {Array.from({ length: 20 }, (_, i) => (i + 1) * 5).map(pct => (
                                                <option key={pct} value={pct}>{pct}%</option>
                                              ))}
                                            </select>
                                            <button
                                              type="button"
                                              disabled={savingAllocations}
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                executeRemoveSubperiodFromCommessa(selectedResourceForTab, c.id, sp.weekIds);
                                              }}
                                              className="text-red-400 hover:text-red-600 hover:bg-red-50 p-1 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                                              title={`Rimuovi solo ${sp.label}`}
                                            >
                                              <Trash2 className="w-3 h-3" />
                                            </button>
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}

                                  {/* Applica % uniforme all'intero periodo */}
                                  {hasPermission && subperiods.length > 1 && (
                                    <div className="flex items-center justify-between px-3.5 py-2 bg-indigo-50/40 gap-2">
                                      <span className="text-[10px] font-semibold text-indigo-700">📐 Applica % uniforme:</span>
                                      <div className="flex items-center gap-1.5">
                                        <select
                                          id={`uniform-pr-${c.id}`}
                                          defaultValue={subperiods[0]?.pct || 100}
                                          className="p-1 border border-indigo-200 rounded-lg bg-white font-bold text-[10px] text-gray-700 outline-none focus:border-indigo-400 cursor-pointer"
                                        >
                                          {Array.from({ length: 20 }, (_, i) => (i + 1) * 5).map(pct => (
                                            <option key={pct} value={pct}>{pct}%</option>
                                          ))}
                                        </select>
                                        <button
                                          type="button"
                                          disabled={savingAllocations}
                                          onClick={async () => {
                                            const sel = document.getElementById(`uniform-pr-${c.id}`) as HTMLSelectElement;
                                            if (!sel) return;
                                            await executeAssignResourceToCommessa(selectedResourceForTab, c.id, parseInt(sel.value));
                                          }}
                                          className="flex items-center gap-1 bg-indigo-600 hover:bg-indigo-700 text-white font-black text-[10px] px-2 py-1.5 rounded-lg transition cursor-pointer active:scale-95"
                                        >
                                          ✓ Applica
                                        </button>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        });
                      })()}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB CONTENT: SOSTITUZIONE RISORSA */}
          {activeTab === 'sostituisci' && (
            <form onSubmit={handleConfirmAssignments} className="flex flex-col gap-6">
              {/* Riga 1: Commessa & Periodo – barra orizzontale a tutta larghezza */}
              <div className="bg-white/60 p-4 sm:p-5 rounded-2xl border border-indigo-100/50 flex flex-col gap-4">
                <div className="font-bold text-sm text-indigo-900 border-b pb-2">1. Commessa &amp; Periodo per Sostituzione</div>

                <div className="relative w-full">
                  <label className="block text-xs font-bold text-indigo-950 mb-1 ml-1">Commessa *</label>
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="Cerca o seleziona commessa..."
                      value={isCommessaDropdownOpen ? commessaSearchText : (selectedCommessaId ? (commesse.find(c => c.id === selectedCommessaId)?.nome || '') : commessaSearchText)}
                      onChange={e => {
                        setCommessaSearchText(e.target.value);
                        setIsCommessaDropdownOpen(true);
                      }}
                      onFocus={() => {
                        setCommessaSearchText('');
                        setIsCommessaDropdownOpen(true);
                      }}
                      className="w-full p-2.5 pr-8 border-none bg-white rounded-xl text-xs outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm font-bold text-gray-800 cursor-pointer"
                    />
                    <div className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
                      <ChevronDown className="w-4 h-4" />
                    </div>
                  </div>
                  {isCommessaDropdownOpen && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setIsCommessaDropdownOpen(false)}></div>
                      <div className="absolute left-0 right-0 z-20 mt-1 bg-white border border-indigo-200 rounded-xl shadow-2xl overflow-hidden">
                        <div className="max-h-56 overflow-y-auto divide-y divide-gray-50 p-1">
                          {(() => {
                            const search = commessaSearchText.toLowerCase();
                            const filtered = selectableCommesse.filter(c =>
                              c.nome.toLowerCase().includes(search) ||
                              (c.cliente && c.cliente.toLowerCase().includes(search))
                            );
                            if (filtered.length === 0) {
                              return <div className="p-3 text-xs text-gray-450 italic font-bold">Nessuna commessa trovata</div>;
                            }
                            return filtered.map(c => {
                              const isSelected = selectedCommessaId === c.id;
                              return (
                                <button
                                  key={c.id}
                                  ref={el => {
                                    if (el && isSelected && el.parentElement) {
                                      el.parentElement.scrollTop = el.offsetTop;
                                    }
                                  }}
                                  type="button"
                                  title={c.nome}
                                  onClick={() => {
                                    setSelectedCommessaId(c.id);
                                    setCommessaSearchText(c.nome);
                                    setIsCommessaDropdownOpen(false);
                                  }}
                                  className={`w-full text-left px-3 py-2 text-xs font-semibold transition-colors flex flex-col gap-0.5 cursor-pointer rounded-lg ${
                                    isSelected ? 'bg-indigo-100/90 font-black text-indigo-950' : 'hover:bg-indigo-50 text-gray-700'
                                  }`}
                                >
                                <span className="truncate w-full font-bold text-gray-800">
                                  {isSelected ? '✓ ' : ''}{c.nome}
                                </span>
                                <span className="text-[9.5px] text-indigo-650 font-semibold italic">
                                  💼 Cliente: {c.cliente || 'Nessun cliente'}
                                </span>
                              </button>
                            );
                          });
                        })()}
                        </div>
                      </div>
                    </>
                  )}
                </div>

                <div className="w-full mt-1">
                  {renderWeekPeriodSelector()}
                </div>
              </div>

              {/* Riga 2: Selezione Sostituzione Risorse */}
              <div className="bg-white/60 p-6 rounded-2xl border border-indigo-100/50 flex flex-col gap-5">
                <h4 className="font-bold text-sm text-indigo-900 border-b pb-2">2. Sostituzione Risorsa</h4>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-xs font-bold text-indigo-950 mb-1 ml-1">Risorsa da Sostituire (A) *</label>
                    <select
                      value={sourceResource}
                      onChange={e => setSourceResource(e.target.value)}
                      className="w-full p-3 border-none bg-white rounded-xl text-xs outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm font-bold text-gray-800 cursor-pointer"
                    >
                      <option value="">-- Seleziona Risorsa da Sostituire --</option>
                      {filteredDipendenti.map(d => (
                        <option key={d.id} value={d.nome}>{d.nome}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-indigo-950 mb-1 ml-1">Nuova Risorsa Subentrante (B) *</label>
                    <select
                      value={targetResource}
                      onChange={e => setTargetResource(e.target.value)}
                      className="w-full p-3 border-none bg-white rounded-xl text-xs outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm font-bold text-gray-800 cursor-pointer"
                    >
                      <option value="">-- Seleziona Nuova Risorsa --</option>
                      {filteredDipendenti.map(d => (
                        <option key={d.id} value={d.nome}>{d.nome}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    type="submit"
                    disabled={savingAllocations || !selectedCommessaId || !sourceResource || !targetResource}
                    onClick={() => setAllocAction('sostituisci')}
                    className="w-full md:w-auto px-8 py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs rounded-xl shadow-md transition active:scale-95 disabled:opacity-50 cursor-pointer flex items-center justify-center gap-2"
                  >
                    <Save className="w-4 h-4" />
                    <span>{savingAllocations ? 'Sostituzione in corso...' : 'Conferma ed Esegui Sostituzione Risorsa'}</span>
                  </button>
                </div>
              </div>
            </form>
          )}

        </div>
      )}

      {/* 2. TIMELINE CARICHI DI LAVORO */}
      <div className="bg-white rounded-[2rem] shadow-sm border border-gray-200 relative mb-10 flex flex-col overflow-hidden">
        
        {/* Navigation Toolbar */}
        <div className="p-4 border-b border-gray-200 flex flex-col md:flex-row md:items-center justify-between gap-4 no-print bg-gray-50/50 rounded-t-[2rem] shrink-0">
          <div>
            <h3 className="font-extrabold text-xl text-gray-900">Carichi di Lavoro Settimanali</h3>
            <p className="text-xs text-gray-400 font-bold mt-0.5">
              {(isAdmin || isSoci(myAssociatedName) || isCoordinatoreQualsiasi || isPMOrResponsabile)
                ? "* Clicca su una cella per aggiungere, rimuovere o modificare i dettagli delle commesse di cui sei PM, Responsabile o Admin per quella settimana."
                : "* Vista di sola lettura. (Solo Amministratori, Soci, Coordinatori o PM/Responsabili possono modificare la pianificazione)"
              }
            </p>
          </div>

          <div className="flex items-center gap-3 no-print">
            
            {/* Grid Search Input (nascosto per dipendenti normali che visualizzano solo se stessi) */}
            {!isDipendenteNormale && (
              <input 
                type="text" 
                placeholder="Cerca dipendente..." 
                value={gridSearchQuery}
                onChange={e => setGridSearchQuery(e.target.value)}
                className="p-2.5 border rounded-xl text-xs outline-none focus:ring-2 focus:ring-indigo-400 font-semibold shadow-sm w-44"
              />
            )}

            {/* Zoom Temporale magnifier buttons */}
            <div className="flex items-center gap-1.5 bg-white p-1 rounded-xl border border-gray-200 shadow-sm h-[38px]">
              <button 
                type="button"
                onClick={() => setZoomWeeks(prev => Math.max(2, prev - 2))} 
                className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-650 transition flex items-center justify-center cursor-pointer"
                title="Zoom In (Vedi meno settimane, più dettaglio)"
              >
                <ZoomIn className="w-4 h-4 text-indigo-600" />
              </button>
              <span className="text-xs font-bold text-gray-750 min-w-[50px] text-center select-none">{zoomWeeks} Sett.</span>
              <button 
                type="button"
                onClick={() => setZoomWeeks(prev => Math.min(52, prev + 2))} 
                className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-650 transition flex items-center justify-center cursor-pointer"
                title="Zoom Out (Vedi più settimane, panoramica)"
              >
                <ZoomOut className="w-4 h-4 text-indigo-600" />
              </button>
            </div>

            <div className="flex items-center gap-1 bg-white p-1.5 rounded-xl border border-gray-200 shadow-sm">
              <button onClick={() => shiftGridPeriod(-zoomWeeks)} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-600 transition" title="Indietro"><ChevronLeft className="w-4 h-4" /></button>
              <button onClick={() => setGridBaseDate(new Date())} className="px-3 py-1.5 text-xs font-extrabold text-gray-700 hover:bg-gray-100 rounded-lg transition">Oggi</button>
              <button onClick={() => shiftGridPeriod(zoomWeeks)} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-600 transition" title="Avanti"><ChevronRight className="w-4 h-4" /></button>
            </div>
            
            <button onClick={handleExportGridToExcel} className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-xl text-sm font-bold transition shadow-md active:scale-95">
              <Download className="w-4 h-4" /> Esporta Excel
            </button>
          </div>
        </div>

        {/* Load Grid Wrapper */}
        <div 
          ref={tableContainerRef}
          onScroll={() => setHoveredCellTooltip(null)}
          className="w-full overflow-auto scrollbar-thin"
          style={{ maxHeight: `${tableHeight}px` }}
        >
            <table className="w-full text-center border-separate border-spacing-0 text-xs">
            <thead className="sticky top-0 z-30 bg-gray-100 border-b border-gray-200 font-bold text-gray-600 shadow-sm">
              <tr className="h-14">
                <th 
                  className="p-4 text-left sticky left-0 top-0 z-35 bg-white shadow-[1px_0_0_0_#e5e7eb] font-extrabold h-14 truncate"
                  style={{ width: '180px', minWidth: '180px', maxWidth: '180px' }}
                >
                  Dipendente
                </th>
                {timelineWeeks.map((wk, i) => {
                  const isCurrentWeek = wk.id === `${new Date().getFullYear()}-W${getWeekNumber(new Date())}`;
                  return (
                    <th 
                      key={i} 
                      className={`${isUltraNarrow ? 'p-1' : isNarrow ? 'p-1.5' : 'p-3'} border-l border-b border-gray-200 sticky top-0 z-30 bg-gray-100 h-14 ${isCurrentWeek ? 'bg-indigo-50/50' : ''}`}
                      style={{ minWidth: weekColumnMinWidth, width: weekColumnMinWidth }}
                    >
                      <div className="font-extrabold text-gray-900 text-xs truncate" title={wk.label}>
                        {isNarrow ? wk.label.replace('Sett. ', 'S') : wk.label}
                      </div>
                      {(() => {
                        const parts = (wk.sub || '').split(' - ');
                        if (parts.length === 2) {
                          return (
                            <div className="text-[9px] leading-tight text-gray-400 mt-0.5 font-bold flex flex-col items-center select-none shrink-0">
                              <span>{parts[0]}</span>
                              <span className="opacity-30 text-[7px] leading-[5px] my-0.5">↓</span>
                              <span>{parts[1]}</span>
                            </div>
                          );
                        }
                        return <div className="text-[10px] text-gray-400 mt-0.5 truncate">{wk.sub}</div>;
                      })()}
                    </th>
                  );
                })}
              </tr>
            </thead>
            {loadingAssignments ? (
              <tbody className="divide-y divide-gray-100 font-medium bg-white">
                <tr>
                  <td colSpan={timelineWeeks.length + 1} className="p-12 text-center text-gray-400 font-bold italic bg-white">
                    Caricamento assegnazioni...
                  </td>
                </tr>
              </tbody>
            ) : (disegnatori.length === 0 && ingegneria.length === 0 && sicurezzaCantieri.length === 0 && consulenzaSicurezza.length === 0 && amministrazione.length === 0 && nonAssegnati.length === 0) ? (
              <tbody className="divide-y divide-gray-100 font-medium bg-white">
                <tr>
                  <td colSpan={timelineWeeks.length + 1} className="p-12 text-center text-gray-400 font-bold italic bg-white">
                    Nessuna risorsa corrisponde ai criteri di ricerca.
                  </td>
                </tr>
              </tbody>
            ) : isDipendenteNormale ? (
              (() => {
                const currentDip = dipendenti.find(d => d.email.toLowerCase() === userEmail);
                return (
                  <tbody className="divide-y divide-gray-100 font-medium bg-white">
                    {currentDip ? (
                      renderEmployeeRow(currentDip, currentDip.macroArea || 'Non Assegnati', 0, 1)
                    ) : (
                      <tr>
                        <td colSpan={timelineWeeks.length + 1} className="p-12 text-center text-gray-400 font-bold italic bg-white">
                          Nessun dato personale trovato per il tuo utente.
                        </td>
                      </tr>
                    )}
                  </tbody>
                );
              })()
            ) : (
              <>
                {/* SEZIONE MACRO AREE */}
                <tbody className="divide-y divide-gray-100 font-medium bg-white border-b border-slate-900">
                  <tr className="bg-indigo-50/40 text-indigo-955 font-extrabold text-xs border-t border-indigo-100">
                    <td colSpan={timelineWeeks.length + 1} className="p-3 text-left pl-6 sticky left-0 z-20 bg-indigo-50/95 border-b border-indigo-100" style={{ top: '55px' }}>
                      <span className="uppercase tracking-wider font-black">Macro Aree Funzionali</span>
                    </td>
                  </tr>
                </tbody>
                
                <tbody className="divide-y divide-gray-100 font-medium bg-white border-b border-slate-900">
                  {renderAreaRow('Disegnatori', disegnatori)}
                </tbody>
                <tbody className="no-print"><tr className="h-4 bg-gray-50"><td colSpan={timelineWeeks.length + 1} className="p-2 border-none"></td></tr></tbody>
                
                <tbody className="divide-y divide-gray-100 font-medium bg-white border-b border-slate-900">
                  {renderAreaRow('Ingegneria', ingegneria)}
                </tbody>
                <tbody className="no-print"><tr className="h-4 bg-gray-50"><td colSpan={timelineWeeks.length + 1} className="p-2 border-none"></td></tr></tbody>
                
                <tbody className="divide-y divide-gray-100 font-medium bg-white border-b border-slate-900">
                  {renderAreaRow('Sicurezza Cantieri', sicurezzaCantieri)}
                </tbody>
                <tbody className="no-print"><tr className="h-4 bg-gray-50"><td colSpan={timelineWeeks.length + 1} className="p-2 border-none"></td></tr></tbody>
                
                <tbody className="divide-y divide-gray-100 font-medium bg-white border-b border-slate-900">
                  {renderAreaRow('Consulenza Sicurezza', consulenzaSicurezza)}
                </tbody>
                <tbody className="no-print"><tr className="h-4 bg-gray-50"><td colSpan={timelineWeeks.length + 1} className="p-2 border-none"></td></tr></tbody>
                
                <tbody className="divide-y divide-gray-100 font-medium bg-white border-b border-slate-900">
                  {renderAreaRow('Amministrazione', amministrazione)}
                </tbody>

                {/* SEZIONE PERSONALE NON ASSEGNATO */}
                {nonAssegnati.length > 0 && (
                  <tbody className="divide-y divide-gray-100 font-medium bg-white">
                    <tr className="bg-amber-50/40 text-amber-955 font-extrabold text-xs border-t border-amber-100">
                      <td colSpan={timelineWeeks.length + 1} className="p-3 text-left pl-6 sticky left-0 z-20 bg-amber-50/95 border-b border-amber-100" style={{ top: '55px' }}>
                        <span className="uppercase tracking-wider font-black">Personale Non Assegnato ({nonAssegnati.length})</span>
                      </td>
                    </tr>
                    {nonAssegnati.map((dip, idx) => renderEmployeeRow(dip, 'Non Assegnati', idx, nonAssegnati.length))}
                  </tbody>
                )}
              </>
            )}
          </table>
        </div>

        {/* MANIGLIA DI RIDIMENSIONAMENTO TRASCINABILE IN BASSO */}
        <div 
          onMouseDown={handleMouseDownResize}
          className="w-full bg-slate-100 hover:bg-indigo-100 border-t border-gray-200 py-1.5 flex items-center justify-center gap-2 cursor-row-resize select-none transition-colors group"
          title="Clicca e trascina in verticale per regolare l'altezza del tabellone"
        >
          <MoveVertical className="w-4 h-4 text-gray-500 group-hover:text-indigo-600 transition-colors" />
          <span ref={heightTextRef} className="text-[10px] font-black uppercase text-gray-600 group-hover:text-indigo-900 tracking-wider">
            Trascina per ridimensionare altezza ({tableHeight}px)
          </span>
        </div>

        {/* Legend */}
        <div className="p-4 bg-gray-50 flex flex-wrap gap-6 border-t justify-center text-xs font-bold text-gray-500 rounded-b-[2rem] select-none">
          <div className="flex items-center gap-3">
            <span className="w-4 h-4 rounded-lg bg-slate-50/50 border border-slate-200 shadow-sm shrink-0 flex items-center justify-center">
              <span className="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
            </span>
            <span>Carico Vuoto (0%)</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="w-4 h-4 rounded-lg bg-sky-50 border border-sky-200 shadow-sm shrink-0 flex items-center justify-center">
              <span className="w-1.5 h-1.5 rounded-full bg-sky-500"></span>
            </span>
            <span>Sotto-utilizzato (&gt; 0% a 60%)</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="w-4 h-4 rounded-lg bg-emerald-50 border border-emerald-200 shadow-sm shrink-0 flex items-center justify-center">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
            </span>
            <span>Ottimale (&gt; 60% a 110%)</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="w-4 h-4 rounded-lg bg-rose-50 border border-rose-200 shadow-sm shrink-0 flex items-center justify-center">
              <span className="w-1.5 h-1.5 rounded-full bg-rose-600"></span>
            </span>
            <span>Sovraccarico (&gt; 110%)</span>
          </div>
          <div className="flex items-center gap-3">
            <span 
              className="w-5 h-4 rounded-lg border border-blue-300 shadow-sm shrink-0"
              style={{ backgroundImage: 'repeating-linear-gradient(45deg, #dbeafe 0px, #dbeafe 4px, #eff6ff 4px, #eff6ff 8px)' }}
            ></span>
            <span>Settimana in Ferie (100%)</span>
          </div>
        </div>

      </div>



      <ConfirmModal
        isOpen={confirmConfig.isOpen}
        title={confirmConfig.title}
        message={confirmConfig.message}
        type={confirmConfig.type}
        onConfirm={confirmConfig.onConfirm}
        onCancel={() => setConfirmConfig(prev => ({ ...prev, isOpen: false }))}
      />

      {/* MODALE RICHIESTA PERSONALE (generico per ogni area) */}
      {isRequestModalOpen && (() => {
        const areaModalColors: Record<string, { gradient: string; titleColor: string; subtitleColor: string; ring: string }> = {
          'Disegnatori':          { gradient: 'from-teal-50/50 to-slate-50',   titleColor: 'text-teal-950',   subtitleColor: 'text-teal-700/80',   ring: 'focus:ring-teal-500' },
          'Ingegneria':           { gradient: 'from-indigo-50/50 to-slate-50', titleColor: 'text-indigo-950', subtitleColor: 'text-indigo-700/80', ring: 'focus:ring-indigo-500' },
          'Sicurezza Cantieri':   { gradient: 'from-emerald-50/50 to-slate-50',titleColor: 'text-emerald-950',subtitleColor: 'text-emerald-700/80',ring: 'focus:ring-emerald-500' },
          'Consulenza Sicurezza': { gradient: 'from-amber-50/50 to-slate-50',  titleColor: 'text-amber-950',  subtitleColor: 'text-amber-700/80',  ring: 'focus:ring-amber-500' },
        };
        const mc = areaModalColors[reqAreaTarget] || areaModalColors['Disegnatori'];
        return (
        <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-md flex items-center justify-center z-[9999] p-4 sm:p-6 no-print animate-in fade-in duration-200">
          <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-3xl border border-gray-100 flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
            <div className={`p-6 sm:p-8 border-b flex justify-between items-center bg-gradient-to-br ${mc.gradient} rounded-t-[2rem]`}>
              <div>
                <h3 className={`text-xl font-extrabold ${mc.titleColor}`}>Richiedi Personale — {reqAreaTarget}</h3>
                <p className={`text-xs ${mc.subtitleColor} mt-1`}>Invia una richiesta ai coordinatori dell'area <strong>{reqAreaTarget}</strong>.</p>
              </div>
              <button 
                type="button"
                onClick={() => setIsRequestModalOpen(false)}
                className="text-gray-400 hover:text-gray-650 text-lg font-bold p-2 hover:bg-gray-100 rounded-full transition cursor-pointer"
              >
                ✕
              </button>
            </div>
            
            <form onSubmit={handleSubmitRequest} className="p-6 sm:p-8 space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {/* Colonna Sinistra */}
                <div className="space-y-4">
                  <div className="bg-slate-50 rounded-xl px-4 py-2.5 border border-slate-100 flex items-center justify-between">
                    <span className="text-[10px] font-black text-gray-500 uppercase tracking-wider">Area richiesta:</span>
                    <span className="font-extrabold text-xs text-indigo-900 bg-indigo-50/80 px-2.5 py-1 rounded-lg border border-indigo-100">{reqAreaTarget}</span>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-indigo-950 mb-1 ml-1">Seleziona Commessa *</label>
                    <select
                      required
                      value={reqCommessaId}
                      onChange={e => setReqCommessaId(e.target.value)}
                      className={`w-full p-2.5 border-none bg-slate-50 focus:bg-white rounded-xl text-xs font-bold text-gray-750 outline-none focus:ring-2 ${mc.ring} shadow-inner cursor-pointer`}
                    >
                      <option value="">-- Seleziona Commessa --</option>
                      {selectableCommesse.map(c => (
                        <option key={c.id} value={c.id}>{c.nome} [{c.codiceCommessa}]</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-indigo-950 mb-1 ml-1 flex items-center justify-between">
                      <span>Risorsa Preferita</span>
                      <span className="text-[10px] text-indigo-600 font-bold italic">(Opzionale)</span>
                    </label>
                    <select
                      value={reqPreferredResource}
                      onChange={e => setReqPreferredResource(e.target.value)}
                      className={`w-full p-2.5 border-none bg-slate-50 focus:bg-white rounded-xl text-xs font-bold text-gray-750 outline-none focus:ring-2 ${mc.ring} shadow-inner cursor-pointer`}
                    >
                      <option value="">-- Nessuna preferenza (Assegna Coordinatore) --</option>
                      {dipendenti
                        .filter(d => !isSoci(d.nome) && d.macroArea === reqAreaTarget)
                        .map(d => (
                          <option key={d.id} value={d.nome}>{d.nome}</option>
                        ))
                      }
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-indigo-950 mb-1 ml-1">Percentuale Carico Richiesta *</label>
                    <select
                      required
                      value={reqPercentuale}
                      onChange={e => setReqPercentuale(Number(e.target.value))}
                      className={`w-full p-2.5 border-none bg-slate-50 focus:bg-white rounded-xl text-xs font-bold text-gray-750 outline-none focus:ring-2 ${mc.ring} shadow-inner cursor-pointer`}
                    >
                      {Array.from({ length: 20 }, (_, i) => (i + 1) * 5).map(pct => (
                        <option key={pct} value={pct}>{pct}%</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Colonna Destra */}
                <div className="space-y-4 flex flex-col justify-between">
                  {/* SELEZIONE DA CALENDARIO DATE CON EVIDENZA SETTIMANA */}
                  {(() => {
                    const defRange = getDefaultWeekRange();
                    const effectiveStartStr = reqDataInizio || defRange.startStr;
                    const effectiveEndStr = reqDataFine || defRange.endStr;
                    const startOpt = selectableWeekOptions.find(o => o.mondayStr === effectiveStartStr) || selectableWeekOptions.find(o => o.mondayStr === defRange.startStr) || selectableWeekOptions[0];
                    const endOpt = selectableWeekOptions.find(o => o.sundayStr === effectiveEndStr) || startOpt;
                    const targetWeekIds = getWeeksSpannedByDates(effectiveStartStr, effectiveEndStr);

                    return (
                      <div className="bg-white/90 p-4 rounded-2xl border border-indigo-100 shadow-xs space-y-3">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-[10px] font-black text-indigo-900 uppercase tracking-wider mb-1.5 ml-0.5">
                              📅 DATA INIZIO (SCEGLI DA CALENDARIO)
                            </label>
                            <input
                              type="date"
                              value={effectiveStartStr}
                              onChange={e => handleReqModalDateChange(e.target.value, true)}
                              className={`w-full p-2.5 border-none bg-slate-50 focus:bg-white rounded-xl text-xs font-bold text-gray-750 outline-none focus:ring-2 ${mc.ring} shadow-inner cursor-pointer`}
                            />
                            {startOpt && (
                              <div className="mt-2 p-2 bg-indigo-50/80 rounded-xl border border-indigo-100 flex items-center gap-2">
                                <span className="text-xs">📌</span>
                                <div className="flex flex-col">
                                  <span className="text-[9.5px] font-black text-indigo-600 uppercase tracking-wider">Settimana di Inizio Riferimento</span>
                                  <span className="text-xs font-black text-indigo-950">{startOpt.label}</span>
                                </div>
                              </div>
                            )}
                          </div>

                          <div>
                            <label className="block text-[10px] font-black text-indigo-900 uppercase tracking-wider mb-1.5 ml-0.5">
                              📅 DATA FINE (SCEGLI DA CALENDARIO)
                            </label>
                            <input
                              type="date"
                              min={effectiveStartStr}
                              value={effectiveEndStr}
                              onChange={e => handleReqModalDateChange(e.target.value, false)}
                              className={`w-full p-2.5 border-none bg-slate-50 focus:bg-white rounded-xl text-xs font-bold text-gray-750 outline-none focus:ring-2 ${mc.ring} shadow-inner cursor-pointer`}
                            />
                            {endOpt && (
                              <div className="mt-2 p-2 bg-indigo-50/80 rounded-xl border border-indigo-100 flex items-center gap-2">
                                <span className="text-xs">📌</span>
                                <div className="flex flex-col">
                                  <span className="text-[9.5px] font-black text-indigo-600 uppercase tracking-wider">Settimana di Fine Riferimento</span>
                                  <span className="text-xs font-black text-indigo-950">{endOpt.label}</span>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Dynamic Summary Banner */}
                        {startOpt && endOpt && (
                          <div className="flex flex-wrap items-center justify-between gap-2 bg-indigo-50/80 px-3 py-2 rounded-xl border border-indigo-100 text-xs font-bold text-indigo-900">
                            <div className="flex items-center gap-2">
                              <span className="w-2 h-2 rounded-full bg-indigo-600 animate-pulse"></span>
                              <span>
                                Durata Selezionata: <strong className="text-indigo-700 font-extrabold">{targetWeekIds.length} {targetWeekIds.length === 1 ? 'settimana' : 'settimane'}</strong>
                              </span>
                            </div>
                            <span className="text-[11px] text-indigo-600/80 font-semibold">
                              (da Lun {formatShortDate(new Date(effectiveStartStr))} a Dom {formatShortDate(new Date(effectiveEndStr))})
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  <div>
                    <label className="block text-xs font-bold text-indigo-950 mb-1 ml-1 flex items-center justify-between">
                      <span>Nota per il Coordinatore</span>
                      <span className="text-[10px] text-gray-400 font-semibold italic">(Facoltativa)</span>
                    </label>
                    <textarea
                      placeholder={`Es. Ho bisogno di una risorsa dell'area ${reqAreaTarget} con esperienza in...`}
                      value={reqNota}
                      onChange={e => setReqNota(e.target.value)}
                      rows={3}
                      className={`w-full p-3 border-none bg-slate-50 focus:bg-white rounded-xl text-xs font-semibold text-gray-750 outline-none focus:ring-2 ${mc.ring} shadow-inner resize-none`}
                    />
                  </div>
                </div>
              </div>
              
              <div className="flex gap-3 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setIsRequestModalOpen(false)}
                  className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-extrabold py-3 rounded-xl transition active:scale-95 text-xs text-center cursor-pointer"
                >
                  Chiudi
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingRequest}
                  className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold py-3 rounded-xl shadow-md transition active:scale-95 text-xs text-center disabled:opacity-50 cursor-pointer"
                >
                  {isSubmittingRequest ? "Invio in corso..." : `Invia Richiesta ${reqAreaTarget}`}
                </button>
              </div>
            </form>
          </div>
        </div>
        );
      })()}

      {/* MODALE REGISTRO RICHIESTE APPROVATE PER COORDINATORI / ADMIN */}
      {showApprovedHistoryModal && (
        <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-md flex items-center justify-center z-[9999] p-4 sm:p-6 no-print animate-in fade-in duration-200">
          <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-4xl border border-gray-100 flex flex-col max-h-[85vh] overflow-hidden animate-in zoom-in-95 duration-200">
            
            <div className="p-5 sm:p-6 border-b bg-gradient-to-r from-indigo-700 via-indigo-800 to-slate-900 text-white flex justify-between items-center">
              <div className="flex items-center gap-3">
                <FileText className="w-6 h-6 text-indigo-300" />
                <div>
                  <h3 className="text-lg font-black tracking-tight">Registro Richieste Personale Approvate</h3>
                  <p className="text-xs text-indigo-200 font-medium">Storico completo delle richieste approvate per le commesse</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowApprovedHistoryModal(false)}
                className="text-white/80 hover:text-white p-1 hover:bg-white/10 rounded-full transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4 flex-1">
              {(() => {
                const approvedList = richiesteDisegnatori.filter(r => {
                  if (r.stato !== 'approvata') return false;
                  const rArea = r.area || 'Disegnatori';
                  return myCoordinatedAreas.includes(rArea);
                }).sort((a, b) => {
                  const dateA = a.dataInizio || '';
                  const dateB = b.dataInizio || '';
                  return dateB.localeCompare(dateA);
                });

                if (approvedList.length === 0) {
                  return (
                    <div className="text-center text-gray-400 py-12 font-medium bg-slate-50 rounded-2xl border border-dashed border-slate-200 text-xs">
                      Nessuna richiesta approvata trovata nel registro.
                    </div>
                  );
                }

                return approvedList.map(req => {
                  const assignedRes = req.risorseAssegnata || '';
                  const isAssignedValid = assignedRes && dipendenti.some(d => d.nome === assignedRes);
                  const selectedFixRes = historySelectedResource[req.id] || (isAssignedValid ? assignedRes : '');

                  return (
                    <div key={req.id} className={`p-4 rounded-2xl border transition-all flex flex-col md:flex-row justify-between items-start md:items-center gap-4 ${
                      !isAssignedValid ? 'bg-amber-50/80 border-amber-300 shadow-sm' : 'bg-slate-50/70 border-slate-200/80'
                    }`}>
                      <div className="space-y-1.5 flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-extrabold text-sm text-gray-900">{req.commessaName}</span>
                          <span className="bg-indigo-100 text-indigo-800 text-[10px] font-extrabold px-2 py-0.5 rounded-full uppercase">
                            {req.area || 'Disegnatori'}
                          </span>
                          {!isAssignedValid && (
                            <span className="bg-amber-500 text-white text-[10px] font-black px-2 py-0.5 rounded-full animate-pulse">
                              ⚠️ NESSUNA RISORSA ASSEGNATA
                            </span>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-3 text-xs text-gray-600">
                          <div>📅 Periodo: <strong className="text-gray-800">{formatCommDate(req.dataInizio)}</strong> → <strong className="text-gray-800">{formatCommDate(req.dataFine)}</strong></div>
                          <div>⚡ Carico: <strong className="text-gray-800">{req.percentuale}%</strong></div>
                          <div>👤 Richiedente: <span className="font-semibold text-gray-800">{req.richiedenteNome}</span></div>
                        </div>

                        {req.risorsaPreferita && (
                          <div className="text-[11px] text-indigo-900 bg-indigo-50 px-2 py-0.5 rounded-lg border border-indigo-100 w-fit font-medium">
                            ⭐ Preferenza segnalata: <strong>{req.risorsaPreferita}</strong>
                          </div>
                        )}

                        {req.nota && (
                          <div className="text-[11px] italic text-gray-500">
                            &ldquo;{req.nota}&rdquo;
                          </div>
                        )}
                      </div>

                      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 shrink-0 w-full md:w-auto">
                        <div className="flex items-center gap-2">
                          <select
                            value={selectedFixRes}
                            onChange={e => setHistorySelectedResource(prev => ({ ...prev, [req.id]: e.target.value }))}
                            className="p-2 border border-slate-300 rounded-xl bg-white text-xs font-bold text-gray-800 outline-none focus:ring-2 focus:ring-indigo-500"
                          >
                            <option value="">-- Seleziona Risorsa --</option>
                            {dipendenti.filter(d => !d.dataCessazione || d.dataCessazione >= new Date().toLocaleDateString('sv-SE')).map(d => (
                              <option key={d.id} value={d.nome}>{d.nome}</option>
                            ))}
                          </select>

                          <button
                            type="button"
                            onClick={() => handleFixHistoryRequest(req, selectedFixRes)}
                            disabled={!selectedFixRes || selectedFixRes === assignedRes}
                            className="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-extrabold text-xs rounded-xl shadow transition cursor-pointer whitespace-nowrap"
                          >
                            {isAssignedValid ? "Aggiorna Assegnazione" : "Assegna Risorsa al Calendario"}
                          </button>

                          <button
                            type="button"
                            onClick={() => handleDeleteSentRequest(req)}
                            title="Elimina definitivamente questa richiesta dallo storico"
                            className="p-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-xl transition cursor-pointer active:scale-95"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                });
              })()}
            </div>

            <div className="p-4 border-t border-gray-150 bg-gray-50 flex justify-end">
              <button
                type="button"
                onClick={() => setShowApprovedHistoryModal(false)}
                className="px-5 py-2.5 bg-gray-200 hover:bg-gray-300 text-gray-800 font-extrabold text-xs rounded-xl transition cursor-pointer"
              >
                Chiudi
              </button>
            </div>

          </div>
        </div>
      )}

      {/* MODALE STORICO MIE RICHIESTE INVIATE (ULTIMI 30 GIORNI) */}
      {showMySentRequestsModal && (
        <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-md flex items-center justify-center z-[9999] p-4 sm:p-6 no-print animate-in fade-in duration-200">
          <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-4xl border border-gray-100 flex flex-col max-h-[85vh] overflow-hidden animate-in zoom-in-95 duration-200">
            
            <div className="p-5 sm:p-6 border-b bg-gradient-to-r from-teal-700 via-indigo-800 to-slate-900 text-white flex justify-between items-center">
              <div className="flex items-center gap-3">
                <Clock className="w-6 h-6 text-teal-300" />
                <div>
                  <h3 className="text-lg font-black tracking-tight">Storico Mie Richieste Inviate</h3>
                  <p className="text-xs text-teal-200 font-medium">Richieste di personale inoltrate ad altre aree negli ultimi 30 giorni</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowMySentRequestsModal(false)}
                className="text-white/80 hover:text-white p-1 hover:bg-white/10 rounded-full transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4 flex-1">
              {myRecentSentRequests.length === 0 ? (
                <div className="text-center py-12 text-gray-500 font-semibold bg-gray-50/50 rounded-2xl border border-dashed border-gray-200">
                  <p className="text-base font-bold text-gray-700 mb-1">Nessuna richiesta inviata negli ultimi 30 giorni</p>
                  <p className="text-xs text-gray-400">Le richieste di personale inviate ad altre aree compariranno qui con lo stato in tempo reale.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {myRecentSentRequests.map((req: any) => {
                    const statusConfig = {
                      'in_attesa': { label: 'In Lavorazione', bg: 'bg-amber-100 text-amber-800 border-amber-200', icon: '🟡' },
                      'approvata': { label: 'Approvata', bg: 'bg-emerald-100 text-emerald-800 border-emerald-200', icon: '🟢' },
                      'rifiutata': { label: 'Rifiutata', bg: 'bg-rose-100 text-rose-800 border-rose-200', icon: '🔴' }
                    }[req.stato as string] || { label: req.stato, bg: 'bg-gray-100 text-gray-800 border-gray-200', icon: '⚪' };

                    return (
                      <div key={req.id} className="bg-white p-4.5 rounded-2xl border border-gray-200 shadow-xs hover:shadow-md transition flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                        <div className="space-y-1.5 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-black text-sm text-gray-900">{req.commessaName}</span>
                            <span className="text-xs font-bold bg-indigo-50 text-indigo-700 border border-indigo-100 px-2.5 py-0.5 rounded-full">
                              Area {req.area || 'Disegnatori'}
                            </span>
                            <span className={`text-[11px] font-black px-2.5 py-0.5 rounded-full border flex items-center gap-1 ${statusConfig.bg}`}>
                              <span>{statusConfig.icon}</span>
                              <span>{statusConfig.label}</span>
                            </span>
                          </div>

                          <div className="text-xs text-gray-600 font-medium flex flex-wrap gap-x-4 gap-y-1">
                            <span>Periodo: <strong className="text-gray-800">{formatCommDate(req.dataInizio)} → {formatCommDate(req.dataFine)}</strong></span>
                            <span>Carico: <strong className="text-gray-800">{req.percentuale}%</strong></span>
                            {req.risorsaPreferita && (
                              <span>Risorsa Richiesta: <strong className="text-indigo-600">{req.risorsaPreferita}</strong></span>
                            )}
                            {req.risorseAssegnata && (
                              <span>Risorsa Assegnata: <strong className="text-emerald-700">{req.risorseAssegnata}</strong></span>
                            )}
                          </div>

                          {req.nota && (
                            <p className="text-xs text-gray-500 italic bg-gray-50 p-2 rounded-xl border border-gray-100 mt-1">
                              "{req.nota}"
                            </p>
                          )}
                        </div>

                        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 shrink-0 self-end md:self-center">
                          <div className="text-[11px] font-semibold text-gray-400 mr-2 text-right">
                            Inviata il: {
                              req.createdAt 
                                ? formatCommDate(req.createdAt.slice(0, 10)) 
                                : req.timestamp 
                                  ? formatCommDate(req.timestamp.slice(0, 10)) 
                                  : req.dataInizio 
                                    ? formatCommDate(req.dataInizio) 
                                    : 'N/D'
                            }
                          </div>

                          <div className="flex items-center gap-2">
                            {req.stato === 'in_attesa' && (
                              <button
                                type="button"
                                onClick={() => handleStartEditSentRequest(req)}
                                title="Modifica questa richiesta"
                                className="flex items-center gap-1 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 px-3 py-1.5 rounded-xl text-xs font-extrabold transition cursor-pointer active:scale-95"
                              >
                                <Pencil className="w-3.5 h-3.5 text-amber-700" />
                                <span>Modifica</span>
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => handleDeleteSentRequest(req)}
                              title={req.stato === 'in_attesa' ? "Annulla e cancella questa richiesta" : "Cancella dalla cronologia"}
                              className={`flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-extrabold transition cursor-pointer active:scale-95 ${
                                req.stato === 'in_attesa' 
                                  ? 'bg-rose-50 hover:bg-rose-100 text-rose-900 border border-rose-200' 
                                  : 'bg-gray-100 hover:bg-rose-50 text-gray-600 hover:text-rose-700 border border-gray-200 hover:border-rose-200'
                              }`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span>{req.stato === 'in_attesa' ? 'Annulla' : 'Elimina dallo storico'}</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="p-4 border-t bg-gray-50 flex justify-between items-center text-xs text-gray-500 font-semibold flex-wrap gap-2">
              <span>* Puoi modificare o annullare le richieste finché sono in lavorazione (🟡). Le richieste concluse antecedenti a 30 giorni sono conservate nel DB.</span>
              <button
                type="button"
                onClick={() => setShowMySentRequestsModal(false)}
                className="bg-gray-800 hover:bg-gray-900 text-white font-bold px-4 py-2 rounded-xl transition cursor-pointer"
              >
                Chiudi
              </button>
            </div>

          </div>
        </div>
      )}

      {/* MODALE DI MODIFICA RICHIESTA IN LAVORAZIONE */}
      {editingSentRequest && (
        <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-md flex items-center justify-center z-[10000] p-4 sm:p-6 no-print animate-in fade-in duration-200">
          <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-2xl border border-gray-100 flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b flex justify-between items-center bg-gradient-to-br from-amber-500 to-amber-600 text-white rounded-t-[2rem]">
              <div className="flex items-center gap-3">
                <Pencil className="w-6 h-6 text-amber-100" />
                <div>
                  <h3 className="text-xl font-extrabold">Modifica Richiesta Personale</h3>
                  <p className="text-xs text-amber-100">Aggiorna i dati della richiesta inviata per l'area {reqAreaTarget}</p>
                </div>
              </div>
              <button 
                type="button"
                onClick={() => setEditingSentRequest(null)}
                className="text-white/80 hover:text-white p-2 hover:bg-white/10 rounded-full transition cursor-pointer"
              >
                ✕
              </button>
            </div>
            
            <form onSubmit={handleSaveUpdateSentRequest} className="p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-800 mb-1">Commessa *</label>
                  <select
                    required
                    value={reqCommessaId}
                    onChange={e => setReqCommessaId(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-gray-800 outline-none focus:ring-2 focus:ring-amber-500 cursor-pointer"
                  >
                    {selectableCommesse.map(c => (
                      <option key={`edit-comm-${c.id}`} value={c.id}>{c.nome} [{c.codiceCommessa}]</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-800 mb-1">Area Richiesta *</label>
                  <select
                    required
                    value={reqAreaTarget}
                    onChange={e => setReqAreaTarget(e.target.value as MacroArea)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-gray-800 outline-none focus:ring-2 focus:ring-amber-500 cursor-pointer"
                  >
                    {MACRO_AREE.map(a => (
                      <option key={`edit-area-${a}`} value={a}>{a}</option>
                    ))}
                  </select>
                </div>

                {/* SELEZIONE DA CALENDARIO DATE CON EVIDENZA SETTIMANA */}
                <div className="sm:col-span-2">
                  {(() => {
                    const defRange = getDefaultWeekRange();
                    const effectiveStartStr = reqDataInizio || defRange.startStr;
                    const effectiveEndStr = reqDataFine || defRange.endStr;
                    const startOpt = selectableWeekOptions.find(o => o.mondayStr === effectiveStartStr) || selectableWeekOptions.find(o => o.mondayStr === defRange.startStr) || selectableWeekOptions[0];
                    const endOpt = selectableWeekOptions.find(o => o.sundayStr === effectiveEndStr) || startOpt;
                    const targetWeekIds = getWeeksSpannedByDates(effectiveStartStr, effectiveEndStr);

                    return (
                      <div className="bg-slate-50/90 p-4 rounded-2xl border border-slate-200 shadow-xs space-y-3">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-[10px] font-black text-slate-800 uppercase tracking-wider mb-1.5 ml-0.5">
                              📅 DATA INIZIO (SCEGLI DA CALENDARIO)
                            </label>
                            <input
                              type="date"
                              value={effectiveStartStr}
                              onChange={e => handleReqModalDateChange(e.target.value, true)}
                              className="w-full p-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-gray-800 outline-none focus:ring-2 focus:ring-amber-500 cursor-pointer"
                            />
                            {startOpt && (
                              <div className="mt-2 p-2 bg-amber-50/80 rounded-xl border border-amber-200/60 flex items-center gap-2">
                                <span className="text-xs">📌</span>
                                <div className="flex flex-col">
                                  <span className="text-[9.5px] font-black text-amber-700 uppercase tracking-wider">Settimana di Inizio Riferimento</span>
                                  <span className="text-xs font-black text-amber-950">{startOpt.label}</span>
                                </div>
                              </div>
                            )}
                          </div>

                          <div>
                            <label className="block text-[10px] font-black text-slate-800 uppercase tracking-wider mb-1.5 ml-0.5">
                              📅 DATA FINE (SCEGLI DA CALENDARIO)
                            </label>
                            <input
                              type="date"
                              min={effectiveStartStr}
                              value={effectiveEndStr}
                              onChange={e => handleReqModalDateChange(e.target.value, false)}
                              className="w-full p-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-gray-800 outline-none focus:ring-2 focus:ring-amber-500 cursor-pointer"
                            />
                            {endOpt && (
                              <div className="mt-2 p-2 bg-amber-50/80 rounded-xl border border-amber-200/60 flex items-center gap-2">
                                <span className="text-xs">📌</span>
                                <div className="flex flex-col">
                                  <span className="text-[9.5px] font-black text-amber-700 uppercase tracking-wider">Settimana di Fine Riferimento</span>
                                  <span className="text-xs font-black text-amber-950">{endOpt.label}</span>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Dynamic Summary Banner */}
                        {startOpt && endOpt && (
                          <div className="flex flex-wrap items-center justify-between gap-2 bg-white px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-800">
                            <div className="flex items-center gap-2">
                              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
                              <span>
                                Durata Selezionata: <strong className="text-amber-700 font-extrabold">{targetWeekIds.length} {targetWeekIds.length === 1 ? 'settimana' : 'settimane'}</strong>
                              </span>
                            </div>
                            <span className="text-[11px] text-slate-500 font-semibold">
                              (da Lun {formatShortDate(new Date(effectiveStartStr))} a Dom {formatShortDate(new Date(effectiveEndStr))})
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-800 mb-1">Percentuale Carico *</label>
                  <select
                    required
                    value={reqPercentuale}
                    onChange={e => setReqPercentuale(Number(e.target.value))}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-gray-800 outline-none focus:ring-2 focus:ring-amber-500 cursor-pointer"
                  >
                    {Array.from({ length: 20 }, (_, i) => (i + 1) * 5).map(pct => (
                      <option key={`edit-pct-${pct}`} value={pct}>{pct}%</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-800 mb-1">Risorsa Preferita (Opzionale)</label>
                  <select
                    value={reqPreferredResource}
                    onChange={e => setReqPreferredResource(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-gray-800 outline-none focus:ring-2 focus:ring-amber-500 cursor-pointer"
                  >
                    <option value="">-- Nessuna preferenza --</option>
                    {dipendenti
                      .filter(d => !isSoci(d.nome) && d.macroArea === reqAreaTarget)
                      .map(d => (
                        <option key={`edit-res-${d.id}`} value={d.nome}>{d.nome}</option>
                      ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-800 mb-1">Nota per il Coordinatore</label>
                <textarea
                  value={reqNota}
                  onChange={e => setReqNota(e.target.value)}
                  rows={2}
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-gray-800 outline-none focus:ring-2 focus:ring-amber-500 resize-none"
                />
              </div>

              <div className="flex gap-3 pt-3 border-t border-gray-150">
                <button
                  type="button"
                  onClick={() => setEditingSentRequest(null)}
                  className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-extrabold py-2.5 rounded-xl transition text-xs cursor-pointer"
                >
                  Annulla Modifica
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-amber-600 hover:bg-amber-700 text-white font-extrabold py-2.5 rounded-xl shadow-md transition text-xs cursor-pointer"
                >
                  Salva Modifiche Richiesta
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ResourceAvailabilityModal
        isOpen={isAvailabilityModalOpen}
        onClose={() => setIsAvailabilityModalOpen(false)}
        onSuccess={() => showToast("Segnalazione di disponibilità inviata al tuo coordinatore!", "success")}
      />

      <PianificazioneModal
        isOpen={planningModal.isOpen}
        onClose={() => setPlanningModal(prev => ({ ...prev, isOpen: false }))}
        initialTab={planningModal.tab}
        initialCommessaId={planningModal.commessaId}
        initialResourceName={planningModal.risorsa}
        initialWeekId={planningModal.weekId}
        onRequestAreaResource={(area, _commId, _wkId, personName) => {
          setPlanningModal(prev => ({ ...prev, isOpen: false }));
          openRequestModalForArea(area as MacroArea);
          if (personName) {
            setReqPreferredResource(personName);
          }
        }}
      />

      {/* MODALE DI CONFERMA ARCHIVIAZIONE SEGNALAZIONE DISPONIBILITÀ */}
      {isConfirmManageOpen && segnalazioneToManage && (
        <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-md flex items-center justify-center z-[9999] p-4 no-print animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md border border-gray-100 overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-5 bg-gradient-to-r from-emerald-600 to-teal-700 text-white flex justify-between items-center">
              <div className="flex items-center gap-2.5">
                <UserCheck className="w-5 h-5 text-white" />
                <h3 className="text-base font-extrabold">Conferma Gestione Disponibilità</h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsConfirmManageOpen(false);
                  setSegnalazioneToManage(null);
                }}
                className="text-white/80 hover:text-white p-1 rounded-lg hover:bg-white/10 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <p className="text-xs text-gray-600 leading-relaxed font-medium">
                Confermi che la richiesta di disponibilità della risorsa è stata <strong>presa in carico o assegnata</strong>? La segnalazione verrà archiviata nello storico condiviso dell'area.
              </p>

              <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-gray-500 font-semibold">Risorsa:</span>
                  <span className="font-extrabold text-gray-900">{segnalazioneToManage.risorsaNome || segnalazioneToManage.dipendenteNome}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500 font-semibold">Macro-Area:</span>
                  <span className="font-extrabold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">{segnalazioneToManage.macroArea}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500 font-semibold">Periodo:</span>
                  <span className="font-extrabold text-gray-900">{segnalazioneToManage.settimanaLabel || (segnalazioneToManage.dataInizio && segnalazioneToManage.dataFine ? `${segnalazioneToManage.dataInizio} → ${segnalazioneToManage.dataFine}` : segnalazioneToManage.settimana || 'Periodo corrente')}</span>
                </div>
                {(segnalazioneToManage.nota || segnalazioneToManage.note) && (
                  <div className="pt-2 border-t border-slate-200 text-gray-600 italic">
                    &ldquo;{segnalazioneToManage.nota || segnalazioneToManage.note}&rdquo;
                  </div>
                )}
              </div>

              <div className="flex gap-3 pt-3 border-t border-gray-150">
                <button
                  type="button"
                  onClick={() => {
                    setIsConfirmManageOpen(false);
                    setSegnalazioneToManage(null);
                  }}
                  className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-extrabold py-2.5 rounded-xl transition text-xs cursor-pointer"
                >
                  Annulla
                </button>
                <button
                  type="button"
                  onClick={handleConfirmGestione}
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-extrabold py-2.5 rounded-xl shadow-md transition text-xs cursor-pointer text-center"
                >
                  ✓ Conferma Archiviazione
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TOOLTIP GALLEGGIANTE SMART (PORTAL) — Nessun taglio da overflow/bordi/header */}
      {hoveredCellTooltip && createPortal(
        (() => {
          const { rect, dipNome, wkLabel, list, leaves, isFullLeave } = hoveredCellTooltip;
          // Calcolo dinamico dello spazio disponibile sopra vs sotto
          const spaceAbove = rect.top;
          const spaceBelow = window.innerHeight - rect.bottom;
          const showBelow = spaceAbove < 220 && spaceBelow >= 120;
          
          const topPos = showBelow ? rect.bottom + 8 : rect.top - 8;
          const transformOrigin = showBelow ? 'translate(-50%, 0)' : 'translate(-50%, -100%)';
          const leftPos = Math.max(160, Math.min(window.innerWidth - 160, rect.left + rect.width / 2));

          return (
            <div 
              style={{
                position: 'fixed',
                top: `${topPos}px`,
                left: `${leftPos}px`,
                transform: transformOrigin,
                zIndex: 999999,
                pointerEvents: 'none'
              }}
              className="bg-slate-900 text-white text-[11px] rounded-xl p-3 flex flex-col gap-1 shadow-2xl min-w-[220px] max-w-[320px] border border-slate-700/80 animate-in fade-in zoom-in-95 duration-100 select-none pointer-events-none"
            >
              <div className="font-extrabold text-[10.5px] text-indigo-300 border-b border-slate-700/80 pb-1 mb-1 flex items-center justify-between gap-2">
                <span className="truncate">{dipNome}</span>
                <span className="bg-indigo-900/80 text-indigo-200 px-1.5 py-0.5 rounded text-[9.5px] shrink-0">{wkLabel}</span>
              </div>
              {!isFullLeave && list.map((a, idx) => (
                <div key={idx} className="flex justify-between items-start gap-2.5 border-b border-slate-800/80 pb-1 last:border-none last:pb-0">
                  <span className="font-semibold text-gray-200 leading-snug break-words flex-1">{a.commessaName}</span>
                  <span className="font-black text-indigo-400 shrink-0">{a.percentuale}%</span>
                </div>
              ))}
              {leaves.length > 0 && (
                <div className="border-t border-slate-700/80 pt-1.5 mt-1 flex flex-col gap-1">
                  <span className="text-[9.5px] font-black text-amber-400 uppercase tracking-wider">Assenze / Ferie:</span>
                  {leaves.map((l, idx) => (
                    <div key={idx} className="flex justify-between items-center text-[9.5px] gap-2">
                      <span className="font-semibold text-gray-300">{l.giorno}</span>
                      <span className="font-black text-amber-200">{l.dettagli}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })(),
        document.body
      )}
    </div>
  );
}

